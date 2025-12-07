#!/usr/bin/env python3
"""
Phase 2: Scout Swarm - Feature Selection via Mutual Information

Runs genetic algorithm to find the most predictive features from the
multi-timeframe feature set. Uses Mutual Information as the fitness function.

Usage:
    python scripts/run_scout_swarm.py --input /path/to/features.parquet
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

from engine.discovery.swarm_engine import ScoutSwarm

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('ScoutSwarm')


def create_target(df: pd.DataFrame, forward_days: int = 5) -> pd.Series:
    """Create binary target: 1 if price goes up over next N days, 0 otherwise."""
    forward_return = df['close'].shift(-forward_days) / df['close'] - 1
    return (forward_return > 0).astype(int)


def run_scout_swarm(
    input_path: str,
    output_dir: str = None,
    top_n: int = 50,
    generations: int = 20,
    population_size: int = 100
) -> dict:
    """
    Run Scout Swarm on multi-timeframe features.

    Returns dict with selected features and their scores.
    """
    logger.info(f"\n{'='*60}")
    logger.info("SCOUT SWARM - Feature Selection via Mutual Information")
    logger.info(f"{'='*60}")

    # Load features
    logger.info(f"Loading features from {input_path}...")
    df = pd.read_parquet(input_path)
    logger.info(f"Loaded {len(df):,} rows, {len(df.columns)} columns")

    # Identify feature columns (exclude base OHLCV + timestamp)
    exclude_cols = {'timestamp', 'symbol', 'open', 'high', 'low', 'close', 'volume'}
    feature_cols = [c for c in df.columns if c not in exclude_cols]
    logger.info(f"Found {len(feature_cols)} feature columns")

    # Create target
    logger.info("Creating target (5-day forward return direction)...")
    y = create_target(df, forward_days=5)

    # Remove rows with NaN target (last 5 rows)
    valid_mask = ~y.isna()
    df_valid = df[valid_mask].copy()
    y_valid = y[valid_mask].astype(int)

    logger.info(f"Valid samples: {len(y_valid):,}")
    logger.info(f"Target distribution: {dict(y_valid.value_counts())}")

    # Prepare feature matrix
    X = df_valid[feature_cols].copy()

    # Fill NaN with 0 for features (some warm-up periods)
    nan_before = X.isna().sum().sum()
    X = X.fillna(0)
    logger.info(f"Filled {nan_before:,} NaN values in features")

    # Initialize Scout Swarm
    logger.info(f"\nInitializing Scout Swarm...")
    logger.info(f"  Population: {population_size}")
    logger.info(f"  Generations: {generations}")
    logger.info(f"  Features per agent: {top_n}")

    scout = ScoutSwarm(
        population_size=population_size,
        n_generations=generations,
        features_per_agent=top_n,
        mutation_rate=0.1
    )

    # Run evolution
    logger.info("\nRunning genetic evolution...")
    selected_features = scout.evolve(X, y_valid, verbose=True)

    # Analyze results by timeframe
    logger.info(f"\n{'='*60}")
    logger.info("RESULTS")
    logger.info(f"{'='*60}")

    logger.info(f"\nSelected {len(selected_features)} features:")

    # Group by timeframe
    tf_counts = {}
    for feat in selected_features:
        for tf in ['_5min', '_15min', '_1H', '_1D']:
            if feat.endswith(tf):
                tf_counts[tf] = tf_counts.get(tf, 0) + 1
                break
        else:
            # Cross-timeframe or other
            if 'align' in feat:
                tf_counts['cross_tf'] = tf_counts.get('cross_tf', 0) + 1
            else:
                tf_counts['other'] = tf_counts.get('other', 0) + 1

    logger.info("\nFeatures by timeframe:")
    for tf, count in sorted(tf_counts.items(), key=lambda x: -x[1]):
        pct = count / len(selected_features) * 100
        logger.info(f"  {tf}: {count} ({pct:.1f}%)")

    # List top features
    logger.info("\nTop selected features:")
    for i, feat in enumerate(selected_features[:20], 1):
        logger.info(f"  {i:2d}. {feat}")

    if len(selected_features) > 20:
        logger.info(f"  ... and {len(selected_features) - 20} more")

    # Build results dict
    results = {
        'timestamp': datetime.now().isoformat(),
        'input_file': str(input_path),
        'n_samples': len(y_valid),
        'n_total_features': len(feature_cols),
        'n_selected_features': len(selected_features),
        'selected_features': selected_features,
        'timeframe_distribution': tf_counts,
        'scout_config': {
            'population_size': population_size,
            'n_generations': generations,
            'features_per_agent': top_n,
            'mutation_rate': 0.1
        }
    }

    # Save results
    if output_dir:
        output_path = Path(output_dir) / 'scout_swarm_results.json'
    else:
        output_path = Path(input_path).parent / 'scout_swarm_results.json'

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2)

    logger.info(f"\nResults saved to: {output_path}")

    return results


def main():
    parser = argparse.ArgumentParser(description='Scout Swarm Feature Selection')
    parser.add_argument('--input', type=str, required=True,
                        help='Path to MTF features parquet file')
    parser.add_argument('--output', type=str,
                        help='Output directory (default: same as input)')
    parser.add_argument('--top-n', type=int, default=50,
                        help='Number of features to select')
    parser.add_argument('--generations', type=int, default=20,
                        help='Number of GA generations')
    parser.add_argument('--population', type=int, default=100,
                        help='GA population size')

    args = parser.parse_args()

    results = run_scout_swarm(
        input_path=args.input,
        output_dir=args.output,
        top_n=args.top_n,
        generations=args.generations,
        population_size=args.population
    )

    print(f"\n✓ Scout Swarm complete. Selected {len(results['selected_features'])} features.")


if __name__ == '__main__':
    main()
