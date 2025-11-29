"""
Profile 5: Skew Convexity (Put backspread)

Trade structure: Put backspread (Long 2x 25D puts, short 1x ATM put)
Entry: Profile score > 0.4 AND Regime 2 (Trend Down)
Delta hedging: Optional (benefits from tail risk)
Roll logic: <7 DTE OR regime change
"""

import pandas as pd
import numpy as np
from datetime import timedelta
from typing import Optional

from ..trade import Trade, create_backspread_trade
from ..simulator import TradeSimulator, SimulationConfig


class Profile5SkewConvexity:
    """Profile 5: Skew convexity (put backspread)."""

    def __init__(
        self,
        score_threshold: float = 0.4,
        target_dte: int = 30,  # 30 DTE typical
        roll_dte_threshold: int = 7,
        regime_filter: Optional[list] = None,  # [2] = Trend Down
        delta_hedge: bool = False  # Benefits from directional tail risk
    ):
        """
        Initialize Profile 5.

        Parameters:
        -----------
        score_threshold : float
            Minimum profile score to enter trade
        target_dte : int
            Target DTE (30 typical)
        roll_dte_threshold : int
            Roll when DTE < this
        regime_filter : list, optional
            Acceptable regimes (default [2])
        delta_hedge : bool
            Whether to delta hedge
        """
        self.score_threshold = score_threshold
        self.target_dte = target_dte
        self.roll_dte_threshold = roll_dte_threshold
        self.regime_filter = regime_filter or [2]  # Trend Down
        self.delta_hedge = delta_hedge

    def entry_logic(self, row: pd.Series, current_trade: Optional[Trade]) -> bool:
        """Entry logic for Profile 5."""
        if current_trade is not None:
            return False

        score = row.get('profile_5_score', 0.0)
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
        Construct put backspread: Short 1x ATM put, long 2x 25D puts.

        This captures skew convexity (steep skew makes long OTM puts relatively cheap).
        """
        spot = row['close']
        entry_date = row['date']

        # Short ATM put
        short_strike = round(spot)

        # Long 25D put (roughly -7% from spot)
        long_strike = round(spot * 0.93)

        expiry = entry_date + timedelta(days=self.target_dte)

        trade = create_backspread_trade(
            trade_id=trade_id,
            profile_name="Profile_5_Skew",
            entry_date=entry_date,
            short_strike=short_strike,
            long_strike=long_strike,
            expiry=expiry,
            dte=self.target_dte,
            option_type='put',
            long_ratio=2
        )

        return trade

    def run_backtest(
        self,
        data: pd.DataFrame,
        profile_scores: pd.DataFrame
    ) -> tuple[pd.DataFrame, TradeSimulator]:
        """Run backtest for Profile 5."""
        data_with_scores = data.merge(
            profile_scores[['date', 'profile_5_score']],
            on='date',
            how='left'
        )

        config = SimulationConfig(
            delta_hedge_enabled=self.delta_hedge,
            delta_hedge_frequency='daily',
            roll_dte_threshold=self.roll_dte_threshold,
            max_loss_pct=0.50,
            max_days_in_trade=60
        )

        simulator = TradeSimulator(data_with_scores, config)

        results = simulator.simulate(
            entry_logic=self.entry_logic,
            trade_constructor=self.trade_constructor,
            exit_logic=self.exit_logic,
            profile_name="Profile_5_Skew"
        )

        return results, simulator


def run_profile_5_backtest(
    data: pd.DataFrame,
    profile_scores: pd.DataFrame,
    score_threshold: float = 0.4,
    regime_filter: Optional[list] = None
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Convenience function to run Profile 5 backtest."""
    profile = Profile5SkewConvexity(
        score_threshold=score_threshold,
        regime_filter=regime_filter
    )

    results, simulator = profile.run_backtest(data, profile_scores)
    trade_summary = simulator.get_trade_summary()

    return results, trade_summary
