"""
Profile 4: Vanna Convexity (Call diagonal or call fly)

Trade structure: Call diagonal (60D long, 7D short) or call fly
Entry: Profile score > 0.5 AND Regime 1 (Trend Up)
Delta hedging: Optional (vanna benefits from spot/vol correlation)
Roll logic: When short leg <3 DTE, roll to new short leg
"""

import pandas as pd
import numpy as np
from datetime import timedelta
from typing import Optional

from ..trade import Trade, TradeLeg
from ..simulator import TradeSimulator, SimulationConfig


class Profile4Vanna:
    """Profile 4: Vanna convexity."""

    def __init__(
        self,
        score_threshold: float = 0.5,
        long_dte: int = 60,
        short_dte: int = 7,
        regime_filter: Optional[list] = None,  # [1] = Trend Up
        delta_hedge: bool = False  # Vanna benefits from directional exposure
    ):
        """
        Initialize Profile 4.

        Parameters:
        -----------
        score_threshold : float
            Minimum profile score to enter trade
        long_dte : int
            DTE for long call leg (60 typical)
        short_dte : int
            DTE for short call leg (7 typical)
        regime_filter : list, optional
            Acceptable regimes (default [1])
        delta_hedge : bool
            Whether to delta hedge
        """
        self.score_threshold = score_threshold
        self.long_dte = long_dte
        self.short_dte = short_dte
        self.regime_filter = regime_filter or [1]  # Trend Up
        self.delta_hedge = delta_hedge

    def entry_logic(self, row: pd.Series, current_trade: Optional[Trade]) -> bool:
        """Entry logic for Profile 4."""
        if current_trade is not None:
            return False

        score = row.get('profile_4_score', 0.0)
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
        Construct call diagonal: Long 60D ATM call, short 7D OTM call.

        This captures vanna (vol down + spot up creates favorable delta decay).
        """
        spot = row['close']
        entry_date = row['date']

        # Long call: ATM, 60 DTE
        long_strike = round(spot)
        long_expiry = entry_date + timedelta(days=self.long_dte)

        # Short call: OTM (~5% above spot), 7 DTE
        short_strike = round(spot * 1.05)
        short_expiry = entry_date + timedelta(days=self.short_dte)

        legs = [
            TradeLeg(strike=long_strike, expiry=long_expiry, option_type='call', quantity=1, dte=self.long_dte),
            TradeLeg(strike=short_strike, expiry=short_expiry, option_type='call', quantity=-1, dte=self.short_dte)
        ]

        trade = Trade(
            trade_id=trade_id,
            profile_name="Profile_4_Vanna",
            entry_date=entry_date,
            legs=legs,
            entry_prices={}
        )

        return trade

    def run_backtest(
        self,
        data: pd.DataFrame,
        profile_scores: pd.DataFrame
    ) -> tuple[pd.DataFrame, TradeSimulator]:
        """Run backtest for Profile 4."""
        data_with_scores = data.merge(
            profile_scores[['date', 'profile_4_score']],
            on='date',
            how='left'
        )

        config = SimulationConfig(
            delta_hedge_enabled=self.delta_hedge,
            delta_hedge_frequency='daily',
            roll_dte_threshold=3,  # Roll short leg when <3 DTE
            max_loss_pct=0.50,
            max_days_in_trade=90
        )

        simulator = TradeSimulator(data_with_scores, config)

        results = simulator.simulate(
            entry_logic=self.entry_logic,
            trade_constructor=self.trade_constructor,
            exit_logic=self.exit_logic,
            profile_name="Profile_4_Vanna"
        )

        return results, simulator


def run_profile_4_backtest(
    data: pd.DataFrame,
    profile_scores: pd.DataFrame,
    score_threshold: float = 0.5,
    regime_filter: Optional[list] = None
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Convenience function to run Profile 4 backtest."""
    profile = Profile4Vanna(
        score_threshold=score_threshold,
        regime_filter=regime_filter
    )

    results, simulator = profile.run_backtest(data, profile_scores)
    trade_summary = simulator.get_trade_summary()

    return results, trade_summary
