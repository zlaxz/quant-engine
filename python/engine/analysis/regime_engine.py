#!/usr/bin/env python3
"""
Regime Engine - The Market Cartographer.
AUDITED ROUND 3: Red Team Hardening (Flash Crash Protection).
API-READY: Added JSON serialization for UI.
"""

import pandas as pd
import numpy as np
import json
from typing import List, Dict, Any

# REGIME CONSTANTS
REGIME_BULL_QUIET = "BULL_QUIET"       
REGIME_BEAR_VOLATILE = "BEAR_VOL"      
REGIME_SIDEWAYS = "SIDEWAYS"           
REGIME_VOL_EXPANSION = "VOL_EXPANSION" 
REGIME_UNDEFINED = "UNDEFINED"

class RegimeEngine:
    """
    Analyzes price and volatility data to label the market state.
    STRICT RULE: Only uses trailing data. No future peeking.
    HARDENED: Includes Flash Crash detection.
    """
    
    def __init__(self, vol_window=20, trend_window=50):
        self.vol_window = vol_window   
        self.trend_window = trend_window 
        
    def _normalize_iv(self, iv_series: pd.Series) -> pd.Series:
        return np.where(iv_series > 5.0, iv_series / 100.0, iv_series)

    def get_regime(self, history_df: pd.DataFrame) -> str:
        if len(history_df) < self.trend_window:
            return REGIME_UNDEFINED
        current_price = history_df['close'].iloc[-1]

        # NaN check on price data
        if pd.isna(current_price):
            raise ValueError("NaN detected in close price - cannot classify regime")

        # Flash Crash Protection
        window_high = history_df['close'].tail(self.trend_window).max()
        drawdown = (current_price - window_high) / window_high
        if drawdown < -0.01: return REGIME_VOL_EXPANSION

        sma = history_df['close'].tail(self.trend_window).mean()
        is_uptrend = current_price > sma

        raw_iv = history_df['iv'].iloc[-1]

        # NaN check on IV data
        if pd.isna(raw_iv):
            raise ValueError("NaN detected in IV data - cannot classify regime")

        current_iv = raw_iv / 100.0 if raw_iv > 5.0 else raw_iv
        is_high_vol = current_iv > 0.20
        
        if is_high_vol:
            return REGIME_VOL_EXPANSION if is_uptrend else REGIME_BEAR_VOLATILE
        else: 
            return REGIME_BULL_QUIET if is_uptrend else REGIME_SIDEWAYS

    def label_historical_data(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        df['sma'] = df['close'].rolling(window=self.trend_window).mean()
        df['window_high'] = df['close'].rolling(window=self.trend_window).max()
        df['drawdown'] = (df['close'] - df['window_high']) / df['window_high']
        is_flash_crash = df['drawdown'] < -0.01
        
        df['iv_norm'] = self._normalize_iv(df['iv'])
        is_uptrend = df['close'] > df['sma']
        is_high_vol = df['iv_norm'] > 0.20
        
        conditions = [
            (is_flash_crash),
            (is_high_vol) & (~is_uptrend),
            (is_high_vol) & (is_uptrend),
            (~is_high_vol) & (is_uptrend),
            (~is_high_vol) & (~is_uptrend)
        ]
        choices = [
            REGIME_VOL_EXPANSION,
            REGIME_BEAR_VOLATILE,
            REGIME_VOL_EXPANSION,
            REGIME_BULL_QUIET,
            REGIME_SIDEWAYS
        ]
        df['regime'] = np.select(conditions, choices, default=REGIME_UNDEFINED)

        # Log warning if significant data dropped (but don't silently fail)
        rows_before = len(df)
        df = df.dropna()
        rows_after = len(df)
        if rows_before > 0 and (rows_before - rows_after) / rows_before > 0.1:
            import logging
            logging.warning(f"RegimeEngine dropped {rows_before - rows_after} rows ({100*(rows_before-rows_after)/rows_before:.1f}%) due to NaN values")

        return df

    def generate_api_response(self, labeled_df: pd.DataFrame) -> Dict[str, Any]:
        """
        Converts the labeled DataFrame into the 'Regime Timeline' JSON format.
        """
        timeline = []
        
        if 'regime' not in labeled_df.columns:
            return {"timeline": [], "summary": {}}
            
        # Resample to Daily for high-level view
        daily_groups = labeled_df.resample('D')
        
        regime_counts = {}
        
        for date, group in daily_groups:
            if group.empty: continue
            
            # Dominant Regime (Mode)
            dominant = group['regime'].mode()[0] if not group['regime'].mode().empty else REGIME_UNDEFINED
            
            # Update counts
            regime_counts[dominant] = regime_counts.get(dominant, 0) + 1
            
            # Metrics
            avg_iv = group['iv'].median()
            display_vix = avg_iv * 100.0 if avg_iv < 2.0 else avg_iv
            
            open_p = group['close'].iloc[0]
            close_p = group['close'].iloc[-1]
            trend_score = (close_p - open_p) / open_p
            
            # Color Mapping
            colors = {
                REGIME_BEAR_VOLATILE: "#FF4444",
                REGIME_BULL_QUIET: "#44FF44",
                REGIME_SIDEWAYS: "#888888",
                REGIME_VOL_EXPANSION: "#FFAA00"
            }
            
            timeline.append({
                "date": date.strftime('%Y-%m-%d'),
                "regime": dominant,
                "color": colors.get(dominant, "#FFFFFF"),
                "description": dominant.replace("_", " "),
                "metrics": {
                    "vix": round(display_vix, 2),
                    "trend_score": round(trend_score, 4),
                    "volume_flow": "neutral" # Placeholder until volume added
                }
            })
            
        return {
            "timeline": timeline,
            "summary": {
                "dominant_regime": max(regime_counts, key=regime_counts.get) if regime_counts else "NONE",
                "regime_distribution": regime_counts
            }
        }
