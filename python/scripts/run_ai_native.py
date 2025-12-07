#!/usr/bin/env python3
"""
Run AI-Native Options Analysis
==============================
Runner script for the AI-native trading system.

Usage:
    # Basic analysis
    python scripts/run_ai_native.py --symbol SPY

    # With Math Swarm equations
    python scripts/run_ai_native.py --symbol SPY --equations /path/to/math_swarm_results.json

    # With Jury Swarm regime context
    python scripts/run_ai_native.py --symbol SPY --regime /path/to/jury_swarm_results.json

    # Full pipeline with features
    python scripts/run_ai_native.py --symbol SPY --features /path/to/SPY_options_features.parquet
"""

import os
import sys
import json
import argparse
import logging
from datetime import datetime
from pathlib import Path

import pandas as pd

# Add engine to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from engine.ai_native.pipeline import AINativePipeline, run_ai_native_analysis

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('AINative')

# Default paths
DATA_DIR = Path('/Volumes/VelocityData/velocity_om')
FEATURES_DIR = DATA_DIR / 'features'
OUTPUT_DIR = DATA_DIR / 'ai_native_results'


def load_market_data(features_path: str, symbol: str) -> pd.DataFrame:
    """Load market features from parquet."""
    if features_path and Path(features_path).exists():
        logger.info(f"Loading features from {features_path}")
        return pd.read_parquet(features_path)

    # Try default location
    default_path = FEATURES_DIR / f'{symbol}_master_features.parquet'
    if default_path.exists():
        logger.info(f"Loading features from {default_path}")
        return pd.read_parquet(default_path)

    # Try options features
    options_path = DATA_DIR / 'massive' / 'features' / f'{symbol}_options_features.parquet'
    if options_path.exists():
        logger.info(f"Loading options features from {options_path}")
        return pd.read_parquet(options_path)

    raise FileNotFoundError(f"No feature files found for {symbol}")


def load_equations(equations_path: str) -> dict:
    """Load Math Swarm equations from JSON."""
    if not equations_path or not Path(equations_path).exists():
        return None

    logger.info(f"Loading equations from {equations_path}")
    with open(equations_path, 'r') as f:
        data = json.load(f)

    # Extract equations dict
    if 'equations' in data:
        return data['equations']
    elif 'best_equation_translated' in data:
        return {'default': data['best_equation_translated']}

    return data


def load_regime_context(regime_path: str) -> dict:
    """Load Jury Swarm regime context from JSON."""
    if not regime_path or not Path(regime_path).exists():
        return None

    logger.info(f"Loading regime context from {regime_path}")
    with open(regime_path, 'r') as f:
        return json.load(f)


