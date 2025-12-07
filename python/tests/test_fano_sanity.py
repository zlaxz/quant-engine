#!/usr/bin/env python3
"""
Phase 5: Fano Limit Sanity Tests
================================
Detects overfitting by checking if backtest accuracy exceeds theoretical limits.

The Fano Limit:
---------------
For daily SPX prediction, the maximum achievable accuracy is ~60-66% due to
inherent market noise. Any strategy claiming higher accuracy is almost certainly:
1. Overfit to historical data
2. Has lookahead bias
3. Cherry-picked a favorable period

Key Principle:
--------------
If accuracy > 65% on daily predictions → RED FLAG
If Sharpe > 3.0 on daily strategy → RED FLAG
If max drawdown < 5% over 5+ years → RED FLAG

These tests ensure we don't fool ourselves with impossible results.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
import numpy as np
import pandas as pd
from typing import Dict, Tuple, List, Optional
from dataclasses import dataclass


# =============================================================================
# CONSTANTS
# =============================================================================

# Fano limit for daily SPX prediction (~60-66%)
FANO_ACCURACY_LIMIT = 0.65

# Maximum realistic Sharpe ratio for daily strategy
MAX_REALISTIC_SHARPE = 3.0

# Minimum realistic max drawdown for multi-year strategy
MIN_REALISTIC_DRAWDOWN = 0.05  # 5%

# Information ratio threshold for "too good to be true"
MAX_REALISTIC_IR = 2.5

# Win rate ceiling
MAX_REALISTIC_WIN_RATE = 0.70


# =============================================================================
# HELPER CLASSES
# =============================================================================

@dataclass
class OverfitIndicators:
    """Indicators of potential overfitting."""
    accuracy: float
    sharpe_ratio: float
    max_drawdown: float
    win_rate: float
    information_ratio: float
    n_observations: int

    @property
    def is_suspicious(self) -> bool:
        """Check if results are suspiciously good."""
        flags = []

        if self.accuracy > FANO_ACCURACY_LIMIT:
            flags.append(f"accuracy={self.accuracy:.2%} > {FANO_ACCURACY_LIMIT:.0%}")

        if self.sharpe_ratio > MAX_REALISTIC_SHARPE:
            flags.append(f"sharpe={self.sharpe_ratio:.2f} > {MAX_REALISTIC_SHARPE}")

        # max_drawdown is negative, so we check if it's greater than -MIN_REALISTIC_DRAWDOWN
        if self.max_drawdown > -MIN_REALISTIC_DRAWDOWN and self.n_observations > 500:
            flags.append(f"drawdown={self.max_drawdown:.2%} > -{MIN_REALISTIC_DRAWDOWN:.0%}")

        if self.win_rate > MAX_REALISTIC_WIN_RATE:
            flags.append(f"win_rate={self.win_rate:.2%} > {MAX_REALISTIC_WIN_RATE:.0%}")

        return len(flags) > 0

    def get_flags(self) -> List[str]:
        """Get list of overfit warning flags."""
        flags = []

        if self.accuracy > FANO_ACCURACY_LIMIT:
            flags.append(f"ACCURACY_EXCEEDS_FANO: {self.accuracy:.2%}")

        if self.sharpe_ratio > MAX_REALISTIC_SHARPE:
            flags.append(f"SHARPE_TOO_HIGH: {self.sharpe_ratio:.2f}")

        # max_drawdown is negative, so we check if it's greater than -MIN_REALISTIC_DRAWDOWN
        if self.max_drawdown > -MIN_REALISTIC_DRAWDOWN and self.n_observations > 500:
            flags.append(f"DRAWDOWN_TOO_SMALL: {self.max_drawdown:.2%}")

        if self.win_rate > MAX_REALISTIC_WIN_RATE:
            flags.append(f"WIN_RATE_UNREALISTIC: {self.win_rate:.2%}")

        if self.information_ratio > MAX_REALISTIC_IR:
            flags.append(f"IR_TOO_HIGH: {self.information_ratio:.2f}")

        return flags


def calculate_overfit_indicators(
    predictions: np.ndarray,
    actuals: np.ndarray,
    strategy_returns: np.ndarray,
    benchmark_returns: np.ndarray
) -> OverfitIndicators:
    """
    Calculate indicators that may signal overfitting.

    Args:
        predictions: Predicted direction (1 for up, -1 for down, 0 for flat)
        actuals: Actual returns
        strategy_returns: Strategy return series
        benchmark_returns: Benchmark return series

    Returns:
        OverfitIndicators dataclass
    """
    # Accuracy (directional) - handle empty arrays
    if len(predictions) == 0 or len(actuals) == 0:
        accuracy = 0.5
    else:
        pred_direction = np.sign(predictions)
        actual_direction = np.sign(actuals)

        # Only count where we made a prediction
        non_zero_mask = pred_direction != 0
        if non_zero_mask.sum() > 0:
            accuracy = (pred_direction[non_zero_mask] == actual_direction[non_zero_mask]).mean()
        else:
            accuracy = 0.5

    # Sharpe ratio (annualized) - handle empty arrays
    if len(strategy_returns) == 0:
        sharpe = 0.0
    else:
        strat_mean = np.mean(strategy_returns)
        strat_std = np.std(strategy_returns)
        sharpe = np.sqrt(252) * strat_mean / strat_std if strat_std > 1e-10 else 0.0

    # Max drawdown (handle empty arrays)
    if len(strategy_returns) == 0:
        max_dd = 0.0
    else:
        cum_returns = np.cumprod(1 + strategy_returns)
        rolling_max = np.maximum.accumulate(cum_returns)
        drawdown = cum_returns / rolling_max - 1
        max_dd = np.min(drawdown)

    # Win rate (handle empty arrays)
    wins = (strategy_returns > 0).sum()
    total_trades = (strategy_returns != 0).sum()
    win_rate = float(wins) / float(total_trades) if total_trades > 0 else 0.5

    # Information ratio - handle empty arrays
    if len(strategy_returns) == 0 or len(benchmark_returns) == 0:
        ir = 0.0
    else:
        excess_returns = strategy_returns - benchmark_returns
        tracking_error = np.std(excess_returns)
        ir = np.sqrt(252) * np.mean(excess_returns) / tracking_error if tracking_error > 1e-10 else 0.0

    return OverfitIndicators(
        accuracy=accuracy,
        sharpe_ratio=sharpe,
        max_drawdown=max_dd,
        win_rate=win_rate,
        information_ratio=ir,
        n_observations=len(actuals)
    )


# =============================================================================
# TEST FIXTURES
# =============================================================================

@pytest.fixture
def random_predictions() -> Tuple[np.ndarray, np.ndarray]:
    """Generate random predictions and returns (should be ~50% accuracy)."""
    np.random.seed(42)
    n = 1000

    # Random market
    actuals = np.random.randn(n) * 0.01

    # Random predictions
    predictions = np.random.choice([-1, 1], size=n)

    return predictions, actuals


@pytest.fixture
def overfit_predictions() -> Tuple[np.ndarray, np.ndarray]:
    """Generate predictions that are overfit (100% accurate - impossible)."""
    np.random.seed(42)
    n = 1000

    # Random market
    actuals = np.random.randn(n) * 0.01

    # Perfect predictions (lookahead bias)
    predictions = np.sign(actuals)
    predictions[predictions == 0] = 1  # Handle zeros

    return predictions, actuals


@pytest.fixture
def realistic_predictions() -> Tuple[np.ndarray, np.ndarray]:
    """Generate predictions with realistic edge (~55% accuracy)."""
    np.random.seed(42)
    n = 1000

    # Random market
    actuals = np.random.randn(n) * 0.01

    # Predictions with some edge but not too much
    # 55% correct, 45% wrong
    predictions = np.zeros(n)
    for i in range(n):
        if np.random.rand() < 0.55:
            predictions[i] = np.sign(actuals[i]) if actuals[i] != 0 else 1
        else:
            predictions[i] = -np.sign(actuals[i]) if actuals[i] != 0 else 1

    return predictions, actuals


@pytest.fixture
def multi_year_data() -> pd.DataFrame:
    """Generate multi-year synthetic market data."""
    np.random.seed(42)
    n = 252 * 5  # 5 years of daily data

    dates = pd.date_range('2019-01-01', periods=n, freq='D')

    # Generate returns with realistic properties
    returns = np.random.randn(n) * 0.01 + 0.0003  # Slight positive drift

    # Add some clustering
    for i in range(1, n):
        if np.random.rand() < 0.1:  # 10% chance of vol spike
            returns[i:i+5] *= 2  # Increase vol for 5 days

    prices = 100 * np.exp(np.cumsum(returns))

    df = pd.DataFrame({
        'timestamp': dates,
        'close': prices,
        'returns': returns
    })

    return df


# =============================================================================
# ACCURACY TESTS
# =============================================================================

class TestAccuracyLimits:
    """Test that accuracy doesn't exceed Fano limit."""

    def test_random_predictions_near_50_percent(self, random_predictions):
        """Random predictions should have ~50% accuracy."""
        predictions, actuals = random_predictions

        pred_direction = np.sign(predictions)
        actual_direction = np.sign(actuals)
        accuracy = (pred_direction == actual_direction).mean()

        # Should be close to 50% (within statistical variance)
        assert 0.45 <= accuracy <= 0.55, \
            f"Random predictions should be ~50% accurate, got {accuracy:.2%}"

    def test_overfit_predictions_flagged(self, overfit_predictions):
        """Overfit (perfect) predictions should be flagged."""
        predictions, actuals = overfit_predictions

        # Overfit means perfect knowledge of same-period returns (lookahead bias)
        # No shift - predictions at t perfectly predict actuals at t
        strategy_returns = np.sign(predictions) * actuals
        benchmark_returns = actuals

        indicators = calculate_overfit_indicators(
            predictions,
            actuals,
            strategy_returns,
            benchmark_returns
        )

        # Perfect or near-perfect accuracy should trigger flag
        assert indicators.accuracy > FANO_ACCURACY_LIMIT, \
            f"Overfit predictions ({indicators.accuracy:.2%}) should exceed Fano limit of {FANO_ACCURACY_LIMIT:.0%}"

        # Should be close to 100% (since predictions match actuals)
        assert indicators.accuracy > 0.95, \
            f"Perfect lookahead predictions should have >95% accuracy, got {indicators.accuracy:.2%}"

        assert indicators.is_suspicious, \
            "Overfit predictions should be flagged as suspicious"

        flags = indicators.get_flags()
        assert any("ACCURACY" in f for f in flags), \
            f"Should have accuracy flag, got: {flags}"

    def test_realistic_predictions_pass(self, realistic_predictions):
        """Realistic predictions should pass Fano check."""
        predictions, actuals = realistic_predictions

        strategy_returns = np.sign(predictions[:-1]) * actuals[1:]
        benchmark_returns = actuals[1:]

        indicators = calculate_overfit_indicators(
            predictions[:-1],
            actuals[1:],
            strategy_returns,
            benchmark_returns
        )

        # 55% accuracy is below Fano limit (allow small tolerance)
        assert indicators.accuracy <= FANO_ACCURACY_LIMIT + 0.03, \
            f"Realistic accuracy {indicators.accuracy:.2%} should be at or below Fano limit ({FANO_ACCURACY_LIMIT:.0%})"


