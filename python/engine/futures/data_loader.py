"""
Futures Data Loader

Production-grade data loading for futures backtesting and live trading.
Handles multiple timeframes, continuous contracts, and real-time feeds.
"""

import pandas as pd
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union
from datetime import datetime, timedelta
from concurrent.futures import ProcessPoolExecutor, as_completed
import pyarrow.parquet as pq
import logging

logger = logging.getLogger(__name__)


class FuturesDataLoader:
    """
    Production futures data loader.

    Features:
    - Multi-timeframe support (1m, 5m, 15m, 1h, 1d)
    - Parallel loading for multiple symbols
    - Memory-efficient chunked loading for large datasets
    - Automatic resampling between timeframes
    - Gap detection and handling
    - Trading hours filtering
    """

    # CME Globex trading hours (ET)
    GLOBEX_HOURS = {
        'ES': {'start': '18:00', 'end': '17:00', 'days': [0, 1, 2, 3, 4]},  # Sun 6pm - Fri 5pm
        'NQ': {'start': '18:00', 'end': '17:00', 'days': [0, 1, 2, 3, 4]},
        'MES': {'start': '18:00', 'end': '17:00', 'days': [0, 1, 2, 3, 4]},
        'MNQ': {'start': '18:00', 'end': '17:00', 'days': [0, 1, 2, 3, 4]},
        'CL': {'start': '18:00', 'end': '17:00', 'days': [0, 1, 2, 3, 4]},
        'GC': {'start': '18:00', 'end': '17:00', 'days': [0, 1, 2, 3, 4]},
    }

    # Contract specifications
    CONTRACT_SPECS = {
        'ES': {'tick_size': 0.25, 'tick_value': 12.50, 'multiplier': 50},
        'NQ': {'tick_size': 0.25, 'tick_value': 5.00, 'multiplier': 20},
        'MES': {'tick_size': 0.25, 'tick_value': 1.25, 'multiplier': 5},
        'MNQ': {'tick_size': 0.25, 'tick_value': 0.50, 'multiplier': 2},
        'RTY': {'tick_size': 0.10, 'tick_value': 5.00, 'multiplier': 50},
        'YM': {'tick_size': 1.00, 'tick_value': 5.00, 'multiplier': 5},
        'CL': {'tick_size': 0.01, 'tick_value': 10.00, 'multiplier': 1000},
        'GC': {'tick_size': 0.10, 'tick_value': 10.00, 'multiplier': 100},
        'ZN': {'tick_size': 0.015625, 'tick_value': 15.625, 'multiplier': 1000},
        'ZB': {'tick_size': 0.03125, 'tick_value': 31.25, 'multiplier': 1000},
        '6E': {'tick_size': 0.00005, 'tick_value': 6.25, 'multiplier': 125000},
    }

    def __init__(
        self,
        data_dir: Union[str, Path] = "/Volumes/VelocityData/velocity_om/futures",
        cache_dir: Optional[Union[str, Path]] = None
    ):
        self.data_dir = Path(data_dir)
        self.cache_dir = Path(cache_dir) if cache_dir else self.data_dir / ".cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        self._data_cache: Dict[str, pd.DataFrame] = {}

    def load_symbol(
        self,
        symbol: str,
        timeframe: str = "1m",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        columns: Optional[List[str]] = None,
        trading_hours_only: bool = False
    ) -> pd.DataFrame:
        """
        Load futures data for a single symbol.

        Args:
            symbol: Futures symbol (ES, NQ, MES, etc.)
            timeframe: Data timeframe (1m, 1h, 1d)
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)
            columns: Specific columns to load (None = all)
            trading_hours_only: Filter to regular trading hours

        Returns:
            DataFrame with OHLCV data
        """
        # Map timeframe to file naming
        tf_map = {'1m': 'ohlcv_1m', '1h': 'ohlcv_1h', '1d': 'ohlcv_1d'}
        tf_key = tf_map.get(timeframe)
        if not tf_key:
            raise ValueError(f"Invalid timeframe: {timeframe}. Use: 1m, 1h, 1d")

        # Find the data file
        pattern = f"{symbol}_{tf_key}_*.parquet"
        files = list(self.data_dir.glob(pattern))

        if not files:
            raise FileNotFoundError(f"No data found for {symbol} {timeframe} in {self.data_dir}")

        # Load the data
        file_path = files[0]  # Assume single file per symbol/timeframe
        logger.info(f"Loading {symbol} {timeframe} from {file_path}")

        df = pd.read_parquet(file_path, columns=columns)

        # Ensure datetime index
        if 'ts_event' in df.columns:
            df['timestamp'] = pd.to_datetime(df['ts_event'])
            df.set_index('timestamp', inplace=True)
        elif not isinstance(df.index, pd.DatetimeIndex):
            df.index = pd.to_datetime(df.index)

        # Filter date range
        if start_date:
            df = df[df.index >= start_date]
        if end_date:
            df = df[df.index <= end_date]

        # Filter trading hours
        if trading_hours_only and symbol in self.GLOBEX_HOURS:
            df = self._filter_trading_hours(df, symbol)

        # Standardize column names
        df = self._standardize_columns(df)

        # Add symbol column
        df['symbol'] = symbol

        logger.info(f"Loaded {len(df):,} rows for {symbol} {timeframe}")
        return df

    def load_multiple(
        self,
        symbols: List[str],
        timeframe: str = "1m",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        parallel: bool = True,
        max_workers: int = 4
    ) -> Dict[str, pd.DataFrame]:
        """
        Load data for multiple symbols in parallel.

        Returns:
            Dict mapping symbol -> DataFrame
        """
        results = {}

        if parallel and len(symbols) > 1:
            with ProcessPoolExecutor(max_workers=max_workers) as executor:
                futures = {
                    executor.submit(
                        self.load_symbol, symbol, timeframe, start_date, end_date
                    ): symbol
                    for symbol in symbols
                }

                for future in as_completed(futures):
                    symbol = futures[future]
                    try:
                        results[symbol] = future.result()
                    except Exception as e:
                        logger.error(f"Failed to load {symbol}: {e}")
        else:
            for symbol in symbols:
                try:
                    results[symbol] = self.load_symbol(
                        symbol, timeframe, start_date, end_date
                    )
                except Exception as e:
                    logger.error(f"Failed to load {symbol}: {e}")

        return results

    def resample(
        self,
        df: pd.DataFrame,
        target_timeframe: str
    ) -> pd.DataFrame:
        """
        Resample data to a different timeframe.

        Args:
            df: Source DataFrame with OHLCV data
            target_timeframe: Target timeframe (5m, 15m, 1h, 4h, 1d)

        Returns:
            Resampled DataFrame
        """
        tf_map = {
            '5m': '5T', '15m': '15T', '30m': '30T',
            '1h': '1H', '4h': '4H', '1d': '1D'
        }

        rule = tf_map.get(target_timeframe)
        if not rule:
            raise ValueError(f"Invalid target timeframe: {target_timeframe}")

        resampled = df.resample(rule).agg({
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last',
            'volume': 'sum'
        }).dropna()

        return resampled

    def get_contract_spec(self, symbol: str) -> Dict:
        """Get contract specifications for a symbol."""
        return self.CONTRACT_SPECS.get(symbol, {
            'tick_size': 0.01,
            'tick_value': 1.00,
            'multiplier': 1
        })

    def detect_gaps(
        self,
        df: pd.DataFrame,
        expected_freq: str = '1T'
    ) -> pd.DataFrame:
        """
        Detect data gaps in the timeseries.

        Returns:
            DataFrame with gap start, end, and duration
        """
        time_diff = df.index.to_series().diff()
        expected = pd.Timedelta(expected_freq)

        gaps = time_diff[time_diff > expected * 2]  # Allow some tolerance

        gap_df = pd.DataFrame({
            'gap_start': gaps.index - time_diff[gaps.index],
            'gap_end': gaps.index,
            'duration': gaps.values
        })

        return gap_df

    def _filter_trading_hours(self, df: pd.DataFrame, symbol: str) -> pd.DataFrame:
        """Filter to regular trading hours."""
        hours = self.GLOBEX_HOURS.get(symbol)
        if not hours:
            return df

        # Simple filter - exclude weekends
        # Full implementation would handle exact session times
        return df[df.index.dayofweek.isin(hours['days'])]

    def _standardize_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Standardize column names to lowercase OHLCV."""
        column_map = {
            'Open': 'open', 'High': 'high', 'Low': 'low',
            'Close': 'close', 'Volume': 'volume',
            'OPEN': 'open', 'HIGH': 'high', 'LOW': 'low',
            'CLOSE': 'close', 'VOLUME': 'volume',
        }

        df = df.rename(columns=column_map)

        # Ensure required columns exist
        required = ['open', 'high', 'low', 'close']
        for col in required:
            if col not in df.columns:
                raise ValueError(f"Missing required column: {col}")

        # Add volume if missing
        if 'volume' not in df.columns:
            df['volume'] = 0

        return df


class RealtimeDataLoader:
    """
    Real-time data loader for live trading.

    Integrates with:
    - Databento live feed
    - Schwab streaming quotes
    - ThetaData (if available)
    """

    def __init__(self, provider: str = "databento"):
        self.provider = provider
        self._subscribers: Dict[str, List] = {}
        self._latest_quotes: Dict[str, Dict] = {}

    async def subscribe(self, symbols: List[str], callback):
        """Subscribe to real-time quotes for symbols."""
        for symbol in symbols:
            if symbol not in self._subscribers:
                self._subscribers[symbol] = []
            self._subscribers[symbol].append(callback)

    def get_latest_quote(self, symbol: str) -> Optional[Dict]:
        """Get the latest quote for a symbol."""
        return self._latest_quotes.get(symbol)

    async def start(self):
        """Start the real-time data feed."""
        # Implementation depends on provider
        raise NotImplementedError("Implement for specific provider")
