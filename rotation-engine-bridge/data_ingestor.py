#!/usr/bin/env python3
"""
Massive.com Data Ingestor
-------------------------
Downloads Polygon.io flat files from Massive.com S3 and stores them locally as Parquet.
Updates Supabase local_data_index to track what's available.

Usage:
    # Download single day
    python data_ingestor.py --date 2024-11-20 --type stocks_trades --tickers SPY,QQQ,NVDA

    # Download date range
    python data_ingestor.py --start 2024-11-01 --end 2024-11-20 --type stocks_trades

    # Download with all default tickers
    python data_ingestor.py --date 2024-11-20

Environment Variables:
    MASSIVE_KEY: Your Massive.com API key
    DATA_DIR: Path to 8TB drive (default: ./data)
    SUPABASE_URL: Supabase project URL
    SUPABASE_KEY: Supabase service role key
"""

import os
import sys
import argparse
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
import hashlib
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
    'SPY', 'QQQ', 'IWM', 'DIA',  # Major ETFs
    'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META',  # Mega caps
    'AMD', 'NFLX', 'CRM', 'INTC',  # Tech
    'JPM', 'BAC', 'GS', 'MS',  # Financials
    'XLF', 'XLE', 'XLK', 'XLV', 'XLI',  # Sector ETFs
]

# Massive.com S3 configuration
MASSIVE_S3_ENDPOINT = 'https://files.massive.com'
MASSIVE_S3_BUCKET = 'polygon-flat-files'

# Data type to S3 prefix mapping
DATA_TYPE_PREFIXES = {
    'stocks_trades': 'us_stocks_sip/trades_v1',
    'stocks_quotes': 'us_stocks_sip/quotes_v3',
    'options_trades': 'us_options_opra/trades_v1',
    'options_quotes': 'us_options_opra/quotes_v1',
}


