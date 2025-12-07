#!/usr/bin/env python3
"""
Phase 4: Jury Swarm - Ensemble Regime Classification

Uses multiple clustering algorithms (KMeans, GMM) that vote on market regime.
This conditions the discovered equations - some equations work better in
certain regimes than others.

Usage:
    python scripts/run_jury_swarm.py \
        --features /path/to/SPY/mtf_features.parquet \
        --scout-results /path/to/SPY/scout_swarm_results.json
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

from engine.discovery.swarm_engine import JurySwarm

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('JurySwarm')


def create_target(df: pd.DataFrame, forward_days: int = 5) -> pd.Series:
    """Create continuous target: forward return."""
    return df['close'].shift(-forward_days) / df['close'] - 1


def run_jury_swarm(
    features_path: str,
    scout_results_path: str,
    n_regimes: int = 4,
    output_dir: str = None
) -> dict:
    """
    Run Jury Swarm ensemble regime classification.

    Returns dict with regime assignments and analysis.
    """
    logger.info(f"\n{'='*60}")
    logger.info("JURY SWARM - Ensemble Regime Classification")
    logger.info(f"{'='*60}")

    # Load Scout results for feature selection
    logger.info(f"Loading Scout Swarm results...")
    with open(scout_results_path, 'r') as f:
        scout_results = json.load(f)

    # Use top features for regime detection
    selected_features = scout_results['selected_features'][:15]
    clean_features = [str(f).replace("np.str_('", "").replace("')", "") for f in selected_features]

    # Load features
    logger.info(f"Loading features from {features_path}...")
    df = pd.read_parquet(features_path)
    logger.info(f"Loaded {len(df):,} rows")

    # Filter to available features
    available_features = [f for f in clean_features if f in df.columns]
    logger.info(f"Using {len(available_features)} features for regime detection")

    # Prepare regime detection features
    X_regime = df[available_features].copy()
    X_regime = X_regime.fillna(0)

    # Create target for analysis
    y = create_target(df, forward_days=5)
    valid_mask = ~y.isna()
    X_regime_valid = X_regime[valid_mask]
    y_valid = y[valid_mask]
    df_valid = df[valid_mask].copy()

    logger.info(f"Valid samples: {len(y_valid):,}")

    # Initialize and fit Jury Swarm
    logger.info(f"\nInitializing Jury Swarm with {n_regimes} regimes...")
    jury = JurySwarm(n_regimes=n_regimes)
    jury.fit(X_regime_valid)

    # Get regime predictions
    logger.info("Getting regime predictions...")
    consensus, votes, confidence = jury.predict(X_regime_valid)

    # Add regimes to dataframe for analysis
    df_valid['regime'] = consensus.values
    df_valid['regime_confidence'] = confidence.values
    df_valid['forward_return'] = y_valid.values

    # Analyze performance by regime
    logger.info(f"\n{'='*60}")
    logger.info("REGIME ANALYSIS")
    logger.info(f"{'='*60}")

    regime_stats = []
    for regime in sorted(df_valid['regime'].unique()):
        mask = df_valid['regime'] == regime
        regime_data = df_valid[mask]

        count = len(regime_data)
        pct = count / len(df_valid) * 100
        mean_ret = regime_data['forward_return'].mean() * 100
        std_ret = regime_data['forward_return'].std() * 100
        sharpe = mean_ret / std_ret if std_ret > 0 else 0
        win_rate = (regime_data['forward_return'] > 0).mean() * 100
        avg_conf = regime_data['regime_confidence'].mean() * 100

        regime_stats.append({
            'regime': int(regime),
            'count': count,
            'pct_of_days': round(pct, 1),
            'mean_return_pct': round(mean_ret, 3),
            'std_return_pct': round(std_ret, 3),
            'sharpe_5d': round(sharpe, 2),
            'win_rate_pct': round(win_rate, 1),
            'avg_confidence_pct': round(avg_conf, 1)
        })

        logger.info(f"\nRegime {regime}:")
        logger.info(f"  Days: {count} ({pct:.1f}%)")
        logger.info(f"  Mean 5d Return: {mean_ret:.3f}%")
        logger.info(f"  Std 5d Return: {std_ret:.3f}%")
        logger.info(f"  5d Sharpe: {sharpe:.2f}")
        logger.info(f"  Win Rate: {win_rate:.1f}%")
        logger.info(f"  Avg Confidence: {avg_conf:.1f}%")

    # Identify best and worst regimes
    best_regime = max(regime_stats, key=lambda x: x['sharpe_5d'])
    worst_regime = min(regime_stats, key=lambda x: x['sharpe_5d'])

    logger.info(f"\n{'='*60}")
    logger.info("REGIME SUMMARY")
    logger.info(f"{'='*60}")
    logger.info(f"Best regime: {best_regime['regime']} (Sharpe: {best_regime['sharpe_5d']})")
    logger.info(f"Worst regime: {worst_regime['regime']} (Sharpe: {worst_regime['sharpe_5d']})")

    # Voting agreement analysis
    vote_cols = votes.columns.tolist()
    agreement_pct = (votes.nunique(axis=1) == 1).mean() * 100
    logger.info(f"\nVoting agreement (all models agree): {agreement_pct:.1f}%")

    # Build results
    results = {
        'timestamp': datetime.now().isoformat(),
        'features_file': str(features_path),
        'n_regimes': n_regimes,
        'n_samples': len(df_valid),
        'features_used': available_features,
        'regime_stats': regime_stats,
        'best_regime': best_regime,
        'worst_regime': worst_regime,
        'voting_agreement_pct': round(agreement_pct, 1),
        'jury_models': list(jury.models.keys())
    }

    # Save regime assignments
    regime_df = df_valid[['regime', 'regime_confidence', 'forward_return']].copy()
    regime_df['timestamp'] = df_valid['timestamp'] if 'timestamp' in df_valid.columns else df_valid.index

    # Determine output path
    if output_dir:
        out_path = Path(output_dir)
    else:
        out_path = Path(features_path).parent

    # Save results
    results_path = out_path / 'jury_swarm_results.json'
    with open(results_path, 'w') as f:
        json.dump(results, f, indent=2)
    logger.info(f"\nResults saved to: {results_path}")

    # Save regime assignments
    regime_path = out_path / 'regime_assignments.parquet'
    regime_df.to_parquet(regime_path, index=False)
    logger.info(f"Regime assignments saved to: {regime_path}")

    return results


def main():
    parser = argparse.ArgumentParser(description='Jury Swarm - Ensemble Regime Classification')
    parser.add_argument('--features', type=str, required=True,
                        help='Path to MTF features parquet file')
    parser.add_argument('--scout-results', type=str, required=True,
                        help='Path to scout_swarm_results.json')
    parser.add_argument('--n-regimes', type=int, default=4,
                        help='Number of regimes to detect')
    parser.add_argument('--output', type=str,
                        help='Output directory (default: same as features)')

    args = parser.parse_args()

    results = run_jury_swarm(
        features_path=args.features,
        scout_results_path=args.scout_results,
        n_regimes=args.n_regimes,
        output_dir=args.output
    )

    print(f"\n{'='*60}")
    print("REGIME TRADING INSIGHT")
    print(f"{'='*60}")
    print(f"Best regime to trade: Regime {results['best_regime']['regime']}")
    print(f"  - {results['best_regime']['pct_of_days']}% of days")
    print(f"  - {results['best_regime']['sharpe_5d']} Sharpe ratio")
    print(f"  - {results['best_regime']['win_rate_pct']}% win rate")
    print(f"\nWorst regime (consider sitting out): Regime {results['worst_regime']['regime']}")
    print(f"  - {results['worst_regime']['sharpe_5d']} Sharpe ratio")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
