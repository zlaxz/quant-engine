#!/usr/bin/env python3
"""
Pre-compute Cross-Asset Features - Run ONCE, reuse for all symbols.

This computes inter-market relationships (SPY-VIX correlation, sector rotation,
risk appetite) and saves to disk. Symbol-specific runs then just load this file.

Usage:
    python scripts/precompute_cross_asset.py --start 2020-01-01 --end 2025-12-01

Output:
    /Volumes/VelocityData/velocity_om/features/cross_asset_features.parquet
"""

import argparse
import logging
from pathlib import Path

import duckdb
import pandas as pd

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from engine.features.cross_asset import add_cross_asset_features
from engine.features.correlation import add_correlation_features
from engine.features.sector_regime import add_sector_regime_features

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('CrossAsset')

DATA_LAKE = Path('/Volumes/VelocityData/velocity_om/massive')
OUTPUT_DIR = Path('/Volumes/VelocityData/velocity_om/features')

# Minimal symbols needed for cross-asset features
CROSS_ASSET_SYMBOLS = [
    'SPY', 'QQQ', 'IWM',  # Index ETFs
    'TLT',                 # Bonds
    'GLD',                 # Gold
    'VXX',                 # VIX proxy
    'XLF', 'XLK', 'XLE',  # Sectors
    'EEM',                 # Emerging markets
]


def load_symbols(symbols: list, start_date: str, end_date: str) -> pd.DataFrame:
    """Load daily OHLCV data for symbols."""
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
    logger.info(f"Loaded {len(result):,} daily bars")
    return result.reset_index()


def pivot_to_wide(df: pd.DataFrame) -> pd.DataFrame:
    """Pivot long-form data to wide format (one column per symbol)."""
    return df.pivot(
        index='timestamp',
        columns='symbol',
        values='close'
    )


def main():
    parser = argparse.ArgumentParser(description='Pre-compute cross-asset features')
    parser.add_argument('--start', type=str, required=True, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, required=True, help='End date (YYYY-MM-DD)')
    parser.add_argument('--lag', type=int, default=1, help='Lag for lookahead prevention')
    parser.add_argument('--output', type=str, help='Override output path')

    args = parser.parse_args()

    output_path = Path(args.output) if args.output else OUTPUT_DIR / 'cross_asset_features.parquet'
    output_path.parent.mkdir(parents=True, exist_ok=True)

    logger.info("=" * 60)
    logger.info("PRE-COMPUTE CROSS-ASSET FEATURES")
    logger.info("=" * 60)
    logger.info(f"Date range: {args.start} to {args.end}")
    logger.info(f"Symbols: {CROSS_ASSET_SYMBOLS}")
    logger.info(f"Output: {output_path}")
    logger.info("=" * 60)

    # 1. Load data
    raw_df = load_symbols(CROSS_ASSET_SYMBOLS, args.start, args.end)

    # 2. Pivot to wide format
    wide_df = pivot_to_wide(raw_df)
    wide_df.columns = wide_df.columns.str.lower()

    # Add VIX column (VXX as proxy)
    if 'vxx' in wide_df.columns:
        wide_df['vix'] = wide_df['vxx']

    logger.info(f"Wide format: {wide_df.shape[0]} days × {wide_df.shape[1]} symbols")

    # 3. Compute cross-asset features
    logger.info("\nComputing cross-asset features...")
    result = add_cross_asset_features(wide_df.copy(), lag=args.lag)

    # 4. Compute correlation features (absorption ratio, eigenvalue entropy)
    logger.info("Computing correlation features...")
    try:
        asset_cols = [c for c in ['spy', 'qqq', 'iwm', 'tlt', 'gld', 'xlf', 'xlk', 'xle']
                      if c in wide_df.columns]
        if len(asset_cols) >= 3:
            # Create returns columns
            for col in asset_cols:
                result[f'{col}_ret'] = wide_df[col].pct_change()
            returns_cols = [f'{col}_ret' for col in asset_cols]
            result = add_correlation_features(result, returns_cols=returns_cols, window=60, lag=args.lag)
            # Drop temporary return columns
            result = result.drop(columns=returns_cols, errors='ignore')
    except Exception as e:
        logger.warning(f"Correlation features failed: {e}")

    # 5. Compute sector regime features
    logger.info("Computing sector regime features...")
    try:
        sector_cols = [c for c in ['xlf', 'xlk', 'xle'] if c in wide_df.columns]
        if sector_cols and 'spy' in wide_df.columns:
            result = add_sector_regime_features(result, sector_cols, benchmark_col='spy', lag=args.lag)
    except Exception as e:
        logger.warning(f"Sector regime features failed: {e}")

    # 6. Keep only feature columns (drop raw price columns)
    price_cols = [c.lower() for c in CROSS_ASSET_SYMBOLS] + ['vix', 'vxx']
    feature_cols = [c for c in result.columns if c not in price_cols]

    output_df = result[feature_cols].copy()
    output_df.index.name = 'timestamp'

    # 7. Save
    output_df.to_parquet(output_path)

    logger.info("\n" + "=" * 60)
    logger.info("CROSS-ASSET FEATURES COMPLETE")
    logger.info("=" * 60)
    logger.info(f"Output: {output_path}")
    logger.info(f"Shape: {output_df.shape[0]} days × {output_df.shape[1]} features")
    logger.info(f"Date range: {output_df.index.min()} to {output_df.index.max()}")
    logger.info(f"File size: {output_path.stat().st_size / 1024:.1f} KB")
    logger.info("=" * 60)

    # Show feature summary
    logger.info("\nFeature categories:")
    spy_vix = [c for c in output_df.columns if 'spy_vix' in c]
    sector = [c for c in output_df.columns if 'sector_' in c]
    risk = [c for c in output_df.columns if 'risk_' in c]
    corr = [c for c in output_df.columns if 'absorption' in c or 'eigenvalue' in c or 'corr_' in c]

    logger.info(f"  SPY-VIX features: {len(spy_vix)}")
    logger.info(f"  Sector rotation: {len(sector)}")
    logger.info(f"  Risk appetite: {len(risk)}")
    logger.info(f"  Correlation/systemic: {len(corr)}")


if __name__ == '__main__':
    main()
