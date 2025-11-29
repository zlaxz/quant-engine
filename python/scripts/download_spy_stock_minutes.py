#!/usr/bin/env python3
"""
Stream-filter SPY minute aggregates from Polygon/Massive flat files.

Each source file contains every US stock; we download one day at a time from
`us_stocks_sip/minute_aggs_v1/YYYY/MM/YYYY-MM-DD.csv.gz`, filter rows where
`ticker == "SPY"`, optionally reformat, and write a parquet file per day.

Example:
    python scripts/download_spy_stock_minutes.py --start 2020-01-02 --end 2022-12-30 \
        --out /Volumes/VelocityData/velocity_om/parquet/stock/SPY --workers 8
"""

import argparse
import boto3
import gzip
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd

ACCESS_KEY = "39f80878-ab94-48eb-a3fc-a18bd48c9656"
SECRET_KEY = "r8ttfG0r9lvunoLbhpECXNjp7sRqE8LP"
ENDPOINT = "https://files.massive.com"
BUCKET = "flatfiles"
PREFIX = "us_stocks_sip/minute_aggs_v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download SPY minute data via streaming filter.")
    parser.add_argument("--start", type=str, required=True, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, required=True, help="End date (YYYY-MM-DD)")
    parser.add_argument("--out", type=Path,
                        default=Path("/Volumes/VelocityData/velocity_om/parquet/stock/SPY"),
                        help="Output directory for parquet files")
    parser.add_argument("--workers", type=int, default=4, help="Number of parallel downloads")
    parser.add_argument("--overwrite", action="store_true", help="Re-download even if parquet exists")
    return parser.parse_args()


def daterange(start: datetime, end: datetime):
    current = start
    while current <= end:
        if current.weekday() < 5:
            yield current
        current += timedelta(days=1)


def download_day(session, date_obj: datetime, out_dir: Path, overwrite: bool) -> str:
    date_str = date_obj.strftime("%Y-%m-%d")
    target = out_dir / f"{date_str}.parquet"
    if target.exists() and not overwrite:
        return f"skip:{date_str}"

    key = f"{PREFIX}/{date_obj:%Y/%m}/{date_str}.csv.gz"

    try:
        response = session.get_object(Bucket=BUCKET, Key=key)
    except Exception as exc:
        return f"missing:{date_str}:{exc}"

    frames = []
    try:
        with gzip.GzipFile(fileobj=response["Body"]) as gz:
            reader = pd.read_csv(gz, chunksize=100_000)
            for chunk in reader:
                if "ticker" not in chunk.columns:
                    continue
                subset = chunk[chunk["ticker"] == "SPY"]
                if not subset.empty:
                    frames.append(subset)
    except Exception as exc:
        return f"error:{date_str}:{exc}"

    if not frames:
        return f"no_spy:{date_str}"

    df = pd.concat(frames, ignore_index=True)
    if "window_start" in df.columns:
        df["ts"] = pd.to_datetime(df["window_start"], unit="ns")
    elif "timestamp" in df.columns:
        df["ts"] = pd.to_datetime(df["timestamp"])
    else:
        return f"bad_columns:{date_str}"

    df = df.sort_values("ts")
    cols = [c for c in ["ts", "open", "high", "low", "close", "volume"] if c in df.columns]
    df = df[cols]
    target.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(target, index=False)
    return f"ok:{date_str}:{len(df)}"


def main():
    args = parse_args()
    start = datetime.strptime(args.start, "%Y-%m-%d")
    end = datetime.strptime(args.end, "%Y-%m-%d")

    session = boto3.client(
        "s3",
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        endpoint_url=ENDPOINT,
    )

    dates = list(daterange(start, end))
    if not dates:
        print("No trading days in range.")
        return

    print(f"Downloading {len(dates)} trading days from {args.start} to {args.end}...")
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(download_day, session, date_obj, args.out, args.overwrite): date_obj
            for date_obj in dates
        }
        for future in as_completed(futures):
            result = future.result()
            print(result)

    print("Download complete.")


if __name__ == "__main__":
    main()
