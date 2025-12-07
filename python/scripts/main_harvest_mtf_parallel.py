#!/usr/bin/env python3
"""
Parallel Multi-Timeframe Harvest - Optimized for M4 Pro (14 cores, 48GB RAM)

Parallelizes feature generation across timeframes using multiprocessing.
Each timeframe runs on its own core simultaneously.

Usage:
    python scripts/main_harvest_mtf_parallel.py --symbol SPY --start 2020-01-01 --end 2025-12-01
"""

import os
import sys
import argparse
import logging
import warnings
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple
from concurrent.futures import ProcessPoolExecutor, as_completed
import multiprocessing as mp

import numpy as np
import pandas as pd
import duckdb

# Suppress performance warnings (we know about fragmentation, will optimize later)
warnings.filterwarnings('ignore', category=pd.errors.PerformanceWarning)

# Add engine to path
sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('MTF-Parallel')

# Data lake location
DATA_LAKE = Path('/Volumes/VelocityData/velocity_om/massive')
OUTPUT_DIR = Path('/Volumes/VelocityData/velocity_om/features')

# Timeframe configuration
TIMEFRAMES = {
    '5min':  ('5min',  78,   'raw,momentum'),
    '15min': ('15min', 26,   'raw,momentum'),
    '1H':    ('1h',    6.5,  'raw,momentum,regime'),
    '1D':    ('1D',    1,    'raw,momentum,regime,domain'),
}


