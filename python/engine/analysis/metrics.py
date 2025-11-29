"""
Performance metrics calculation.

Calculates comprehensive performance metrics including:
- Sharpe ratio
- Sortino ratio
- Calmar ratio
- Max drawdown
- Win rate
- Profit factor
- Recovery time
"""

import pandas as pd
import numpy as np
from typing import Dict, Optional


class PerformanceMetrics:
    """
    Calculate comprehensive performance metrics for portfolio.
    """

    def __init__(self, annual_factor: float = 252, starting_capital: float = 100000.0):
        """
        Initialize metrics calculator.

        Parameters:
        -----------
        annual_factor : float
            Trading days per year for annualization (default 252)
        starting_capital : float
            Initial portfolio capital for calculating returns (default 100,000)
            CRITICAL: Must match actual starting capital for accurate metrics
        """
        self.annual_factor = annual_factor
        self.starting_capital = starting_capital

    def calculate_all(
        self,
        portfolio: pd.DataFrame,
        benchmark_col: Optional[str] = None
    ) -> Dict:
        """
        Calculate all performance metrics.

        Parameters:
        -----------
        portfolio : pd.DataFrame
            Portfolio DataFrame with 'portfolio_pnl' column
        benchmark_col : str, optional
            Column name for benchmark returns

        Returns:
        --------
        metrics : dict
            All performance metrics
        """
        pnl = portfolio['portfolio_pnl']

        metrics = {
            'sharpe_ratio': self.sharpe_ratio(pnl),
            'sortino_ratio': self.sortino_ratio(pnl),
            'calmar_ratio': self.calmar_ratio(pnl, portfolio['cumulative_pnl']),
            'max_drawdown': self.max_drawdown(portfolio['cumulative_pnl']),
            'max_drawdown_pct': self.max_drawdown_pct(portfolio['cumulative_pnl']),
            'win_rate': self.win_rate(pnl),
            'profit_factor': self.profit_factor(pnl),
            'total_return': portfolio['cumulative_pnl'].iloc[-1],
            'avg_daily_pnl': pnl.mean(),
            'std_daily_pnl': pnl.std(),
            'total_days': len(portfolio),
            'positive_days': (pnl > 0).sum(),
            'negative_days': (pnl < 0).sum(),
            'best_day': pnl.max(),
            'worst_day': pnl.min(),
            'avg_win': pnl[pnl > 0].mean() if (pnl > 0).any() else 0,
            'avg_loss': pnl[pnl < 0].mean() if (pnl < 0).any() else 0
        }

        # Add drawdown metrics
        dd_metrics = self.drawdown_analysis(portfolio['cumulative_pnl'])
        metrics.update(dd_metrics)

        return metrics

    def sharpe_ratio(
        self,
        returns: pd.Series,
        risk_free_rate: float = 0.0
    ) -> float:
        """
        Calculate annualized Sharpe ratio.

        BUG FIX (2025-11-18): Handle both P&L (dollars) and returns (percentages)
        Agent #9 found: Function was receiving dollar P&L but treating as returns

        Parameters:
        -----------
        returns : pd.Series
            Daily returns OR daily P&L (auto-detected)
        risk_free_rate : float
            Annual risk-free rate (default 0.0)

        Returns:
        --------
        sharpe : float
            Annualized Sharpe ratio
        """
        # AUTO-DETECT: If values > 1.0, likely dollar P&L not percentage returns
        # Convert P&L to returns if needed
        if returns.abs().mean() > 1.0:
            # Input is dollar P&L - convert to returns
            # FIX BUG-METRICS-001: Use actual starting_capital, not hardcoded 100K
            cumulative_portfolio_value = self.starting_capital + returns.cumsum()
            # Calculate percentage returns from portfolio value
            returns_pct = cumulative_portfolio_value.pct_change().dropna()

            # FIXED Round 6: pct_change() loses first return (no prior value to compare)
            # Must manually add first return to avoid missing day 1 P&L
            if len(returns) > 0:
                first_return = returns.iloc[0] / self.starting_capital
                returns_pct = pd.concat([
                    pd.Series([first_return], index=[returns.index[0]]),
                    returns_pct
                ])
        else:
            # Input is already percentage returns
            returns_pct = returns

        excess_returns = returns_pct - (risk_free_rate / self.annual_factor)

        if excess_returns.std() == 0 or len(excess_returns) == 0:
            return 0.0

        return (excess_returns.mean() / excess_returns.std()) * np.sqrt(self.annual_factor)

    def sortino_ratio(
        self,
        returns: pd.Series,
        risk_free_rate: float = 0.0,
        target: float = 0.0
    ) -> float:
        """
        Calculate annualized Sortino ratio (downside deviation).

        BUG FIX (2025-11-18): Convert P&L to returns if needed, fix downside deviation calc
        Agent #9 found: Same P&L vs returns issue as Sharpe, plus downside deviation error

        Parameters:
        -----------
        returns : pd.Series
            Daily returns OR daily P&L (auto-detected)
        risk_free_rate : float
            Annual risk-free rate
        target : float
            Target return (default 0.0)

        Returns:
        --------
        sortino : float
            Annualized Sortino ratio
        """
        # AUTO-DETECT: Convert P&L to returns if needed (same as Sharpe)
        if returns.abs().mean() > 1.0:
            # FIX BUG-METRICS-002: Use actual starting_capital, not hardcoded 100K
            cumulative_portfolio_value = self.starting_capital + returns.cumsum()
            returns_pct = cumulative_portfolio_value.pct_change().dropna()

            # FIXED Round 6: pct_change() loses first return (no prior value to compare)
            # Must manually add first return to avoid missing day 1 P&L
            if len(returns) > 0:
                first_return = returns.iloc[0] / self.starting_capital
                returns_pct = pd.concat([
                    pd.Series([first_return], index=[returns.index[0]]),
                    returns_pct
                ])
        else:
            returns_pct = returns

        excess_returns = returns_pct - (risk_free_rate / self.annual_factor)

        # Calculate downside deviation correctly: use all returns, take min(ret-target, 0)
        downside_returns = np.minimum(returns_pct - target, 0)
        downside_std = np.sqrt((downside_returns ** 2).mean())

        if downside_std == 0 or len(returns_pct) == 0:
            return 0.0

        return (excess_returns.mean() / downside_std) * np.sqrt(self.annual_factor)

    def max_drawdown(self, cumulative_pnl: pd.Series) -> float:
        """
        Calculate maximum drawdown (absolute dollars).

        Parameters:
        -----------
        cumulative_pnl : pd.Series
            Cumulative P&L series

        Returns:
        --------
        max_dd : float
            Maximum drawdown in dollars
        """
        running_max = cumulative_pnl.expanding().max()
        drawdown = cumulative_pnl - running_max
        return drawdown.min()

    def max_drawdown_pct(self, cumulative_pnl: pd.Series) -> float:
        """
        Calculate maximum drawdown as percentage.

        Parameters:
        -----------
        cumulative_pnl : pd.Series
            Cumulative P&L series

        Returns:
        --------
        max_dd_pct : float
            Maximum drawdown as percentage (e.g., -0.25 = -25%)
        """
        running_max = cumulative_pnl.expanding().max()

        # Avoid division by zero
        running_max = running_max.replace(0, np.nan)

        drawdown_pct = (cumulative_pnl - running_max) / running_max
        return drawdown_pct.min()

    def calmar_ratio(
        self,
        returns: pd.Series,
        cumulative_pnl: pd.Series
    ) -> float:
        """
        Calculate Calmar ratio (CAGR / max drawdown percentage).

        BUG FIX (2025-11-18): Use percentage-based CAGR vs percentage drawdown
        Agent #9 found: Unit mismatch (dollars vs dollars) instead of (% vs %)

        Parameters:
        -----------
        returns : pd.Series
            Daily returns OR daily P&L (auto-detected)
        cumulative_pnl : pd.Series
            Cumulative P&L

        Returns:
        --------
        calmar : float
            Calmar ratio (percentage-based)
        """
        if len(cumulative_pnl) < 2:
            return 0.0

        # FIX BUG-METRICS-003: CAGR calculation needs portfolio value, not cumulative P&L
        # cumulative_pnl is cumulative profit (starts at 0), not portfolio value
        # Portfolio value = starting_capital + cumulative_pnl
        starting_value = self.starting_capital
        ending_value = self.starting_capital + cumulative_pnl.iloc[-1]

        if starting_value <= 0:
            return 0.0

        total_return = (ending_value / starting_value) - 1
        years = len(cumulative_pnl) / self.annual_factor
        cagr = (1 + total_return) ** (1 / years) - 1 if years > 0 else total_return

        # Get max drawdown percentage (calculate from portfolio value, not cumulative P&L)
        portfolio_value = self.starting_capital + cumulative_pnl
        max_dd_pct = abs(self.max_drawdown_pct(portfolio_value))

        if max_dd_pct == 0 or np.isnan(max_dd_pct):
            return 0.0

        return cagr / max_dd_pct

    def win_rate(self, returns: pd.Series) -> float:
        """
        Calculate win rate (percentage of positive days).

        Parameters:
        -----------
        returns : pd.Series
            Daily returns

        Returns:
        --------
        win_rate : float
            Win rate as decimal (e.g., 0.55 = 55%)
        """
        if len(returns) == 0:
            return 0.0

        return (returns > 0).sum() / len(returns)

    def profit_factor(self, returns: pd.Series) -> float:
        """
        Calculate profit factor (gross profit / gross loss).

        Parameters:
        -----------
        returns : pd.Series
            Daily returns

        Returns:
        --------
        pf : float
            Profit factor
        """
        gross_profit = returns[returns > 0].sum()
        gross_loss = abs(returns[returns < 0].sum())

        if gross_loss == 0:
            return np.inf if gross_profit > 0 else 0.0

        return gross_profit / gross_loss

    def drawdown_analysis(self, cumulative_pnl: pd.Series) -> Dict:
        """
        Comprehensive drawdown analysis.

        Parameters:
        -----------
        cumulative_pnl : pd.Series
            Cumulative P&L series

        Returns:
        --------
        metrics : dict
            Drawdown metrics including recovery time
        """
        running_max = cumulative_pnl.expanding().max()
        drawdown = cumulative_pnl - running_max

        # Find maximum drawdown period
        # BUG FIX (2025-11-18): Final audit - use argmin() for position, not idxmin()
        max_dd_position = drawdown.argmin()  # Returns integer position
        max_dd_value = drawdown.min()

        # Find when max DD started
        dd_start_idx = None
        for i in range(max_dd_position + 1):
            if cumulative_pnl.iloc[i] == running_max.iloc[max_dd_position]:
                dd_start_idx = i
                break

        # Find recovery (if any)
        recovery_idx = None
        if max_dd_position < len(cumulative_pnl) - 1:
            for i in range(max_dd_position + 1, len(cumulative_pnl)):
                if cumulative_pnl.iloc[i] >= running_max.iloc[max_dd_position]:
                    recovery_idx = i
                    break

        # Calculate recovery time
        if dd_start_idx is not None and recovery_idx is not None:
            recovery_days = recovery_idx - dd_start_idx
            recovered = True
        else:
            recovery_days = None
            recovered = False

        return {
            'max_dd_value': max_dd_value,
            'max_dd_date': cumulative_pnl.index[max_dd_position] if hasattr(cumulative_pnl.index[max_dd_position], 'date') else max_dd_position,
            'dd_recovery_days': recovery_days,
            'dd_recovered': recovered,
            'avg_drawdown': drawdown[drawdown < 0].mean(),
            'dd_periods': (drawdown < 0).sum()
        }

    def calculate_by_regime(
        self,
        portfolio: pd.DataFrame
    ) -> pd.DataFrame:
        """
        Calculate performance metrics by regime.

        Parameters:
        -----------
        portfolio : pd.DataFrame
            Portfolio with 'regime' and 'portfolio_pnl' columns

        Returns:
        --------
        regime_metrics : pd.DataFrame
            Performance metrics for each regime
        """
        metrics_by_regime = []

        for regime in sorted(portfolio['regime'].unique()):
            regime_data = portfolio[portfolio['regime'] == regime]
            pnl = regime_data['portfolio_pnl']
            cum_pnl = pnl.cumsum()

            metrics = {
                'regime': regime,
                'days': len(regime_data),
                'total_pnl': pnl.sum(),
                'avg_daily_pnl': pnl.mean(),
                'std_daily_pnl': pnl.std(),
                'sharpe': self.sharpe_ratio(pnl),
                'sortino': self.sortino_ratio(pnl),
                'win_rate': self.win_rate(pnl),
                'max_dd': self.max_drawdown(cum_pnl),
                'best_day': pnl.max(),
                'worst_day': pnl.min()
            }

            metrics_by_regime.append(metrics)

        return pd.DataFrame(metrics_by_regime)
