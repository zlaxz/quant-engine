"""
Profile 3: Charm/Decay Dominance (7-14 DTE)

Trade structure: Short 7-14 DTE 25D strangle (delta-hedged)
Entry: Profile score > 0.5 AND Regime 3 (Compression/Pinned)
Delta hedging: Daily
Roll logic: <5 DTE OR regime change
Exit: Regime transition out of Regime 3
"""

import pandas as pd
import numpy as np
from datetime import timedelta
from typing import Optional

from ..trade import Trade, create_strangle_trade
from ..simulator import TradeSimulator, SimulationConfig


class Profile3CharmDecay:
    """Profile 3: Charm/decay dominance."""

    def __init__(
        self,
        score_threshold: float = 0.5,
        target_dte: int = 10,  # 7-14 DTE range
        roll_dte_threshold: int = 5,
        regime_filter: Optional[list] = None,  # [3] = Compression/Pinned
        delta_hedge: bool = True
    ):
        """
        Initialize Profile 3.

        Parameters:
        -----------
        score_threshold : float
            Minimum profile score to enter trade
        target_dte : int
            Target DTE (7-14)
        roll_dte_threshold : int
            Roll when DTE < this
        regime_filter : list, optional
            Acceptable regimes (default [3])
        delta_hedge : bool
            Whether to delta hedge
        """
        self.score_threshold = score_threshold
        self.target_dte = target_dte
        self.roll_dte_threshold = roll_dte_threshold
        self.regime_filter = regime_filter or [3]  # Pinned/Compression only
        self.delta_hedge = delta_hedge

    def entry_logic(self, row: pd.Series, current_trade: Optional[Trade]) -> bool:
        """Entry logic for Profile 3."""
        if current_trade is not None:
            return False

        score = row.get('profile_3_score', 0.0)
        if score < self.score_threshold:
            return False

        regime = int(row.get('regime', 0))
        if regime not in self.regime_filter:
            return False

        return True

    def exit_logic(self, row: pd.Series, trade: Trade) -> bool:
        """Exit logic: Regime change out of Regime 3."""
        regime = int(row.get('regime', 0))
        if regime not in self.regime_filter:
            return True
        return False

    def trade_constructor(self, row: pd.Series, trade_id: str) -> Trade:
        """
        Construct short 25D strangle.

        25D means ~25 delta, roughly 0.25 * ATM premium away from ATM.
        """
        spot = row['close']
        entry_date = row['date']

        # Estimate 25D strikes (roughly ±5-10% from spot depending on vol)
        # For simplicity, use ±7% (typical for ~25D with 20% IV)
        call_strike = round(spot * 1.07)
        put_strike = round(spot * 0.93)

        expiry = entry_date + timedelta(days=self.target_dte)

        trade = create_strangle_trade(
            trade_id=trade_id,
            profile_name="Profile_3_Charm",
            entry_date=entry_date,
            call_strike=call_strike,
            put_strike=put_strike,
            expiry=expiry,
            dte=self.target_dte,
            quantity=1,
            short=True  # Short strangle
        )

        return trade

    def run_backtest(
        self,
        data: pd.DataFrame,
        profile_scores: pd.DataFrame
    ) -> tuple[pd.DataFrame, TradeSimulator]:
        """Run backtest for Profile 3."""
        data_with_scores = data.merge(
            profile_scores[['date', 'profile_3_score']],
            on='date',
            how='left'
        )

        config = SimulationConfig(
            delta_hedge_enabled=self.delta_hedge,
            delta_hedge_frequency='daily',
            roll_dte_threshold=self.roll_dte_threshold,
            max_loss_pct=0.50,
            max_days_in_trade=30
        )

        simulator = TradeSimulator(data_with_scores, config)

        results = simulator.simulate(
            entry_logic=self.entry_logic,
            trade_constructor=self.trade_constructor,
            exit_logic=self.exit_logic,
            profile_name="Profile_3_Charm"
        )

        return results, simulator


def run_profile_3_backtest(
    data: pd.DataFrame,
    profile_scores: pd.DataFrame,
    score_threshold: float = 0.5,
    regime_filter: Optional[list] = None
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Convenience function to run Profile 3 backtest."""
    profile = Profile3CharmDecay(
        score_threshold=score_threshold,
        regime_filter=regime_filter
    )

    results, simulator = profile.run_backtest(data, profile_scores)
    trade_summary = simulator.get_trade_summary()

    return results, trade_summary