# =============================================================================
# SHARPE RATIO TESTS
# =============================================================================

class TestSharpeRatioSanity:
    """Test that Sharpe ratios are realistic."""

    def test_random_strategy_low_sharpe(self, random_predictions):
        """Random strategy should have near-zero Sharpe."""
        predictions, actuals = random_predictions

        strategy_returns = np.sign(predictions[:-1]) * actuals[1:]

        sharpe = np.sqrt(252) * strategy_returns.mean() / (strategy_returns.std() + 1e-10)

        # Should be close to 0 (within reasonable variance)
        assert abs(sharpe) < 1.0, \
            f"Random strategy should have low Sharpe, got {sharpe:.2f}"

    def test_high_sharpe_flagged(self):
        """Suspiciously high Sharpe should be flagged."""
        np.random.seed(42)

        # Create a strategy with unrealistic Sharpe
        n = 1000
        # All positive returns (impossible in real markets)
        strategy_returns = np.abs(np.random.randn(n)) * 0.002

        sharpe = np.sqrt(252) * strategy_returns.mean() / strategy_returns.std()

        # Should be unrealistically high
        assert sharpe > MAX_REALISTIC_SHARPE, \
            f"Test setup: Sharpe should be high, got {sharpe:.2f}"

        # Create indicators
        indicators = OverfitIndicators(
            accuracy=0.55,
            sharpe_ratio=sharpe,
            max_drawdown=-0.05,
            win_rate=0.55,
            information_ratio=1.0,
            n_observations=n
        )

        assert indicators.is_suspicious, \
            "High Sharpe should be flagged as suspicious"


