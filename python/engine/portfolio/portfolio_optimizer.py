#!/usr/bin/env python3
"""
Portfolio Optimizer: Dynamically Determines Strategy Weights

This module provides the core logic for calculating optimal portfolio weights
based on market regimes and PortfolioDNA parameters. It is designed to be
used by the PortfolioBacktester.
"""

import logging
import random
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from scipy.optimize import minimize

from engine.discovery.structure_dna import StructureDNA
from engine.discovery.precision_backtester import BacktestResult  # Used for fitness metrics
from engine.portfolio.portfolio_dna import PortfolioDNA, WeightingMethod, RebalanceFrequency, PortfolioObjective

logger = logging.getLogger("AlphaFactory.PortfolioOptimizer")

class PortfolioOptimizer:
    """
    Optimizes portfolio weights based on various criteria, including market regimes.
    """

    def __init__(self, regime_data: pd.Series):
        """
        Initialize the optimizer with regime data.

        Args:
            regime_data: A pandas Series with dates as index and regime IDs as values.
        """
        self.regime_data = regime_data
        self.last_weights: Dict[str, float] = {} # Store last calculated weights
        self.last_rebalance_date: Optional[datetime] = None
        self.current_regime: Optional[int] = None

    def _calculate_portfolio_metrics(self, weights: np.ndarray, returns_df: pd.DataFrame, objective: PortfolioObjective) -> float:
        """
        Calculates a portfolio metric (e.g., Sharpe, Sortino) for a given set of weights.
        Used as the objective function for the optimizer.
        """
        if returns_df.empty or len(returns_df) < 2:
            return -1e9 # Penalize empty or insufficient data heavily

        portfolio_returns = returns_df.dot(weights)

        # Annualization factor (assuming daily data)
        ann_factor = 252

        # Mean return
        mean_return = portfolio_returns.mean() * ann_factor

        if objective == PortfolioObjective.SHARPE_RATIO:
            # Standard deviation
            std_dev = portfolio_returns.std() * np.sqrt(ann_factor)
            if std_dev == 0:
                return -1e9 # Avoid division by zero
            sharpe = mean_return / std_dev
            return -sharpe # Minimize negative Sharpe

        elif objective == PortfolioObjective.SORTINO_RATIO:
            # FIX: Sortino uses LPM2 (Lower Partial Moment), not std of negative returns
            # Per Gemini audit 2025-12-06: std(neg_returns) measures dispersion around mean loss,
            # which is wrong. LPM2 = sqrt(mean(min(r, 0)^2)) measures dispersion around zero.
            downside_returns = np.minimum(portfolio_returns, 0)  # Clip positive to 0
            downside_std_dev = np.sqrt((downside_returns ** 2).mean()) * np.sqrt(ann_factor)

            if downside_std_dev == 0:
                return -1e9 # Avoid division by zero if mean_return is negative, or if no downside risk -> infinite sortino
            sortino = mean_return / downside_std_dev
            return -sortino # Minimize negative Sortino

        elif objective == PortfolioObjective.MAX_RETURN:
            return -mean_return # Minimize negative return = Maximize return
        
        elif objective == PortfolioObjective.MIN_DRAWDOWN:
            cumulative_returns = (1 + portfolio_returns).cumprod()
            max_peak = cumulative_returns.expanding().max()
            drawdowns = (cumulative_returns - max_peak) / max_peak
            max_drawdown = drawdowns.min() # This is negative
            return max_drawdown # Minimize drawdown (bring closer to zero)
        
        return -1e9 # Default for unsupported objectives


    def get_portfolio_weights(
        self,
        current_date: datetime,
        portfolio_dna: PortfolioDNA,
        discovered_structures: List[StructureDNA],
        all_strategy_returns_df: pd.DataFrame, # Daily returns for all strategies
    ) -> Optional[Dict[str, float]]:
        """
        Determines the optimal weights for the portfolio for the current day.

        Args:
            current_date: The current date in the backtest.
            portfolio_dna: The PortfolioDNA object with rules.
            discovered_structures: List of all StructureDNA objects that were discovered.
            all_strategy_returns_df: DataFrame of daily returns for all strategies (columns are strategy_ids).

        Returns:
            A dictionary of {strategy_id: weight} or None if no rebalance occurs.
        """
        current_regime = self.regime_data.get(current_date)
        if pd.isna(current_regime):
            logger.debug(f"No regime data for {current_date.date()}. Keeping previous weights.")
            return None # Or return last_weights if we always want to return something.

        # Check rebalance condition
        rebalance_due = False
        if self.last_rebalance_date is None: # First day
            rebalance_due = True
        elif portfolio_dna.rebalance_frequency == RebalanceFrequency.DAILY:
            rebalance_due = True
        elif portfolio_dna.rebalance_frequency == RebalanceFrequency.WEEKLY and current_date.weekday() == 0 and current_date > self.last_rebalance_date:
            rebalance_due = True
        elif portfolio_dna.rebalance_frequency == RebalanceFrequency.MONTHLY and current_date.day == 1 and current_date.month != self.last_rebalance_date.month:
            rebalance_due = True
        elif portfolio_dna.rebalance_frequency == RebalanceFrequency.REGIME_CHANGE and current_regime != self.current_regime:
            rebalance_due = True

        if not rebalance_due and self.last_weights:
            return None # No rebalance, keep previous weights

        self.current_regime = current_regime # Update current regime

        # Define lookback window
        lookback_start_date = current_date - timedelta(days=portfolio_dna.rebalance_window_days)
        
        # Filter strategies based on DNA selection rules (if any)
        # For simplicity, we'll assume `discovered_structures` is the pool
        # and we select based on some `min_fitness` if present in selection_rules
        selected_strategy_ids = list(all_strategy_returns_df.columns)
        if portfolio_dna.strategy_selection_rules:
            min_fitness = portfolio_dna.strategy_selection_rules.get('min_fitness', -np.inf)
            max_strategies = portfolio_dna.strategy_selection_rules.get('max_strategies', len(selected_strategy_ids))
            
            # This requires access to the fitness of each strategy, which is in the BacktestResult,
            # not directly available here in all_strategy_returns_df
            # For now, we'll just filter a random subset
            random.shuffle(selected_strategy_ids)
            selected_strategy_ids = selected_strategy_ids[:max_strategies]
            
        if not selected_strategy_ids:
            logger.warning(f"No strategies selected for optimization on {current_date.date()}. ")
            self.last_weights = {s_id: 0.0 for s_id in all_strategy_returns_df.columns}
            self.last_rebalance_date = current_date
            return self.last_weights


        # Filter historical returns for the lookback window
        historical_returns = all_strategy_returns_df.loc[lookback_start_date:current_date, selected_strategy_ids].copy()
        
        if historical_returns.empty:
            logger.warning(f"Insufficient historical data for optimization on {current_date.date()}. Keeping previous weights.")
            return None

        # Filter for the current regime within the lookback window
        regime_historical_returns = historical_returns[self.regime_data.loc[historical_returns.index] == current_regime]
        
        if regime_historical_returns.empty or len(regime_historical_returns) < 5: # Need at least 5 days for std dev
            logger.warning(f"Insufficient regime-specific data for optimization on {current_date.date()} in regime {current_regime}. Keeping previous weights.")
            return None

        num_assets = len(selected_strategy_ids)
        if num_assets == 0:
            logger.warning(f"No selected assets for optimization on {current_date.date()}.")
            self.last_weights = {s_id: 0.0 for s_id in all_strategy_returns_df.columns}
            self.last_rebalance_date = current_date
            return self.last_weights

        # Set bounds for weights (0 to max_strategy_allocation_pct)
        bounds = tuple((0, portfolio_dna.max_strategy_allocation_pct) for _ in range(num_assets))
        
        # Constraints: sum of weights equals 1
        constraints = ({'type': 'eq', 'fun': lambda x: np.sum(x) - 1})

        # Initial guess (equal weights)
        init_weights = np.array([1.0 / num_assets] * num_assets)

        try:
            optimization_result = minimize(
                fun=self._calculate_portfolio_metrics,
                x0=init_weights,
                args=(regime_historical_returns, portfolio_dna.objective),
                method='SLSQP', # Sequential Least Squares Programming
                bounds=bounds,
                constraints=constraints,
                options={'disp': False, 'ftol': 1e-6} # ftol is for convergence
            )

            if optimization_result.success:
                optimal_weights = optimization_result.x
                # Normalize weights to ensure they sum to 1 in case of numerical issues
                optimal_weights /= np.sum(optimal_weights)
                
                new_weights = {s_id: weight for s_id, weight in zip(selected_strategy_ids, optimal_weights)}
                # Pad with 0 for non-selected strategies
                final_weights = {s_id: new_weights.get(s_id, 0.0) for s_id in all_strategy_returns_df.columns}
                
                self.last_weights = final_weights
                self.last_rebalance_date = current_date
                logger.debug(f"Optimized weights for {current_date.date()} (Regime {int(current_regime)}): {final_weights}")
                return final_weights
            else:
                logger.warning(f"Optimization failed for {current_date.date()} (Regime {int(current_regime)}): {optimization_result.message}. Keeping previous weights.")
                return None
        except Exception as e:
            logger.error(f"Error during optimization for {current_date.date()} (Regime {int(current_regime)}): {e}. Keeping previous weights.")
            return None

