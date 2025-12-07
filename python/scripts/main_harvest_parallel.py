#!/usr/bin/env python3
"""
Parallel Physics Engine Harvest - Full Feature Pipeline

Optimized for M4 Pro (14 cores, 48GB RAM). Parallelizes:
1. Independent physics modules (morphology, entropy, flow) run in parallel
2. Dependent modules (dynamics, change_point) run after dependencies
3. Cross-asset features loaded from pre-computed file

Usage:
    # First run precompute_cross_asset.py once
    python scripts/main_harvest_parallel.py --symbol SPY --start 2020-01-01 --end 2025-12-01 \
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
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
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
logger = logging.getLogger('Parallel-Harvest')

DATA_LAKE = Path('/Volumes/VelocityData/velocity_om/massive')
OUTPUT_DIR = Path('/Volumes/VelocityData/velocity_om/features')


# =============================================================================
# MODULE GROUPS - Organized by dependencies
# =============================================================================

# Group 1: Independent modules (can run in parallel)
INDEPENDENT_MODULES = ['raw', 'morphology', 'entropy', 'flow']

# Group 2: Depends on raw/morphology
DEPENDENT_MODULES_1 = ['dynamics', 'regime', 'domain', 'momentum']

# Group 3: Depends on regime
DEPENDENT_MODULES_2 = ['change_point', 'duration']


# =============================================================================
# DATA LOADING
# =============================================================================

def load_stock_data(symbols: list, start_date: str, end_date: str) -> pd.DataFrame:
    """Load daily OHLCV data using DuckDB."""
    logger.info(f"Loading {len(symbols)} symbols from {start_date} to {end_date}")

    con = duckdb.connect()
    symbols_str = "', '".join(symbols)

    query = f"""
        SELECT
            ticker as symbol,
            window_start as timestamp,
            open, high, low, close, volume
        FROM read_parquet('{DATA_LAKE}/stocks/*.parquet')
        WHERE ticker IN ('{symbols_str}')
          AND window_start >= '{start_date}'
          AND window_start <= '{end_date} 23:59:59'
        ORDER BY ticker, window_start
    """

    df = con.execute(query).df()
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    logger.info(f"Loaded {len(df):,} rows")

    # Resample to daily
    resampled = []
    for symbol in df['symbol'].unique():
        symbol_df = df[df['symbol'] == symbol].copy()
        symbol_df = symbol_df.set_index('timestamp')

        agg = symbol_df.resample('1D').agg({
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last',
            'volume': 'sum'
        }).dropna()

        agg['symbol'] = symbol
        resampled.append(agg)

    result = pd.concat(resampled)
    logger.info(f"Resampled to {len(result):,} daily bars")
    return result.reset_index()


# =============================================================================
# PARALLEL FEATURE COMPUTATION
# =============================================================================

def compute_raw_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compute raw OHLCV features."""
    from engine.features.raw_features import RawFeatureGenerator
    raw_gen = RawFeatureGenerator()
    return raw_gen.generate(df.copy(), include_targets=False)


def compute_morphology_features(df: pd.DataFrame, returns_col: str = 'returns') -> pd.DataFrame:
    """Compute morphology features."""
    from engine.features.morphology import add_morphology_features
    result = df.copy()
    if returns_col not in result.columns:
        result['returns'] = result['close'].pct_change()
    return add_morphology_features(result, returns_col=returns_col, window=60)


def compute_entropy_features(df: pd.DataFrame, returns_col: str = 'returns', lag: int = 1) -> pd.DataFrame:
    """Compute entropy features."""
    from engine.features.entropy import add_entropy_features
    result = df.copy()
    if returns_col not in result.columns:
        result['returns'] = result['close'].pct_change()
    return add_entropy_features(result, returns_col=returns_col, window=50, lag=lag)


def compute_flow_features(df: pd.DataFrame, lag: int = 1) -> pd.DataFrame:
    """Compute flow features (VPIN, Kyle's Lambda)."""
    from engine.features.flow import add_flow_features
    return add_flow_features(df.copy(), price_col='close', volume_col='volume', lag=lag)