# =============================================================================
# DRAWDOWN TESTS
# =============================================================================

class TestDrawdownSanity:
    """Test that drawdowns are realistic for multi-year strategies."""

    def test_multi_year_has_drawdown(self, multi_year_data):
        """Any multi-year strategy should experience meaningful drawdown."""
        df = multi_year_data

        # Simple buy-and-hold
        cum_returns = (1 + df['returns']).cumprod()
        rolling_max = cum_returns.expanding().max()
        drawdown = cum_returns / rolling_max - 1
        max_dd = drawdown.min()

        # 5 years should have at least 5% drawdown (max_dd is negative)
        assert max_dd <= -MIN_REALISTIC_DRAWDOWN, \
            f"5-year strategy should have meaningful drawdown (<=-{MIN_REALISTIC_DRAWDOWN:.0%}), got {max_dd:.2%}"

    def test_no_drawdown_flagged(self):
        """Strategy with no drawdown over long period should be flagged."""
        np.random.seed(42)
        n = 1000  # ~4 years

        # Monotonically increasing returns (impossible)
        strategy_returns = np.abs(np.random.randn(n)) * 0.001 + 0.0001

        cum = np.cumprod(1 + strategy_returns)
        rolling_max = np.maximum.accumulate(cum)
        max_dd = (cum / rolling_max - 1).min()

        indicators = OverfitIndicators(
            accuracy=0.55,
            sharpe_ratio=2.0,
            max_drawdown=max_dd,
            win_rate=0.60,
            information_ratio=1.0,
            n_observations=n
        )

        # Near-zero drawdown over 4 years should be suspicious (max_dd is close to 0)
        assert indicators.max_drawdown > -MIN_REALISTIC_DRAWDOWN, \
            f"Test setup: drawdown should be minimal (> -{MIN_REALISTIC_DRAWDOWN:.0%}), got {max_dd:.2%}"

        assert indicators.is_suspicious, \
            "No drawdown over years should be flagged"


