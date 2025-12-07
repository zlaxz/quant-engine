#!/usr/bin/env python3
"""
Main Harvest Script - Feature Pipeline Orchestrator

Loads data from the data lake and runs all feature engines to produce
a unified master_features.parquet file.

Usage:
    python scripts/main_harvest.py --symbol SPY --start 2024-01-01 --end 2024-12-31
    python scripts/main_harvest.py --all-symbols --start 2020-01-01 --end 2025-12-01

Output:
    /Volumes/VelocityData/velocity_om/features/{symbol}_master_features.parquet
"""

import os
import sys
import argparse
import logging
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import duckdb

# Add engine to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from engine.features.raw_features import RawFeatureGenerator
from engine.features.regime import add_regime_features
from engine.features.domain_features import add_domain_features
from engine.features.momentum_logic import add_momentum_features
from engine.features.cross_asset import add_cross_asset_features
from engine.features.sector_regime import add_sector_regime_features

# Physics Engine Modules (Layer 1-3, 6)
from engine.features.morphology import add_morphology_features
from engine.features.dynamics import add_dynamics_features, add_entropy_dynamics_features
from engine.features.flow import add_flow_features
from engine.features.entropy import add_entropy_features
from engine.features.correlation import add_correlation_features
from engine.features.change_point import add_change_point_features
from engine.features.duration import add_duration_features

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('Harvest')

# Data lake location
DATA_LAKE = Path('/Volumes/VelocityData/velocity_om/massive')
OUTPUT_DIR = Path('/Volumes/VelocityData/velocity_om/features')

# Liquid 16 universe
LIQUID_16 = [
    'SPY', 'QQQ', 'IWM', 'DIA',  # Index ETFs
    'GLD', 'SLV',                 # Precious metals
    'TLT', 'LQD', 'HYG',          # Bonds
    'USO',                        # Commodities
    'VXX',                        # Volatility
    'XLF', 'XLK', 'XLE',          # Sectors
    'EEM', 'EFA'                  # International
]

# Sector mapping for sector features
SECTOR_ETFS = ['XLF', 'XLK', 'XLE']


def load_stock_data(
    symbols: list,
    start_date: str,
    end_date: str,
    resample: str = '1D'
) -> pd.DataFrame:
    """
    Load stock OHLCV data from the data lake.

    Args:
        symbols: List of symbols to load
        start_date: Start date (YYYY-MM-DD)
        end_date: End date (YYYY-MM-DD)
        resample: Resample frequency ('1min', '5min', '1H', '1D')

    Returns:
        DataFrame with OHLCV data for all symbols
    """
    logger.info(f"Loading {len(symbols)} symbols from {start_date} to {end_date}")

    con = duckdb.connect()

    # Build query for all symbols
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
    logger.info(f"Loaded {len(df):,} rows")

    if resample != '1min':
        df = resample_ohlcv(df, resample)
        logger.info(f"Resampled to {resample}: {len(df):,} rows")

    return df


def resample_ohlcv(df: pd.DataFrame, freq: str) -> pd.DataFrame:
    """Resample OHLCV data to a different frequency."""
    df = df.copy()
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.set_index('timestamp')

    resampled = []
    for symbol in df['symbol'].unique():
        symbol_df = df[df['symbol'] == symbol].drop(columns=['symbol'])

        agg = symbol_df.resample(freq).agg({
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last',
            'volume': 'sum'
        }).dropna()

        agg['symbol'] = symbol
        resampled.append(agg.reset_index())

    return pd.concat(resampled, ignore_index=True)


def pivot_to_wide(df: pd.DataFrame, value_col: str = 'close') -> pd.DataFrame:
    """Pivot long-form data to wide format (one column per symbol)."""
    return df.pivot(
        index='timestamp',
        columns='symbol',
        values=value_col
    )


def prepare_single_symbol(
    df: pd.DataFrame,
    symbol: str,
    vix_proxy: pd.Series
) -> pd.DataFrame:
    """
    Prepare single-symbol DataFrame with all required columns.

    Args:
        df: Raw OHLCV data for one symbol
        symbol: Symbol name
        vix_proxy: VXX close prices as VIX proxy

    Returns:
        DataFrame ready for feature generation
    """
    result = df.copy()
    result = result.set_index('timestamp').sort_index()

    # Add VIX proxy (VXX close)
    result['vix'] = vix_proxy

    # Forward-fill VIX for any gaps
    result['vix'] = result['vix'].ffill()

    return result.reset_index()


