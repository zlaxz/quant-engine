"""
Profile 2: Short-Dated Gamma Spike (1-3 DTE)

Trade structure:
- Long 1-3 DTE ATM straddle in Regime 2 (downtrend)
- Short 1-3 DTE ATM straddle (delta-hedged) in Regime 5 (choppy)

Entry: Profile score > 0.5 AND in Regime 2 or 5
Delta hedging: Intraday (simulated as daily)
Roll logic: Hold until expiration (1-3 days max)
"""

import pandas as pd
import numpy as np
from datetime import timedelta
from typing import Optional

from ..trade import Trade, create_straddle_trade
from ..simulator import TradeSimulator, SimulationConfig


class Profile2ShortDatedGamma:
    """Profile 2: Short-dated gamma spike."""

    def __init__(
        self,
        score_threshold: float = 0.5,
        target_dte: int = 2,  # 1-3 DTE range
        regime_filter: Optional[list] = None,  # [2, 5] = Downtrend, Choppy
        delta_hedge: bool = True
    ):
        """
        Initialize Profile 2.

        Parameters:
        -----------
        score_threshold : float
            Minimum profile score to enter trade
        target_dte : int
            Target DTE (1-3)
        regime_filter : list, optional
            Acceptable regimes (default [2, 5])
        delta_hedge : bool
            Whether to delta hedge
        """
        self.score_threshold = score_threshold
        self.target_dte = target_dte
        self.regime_filter = regime_filter or [2, 5]
        self.delta_hedge = delta_hedge

    def entry_logic(self, row: pd.Series, current_trade: Optional[Trade]) -> bool:
        """Entry logic for Profile 2."""
        if current_trade is not None:
            return False

        score = row.get('profile_2_score', 0.0)
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
        Construct short-dated ATM straddle.

        Long in Regime 2 (downtrend), short in Regime 5 (choppy).
        """
        spot = row['close']
        entry_date = row['date']
        regime = int(row.get('regime', 0))

        atm_strike = round(spot)
        expiry = entry_date + timedelta(days=self.target_dte)

        # Long in downtrend (Regime 2), short in choppy (Regime 5)
        quantity = 1 if regime == 2 else -1

        trade = create_straddle_trade(
            trade_id=trade_id,
            profile_name="Profile_2_SDG",
            entry_date=entry_date,
            strike=atm_strike,
            expiry=expiry,
            dte=self.target_dte,
            quantity=quantity
        )

        return trade

    def run_backtest(
        self,
        data: pd.DataFrame,
        profile_scores: pd.DataFrame
    ) -> tuple[pd.DataFrame, TradeSimulator]:
        """Run backtest for Profile 2."""
        data_with_scores = data.merge(
            profile_scores[['date', 'profile_2_score']],
            on='date',
            how='left'
        )

        config = SimulationConfig(
            delta_hedge_enabled=self.delta_hedge,
            delta_hedge_frequency='daily',
            roll_dte_threshold=0,  # Hold until expiration
            max_loss_pct=0.50,
            max_days_in_trade=7
        )

        simulator = TradeSimulator(data_with_scores, config)

        results = simulator.simulate(
            entry_logic=self.entry_logic,
            trade_constructor=self.trade_constructor,
            exit_logic=self.exit_logic,
            profile_name="Profile_2_SDG"
        )

        return results, simulator


def run_profile_2_backtest(
    data: pd.DataFrame,
    profile_scores: pd.DataFrame,
    score_threshold: float = 0.5,
    regime_filter: Optional[list] = None
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Convenience function to run Profile 2 backtest."""
    profile = Profile2ShortDatedGamma(
        score_threshold=score_threshold,
        regime_filter=regime_filter
    )

    results, simulator = profile.run_backtest(data, profile_scores)
    trade_summary = simulator.get_trade_summary()

    return results, trade_summary