def compute_dynamics_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compute dynamics features (velocity, acceleration)."""
    from engine.features.dynamics import add_dynamics_features, add_entropy_dynamics_features
    result = df.copy()

    # Determine which columns to compute dynamics on
    dynamics_cols = [c for c in ['morph_skewness', 'morph_kurtosis', 'returns', 'close']
                     if c in result.columns]
    if dynamics_cols:
        result = add_dynamics_features(result, columns=dynamics_cols)

    # Also add entropy dynamics
    if 'returns' in result.columns:
        result = add_entropy_dynamics_features(result, returns_col='returns', lookback=20)

    return result


def compute_regime_features(df: pd.DataFrame, lag: int = 1) -> pd.DataFrame:
    """Compute regime features."""
    from engine.features.regime import add_regime_features
    return add_regime_features(df.copy(), spy_col='close', lag=lag)


def compute_domain_features(df: pd.DataFrame, lag: int = 1) -> pd.DataFrame:
    """Compute domain features (VIX dynamics)."""
    from engine.features.domain_features import add_domain_features
    if 'vix' not in df.columns:
        return df
    return add_domain_features(df.copy(), vix_col='vix', lag=lag)


def compute_momentum_features(df: pd.DataFrame, lag: int = 1) -> pd.DataFrame:
    """Compute momentum features."""
    from engine.features.momentum_logic import add_momentum_features
    return add_momentum_features(df.copy(), price_col='close', lag=lag)


def compute_change_point_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compute change point detection features."""
    from engine.features.change_point import add_change_point_features
    result = df.copy()
    if 'returns' not in result.columns:
        result['returns'] = result['close'].pct_change()
    return add_change_point_features(result, returns_col='returns')


def compute_duration_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compute duration features."""
    from engine.features.duration import add_duration_features
    result = df.copy()
    regime_col = 'regime_combined' if 'regime_combined' in result.columns else None
    if regime_col:
        return add_duration_features(result, regime_col=regime_col)
    return result


# =============================================================================
# PARALLEL EXECUTION ENGINE
# =============================================================================

def run_module_parallel(module_name: str, df_path: str, lag: int) -> Tuple[str, pd.DataFrame]:
    """Run a single module - designed for parallel execution."""
    df = pd.read_parquet(df_path)

    try:
        if module_name == 'raw':
            result = compute_raw_features(df)
        elif module_name == 'morphology':
            result = compute_morphology_features(df)
        elif module_name == 'entropy':
            result = compute_entropy_features(df, lag=lag)
        elif module_name == 'flow':
            result = compute_flow_features(df, lag=lag)
        elif module_name == 'dynamics':
            result = compute_dynamics_features(df)
        elif module_name == 'regime':
            result = compute_regime_features(df, lag=lag)
        elif module_name == 'domain':
            result = compute_domain_features(df, lag=lag)
        elif module_name == 'momentum':
            result = compute_momentum_features(df, lag=lag)
        elif module_name == 'change_point':
            result = compute_change_point_features(df)
        elif module_name == 'duration':
            result = compute_duration_features(df)
        else:
            result = df

        return (module_name, result)
    except Exception as e:
        print(f"  [{module_name}] FAILED: {e}")
        return (module_name, df)


def merge_features(base_df: pd.DataFrame, feature_dfs: Dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Merge features from multiple module runs into base DataFrame."""
    result = base_df.copy()
    base_cols = set(result.columns)

    for module_name, feat_df in feature_dfs.items():
        # Get new columns added by this module
        new_cols = [c for c in feat_df.columns if c not in base_cols]
        if new_cols:
            # Align by index
            for col in new_cols:
                if col in feat_df.columns:
                    result[col] = feat_df[col].values

    return result


