"""
Profile 6: Vol-of-Vol Convexity (30-60 DTE long straddle)

Trade structure: Long 30-60 DTE ATM straddle
Entry: Profile score > 0.6 AND Regime 4 (Breaking Vol)
Delta hedging: Optional (benefits from vol explosion)
Roll logic: <20 DTE OR regime change
"""

import pandas as pd
import numpy as np
from datetime import timedelta
from typing import Optional

from ..trade import Trade, create_straddle_trade
from ..simulator import TradeSimulator, SimulationConfig


class Profile6VolOfVol:
    """Profile 6: Vol-of-vol convexity."""

    def __init__(
        self,
        score_threshold: float = 0.6,
        target_dte: int = 45,  # 30-60 DTE range
        roll_dte_threshold: int = 20,
        regime_filter: Optional[list] = None,  # [4] = Breaking Vol
        delta_hedge: bool = False  # Benefits from vol explosion
    ):
        """
        Initialize Profile 6.

        Parameters:
        -----------
        score_threshold : float
            Minimum profile score to enter trade
        target_dte : int
            Target DTE (30-60)
        roll_dte_threshold : int
            Roll when DTE < this
        regime_filter : list, optional
            Acceptable regimes (default [4])
        delta_hedge : bool
            Whether to delta hedge
        """
        self.score_threshold = score_threshold
        self.target_dte = target_dte
        self.roll_dte_threshold = roll_dte_threshold
        self.regime_filter = regime_filter or [4]  # Breaking Vol
        self.delta_hedge = delta_hedge

    def entry_logic(self, row: pd.Series, current_trade: Optional[Trade]) -> bool:
        """Entry logic for Profile 6."""
        if current_trade is not None:
            return False

        score = row.get('profile_6_score', 0.0)
        if score < self.score_threshold:
            return False

        regime = int(row.get('regime', 0))
        if regime not in self.regime_filter:
            return False

        return True

    def exit_logic(self, row: pd.Series, trade: Trade) -> bool:
        """Exit logic: Regime change."""
        regime = int(row.get('regime', 0))
        if regime not in self.regime_filter:
            return True
        return False

    def trade_constructor(self, row: pd.Series, trade_id: str) -> Trade:
        """
        Construct long ATM straddle (30-60 DTE).

        This captures vol-of-vol convexity (benefits from volatility explosion).
        """
        spot = row['close']
        entry_date = row['date']

        atm_strike = round(spot)
        expiry = entry_date + timedelta(days=self.target_dte)

        trade = create_straddle_trade(
            trade_id=trade_id,
            profile_name="Profile_6_VoV",
            entry_date=entry_date,
            strike=atm_strike,
            expiry=expiry,
            dte=self.target_dte,
            quantity=1  # Long straddle
        )

        return trade

    def run_backtest(
        self,
        data: pd.DataFrame,
        profile_scores: pd.DataFrame
    ) -> tuple[pd.DataFrame, TradeSimulator]:
        """Run backtest for Profile 6."""
        data_with_scores = data.merge(
            profile_scores[['date', 'profile_6_score']],
            on='date',
            how='left'
        )

        config = SimulationConfig(
            delta_hedge_enabled=self.delta_hedge,
            delta_hedge_frequency='daily',
            roll_dte_threshold=self.roll_dte_threshold,
            max_loss_pct=0.50,
            max_days_in_trade=90
        )

        simulator = TradeSimulator(data_with_scores, config)

        results = simulator.simulate(
            entry_logic=self.entry_logic,
            trade_constructor=self.trade_constructor,
            exit_logic=self.exit_logic,
            profile_name="Profile_6_VoV"
        )

        return results, simulator


def run_profile_6_backtest(
    data: pd.DataFrame,
    profile_scores: pd.DataFrame,
    score_threshold: float = 0.6,
    regime_filter: Optional[list] = None
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Convenience function to run Profile 6 backtest."""
    profile = Profile6VolOfVol(
        score_threshold=score_threshold,
        regime_filter=regime_filter
    )

    results, simulator = profile.run_backtest(data, profile_scores)
    trade_summary = simulator.get_trade_summary()

    return results, trade_summary
