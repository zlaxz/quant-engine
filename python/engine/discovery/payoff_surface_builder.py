#!/usr/bin/env python3
"""
Payoff Surface Builder: Pre-compute Daily Options Payoffs

The bottleneck in structure discovery is backtesting. Instead of simulating
394M options trades one by one, we pre-compute a "payoff surface" for each day:

    payoff_surface[date][structure_key] = realized_pnl

This turns backtest from O(n_options * n_days) to O(n_days) matrix lookup.

Pre-computation takes ~1 hour once, then backtests run in seconds.
"""

import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from concurrent.futures import ProcessPoolExecutor
import multiprocessing as mp

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

logger = logging.getLogger("AlphaFactory.PayoffSurface")

# ============================================================================
# OCC TICKER PARSER
# ============================================================================

# OCC Format: O:SPY200110P00284000
# O:{ROOT}{YYMMDD}{C/P}{STRIKE*1000 padded to 8 digits}
OCC_PATTERN = re.compile(
    r'^O:([A-Z]+)(\d{6})([CP])(\d{8})$'
)


@dataclass
class ParsedOption:
    """Parsed OCC option ticker."""
    symbol: str
    expiry: datetime
    option_type: str  # 'C' or 'P'
    strike: float
    ticker: str

    @property
    def is_call(self) -> bool:
        return self.option_type == 'C'

    @property
    def is_put(self) -> bool:
        return self.option_type == 'P'


def parse_occ_ticker(ticker: str) -> Optional[ParsedOption]:
    """
    Parse OCC option ticker into components.

    Examples:
        O:SPY200110P00284000 -> SPY, 2020-01-10, Put, 284.00
        O:DIA201218C00302000 -> DIA, 2020-12-18, Call, 302.00
    """
    match = OCC_PATTERN.match(ticker)
    if not match:
        return None

    symbol, date_str, opt_type, strike_str = match.groups()

    # Parse date (YYMMDD)
    try:
        expiry = datetime.strptime(date_str, '%y%m%d')
    except ValueError:
        return None

    # Parse strike (8 digits = dollars * 1000)
    strike = int(strike_str) / 1000.0

    return ParsedOption(
        symbol=symbol,
        expiry=expiry,
        option_type=opt_type,
        strike=strike,
        ticker=ticker
    )


# ============================================================================
# PAYOFF CALCULATIONS
# ============================================================================

def compute_option_payoff(
    option: ParsedOption,
    entry_price: float,
    exit_price: float,
    spot_at_entry: float,
    spot_at_exit: float,
    held_to_expiry: bool = False
) -> float:
    """
    Compute option P&L from entry to exit.

    For held-to-expiry, uses intrinsic value.
    Otherwise uses price difference.
    """
    if held_to_expiry:
        # Intrinsic value at expiry
        if option.is_call:
            exit_value = max(0, spot_at_exit - option.strike)
        else:
            exit_value = max(0, option.strike - spot_at_exit)
        # P&L = intrinsic - premium paid (per contract = 100 shares)
        return (exit_value - entry_price) * 100
    else:
        # Price-based P&L
        return (exit_price - entry_price) * 100


def compute_structure_payoff(
    legs: List[Tuple[ParsedOption, int, float, float]],  # (option, qty, entry_price, exit_price)
    spot_at_entry: float,
    spot_at_exit: float,
    held_to_expiry: bool = False
) -> float:
    """
    Compute total P&L for a multi-leg structure.

    Args:
        legs: List of (option, quantity, entry_price, exit_price)
              quantity is positive for long, negative for short
    """
    total_pnl = 0.0
    for option, qty, entry_px, exit_px in legs:
        leg_pnl = compute_option_payoff(
            option, entry_px, exit_px,
            spot_at_entry, spot_at_exit, held_to_expiry
        )
        total_pnl += leg_pnl * qty
    return total_pnl


# ============================================================================
# DAILY OPTIONS SNAPSHOT
# ============================================================================

@dataclass
class DailyOptionsSnapshot:
    """All options data for a single day."""
    date: datetime
    symbol: str
    spot_price: float
    options: pd.DataFrame  # Parsed options with prices
    dte_groups: Dict[int, pd.DataFrame]  # Options grouped by DTE bucket