def run_parallel_harvest(
    symbol: str,
    start_date: str,
    end_date: str,
    cross_asset_path: Optional[str] = None,
    lag: int = 1,
    n_workers: int = 10
) -> pd.DataFrame:
    """
    Run the full physics pipeline with parallel module execution.
    """
    import tempfile

    logger.info(f"\n{'='*60}")
    logger.info(f"PARALLEL PHYSICS HARVEST: {symbol}")
    logger.info(f"Using {n_workers} parallel workers")
    logger.info(f"{'='*60}")

    # 1. Load data
    symbols_needed = [symbol, 'VXX']
    raw_df = load_stock_data(symbols_needed, start_date, end_date)

    # Extract symbol data
    symbol_df = raw_df[raw_df['symbol'] == symbol].copy()
    vxx_df = raw_df[raw_df['symbol'] == 'VXX'][['timestamp', 'close']].copy()
    vxx_df = vxx_df.set_index('timestamp')['close']

    # Add VIX to symbol data
    symbol_df = symbol_df.set_index('timestamp')
    symbol_df['vix'] = vxx_df
    symbol_df['vix'] = symbol_df['vix'].ffill()
    symbol_df = symbol_df.reset_index()

    # Ensure returns column exists for later modules
    symbol_df['returns'] = symbol_df['close'].pct_change()

    logger.info(f"Prepared {len(symbol_df):,} rows for {symbol}")

    with tempfile.TemporaryDirectory() as tmpdir:
        # =================================================================
        # PHASE 1: Independent modules (parallel)
        # =================================================================
        logger.info(f"\n--- Phase 1: Independent modules ({len(INDEPENDENT_MODULES)}) ---")

        # Save base data
        base_path = f"{tmpdir}/base.parquet"
        symbol_df.to_parquet(base_path)

        phase1_results = {}
        with ProcessPoolExecutor(max_workers=min(n_workers, len(INDEPENDENT_MODULES))) as executor:
            futures = {
                executor.submit(run_module_parallel, mod, base_path, lag): mod
                for mod in INDEPENDENT_MODULES
            }

            for future in as_completed(futures):
                mod_name = futures[future]
                try:
                    name, result_df = future.result()
                    phase1_results[name] = result_df
                    new_cols = len(result_df.columns) - len(symbol_df.columns)
                    logger.info(f"  ✓ {name}: +{new_cols} features")
                except Exception as e:
                    logger.error(f"  ✗ {mod_name}: {e}")

        # Merge phase 1 results
        result_df = merge_features(symbol_df, phase1_results)
        logger.info(f"Phase 1 complete: {len(result_df.columns)} columns")

        # =================================================================
        # PHASE 2: Dependent modules (parallel, depends on phase 1)
        # =================================================================
        logger.info(f"\n--- Phase 2: Dependent modules ({len(DEPENDENT_MODULES_1)}) ---")

        phase2_path = f"{tmpdir}/phase2.parquet"
        result_df.to_parquet(phase2_path)

        phase2_results = {}
        with ProcessPoolExecutor(max_workers=min(n_workers, len(DEPENDENT_MODULES_1))) as executor:
            futures = {
                executor.submit(run_module_parallel, mod, phase2_path, lag): mod
                for mod in DEPENDENT_MODULES_1
            }

            for future in as_completed(futures):
                mod_name = futures[future]
                try:
                    name, feat_df = future.result()
                    phase2_results[name] = feat_df
                    new_cols = len(feat_df.columns) - len(result_df.columns)
                    logger.info(f"  ✓ {name}: +{new_cols} features")
                except Exception as e:
                    logger.error(f"  ✗ {mod_name}: {e}")

        # Merge phase 2 results
        result_df = merge_features(result_df, phase2_results)
        logger.info(f"Phase 2 complete: {len(result_df.columns)} columns")

        # =================================================================
        # PHASE 3: Final dependent modules (parallel)
        # =================================================================
        logger.info(f"\n--- Phase 3: Final modules ({len(DEPENDENT_MODULES_2)}) ---")

        phase3_path = f"{tmpdir}/phase3.parquet"
        result_df.to_parquet(phase3_path)

        phase3_results = {}
        with ProcessPoolExecutor(max_workers=min(n_workers, len(DEPENDENT_MODULES_2))) as executor:
            futures = {
                executor.submit(run_module_parallel, mod, phase3_path, lag): mod
                for mod in DEPENDENT_MODULES_2
            }

            for future in as_completed(futures):
                mod_name = futures[future]
                try:
                    name, feat_df = future.result()
                    phase3_results[name] = feat_df
                    new_cols = len(feat_df.columns) - len(result_df.columns)
                    logger.info(f"  ✓ {name}: +{new_cols} features")
                except Exception as e:
                    logger.error(f"  ✗ {mod_name}: {e}")

        # Merge phase 3 results
        result_df = merge_features(result_df, phase3_results)
        logger.info(f"Phase 3 complete: {len(result_df.columns)} columns")

    # =================================================================
    # PHASE 4: Cross-asset features (pre-computed)
    # =================================================================
    if cross_asset_path and Path(cross_asset_path).exists():
        logger.info(f"\n--- Phase 4: Cross-asset features ---")
        cross_df = pd.read_parquet(cross_asset_path)
        cross_df.index = pd.to_datetime(cross_df.index)

        result_df = result_df.set_index('timestamp')

        # Join cross-asset features
        cross_cols = [c for c in cross_df.columns if c not in result_df.columns]
        if cross_cols:
            result_df = result_df.join(cross_df[cross_cols], how='left')
            logger.info(f"  Added {len(cross_cols)} cross-asset features")

        result_df = result_df.reset_index()

    # =================================================================
    # SUMMARY
    # =================================================================
    exclude_cols = {'timestamp', 'symbol', 'open', 'high', 'low', 'close', 'volume', 'vix'}
    feature_cols = [c for c in result_df.columns if c not in exclude_cols]

    logger.info(f"\n{'='*60}")
    logger.info(f"HARVEST COMPLETE")
    logger.info(f"{'='*60}")
    logger.info(f"Output: {len(result_df):,} rows × {len(result_df.columns)} columns")
    logger.info(f"Features: {len(feature_cols)}")

    # Feature breakdown
    morph = len([c for c in feature_cols if 'morph' in c.lower()])
    entropy = len([c for c in feature_cols if 'entropy' in c.lower() or 'shannon' in c.lower()])
    flow = len([c for c in feature_cols if 'flow' in c.lower() or 'vpin' in c.lower() or 'kyle' in c.lower()])
    dynamics = len([c for c in feature_cols if 'dyn' in c.lower() or 'velocity' in c.lower() or 'accel' in c.lower()])
    regime = len([c for c in feature_cols if 'regime' in c.lower()])
    cross = len([c for c in feature_cols if 'sector_' in c.lower() or 'spy_vix' in c.lower()])

    logger.info(f"  Morphology: {morph}")
    logger.info(f"  Entropy: {entropy}")
    logger.info(f"  Flow: {flow}")
    logger.info(f"  Dynamics: {dynamics}")
    logger.info(f"  Regime: {regime}")
    logger.info(f"  Cross-asset: {cross}")

    return result_df


