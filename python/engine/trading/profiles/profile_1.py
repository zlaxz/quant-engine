"""
Profile 1: Long-Dated Gamma Efficiency (60-90 DTE)

Trade structure: Long ATM straddle (60-90 DTE)
Entry: Profile score > 0.6 AND Regime 1 or 3
Delta hedging: Daily
Roll logic: 30 days before expiration OR regime change
"""

import pandas as pd
import numpy as np
from datetime import timedelta, date, datetime as dt_datetime
from typing import Optional

from ..trade import Trade, create_straddle_trade
from ..simulator import TradeSimulator, SimulationConfig


class Profile1LongDatedGamma:
    """Profile 1: Long-dated gamma efficiency."""

    def __init__(
        self,
        score_threshold: float = 0.6,
        target_dte: int = 75,  # Target 75 DTE (within 60-90 range)
        roll_dte_threshold: int = 30,  # Roll when <30 DTE
        regime_filter: Optional[list] = None,  # [1, 3] = Trend Up, Compression
        delta_hedge: bool = True
    ):
        """
        Initialize Profile 1.

        Parameters:
        -----------
        score_threshold : float
            Minimum profile score to enter trade (0-1)
        target_dte : int
            Target DTE for trade entry (60-90 typical)
        roll_dte_threshold : int
            Roll when DTE falls below this
        regime_filter : list, optional
            List of acceptable regimes (e.g., [1, 3])
        delta_hedge : bool
            Whether to delta hedge daily
        """
        self.score_threshold = score_threshold
        self.target_dte = target_dte
        self.roll_dte_threshold = roll_dte_threshold
        self.regime_filter = regime_filter or [1, 3]  # Trend Up, Compression
        self.delta_hedge = delta_hedge

    def entry_logic(self, row: pd.Series, current_trade: Optional[Trade]) -> bool:
        """
        Entry logic: Score > threshold AND in favorable regime AND no current position.

        Parameters:
        -----------
        row : pd.Series
            Current market data row
        current_trade : Trade, optional
            Current open trade (None if no position)

        Returns:
        --------
        should_enter : bool
            True if should enter trade
        """
        # Don't enter if already in position
        if current_trade is not None:
            return False

        # Check profile score
        score = row.get('profile_1_score', 0.0)
        if score < self.score_threshold:
            return False

        # Check regime filter
        regime = int(row.get('regime', 0))
        if regime not in self.regime_filter:
            return False

        return True

    def exit_logic(self, row: pd.Series, trade: Trade) -> bool:
        """
        Exit logic: Regime change to unfavorable regime.

        Default DTE threshold and max loss handled by TradeSimulator.

        Parameters:
        -----------
        row : pd.Series
            Current market data row
        trade : Trade
            Current open trade

        Returns:
        --------
        should_exit : bool
            True if should exit trade
        """
        # Exit if regime changes to unfavorable
        regime = int(row.get('regime', 0))
        if regime not in self.regime_filter:
            return True

        return False

    def trade_constructor(self, row: pd.Series, trade_id: str) -> Trade:
        """
        Construct long ATM straddle trade.

        Parameters:
        -----------
        row : pd.Series
            Current market data row
        trade_id : str
            Unique trade identifier

        Returns:
        --------
        trade : Trade
            Constructed trade object
        """
        spot = row['close']
        raw_entry_date = row['date']
        if isinstance(raw_entry_date, pd.Timestamp):
            entry_date = raw_entry_date.to_pydatetime()
        elif isinstance(raw_entry_date, dt_datetime):
            entry_date = raw_entry_date
        else:
            entry_date = dt_datetime.combine(raw_entry_date, dt_datetime.min.time())

        # ATM strike = current spot (rounded to nearest $1)
        atm_strike = round(spot)

        # Expiry date = entry + target_dte
        expiry = self._get_target_expiry(entry_date)

        # Create long ATM straddle
        trade = create_straddle_trade(
            trade_id=trade_id,
            profile_name="Profile_1_LDG",
            entry_date=entry_date,
            strike=atm_strike,
            expiry=expiry,
            dte=(expiry - entry_date).days,
            quantity=1  # Long 1 straddle
        )

        return trade

    def run_backtest(
        self,
        data: pd.DataFrame,
        profile_scores: pd.DataFrame
    ) -> tuple[pd.DataFrame, TradeSimulator]:
        """
        Run backtest for Profile 1.

        Parameters:
        -----------
        data : pd.DataFrame
            Full market data (OHLCV, features, regimes)
        profile_scores : pd.DataFrame
            Profile scores computed by detectors

        Returns:
        --------
        results : pd.DataFrame
            Daily P&L and equity curve
        simulator : TradeSimulator
            Simulator instance with trade history
        """
        # Merge scores into data
        data_with_scores = data.merge(
            profile_scores[['date', 'profile_1_score']],
            on='date',
            how='left'
        )

        # Configure simulator
        config = SimulationConfig(
            delta_hedge_enabled=self.delta_hedge,
            delta_hedge_frequency='daily',
            roll_dte_threshold=self.roll_dte_threshold,
            roll_on_regime_change=True,
            max_loss_pct=0.50,
            max_days_in_trade=120
        )

        # Create simulator
        simulator = TradeSimulator(data_with_scores, config)

        # Run simulation
        results = simulator.simulate(
            entry_logic=self.entry_logic,
            trade_constructor=self.trade_constructor,
            exit_logic=self.exit_logic,
            profile_name="Profile_1_LDG"
        )

        return results, simulator

    def _get_target_expiry(self, entry_date) -> dt_datetime:
        """Snap target expiry to the third Friday of the desired month."""
        if isinstance(entry_date, pd.Timestamp):
            entry_date = entry_date.date()
        elif isinstance(entry_date, dt_datetime):
            entry_date = entry_date.date()

        target_day = entry_date + timedelta(days=self.target_dte)

        expiry_date = self._third_friday(target_day.year, target_day.month)

        min_dte = entry_date + timedelta(days=45)
        if expiry_date <= min_dte:
            year, month = self._add_month(target_day.year, target_day.month)
            expiry_date = self._third_friday(year, month)

        return dt_datetime.combine(expiry_date, dt_datetime.min.time())

    @staticmethod
    def _third_friday(year: int, month: int) -> date:
        """Return the third Friday of a given month."""
        first_day = date(year, month, 1)
        first_friday_offset = (4 - first_day.weekday()) % 7
        first_friday = first_day + timedelta(days=first_friday_offset)
        return first_friday + timedelta(days=14)

    @staticmethod
    def _add_month(year: int, month: int) -> tuple[int, int]:
        """Return (year, month) for the next calendar month."""
        if month == 12:
            return year + 1, 1
        return year, month + 1


def run_profile_1_backtest(
    data: pd.DataFrame,
    profile_scores: pd.DataFrame,
    score_threshold: float = 0.6,
    regime_filter: Optional[list] = None
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Convenience function to run Profile 1 backtest.

    Parameters:
    -----------
    data : pd.DataFrame
        Full market data
    profile_scores : pd.DataFrame
        Profile scores
    score_threshold : float
        Entry score threshold
    regime_filter : list, optional
        Regime filter (default [1, 3])

    Returns:
    --------
    results : pd.DataFrame
        Daily results (P&L, positions)
    trade_summary : pd.DataFrame
        Summary of all closed trades
    """
    profile = Profile1LongDatedGamma(
        score_threshold=score_threshold,
        regime_filter=regime_filter
    )

    results, simulator = profile.run_backtest(data, profile_scores)
    trade_summary = simulator.get_trade_summary()

    return results, trade_summary
