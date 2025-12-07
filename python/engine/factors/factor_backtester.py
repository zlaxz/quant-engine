#!/usr/bin/env python3
"""
Factor Backtester: Three-Set Validation for Factor Strategies

Orchestrates factor → signal → execution → validation with interleaved three-set validation.

Validation Split:
- Discovery Set: Odd months 2020-2024 (~675 days) - Find thresholds
- Validation Set: Even months 2020-2024 (~600 days) - Confirm thresholds
- Walk-Forward Set: All of 2025 (245 days) - Final test
- 5-day embargo between discovery and validation months to prevent leakage

Usage:
    backtester = FactorBacktester(
        factor_computer=factor_computer,
        signal_generator=signal_generator,
        strategy_mapper=strategy_mapper,
        features_path="/path/to/features.parquet"
    )

    result = backtester.three_set_validate("gamma_exposure")
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
import pandas as pd
from scipy import stats

from ..discovery.precision_backtester import PrecisionBacktester, BacktestResult as BaseBacktestResult
from ..trading.simulator import TradeSimulator, SimulationConfig
from ..trading.execution import UnifiedExecutionModel

logger = logging.getLogger("AlphaFactory.FactorBacktester")


# ============================================================================
# RESULT CLASSES
# ============================================================================

@dataclass
class BacktestResult:
    """Results from backtesting a factor strategy on one validation set."""
    sharpe: float
    total_return: float
    max_drawdown: float
    win_rate: float
    n_trades: int
    trades: List[Dict] = field(default_factory=list)

    # Extended metrics
    sortino_ratio: float = 0.0
    calmar_ratio: float = 0.0
    profit_factor: float = 0.0
    avg_trade_return: float = 0.0
    total_commission: float = 0.0
    total_slippage: float = 0.0

    # Statistical significance
    t_statistic: float = 0.0
    p_value: float = 1.0
    is_significant: bool = False

    # Equity curve for analysis
    equity_curve: Optional[pd.DataFrame] = None

    def to_dict(self) -> Dict:
        """Serialize to dictionary."""
        return {
            'sharpe': self.sharpe,
            'total_return': self.total_return,
            'max_drawdown': self.max_drawdown,
            'win_rate': self.win_rate,
            'n_trades': self.n_trades,
            'sortino_ratio': self.sortino_ratio,
            'calmar_ratio': self.calmar_ratio,
            'profit_factor': self.profit_factor,
            'avg_trade_return': self.avg_trade_return,
            'total_commission': self.total_commission,
            'total_slippage': self.total_slippage,
            't_statistic': self.t_statistic,
            'p_value': self.p_value,
            'is_significant': self.is_significant,
        }


@dataclass
class ValidationResult:
    """Results from three-set validation."""
    discovery_result: BacktestResult
    validation_result: BacktestResult
    walkforward_result: BacktestResult
    survival: bool  # True if positive Sharpe in all three sets

    # Threshold found during discovery
    entry_threshold: float = 0.0
    exit_threshold: float = 0.0
    direction: str = "long"  # "long" or "short"

    # Factor metadata
    factor_name: str = ""

    def to_dict(self) -> Dict:
        """Serialize to dictionary."""
        return {
            'factor_name': self.factor_name,
            'entry_threshold': self.entry_threshold,
            'exit_threshold': self.exit_threshold,
            'direction': self.direction,
            'discovery': self.discovery_result.to_dict(),
            'validation': self.validation_result.to_dict(),
            'walkforward': self.walkforward_result.to_dict(),
            'survival': self.survival,
        }

    def summary(self) -> str:
        """Generate human-readable summary."""
        lines = [
            f"\n{'='*80}",
            f"FACTOR: {self.factor_name}",
            f"{'='*80}",
            f"Direction: {self.direction.upper()}",
            f"Entry Threshold: {self.entry_threshold:.4f}",
            f"Exit Threshold: {self.exit_threshold:.4f}",
            f"\n{'Discovery Set (Odd Months 2020-2024)':-<80}",
            f"  Sharpe: {self.discovery_result.sharpe:.3f} | Return: {self.discovery_result.total_return:.2%} | MaxDD: {self.discovery_result.max_drawdown:.2%}",
            f"  Trades: {self.discovery_result.n_trades} | Win Rate: {self.discovery_result.win_rate:.1%}",
            f"  t-stat: {self.discovery_result.t_statistic:.2f} | p-value: {self.discovery_result.p_value:.4f} | Significant: {self.discovery_result.is_significant}",
            f"\n{'Validation Set (Even Months 2020-2024)':-<80}",
            f"  Sharpe: {self.validation_result.sharpe:.3f} | Return: {self.validation_result.total_return:.2%} | MaxDD: {self.validation_result.max_drawdown:.2%}",
            f"  Trades: {self.validation_result.n_trades} | Win Rate: {self.validation_result.win_rate:.1%}",
            f"  t-stat: {self.validation_result.t_statistic:.2f} | p-value: {self.validation_result.p_value:.4f} | Significant: {self.validation_result.is_significant}",
            f"\n{'Walk-Forward Set (2025)':-<80}",
            f"  Sharpe: {self.walkforward_result.sharpe:.3f} | Return: {self.walkforward_result.total_return:.2%} | MaxDD: {self.walkforward_result.max_drawdown:.2%}",
            f"  Trades: {self.walkforward_result.n_trades} | Win Rate: {self.walkforward_result.win_rate:.1%}",
            f"  t-stat: {self.walkforward_result.t_statistic:.2f} | p-value: {self.walkforward_result.p_value:.4f} | Significant: {self.walkforward_result.is_significant}",
            f"\n{'SURVIVAL STATUS':-<80}",
            f"  {'PASS - Positive Sharpe in all 3 sets' if self.survival else 'FAIL - Negative Sharpe in at least one set'}",
            f"{'='*80}\n",
        ]
        return '\n'.join(lines)


# ============================================================================
# FACTOR BACKTESTER
# ============================================================================

class FactorBacktester:
    """
    Orchestrate factor → signal → execution → validation with three-set validation.

    Three-Set Validation:
    1. Discovery Set: Odd months 2020-2024 (~675 days)
       - Find entry/exit thresholds using statistical significance
       - Determine optimal direction (long/short)

    2. Validation Set: Even months 2020-2024 (~600 days)
       - Test thresholds found in Discovery
       - No re-optimization allowed

    3. Walk-Forward Set: All of 2025 (245 days)
       - Final test on unseen data
       - No re-optimization allowed

    5-day embargo between discovery and validation months to prevent leakage.
    """

    def __init__(
        self,
        factor_computer: Any,  # Will compute factor values from features
        signal_generator: Any,  # Will convert factor values to signals
        strategy_mapper: Any,  # Will map signals to option structures
        features_path: str,
        price_data_path: Optional[str] = None,
        regime_path: Optional[str] = None,
        initial_capital: float = 100_000.0,
        embargo_days: int = 5,
    ):
        """
        Initialize FactorBacktester.

        Args:
            factor_computer: Object with compute_factor(factor_name, features) -> Series
            signal_generator: Object with generate_signal(factor_values, threshold) -> Series
            strategy_mapper: Object with map_to_structure(signal) -> StructureDNA
            features_path: Path to feature parquet file
            price_data_path: Optional path to price data (for PrecisionBacktester)
            regime_path: Optional path to regime assignments
            initial_capital: Starting capital
            embargo_days: Days to exclude between discovery and validation sets
        """
        self.factor_computer = factor_computer
        self.signal_generator = signal_generator
        self.strategy_mapper = strategy_mapper
        self.features_path = Path(features_path)
        self.initial_capital = initial_capital
        self.embargo_days = embargo_days

        # Load features
        logger.info(f"Loading features from {features_path}")
        self.features = pd.read_parquet(features_path)
        if 'date' not in self.features.columns and 'timestamp' not in self.features.columns:
            raise ValueError("Features must have 'date' or 'timestamp' column")

        date_col = 'date' if 'date' in self.features.columns else 'timestamp'
        self.features['date'] = pd.to_datetime(self.features[date_col])
        self.features = self.features.set_index('date').sort_index()

        # Execution model
        self.execution_model = UnifiedExecutionModel()

        # Optional: Initialize PrecisionBacktester if paths provided
        self.precision_backtester = None
        if price_data_path and regime_path:
            logger.info("Initializing PrecisionBacktester for structure-based execution")
            self.precision_backtester = PrecisionBacktester(
                data_path=Path(price_data_path),
                regime_path=Path(regime_path),
                initial_capital=initial_capital
            )

        logger.info(f"Loaded {len(self.features)} days of features")

    def get_discovery_dates(self) -> pd.DatetimeIndex:
        """
        Return odd months 2020-2024.

        Odd months: January(1), March(3), May(5), July(7), September(9), November(11)
        Excludes last 5 days of each odd month (embargo).
        """
        all_dates = self.features.index

        # Filter to 2020-2024
        mask = (all_dates.year >= 2020) & (all_dates.year <= 2024)
        dates = all_dates[mask]

        # Filter to odd months
        odd_months = [1, 3, 5, 7, 9, 11]
        dates = dates[dates.month.isin(odd_months)]

        # Apply embargo: exclude last 5 days of each odd month
        dates_with_embargo = []
        for year in range(2020, 2025):
            for month in odd_months:
                month_dates = dates[(dates.year == year) & (dates.month == month)]
                if len(month_dates) > self.embargo_days:
                    # Exclude last embargo_days
                    dates_with_embargo.extend(month_dates[:-self.embargo_days].tolist())

        result = pd.DatetimeIndex(sorted(dates_with_embargo))
        logger.info(f"Discovery set: {len(result)} days from odd months 2020-2024 (with {self.embargo_days}-day embargo)")
        return result

    def get_validation_dates(self) -> pd.DatetimeIndex:
        """
        Return even months 2020-2024 with 5-day embargo from discovery.

        Even months: February(2), April(4), June(6), August(8), October(10), December(12)
        Excludes first 5 days of each even month (embargo).
        """
        all_dates = self.features.index

        # Filter to 2020-2024
        mask = (all_dates.year >= 2020) & (all_dates.year <= 2024)
        dates = all_dates[mask]

        # Filter to even months
        even_months = [2, 4, 6, 8, 10, 12]
        dates = dates[dates.month.isin(even_months)]

        # Apply embargo: exclude first 5 days of each even month
        dates_with_embargo = []
        for year in range(2020, 2025):
            for month in even_months:
                month_dates = dates[(dates.year == year) & (dates.month == month)]
                if len(month_dates) > self.embargo_days:
                    # Exclude first embargo_days
                    dates_with_embargo.extend(month_dates[self.embargo_days:].tolist())

        result = pd.DatetimeIndex(sorted(dates_with_embargo))
        logger.info(f"Validation set: {len(result)} days from even months 2020-2024 (with {self.embargo_days}-day embargo)")
        return result

    def get_walkforward_dates(self) -> pd.DatetimeIndex:
        """
        Return all of 2025.
        """
        all_dates = self.features.index
        dates = all_dates[all_dates.year == 2025]
        logger.info(f"Walk-forward set: {len(dates)} days from 2025")
        return dates

    def _find_optimal_threshold(
        self,
        factor_values: pd.Series,
        returns: pd.Series,
        min_trades: int = 20,
        significance_level: float = 0.05
    ) -> Tuple[float, float, str]:
        """
        Find optimal entry threshold using statistical significance.

        Tests multiple percentile thresholds and finds the one that maximizes
        risk-adjusted returns while maintaining statistical significance.

        Args:
            factor_values: Factor values over time
            returns: Forward returns over time
            min_trades: Minimum number of trades required
            significance_level: P-value threshold for statistical significance

        Returns:
            (entry_threshold, exit_threshold, direction)
        """
        # Align factor values and returns
        aligned = pd.DataFrame({
            'factor': factor_values,
            'returns': returns
        }).dropna()

        if len(aligned) < min_trades * 2:
            logger.warning(f"Insufficient data for threshold optimization: {len(aligned)} days")
            return 0.0, 0.0, "long"

        best_sharpe = -999
        best_threshold = 0.0
        best_direction = "long"

        # Test percentile thresholds
        percentiles = [10, 20, 30, 40, 60, 70, 80, 90]

        for percentile in percentiles:
            threshold = np.percentile(aligned['factor'], percentile)

            # Test long direction
            long_mask = aligned['factor'] > threshold
            if long_mask.sum() >= min_trades:
                long_returns = aligned.loc[long_mask, 'returns']
                if len(long_returns) > 0:
                    sharpe = long_returns.mean() / long_returns.std() * np.sqrt(252) if long_returns.std() > 0 else 0
                    t_stat, p_val = stats.ttest_1samp(long_returns, 0)

                    if p_val < significance_level and sharpe > best_sharpe:
                        best_sharpe = sharpe
                        best_threshold = threshold
                        best_direction = "long"

            # Test short direction
            short_mask = aligned['factor'] < -threshold
            if short_mask.sum() >= min_trades:
                short_returns = aligned.loc[short_mask, 'returns']
                if len(short_returns) > 0:
                    sharpe = short_returns.mean() / short_returns.std() * np.sqrt(252) if short_returns.std() > 0 else 0
                    t_stat, p_val = stats.ttest_1samp(short_returns, 0)

                    if p_val < significance_level and sharpe > best_sharpe:
                        best_sharpe = sharpe
                        best_threshold = -threshold
                        best_direction = "short"

        # Exit threshold: use median of factor values when signal is active
        # Simplified: exit when factor crosses zero or reverses direction
        exit_threshold = 0.0

        logger.info(f"Optimal threshold: {best_threshold:.4f} (direction={best_direction}, Sharpe={best_sharpe:.3f})")
        return best_threshold, exit_threshold, best_direction

    def run_backtest(
        self,
        factor_name: str,
        entry_threshold: float,
        exit_threshold: float,
        direction: str,
        dates: pd.DatetimeIndex
    ) -> BacktestResult:
        """
        Run backtest on specified dates using fixed thresholds.

        IMPORTANT: This is an EQUITY-ONLY backtester. It uses spot price movements
        for P&L calculation. For options strategies, use PrecisionBacktester instead.

        Args:
            factor_name: Name of factor to compute
            entry_threshold: Threshold for entry signal
            exit_threshold: Threshold for exit signal
            direction: "long" or "short"
            dates: Dates to backtest over

        Returns:
            BacktestResult with all metrics
        """
        # Compute factor values
        factor_values = self.factor_computer.compute_factor(factor_name, self.features)

        # LAG FACTOR VALUES BY 1 DAY to prevent look-ahead bias
        # At time t, we only know factor values through t-1
        factor_values = factor_values.shift(1)

        # Generate signals
        signals = self.signal_generator.generate_signal(
            factor_values, entry_threshold, exit_threshold, direction
        )

        # Initialize tracking
        trades = []
        equity = self.initial_capital
        equity_curve = []

        current_position = None
        entry_date = None
        entry_price = None

        # Simulate trading
        for date in dates:
            if date not in signals.index or date not in self.features.index:
                continue

            signal = signals[date]
            features_row = self.features.loc[date]
            # EQUITY ONLY: Using spot/close price for linear P&L model
            spot = features_row.get('close', features_row.get('spot', 0))

            # Exit logic
            if current_position is not None:
                should_exit = False
                exit_reason = ""

                # Check exit threshold
                if direction == "long" and factor_values.get(date, 0) < exit_threshold:
                    should_exit = True
                    exit_reason = "EXIT_THRESHOLD"
                elif direction == "short" and factor_values.get(date, 0) > exit_threshold:
                    should_exit = True
                    exit_reason = "EXIT_THRESHOLD"

                # Check signal reversal
                if signal == 0:
                    should_exit = True
                    exit_reason = "SIGNAL_EXIT"

                if should_exit:
                    # Calculate P&L (simplified - assumes linear return)
                    days_held = (date - entry_date).days
                    if days_held > 0:
                        # Use simplified P&L based on spot movement
                        pct_change = (spot - entry_price) / entry_price if entry_price > 0 else 0
                        if direction == "short":
                            pct_change = -pct_change

                        pnl = equity * pct_change * 0.1  # 10% of equity per trade
                        commission = self.execution_model.get_commission_cost(1)

                        trades.append({
                            'entry': entry_date,
                            'exit': date,
                            'pnl': pnl - commission,
                            'reason': exit_reason,
                            'days_held': days_held
                        })

                        equity += pnl - commission

                    current_position = None
                    entry_date = None
                    entry_price = None

            # Entry logic
            if current_position is None and signal != 0:
                current_position = signal
                entry_date = date
                # EQUITY ONLY: Using spot price as entry price
                entry_price = spot

            equity_curve.append({
                'date': date,
                'equity': equity
            })

        # Close any open position
        if current_position is not None and len(dates) > 0:
            final_date = dates[-1]
            final_spot = self.features.loc[final_date].get('close', self.features.loc[final_date].get('spot', 0))
            days_held = (final_date - entry_date).days

            pct_change = (final_spot - entry_price) / entry_price if entry_price > 0 else 0
            if direction == "short":
                pct_change = -pct_change

            pnl = equity * pct_change * 0.1
            commission = self.execution_model.get_commission_cost(1)

            trades.append({
                'entry': entry_date,
                'exit': final_date,
                'pnl': pnl - commission,
                'reason': 'END_OF_PERIOD',
                'days_held': days_held
            })

            equity += pnl - commission

        # Compute metrics
        equity_df = pd.DataFrame(equity_curve)
        if equity_df.empty or len(trades) == 0:
            return self._empty_result()

        equity_df = equity_df.set_index('date')

        # Use LOG RETURNS for geometric compounding
        equity_df['log_returns'] = np.log(equity_df['equity'] / equity_df['equity'].shift(1)).fillna(0)

        # Calculate total return geometrically
        total_return = (equity - self.initial_capital) / self.initial_capital

        # Annualize using geometric mean
        n_days = len(equity_df)
        if n_days > 0:
            # Geometric annualization: (1 + total_return)^(252/n_days) - 1
            ann_return = (1 + total_return) ** (252 / n_days) - 1
        else:
            ann_return = 0

        # Annualized volatility from log returns
        ann_vol = equity_df['log_returns'].std() * np.sqrt(252)

        # Sharpe ratio
        sharpe = ann_return / ann_vol if ann_vol > 0 else 0

        # Risk metrics (using log returns)
        # FIX: Sortino uses LPM2 (Lower Partial Moment), not std of negative returns
        # Per Gemini audit 2025-12-06: std(neg_returns) measures dispersion around mean loss,
        # which is wrong. LPM2 = sqrt(mean(min(r, 0)^2)) measures dispersion around zero.
        downside_returns = np.minimum(equity_df['log_returns'], 0)  # Clip positive to 0
        downside_vol = np.sqrt((downside_returns ** 2).mean()) * np.sqrt(252)
        sortino = ann_return / downside_vol if downside_vol > 0 else 0

        cum_max = equity_df['equity'].expanding().max()
        drawdown = (equity_df['equity'] - cum_max) / cum_max
        max_dd = abs(drawdown.min()) if len(drawdown) > 0 else 0

        calmar = ann_return / max_dd if max_dd > 0 else 0

        # Trade metrics
        trade_pnls = [t['pnl'] for t in trades]
        winners = [p for p in trade_pnls if p > 0]
        losers = [p for p in trade_pnls if p <= 0]

        win_rate = len(winners) / len(trades) if len(trades) > 0 else 0

        total_gains = sum(winners)
        total_losses = abs(sum(losers))
        profit_factor = total_gains / total_losses if total_losses > 0 else 0

        avg_trade = np.mean(trade_pnls) if trade_pnls else 0

        total_commission = sum(self.execution_model.get_commission_cost(1) for _ in trades)

        # Statistical significance
        t_stat, p_val = stats.ttest_1samp(trade_pnls, 0) if len(trade_pnls) > 1 else (0.0, 1.0)
        is_significant = p_val < 0.05

        return BacktestResult(
            sharpe=sharpe,
            total_return=total_return,
            max_drawdown=max_dd,
            win_rate=win_rate,
            n_trades=len(trades),
            trades=trades,
            sortino_ratio=sortino,
            calmar_ratio=calmar,
            profit_factor=profit_factor,
            avg_trade_return=avg_trade,
            total_commission=total_commission,
            total_slippage=0.0,
            t_statistic=t_stat,
            p_value=p_val,
            is_significant=is_significant,
            equity_curve=equity_df
        )

    def _empty_result(self) -> BacktestResult:
        """Return empty result for insufficient data."""
        return BacktestResult(
            sharpe=0.0,
            total_return=0.0,
            max_drawdown=0.0,
            win_rate=0.0,
            n_trades=0,
            trades=[],
            sortino_ratio=0.0,
            calmar_ratio=0.0,
            profit_factor=0.0,
            avg_trade_return=0.0,
            total_commission=0.0,
            total_slippage=0.0,
            t_statistic=0.0,
            p_value=1.0,
            is_significant=False,
            equity_curve=None
        )

    def three_set_validate(
        self,
        factor_name: str,
        auto_optimize_threshold: bool = True,
        entry_threshold: Optional[float] = None,
        exit_threshold: Optional[float] = None,
        direction: Optional[str] = None
    ) -> ValidationResult:
        """
        Full three-set validation workflow.

        Workflow:
        1. Discovery Set: Find optimal threshold using statistical significance
        2. Validation Set: Confirm threshold (NO re-optimization)
        3. Walk-Forward Set: Final test (NO re-optimization)

        Args:
            factor_name: Name of factor to test
            auto_optimize_threshold: If True, find threshold on Discovery set
            entry_threshold: Manual entry threshold (if auto_optimize_threshold=False)
            exit_threshold: Manual exit threshold (if auto_optimize_threshold=False)
            direction: Manual direction "long" or "short" (if auto_optimize_threshold=False)

        Returns:
            ValidationResult with results from all three sets
        """
        logger.info(f"\n{'='*80}")
        logger.info(f"THREE-SET VALIDATION: {factor_name}")
        logger.info(f"{'='*80}")

        # Get date splits
        discovery_dates = self.get_discovery_dates()
        validation_dates = self.get_validation_dates()
        walkforward_dates = self.get_walkforward_dates()

        # Step 1: Discovery Set - Find threshold
        if auto_optimize_threshold:
            logger.info("\nStep 1: Discovery Set - Finding optimal threshold...")

            # Compute factor values
            factor_values_raw = self.factor_computer.compute_factor(factor_name, self.features)

            # LAG FACTOR VALUES BY 1 DAY to prevent look-ahead bias
            # At time t, we only know factor values through t-1
            factor_values = factor_values_raw.shift(1)

            # Compute FORWARD returns to align with factor values
            # factor[t] (shifted, so what we knew yesterday) predicts return[t] (tomorrow's return)
            # shift(-1) moves returns forward: at time t, we predict t+1's return
            returns = self.features['close'].pct_change().shift(-1).fillna(0)

            # Find optimal threshold
            entry_threshold, exit_threshold, direction = self._find_optimal_threshold(
                factor_values[discovery_dates],
                returns[discovery_dates]
            )
        else:
            if entry_threshold is None or direction is None:
                raise ValueError("Must provide entry_threshold and direction if auto_optimize_threshold=False")
            if exit_threshold is None:
                exit_threshold = 0.0

            logger.info(f"\nUsing manual thresholds: entry={entry_threshold}, exit={exit_threshold}, direction={direction}")

        # Run backtest on Discovery set
        logger.info("\nRunning backtest on Discovery Set...")
        discovery_result = self.run_backtest(
            factor_name, entry_threshold, exit_threshold, direction, discovery_dates
        )
        logger.info(f"Discovery: Sharpe={discovery_result.sharpe:.3f}, Return={discovery_result.total_return:.2%}, Trades={discovery_result.n_trades}")

        # Step 2: Validation Set - Test threshold (NO re-optimization)
        logger.info("\nStep 2: Validation Set - Testing threshold...")
        validation_result = self.run_backtest(
            factor_name, entry_threshold, exit_threshold, direction, validation_dates
        )
        logger.info(f"Validation: Sharpe={validation_result.sharpe:.3f}, Return={validation_result.total_return:.2%}, Trades={validation_result.n_trades}")

        # Step 3: Walk-Forward Set - Final test (NO re-optimization)
        logger.info("\nStep 3: Walk-Forward Set - Final test...")
        walkforward_result = self.run_backtest(
            factor_name, entry_threshold, exit_threshold, direction, walkforward_dates
        )
        logger.info(f"Walk-Forward: Sharpe={walkforward_result.sharpe:.3f}, Return={walkforward_result.total_return:.2%}, Trades={walkforward_result.n_trades}")

        # Determine survival
        survival = (
            discovery_result.sharpe > 0 and
            validation_result.sharpe > 0 and
            walkforward_result.sharpe > 0
        )

        result = ValidationResult(
            discovery_result=discovery_result,
            validation_result=validation_result,
            walkforward_result=walkforward_result,
            survival=survival,
            entry_threshold=entry_threshold,
            exit_threshold=exit_threshold,
            direction=direction,
            factor_name=factor_name
        )

        logger.info(f"\n{'='*80}")
        logger.info(f"SURVIVAL: {'PASS' if survival else 'FAIL'}")
        logger.info(f"{'='*80}\n")

        return result


# ============================================================================
# CLI
# ============================================================================

if __name__ == '__main__':
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    parser = argparse.ArgumentParser(description='Factor backtester with three-set validation')
    parser.add_argument('--features', type=str, required=True, help='Path to features parquet')
    parser.add_argument('--factor', type=str, required=True, help='Factor name to test')
    parser.add_argument('--entry-threshold', type=float, help='Manual entry threshold')
    parser.add_argument('--exit-threshold', type=float, default=0.0, help='Manual exit threshold')
    parser.add_argument('--direction', type=str, choices=['long', 'short'], help='Manual direction')

    args = parser.parse_args()

    # TODO: Implement mock factor_computer, signal_generator, strategy_mapper
    # For now, this is a template
    print(f"\nFactor Backtester initialized")
    print(f"Features: {args.features}")
    print(f"Factor: {args.factor}")
    print(f"\nTo use this module, provide:")
    print("  - factor_computer: Object with compute_factor() method")
    print("  - signal_generator: Object with generate_signal() method")
    print("  - strategy_mapper: Object with map_to_structure() method")
