"""
Signal Generator for Factor Strategy Engine

Converts continuous factor values into discrete trade signals using:
- Threshold crossing logic with hysteresis
- Cooldown periods to prevent overtrading
- Statistical significance-based threshold optimization
- Embargo period filtering for walk-forward validation

Author: Market Physics Engine
Date: 2025-12-06
"""

import logging
from typing import Dict, List, Literal, Optional, Tuple
import numpy as np
import pandas as pd
from scipy import stats
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ThresholdResult:
    """Results from statistical threshold finding"""
    entry_threshold: float
    exit_threshold: float
    t_statistic: float
    p_value: float
    mean_return_high: float
    mean_return_low: float
    n_high: int
    n_low: int

    def is_significant(self, alpha: float = 0.05) -> bool:
        """Check if threshold is statistically significant"""
        return self.p_value < alpha


class SignalGenerator:
    """
    Generate trading signals from factor values using threshold crossing logic.

    Key Features:
    - Hysteresis: Entry threshold != exit threshold to prevent whipsaws
    - Cooldown: Minimum days between trades
    - Theory-driven: Thresholds based on statistical significance, not grid search
    - Embargo: Filter signals during discovery/validation boundary periods

    Example:
        >>> factor_data = pd.DataFrame({
        ...     'date': pd.date_range('2020-01-01', periods=100),
        ...     'momentum': np.random.randn(100),
        ...     'forward_return': np.random.randn(100) * 0.01
        ... }).set_index('date')
        >>>
        >>> sg = SignalGenerator(factor_data)
        >>> signals = sg.generate_signals(
        ...     'momentum',
        ...     entry_threshold=1.5,
        ...     exit_threshold=0.5,
        ...     direction='above'
        ... )
    """

    def __init__(self, factor_data: pd.DataFrame):
        """
        Initialize signal generator.

        Args:
            factor_data: DataFrame with DatetimeIndex and factor columns
        """
        if not isinstance(factor_data.index, pd.DatetimeIndex):
            raise ValueError("factor_data must have DatetimeIndex")

        self.factor_data = factor_data.copy()
        logger.info(f"Initialized SignalGenerator with {len(self.factor_data)} rows, "
                   f"date range: {self.factor_data.index.min()} to {self.factor_data.index.max()}")

    def generate_signals(
        self,
        factor_name: str,
        entry_threshold: float,
        exit_threshold: float,
        direction: Literal["above", "below"],
        cooldown_days: int = 5,
        max_hold_days: Optional[int] = None
    ) -> pd.DataFrame:
        """
        Generate entry/exit signals based on threshold crossings.

        Logic:
        - Entry: Factor crosses entry_threshold in specified direction
        - Exit: Factor crosses exit_threshold opposite direction OR max_hold_days reached
        - Cooldown: After exit, no new entry for cooldown_days

        Args:
            factor_name: Column name in factor_data
            entry_threshold: Threshold to trigger entry
            exit_threshold: Threshold to trigger exit (hysteresis prevents whipsaw)
            direction: 'above' (long when factor > threshold) or 'below' (short)
            cooldown_days: Minimum days between trades
            max_hold_days: Maximum holding period (None = unlimited)

        Returns:
            DataFrame with columns [signal] where:
                1 = enter position
                0 = hold current state
                -1 = exit position
        """
        if factor_name not in self.factor_data.columns:
            raise ValueError(f"Factor '{factor_name}' not found in data. "
                           f"Available: {list(self.factor_data.columns)}")

        factor_values = self.factor_data[factor_name].copy()

        # Initialize signal series
        signals = pd.Series(0, index=factor_values.index, name='signal')

        # Track state
        in_position = False
        cooldown_until = None
        position_entered_date = None

        for date in factor_values.index:
            factor_val = factor_values.loc[date]

            # Skip if in cooldown period
            if cooldown_until is not None and date < cooldown_until:
                signals.loc[date] = 0
                continue

            # Check for entry condition
            if not in_position:
                entry_condition = (
                    (direction == "above" and factor_val > entry_threshold) or
                    (direction == "below" and factor_val < entry_threshold)
                )

                if entry_condition and not pd.isna(factor_val):
                    signals.loc[date] = 1  # Enter
                    in_position = True
                    position_entered_date = date
                    logger.debug(f"{date}: ENTRY signal - {factor_name}={factor_val:.4f}, "
                               f"threshold={entry_threshold:.4f}, direction={direction}")

            # Check for exit condition
            else:
                # Exit if factor crosses exit threshold opposite direction
                exit_condition = (
                    (direction == "above" and factor_val < exit_threshold) or
                    (direction == "below" and factor_val > exit_threshold)
                )

                # Exit if max hold period reached
                max_hold_exit = False
                if max_hold_days is not None and position_entered_date is not None:
                    days_in_position = (date - position_entered_date).days
                    max_hold_exit = days_in_position >= max_hold_days

                if (exit_condition or max_hold_exit) and not pd.isna(factor_val):
                    signals.loc[date] = -1  # Exit
                    in_position = False
                    cooldown_until = date + pd.Timedelta(days=cooldown_days)

                    reason = "max_hold" if max_hold_exit else "threshold"
                    logger.debug(f"{date}: EXIT signal ({reason}) - {factor_name}={factor_val:.4f}, "
                               f"exit_threshold={exit_threshold:.4f}")
                    position_entered_date = None

        # Create result DataFrame
        result = pd.DataFrame({'signal': signals})

        n_entries = (signals == 1).sum()
        n_exits = (signals == -1).sum()
        logger.info(f"Generated signals for {factor_name}: "
                   f"{n_entries} entries, {n_exits} exits, "
                   f"cooldown={cooldown_days}d")

        return result

    def find_significant_threshold(
        self,
        factor_name: str,
        train_dates: pd.DatetimeIndex,
        forward_returns: pd.Series,
        direction: Literal["above", "below"],
        significance_level: float = 0.05,
        hysteresis_factor: float = 0.5,
        min_samples_per_group: int = 20
    ) -> ThresholdResult:
        """
        Find threshold where factor predicts returns with statistical significance.

        Uses t-test to find threshold that splits data into two groups with
        significantly different mean returns. Theory-driven, not grid search.

        Method:
        1. Sort factor values in training period
        2. For candidate thresholds (percentiles), compute:
           - Mean return when factor > threshold (high group)
           - Mean return when factor < threshold (low group)
           - T-statistic and p-value for difference
        3. Select threshold with strongest significance
        4. Set exit threshold with hysteresis to prevent whipsaw

        Args:
            factor_name: Column name in factor_data
            train_dates: DatetimeIndex of training period
            forward_returns: Series of forward returns aligned with factor_data
            direction: 'above' (high factor = good) or 'below' (low factor = good)
            significance_level: Alpha for hypothesis test
            hysteresis_factor: Exit threshold = entry_threshold * (1 ± hysteresis_factor)
            min_samples_per_group: Minimum observations in each group for valid test

        Returns:
            ThresholdResult with entry/exit thresholds and test statistics
        """
        if factor_name not in self.factor_data.columns:
            raise ValueError(f"Factor '{factor_name}' not found")

        # Get training data
        train_data = self.factor_data.loc[train_dates]
        factor_train = train_data[factor_name].copy()
        returns_train = forward_returns.loc[train_dates]

        # Remove NaN values
        valid_mask = ~(factor_train.isna() | returns_train.isna())
        factor_train = factor_train[valid_mask]
        returns_train = returns_train[valid_mask]

        if len(factor_train) < 2 * min_samples_per_group:
            raise ValueError(f"Insufficient training data: {len(factor_train)} samples, "
                           f"need at least {2 * min_samples_per_group}")

        logger.info(f"Finding significant threshold for {factor_name} "
                   f"on {len(factor_train)} training samples")

        # Test percentiles as candidate thresholds
        # Avoid extremes to ensure sufficient samples in both groups
        percentiles = np.arange(20, 81, 5)  # 20th to 80th percentile
        candidate_thresholds = np.percentile(factor_train, percentiles)

        best_result = None
        best_significance = 1.0  # p-value (lower is better)

        for threshold in candidate_thresholds:
            # Split into high and low factor groups
            high_mask = factor_train > threshold
            low_mask = factor_train <= threshold

            returns_high = returns_train[high_mask]
            returns_low = returns_train[low_mask]

            # Skip if not enough samples in either group
            if len(returns_high) < min_samples_per_group or len(returns_low) < min_samples_per_group:
                continue

            # Perform t-test
            t_stat, p_value = stats.ttest_ind(returns_high, returns_low, equal_var=False)

            mean_high = returns_high.mean()
            mean_low = returns_low.mean()

            # Check if direction matches expectation
            if direction == "above":
                # We want high factor to predict high returns
                correct_direction = mean_high > mean_low
            else:
                # We want low factor to predict high returns
                correct_direction = mean_low > mean_high

            # Update best if more significant and correct direction
            if correct_direction and p_value < best_significance:
                best_significance = p_value

                entry_threshold = threshold

                # Calculate exit threshold with hysteresis
                if direction == "above":
                    # Exit when factor drops below entry * (1 - hysteresis)
                    exit_threshold = entry_threshold * (1 - hysteresis_factor)
                else:
                    # Exit when factor rises above entry * (1 - hysteresis)
                    exit_threshold = entry_threshold * (1 - hysteresis_factor)

                best_result = ThresholdResult(
                    entry_threshold=entry_threshold,
                    exit_threshold=exit_threshold,
                    t_statistic=t_stat,
                    p_value=p_value,
                    mean_return_high=mean_high,
                    mean_return_low=mean_low,
                    n_high=len(returns_high),
                    n_low=len(returns_low)
                )

        if best_result is None:
            raise ValueError(f"Could not find valid threshold for {factor_name}. "
                           f"Try increasing data range or reducing min_samples_per_group.")

        logger.info(f"Found threshold for {factor_name}: "
                   f"entry={best_result.entry_threshold:.4f}, "
                   f"exit={best_result.exit_threshold:.4f}, "
                   f"p-value={best_result.p_value:.6f}, "
                   f"significant={best_result.is_significant(significance_level)}")

        return best_result

    def apply_embargo(
        self,
        signals: pd.DataFrame,
        embargo_dates: List[pd.Timestamp],
        embargo_days_before: int = 5,
        embargo_days_after: int = 5
    ) -> pd.DataFrame:
        """
        Zero out signals during embargo periods.

        Embargo prevents look-ahead bias by avoiding trades near the boundary
        between discovery and validation periods. For example, if we discovered
        a pattern in January data and validate in February, we embargo 5 days
        before and after Feb 1 to prevent information leakage.

        Args:
            signals: DataFrame with 'signal' column
            embargo_dates: List of dates marking discovery/validation boundaries
            embargo_days_before: Days to embargo before boundary
            embargo_days_after: Days to embargo after boundary

        Returns:
            DataFrame with signals zeroed out during embargo periods
        """
        result = signals.copy()

        n_embargoed = 0
        for boundary_date in embargo_dates:
            embargo_start = boundary_date - pd.Timedelta(days=embargo_days_before)
            embargo_end = boundary_date + pd.Timedelta(days=embargo_days_after)

            # Zero out signals in embargo window
            embargo_mask = (result.index >= embargo_start) & (result.index <= embargo_end)
            n_embargoed += embargo_mask.sum()
            result.loc[embargo_mask, 'signal'] = 0

            logger.debug(f"Embargoed {embargo_mask.sum()} signals around {boundary_date} "
                        f"({embargo_start} to {embargo_end})")

        logger.info(f"Applied embargo: zeroed {n_embargoed} signals across "
                   f"{len(embargo_dates)} boundary dates")

        return result

    def generate_signals_with_adaptive_thresholds(
        self,
        factor_name: str,
        train_dates: pd.DatetimeIndex,
        test_dates: pd.DatetimeIndex,
        forward_returns: pd.Series,
        direction: Literal["above", "below"],
        significance_level: float = 0.05,
        cooldown_days: int = 5,
        embargo_dates: Optional[List[pd.Timestamp]] = None
    ) -> Tuple[pd.DataFrame, ThresholdResult]:
        """
        End-to-end signal generation with statistical threshold optimization.

        Workflow:
        1. Find statistically significant threshold on training data
        2. Generate signals on test data using found thresholds
        3. Apply embargo if boundary dates provided

        Args:
            factor_name: Factor to generate signals from
            train_dates: Training period for threshold finding
            test_dates: Testing period for signal generation
            forward_returns: Returns for threshold optimization
            direction: 'above' or 'below'
            significance_level: Alpha for significance test
            cooldown_days: Days between trades
            embargo_dates: Optional embargo boundary dates

        Returns:
            Tuple of (signals DataFrame, ThresholdResult)
        """
        # Step 1: Find optimal threshold on training data
        threshold_result = self.find_significant_threshold(
            factor_name=factor_name,
            train_dates=train_dates,
            forward_returns=forward_returns,
            direction=direction,
            significance_level=significance_level
        )

        if not threshold_result.is_significant(significance_level):
            logger.warning(f"Threshold for {factor_name} not significant at alpha={significance_level} "
                          f"(p-value={threshold_result.p_value:.4f}). Signals may be unreliable.")

        # Step 2: Generate signals on test data
        test_data = self.factor_data.loc[test_dates]
        test_generator = SignalGenerator(test_data)

        signals = test_generator.generate_signals(
            factor_name=factor_name,
            entry_threshold=threshold_result.entry_threshold,
            exit_threshold=threshold_result.exit_threshold,
            direction=direction,
            cooldown_days=cooldown_days
        )

        # Step 3: Apply embargo if needed
        if embargo_dates is not None:
            signals = self.apply_embargo(signals, embargo_dates)

        logger.info(f"Generated adaptive signals for {factor_name}: "
                   f"{(signals['signal'] == 1).sum()} entries in test period")

        return signals, threshold_result

    def compute_signal_quality_metrics(
        self,
        signals: pd.DataFrame,
        forward_returns: pd.Series
    ) -> Dict[str, float]:
        """
        Evaluate signal quality using returns data.

        Metrics:
        - Hit rate: % of entry signals followed by positive returns
        - Mean return on entries: Average forward return when entering
        - Signal-to-noise: Mean return / Std return on entries

        Args:
            signals: DataFrame with 'signal' column
            forward_returns: Series of forward returns

        Returns:
            Dict of quality metrics
        """
        # Get entry signals
        entry_mask = signals['signal'] == 1
        entry_dates = signals[entry_mask].index

        if len(entry_dates) == 0:
            logger.warning("No entry signals found, cannot compute quality metrics")
            return {
                'n_entries': 0,
                'hit_rate': np.nan,
                'mean_return': np.nan,
                'std_return': np.nan,
                'signal_to_noise': np.nan
            }

        # Get forward returns on entry dates
        entry_returns = forward_returns.loc[entry_dates]
        entry_returns = entry_returns.dropna()

        if len(entry_returns) == 0:
            logger.warning("No valid forward returns for entry signals")
            return {
                'n_entries': len(entry_dates),
                'hit_rate': np.nan,
                'mean_return': np.nan,
                'std_return': np.nan,
                'signal_to_noise': np.nan
            }

        # Calculate metrics
        hit_rate = (entry_returns > 0).mean()
        mean_return = entry_returns.mean()
        std_return = entry_returns.std()
        signal_to_noise = mean_return / std_return if std_return > 0 else np.nan

        metrics = {
            'n_entries': len(entry_returns),
            'hit_rate': hit_rate,
            'mean_return': mean_return,
            'std_return': std_return,
            'signal_to_noise': signal_to_noise
        }

        logger.info(f"Signal quality: hit_rate={hit_rate:.2%}, "
                   f"mean_return={mean_return:.4f}, "
                   f"SNR={signal_to_noise:.2f}")

        return metrics