class MassiveIngestor:
    """Downloads and processes Massive.com Polygon flat files."""

    def __init__(
        self,
        massive_key: str,
        data_dir: str,
        supabase_url: Optional[str] = None,
        supabase_key: Optional[str] = None,
        tickers: Optional[list[str]] = None
    ):
        self.massive_key = massive_key
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.tickers = set(tickers or DEFAULT_TICKERS)

        # Initialize S3 client for Massive.com
        self.s3 = boto3.client(
            's3',
            endpoint_url=MASSIVE_S3_ENDPOINT,
            aws_access_key_id=massive_key,
            aws_secret_access_key=massive_key,  # Massive uses same key for both
            config=Config(
                signature_version='s3v4',
                s3={'addressing_style': 'path'}
            )
        )

        # Initialize Supabase client if credentials provided
        self.supabase: Optional[Client] = None
        if supabase_url and supabase_key:
            self.supabase = create_client(supabase_url, supabase_key)
            logger.info("Connected to Supabase for index updates")
        else:
            logger.warning("No Supabase credentials - local index updates disabled")

        # zstd decompressor
        self.dctx = zstd.ZstdDecompressor()

    def _get_s3_key(self, date: datetime, data_type: str) -> str:
        """Generate S3 key for a given date and data type."""
        prefix = DATA_TYPE_PREFIXES.get(data_type)
        if not prefix:
            raise ValueError(f"Unknown data type: {data_type}. Valid: {list(DATA_TYPE_PREFIXES.keys())}")

        date_str = date.strftime('%Y/%m/%d')
        return f"{prefix}/{date_str}"

    def _get_output_path(self, symbol: str, date: datetime, data_type: str) -> Path:
        """Generate local output path for a symbol's data."""
        date_str = date.strftime('%Y%m%d')
        return self.data_dir / data_type / symbol / f"{symbol}_{date_str}.parquet"

    def _decompress_stream(self, compressed_data: bytes) -> bytes:
        """Decompress zstd compressed data."""
        return self.dctx.decompress(compressed_data)

    def _filter_and_save(
        self,
        data: bytes,
        symbol: str,
        date: datetime,
        data_type: str
    ) -> tuple[Path, int]:
        """Filter data for symbol and save as Parquet."""
        # Read CSV data into Polars
        # Polygon flat files are CSV with specific columns
        df = pl.read_csv(
            io.BytesIO(data),
            has_header=True,
            ignore_errors=True,  # Skip malformed rows
        )

        # Filter for our symbol
        # Column name varies by data type
        symbol_col = 'ticker' if 'ticker' in df.columns else 'sym'
        if symbol_col in df.columns:
            df = df.filter(pl.col(symbol_col) == symbol)

        if df.is_empty():
            return None, 0

        # Ensure output directory exists
        output_path = self._get_output_path(symbol, date, data_type)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Save as Parquet (highly compressed, fast read)
        df.write_parquet(
            output_path,
            compression='zstd',
            compression_level=3
        )

        return output_path, len(df)

    def _update_index(
        self,
        symbol: str,
        date: datetime,
        data_type: str,
        file_path: Path,
        row_count: int
    ):
        """Update Supabase local_data_index."""
        if not self.supabase:
            return

        try:
            # Use relative path from data_dir
            relative_path = str(file_path.relative_to(self.data_dir))
            file_size = file_path.stat().st_size if file_path.exists() else 0

            # Upsert to handle re-downloads
            self.supabase.table('local_data_index').upsert({
                'symbol': symbol,
                'date': date.strftime('%Y-%m-%d'),
                'data_type': data_type,
                'file_path': relative_path,
                'size_bytes': file_size,
                'row_count': row_count,
                'is_complete': True,
                'source': 'massive.com',
                'downloaded_at': datetime.utcnow().isoformat()
            }, on_conflict='symbol,date,data_type').execute()

        except Exception as e:
            logger.error(f"Failed to update index for {symbol}/{date}: {e}")

    def download_day(
        self,
        date: datetime,
        data_type: str = 'stocks_trades',
        tickers: Optional[list[str]] = None
    ) -> dict:
        """
        Download a single day's data from Massive.com.

        Args:
            date: Date to download
            data_type: Type of data (stocks_trades, stocks_quotes, etc.)
            tickers: Optional override of tickers to download

        Returns:
            Dict with download stats
        """
        target_tickers = set(tickers or self.tickers)
        s3_prefix = self._get_s3_key(date, data_type)

        logger.info(f"📥 Downloading {data_type} for {date.strftime('%Y-%m-%d')}")
        logger.info(f"   Filtering for {len(target_tickers)} tickers")

        stats = {
            'date': date.strftime('%Y-%m-%d'),
            'data_type': data_type,
            'files_processed': 0,
            'symbols_saved': 0,
            'total_rows': 0,
            'total_bytes': 0,
            'errors': []
        }

        try:
            # List objects in the date prefix
            paginator = self.s3.get_paginator('list_objects_v2')

            for page in paginator.paginate(Bucket=MASSIVE_S3_BUCKET, Prefix=s3_prefix):
                for obj in page.get('Contents', []):
                    key = obj['Key']

                    # Skip non-data files
                    if not key.endswith('.csv.zst'):
                        continue

                    logger.info(f"   Processing: {key}")
                    stats['files_processed'] += 1

                    try:
                        # Stream download with zstd decompression
                        response = self.s3.get_object(Bucket=MASSIVE_S3_BUCKET, Key=key)
                        compressed_data = response['Body'].read()

                        # Decompress
                        csv_data = self._decompress_stream(compressed_data)

                        # Process each ticker
                        for ticker in target_tickers:
                            try:
                                result = self._filter_and_save(
                                    csv_data,
                                    ticker,
                                    date,
                                    data_type
                                )

                                if result[0]:
                                    output_path, row_count = result
                                    stats['symbols_saved'] += 1
                                    stats['total_rows'] += row_count
                                    stats['total_bytes'] += output_path.stat().st_size

                                    # Update Supabase index
                                    self._update_index(
                                        ticker,
                                        date,
                                        data_type,
                                        output_path,
                                        row_count
                                    )

                                    logger.info(f"   ✅ {ticker}: {row_count:,} rows")

                            except Exception as e:
                                error_msg = f"{ticker}: {str(e)}"
                                stats['errors'].append(error_msg)
                                logger.error(f"   ❌ {error_msg}")

                    except Exception as e:
                        error_msg = f"File {key}: {str(e)}"
                        stats['errors'].append(error_msg)
                        logger.error(f"   ❌ {error_msg}")

        except Exception as e:
            stats['errors'].append(f"S3 access error: {str(e)}")
            logger.error(f"❌ Failed to access S3: {e}")

        # Summary
        logger.info(f"📊 Day complete: {stats['symbols_saved']} symbols, "
                   f"{stats['total_rows']:,} rows, "
                   f"{stats['total_bytes'] / 1024 / 1024:.1f} MB")

        return stats

    def download_range(
        self,
        start_date: datetime,
        end_date: datetime,
        data_type: str = 'stocks_trades',
        tickers: Optional[list[str]] = None
    ) -> list[dict]:
        """Download a range of dates."""
        results = []
        current = start_date

        while current <= end_date:
            # Skip weekends
            if current.weekday() < 5:
                result = self.download_day(current, data_type, tickers)
                results.append(result)

            current += timedelta(days=1)

        return results

    def get_local_inventory(self, data_type: Optional[str] = None) -> dict:
        """Get inventory of locally available data."""
        inventory = {}

        search_dirs = [self.data_dir / data_type] if data_type else [
            self.data_dir / dt for dt in DATA_TYPE_PREFIXES.keys()
        ]

        for search_dir in search_dirs:
            if not search_dir.exists():
                continue

            for parquet_file in search_dir.rglob('*.parquet'):
                # Parse filename: {TICKER}_{YYYYMMDD}.parquet
                parts = parquet_file.stem.split('_')
                if len(parts) >= 2:
                    symbol = parts[0]
                    date_str = parts[1]

                    if symbol not in inventory:
                        inventory[symbol] = []
                    inventory[symbol].append(date_str)

        return inventory