def load_minute_data(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    """Load 1-minute OHLCV data from the data lake."""
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


def process_timeframe(args: tuple) -> tuple:
    """
    Process a single timeframe - designed for parallel execution.

    Returns: (timeframe_name, features_df)
    """
    tf_name, resample_str, feature_types, minute_df_path, vix_path, lag = args

    # Import here to avoid pickling issues
    from engine.features.raw_features import RawFeatureGenerator
    from engine.features.regime import add_regime_features
    from engine.features.domain_features import add_domain_features
    from engine.features.momentum_logic import add_momentum_features

    # Load data from temp files (avoids pickling large DataFrames)
    minute_df = pd.read_parquet(minute_df_path)
    vix_series = pd.read_parquet(vix_path)['close']
    vix_series.index = pd.to_datetime(vix_series.index)

    print(f"  [{tf_name}] Starting feature generation...")

    # Resample OHLCV
    if tf_name == '1min':
        df = minute_df.copy()
    else:
        df = resample_ohlcv(minute_df, resample_str)

    print(f"  [{tf_name}] Resampled to {len(df):,} bars")

    # Add VIX
    vix_resampled = vix_series.resample(resample_str).last().ffill()
    df = df.set_index('timestamp')
    df['vix'] = vix_resampled
    df['vix'] = df['vix'].ffill()
    df = df.reset_index()

    suffix = f'_{tf_name}'
    original_cols = set(df.columns)
    feature_list = feature_types.split(',')

    # Generate features based on config
    if 'raw' in feature_list:
        raw_gen = RawFeatureGenerator()
        df = raw_gen.generate(df, include_targets=False)

    if 'momentum' in feature_list:
        df = add_momentum_features(df, price_col='close', lag=lag)

    if 'regime' in feature_list:
        df = add_regime_features(df, spy_col='close', lag=lag)

    if 'domain' in feature_list:
        df = add_domain_features(df, vix_col='vix', lag=lag)

    # Suffix all new columns
    new_cols = set(df.columns) - original_cols - {'vix'}
    rename_map = {col: f'{col}{suffix}' for col in new_cols}
    df = df.rename(columns=rename_map)

    feature_count = len([c for c in df.columns if c.endswith(suffix)])
    print(f"  [{tf_name}] Generated {feature_count} features")

    return (tf_name, df)


def compute_cross_timeframe_alignment(tf_data: Dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Compute cross-timeframe alignment features."""
    daily = tf_data['1D'].copy().set_index('timestamp')
    result = daily[['open', 'high', 'low', 'close', 'volume', 'symbol']].copy()

    tf_pairs = [('5min', '15min'), ('15min', '1H'), ('1H', '1D')]

    for lower_tf, higher_tf in tf_pairs:
        lower_df = tf_data[lower_tf].set_index('timestamp')
        higher_df = tf_data[higher_tf].set_index('timestamp')

        # Return alignment
        lower_ret_col = f'ret_5_{lower_tf}'
        higher_ret_col = f'ret_5_{higher_tf}'

        if lower_ret_col in lower_df.columns and higher_ret_col in higher_df.columns:
            lower_daily = lower_df[lower_ret_col].resample('1D').last()
            higher_daily = higher_df[higher_ret_col].resample('1D').last()

            alignment = (np.sign(lower_daily) == np.sign(higher_daily)).astype(int)
            result[f'tf_align_{lower_tf}_{higher_tf}'] = alignment

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

    # Full cascade alignment
    align_cols = [c for c in result.columns if c.startswith('tf_align_') and 'strength' not in c]
    if align_cols:
        result['tf_full_cascade_align'] = result[align_cols].prod(axis=1)

    return result.reset_index()


def aggregate_features_to_daily(tf_data: Dict[str, pd.DataFrame], alignment_df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate all timeframe features to daily rows."""
    result = alignment_df.copy().set_index('timestamp')

    for tf_name, (resample_str, bars_per_day, _) in TIMEFRAMES.items():
        tf_df = tf_data[tf_name].copy().set_index('timestamp')
        feature_cols = [c for c in tf_df.columns if c.endswith(f'_{tf_name}')]

        if not feature_cols:
            continue

        if tf_name == '1D':
            # Daily features join directly
            for col in feature_cols:
                result[col] = tf_df[col]
        else:
            # Intraday: resample to daily (end of day value)
            tf_daily = tf_df[feature_cols].resample('1D').last()
            for col in feature_cols:
                result[col] = tf_daily[col]

    return result.reset_index()


def run_parallel_mtf_pipeline(
    symbol: str,
    start_date: str,
    end_date: str,
    lag: int = 1,
    n_workers: int = 12  # M4 Pro: use 12 of 14 cores (leave 2 for OS)
) -> pd.DataFrame:
    """
    Run the multi-timeframe pipeline with parallel feature generation.
    """
    import tempfile

    logger.info(f"\n{'='*60}")
    logger.info(f"PARALLEL MULTI-TIMEFRAME HARVEST: {symbol}")
    logger.info(f"Using {n_workers} parallel workers")
    logger.info(f"{'='*60}")

    # 1. Load data once
    logger.info("Loading 1-minute data...")
    minute_df = load_minute_data(symbol, start_date, end_date)
    logger.info(f"Loaded {len(minute_df):,} 1-minute bars")

    logger.info("Loading VIX proxy...")
    vix_series = load_vxx_data(start_date, end_date)

    # 2. Save to temp files for multiprocessing (avoids pickling large DataFrames)
    with tempfile.TemporaryDirectory() as tmpdir:
        minute_path = f"{tmpdir}/minute.parquet"
        vix_path = f"{tmpdir}/vix.parquet"

        minute_df.to_parquet(minute_path)
        vix_series.to_frame().to_parquet(vix_path)

        # 3. Prepare tasks for parallel execution
        tasks = []
        for tf_name, (resample_str, bars_per_day, feature_types) in TIMEFRAMES.items():
            tasks.append((tf_name, resample_str, feature_types, minute_path, vix_path, lag))

        # 4. Run in parallel
        logger.info(f"\nProcessing {len(tasks)} timeframes in parallel...")
        tf_data = {}

        with ProcessPoolExecutor(max_workers=n_workers) as executor:
            futures = {executor.submit(process_timeframe, task): task[0] for task in tasks}

            for future in as_completed(futures):
                tf_name = futures[future]
                try:
                    name, df = future.result()
                    tf_data[name] = df
                    logger.info(f"  ✓ {name} complete")
                except Exception as e:
                    logger.error(f"  ✗ {tf_name} failed: {e}")
                    raise

    # 5. Compute cross-timeframe alignment
    logger.info("\nComputing cross-timeframe alignment...")
    alignment_df = compute_cross_timeframe_alignment(tf_data)

    # 6. Aggregate to daily
    logger.info("Aggregating all features to daily...")
    final_df = aggregate_features_to_daily(tf_data, alignment_df)
    final_df = final_df.dropna(subset=['close'])

    # 7. Report
    exclude_cols = {'timestamp', 'symbol', 'open', 'high', 'low', 'close', 'volume'}
    feature_cols = [c for c in final_df.columns if c not in exclude_cols]

    logger.info(f"\n{'='*60}")
    logger.info(f"HARVEST COMPLETE")
    logger.info(f"{'='*60}")
    logger.info(f"Output: {len(final_df):,} daily rows")
    logger.info(f"Features: {len(feature_cols)} total")

    for tf in TIMEFRAMES.keys():
        tf_features = [c for c in feature_cols if c.endswith(f'_{tf}')]
        logger.info(f"  {tf}: {len(tf_features)} features")

    align_features = [c for c in feature_cols if 'align' in c]
    logger.info(f"  Cross-TF alignment: {len(align_features)} features")

    return final_df


def main():
    parser = argparse.ArgumentParser(description='Parallel Multi-Timeframe Feature Pipeline')
    parser.add_argument('--symbol', type=str, default='SPY', help='Symbol to process')
    parser.add_argument('--start', type=str, required=True, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, required=True, help='End date (YYYY-MM-DD)')
    parser.add_argument('--lag', type=int, default=1, help='Lag for lookahead prevention')
    parser.add_argument('--workers', type=int, default=12, help='Number of parallel workers (default 12 for M4 Pro)')
    parser.add_argument('--output', type=str, help='Override output directory')

    args = parser.parse_args()

    output_dir = Path(args.output) if args.output else OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    # Run parallel pipeline
    result_df = run_parallel_mtf_pipeline(
        symbol=args.symbol.upper(),
        start_date=args.start,
        end_date=args.end,
        lag=args.lag,
        n_workers=args.workers
    )

    # Save output to symbol-specific directory
    symbol_dir = output_dir / args.symbol.upper()
    symbol_dir.mkdir(parents=True, exist_ok=True)
    output_path = symbol_dir / "mtf_features.parquet"
    result_df.to_parquet(output_path, index=False)
    logger.info(f"\nSaved to: {output_path}")


if __name__ == '__main__':
    # Required for multiprocessing on macOS
    mp.set_start_method('spawn', force=True)
    main()
