#!/usr/bin/env python3
"""
Options Feature Engineer: Extract Market State from Options Data

This module scans the raw options universe (394M rows) to produce a daily
timeseries of options market conditions.

It calculates "Price-Derived" metrics that are robust even if Greeks/IV
are missing from the source data:

1. ATM Vol Cost: Cost of ATM Straddle as % of Spot (IV Proxy)
2. Skew: (OTM Put Price - OTM Call Price) / Spot
3. Term Structure: (Back Month Cost - Front Month Cost)
4. Sentiment: Put/Call Volume Ratio

Output:
    options_features.parquet (Date, ATM_Cost, Skew, Term_Struct, PCR, etc.)
"""

import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import multiprocessing as mp

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

# Import from existing discovery engine to ensure compatibility
try:
    from engine.discovery.payoff_surface_builder import (
        load_daily_options,
        DailyOptionsSnapshot,
        parse_occ_ticker
    )
except ImportError:
    # Fallback if running as script
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from engine.discovery.payoff_surface_builder import (
        load_daily_options,
        DailyOptionsSnapshot,
        parse_occ_ticker
    )

logger = logging.getLogger("AlphaFactory.OptionsFeatures")

class OptionsFeatureEngineer:
    """
    Extracts daily market state features from raw options data.
    """

    def __init__(
        self,
        options_dir: Path,
        stock_data_path: Path,
        symbol: str = 'SPY',
        output_dir: Optional[Path] = None,
    ):
        self.options_dir = Path(options_dir)
        self.stock_data_path = Path(stock_data_path)
        self.symbol = symbol
        self.output_dir = output_dir or (self.options_dir.parent / 'features')
        
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.spot_prices = self._load_spot_prices()

    def _load_spot_prices(self) -> Dict[datetime, float]:
        """Load spot prices for normalization."""
        if not self.stock_data_path.exists():
            logger.warning(f"Stock data not found: {self.stock_data_path}")
            return {}
        
        try:
            df = pd.read_parquet(self.stock_data_path)
            if 'date' in df.columns:
                df['date'] = pd.to_datetime(df['date'])
            elif 'timestamp' in df.columns:
                df['date'] = pd.to_datetime(df['timestamp'])
            else:
                df['date'] = df.index
            
            return {row['date'].to_pydatetime(): row['close'] for _, row in df.iterrows()}
        except Exception as e:
            logger.error(f"Failed to load spot prices: {e}")
            return {}

    def _calculate_daily_features(self, snapshot: DailyOptionsSnapshot) -> Optional[Dict]:
        """
        Calculate features for a single day.
        """
        if snapshot.spot_price <= 0:
            return None

        spot = snapshot.spot_price
        feats = {'date': snapshot.date, 'spot': spot}

        # --- 1. Volume Sentiment ---
        total_call_vol = snapshot.options[snapshot.options['option_type'] == 'C']['volume'].sum()
        total_put_vol = snapshot.options[snapshot.options['option_type'] == 'P']['volume'].sum()
        
        feats['vol_pcr'] = total_put_vol / total_call_vol if total_call_vol > 0 else 1.0
        feats['total_opt_vol'] = total_call_vol + total_put_vol

        # --- 2. ATM Volatility Cost (Front Month ~30 DTE) ---
        # Find ~30 DTE bucket
        front_dte = 30
        front_bucket = None
        
        # Search for closest bucket
        for dte in [30, 21, 45]:
            if dte in snapshot.dte_groups:
                front_bucket = snapshot.dte_groups[dte]
                front_dte = dte
                break
        
        if front_bucket is not None:
            # Get ATM Call/Put
            front_bucket = front_bucket.copy()
            front_bucket['dist'] = abs(front_bucket['strike'] - spot)
            atm_strike = front_bucket.loc[front_bucket['dist'].idxmin(), 'strike']
            
            calls = front_bucket[(front_bucket['strike'] == atm_strike) & (front_bucket['option_type'] == 'C')]
            puts = front_bucket[(front_bucket['strike'] == atm_strike) & (front_bucket['option_type'] == 'P')]
            
            if not calls.empty and not puts.empty:
                straddle_price = calls.iloc[0]['close'] + puts.iloc[0]['close']
                # Normalize: Cost as % of Spot
                feats['atm_cost_pct'] = straddle_price / spot
                
                # Annualized Implied Vol Approx (Straddle approx: IV ~ price / (0.8 * spot * sqrt(t)))
                t = front_dte / 365.0
                feats['approx_iv'] = (straddle_price / (0.8 * spot * np.sqrt(t)))
            else:
                feats['atm_cost_pct'] = np.nan
                feats['approx_iv'] = np.nan
        else:
            return None

        # --- 3. Skew (25D Put vs 25D Call) ---
        # Use same front bucket
        if front_bucket is not None:
            # 25D approx: Strike = Spot * (1 +/- 0.03 for 30DTE, roughly)
            # Actually let's use the DeltaBucket logic from before or just % OTM
            # 30 DTE, 25D is approx 3-4% OTM
            
            put_strike_target = spot * 0.96
            call_strike_target = spot * 1.04
            
            puts = front_bucket[front_bucket['option_type'] == 'P'].copy()
            calls = front_bucket[front_bucket['option_type'] == 'C'].copy()
            
            if not puts.empty and not calls.empty:
                puts['dist'] = abs(puts['strike'] - put_strike_target)
                calls['dist'] = abs(calls['strike'] - call_strike_target)
                
                put_25d = puts.loc[puts['dist'].idxmin()]
                call_25d = calls.loc[calls['dist'].idxmin()]
                
                # Skew: How much more expensive is the Put?
                # Normalized by spot
                skew_premium = (put_25d['close'] - call_25d['close']) / spot
                feats['skew_25d'] = skew_premium
            else:
                feats['skew_25d'] = np.nan

        # --- 4. Term Structure (Back Month - Front Month) ---
        # Compare 30 DTE vs 60-90 DTE
        back_bucket = None
        for dte in [60, 90, 45]:
            if dte in snapshot.dte_groups and dte > front_dte + 14:
                back_bucket = snapshot.dte_groups[dte]
                back_dte = dte
                break
                
        if back_bucket is not None and 'atm_cost_pct' in feats and not np.isnan(feats['atm_cost_pct']):
            # Get Back ATM
            back_bucket = back_bucket.copy()
            back_bucket['dist'] = abs(back_bucket['strike'] - spot)
            atm_strike_back = back_bucket.loc[back_bucket['dist'].idxmin(), 'strike']
            
            b_calls = back_bucket[(back_bucket['strike'] == atm_strike_back) & (back_bucket['option_type'] == 'C')]
            b_puts = back_bucket[(back_bucket['strike'] == atm_strike_back) & (back_bucket['option_type'] == 'P')]
            
            if not b_calls.empty and not b_puts.empty:
                back_straddle = b_calls.iloc[0]['close'] + b_puts.iloc[0]['close']
                
                # IV approx for back month
                t_back = back_dte / 365.0
                back_iv = (back_straddle / (0.8 * spot * np.sqrt(t_back)))
                
                # Term structure: Back IV - Front IV
                feats['term_structure'] = back_iv - feats.get('approx_iv', 0)
            else:
                feats['term_structure'] = np.nan
        else:
            feats['term_structure'] = np.nan

        return feats

    def build_features(self, start_date: Optional[datetime] = None, end_date: Optional[datetime] = None) -> pd.DataFrame:
        """
        Process all options files and build feature history.
        """
        options_files = sorted(self.options_dir.glob('*.parquet'))
        logger.info(f"Found {len(options_files)} options files")
        
        features_list = []
        
        for i, f in enumerate(options_files):
            try:
                file_date = datetime.strptime(f.stem, '%Y-%m-%d')
                if start_date and file_date < start_date: continue
                if end_date and file_date > end_date: continue
                
                spot = self.spot_prices.get(file_date, 0)
                snapshot = load_daily_options(f, self.symbol, spot)
                
                if snapshot:
                    daily_feats = self._calculate_daily_features(snapshot)
                    if daily_feats:
                        features_list.append(daily_feats)
                        
                if (i + 1) % 50 == 0:
                    logger.info(f"Processed {i + 1} files...")
                    
            except Exception as e:
                logger.warning(f"Error processing {f.name}: {e}")
                continue
                
        if not features_list:
            return pd.DataFrame()
            
        df = pd.DataFrame(features_list)
        df = df.sort_values('date')
        
        # Fill gaps (ffill then zero for remaining NaN)
        df = df.ffill().fillna(0.0)
        
        output_path = self.output_dir / f'{self.symbol}_options_features.parquet'
        df.to_parquet(output_path)
        logger.info(f"Saved options features to {output_path}")
        
        return df

if __name__ == '__main__':
    # Self-test
    pass