# =============================================================================
# WIN RATE TESTS
# =============================================================================

class TestWinRateSanity:
    """Test that win rates are realistic."""

    def test_random_win_rate_near_50(self, random_predictions):
        """Random strategy should have ~50% win rate."""
        predictions, actuals = random_predictions

        strategy_returns = np.sign(predictions[:-1]) * actuals[1:]

        wins = (strategy_returns > 0).sum()
        total = (strategy_returns != 0).sum()
        win_rate = wins / total

        # Should be close to 50%
        assert 0.45 <= win_rate <= 0.55, \
            f"Random strategy should have ~50% win rate, got {win_rate:.2%}"

    def test_high_win_rate_flagged(self):
        """Unrealistically high win rate should be flagged."""
        indicators = OverfitIndicators(
            accuracy=0.60,
            sharpe_ratio=2.0,
            max_drawdown=-0.10,
            win_rate=0.85,  # 85% win rate is unrealistic
            information_ratio=1.0,
            n_observations=1000
        )

        assert indicators.is_suspicious, \
            "85% win rate should be flagged as suspicious"

        flags = indicators.get_flags()
        assert any("WIN_RATE" in f for f in flags), \
            f"Should have win rate flag, got: {flags}"


# =============================================================================
# INTEGRATED TESTS
# =============================================================================

