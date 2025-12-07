#!/usr/bin/env python3
"""
Portfolio Backtester: Simulates the Performance of a Portfolio of Strategies

This module allows for the simulation of a portfolio composed of multiple
individual options strategies (StructureDNA objects). It applies portfolio-level
rebalancing and risk management rules defined in a PortfolioDNA.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from engine.discovery.structure_dna import StructureDNA
from engine.discovery.precision_backtester import PrecisionBacktester, BacktestResult
from engine.portfolio.portfolio_dna import PortfolioDNA, RebalanceFrequency, PortfolioObjective

logger = logging.getLogger("AlphaFactory.PortfolioBacktester")

# ============================================================================
# PORTFOLIO BACKTEST RESULT
# ============================================================================

@dataclass
class PortfolioBacktestResult:
    """Results from backtesting a portfolio."""
    dna: PortfolioDNA
    # Overall portfolio metrics
    total_return: float
    ann_return: float
    ann_volatility: float
    sharpe_ratio: float
    sortino_ratio: float
    max_drawdown: float
    calmar_ratio: float
    
    # Portfolio equity curve
    equity_curve: pd.Series = field(repr=False)
    daily_returns: pd.Series = field(repr=False)

    # Optional: Breakdown by regime, strategy, etc.
    weights_history: Optional[Dict[datetime, Dict[str, float]]] = field(default_factory=dict, repr=False)

    def to_dict(self) -> Dict:
        """Serialize to dictionary (excluding large series)."""
        return {
            'weighting_method': self.dna.weighting_method.value,
            'objective': self.dna.objective.value,
            'rebalance_frequency': self.dna.rebalance_frequency.value,
            'total_return': self.total_return,
            'ann_return': self.ann_return,
            'ann_volatility': self.ann_volatility,
            'sharpe_ratio': self.sharpe_ratio,
            'sortino_ratio': self.sortino_ratio,
            'max_drawdown': self.max_drawdown,
            'calmar_ratio': self.calmar_ratio,
        }

# ============================================================================
# PORTFOLIO BACKTESTER
# ============================================================================

class PortfolioBacktester:
    """
    Simulates the performance of a portfolio of options strategies.
    Applies rebalancing and risk management based on PortfolioDNA.
    """

    def __init__(
        self,
        precision_backtester: PrecisionBacktester,
        discovered_structures: List[StructureDNA],
    ):
        """
        Initialize the PortfolioBacktester.

        Args:
            precision_backtester: An initialized PrecisionBacktester instance.
            discovered_structures: A list of individual StructureDNA objects.
        """
        self.precision_backtester = precision_backtester
        self.discovered_structures = discovered_structures
        self.trading_dates = precision_backtester.trading_dates

        # Pre-compute daily returns for all discovered structures
        self.strategy_daily_returns: Dict[str, pd.Series] = self._precompute_strategy_returns()

        # Combine all strategy returns into a single DataFrame for easier lookup
        self.all_strategy_returns_df = pd.DataFrame(self.strategy_daily_returns).reindex(self.trading_dates).fillna(0.0)
        logger.info(f"Pre-computed daily returns for {len(self.discovered_structures)} strategies over {len(self.trading_dates)} days.")

        self.regimes = precision_backtester.regimes # Access regimes from PrecisionBacktester

    def _precompute_strategy_returns(self) -> Dict[str, pd.Series]:
        """
        Run the PrecisionBacktester for each discovered structure to get its daily returns.
        """
        returns = {}
        for i, dna in enumerate(self.discovered_structures):
            # Use a unique identifier for each strategy
            strategy_id = f"{dna.structure_key}-{hash(frozenset(dna.to_dict().items()))}"
            if strategy_id in returns:
                continue # Avoid re-backtesting identical DNAs if hash collision

            result = self.precision_backtester.backtest(
                dna,
                start_date=self.trading_dates.min(),
                end_date=self.trading_dates.max()
            )
            if result and result.daily_returns is not None and not result.daily_returns.empty:
                returns[strategy_id] = result.daily_returns.reindex(self.trading_dates).fillna(0.0)
            else:
                logger.warning(f"No valid returns for strategy: {dna.structure_key}. Skipping.")
        return returns


    def _calculate_metrics(self, daily_returns: pd.Series, dna: PortfolioDNA) -> PortfolioBacktestResult:
        """Helper to calculate portfolio-level metrics."""
        if daily_returns.empty or daily_returns.std() == 0:
            return PortfolioBacktestResult(
                dna=dna, total_return=0.0, ann_return=0.0, ann_volatility=0.0,
                sharpe_ratio=0.0, sortino_ratio=0.0, max_drawdown=0.0, calmar_ratio=0.0,
                equity_curve=pd.Series(), daily_returns=pd.Series()
            )

        # Ensure returns are aligned to all trading days
        full_returns = daily_returns.reindex(self.trading_dates).fillna(0.0)

        total_return = (1 + full_returns).prod() - 1
        n_days = len(full_returns)
        ann_factor = 252 / n_days
        ann_return = (1 + total_return) ** ann_factor - 1
        ann_vol = full_returns.std() * np.sqrt(252)

        sharpe = ann_return / ann_vol if ann_vol > 0 else 0.0

        # FIX: Sortino uses LPM2 (Lower Partial Moment), not std of negative returns
        # Per Gemini audit 2025-12-06: std(neg_returns) measures dispersion around mean loss,
        # which is wrong. LPM2 = sqrt(mean(min(r, 0)^2)) measures dispersion around zero.
        downside_returns = np.minimum(full_returns, 0)  # Clip positive returns to 0
        downside_vol = np.sqrt((downside_returns ** 2).mean()) * np.sqrt(252)
        sortino = ann_return / downside_vol if downside_vol > 0 else 0.0

        cum_returns = (1 + full_returns).cumprod()
        rolling_max = cum_returns.expanding().max()
        drawdown = (cum_returns - rolling_max) / rolling_max
        max_dd = abs(drawdown.min()) if len(drawdown) > 0 else 0.0

        calmar = ann_return / max_dd if max_dd > 0 else 0.0

        return PortfolioBacktestResult(
            dna=dna,
            total_return=total_return,
            ann_return=ann_return,
            ann_volatility=ann_vol,
            sharpe_ratio=sharpe,
            sortino_ratio=sortino,
            max_drawdown=max_dd,
            calmar_ratio=calmar,
            equity_curve=cum_returns,
            daily_returns=full_returns
        )

    def backtest_portfolio(
        self,
        portfolio_dna: PortfolioDNA,
        optimizer_func: callable, # Function from PortfolioOptimizer
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> PortfolioBacktestResult:
        """
        Simulate the performance of a portfolio over time.

        Args:
            portfolio_dna: The PortfolioDNA defining portfolio rules.
            optimizer_func: A function (from PortfolioOptimizer) that provides weights for a given period.
            start_date: Start of backtest period.
            end_date: End of backtest period.
        """
        # Filter trading dates for the backtest period
        if start_date:
            self.trading_dates = self.trading_dates[self.trading_dates >= start_date]
        if end_date:
            self.trading_dates = self.trading_dates[self.trading_dates <= end_date]

        if self.trading_dates.empty:
            logger.warning("No trading dates for portfolio backtest.")
            return self._calculate_metrics(pd.Series(), portfolio_dna)

        portfolio_equity = pd.Series(1.0, index=self.trading_dates)
        portfolio_daily_returns = pd.Series(0.0, index=self.trading_dates)
        current_weights = {s_id: 0.0 for s_id in self.strategy_daily_returns.keys()}
        weights_history = {}

        in_portfolio_position = False # Track if portfolio is actively trading
        current_max_drawdown = 0.0
        portfolio_value = 1.0

        for i, current_date in enumerate(self.trading_dates):
            # Check for rebalance or regime change
            rebalance_day = False
            if portfolio_dna.rebalance_frequency == RebalanceFrequency.DAILY:
                rebalance_day = True
            elif portfolio_dna.rebalance_frequency == RebalanceFrequency.WEEKLY and current_date.weekday() == 0: # Monday
                rebalance_day = True
            elif portfolio_dna.rebalance_frequency == RebalanceFrequency.MONTHLY and current_date.day == 1:
                rebalance_day = True
            elif portfolio_dna.rebalance_frequency == RebalanceFrequency.REGIME_CHANGE:
                # Need to compare current_regime with previous_regime. Simplistic for now.
                # Actual logic would involve passing previous_regime from outside or within optimizer_func
                # For now, assume optimizer_func handles regime changes
                pass # Handled by optimizer_func

            # Get weights for this period
            # The optimizer_func will decide if a rebalance is due or if weights should change based on regime
            weights_for_this_day = optimizer_func(
                current_date, 
                portfolio_dna, 
                self.discovered_structures, 
                self.all_strategy_returns_df, 
                self.regimes
            )
            
            # If weights are received, update and log
            if weights_for_this_day:
                current_weights = weights_for_this_day
                weights_history[current_date] = current_weights
                if any(w > 0 for w in current_weights.values()):
                    in_portfolio_position = True
                else:
                    in_portfolio_position = False

            daily_portfolio_return = 0.0
            if in_portfolio_position:
                for strategy_id, weight in current_weights.items():
                    # Ensure weight is within max allocation
                    adjusted_weight = min(weight, portfolio_dna.max_strategy_allocation_pct)
                    daily_portfolio_return += self.all_strategy_returns_df.loc[current_date, strategy_id] * adjusted_weight

            portfolio_daily_returns.loc[current_date] = daily_portfolio_return
            portfolio_value *= (1 + daily_portfolio_return)
            portfolio_equity.loc[current_date] = portfolio_value
            
            # Apply portfolio-level stop-loss/profit-target
            # This is a bit simplified; typically, these are checked against the peak equity
            current_max_drawdown = max(current_max_drawdown, 1 - portfolio_value / portfolio_equity.max())
            if current_max_drawdown >= portfolio_dna.portfolio_stop_loss_pct:
                logger.info(f"Portfolio Stop Loss hit on {current_date.date()}! Equity: {portfolio_value:.2f}")
                # Future: Implement a temporary or permanent portfolio shutdown
                break
            # if portfolio_value >= (1 + portfolio_dna.portfolio_profit_target_pct):
            #     logger.info(f"Portfolio Profit Target hit on {current_date.date()}! Equity: {portfolio_value:.2f}")
            #     break # Future: Implement a temporary or permanent portfolio shutdown


        # Re-calculate metrics based on actual (potentially curtailed) performance
        final_result = self._calculate_metrics(portfolio_daily_returns.loc[:current_date], portfolio_dna)
        final_result.equity_curve = portfolio_equity.loc[:current_date]
        final_result.daily_returns = portfolio_daily_returns.loc[:current_date]
        final_result.weights_history = weights_history

        return final_result


if __name__ == '__main__':
    # This block would require mock PrecisionBacktester and StructureDNA objects
    # for a meaningful test.
    logging.basicConfig(level=logging.INFO)
    logger.info("PortfolioBacktester module loaded.")
    
    # Example of how it would be used:
    # from engine.discovery.structure_dna import StructureDNA
    # from engine.discovery.precision_backtester import PrecisionBacktester
    #
    # # Mock data - in real use, these come from StructureMiner output and actual data files
    # mock_precision_backtester = PrecisionBacktester(
    #     surface_path=Path("mock_surface.parquet"),
    #     regime_path=Path("mock_regimes.parquet")
    # )
    # mock_structures = [StructureDNA(...), StructureDNA(...)]
    #
    # pb = PortfolioBacktester(mock_precision_backtester, mock_structures)
    #
    # # Mock optimizer function (this would come from PortfolioOptimizer)
    # def mock_optimizer_func(current_date, portfolio_dna, discovered_structures, all_strategy_returns_df, regimes):
    #     # Simple example: equal weight all strategies
    #     if current_date.day % 7 == 0: # Rebalance weekly
    #         active_strategies = [s_id for s_id in all_strategy_returns_df.columns if all_strategy_returns_df.loc[current_date, s_id] != 0]
    #         if active_strategies:
    #             weight_per_strategy = 1.0 / len(active_strategies)
    #             return {s_id: weight_per_strategy for s_id in active_strategies}
    #     return None # No rebalance today
    #
    # p_dna = PortfolioDNA()
    # result = pb.backtest_portfolio(p_dna, mock_optimizer_func)
    # print(result)