def load_daily_options(
    file_path: Path,
    symbol: str = 'SPY',
    spot_price: Optional[float] = None
) -> Optional[DailyOptionsSnapshot]:
    """
    Load and parse options from a single daily parquet file.

    Returns DailyOptionsSnapshot with parsed options.
    """
    try:
        df = pq.read_table(file_path).to_pandas()
    except Exception as e:
        logger.warning(f"Failed to read {file_path}: {e}")
        return None

    if df.empty:
        return None

    # Filter to target symbol
    df = df[df['ticker'].str.contains(f'^O:{symbol}', regex=True)]
    if df.empty:
        return None

    # Parse tickers
    parsed = []
    for _, row in df.iterrows():
        opt = parse_occ_ticker(row['ticker'])
        if opt and opt.symbol == symbol:
            parsed.append({
                'ticker': row['ticker'],
                'symbol': opt.symbol,
                'expiry': opt.expiry,
                'option_type': opt.option_type,
                'strike': opt.strike,
                'open': row['open'],
                'high': row['high'],
                'low': row['low'],
                'close': row['close'],
                'volume': row['volume'],
                'transactions': row['transactions'],
            })

    if not parsed:
        return None

    options_df = pd.DataFrame(parsed)

    # Extract date from filename
    date_str = file_path.stem  # e.g., "2020-01-02"
    try:
        trade_date = datetime.strptime(date_str, '%Y-%m-%d')
    except ValueError:
        logger.warning(f"Could not parse date from {file_path.name}")
        return None

    # Compute DTE
    options_df['dte'] = (options_df['expiry'] - trade_date).dt.days
    options_df = options_df[options_df['dte'] > 0]  # Filter expired

    if options_df.empty:
        return None

    # Group by DTE bucket (7d, 14d, 21d, 30d, 45d, 60d, 90d, 120d)
    DTE_BUCKETS = [7, 14, 21, 30, 45, 60, 90, 120]
    dte_groups = {}

    for bucket in DTE_BUCKETS:
        # Options within +/- 3 days of bucket
        mask = (options_df['dte'] >= bucket - 3) & (options_df['dte'] <= bucket + 3)
        group = options_df[mask]
        if not group.empty:
            dte_groups[bucket] = group

    return DailyOptionsSnapshot(
        date=trade_date,
        symbol=symbol,
        spot_price=spot_price or 0.0,  # Will be filled from stock data
        options=options_df,
        dte_groups=dte_groups
    )


# ============================================================================
# PAYOFF SURFACE BUILDER
# ============================================================================

