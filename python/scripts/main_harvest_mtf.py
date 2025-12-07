#!/usr/bin/env python3
"""
Multi-Timeframe Harvest - Rigorous Feature Pipeline

THE MATHEMATICAL PRINCIPLE:
===========================
1. Start with 1-minute bars (maximum information)
2. Generate features at EACH timeframe independently:
   - 5min, 15min, 1H, 1D
3. Compute cross-timeframe ALIGNMENT features:
   - Is 5min trend aligned with 1H trend?
   - Is momentum accelerating across scales?
4. Let Scout Swarm (Mutual Information) determine which timeframes matter
   - NO human judgment on "which timeframe is best"
   - Math decides

Output: Daily rows with features from ALL timeframes
        ~2000+ features → Scout Swarm filters to top 50-100

Usage:
    python scripts/main_harvest_mtf.py --symbol SPY --start 2020-01-01 --end 2025-12-01
"""

import os
import sys
import argparse
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
import duckdb

# Add engine to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from engine.features.raw_features import RawFeatureGenerator
from engine.features.regime import add_regime_features
from engine.features.domain_features import add_domain_features
from engine.features.momentum_logic import add_momentum_features

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('MTF-Harvest')

# Data lake location
DATA_LAKE = Path('/Volumes/VelocityData/velocity_om/massive')
OUTPUT_DIR = Path('/Volumes/VelocityData/velocity_om/features')

# Timeframe configuration
# Key: timeframe name, Value: (pandas resample string, bars per day, description)
TIMEFRAMES = {
    '5min':  ('5T',   78,  '5-minute bars'),
    '15min': ('15T',  26,  '15-minute bars'),
    '1H':    ('1H',   6.5, '1-hour bars'),
    '1D':    ('1D',   1,   'Daily bars'),
}

# Feature categories to generate at each timeframe
# (some features only make sense at certain scales)
TF_FEATURE_CONFIG = {
    '5min':  {'raw': True, 'momentum': True, 'regime': False, 'domain': False},
    '15min': {'raw': True, 'momentum': True, 'regime': False, 'domain': False},
    '1H':    {'raw': True, 'momentum': True, 'regime': True,  'domain': False},
    '1D':    {'raw': True, 'momentum': True, 'regime': True,  'domain': True},
}


def load_minute_data(
    symbol: str,
    start_date: str,
    end_date: str
) -> pd.DataFrame:
    """Load 1-minute OHLCV data from the data lake."""
    logger.info(f"Loading 1-minute data for {symbol} from {start_date} to {end_date}")

    con = duckdb.connect()
    query = f"""
        SELECT
            ticker as symbol,
            window_start as timestamp,
            open, high, low, close, volume
        FROM read_parquet('{DATA_LAKE}/stocks/*.parquet')
        WHERE ticker = '{symbol}'
          AND window_start >= '{start_date}'
          AND window_start <= '{end_date} 23:59:59'
        ORDER BY window_start
    """

    df = con.execute(query).df()
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    logger.info(f"Loaded {len(df):,} 1-minute bars")

    return df


def load_vxx_data(start_date: str, end_date: str) -> pd.Series:
    """Load VXX as VIX proxy."""
    con = duckdb.connect()
    query = f"""
        SELECT window_start as timestamp, close
        FROM read_parquet('{DATA_LAKE}/stocks/*.parquet')
        WHERE ticker = 'VXX'
          AND window_start >= '{start_date}'
          AND window_start <= '{end_date} 23:59:59'
        ORDER BY window_start
    """
    df = con.execute(query).df()
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    return df.set_index('timestamp')['close']


def resample_ohlcv(df: pd.DataFrame, freq: str) -> pd.DataFrame:
    """Resample OHLCV data to a different frequency."""
    df = df.copy()
    df = df.set_index('timestamp')

    agg = df.resample(freq).agg({
        'open': 'first',
        'high': 'max',
        'low': 'min',
        'close': 'last',
        'volume': 'sum',
        'symbol': 'first'
    }).dropna()

    return agg.reset_index()


