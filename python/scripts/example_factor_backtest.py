#!/usr/bin/env python3
"""
Example: Factor Backtesting with Three-Set Validation

Demonstrates how to use FactorBacktester with mock factor computer,
signal generator, and strategy mapper.

This example shows:
1. How to implement the required interfaces
2. How to run three-set validation
3. How to interpret results
"""

import logging
from pathlib import Path
import sys

import numpy as np
import pandas as pd

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from engine.factors.factor_backtester import FactorBacktester, ValidationResult

logger = logging.getLogger("FactorBacktestExample")


# ============================================================================
# MOCK IMPLEMENTATIONS (Replace with real implementations)
# ============================================================================

class MockFactorComputer:
    """
    Mock implementation of FactorComputer.

    Real implementation would compute factors from features.
    """

    def compute_factor(self, factor_name: str, features: pd.DataFrame) -> pd.Series:
        """
        Compute factor values from features.

        Args:
            factor_name: Name of factor (e.g., "gamma_exposure", "skew_strength")
            features: DataFrame with feature columns

        Returns:
            Series of factor values indexed by date
        """
        logger.info(f"Computing factor: {factor_name}")

        # Example: Simple momentum factor
        if factor_name == "momentum":
            if 'close' in features.columns:
                return features['close'].pct_change(20).fillna(0)
            else:
                # Generate random factor for demo
                return pd.Series(
                    np.random.randn(len(features)),
                    index=features.index
                )

        # Example: Mean reversion factor
        elif factor_name == "mean_reversion":
            if 'close' in features.columns:
                ma = features['close'].rolling(20).mean()
                return (features['close'] - ma) / ma
            else:
                return pd.Series(
                    -np.random.randn(len(features)),  # Inverse of momentum
                    index=features.index
                )

        # Example: Gamma exposure factor
        elif factor_name == "gamma_exposure":
            if 'dealer_gamma' in features.columns:
                return features['dealer_gamma']
            else:
                # Generate random gamma-like factor
                return pd.Series(
                    np.random.randn(len(features)),
                    index=features.index
                )

        else:
            logger.warning(f"Unknown factor: {factor_name}, returning random values")
            return pd.Series(
                np.random.randn(len(features)),
                index=features.index
            )


class MockSignalGenerator:
    """
    Mock implementation of SignalGenerator.

    Real implementation would convert factor values to trading signals.
    """

    def generate_signal(
        self,
        factor_values: pd.Series,
        entry_threshold: float,
        exit_threshold: float,
        direction: str
    ) -> pd.Series:
        """
        Generate trading signals from factor values.

        Args:
            factor_values: Factor values over time
            entry_threshold: Threshold for entry signal
            exit_threshold: Threshold for exit signal
            direction: "long" or "short"

        Returns:
            Series of signals: 1 (long), -1 (short), 0 (no position)
        """
        signals = pd.Series(0, index=factor_values.index)

        if direction == "long":
            # Long when factor > entry_threshold
            signals[factor_values > entry_threshold] = 1
            # Exit when factor < exit_threshold
            signals[factor_values < exit_threshold] = 0

        elif direction == "short":
            # Short when factor < entry_threshold
            signals[factor_values < entry_threshold] = -1
            # Exit when factor > exit_threshold
            signals[factor_values > exit_threshold] = 0

        return signals


class MockStrategyMapper:
    """
    Mock implementation of StrategyMapper.

    Real implementation would map signals to option structures.
    """

    def map_to_structure(self, signal: int):
        """
        Map signal to option structure.

        Args:
            signal: 1 (long), -1 (short), 0 (no position)

        Returns:
            StructureDNA or None
        """
        # This is a placeholder - real implementation would return StructureDNA
        if signal == 1:
            return "LONG_CALL"  # Placeholder
        elif signal == -1:
            return "LONG_PUT"  # Placeholder
        else:
            return None


# ============================================================================
# EXAMPLE USAGE
# ============================================================================

def generate_mock_features(n_days: int = 1520) -> pd.DataFrame:
    """
    Generate mock features for testing.

    Creates ~4 years of daily data (2020-2024) plus 1 year (2025).
    """
    dates = pd.date_range('2020-01-01', periods=n_days, freq='D')

    # Generate price series with realistic characteristics
    np.random.seed(42)
    returns = np.random.randn(n_days) * 0.01  # 1% daily volatility
    price = 100 * np.exp(returns.cumsum())

    features = pd.DataFrame({
        'date': dates,
        'close': price,
        'volume': np.random.randint(1000000, 10000000, n_days),
        'dealer_gamma': np.random.randn(n_days),
        'customer_gamma': np.random.randn(n_days),
        'skew': np.random.randn(n_days) * 0.1,
    })

    return features


def run_example():
    """Run example three-set validation."""

    # Generate mock features
    logger.info("Generating mock features...")
    features = generate_mock_features()

    # Save to parquet
    features_path = "/tmp/mock_features.parquet"
    features.to_parquet(features_path)
    logger.info(f"Saved mock features to {features_path}")

    # Initialize components
    factor_computer = MockFactorComputer()
    signal_generator = MockSignalGenerator()
    strategy_mapper = MockStrategyMapper()

    # Initialize backtester
    backtester = FactorBacktester(
        factor_computer=factor_computer,
        signal_generator=signal_generator,
        strategy_mapper=strategy_mapper,
        features_path=features_path,
        initial_capital=100_000.0,
        embargo_days=5
    )

    # Test different factors
    factors_to_test = ["momentum", "mean_reversion", "gamma_exposure"]

    results = {}
    for factor_name in factors_to_test:
        logger.info(f"\n{'='*80}")
        logger.info(f"Testing factor: {factor_name}")
        logger.info(f"{'='*80}\n")

        # Run three-set validation
        result = backtester.three_set_validate(
            factor_name=factor_name,
            auto_optimize_threshold=True
        )

        results[factor_name] = result

        # Print summary
        print(result.summary())

    # Print final comparison
    print("\n" + "="*80)
    print("FINAL COMPARISON")
    print("="*80)
    print(f"{'Factor':<20} {'Discovery Sharpe':<18} {'Validation Sharpe':<18} {'WF Sharpe':<15} {'Survival':<10}")
    print("-"*80)

    for factor_name, result in results.items():
        survival_str = "PASS" if result.survival else "FAIL"
        print(f"{factor_name:<20} {result.discovery_result.sharpe:>17.3f} {result.validation_result.sharpe:>17.3f} "
              f"{result.walkforward_result.sharpe:>14.3f} {survival_str:<10}")

    print("="*80 + "\n")

    # Save results to JSON
    results_path = "/tmp/factor_backtest_results.json"
    import json
    with open(results_path, 'w') as f:
        json.dump(
            {k: v.to_dict() for k, v in results.items()},
            f,
            indent=2,
            default=str
        )
    logger.info(f"Results saved to {results_path}")


if __name__ == '__main__':
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    run_example()