class PayoffSurfaceBuilder:
    """
    Pre-compute daily payoff surfaces for fast backtesting.

    The surface maps:
        (date, structure_type, dte_bucket, delta_bucket) -> daily_return

    Structure types: ATM_CALL, ATM_PUT, ATM_STRADDLE, OTM_STRANGLE, etc.
    DTE buckets: 7, 14, 21, 30, 45, 60, 90, 120
    Delta buckets: ATM (50d), 25d, 10d, 5d
    """

    DTE_BUCKETS = [7, 14, 21, 30, 45, 60, 90, 120]
    DELTA_BUCKETS = ['ATM', '25D', '10D', '5D']

    # Structure types to pre-compute
    STRUCTURE_TYPES = [
        'LONG_CALL',
        'LONG_PUT',
        'SHORT_CALL',
        'SHORT_PUT',
        'LONG_STRADDLE',
        'SHORT_STRADDLE',
        'LONG_STRANGLE',
        'SHORT_STRANGLE',
        'CALL_DEBIT_SPREAD',
        'CALL_CREDIT_SPREAD',
        'PUT_DEBIT_SPREAD',
        'PUT_CREDIT_SPREAD',
        'IRON_CONDOR',
        'IRON_BUTTERFLY',
    ]

    def __init__(
        self,
        options_dir: Path,
        stock_data_path: Path,
        symbol: str = 'SPY',
        output_dir: Optional[Path] = None,
        n_workers: int = None
    ):
        """
        Initialize builder.

        Args:
            options_dir: Directory with daily options parquet files
            stock_data_path: Path to stock OHLCV parquet with spot prices
            symbol: Symbol to process (default SPY)
            output_dir: Where to save payoff surface (default options_dir/payoff_surfaces/)
            n_workers: Parallel workers (default CPU count)
        """
        self.options_dir = Path(options_dir)
        self.stock_data_path = Path(stock_data_path)
        self.symbol = symbol
        self.output_dir = output_dir or (self.options_dir.parent / 'payoff_surfaces')
        self.n_workers = n_workers or mp.cpu_count()

        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Load stock data for spot prices
        self.spot_prices = self._load_spot_prices()

    def _load_spot_prices(self) -> Dict[datetime, float]:
        """Load spot prices from stock data."""
        if not self.stock_data_path.exists():
            logger.warning(f"Stock data not found: {self.stock_data_path}")
            return {}

        try:
            df = pd.read_parquet(self.stock_data_path)
            # Normalize date column
            if 'date' in df.columns:
                df['date'] = pd.to_datetime(df['date'])
            elif 'timestamp' in df.columns:
                df['date'] = pd.to_datetime(df['timestamp'])
            else:
                df['date'] = df.index

            # Vectorized: avoid iterrows() for 10x speedup
            return dict(zip(pd.to_datetime(df['date']).dt.to_pydatetime(), df['close']))
        except Exception as e:
            logger.warning(f"Failed to load spot prices: {e}")
            return {}

    def _get_atm_options(
        self,
        options: pd.DataFrame,
        spot: float,
        dte_bucket: int
    ) -> Tuple[Optional[pd.Series], Optional[pd.Series]]:
        """
        Get ATM call and put for given DTE bucket.

        ATM = strike closest to current spot.
        """
        # Filter to DTE bucket (+/- 3 days)
        mask = (options['dte'] >= dte_bucket - 3) & (options['dte'] <= dte_bucket + 3)
        bucket = options[mask]

        if bucket.empty:
            return None, None

        # Find strike closest to spot
        bucket = bucket.copy()
        bucket['strike_dist'] = abs(bucket['strike'] - spot)
        atm_strike = bucket.loc[bucket['strike_dist'].idxmin(), 'strike']

        # Get call and put at ATM strike
        calls = bucket[(bucket['strike'] == atm_strike) & (bucket['option_type'] == 'C')]
        puts = bucket[(bucket['strike'] == atm_strike) & (bucket['option_type'] == 'P')]

        call = calls.iloc[0] if not calls.empty else None
        put = puts.iloc[0] if not puts.empty else None

        return call, put

    def _get_otm_options(
        self,
        options: pd.DataFrame,
        spot: float,
        dte_bucket: int,
        delta_target: str  # '25D', '10D', '5D'
    ) -> Tuple[Optional[pd.Series], Optional[pd.Series]]:
        """
        Get OTM call and put for given delta target.

        Uses moneyness as proxy for delta:
        - 25D call ~= 3% OTM
        - 10D call ~= 6% OTM
        - 5D call ~= 10% OTM
        """
        DELTA_TO_OTM = {
            '25D': 0.03,
            '10D': 0.06,
            '5D': 0.10,
        }
        otm_pct = DELTA_TO_OTM.get(delta_target, 0.05)

        # Filter to DTE bucket
        mask = (options['dte'] >= dte_bucket - 3) & (options['dte'] <= dte_bucket + 3)
        bucket = options[mask]

        if bucket.empty:
            return None, None

        # OTM call = strike > spot
        target_call_strike = spot * (1 + otm_pct)
        calls = bucket[bucket['option_type'] == 'C'].copy()
        if not calls.empty:
            calls['strike_dist'] = abs(calls['strike'] - target_call_strike)
            otm_call = calls.loc[calls['strike_dist'].idxmin()]
        else:
            otm_call = None

        # OTM put = strike < spot
        target_put_strike = spot * (1 - otm_pct)
        puts = bucket[bucket['option_type'] == 'P'].copy()
        if not puts.empty:
            puts['strike_dist'] = abs(puts['strike'] - target_put_strike)
            otm_put = puts.loc[puts['strike_dist'].idxmin()]
        else:
            otm_put = None

        return otm_call, otm_put

    def _compute_daily_payoffs(
        self,
        today: DailyOptionsSnapshot,
        tomorrow: DailyOptionsSnapshot
    ) -> Dict[str, float]:
        """
        Compute 1-day payoffs for all structure types.

        Returns dict mapping structure_key -> daily_pnl_pct
        """
        payoffs = {}
        spot_today = today.spot_price
        spot_tomorrow = tomorrow.spot_price

        if spot_today <= 0 or spot_tomorrow <= 0:
            return payoffs

        for dte in self.DTE_BUCKETS:
            # ATM structures
            call_today, put_today = self._get_atm_options(today.options, spot_today, dte)
            call_tomorrow, put_tomorrow = self._get_atm_options(tomorrow.options, spot_tomorrow, dte - 1)

            if call_today is not None and call_tomorrow is not None:
                # Long call daily return
                key = f"LONG_CALL_ATM_{dte}DTE"
                entry = call_today['close']
                exit_px = call_tomorrow['close']
                if entry > 0:
                    payoffs[key] = (exit_px - entry) / entry

                # Short call (inverted)
                key = f"SHORT_CALL_ATM_{dte}DTE"
                payoffs[key] = (entry - exit_px) / entry if entry > 0 else 0

            if put_today is not None and put_tomorrow is not None:
                key = f"LONG_PUT_ATM_{dte}DTE"
                entry = put_today['close']
                exit_px = put_tomorrow['close']
                if entry > 0:
                    payoffs[key] = (exit_px - entry) / entry

                key = f"SHORT_PUT_ATM_{dte}DTE"
                payoffs[key] = (entry - exit_px) / entry if entry > 0 else 0

            # Straddle
            if call_today is not None and put_today is not None:
                if call_tomorrow is not None and put_tomorrow is not None:
                    straddle_entry = call_today['close'] + put_today['close']
                    straddle_exit = call_tomorrow['close'] + put_tomorrow['close']
                    if straddle_entry > 0:
                        key = f"LONG_STRADDLE_ATM_{dte}DTE"
                        payoffs[key] = (straddle_exit - straddle_entry) / straddle_entry

                        key = f"SHORT_STRADDLE_ATM_{dte}DTE"
                        payoffs[key] = (straddle_entry - straddle_exit) / straddle_entry

            # OTM structures (strangles)
            for delta in ['25D', '10D', '5D']:
                otm_call_today, otm_put_today = self._get_otm_options(
                    today.options, spot_today, dte, delta
                )
                otm_call_tomorrow, otm_put_tomorrow = self._get_otm_options(
                    tomorrow.options, spot_tomorrow, dte - 1, delta
                )

                if all([otm_call_today is not None, otm_put_today is not None,
                        otm_call_tomorrow is not None, otm_put_tomorrow is not None]):
                    strangle_entry = otm_call_today['close'] + otm_put_today['close']
                    strangle_exit = otm_call_tomorrow['close'] + otm_put_tomorrow['close']
                    if strangle_entry > 0:
                        key = f"LONG_STRANGLE_{delta}_{dte}DTE"
                        payoffs[key] = (strangle_exit - strangle_entry) / strangle_entry

                        key = f"SHORT_STRANGLE_{delta}_{dte}DTE"
                        payoffs[key] = (strangle_entry - strangle_exit) / strangle_entry

        return payoffs

    def build_surface(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        save_daily: bool = True
    ) -> pd.DataFrame:
        """
        Build complete payoff surface for date range.

        Args:
            start_date: Start date (default: earliest available)
            end_date: End date (default: latest available)
            save_daily: Save intermediate results

        Returns:
            DataFrame with columns [date, structure_key, daily_return]
        """
        # Get all options files
        options_files = sorted(self.options_dir.glob('*.parquet'))
        logger.info(f"Found {len(options_files)} options files")

        if not options_files:
            raise ValueError(f"No parquet files in {self.options_dir}")

        # Filter to date range
        filtered_files = []
        for f in options_files:
            try:
                file_date = datetime.strptime(f.stem, '%Y-%m-%d')
                if start_date and file_date < start_date:
                    continue
                if end_date and file_date > end_date:
                    continue
                filtered_files.append(f)
            except ValueError:
                continue

        logger.info(f"Processing {len(filtered_files)} files in date range")

        # PARALLEL FILE LOADING for M4 Pro (14 cores)
        # Load all snapshots in parallel, then compute payoffs sequentially
        from concurrent.futures import ThreadPoolExecutor

        def load_snapshot(file_path):
            """Load a single day's options snapshot - designed for parallel I/O."""
            try:
                file_date = datetime.strptime(file_path.stem, '%Y-%m-%d')
                spot = self.spot_prices.get(file_date, 0)
                snapshot = load_daily_options(file_path, self.symbol, spot)
                return (file_date, snapshot)
            except Exception as e:
                logger.warning(f"Failed to load {file_path}: {e}")
                return (None, None)

        logger.info(f"Loading {len(filtered_files)} files in parallel...")
        with ThreadPoolExecutor(max_workers=8) as executor:  # 8 threads optimal for disk I/O
            loaded = list(executor.map(load_snapshot, filtered_files))

        # Build date-sorted snapshot dict (filter out failures)
        snapshots = {date: snap for date, snap in loaded if date is not None and snap is not None}
        sorted_dates = sorted(snapshots.keys())
        logger.info(f"Loaded {len(snapshots)} valid snapshots")

        # SEQUENTIAL payoff computation (needs consecutive days)
        all_payoffs = []
        for i in range(len(sorted_dates) - 1):
            prev_date = sorted_dates[i]
            curr_date = sorted_dates[i + 1]

            # Check if dates are consecutive (skip gaps > 5 days)
            if (curr_date - prev_date).days > 5:
                continue

            prev_snapshot = snapshots[prev_date]
            curr_snapshot = snapshots[curr_date]

            payoffs = self._compute_daily_payoffs(prev_snapshot, curr_snapshot)
            for key, ret in payoffs.items():
                all_payoffs.append({
                    'date': prev_snapshot.date,
                    'structure_key': key,
                    'daily_return': ret,
                    'spot': prev_snapshot.spot_price
                })

            if (i + 1) % 100 == 0:
                logger.info(f"Computed payoffs for {i + 1}/{len(sorted_dates) - 1} days")

        # Build DataFrame
        surface_df = pd.DataFrame(all_payoffs)

        if save_daily:
            output_path = self.output_dir / f'{self.symbol}_payoff_surface.parquet'
            surface_df.to_parquet(output_path, index=False)
            logger.info(f"Saved payoff surface to {output_path}")

        return surface_df

    def load_surface(self) -> pd.DataFrame:
        """Load pre-computed payoff surface."""
        path = self.output_dir / f'{self.symbol}_payoff_surface.parquet'
        if not path.exists():
            raise FileNotFoundError(f"Surface not found: {path}. Run build_surface() first.")
        return pd.read_parquet(path)


