#!/usr/bin/env python3
"""
Stream-filter download from massive.com S3.

Downloads only target symbols from massive daily files.
Each file contains ALL symbols - we filter on-the-fly to save storage.
"""

import os
import sys
import gzip
import io
import argparse
from datetime import datetime, timedelta
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

import boto3
from botocore.config import Config
import pandas as pd

# ============================================================================
# CONFIGURATION
# ============================================================================

S3_ENDPOINT = 'https://files.massive.com'
S3_ACCESS_KEY = '39f80878-ab94-48eb-a3fc-a18bd48c9656'
S3_SECRET_KEY = 'r8ttfG0r9lvunoLbhpECXNjp7sRqE8LP'
BUCKET = 'flatfiles'

# Target symbols
STOCK_SYMBOLS = [
    'SPY', 'QQQ', 'IWM', 'DIA',  # Equity indices
    'GLD', 'SLV',                 # Precious metals
    'TLT', 'LQD', 'HYG',          # Bonds
    'USO',                        # Oil
    'VXX',                        # Volatility
    'XLF', 'XLK', 'XLE',          # Sectors
    'EEM', 'EFA',                 # International
]

# Futures root symbols (will match ES, ESZ24, etc.)
FUTURES_ROOTS = ['ES', 'NQ', 'GC', 'CL', 'ZB', 'ZN']

# Output directory
OUTPUT_DIR = Path('/Volumes/VelocityData/velocity_om/massive')

# ============================================================================
# S3 CLIENT
# ============================================================================

def get_s3_client():
    return boto3.client(
        's3',
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        config=Config(signature_version='s3v4')
    )

# ============================================================================
# DOWNLOAD FUNCTIONS
# ============================================================================

def download_and_filter_stocks(s3, date_str: str, output_dir: Path) -> dict:
    """Download stock minute bars for target symbols only."""
    year = date_str[:4]
    month = date_str[5:7]
    key = f'us_stocks_sip/minute_aggs_v1/{year}/{month}/{date_str}.csv.gz'

    output_file = output_dir / 'stocks' / f'{date_str}.parquet'
    if output_file.exists():
        return {'status': 'skipped', 'date': date_str, 'rows': 0}

    try:
        obj = s3.get_object(Bucket=BUCKET, Key=key)
        data = gzip.decompress(obj['Body'].read()).decode('utf-8')

        lines = data.strip().split('\n')
        header = lines[0]

        # Filter for target symbols
        filtered = [header]
        for line in lines[1:]:
            ticker = line.split(',')[0]
            if ticker in STOCK_SYMBOLS:
                filtered.append(line)

        if len(filtered) <= 1:
            return {'status': 'empty', 'date': date_str, 'rows': 0}

        # Parse and save as parquet
        df = pd.read_csv(io.StringIO('\n'.join(filtered)))
        df['window_start'] = pd.to_datetime(df['window_start'], unit='ns')

        output_file.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(output_file, index=False)

        return {'status': 'success', 'date': date_str, 'rows': len(df)}

    except s3.exceptions.NoSuchKey:
        return {'status': 'missing', 'date': date_str, 'rows': 0}
    except Exception as e:
        return {'status': 'error', 'date': date_str, 'error': str(e)}


def download_and_filter_options(s3, date_str: str, output_dir: Path) -> dict:
    """Download options minute bars for target underlyings only."""
    year = date_str[:4]
    month = date_str[5:7]
    key = f'us_options_opra/minute_aggs_v1/{year}/{month}/{date_str}.csv.gz'

    output_file = output_dir / 'options' / f'{date_str}.parquet'
    if output_file.exists():
        return {'status': 'skipped', 'date': date_str, 'rows': 0}

    try:
        obj = s3.get_object(Bucket=BUCKET, Key=key)
        data = gzip.decompress(obj['Body'].read()).decode('utf-8')

        lines = data.strip().split('\n')
        header = lines[0]

        # Filter for options on target symbols
        # Options tickers format: O:SPY251219C00600000
        filtered = [header]
        for line in lines[1:]:
            ticker = line.split(',')[0]
            # Extract underlying from options ticker
            if ticker.startswith('O:'):
                # O:SPY251219C00600000 -> SPY
                underlying = ''
                for i, c in enumerate(ticker[2:]):
                    if c.isdigit():
                        underlying = ticker[2:2+i]
                        break
                if underlying in STOCK_SYMBOLS:
                    filtered.append(line)

        if len(filtered) <= 1:
            return {'status': 'empty', 'date': date_str, 'rows': 0}

        df = pd.read_csv(io.StringIO('\n'.join(filtered)))
        df['window_start'] = pd.to_datetime(df['window_start'], unit='ns')

        output_file.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(output_file, index=False)

        return {'status': 'success', 'date': date_str, 'rows': len(df)}

    except s3.exceptions.NoSuchKey:
        return {'status': 'missing', 'date': date_str, 'rows': 0}
    except Exception as e:
        return {'status': 'error', 'date': date_str, 'error': str(e)}


