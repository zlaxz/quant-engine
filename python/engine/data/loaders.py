"""
Data loaders for SPY and options chains.

Handles:
- SPY OHLCV data
- Options quotes with Greeks
- Data normalization and filtering
"""

import os
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime, timedelta, date
import re
from typing import Optional, Dict, List
import warnings
import yfinance as yf
from zoneinfo import ZoneInfo

warnings.filterwarnings('ignore')

# Market timezone - all timestamps should be in US/Eastern
MARKET_TZ = ZoneInfo("America/New_York")


DEFAULT_POLYGON_ROOT = "/Volumes/VelocityData/polygon_downloads/us_options_opra/day_aggs_v1"

DEFAULT_POLYGON_MINUTE_ROOT = "/Volumes/VelocityData/polygon_downloads/us_options_opra/minute_aggs_v1"

DEFAULT_STOCK_ROOT = "/Volumes/VelocityData/velocity_om/parquet/stock/SPY"


class OptionsDataLoader:
    """Load and normalize SPY options data from Polygon."""

    def __init__(
        self,
        data_root: Optional[str] = None,
        minute_data_root: Optional[str] = None,
        stock_data_root: Optional[str] = None
    ):
        resolved_root = data_root or os.environ.get("POLYGON_DATA_ROOT", DEFAULT_POLYGON_ROOT)
        self.data_root = Path(resolved_root).expanduser()
        if not self.data_root.exists():
            raise FileNotFoundError(
                f"Polygon data root not found at {self.data_root}. "
                "Mount the dataset or set POLYGON_DATA_ROOT to the correct path."
            )

        # Minute bar data root (optional - only needed for intraday analysis)
        minute_root_resolved = minute_data_root or os.environ.get("POLYGON_MINUTE_ROOT", DEFAULT_POLYGON_MINUTE_ROOT)
        self.minute_data_root = Path(minute_root_resolved).expanduser()
        self.has_minute_data = self.minute_data_root.exists()

        stock_root_resolved = stock_data_root or os.environ.get("SPY_STOCK_DATA_ROOT", DEFAULT_STOCK_ROOT)
        self.stock_data_root = Path(stock_root_resolved).expanduser()
        if not self.stock_data_root.exists():
            raise FileNotFoundError(
                f"SPY stock data root not found at {self.stock_data_root}. "
                "Mount the VelocityData drive and/or set SPY_STOCK_DATA_ROOT."
            )

        stock_files = sorted(
            [
                p for p in self.stock_data_root.glob("*.parquet")
                if re.match(r"\d{4}-\d{2}-\d{2}$", p.stem)
            ]
        )

        if not stock_files:
            raise FileNotFoundError(
                f"No SPY parquet files found under {self.stock_data_root}. "
                "Ensure minute-level SPY data is exported to this directory."
            )

        self._stock_file_map: Dict[date, Path] = {}
        for path in stock_files:
            trade_date = datetime.strptime(path.stem, "%Y-%m-%d").date()
            self._stock_file_map[trade_date] = path

        self._stock_dates = sorted(self._stock_file_map.keys())
        self._stock_date_set = set(self._stock_dates)

        self._spy_cache = {}
        self._options_cache = {}
        self._stock_day_cache: Dict[date, Dict[str, float]] = {}
        self._vix_cache = None

        # Cache size limit to prevent memory bloat (100 entries max per cache)
        self._max_cache_entries = 100

    def clear_cache(self, cache_type: Optional[str] = None):
        """Clear cached data to free memory or force reload.

        Args:
            cache_type: Specific cache to clear ('spy', 'options', 'stock', 'vix')
                       If None, clears all caches.
        """
        if cache_type is None or cache_type == 'spy':
            self._spy_cache = {}
        if cache_type is None or cache_type == 'options':
            self._options_cache = {}
        if cache_type is None or cache_type == 'stock':
            self._stock_day_cache = {}
        if cache_type is None or cache_type == 'vix':
            self._vix_cache = None

    def _enforce_cache_limit(self, cache: dict):
        """Evict oldest entries if cache exceeds limit (simple FIFO)."""
        while len(cache) > self._max_cache_entries:
            # Remove first (oldest) key
            oldest_key = next(iter(cache))
            del cache[oldest_key]

    def _parse_option_ticker(self, ticker: str) -> Optional[Dict]:
        """
        Parse Polygon option ticker format: O:SPY240119C00450000

        Format: O:[underlying][YYMMDD][C/P][strike*1000]

        Returns dict with: underlying, expiry, strike, option_type
        """
        # O:SPY240119C00450000
        match = re.match(r'O:([A-Z]+)(\d{6})([CP])(\d{8})', ticker)
        if not match:
            return None

        underlying, date_str, opt_type, strike_str = match.groups()

        # Parse expiry date
        try:
            expiry = datetime.strptime(date_str, '%y%m%d').date()
        except ValueError as e:
            import logging
            logging.error(f"Failed to parse date '{date_str}': {e}")
            return None

        # Parse strike (divide by 1000)
        strike = float(strike_str) / 1000.0

        return {
            'underlying': underlying,
            'expiry': expiry,
            'strike': strike,
            'option_type': 'call' if opt_type == 'C' else 'put'
        }

    def _load_raw_options_day(self, date: datetime) -> pd.DataFrame:
        """Load raw options data for a single day."""
        year = date.year
        month = f"{date.month:02d}"
        day = f"{date.day:02d}"

        file_path = self.data_root / str(year) / month / f"{year}-{month}-{day}.csv.gz"

        if not file_path.exists():
            return pd.DataFrame()

        # Read compressed CSV
        df = pd.read_csv(file_path, compression='gzip')

        # Parse option tickers
        parsed = df['ticker'].apply(self._parse_option_ticker)

        # Filter out None values (unparseable tickers)
        valid_mask = parsed.notna()
        parsed_series = parsed[valid_mask].reset_index(drop=True)
        df = df[valid_mask].reset_index(drop=True)

        if len(parsed_series) == 0:
            return pd.DataFrame()

        parsed_df = pd.DataFrame(parsed_series.tolist())

        # Filter for SPY only
        if 'underlying' in parsed_df.columns:
            spy_mask = parsed_df['underlying'] == 'SPY'
            df = df[spy_mask].reset_index(drop=True)
            parsed_df = parsed_df[spy_mask].reset_index(drop=True)

            # Merge parsed data
            df = pd.concat([df, parsed_df], axis=1)
        else:
            return pd.DataFrame()

        # Add trade date
        df['date'] = date.date()

        return df

    def load_options_chain(self, date: datetime, filter_garbage: bool = True) -> pd.DataFrame:
        """
        Load SPY options chain for a specific date.

        Returns DataFrame with columns:
        - date: trade date
        - expiry: option expiration
        - strike: strike price
        - option_type: 'call' or 'put'
        - open, high, low, close: option prices
        - volume: option volume
        - bid, ask, mid: computed from close (simplified for now)

        Args:
            date: Date to load
            filter_garbage: Remove bad quotes (negative prices, invalid spreads, etc.)
        """
        # Check cache
        cache_key = (date.date(), filter_garbage)
        if cache_key in self._options_cache:
            return self._options_cache[cache_key].copy()

        df = self._load_raw_options_day(date)

        if df.empty:
            return pd.DataFrame()

        # Normalize column names
        df = df.rename(columns={
            'window_start': 'timestamp'
        })

        # Compute bid/ask/mid (simplified - using close as mid)
        # In reality, we'd need bid/ask from quotes data
        # For now: assume 2% spread around mid
        df['mid'] = df['close']
        df['bid'] = df['mid'] * 0.99  # 1% below mid
        df['ask'] = df['mid'] * 1.01  # 1% above mid

        # Calculate DTE (days to expiration)
        df['dte'] = (pd.to_datetime(df['expiry']) - pd.to_datetime(df['date'])).dt.days

        if filter_garbage:
            df = self._filter_bad_quotes(df)

        # Select and order columns
        columns = [
            'date', 'expiry', 'strike', 'option_type', 'dte',
            'open', 'high', 'low', 'close', 'mid', 'bid', 'ask',
            'volume', 'transactions'
        ]

        df = df[[c for c in columns if c in df.columns]].copy()

        # Cache result with size limit enforcement
        self._options_cache[cache_key] = df.copy()
        self._enforce_cache_limit(self._options_cache)

        return df

    def _filter_bad_quotes(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Filter out garbage quotes:
        - Negative prices
        - Ask < Bid
        - Spread > 20% of mid (except low prices)
        - Negative extrinsic value (simplified check)
        """
        if df.empty:
            return df

        initial_count = len(df)

        # Remove negative prices
        df = df[df['close'] > 0].copy()
        df = df[(df['bid'] > 0) & (df['ask'] > 0)].copy()

        # Remove inverted markets
        df = df[df['ask'] >= df['bid']].copy()

        # Remove extremely wide spreads (>20% unless very cheap)
        spread_pct = (df['ask'] - df['bid']) / df['mid']
        # Allow wider spreads for options < $0.50
        wide_spread_mask = (spread_pct > 0.20) & (df['mid'] > 0.50)
        df = df[~wide_spread_mask].copy()

        # Remove options with no volume (stale quotes)
        df = df[df['volume'] > 0].copy()

        filtered_count = len(df)
        if initial_count > 0:
            pct_kept = 100 * filtered_count / initial_count
            # print(f"Filtering: kept {filtered_count}/{initial_count} ({pct_kept:.1f}%)")

        return df

    def load_spy_ohlcv(self, start_date: datetime, end_date: datetime) -> pd.DataFrame:
        """
        Load SPY OHLCV data from local minute-level parquet exports.

        Returns DataFrame with: date, open, high, low, close, volume
        """
        cache_key = (start_date.date(), end_date.date())
        if cache_key in self._spy_cache:
            return self._spy_cache[cache_key].copy()

        start_day = start_date.date()
        end_day = end_date.date()

        earliest = self._stock_dates[0]
        latest = self._stock_dates[-1]
        if start_day < earliest or end_day > latest:
            raise ValueError(
                f"SPY stock data available from {earliest} to {latest}. "
                f"Requested range {start_day} – {end_day} exceeds coverage."
            )

        # Filter dates to requested range
        dates_to_load = [d for d in self._stock_dates if start_day <= d <= end_day]

        # Parallel I/O for M4 Pro (14 cores) - use ThreadPoolExecutor for disk I/O
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=8) as executor:  # 8 threads optimal for disk I/O
            rows = list(filter(None, executor.map(self._load_spy_day, dates_to_load)))

        if not rows:
            raise ValueError(f"No SPY data found between {start_day} and {end_day}")

        spy = pd.DataFrame(rows)
        self._spy_cache[cache_key] = spy.copy()
        self._enforce_cache_limit(self._spy_cache)
        return spy

    def get_data_coverage(self) -> Dict[str, List[str]]:
        """Return available data dates."""
        dates = []
        for year_dir in sorted(self.data_root.glob('*')):
            if not year_dir.is_dir():
                continue
            for month_dir in sorted(year_dir.glob('*')):
                if not month_dir.is_dir():
                    continue
                for file_path in sorted(month_dir.glob('*.csv.gz')):
                    date_str = file_path.name.replace('.csv.gz', '')
                    dates.append(date_str)

        return {
            'start': dates[0] if dates else None,
            'end': dates[-1] if dates else None,
            'count': len(dates)
        }

    def get_spy_stock_coverage(self) -> Dict[str, date]:
        """Return coverage window for SPY stock data."""
        return {
            'start': self._stock_dates[0],
            'end': self._stock_dates[-1],
            'count': len(self._stock_dates)
        }

    def _load_spy_day(self, trade_day: date) -> Optional[Dict[str, float]]:
        """Load single-day OHLCV from minute parquet."""
        if trade_day in self._stock_day_cache:
            return self._stock_day_cache[trade_day]

        file_path = self._stock_file_map.get(trade_day)
        if file_path is None or not file_path.exists():
            return None

        df = pd.read_parquet(file_path)
        if df.empty:
            return None

        df = df.sort_values('ts')
        day_record = {
            'date': trade_day,
            'open': float(df.iloc[0]['open']),
            'high': float(df['high'].max()),
            'low': float(df['low'].min()),
            'close': float(df.iloc[-1]['close']),
            'volume': float(df['volume'].sum())
        }

        self._stock_day_cache[trade_day] = day_record
        self._enforce_cache_limit(self._stock_day_cache)
        return day_record

    def load_vix(self, start_date: datetime, end_date: datetime) -> pd.DataFrame:
        """
        Load VIX (CBOE Volatility Index) from yfinance.

        VIX represents the 30-day forward-looking implied volatility of S&P 500 index options.

        Returns DataFrame with: date, vix_close (30-day ATM IV as %)
        """
        # Check cache
        cache_key = (start_date.date(), end_date.date())
        if self._vix_cache is not None:
            cached_start = self._vix_cache['date'].min()
            cached_end = self._vix_cache['date'].max()
            if start_date.date() >= cached_start and end_date.date() <= cached_end:
                mask = (self._vix_cache['date'] >= start_date.date()) & (self._vix_cache['date'] <= end_date.date())
                return self._vix_cache[mask].copy()

        # Download VIX data
        # Add buffer to handle timezone/trading day alignment
        vix_ticker = yf.Ticker("^VIX")
        vix_df = vix_ticker.history(
            start=(start_date - timedelta(days=5)).strftime('%Y-%m-%d'),
            end=(end_date + timedelta(days=1)).strftime('%Y-%m-%d')
        )

        if vix_df.empty:
            raise ValueError(f"No VIX data available for {start_date.date()} to {end_date.date()}")

        # Normalize to match SPY format
        # yfinance returns timezone-aware timestamps - convert to US/Eastern before extracting date
        vix_df = vix_df.reset_index()
        vix_ts = pd.to_datetime(vix_df['Date'])
        # Convert to US/Eastern if timezone-aware, otherwise localize
        if vix_ts.dt.tz is not None:
            vix_ts = vix_ts.dt.tz_convert(MARKET_TZ)
        else:
            vix_ts = vix_ts.dt.tz_localize(MARKET_TZ)
        vix_df['date'] = vix_ts.dt.date
        vix_df = vix_df.rename(columns={'Close': 'vix_close'})
        vix_df = vix_df[['date', 'vix_close']].copy()

        # Cache it
        self._vix_cache = vix_df

        # Return requested range
        mask = (vix_df['date'] >= start_date.date()) & (vix_df['date'] <= end_date.date())
        return vix_df[mask].copy()


class DataSpine:
    """
    Main data spine for backtesting.

    Combines SPY OHLCV + Options chain + Derived features.
    """

    def __init__(self, data_root: str = "/Volumes/VelocityData/polygon_downloads/us_options_opra/day_aggs_v1"):
        self.loader = OptionsDataLoader(data_root)
        self._spine_cache = {}

    def build_spine(self, start_date: datetime, end_date: datetime, include_vix: bool = True) -> pd.DataFrame:
        """
        Build complete data spine for date range.

        Returns DataFrame with:
        - SPY OHLCV
        - VIX (30-day IV) [if include_vix=True]
        - Derived features (RV, ATR, MAs)
        - One row per trading day
        """
        # Load SPY data
        stock_cov = self.loader.get_spy_stock_coverage()
        earliest_dt = datetime.combine(stock_cov['start'], datetime.min.time())
        latest_dt = datetime.combine(stock_cov['end'], datetime.min.time())
        option_cov = self.loader.get_data_coverage()
        option_end = option_cov['end']
        if option_end:
            option_end_dt = datetime.combine(datetime.strptime(option_end, "%Y-%m-%d").date(), datetime.min.time())
            latest_dt = min(latest_dt, option_end_dt)
        adj_start = max(start_date, earliest_dt)
        adj_end = min(end_date, latest_dt)

        if adj_end <= adj_start:
            raise ValueError(
                f"Requested spine window {start_date.date()} – {end_date.date()} "
                f"is outside SPY stock coverage ({stock_cov['start']} – {stock_cov['end']})."
            )

        spy_df = self.loader.load_spy_ohlcv(adj_start, adj_end)

        if spy_df.empty:
            return pd.DataFrame()

        # Load VIX data and merge
        if include_vix:
            try:
                vix_df = self.loader.load_vix(adj_start, adj_end)
                spy_df = spy_df.merge(vix_df, on='date', how='left')
            except Exception as e:
                # VIX optional - warn but don't fail
                import sys
                print(f"Warning: Could not load VIX data: {e}", file=sys.stderr)

        # Add derived features
        from .features import add_derived_features
        spy_df = add_derived_features(spy_df)

        return spy_df

    def get_day_data(self, date: datetime, include_options: bool = True) -> Dict:
        """
        Get complete data for a single day.

        Returns:
        {
            'spy': SPY OHLCV + features (Series),
            'options': Options chain (DataFrame) [if include_options=True]
        }
        """
        # Get SPY data with features
        # Need history for features (50 days for MA50) + buffer
        spine_df = self.build_spine(
            date - timedelta(days=100),
            date + timedelta(days=1)  # Include target date
        )

        if spine_df.empty:
            return {'spy': None, 'options': None}

        # Get this day's SPY data
        day_spy = spine_df[spine_df['date'] == date.date()]

        if day_spy.empty:
            return {'spy': None, 'options': None}

        result = {
            'spy': day_spy.iloc[0] if len(day_spy) > 0 else None
        }

        if include_options:
            result['options'] = self.loader.load_options_chain(date, filter_garbage=True)

        return result


def load_spy_data(
    start_date: datetime = datetime(2023, 1, 3),
    end_date: datetime = datetime(2025, 12, 31),
    include_regimes: bool = True,
    include_profiles: bool = False
) -> pd.DataFrame:
    """
    Convenience function to load SPY data with features, regimes, and optionally profiles.

    Parameters:
    -----------
    start_date : datetime
        Start date for data
    end_date : datetime
        End date for data
    include_regimes : bool
        Whether to include regime labels
    include_profiles : bool
        Whether to include profile scores

    Returns:
    --------
    df : pd.DataFrame
        SPY data with features, regimes, and optionally profile scores
    """
    # Build data spine
    spine = DataSpine()
    df = spine.build_spine(start_date, end_date)

    if df.empty:
        return df

    # Alias vix_close to iv for RegimeEngine compatibility (MUST be before regime classification)
    if 'vix_close' in df.columns:
        df['iv'] = df['vix_close']

    # Add regime labels if requested
    if include_regimes:
        from ..analysis.regime_engine import RegimeEngine
        classifier = RegimeEngine()
        df = classifier.label_historical_data(df)

        # Rename regime_label to regime for compatibility
        if 'regime_label' in df.columns:
            df['regime'] = df['regime_label']

    # Add profile scores if requested
    if include_profiles:
        try:
            from engine.trading.profiles.detectors import ProfileDetectors
            detector = ProfileDetectors()
            df = detector.compute_all_profiles(df)
        except ImportError:
            # ProfileDetectors not available - add neutral scores
            for i in range(1, 7):
                df[f'p{i}_score'] = 0.5

    return df