def run_feature_pipeline(
    df: pd.DataFrame,
    symbol: str,
    cross_asset_df: pd.DataFrame,
    lag: int = 1
) -> pd.DataFrame:
    """
    Run the complete feature pipeline on a single symbol.

    Pipeline Order (Market Physics Engine Layers):
        Layer 0: Raw OHLCV + returns
        Layer 1: Morphology (skewness, kurtosis, shape classification)
        Layer 2: Dynamics (velocity, acceleration, entropy dynamics)
        Layer 3: Forces (flow, regime, domain, momentum)
        Layer 6: Regime prediction (change point, duration)

    Args:
        df: OHLCV data for the symbol (with VIX)
        symbol: Symbol name
        cross_asset_df: Wide-format DataFrame with cross-asset features already computed
        lag: Lag period for lookahead bias prevention

    Returns:
        DataFrame with all features added
    """
    result = df.copy()

    # =========================================================================
    # LAYER 0: Raw OHLCV features (creates 'returns' column needed by others)
    # =========================================================================
    logger.info(f"  [{symbol}] Layer 0: Raw OHLCV features...")
    raw_gen = RawFeatureGenerator()
    result = raw_gen.generate(result, include_targets=False)

    # Ensure returns column exists
    if 'returns' not in result.columns and 'ret_1' in result.columns:
        result['returns'] = result['ret_1']
    elif 'returns' not in result.columns:
        result['returns'] = result['close'].pct_change()

    # =========================================================================
    # LAYER 1: Algorithmic Morphology (distribution shapes)
    # =========================================================================
    logger.info(f"  [{symbol}] Layer 1: Morphology features...")
    try:
        result = add_morphology_features(result, returns_col='returns', window=60)
    except Exception as e:
        logger.warning(f"  [{symbol}] Morphology failed: {e}")

    # =========================================================================
    # LAYER 2: Dynamics (velocity, acceleration, entropy)
    # =========================================================================
    logger.info(f"  [{symbol}] Layer 2: Entropy features...")
    try:
        result = add_entropy_features(result, returns_col='returns', window=50, lag=lag)
    except Exception as e:
        logger.warning(f"  [{symbol}] Entropy failed: {e}")

    logger.info(f"  [{symbol}] Layer 2: Dynamics features...")
    try:
        # Compute dynamics on morphology columns if they exist
        dynamics_cols = [c for c in ['morph_skewness', 'morph_kurtosis', 'returns', 'close']
                        if c in result.columns]
        if dynamics_cols:
            result = add_dynamics_features(result, columns=dynamics_cols)
    except Exception as e:
        logger.warning(f"  [{symbol}] Dynamics failed: {e}")

    logger.info(f"  [{symbol}] Layer 2: Entropy dynamics...")
    try:
        result = add_entropy_dynamics_features(result, returns_col='returns', lookback=20)
    except Exception as e:
        logger.warning(f"  [{symbol}] Entropy dynamics failed: {e}")

    # =========================================================================
    # LAYER 3: Force Calculation (flow, regime, domain, momentum)
    # =========================================================================
    logger.info(f"  [{symbol}] Layer 3: Flow features (VPIN, Kyle's Lambda)...")
    try:
        result = add_flow_features(result, price_col='close', volume_col='volume', lag=lag)
    except Exception as e:
        logger.warning(f"  [{symbol}] Flow failed: {e}")

    logger.info(f"  [{symbol}] Layer 3: Regime features...")
    result = add_regime_features(result, spy_col='close', lag=lag)

    logger.info(f"  [{symbol}] Layer 3: Domain features (VIX dynamics)...")
    result = add_domain_features(result, vix_col='vix', lag=lag)

    logger.info(f"  [{symbol}] Layer 3: Momentum features...")
    result = add_momentum_features(result, price_col='close', lag=lag)

    # =========================================================================
    # LAYER 6: Regime Prediction (change point, duration)
    # =========================================================================
    logger.info(f"  [{symbol}] Layer 6: Change point detection...")
    try:
        result = add_change_point_features(result, returns_col='returns')
    except Exception as e:
        logger.warning(f"  [{symbol}] Change point failed: {e}")

    logger.info(f"  [{symbol}] Layer 6: Duration features...")
    try:
        # Duration needs a regime column
        regime_col = 'regime_combined' if 'regime_combined' in result.columns else None
        if regime_col:
            result = add_duration_features(result, regime_col=regime_col)
    except Exception as e:
        logger.warning(f"  [{symbol}] Duration failed: {e}")

    # =========================================================================
    # Merge cross-asset features (already computed on wide-format data)
    # =========================================================================
    if cross_asset_df is not None:
        logger.info(f"  [{symbol}] Merging cross-asset features...")
        result = result.set_index('timestamp')
        # Cross-asset features are shared across all symbols
        # Exclude: symbol columns, vix (already in per-symbol df), and any columns already in result
        exclude_cols = set([s.lower() for s in LIQUID_16] + ['vxx', 'vix'] + list(result.columns))
        cross_cols = [c for c in cross_asset_df.columns if c not in exclude_cols]
        if cross_cols:
            result = result.join(cross_asset_df[cross_cols], how='left')
        result = result.reset_index()

    return result