def main():
    parser = argparse.ArgumentParser(description='Parallel Physics Engine Harvest')
    parser.add_argument('--symbol', type=str, default='SPY', help='Symbol to process')
    parser.add_argument('--start', type=str, required=True, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, required=True, help='End date (YYYY-MM-DD)')
    parser.add_argument('--lag', type=int, default=1, help='Lag for lookahead prevention')
    parser.add_argument('--workers', type=int, default=10, help='Number of parallel workers')
    parser.add_argument('--cross-asset-file', type=str,
                        help='Pre-computed cross-asset features file')
    parser.add_argument('--output', type=str, help='Override output path')

    args = parser.parse_args()

    output_path = Path(args.output) if args.output else OUTPUT_DIR / f"{args.symbol.upper()}_master_features.parquet"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Run parallel pipeline
    result_df = run_parallel_harvest(
        symbol=args.symbol.upper(),
        start_date=args.start,
        end_date=args.end,
        cross_asset_path=args.cross_asset_file,
        lag=args.lag,
        n_workers=args.workers
    )

    # Save output
    result_df.to_parquet(output_path, index=False)
    logger.info(f"\nSaved to: {output_path}")
    logger.info(f"File size: {output_path.stat().st_size / 1024:.1f} KB")


if __name__ == '__main__':
    mp.set_start_method('spawn', force=True)
    main()