def generate_features_at_timeframe(
    df: pd.DataFrame,
    timeframe: str,
    vix_series: pd.Series,
    lag: int = 1
) -> pd.DataFrame:
    """
    Generate all features at a specific timeframe.

    Features are suffixed with timeframe (e.g., ret_5_5min, momentum_score_1H)
    """
    config = TF_FEATURE_CONFIG.get(timeframe, {})
    result = df.copy()
    suffix = f'_{timeframe}'

    # Add VIX (resampled to match timeframe)
    if timeframe != '1min':
        resample_str = TIMEFRAMES[timeframe][0]
        vix_resampled = vix_series.resample(resample_str).last().ffill()
        result = result.set_index('timestamp')
        result['vix'] = vix_resampled
        result['vix'] = result['vix'].ffill()
        result = result.reset_index()
    else:
        result = result.set_index('timestamp')
        result['vix'] = vix_series
        result['vix'] = result['vix'].ffill()
        result = result.reset_index()

    original_cols = set(result.columns)

    # 1. Raw OHLCV features
    if config.get('raw', True):
        raw_gen = RawFeatureGenerator()
        result = raw_gen.generate(result, include_targets=False)

    # 2. Momentum features
    if config.get('momentum', True):
        result = add_momentum_features(result, price_col='close', lag=lag)

    # 3. Regime features (only at higher timeframes)
    if config.get('regime', False):
        result = add_regime_features(result, spy_col='close', lag=lag)

    # 4. Domain features (VIX dynamics - only at daily)
    if config.get('domain', False):
        result = add_domain_features(result, vix_col='vix', lag=lag)

    # Suffix all new columns with timeframe
    new_cols = set(result.columns) - original_cols - {'vix'}
    rename_map = {col: f'{col}{suffix}' for col in new_cols}
    result = result.rename(columns=rename_map)

    return result


def compute_cross_timeframe_alignment(
    tf_data: Dict[str, pd.DataFrame]
) -> pd.DataFrame:
    """
    Compute cross-timeframe alignment features.

    These capture whether trends/momentum are aligned across scales.
    This is where the REAL alpha often hides.
    """
    logger.info("Computing cross-timeframe alignment features...")

    # Use daily as the base timeframe for alignment
    daily = tf_data['1D'].copy().set_index('timestamp')

    # Initialize result with daily data
    result = daily[['open', 'high', 'low', 'close', 'volume', 'symbol']].copy()

    # For each pair of adjacent timeframes, compute alignment
    tf_pairs = [
        ('5min', '15min'),
        ('15min', '1H'),
        ('1H', '1D'),
    ]

    for lower_tf, higher_tf in tf_pairs:
        lower_df = tf_data[lower_tf].set_index('timestamp')
        higher_df = tf_data[higher_tf].set_index('timestamp')

        # Resample lower timeframe to daily for comparison
        # We want: "at end of day, was the 5min trend aligned with 1H trend?"

        # Get return columns
        lower_ret_col = f'ret_5_{lower_tf}'
        higher_ret_col = f'ret_5_{higher_tf}'

        if lower_ret_col in lower_df.columns and higher_ret_col in higher_df.columns:
            # Resample to daily (last value of day)
            lower_daily = lower_df[lower_ret_col].resample('1D').last()
            higher_daily = higher_df[higher_ret_col].resample('1D').last()

            # Alignment: same sign = 1, different sign = 0
            alignment = (np.sign(lower_daily) == np.sign(higher_daily)).astype(int)
            result[f'tf_align_{lower_tf}_{higher_tf}'] = alignment

            # Strength of alignment: product of returns (positive = aligned, negative = diverged)
            strength = lower_daily * higher_daily
            result[f'tf_align_strength_{lower_tf}_{higher_tf}'] = strength

        # Momentum alignment
        lower_mom_col = f'momentum_score_{lower_tf}'
        higher_mom_col = f'momentum_score_{higher_tf}'

        if lower_mom_col in lower_df.columns and higher_mom_col in higher_df.columns:
            lower_mom_daily = lower_df[lower_mom_col].resample('1D').last()
            higher_mom_daily = higher_df[higher_mom_col].resample('1D').last()

            mom_alignment = (np.sign(lower_mom_daily) == np.sign(higher_mom_daily)).astype(int)
            result[f'mom_align_{lower_tf}_{higher_tf}'] = mom_alignment

    # Full cascade alignment: are ALL timeframes aligned?
    align_cols = [c for c in result.columns if c.startswith('tf_align_') and 'strength' not in c]
    if align_cols:
        result['tf_full_cascade_align'] = result[align_cols].prod(axis=1)

    return result.reset_index()


