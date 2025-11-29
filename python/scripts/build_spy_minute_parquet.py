#!/usr/bin/env python3
"""
Convert raw VelocityData stock CSV.gz files into SPY minute-level parquet files.

The raw files live under /Volumes/VelocityData/velocity_om/raw/stock/<YYYY-MM-DD>.csv.gz
and contain every OPRA ticker. We filter for SPY, aggregate to 1-minute OHLCV, and
write a parquet per trading day into /Volumes/VelocityData/velocity_om/parquet/stock/SPY.

Usage:
    python scripts/build_spy_minute_parquet.py --workers 8 --force
"""

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import List

import pandas as pd

RAW_DEFAULT = Path("/Volumes/VelocityData/velocity_om/raw/stock")
OUT_DEFAULT = Path("/Volumes/VelocityData/velocity_om/parquet/stock/SPY")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build SPY minute-level parquet files.")
    parser.add_argument("--raw-dir", type=Path, default=RAW_DEFAULT,
                        help="Directory containing raw CSV.gz files (default: %(default)s)")
    parser.add_argument("--out-dir", type=Path, default=OUT_DEFAULT,
                        help="Output directory for SPY parquet files (default: %(default)s)")
    parser.add_argument("--workers", type=int, default=8,
                        help="Number of parallel workers (default: %(default)s)")
    parser.add_argument("--force", action="store_true",
                        help="Rebuild even if parquet already exists")
    parser.add_argument("--limit", type=int, default=None,
                        help="Process only first N files (for testing)")
    return parser.parse_args()


def find_missing(raw_dir: Path, out_dir: Path, force: bool) -> List[Path]:
    raw_files = sorted(raw_dir.glob("*.csv.gz"))
    out_dir.mkdir(parents=True, exist_ok=True)

    if force:
        return raw_files

    missing = []
    for path in raw_files:
        candidate = out_dir / f"{path.stem}.parquet"
        if not candidate.exists():
            missing.append(path)
    return missing


def process_file(path: Path, out_dir: Path, force: bool = False) -> str:
    target = out_dir / f"{path.stem}.parquet"
    if target.exists() and not force:
        return f"skip:{path.stem}"

    chunks = []
    for chunk in pd.read_csv(
        path,
        usecols=["ticker", "volume", "open", "close", "high", "low", "window_start"],
        chunksize=1_000_000,
    ):
        spy_chunk = chunk[chunk["ticker"] == "SPY"]
        if not spy_chunk.empty:
            chunks.append(spy_chunk)

    if not chunks:
        return f"no_data:{path.stem}"

    spy = pd.concat(chunks, ignore_index=True)
    spy["ts"] = pd.to_datetime(spy["window_start"], unit="ns")
    spy = spy.sort_values("ts")
    spy["minute"] = spy["ts"].dt.floor("min")

    agg = (
        spy.groupby("minute", sort=True)
        .agg(
            open=("open", "first"),
            high=("high", "max"),
            low=("low", "min"),
            close=("close", "last"),
            volume=("volume", "sum"),
        )
        .reset_index()
    )
    agg["date"] = agg["minute"].dt.date
    agg.rename(columns={"minute": "ts"}, inplace=True)

    agg.to_parquet(target, index=False)
    return f"built:{path.stem}"


def main():
    args = parse_args()
    raw_dir = args.raw_dir
    out_dir = args.out_dir

    if not raw_dir.exists():
        raise FileNotFoundError(f"Raw directory {raw_dir} does not exist")

    targets = find_missing(raw_dir, out_dir, args.force)
    if args.limit:
        targets = targets[:args.limit]

    if not targets:
        print("All parquet files already exist. Nothing to do.")
        return

    print(f"Processing {len(targets)} files with {args.workers} workers...")
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(process_file, path, out_dir, args.force): path
            for path in targets
        }
        for future in as_completed(futures):
            path = futures[future]
            try:
                result = future.result()
                print(result)
            except Exception as exc:
                print(f"ERROR:{path.stem}:{exc}")

    print("SPY parquet generation complete.")


if __name__ == "__main__":
    main()