def download_and_filter_futures(s3, date_str: str, output_dir: Path) -> dict:
    """Download futures minute bars for target roots only."""
    year = date_str[:4]
    month = date_str[5:7]
    key = f'us_futures_cme/minute_aggs_v1/{year}/{month}/{date_str}.csv.gz'

    output_file = output_dir / 'futures' / f'{date_str}.parquet'
    if output_file.exists():
        return {'status': 'skipped', 'date': date_str, 'rows': 0}

    try:
        obj = s3.get_object(Bucket=BUCKET, Key=key)
        data = gzip.decompress(obj['Body'].read()).decode('utf-8')

        lines = data.strip().split('\n')
        header = lines[0]

        # Filter for target futures roots
        filtered = [header]
        for line in lines[1:]:
            ticker = line.split(',')[0]
            # Match root symbol (ES, ESZ24, ESH25, etc.)
            for root in FUTURES_ROOTS:
                if ticker == root or ticker.startswith(root) and len(ticker) <= len(root) + 3:
                    filtered.append(line)
                    break

        if len(filtered) <= 1:
            return {'status': 'empty', 'date': date_str, 'rows': 0}

        df = pd.read_csv(io.StringIO('\n'.join(filtered)))
        df['window_start'] = pd.to_datetime(df['window_start'], unit='ns')

        output_file.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(output_file, index=False)

        return {'status': 'success', 'date': date_str, 'rows': len(df)}

    except s3.exceptions.NoSuchKey:
        return {'status': 'missing', 'date': date_str, 'rows': 0}
    except Exception as e:
        return {'status': 'error', 'date': date_str, 'error': str(e)}


# ============================================================================
# MAIN
# ============================================================================

def generate_dates(start_date: str, end_date: str):
    """Generate trading dates between start and end."""
    start = datetime.strptime(start_date, '%Y-%m-%d')
    end = datetime.strptime(end_date, '%Y-%m-%d')

    current = start
    while current <= end:
        # Skip weekends
        if current.weekday() < 5:
            yield current.strftime('%Y-%m-%d')
        current += timedelta(days=1)


def main():
    parser = argparse.ArgumentParser(description='Download filtered data from massive.com')
    parser.add_argument('--dataset', choices=['stocks', 'options', 'futures', 'all'], default='all')
    parser.add_argument('--start', default='2020-01-01', help='Start date YYYY-MM-DD')
    parser.add_argument('--end', default='2025-12-03', help='End date YYYY-MM-DD')
    parser.add_argument('--workers', type=int, default=4, help='Parallel download workers')
    parser.add_argument('--output', default=str(OUTPUT_DIR), help='Output directory')
    args = parser.parse_args()

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    dates = list(generate_dates(args.start, args.end))
    print(f"📅 Processing {len(dates)} trading days from {args.start} to {args.end}")
    print(f"📁 Output: {output_dir}")
    print(f"🎯 Symbols: {', '.join(STOCK_SYMBOLS)}")
    print(f"📊 Futures: {', '.join(FUTURES_ROOTS)}")
    print()

    # Thread-local S3 clients
    thread_local = threading.local()

    def get_thread_s3():
        if not hasattr(thread_local, 's3'):
            thread_local.s3 = get_s3_client()
        return thread_local.s3

    datasets_to_process = []
    if args.dataset in ['stocks', 'all']:
        datasets_to_process.append(('stocks', download_and_filter_stocks))
    if args.dataset in ['options', 'all']:
        datasets_to_process.append(('options', download_and_filter_options))
    if args.dataset in ['futures', 'all']:
        datasets_to_process.append(('futures', download_and_filter_futures))

    for dataset_name, download_func in datasets_to_process:
        print(f"\n{'='*60}")
        print(f"📥 Downloading {dataset_name.upper()}")
        print(f"{'='*60}")

        success = 0
        skipped = 0
        errors = 0
        total_rows = 0

        def process_date(date_str):
            s3 = get_thread_s3()
            return download_func(s3, date_str, output_dir)

        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(process_date, d): d for d in dates}

            for i, future in enumerate(as_completed(futures)):
                result = future.result()

                if result['status'] == 'success':
                    success += 1
                    total_rows += result['rows']
                elif result['status'] == 'skipped':
                    skipped += 1
                elif result['status'] == 'error':
                    errors += 1
                    print(f"  ❌ {result['date']}: {result.get('error', 'Unknown error')}")

                # Progress update every 50 files
                if (i + 1) % 50 == 0:
                    print(f"  Progress: {i+1}/{len(dates)} | ✅ {success} | ⏭️ {skipped} | ❌ {errors}")

        print(f"\n{dataset_name.upper()} complete:")
        print(f"  ✅ Downloaded: {success}")
        print(f"  ⏭️ Skipped (existing): {skipped}")
        print(f"  ❌ Errors: {errors}")
        print(f"  📊 Total rows: {total_rows:,}")

    print(f"\n🎉 All downloads complete!")
    print(f"📁 Data saved to: {output_dir}")


if __name__ == '__main__':
    main()