# ============================================================================
# TESTING
# ============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

    # Mock Data Setup
    # ----------------
    dates = pd.to_datetime(pd.date_range('2020-01-01', periods=100, freq='B')) # 100 business days
    
    # Mock Regimes: 0 for first 50 days, 1 for next 50 days
    mock_regimes = pd.Series([0]*50 + [1]*50, index=dates)

    # Mock Strategy Returns: 3 strategies
    # Strategy A: Good in Regime 0
    # Strategy B: Good in Regime 1
    # Strategy C: Random
    returns_a = np.random.normal(0.001, 0.01, 100) # mean 0.1%, std 1%
    returns_b = np.random.normal(0.0005, 0.008, 100)
    returns_c = np.random.normal(0.000, 0.005, 100)
    
    returns_a[mock_regimes == 0] = np.random.normal(0.005, 0.01, (mock_regimes == 0).sum()) # Better in Regime 0
    returns_b[mock_regimes == 1] = np.random.normal(0.007, 0.012, (mock_regimes == 1).sum()) # Better in Regime 1

    mock_all_strategy_returns_df = pd.DataFrame({
        'strat_A': returns_a,
        'strat_B': returns_b,
        'strat_C': returns_c,
    }, index=dates)

    # Mock PortfolioDNA
    mock_portfolio_dna = PortfolioDNA(
        weighting_method=WeightingMethod.REGIME_OPTIMIZED_SHARPE,
        objective=PortfolioObjective.SHARPE_RATIO,
        rebalance_frequency=RebalanceFrequency.WEEKLY,
        rebalance_window_days=30, # Lookback 30 days
        max_strategy_allocation_pct=0.5 # Max 50% per strategy
    )
    
    # Mock Discovered Structures (just need IDs for now)
    mock_discovered_structures = [
        StructureDNA(structure_type="LONG_CALL", dte_bucket=7, delta_bucket="ATM", fitness_score=0.8), # Placeholder
        StructureDNA(structure_type="SHORT_PUT", dte_bucket=14, delta_bucket="25D", fitness_score=0.7), # Placeholder
        StructureDNA(structure_type="LONG_STRADDLE", dte_bucket=30, delta_bucket="ATM", fitness_score=0.6) # Placeholder
    ]
    # For a real run, these would be the actual DNA objects.
    # We use a simple list of strings for strategy_ids in this test for convenience
    mock_discovered_structure_ids = ['strat_A', 'strat_B', 'strat_C']


    # Initialize Optimizer
    optimizer = PortfolioOptimizer(regime_data=mock_regimes)

    # Simulate daily weight updates
    print("\n--- Simulating Daily Weight Updates ---")
    weights_history = {}
    for day in dates:
        weights = optimizer.get_portfolio_weights(
            current_date=day,
            portfolio_dna=mock_portfolio_dna,
            discovered_structures=mock_discovered_structures, # Not directly used in this basic test, but required interface
            all_strategy_returns_df=mock_all_strategy_returns_df
        )
        if weights:
            weights_history[day] = weights
            print(f"Date: {day.date()}, Regime: {int(mock_regimes.loc[day])}, Weights: {weights}")
        else:
            # If no rebalance, keep previous weights in history for continuity
            if day > dates[0]:
                prev_day = dates[dates.get_loc(day)-1]
                if prev_day in weights_history:
                    weights_history[day] = weights_history[prev_day]
                else:
                     weights_history[day] = {s_id: 0.0 for s_id in mock_all_strategy_returns_df.columns}

    # Analyze results (optional)
    if weights_history:
        weights_df = pd.DataFrame.from_dict(weights_history, orient='index')
        print("\n--- Weights History (Last 5 Days) ---")
        print(weights_df.tail())
        
        # Example: Calculate portfolio returns using the weights history
        portfolio_returns_series = pd.Series(0.0, index=dates)
        for day in dates:
            if day in weights_df.index:
                current_weights_series = weights_df.loc[day]
                daily_strat_returns = mock_all_strategy_returns_df.loc[day]
                portfolio_returns_series.loc[day] = (daily_strat_returns * current_weights_series).sum()
        
        print("\n--- Portfolio Returns (using dynamic weights) ---")
        print((1 + portfolio_returns_series).cumprod().tail())
