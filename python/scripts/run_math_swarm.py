#!/usr/bin/env python3
"""
Phase 3: Math Swarm - Symbolic Regression via PySR

Uses PySR (genetic programming) to discover interpretable equations
that predict the target variable using the Scout-selected features.

PySR evolves a population of equations, breeding and mutating them
to find the best fit with minimal complexity.

Usage:
    python scripts/run_math_swarm.py \
        --features /path/to/features.parquet \
        --scout-results /path/to/scout_swarm_results.json
"""

import os
import sys
import json
import argparse
import logging
from pathlib import Path
from datetime import datetime

import numpy as np
import pandas as pd

# Add engine to path
sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('MathSwarm')


def create_target(df: pd.DataFrame, forward_days: int = 5) -> pd.Series:
    """Create continuous target: forward return."""
    return df['close'].shift(-forward_days) / df['close'] - 1


def run_math_swarm(
    features_path: str,
    scout_results_path: str,
    output_dir: str = None,
    n_features: int = 10,
    n_iterations: int = 50,
    populations: int = 20
) -> dict:
    """
    Run PySR symbolic regression on Scout-selected features.

    Returns dict with discovered equations.
    """
    logger.info(f"\n{'='*60}")
    logger.info("MATH SWARM - Symbolic Regression via PySR")
    logger.info(f"{'='*60}")

    # Load Scout Swarm results
    logger.info(f"Loading Scout Swarm results from {scout_results_path}...")
    with open(scout_results_path, 'r') as f:
        scout_results = json.load(f)

    selected_features = scout_results['selected_features'][:n_features]
    logger.info(f"Using top {len(selected_features)} Scout-selected features")

    # Load features
    logger.info(f"Loading features from {features_path}...")
    df = pd.read_parquet(features_path)
    logger.info(f"Loaded {len(df):,} rows")

    # Create target (continuous return for regression)
    logger.info("Creating target (5-day forward return)...")
    y = create_target(df, forward_days=5)

    # Remove NaN rows
    valid_mask = ~y.isna()
    df_valid = df[valid_mask].copy()
    y_valid = y[valid_mask]

    logger.info(f"Valid samples: {len(y_valid):,}")
    logger.info(f"Target stats: mean={y_valid.mean():.4f}, std={y_valid.std():.4f}")

    # Prepare feature matrix (only Scout-selected features)
    # Clean feature names for PySR (remove numpy string wrapper if present)
    clean_features = [str(f).replace("np.str_('", "").replace("')", "") for f in selected_features]

    # Filter to features that exist in df
    available_features = [f for f in clean_features if f in df_valid.columns]
    logger.info(f"Available features: {len(available_features)} of {len(clean_features)}")

    if len(available_features) < 3:
        raise ValueError(f"Not enough features found. Available: {available_features}")

    X = df_valid[available_features].copy()
    X = X.fillna(0)

    # Rename columns to be PySR-friendly (no special chars)
    feature_map = {}
    for i, col in enumerate(X.columns):
        safe_name = f"x{i}"
        feature_map[safe_name] = col
        X = X.rename(columns={col: safe_name})

    logger.info("\nFeature mapping:")
    for safe, original in feature_map.items():
        logger.info(f"  {safe} = {original}")

    # Import and configure PySR
    logger.info(f"\nInitializing PySR...")
    logger.info(f"  Iterations: {n_iterations}")
    logger.info(f"  Populations: {populations}")

    from pysr import PySRRegressor

    model = PySRRegressor(
        niterations=n_iterations,
        populations=populations,
        binary_operators=["+", "-", "*", "/"],
        unary_operators=["log", "exp", "sqrt", "abs", "sign"],
        complexity_of_operators={
            "+": 1, "-": 1, "*": 1, "/": 2,
            "log": 2, "exp": 2, "sqrt": 2, "abs": 1, "sign": 1
        },
        parsimony=0.001,  # Penalty for complexity
        maxsize=20,  # Max equation complexity
        timeout_in_seconds=300,  # 5 min timeout
        progress=True,
        verbosity=1,
        random_state=42
    )

    # Run PySR
    logger.info("\nRunning symbolic regression (this may take a few minutes)...")
    logger.info("First run will install Julia - this is a one-time setup.\n")

    model.fit(X, y_valid)

    # Extract results
    logger.info(f"\n{'='*60}")
    logger.info("RESULTS")
    logger.info(f"{'='*60}")

    # Get equation table
    equations_df = model.equations_

    if equations_df is not None and len(equations_df) > 0:
        logger.info(f"\nDiscovered {len(equations_df)} equations:")

        # Show top equations by score
        top_eqs = equations_df.nsmallest(5, 'loss')
        for idx, row in top_eqs.iterrows():
            eq = str(row['equation'])
            loss = row['loss']
            complexity = row['complexity']
            logger.info(f"  [{complexity:2d}] Loss={loss:.6f}: {eq}")

        # Get best equation
        best = model.get_best()
        best_eq = str(best['equation']) if hasattr(best, '__getitem__') else str(best.equation)

        logger.info(f"\nBest equation: {best_eq}")

        # Translate back to original feature names
        translated_eq = best_eq
        for safe, original in feature_map.items():
            translated_eq = translated_eq.replace(safe, original)

        logger.info(f"Translated: {translated_eq}")
    else:
        logger.warning("No equations found!")
        best_eq = "N/A"
        translated_eq = "N/A"
        equations_df = pd.DataFrame()

    # Build results
    results = {
        'timestamp': datetime.now().isoformat(),
        'features_file': str(features_path),
        'scout_results_file': str(scout_results_path),
        'n_samples': len(y_valid),
        'n_features_used': len(available_features),
        'feature_mapping': feature_map,
        'best_equation_raw': best_eq,
        'best_equation_translated': translated_eq,
        'pysr_config': {
            'n_iterations': n_iterations,
            'populations': populations,
            'maxsize': 20,
            'parsimony': 0.001
        }
    }

    # Add all equations if available
    if equations_df is not None and len(equations_df) > 0:
        results['all_equations'] = [
            {
                'equation': str(row['equation']),
                'loss': float(row['loss']),
                'complexity': int(row['complexity'])
            }
            for _, row in equations_df.iterrows()
        ]

    # Save results
    if output_dir:
        output_path = Path(output_dir) / 'math_swarm_results.json'
    else:
        output_path = Path(features_path).parent / 'math_swarm_results.json'

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2)

    logger.info(f"\nResults saved to: {output_path}")

    return results


def main():
    parser = argparse.ArgumentParser(description='Math Swarm - PySR Symbolic Regression')
    parser.add_argument('--features', type=str, required=True,
                        help='Path to MTF features parquet file')
    parser.add_argument('--scout-results', type=str, required=True,
                        help='Path to scout_swarm_results.json')
    parser.add_argument('--output', type=str,
                        help='Output directory (default: same as features)')
    parser.add_argument('--n-features', type=int, default=10,
                        help='Number of top features to use')
    parser.add_argument('--iterations', type=int, default=50,
                        help='PySR iterations')
    parser.add_argument('--populations', type=int, default=20,
                        help='PySR population count')

    args = parser.parse_args()

    results = run_math_swarm(
        features_path=args.features,
        scout_results_path=args.scout_results,
        output_dir=args.output,
        n_features=args.n_features,
        n_iterations=args.iterations,
        populations=args.populations
    )

    print(f"\n{'-'*60}")
    print(f"DISCOVERED EQUATION:")
    print(f"{'-'*60}")
    print(f"{results['best_equation_translated']}")
    print(f"{'-'*60}")


if __name__ == '__main__':
    main()