# ============================================================================
# FAST LOOKUP
# ============================================================================

class PayoffSurfaceLookup:
    """
    Fast lookup interface for backtesting.

    Usage:
        lookup = PayoffSurfaceLookup.from_parquet(path)
        returns = lookup.get_returns('LONG_STRADDLE_ATM_30DTE', start, end)
    """

    def __init__(self, surface_df: pd.DataFrame):
        """Initialize from DataFrame."""
        self.surface = surface_df.copy()
        self.surface['date'] = pd.to_datetime(self.surface['date'])
        self.surface.set_index('date', inplace=True)

        # Pivot to wide format for fast lookup
        self.wide = self.surface.pivot(columns='structure_key', values='daily_return')
        self.structure_keys = list(self.wide.columns)

        logger.info(f"Loaded surface with {len(self.structure_keys)} structures, "
                    f"{len(self.wide)} days")

    @classmethod
    def from_parquet(cls, path: Path) -> 'PayoffSurfaceLookup':
        """Load from parquet file."""
        df = pd.read_parquet(path)
        return cls(df)

    def get_returns(
        self,
        structure_key: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> pd.Series:
        """
        Get daily return series for a structure.

        Args:
            structure_key: e.g., 'LONG_STRADDLE_ATM_30DTE'
            start_date: Start of period
            end_date: End of period

        Returns:
            Series of daily returns
        """
        if structure_key not in self.wide.columns:
            raise KeyError(f"Unknown structure: {structure_key}. "
                           f"Available: {self.structure_keys[:5]}...")

        series = self.wide[structure_key]

        if start_date:
            series = series[series.index >= start_date]
        if end_date:
            series = series[series.index <= end_date]

        return series.dropna()

    def get_cumulative_returns(
        self,
        structure_key: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> pd.Series:
        """Get cumulative return series."""
        daily = self.get_returns(structure_key, start_date, end_date)
        return (1 + daily).cumprod() - 1

    def get_structure_stats(
        self,
        structure_key: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> Dict:
        """
        Get summary statistics for a structure.

        Returns dict with Sharpe, win_rate, max_drawdown, etc.
        """
        daily = self.get_returns(structure_key, start_date, end_date)

        if len(daily) < 20:
            return {'error': 'Insufficient data'}

        # Compute stats
        total_return = (1 + daily).prod() - 1
        ann_return = (1 + daily).prod() ** (252 / len(daily)) - 1
        ann_vol = daily.std() * np.sqrt(252)
        sharpe = ann_return / ann_vol if ann_vol > 0 else 0

        win_rate = (daily > 0).mean()

        # Max drawdown
        cum = (1 + daily).cumprod()
        rolling_max = cum.expanding().max()
        drawdown = (cum - rolling_max) / rolling_max
        max_dd = drawdown.min()

        return {
            'structure_key': structure_key,
            'n_days': len(daily),
            'total_return': total_return,
            'ann_return': ann_return,
            'ann_vol': ann_vol,
            'sharpe': sharpe,
            'win_rate': win_rate,
            'max_drawdown': max_dd,
            'avg_daily_return': daily.mean(),
            'skew': daily.skew(),
            'kurtosis': daily.kurtosis(),
        }

    def rank_structures(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        min_days: int = 100
    ) -> pd.DataFrame:
        """
        Rank all structures by Sharpe ratio.

        Returns DataFrame sorted by Sharpe.
        """
        results = []
        for key in self.structure_keys:
            try:
                stats = self.get_structure_stats(key, start_date, end_date)
                if 'error' not in stats and stats.get('n_days', 0) >= min_days:
                    results.append(stats)
            except Exception:
                continue

        if not results:
            return pd.DataFrame()

        df = pd.DataFrame(results)
        return df.sort_values('sharpe', ascending=False)


# ============================================================================
# CLI
# ============================================================================

if __name__ == '__main__':
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    parser = argparse.ArgumentParser(description='Build options payoff surface')
    parser.add_argument('--options-dir', type=str,
                        default='/Volumes/VelocityData/velocity_om/massive/options',
                        help='Directory with daily options parquet files')
    parser.add_argument('--stock-data', type=str,
                        default='/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet',
                        help='Path to stock OHLCV parquet')
    parser.add_argument('--symbol', type=str, default='SPY',
                        help='Symbol to process')
    parser.add_argument('--start', type=str, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, help='End date (YYYY-MM-DD)')
    parser.add_argument('--rank', action='store_true',
                        help='Rank existing structures instead of building')

    args = parser.parse_args()

    if args.rank:
        # Rank existing structures
        surface_path = Path(args.options_dir).parent / 'payoff_surfaces' / f'{args.symbol}_payoff_surface.parquet'
        lookup = PayoffSurfaceLookup.from_parquet(surface_path)
        ranking = lookup.rank_structures()
        print("\n=== Structure Rankings (by Sharpe) ===\n")
        print(ranking.to_string())
    else:
        # Build surface
        start = datetime.strptime(args.start, '%Y-%m-%d') if args.start else None
        end = datetime.strptime(args.end, '%Y-%m-%d') if args.end else None

        builder = PayoffSurfaceBuilder(
            options_dir=Path(args.options_dir),
            stock_data_path=Path(args.stock_data),
            symbol=args.symbol
        )

        surface = builder.build_surface(start, end)
        print(f"\nBuilt surface with {len(surface)} entries")
        print(f"Structures: {surface['structure_key'].nunique()}")
        print(f"Date range: {surface['date'].min()} to {surface['date'].max()}")
