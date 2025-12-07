#!/usr/bin/env python3
"""
Multi-Timeframe Physics Engine - Full Feature Pipeline

Runs ALL physics modules at multiple timeframes (5min, 15min, 1H, 1D).
Parallelizes across both timeframes AND physics modules for maximum performance.

Key insight: Short-term signals (5min morphology, 15min flow) often predict
daily moves better than daily-only features.

Usage:
    python scripts/main_harvest_mtf_physics.py --symbol SPY --start 2020-01-01 --end 2025-12-01 \
        --cross-asset-file /Volumes/VelocityData/velocity_om/features/cross_asset_features.parquet
"""

import os
import sys
import argparse
import logging
import warnings
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from concurrent.futures import ProcessPoolExecutor, as_completed
import multiprocessing as mp

import numpy as np
import pandas as pd
import duckdb

warnings.filterwarnings('ignore', category=pd.errors.PerformanceWarning)
warnings.filterwarnings('ignore', category=FutureWarning)

sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('MTF-Physics')

DATA_LAKE = Path('/Volumes/VelocityData/velocity_om/massive')
OUTPUT_DIR = Path('/Volumes/VelocityData/velocity_om/features')


# =============================================================================
# TIMEFRAME CONFIGURATION
# =============================================================================

TIMEFRAMES = {
    '5min':  {'resample': '5min',  'bars_per_day': 78,   'physics': 'fast'},
    '15min': {'resample': '15min', 'bars_per_day': 26,   'physics': 'fast'},
    '1H':    {'resample': '1h',    'bars_per_day': 6.5,  'physics': 'medium'},
    '1D':    {'resample': '1D',    'bars_per_day': 1,    'physics': 'full'},
}

# Physics modules by complexity level
PHYSICS_FAST = ['raw', 'morphology', 'flow', 'momentum']  # For 5min, 15min
PHYSICS_MEDIUM = PHYSICS_FAST + ['entropy', 'regime']      # For 1H
PHYSICS_FULL = PHYSICS_MEDIUM + ['dynamics', 'domain', 'change_point', 'duration']  # For 1D


# =============================================================================
# DATA LOADING
# =============================================================================

