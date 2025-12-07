#!/usr/bin/env python3
"""
Parallel Feature Pre-computation for Futures Data

Uses multiprocessing to generate features across all symbols/timeframes.
Optimized for M4 Pro (14 cores, 48GB RAM).
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd
import numpy as np
from multiprocessing import Pool, cpu_count
from datetime import datetime
import logging
import argparse

from engine.futures import FuturesDataLoader, FuturesFeatureEngine

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
DATA_DIR = Path("/Volumes/VelocityData/velocity_om/futures")
OUTPUT_DIR = Path("/Volumes/VelocityData/velocity_om/futures_features")
TIMEFRAMES = ["1m", "1h", "1d"]


def get_available_symbols() -> list:
    """Scan data directory for available symbols."""
    symbols = set()
    for f in DATA_DIR.glob("*_ohlcv_*.parquet"):
        symbol = f.name.split("_")[0]
        symbols.add(symbol)
    return sorted(symbols)


def process_symbol_timeframe(args: tuple) -> dict:
    """
    Process a single symbol/timeframe combination.

    Args:
        args: (symbol, timeframe, data_dir, output_dir)

    Returns:
        Result dict with status and metrics
    """
    symbol, timeframe, data_dir, output_dir = args

    result = {
        'symbol': symbol,
        'timeframe': timeframe,
        'status': 'failed',
        'rows': 0,
        'features': 0,
        'error': None
    }

    try:
        logger.info(f"[{symbol}] Processing {timeframe}...")

        # Load data
        loader = FuturesDataLoader(data_dir=str(data_dir))
        df = loader.load_symbol(symbol, timeframe=timeframe)

        if df.empty:
            result['error'] = "No data loaded"
            return result

        # Generate features
        engine = FuturesFeatureEngine(timeframe=timeframe)
        features_df = engine.generate_features(df)

        # Drop NaN rows from warmup period
        features_df = features_df.dropna()

        if features_df.empty:
            result['error'] = "All rows NaN after feature generation"
            return result

        # Save to parquet
        output_dir.mkdir(parents=True, exist_ok=True)
        output_file = output_dir / f"{symbol}_features_{timeframe}.parquet"
        features_df.to_parquet(output_file, compression='snappy')

        result['status'] = 'success'
        result['rows'] = len(features_df)
        result['features'] = len(features_df.columns)
        result['output_file'] = str(output_file)

        logger.info(f"[{symbol}] {timeframe}: {len(features_df):,} rows, {len(features_df.columns)} features -> {output_file.name}")

    except Exception as e:
        result['error'] = str(e)
        logger.error(f"[{symbol}] {timeframe} FAILED: {e}")

    return result


def main():
    parser = argparse.ArgumentParser(description="Pre-compute futures features")
    parser.add_argument("--symbols", nargs="+", help="Specific symbols to process")
    parser.add_argument("--timeframes", nargs="+", default=TIMEFRAMES, help="Timeframes to process")
    parser.add_argument("--workers", type=int, default=12, help="Number of parallel workers")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be processed")
    args = parser.parse_args()

    print("\n" + "="*60)
    print("FUTURES FEATURE PRE-COMPUTATION")
    print(f"Time: {datetime.now()}")
    print(f"Workers: {args.workers} (CPU count: {cpu_count()})")
    print("="*60)

    # Get symbols
    if args.symbols:
        symbols = args.symbols
    else:
        symbols = get_available_symbols()

    print(f"\nSymbols: {symbols}")
    print(f"Timeframes: {args.timeframes}")
    print(f"Output: {OUTPUT_DIR}")

    # Build task list
    tasks = []
    for symbol in symbols:
        for tf in args.timeframes:
            # Check if source file exists
            pattern = f"{symbol}_ohlcv_{tf}_*.parquet"
            files = list(DATA_DIR.glob(pattern))
            if files:
                tasks.append((symbol, tf, DATA_DIR, OUTPUT_DIR))
            else:
                logger.warning(f"No source file for {symbol} {tf}")

    print(f"\nTotal tasks: {len(tasks)}")

    if args.dry_run:
        print("\n[DRY RUN] Would process:")
        for symbol, tf, _, _ in tasks:
            print(f"  - {symbol} {tf}")
        return

    # Process in parallel
    print("\n" + "-"*60)
    print("Starting parallel processing...")
    print("-"*60 + "\n")

    start_time = datetime.now()

    with Pool(processes=args.workers) as pool:
        results = pool.map(process_symbol_timeframe, tasks)

    elapsed = datetime.now() - start_time

    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)

    success = [r for r in results if r['status'] == 'success']
    failed = [r for r in results if r['status'] == 'failed']

    total_rows = sum(r['rows'] for r in success)

    print(f"\nCompleted: {len(success)}/{len(results)} tasks")
    print(f"Total rows: {total_rows:,}")
    print(f"Elapsed: {elapsed}")

    if failed:
        print(f"\nFailed tasks:")
        for r in failed:
            print(f"  - {r['symbol']} {r['timeframe']}: {r['error']}")

    # List output files
    print(f"\nOutput files in {OUTPUT_DIR}:")
    for f in sorted(OUTPUT_DIR.glob("*.parquet")):
        size_mb = f.stat().st_size / 1024 / 1024
        print(f"  {f.name}: {size_mb:.1f} MB")

    print("\n" + "="*60)
    print("FEATURE PRE-COMPUTATION COMPLETE")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