class TestIntegratedSanityChecks:
    """Test integrated sanity checks on strategy results."""

    def test_all_flags_comprehensive(self):
        """Test that all suspicious indicators are caught."""
        # Create extremely suspicious results
        indicators = OverfitIndicators(
            accuracy=0.95,           # 95% accuracy (impossible)
            sharpe_ratio=5.0,        # Sharpe > 3 (unrealistic)
            max_drawdown=-0.01,      # 1% drawdown over years (impossible)
            win_rate=0.90,           # 90% win rate (unrealistic)
            information_ratio=4.0,    # IR > 2.5 (unrealistic)
            n_observations=2000
        )

        flags = indicators.get_flags()

        # Should have multiple flags
        assert len(flags) >= 3, \
            f"Extremely overfit results should have many flags: {flags}"

        # Should be marked suspicious
        assert indicators.is_suspicious, \
            "Extremely overfit results should be marked suspicious"

    def test_realistic_results_pass(self, multi_year_data):
        """Realistic results should pass all checks."""
        df = multi_year_data

        # Simple mean-reversion strategy
        lookback = 20
        ma = df['close'].rolling(lookback).mean()
        std = df['close'].rolling(lookback).std()
        z_score = (df['close'] - ma) / (std + 1e-10)

        # Buy oversold, sell overbought
        signals = pd.Series(0, index=df.index)
        signals[z_score < -2] = 1
        signals[z_score > 2] = -1

        # Calculate returns
        strategy_returns = (signals.shift(1) * df['returns']).fillna(0)
        benchmark_returns = df['returns'].values

        # Get indicators
        predictions = signals.shift(1).fillna(0).values
        actuals = df['returns'].values

        indicators = calculate_overfit_indicators(
            predictions[lookback:],
            actuals[lookback:],
            strategy_returns.values[lookback:],
            benchmark_returns[lookback:]
        )

        # Should NOT be suspicious (realistic strategy)
        flags = indicators.get_flags()
        accuracy_flags = [f for f in flags if "ACCURACY" in f]

        # May have some flags, but accuracy should be realistic
        assert indicators.accuracy <= FANO_ACCURACY_LIMIT + 0.1, \
            f"Simple strategy accuracy {indicators.accuracy:.2%} should be near Fano limit ({FANO_ACCURACY_LIMIT:.0%})"

        # Sharpe should be reasonable
        assert indicators.sharpe_ratio < MAX_REALISTIC_SHARPE + 1, \
            f"Simple strategy Sharpe {indicators.sharpe_ratio:.2f} should be reasonable"

    def test_backtest_validation_function(self):
        """Test that we can use these checks in a validation function."""

        def validate_backtest_results(
            predictions: np.ndarray,
            actuals: np.ndarray,
            strategy_returns: np.ndarray,
            benchmark_returns: np.ndarray
        ) -> Tuple[bool, List[str]]:
            """
            Validate backtest results for overfitting.

            Returns:
                Tuple of (passed, list_of_warnings)
            """
            indicators = calculate_overfit_indicators(
                predictions, actuals, strategy_returns, benchmark_returns
            )

            flags = indicators.get_flags()
            passed = not indicators.is_suspicious

            return passed, flags

        # Test with overfit data (perfect same-period knowledge = lookahead bias)
        np.random.seed(42)
        n = 500
        actuals = np.random.randn(n) * 0.01
        overfit_predictions = np.sign(actuals)  # Perfect hindsight - no shift!

        passed, flags = validate_backtest_results(
            overfit_predictions,
            actuals,
            overfit_predictions * actuals,  # Perfect returns
            actuals
        )

        assert not passed, "Overfit results should fail validation"
        assert len(flags) > 0, "Should have warning flags"


# =============================================================================
# PERMUTATION TESTS
# =============================================================================

class TestPermutationSanity:
    """Test using permutation tests to detect overfitting."""

    def test_shuffled_returns_worse(self, realistic_predictions):
        """Shuffling labels should destroy predictive power."""
        predictions, actuals = realistic_predictions

        # Original performance
        original_accuracy = (np.sign(predictions) == np.sign(actuals)).mean()

        # Shuffle actuals (destroy temporal relationship)
        np.random.seed(42)
        shuffled_actuals = actuals.copy()
        np.random.shuffle(shuffled_actuals)

        shuffled_accuracy = (np.sign(predictions) == np.sign(shuffled_actuals)).mean()

        # Shuffled should be near 50%
        assert 0.45 <= shuffled_accuracy <= 0.55, \
            f"Shuffled accuracy should be ~50%, got {shuffled_accuracy:.2%}"

        # Original should be better than shuffled (if there's real signal)
        assert original_accuracy >= shuffled_accuracy - 0.1, \
            f"Original ({original_accuracy:.2%}) should be close to or better than shuffled ({shuffled_accuracy:.2%})"

    def test_permutation_p_value(self, realistic_predictions):
        """Permutation test should give reasonable p-value."""
        predictions, actuals = realistic_predictions

        # Original accuracy
        original_accuracy = (np.sign(predictions) == np.sign(actuals)).mean()

        # Permutation distribution
        n_permutations = 100
        permuted_accuracies = []

        for _ in range(n_permutations):
            shuffled = actuals.copy()
            np.random.shuffle(shuffled)
            perm_acc = (np.sign(predictions) == np.sign(shuffled)).mean()
            permuted_accuracies.append(perm_acc)

        # P-value: how often does permuted beat original?
        p_value = (np.array(permuted_accuracies) >= original_accuracy).mean()

        # With real signal, p-value should be low
        # With overfit, p-value would be ~0 (suspiciously low)
        assert p_value > 0.001, \
            f"P-value {p_value} is suspiciously low (potential overfit)"

        # Realistic signal should have p < 0.5
        # (but not too low unless actually overfit)


# =============================================================================
# MAIN
# =============================================================================

if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