def main():
    parser = argparse.ArgumentParser(description='Massive.com Data Ingestor')
    parser.add_argument('--date', type=str, help='Single date to download (YYYY-MM-DD)')
    parser.add_argument('--start', type=str, help='Start date for range (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, help='End date for range (YYYY-MM-DD)')
    parser.add_argument('--type', type=str, default='stocks_trades',
                       choices=list(DATA_TYPE_PREFIXES.keys()),
                       help='Data type to download')
    parser.add_argument('--tickers', type=str, help='Comma-separated list of tickers')
    parser.add_argument('--data-dir', type=str, default=os.environ.get('DATA_DIR', './data'),
                       help='Local data directory')
    parser.add_argument('--inventory', action='store_true',
                       help='Show local data inventory and exit')

    args = parser.parse_args()

    # Get credentials from environment
    massive_key = os.environ.get('MASSIVE_KEY')
    if not massive_key and not args.inventory:
        logger.error("MASSIVE_KEY environment variable required")
        sys.exit(1)

    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

    # Parse tickers
    tickers = args.tickers.split(',') if args.tickers else None

    # Initialize ingestor
    ingestor = MassiveIngestor(
        massive_key=massive_key or 'dummy',
        data_dir=args.data_dir,
        supabase_url=supabase_url,
        supabase_key=supabase_key,
        tickers=tickers
    )

    # Show inventory if requested
    if args.inventory:
        inventory = ingestor.get_local_inventory(args.type)
        print(f"\n📁 Local Data Inventory ({args.data_dir}):\n")
        for symbol, dates in sorted(inventory.items()):
            print(f"  {symbol}: {len(dates)} days ({min(dates)} to {max(dates)})")
        return

    # Download data
    if args.date:
        date = datetime.strptime(args.date, '%Y-%m-%d')
        ingestor.download_day(date, args.type, tickers)
    elif args.start and args.end:
        start = datetime.strptime(args.start, '%Y-%m-%d')
        end = datetime.strptime(args.end, '%Y-%m-%d')
        ingestor.download_range(start, end, args.type, tickers)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
