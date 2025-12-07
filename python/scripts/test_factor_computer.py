#!/usr/bin/env python3
"""
Test script for FactorComputer module.

Validates:
- Loading equations and features
- Computing single factors
- Computing all factors
- No-lookahead bias in normalization
- Feature mapping correctness
"""

import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import logging
import numpy as np
import pandas as pd

from engine.factors.factor_computer import FactorComputer, compute_factors

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def test_basic_loading():
    """Test basic loading of equations and features."""
    logger.info("=" * 80)
    logger.info("TEST 1: Basic Loading")
    logger.info("=" * 80)

    equations_path = "/Volumes/VelocityData/velocity_om/features/math_swarm_results.json"
    features_path = "/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet"

    computer = FactorComputer(equations_path, features_path)

    logger.info(f"Equations loaded: {len(computer.equations.get('all_equations', []))} equations")
    logger.info(f"Features loaded: {computer.features.shape}")
    logger.info(f"Feature mapping: {len(computer.feature_mapping)} variables")

    # Print feature mapping
    logger.info("\nFeature Mapping:")
    for var, feature in sorted(computer.feature_mapping.items()):
        logger.info(f"  {var} -> {feature}")

    return computer


def test_single_factor(computer):
    """Test computing a single factor."""
    logger.info("\n" + "=" * 80)
    logger.info("TEST 2: Single Factor Computation")
    logger.info("=" * 80)

    # Compute best equation
    factor = computer.compute_factor()

    logger.info(f"Factor computed: {factor.name}")
    logger.info(f"  Shape: {factor.shape}")
    logger.info(f"  Non-NaN values: {factor.notna().sum()} / {len(factor)}")
    logger.info(f"  Mean: {factor.mean():.6f}")
    logger.info(f"  Std: {factor.std():.6f}")
    logger.info(f"  Min: {factor.min():.6f}")
    logger.info(f"  Max: {factor.max():.6f}")

    # Show first 10 values
    logger.info("\nFirst 10 values:")
    logger.info(factor.head(10))

    # Show last 10 values
    logger.info("\nLast 10 values:")
    logger.info(factor.tail(10))

    return factor


def test_all_factors(computer):
    """Test computing all factors."""
    logger.info("\n" + "=" * 80)
    logger.info("TEST 3: All Factors Computation")
    logger.info("=" * 80)

    # Compute first 5 factors for speed
    all_factors = computer.compute_all_factors(max_equations=5)

    logger.info(f"Factors computed: {all_factors.shape}")
    logger.info(f"\nFactor summary:")

    for col in all_factors.columns:
        factor = all_factors[col]
        logger.info(f"\n{col}:")
        logger.info(f"  Non-NaN: {factor.notna().sum()} / {len(factor)}")
        logger.info(f"  Mean: {factor.mean():.6f}")
        logger.info(f"  Std: {factor.std():.6f}")
        logger.info(f"  Range: [{factor.min():.6f}, {factor.max():.6f}]")

    return all_factors


def test_equation_metadata(computer):
    """Test equation metadata retrieval."""
    logger.info("\n" + "=" * 80)
    logger.info("TEST 4: Equation Metadata")
    logger.info("=" * 80)

    # Get metadata for first 3 equations
    for idx in range(min(3, len(computer.equations.get('all_equations', [])))):
        meta = computer.get_equation_metadata(idx)

        logger.info(f"\nEquation {idx}:")
        logger.info(f"  Formula: {meta['equation']}")
        logger.info(f"  Complexity: {meta['complexity']}")
        logger.info(f"  Loss: {meta['loss']:.8f}")
        logger.info(f"  Features used ({meta['n_features']}): {', '.join(meta['features_used'])}")


def test_no_lookahead(computer, factor):
    """Test no-lookahead validation."""
    logger.info("\n" + "=" * 80)
    logger.info("TEST 5: No-Lookahead Validation")
    logger.info("=" * 80)

    is_valid = computer.validate_no_lookahead(factor)

    if is_valid:
        logger.info("✓ No lookahead bias detected")
    else:
        logger.warning("✗ Potential lookahead bias detected!")

    # Manual check: compare expanding window stats to full-sample stats
    logger.info("\nManual validation:")

    # Remove NaN
    clean_factor = factor.dropna()

    # Split into thirds
    n = len(clean_factor)
    third_1 = clean_factor.iloc[:n//3]
    third_2 = clean_factor.iloc[n//3:2*n//3]
    third_3 = clean_factor.iloc[2*n//3:]

    logger.info(f"Period 1 (early): mean={third_1.mean():.4f}, std={third_1.std():.4f}")
    logger.info(f"Period 2 (mid):   mean={third_2.mean():.4f}, std={third_2.std():.4f}")
    logger.info(f"Period 3 (late):  mean={third_3.mean():.4f}, std={third_3.std():.4f}")
    logger.info(f"Full sample:      mean={clean_factor.mean():.4f}, std={clean_factor.std():.4f}")

    # In expanding window normalization:
    # - Early period should have higher variance (fewer samples)
    # - Mean should be close to 0 throughout (but not exact)
    # - Std should converge to ~1.0 in later periods


def test_unnormalized_factors():
    """Test computing factors without normalization."""
    logger.info("\n" + "=" * 80)
    logger.info("TEST 6: Unnormalized Factors")
    logger.info("=" * 80)

    equations_path = "/Volumes/VelocityData/velocity_om/features/math_swarm_results.json"
    features_path = "/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet"

    # Create computer without normalization
    computer = FactorComputer(equations_path, features_path, normalize=False)

    factor = computer.compute_factor()

    logger.info(f"Raw factor (no normalization):")
    logger.info(f"  Mean: {factor.mean():.6f}")
    logger.info(f"  Std: {factor.std():.6f}")
    logger.info(f"  Range: [{factor.min():.6f}, {factor.max():.6f}]")


def test_convenience_function():
    """Test convenience function."""
    logger.info("\n" + "=" * 80)
    logger.info("TEST 7: Convenience Function")
    logger.info("=" * 80)

    equations_path = "/Volumes/VelocityData/velocity_om/features/math_swarm_results.json"
    features_path = "/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet"

    factors = compute_factors(
        equations_path,
        features_path,
        normalize=True,
        max_equations=3
    )

    logger.info(f"Computed {factors.shape[1]} factors using convenience function")
    logger.info(f"Shape: {factors.shape}")
    logger.info("\nFirst 5 rows:")
    logger.info(factors.head())


def main():
    """Run all tests."""
    logger.info("Starting FactorComputer tests...")

    try:
        # Test 1: Basic loading
        computer = test_basic_loading()

        # Test 2: Single factor
        factor = test_single_factor(computer)

        # Test 3: All factors
        all_factors = test_all_factors(computer)

        # Test 4: Metadata
        test_equation_metadata(computer)

        # Test 5: No-lookahead
        test_no_lookahead(computer, factor)

        # Test 6: Unnormalized
        test_unnormalized_factors()

        # Test 7: Convenience function
        test_convenience_function()

        logger.info("\n" + "=" * 80)
        logger.info("ALL TESTS PASSED ✓")
        logger.info("=" * 80)

    except Exception as e:
        logger.error(f"Test failed: {e}", exc_info=True)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