def aggregate_features_to_daily(
    tf_data: Dict[str, pd.DataFrame],
    alignment_df: pd.DataFrame
) -> pd.DataFrame:
    """
    Aggregate all timeframe features to daily rows.

    For intraday timeframes, we take end-of-day values (what was known at market close).
    This avoids lookahead bias.
    """
    logger.info("Aggregating all timeframe features to daily...")

    # Start with daily base + alignment features
    result = alignment_df.copy()
    result = result.set_index('timestamp')

    # For each timeframe, resample features to daily
    for tf_name, (resample_str, bars_per_day, desc) in TIMEFRAMES.items():
        tf_df = tf_data[tf_name].copy()
        tf_df = tf_df.set_index('timestamp')

        # Get feature columns (those with timeframe suffix)
        feature_cols = [c for c in tf_df.columns if c.endswith(f'_{tf_name}')]

        if not feature_cols:
            continue

        logger.info(f"  {tf_name}: {len(feature_cols)} features")

        if tf_name == '1D':
            # Daily features: just join directly
            result = result.join(tf_df[feature_cols], how='left')
        else:
            # Intraday features: resample to daily (last value = end of day)
            for col in feature_cols:
                daily_values = tf_df[col].resample('1D').last()
                result[col] = daily_values

    return result.reset_index()


def run_mtf_pipeline(
    symbol: str,
    start_date: str,
    end_date: str,
    lag: int = 1
) -> pd.DataFrame:
    """
    Run the complete multi-timeframe feature pipeline.

    Returns: Daily DataFrame with features from all timeframes
    """
    logger.info(f"\n{'='*60}")
    logger.info(f"MULTI-TIMEFRAME HARVEST: {symbol}")
    logger.info(f"{'='*60}")

    # 1. Load 1-minute data
    minute_df = load_minute_data(symbol, start_date, end_date)

    # 2. Load VIX proxy
    vix_series = load_vxx_data(start_date, end_date)

    # 3. Generate features at each timeframe
    tf_data = {}

    for tf_name, (resample_str, bars_per_day, desc) in TIMEFRAMES.items():
        logger.info(f"\n--- Timeframe: {tf_name} ({desc}) ---")

        # Resample OHLCV
        if tf_name == '1min':
            resampled_df = minute_df.copy()
        else:
            resampled_df = resample_ohlcv(minute_df, resample_str)

        logger.info(f"  Resampled: {len(resampled_df):,} bars")

        # Generate features
        features_df = generate_features_at_timeframe(
            resampled_df, tf_name, vix_series, lag=lag
        )

        feature_cols = [c for c in features_df.columns if c.endswith(f'_{tf_name}')]
        logger.info(f"  Features: {len(feature_cols)} columns")

        tf_data[tf_name] = features_df

    # 4. Compute cross-timeframe alignment
    alignment_df = compute_cross_timeframe_alignment(tf_data)
    align_cols = [c for c in alignment_df.columns if 'align' in c]
    logger.info(f"\nAlignment features: {len(align_cols)} columns")

    # 5. Aggregate everything to daily
    final_df = aggregate_features_to_daily(tf_data, alignment_df)

    # 6. Drop warm-up period (need 200 days for SMA200)
    final_df = final_df.dropna(subset=['close'])

    # Count features
    exclude_cols = {'timestamp', 'symbol', 'open', 'high', 'low', 'close', 'volume'}
    feature_cols = [c for c in final_df.columns if c not in exclude_cols]

    logger.info(f"\n{'='*60}")
    logger.info(f"HARVEST COMPLETE")
    logger.info(f"{'='*60}")
    logger.info(f"Output: {len(final_df):,} daily rows")
    logger.info(f"Features: {len(feature_cols)} total")

    # Feature breakdown by timeframe
    for tf in TIMEFRAMES.keys():
        tf_features = [c for c in feature_cols if c.endswith(f'_{tf}')]
        logger.info(f"  {tf}: {len(tf_features)} features")

    align_features = [c for c in feature_cols if 'align' in c]
    logger.info(f"  Cross-TF alignment: {len(align_features)} features")

    return final_df


def main():
    parser = argparse.ArgumentParser(description='Multi-Timeframe Feature Pipeline')
    parser.add_argument('--symbol', type=str, default='SPY', help='Symbol to process')
    parser.add_argument('--start', type=str, required=True, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, required=True, help='End date (YYYY-MM-DD)')
    parser.add_argument('--lag', type=int, default=1, help='Lag for lookahead prevention')
    parser.add_argument('--output', type=str, help='Override output directory')

    args = parser.parse_args()

    output_dir = Path(args.output) if args.output else OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    # Run pipeline
    result_df = run_mtf_pipeline(
        symbol=args.symbol.upper(),
        start_date=args.start,
        end_date=args.end,
        lag=args.lag
    )

    # Save output
    output_path = output_dir / f"{args.symbol.upper()}_mtf_features.parquet"
    result_df.to_parquet(output_path, index=False)
    logger.info(f"\nSaved to: {output_path}")

    # Show sample
    logger.info(f"\nSample of features:")
    sample_cols = ['timestamp', 'close'] + [c for c in result_df.columns if 'align' in c][:5]
    print(result_df[sample_cols].tail(10))


if __name__ == '__main__':
    main()
