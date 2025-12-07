#!/usr/bin/env python3
"""
Demo script showing how to use FactorComputer.

This demonstrates the complete workflow:
1. Load Math Swarm equations
2. Load feature data
3. Compute factors with no-lookahead normalization
4. Inspect factor values
5. Save results
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd
from engine.factors import FactorComputer, compute_factors

# Set display options
pd.set_option('display.max_columns', 10)
pd.set_option('display.width', 120)


def main():
    print("=" * 80)
    print("FactorComputer Demo")
    print("=" * 80)

    # Paths
    equations_path = "/Volumes/VelocityData/velocity_om/features/math_swarm_results.json"
    features_path = "/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet"

    # METHOD 1: Using the class directly
    print("\n1. Creating FactorComputer...")
    computer = FactorComputer(
        equations_path=equations_path,
        features_path=features_path,
        normalize=True,  # Z-score normalize using expanding window
        min_periods=20   # Minimum periods for normalization
    )

    # Inspect feature mapping
    print("\n2. Feature mapping:")
    mapping = computer.get_feature_mapping()
    for var, feature in sorted(mapping.items()):
        print(f"   {var:4s} -> {feature}")

    # Compute best equation (single factor)
    print("\n3. Computing best equation factor...")
    best_factor = computer.compute_factor()
    print(f"\n   Factor: {best_factor.name}")
    print(f"   Non-NaN values: {best_factor.notna().sum()} / {len(best_factor)}")
    print(f"   Mean: {best_factor.mean():.6f}")
    print(f"   Std:  {best_factor.std():.6f}")
    print(f"   Range: [{best_factor.min():.6f}, {best_factor.max():.6f}]")

    # Show equation details
    print("\n4. Best equation metadata:")
    meta = computer.get_equation_metadata()
    print(f"   Formula: {meta['equation']}")
    print(f"   Features used ({meta['n_features']}): {', '.join(meta['features_used'])}")

    # Compute all factors from Pareto frontier
    print("\n5. Computing all factors from Pareto frontier...")
    all_factors = computer.compute_all_factors(max_equations=5)
    print(f"\n   Computed {all_factors.shape[1]} factors")
    print(f"   Shape: {all_factors.shape}")

    # Show factor statistics
    print("\n6. Factor statistics:")
    print(all_factors.describe())

    # Show correlations between factors
    print("\n7. Factor correlations:")
    corr = all_factors.corr()
    print(corr)

    # METHOD 2: Using convenience function
    print("\n8. Using convenience function...")
    factors_quick = compute_factors(
        equations_path,
        features_path,
        normalize=True,
        max_equations=3
    )
    print(f"   Computed {factors_quick.shape[1]} factors")

    # Validate no-lookahead
    print("\n9. Validating no-lookahead bias...")
    is_valid = computer.validate_no_lookahead(best_factor)
    if is_valid:
        print("   ✓ No lookahead bias detected")
    else:
        print("   ✗ WARNING: Potential lookahead bias!")

    # Show sample values
    print("\n10. Sample factor values (last 20):")
    print(all_factors.tail(20))

    # Save results
    output_path = "/Volumes/VelocityData/velocity_om/features/computed_factors.parquet"
    print(f"\n11. Saving factors to {output_path}...")
    all_factors.to_parquet(output_path)
    print("   ✓ Saved")

    # Usage example: Get raw (unnormalized) factor values
    print("\n12. Computing raw (unnormalized) factor...")
    computer_raw = FactorComputer(
        equations_path,
        features_path,
        normalize=False  # Don't normalize
    )
    raw_factor = computer_raw.compute_factor()
    print(f"   Raw factor mean: {raw_factor.mean():.8f}")
    print(f"   Raw factor std:  {raw_factor.std():.8f}")

    print("\n" + "=" * 80)
    print("Demo complete!")
    print("=" * 80)


if __name__ == "__main__":
    main()