def load_minute_data(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    """Load 1-minute OHLCV data."""
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
    """Resample OHLCV data."""
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


# =============================================================================
# PHYSICS MODULE RUNNERS
# =============================================================================

def run_physics_module(module: str, df: pd.DataFrame, lag: int = 1) -> pd.DataFrame:
    """Run a single physics module on DataFrame."""
    result = df.copy()

    # Ensure returns exists
    if 'returns' not in result.columns:
        result['returns'] = result['close'].pct_change()

    try:
        if module == 'raw':
            from engine.features.raw_features import RawFeatureGenerator
            raw_gen = RawFeatureGenerator()
            result = raw_gen.generate(result, include_targets=False)

        elif module == 'morphology':
            from engine.features.morphology import add_morphology_features
            result = add_morphology_features(result, returns_col='returns', window=60)

        elif module == 'entropy':
            from engine.features.entropy import add_entropy_features
            result = add_entropy_features(result, returns_col='returns', window=50, lag=lag)

        elif module == 'flow':
            from engine.features.flow import add_flow_features
            result = add_flow_features(result, price_col='close', volume_col='volume', lag=lag)

        elif module == 'dynamics':
            from engine.features.dynamics import add_dynamics_features, add_entropy_dynamics_features
            dynamics_cols = [c for c in ['morph_skewness', 'morph_kurtosis', 'returns', 'close']
                            if c in result.columns]
            if dynamics_cols:
                result = add_dynamics_features(result, columns=dynamics_cols)
            result = add_entropy_dynamics_features(result, returns_col='returns', lookback=20)

        elif module == 'regime':
            from engine.features.regime import add_regime_features
            result = add_regime_features(result, spy_col='close', lag=lag)

        elif module == 'domain':
            from engine.features.domain_features import add_domain_features
            if 'vix' in result.columns:
                result = add_domain_features(result, vix_col='vix', lag=lag)

        elif module == 'momentum':
            from engine.features.momentum_logic import add_momentum_features
            result = add_momentum_features(result, price_col='close', lag=lag)

        elif module == 'change_point':
            from engine.features.change_point import add_change_point_features
            result = add_change_point_features(result, returns_col='returns')

        elif module == 'duration':
            from engine.features.duration import add_duration_features
            regime_col = 'regime_combined' if 'regime_combined' in result.columns else None
            if regime_col:
                result = add_duration_features(result, regime_col=regime_col)

    except Exception as e:
        print(f"    [{module}] Warning: {e}")

    return result


# =============================================================================
# TIMEFRAME PROCESSOR (Parallel Worker)
# =============================================================================

def process_timeframe(args: tuple) -> Tuple[str, pd.DataFrame]:
    """
    Process a single timeframe with appropriate physics modules.
    Designed for parallel execution.
    """
    tf_name, resample_str, physics_level, minute_path, vix_path, lag = args

    # Load data
    minute_df = pd.read_parquet(minute_path)
    vix_series = pd.read_parquet(vix_path)['close']
    vix_series.index = pd.to_datetime(vix_series.index)

    print(f"  [{tf_name}] Starting...")

    # Resample
    if resample_str == '1min':
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

    # Determine which physics modules to run
    if physics_level == 'fast':
        modules = PHYSICS_FAST
    elif physics_level == 'medium':
        modules = PHYSICS_MEDIUM
    else:
        modules = PHYSICS_FULL

    # Track original columns
    original_cols = set(df.columns)
    suffix = f'_{tf_name}'

    # Run physics modules sequentially within this timeframe
    # (dependencies require sequential execution)
    for module in modules:
        df = run_physics_module(module, df, lag=lag)

    # Suffix all new columns with timeframe
    new_cols = set(df.columns) - original_cols - {'vix', 'returns'}
    rename_map = {col: f'{col}{suffix}' for col in new_cols}
    df = df.rename(columns=rename_map)

    feature_count = len([c for c in df.columns if c.endswith(suffix)])
    print(f"  [{tf_name}] Generated {feature_count} features")

    return (tf_name, df)


# =============================================================================
# CROSS-TIMEFRAME FEATURES
# =============================================================================

def compute_cross_timeframe_features(tf_data: Dict[str, pd.DataFrame]) -> pd.DataFrame:
    """
    Compute features that compare across timeframes.
    These are powerful predictors (e.g., 5min morphology diverging from 1D).
    """
    daily = tf_data['1D'].copy().set_index('timestamp')
    result = daily[['open', 'high', 'low', 'close', 'volume', 'symbol']].copy()

    tf_pairs = [('5min', '15min'), ('15min', '1H'), ('1H', '1D'), ('5min', '1D')]

    for lower_tf, higher_tf in tf_pairs:
        if lower_tf not in tf_data or higher_tf not in tf_data:
            continue

        lower_df = tf_data[lower_tf].set_index('timestamp')
        higher_df = tf_data[higher_tf].set_index('timestamp')

        # Return alignment
        lower_ret = f'ret_5_{lower_tf}'
        higher_ret = f'ret_5_{higher_tf}'

        if lower_ret in lower_df.columns and higher_ret in higher_df.columns:
            lower_daily = lower_df[lower_ret].resample('1D').last()
            higher_daily = higher_df[higher_ret].resample('1D').last()

            # Direction alignment
            alignment = (np.sign(lower_daily) == np.sign(higher_daily)).astype(int)
            result[f'tf_align_{lower_tf}_{higher_tf}'] = alignment

            # Strength (magnitude agreement)
            strength = lower_daily * higher_daily
            result[f'tf_strength_{lower_tf}_{higher_tf}'] = strength

        # Morphology divergence (short-term vs long-term skew)
        lower_skew = f'morph_skewness_{lower_tf}'
        higher_skew = f'morph_skewness_{higher_tf}'

        if lower_skew in lower_df.columns and higher_skew in higher_df.columns:
            lower_skew_daily = lower_df[lower_skew].resample('1D').last()
            higher_skew_daily = higher_df[higher_skew].resample('1D').last()
            result[f'skew_divergence_{lower_tf}_{higher_tf}'] = lower_skew_daily - higher_skew_daily

        # Flow divergence (short-term vs long-term VPIN)
        lower_vpin = f'vpin_{lower_tf}'
        higher_vpin = f'vpin_{higher_tf}'

        if lower_vpin in lower_df.columns and higher_vpin in higher_df.columns:
            lower_vpin_daily = lower_df[lower_vpin].resample('1D').last()
            higher_vpin_daily = higher_df[higher_vpin].resample('1D').last()
            result[f'vpin_divergence_{lower_tf}_{higher_tf}'] = lower_vpin_daily - higher_vpin_daily

        # Momentum alignment
        lower_mom = f'momentum_score_{lower_tf}'
        higher_mom = f'momentum_score_{higher_tf}'

        if lower_mom in lower_df.columns and higher_mom in higher_df.columns:
            lower_mom_daily = lower_df[lower_mom].resample('1D').last()
            higher_mom_daily = higher_df[higher_mom].resample('1D').last()

            mom_align = (np.sign(lower_mom_daily) == np.sign(higher_mom_daily)).astype(int)
            result[f'mom_align_{lower_tf}_{higher_tf}'] = mom_align

    # Full cascade alignment (all timeframes agree)
    align_cols = [c for c in result.columns if c.startswith('tf_align_')]
    if align_cols:
        result['tf_full_cascade'] = result[align_cols].prod(axis=1)

    return result.reset_index()


def aggregate_to_daily(tf_data: Dict[str, pd.DataFrame], cross_tf_df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate all timeframe features to daily rows."""
    result = cross_tf_df.copy().set_index('timestamp')

    for tf_name, config in TIMEFRAMES.items():
        if tf_name not in tf_data:
            continue

        tf_df = tf_data[tf_name].copy().set_index('timestamp')
        feature_cols = [c for c in tf_df.columns if c.endswith(f'_{tf_name}')]

        if not feature_cols:
            continue

        if tf_name == '1D':
            # Daily features join directly
            for col in feature_cols:
                # Skip non-numeric columns (like regime labels)
                if tf_df[col].dtype == 'object' or col.endswith('_label'):
                    continue
                result[col] = tf_df[col]
        else:
            # Intraday: resample to daily
            # Filter to numeric columns only
            numeric_cols = [c for c in feature_cols
                           if tf_df[c].dtype in ['float64', 'float32', 'int64', 'int32']
                           and not c.endswith('_label')]

            if not numeric_cols:
                continue

            # Use last value (end of day state)
            tf_daily = tf_df[numeric_cols].resample('1D').last()

            # Also capture intraday volatility/range for key metrics
            for col in numeric_cols:
                result[col] = tf_daily[col]

                # Add intraday std for morphology/flow features
                if 'morph_' in col or 'vpin' in col or 'kyle' in col:
                    std_col = col.replace(f'_{tf_name}', f'_std_{tf_name}')
                    result[std_col] = tf_df[col].resample('1D').std()

    return result.reset_index()


# =============================================================================
# MAIN PIPELINE
# =============================================================================

def run_mtf_physics_pipeline(
    symbol: str,
    start_date: str,
    end_date: str,
    cross_asset_path: Optional[str] = None,
    lag: int = 1,
    n_workers: int = 4  # One per timeframe
) -> pd.DataFrame:
    """
    Run multi-timeframe physics pipeline.
    """
    import tempfile

    logger.info(f"\n{'='*60}")
    logger.info(f"MULTI-TIMEFRAME PHYSICS ENGINE: {symbol}")
    logger.info(f"Timeframes: {list(TIMEFRAMES.keys())}")
    logger.info(f"Workers: {n_workers}")
    logger.info(f"{'='*60}")

    # 1. Load minute data
    logger.info("\nLoading 1-minute data...")
    minute_df = load_minute_data(symbol, start_date, end_date)
    logger.info(f"Loaded {len(minute_df):,} 1-minute bars")

    logger.info("Loading VIX proxy...")
    vix_series = load_vxx_data(start_date, end_date)

    # 2. Process each timeframe in parallel
    with tempfile.TemporaryDirectory() as tmpdir:
        minute_path = f"{tmpdir}/minute.parquet"
        vix_path = f"{tmpdir}/vix.parquet"

        minute_df.to_parquet(minute_path)
        vix_series.to_frame().to_parquet(vix_path)

        # Prepare tasks
        tasks = []
        for tf_name, config in TIMEFRAMES.items():
            tasks.append((
                tf_name,
                config['resample'],
                config['physics'],
                minute_path,
                vix_path,
                lag
            ))

        # Run in parallel
        logger.info(f"\nProcessing {len(tasks)} timeframes in parallel...")
        tf_data = {}

        with ProcessPoolExecutor(max_workers=n_workers) as executor:
            futures = {executor.submit(process_timeframe, task): task[0] for task in tasks}

            for future in as_completed(futures):
                tf_name = futures[future]
                try:
                    name, df = future.result()
                    tf_data[name] = df
                    logger.info(f"  ✓ {name} complete ({len(df):,} bars)")
                except Exception as e:
                    logger.error(f"  ✗ {tf_name} failed: {e}")
                    raise

    # 3. Compute cross-timeframe features
    logger.info("\nComputing cross-timeframe features...")
    cross_tf_df = compute_cross_timeframe_features(tf_data)

    # 4. Aggregate to daily
    logger.info("Aggregating to daily...")
    result_df = aggregate_to_daily(tf_data, cross_tf_df)
    result_df = result_df.dropna(subset=['close'])

    # 5. Add cross-asset features
    if cross_asset_path and Path(cross_asset_path).exists():
        logger.info("\nAdding cross-asset features...")
        cross_df = pd.read_parquet(cross_asset_path)
        cross_df.index = pd.to_datetime(cross_df.index)

        result_df = result_df.set_index('timestamp')
        cross_cols = [c for c in cross_df.columns if c not in result_df.columns]
        if cross_cols:
            result_df = result_df.join(cross_df[cross_cols], how='left')
            logger.info(f"  Added {len(cross_cols)} cross-asset features")
        result_df = result_df.reset_index()

    # 6. Summary
    exclude_cols = {'timestamp', 'symbol', 'open', 'high', 'low', 'close', 'volume', 'vix'}
    feature_cols = [c for c in result_df.columns if c not in exclude_cols]

    logger.info(f"\n{'='*60}")
    logger.info(f"MTF PHYSICS HARVEST COMPLETE")
    logger.info(f"{'='*60}")
    logger.info(f"Output: {len(result_df):,} daily rows")
    logger.info(f"Total features: {len(feature_cols)}")

    for tf in TIMEFRAMES.keys():
        tf_features = [c for c in feature_cols if f'_{tf}' in c]
        logger.info(f"  {tf}: {len(tf_features)} features")

    cross_tf_features = [c for c in feature_cols if 'tf_' in c or 'divergence' in c or 'align' in c]
    logger.info(f"  Cross-TF: {len(cross_tf_features)} features")

    cross_asset = [c for c in feature_cols if 'sector_' in c or 'spy_vix' in c]
    logger.info(f"  Cross-asset: {len(cross_asset)} features")

    return result_df


def main():
    parser = argparse.ArgumentParser(description='Multi-Timeframe Physics Engine')
    parser.add_argument('--symbol', type=str, default='SPY', help='Symbol to process')
    parser.add_argument('--start', type=str, required=True, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, required=True, help='End date (YYYY-MM-DD)')
    parser.add_argument('--lag', type=int, default=1, help='Lag for lookahead prevention')
    parser.add_argument('--workers', type=int, default=4, help='Parallel workers (default: 4, one per TF)')
    parser.add_argument('--cross-asset-file', type=str,
                        help='Pre-computed cross-asset features')
    parser.add_argument('--output', type=str, help='Override output path')

    args = parser.parse_args()

    output_path = Path(args.output) if args.output else OUTPUT_DIR / f"{args.symbol.upper()}_mtf_physics.parquet"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    result_df = run_mtf_physics_pipeline(
        symbol=args.symbol.upper(),
        start_date=args.start,
        end_date=args.end,
        cross_asset_path=args.cross_asset_file,
        lag=args.lag,
        n_workers=args.workers
    )

    result_df.to_parquet(output_path, index=False)
    logger.info(f"\nSaved to: {output_path}")
    logger.info(f"File size: {output_path.stat().st_size / 1024 / 1024:.2f} MB")


if __name__ == '__main__':
    mp.set_start_method('spawn', force=True)
    main()