def main():
    parser = argparse.ArgumentParser(
        description='Run AI-Native Options Analysis',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Basic analysis with default features
    python scripts/run_ai_native.py --symbol SPY

    # With specific feature file
    python scripts/run_ai_native.py --symbol SPY \\
        --features /path/to/features.parquet

    # Full pipeline with Math Swarm and Jury Swarm context
    python scripts/run_ai_native.py --symbol SPY \\
        --features /path/to/features.parquet \\
        --equations /path/to/math_swarm_results.json \\
        --regime /path/to/jury_swarm_results.json
        """
    )

    # Required arguments
    parser.add_argument('--symbol', type=str, default='SPY',
                        help='Symbol to analyze (default: SPY)')

    # Data inputs
    parser.add_argument('--features', type=str,
                        help='Path to features parquet file')
    parser.add_argument('--equations', type=str,
                        help='Path to Math Swarm results JSON')
    parser.add_argument('--regime', type=str,
                        help='Path to Jury Swarm results JSON')

    # Portfolio settings
    parser.add_argument('--portfolio', type=float, default=100000,
                        help='Portfolio value in dollars (default: 100000)')
    parser.add_argument('--min-confidence', type=float, default=0.50,
                        help='Minimum confidence to trade (default: 0.50)')

    # Output settings
    parser.add_argument('--output', type=str,
                        help='Output directory (default: DATA_DIR/ai_native_results)')
    parser.add_argument('--save-result', action='store_true',
                        help='Save result to JSON file')

    # Model settings
    parser.add_argument('--observer-model', type=str, default='deepseek-chat',
                        help='Model for observer swarm')
    parser.add_argument('--synthesis-model', type=str, default='deepseek-reasoner',
                        help='Model for synthesis agent')

    args = parser.parse_args()

    logger.info("="*60)
    logger.info("AI-NATIVE OPTIONS ANALYSIS")
    logger.info("="*60)
    logger.info(f"Symbol: {args.symbol}")
    logger.info(f"Portfolio: ${args.portfolio:,.0f}")
    logger.info(f"Min confidence: {args.min_confidence:.0%}")
    logger.info("="*60)

    # Load data
    try:
        market_data = load_market_data(args.features, args.symbol)
        logger.info(f"Loaded {len(market_data):,} rows of market data")
    except FileNotFoundError as e:
        logger.error(str(e))
        sys.exit(1)

    equations = load_equations(args.equations)
    regime_context = load_regime_context(args.regime)

    if equations:
        logger.info(f"Loaded {len(equations)} equations from Math Swarm")
    if regime_context:
        logger.info(f"Loaded regime context from Jury Swarm")

    # Initialize pipeline
    pipeline = AINativePipeline(
        observer_model=args.observer_model,
        synthesis_model=args.synthesis_model
    )

    # Get current market state
    latest = market_data.iloc[-1]
    current_price = latest['close'] if 'close' in latest else None
    current_iv = latest.get('iv_30d') or latest.get('atm_iv_30d')

    logger.info(f"\nCurrent market state:")
    logger.info(f"  Price: ${current_price:.2f}" if current_price else "  Price: Unknown")
    logger.info(f"  IV: {current_iv:.1f}%" if current_iv else "  IV: Unknown")

    # Run pipeline
    logger.info("\n" + "="*60)
    logger.info("RUNNING AI-NATIVE PIPELINE")
    logger.info("="*60 + "\n")

    try:
        result = pipeline.run(
            market_data=market_data,
            equations=equations,
            regime_context=regime_context,
            symbol=args.symbol,
            current_price=current_price,
            current_iv=current_iv,
            portfolio_value=args.portfolio,
            min_confidence_to_trade=args.min_confidence
        )
    except Exception as e:
        logger.error(f"Pipeline failed: {e}")
        raise

    # Print results
    print("\n" + "="*60)
    print("ANALYSIS COMPLETE")
    print("="*60)

    print(f"\n## Thesis")
    print(f"Direction: {result.thesis['direction']}")
    print(f"Confidence: {result.thesis['confidence']:.0%}")
    print(f"Time Horizon: {result.thesis['time_horizon']}")
    print(f"\n{result.thesis['thesis']}")

    print(f"\n## Adversarial Analysis")
    print(f"Challenge severity: {result.challenge['severity']}")
    print(f"Survival probability: {result.challenge['survival_probability']:.0%}")
    print(f"Adjusted confidence: {result.evaluation['adjusted_confidence']:.0%}")

    print(f"\n## Decision: {'TRADE' if result.should_trade else 'NO TRADE'}")

    if result.trade:
        print(f"\n## Trade Expression")
        print(f"Structure: {result.trade['structure_type']}")
        print(f"Position size: {result.trade['position_size_pct']:.1f}% of portfolio")
        print(f"Max loss: ${result.trade['max_loss']:,.0f}")
        print(f"Max gain: ${result.trade['max_gain']:,.0f}")

        print(f"\n## Trade Legs:")
        for leg in result.trade['legs']:
            side = "BUY" if leg['side'] == 'buy' else "SELL"
            print(f"  {side} {leg['quantity']} {args.symbol} {leg['strike']} {leg['type'].upper()}")
    else:
        print(f"\nConfidence {result.evaluation['adjusted_confidence']:.0%} below threshold {args.min_confidence:.0%}")
        print("Recommendation: Wait for higher-conviction setup")

    # Save result
    if args.save_result:
        output_dir = Path(args.output) if args.output else OUTPUT_DIR
        output_dir.mkdir(parents=True, exist_ok=True)

        filename = f"ai_native_{args.symbol}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        output_path = output_dir / filename

        result.save(str(output_path))
        print(f"\nResult saved to: {output_path}")

    print("\n" + "="*60)

    return result


if __name__ == '__main__':
    main()
