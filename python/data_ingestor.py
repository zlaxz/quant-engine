#!/usr/bin/env python3
"""
Massive.com Data Ingestor
-------------------------
Downloads Polygon.io flat files from Massive.com S3 and stores them locally as Parquet.
Updates Supabase local_data_index to track what's available.
"""

import os
import sys
import argparse
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
import io

import boto3
from botocore.config import Config
import zstandard as zstd
import polars as pl
from supabase import create_client, Client

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Default tickers to download (high-liquidity options)
DEFAULT_TICKERS = [
    'SPY', 'QQQ', 'IWM', 'DIA',
    'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META',
    'AMD', 'NFLX', 'CRM', 'INTC',
    'JPM', 'BAC', 'GS', 'MS',
    'XLF', 'XLE', 'XLK', 'XLV', 'XLI',
]

# Massive.com S3 configuration
MASSIVE_S3_ENDPOINT = 'https://files.massive.com'
MASSIVE_S3_BUCKET = 'polygon-flat-files'

DATA_TYPE_PREFIXES = {
    'stocks_trades': 'us_stocks_sip/trades_v1',
    'stocks_quotes': 'us_stocks_sip/quotes_v3',
    'options_trades': 'us_options_opra/trades_v1',
    'options_quotes': 'us_options_opra/quotes_v1',
}

class MassiveIngestor:
    def __init__(self, massive_key, data_dir, supabase_url=None, supabase_key=None, tickers=None):
        self.massive_key = massive_key
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.tickers = set(tickers or DEFAULT_TICKERS)

        self.s3 = boto3.client(
            's3',
            endpoint_url=MASSIVE_S3_ENDPOINT,
            aws_access_key_id=massive_key,
            aws_secret_access_key=massive_key,
            config=Config(signature_version='s3v4', s3={'addressing_style': 'path'})
        )

        self.supabase = None
        if supabase_url and supabase_key:
            self.supabase = create_client(supabase_url, supabase_key)
            logger.info("Connected to Supabase for index updates")

        self.dctx = zstd.ZstdDecompressor()

    def _get_s3_key(self, date: datetime, data_type: str) -> str:
        prefix = DATA_TYPE_PREFIXES.get(data_type)
        date_str = date.strftime('%Y/%m/%d')
        return f"{prefix}/{date_str}"

    def _get_output_path(self, symbol: str, date: datetime, data_type: str) -> Path:
        date_str = date.strftime('%Y%m%d')
        return self.data_dir / data_type / symbol / f"{symbol}_{date_str}.parquet"

    def _filter_and_save(self, data: bytes, symbol: str, date: datetime, data_type: str):
        df = pl.read_csv(io.BytesIO(data), has_header=True, ignore_errors=True)
        symbol_col = 'ticker' if 'ticker' in df.columns else 'sym'

        if symbol_col in df.columns:
            df = df.filter(pl.col(symbol_col) == symbol)

        if df.is_empty():
            return None, 0

        output_path = self._get_output_path(symbol, date, data_type)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        df.write_parquet(output_path, compression='zstd', compression_level=3)
        return output_path, len(df)

    def download_day(self, date: datetime, data_type='stocks_trades', tickers=None):
        target_tickers = set(tickers or self.tickers)
        s3_prefix = self._get_s3_key(date, data_type)

        paginator = self.s3.get_paginator('list_objects_v2')
        stats = {'files_processed': 0, 'symbols_saved': 0, 'total_rows': 0}

        for page in paginator.paginate(Bucket=MASSIVE_S3_BUCKET, Prefix=s3_prefix):
            for obj in page.get('Contents', []):
                key = obj['Key']
                if not key.endswith('.csv.zst'): continue

                try:
                    stats['files_processed'] += 1
                    logger.info(f"Processing: {key}")
                    response = self.s3.get_object(Bucket=MASSIVE_S3_BUCKET, Key=key)
                    compressed = response['Body'].read()
                    csv_data = self.dctx.decompress(compressed)

                    for ticker in target_tickers:
                        res = self._filter_and_save(csv_data, ticker, date, data_type)
                        if res and res[0]:
                            stats['symbols_saved'] += 1
                            stats['total_rows'] += res[1]
                except Exception as e:
                    logger.error(f"Error processing {key}: {e}")

        return stats

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--date', type=str, required=True)
    parser.add_argument('--type', type=str, default='stocks_trades')
    parser.add_argument('--tickers', type=str)
    args = parser.parse_args()

    ingestor = MassiveIngestor(
        massive_key=os.environ.get('MASSIVE_KEY', 'dummy'),
        data_dir=os.environ.get('DATA_DIR', './data'),
        tickers=args.tickers.split(',') if args.tickers else None
    )

    date = datetime.strptime(args.date, '%Y-%m-%d')
    ingestor.download_day(date, args.type)

if __name__ == '__main__':
    main()