def compute_cross_asset_features(wide_df: pd.DataFrame, lag: int = 1) -> pd.DataFrame:
    """
    Compute cross-asset features on wide-format data.

    These features capture relationships between assets (ratios, correlations, etc.)
    and are shared across all symbols.

    Args:
        wide_df: Wide-format DataFrame (timestamp index, symbols as columns)
        lag: Lag period for lookahead bias prevention

    Returns:
        DataFrame with cross-asset features (timestamp index)
    """
    logger.info("Computing cross-asset features on wide-format data...")

    # Rename columns to lowercase for cross_asset module compatibility
    df = wide_df.copy()
    df.columns = df.columns.str.lower()

    # Add cross-asset features
    result = add_cross_asset_features(df, lag=lag)

    # Add correlation features (absorption ratio, eigenvalue entropy, etc.)
    logger.info("Computing correlation features (Layer 3)...")
    try:
        # Need returns for correlation analysis - create return columns
        asset_cols = [c for c in ['spy', 'qqq', 'iwm', 'tlt', 'gld', 'xlf', 'xlk', 'xle']
                      if c in df.columns]
        if len(asset_cols) >= 3:
            # Add returns columns with _ret suffix
            for col in asset_cols:
                result[f'{col}_ret'] = df[col].pct_change()
            returns_cols = [f'{col}_ret' for col in asset_cols]
            result = add_correlation_features(result, returns_cols=returns_cols, window=60, lag=lag)
            # Drop the temporary return columns (already captured in correlation features)
            result = result.drop(columns=returns_cols, errors='ignore')
    except Exception as e:
        logger.warning(f"Correlation features failed: {e}")

    return result


def compute_sector_features(wide_df: pd.DataFrame, lag: int = 1) -> pd.DataFrame:
    """
    Compute sector regime features on wide-format data.

    Args:
        wide_df: Wide-format DataFrame (timestamp index, symbols as columns)
        lag: Lag period for lookahead bias prevention

    Returns:
        DataFrame with sector features (timestamp index)
    """
    logger.info("Computing sector regime features...")

    df = wide_df.copy()
    df.columns = df.columns.str.lower()

    # Only add sector features if we have the required columns
    sector_cols = [s.lower() for s in SECTOR_ETFS if s.lower() in df.columns]
    if sector_cols and 'spy' in df.columns:
        result = add_sector_regime_features(df, sector_cols, benchmark_col='spy', lag=lag)
    else:
        logger.warning("Missing sector or SPY columns, skipping sector features")
        result = df

    return result


def main():
    parser = argparse.ArgumentParser(description='Run feature pipeline on data lake')
    parser.add_argument('--symbol', type=str, help='Single symbol to process')
    parser.add_argument('--all-symbols', action='store_true', help='Process all Liquid 16')
    parser.add_argument('--start', type=str, required=True, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, required=True, help='End date (YYYY-MM-DD)')
    parser.add_argument('--resample', type=str, default='1D',
                        help='Resample frequency (1min, 5min, 1H, 1D)')
    parser.add_argument('--lag', type=int, default=1, help='Lag for lookahead prevention')
    parser.add_argument('--output', type=str, help='Override output directory')
    parser.add_argument('--cross-asset-file', type=str,
                        help='Pre-computed cross-asset features file (skips cross-asset computation)')
    parser.add_argument('--skip-cross-asset', action='store_true',
                        help='Skip cross-asset features entirely')

    args = parser.parse_args()

    # Determine symbols to process
    if args.all_symbols:
        symbols = LIQUID_16
    elif args.symbol:
        symbols = [args.symbol.upper()]
    else:
        symbols = ['SPY']  # Default to SPY

    output_dir = Path(args.output) if args.output else OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    logger.info(f"="*60)
    logger.info(f"HARVEST PIPELINE")
    logger.info(f"="*60)
    logger.info(f"Symbols: {symbols}")
    logger.info(f"Date range: {args.start} to {args.end}")
    logger.info(f"Resample: {args.resample}")
    logger.info(f"Output: {output_dir}")
    logger.info(f"="*60)

    # Determine what data to load based on cross-asset settings
    if args.cross_asset_file:
        # Load pre-computed cross-asset features
        logger.info(f"\n--- Loading pre-computed cross-asset features ---")
        logger.info(f"File: {args.cross_asset_file}")
        cross_asset_df = pd.read_parquet(args.cross_asset_file)
        cross_asset_df.index = pd.to_datetime(cross_asset_df.index)
        logger.info(f"Loaded {len(cross_asset_df.columns)} cross-asset features")

        # Only need to load the symbols we're processing + VXX for VIX proxy
        all_symbols_needed = list(set(symbols + ['VXX']))
    elif args.skip_cross_asset:
        # Skip cross-asset entirely
        logger.info("\n--- Skipping cross-asset features ---")
        cross_asset_df = None
        all_symbols_needed = list(set(symbols + ['VXX']))
    else:
        # Compute cross-asset features (original behavior)
        all_symbols_needed = list(set(symbols + ['VXX'] + LIQUID_16))

    raw_df = load_stock_data(all_symbols_needed, args.start, args.end, args.resample)

    # Extract VXX as VIX proxy
    vxx_df = raw_df[raw_df['symbol'] == 'VXX'][['timestamp', 'close']].copy()
    vxx_df = vxx_df.set_index('timestamp')['close']

    # Compute cross-asset if not pre-loaded
    if not args.cross_asset_file and not args.skip_cross_asset:
        # Create wide-format DataFrame for cross-asset features
        wide_df = pivot_to_wide(raw_df, 'close')

        # Add VIX to wide-format for cross-asset calculations
        wide_df['vix'] = vxx_df

        # Compute cross-asset features once on wide-format data
        logger.info("\n--- Computing shared cross-asset features ---")
        cross_asset_df = compute_cross_asset_features(wide_df, lag=args.lag)

        # Compute sector features once on wide-format data
        sector_df = compute_sector_features(wide_df, lag=args.lag)

        # Merge sector features into cross_asset_df
        sector_cols = [c for c in sector_df.columns if c not in cross_asset_df.columns]
        if sector_cols:
            cross_asset_df = cross_asset_df.join(sector_df[sector_cols], how='left')

        logger.info(f"Cross-asset features computed: {len(cross_asset_df.columns)} columns")

    # Process each symbol
    for symbol in symbols:
        logger.info(f"\nProcessing {symbol}...")

        # Get symbol data
        symbol_df = raw_df[raw_df['symbol'] == symbol].copy()
        if len(symbol_df) == 0:
            logger.warning(f"  No data for {symbol}, skipping")
            continue

        # Prepare with VIX proxy
        symbol_df = symbol_df.set_index('timestamp')
        symbol_df['vix'] = vxx_df
        symbol_df['vix'] = symbol_df['vix'].ffill()
        symbol_df = symbol_df.reset_index()

        # Run feature pipeline
        features_df = run_feature_pipeline(
            symbol_df,
            symbol,
            cross_asset_df,
            lag=args.lag
        )

        # Save output
        output_path = output_dir / f"{symbol}_master_features.parquet"
        features_df.to_parquet(output_path, index=False)

        n_features = len([c for c in features_df.columns if c not in
                         ['timestamp', 'symbol', 'open', 'high', 'low', 'close', 'volume']])
        logger.info(f"  Saved {len(features_df):,} rows, {n_features} features → {output_path}")

    logger.info(f"\n{'='*60}")
    logger.info(f"HARVEST COMPLETE")
    logger.info(f"{'='*60}")


if __name__ == '__main__':
    main()
