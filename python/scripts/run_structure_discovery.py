#!/usr/bin/env python3
"""
Structure Discovery Pipeline

End-to-end pipeline for discovering optimal options structures:

1. Build payoff surface (if not exists) - Pre-compute daily payoffs
2. Load regime assignments
3. Run genetic algorithm to discover structures
4. Validate on held-out data
5. Output discovered structures as JSON

Usage:
    # Full pipeline (builds surface first if needed)
    python run_structure_discovery.py --full

    # Just discovery (surface already exists)
    python run_structure_discovery.py --discover

    # Just build surface
    python run_structure_discovery.py --build-surface

    # Walk-forward validation
    python run_structure_discovery.py --discover --walk-forward
"""

import argparse
import json
import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import List

import pandas as pd

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.discovery.payoff_surface_builder import (
    PayoffSurfaceBuilder,
    PayoffSurfaceLookup,
)
from engine.discovery.structure_dna import (
    StructureDNA,
    format_dna,
    get_seed_structures,
)
from engine.discovery.precision_backtester import PrecisionBacktester, compute_fitness
from engine.discovery.structure_miner import (
    StructureMiner,
    EvolutionConfig,
    run_walk_forward,
)

logger = logging.getLogger("StructureDiscovery")


# ============================================================================
# DEFAULT PATHS
# ============================================================================

DEFAULT_PATHS = {
    'options_dir': Path('/Volumes/VelocityData/velocity_om/massive/options'),
    'stock_data': Path('/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet'),
    'regimes': Path('/Volumes/VelocityData/velocity_om/features/SPY/regime_assignments.parquet'),
    'options_features': Path('/Volumes/VelocityData/velocity_om/features/SPY_options_features.parquet'),
    'surface_dir': Path('/Volumes/VelocityData/velocity_om/payoff_surfaces'),
    'output_dir': Path('/Volumes/VelocityData/velocity_om/discovered_structures'),
}


# ============================================================================
# PHASE 1: BUILD PAYOFF SURFACE
# ============================================================================

def build_payoff_surface(
    options_dir: Path,
    stock_data: Path,
    output_dir: Path,
    symbol: str = 'SPY',
    start_date: str = None,
    end_date: str = None
) -> Path:
    """
    Build payoff surface from raw options data.

    This is a one-time operation that takes ~1 hour for 5 years of data.
    """
    logger.info("=" * 60)
    logger.info("PHASE 1: Building Payoff Surface")
    logger.info("=" * 60)

    output_dir.mkdir(parents=True, exist_ok=True)
    surface_path = output_dir / f'{symbol}_payoff_surface.parquet'

    # Check if already exists
    if surface_path.exists():
        logger.info(f"Surface already exists: {surface_path}")
        logger.info("Delete to rebuild, or skip with --discover")
        return surface_path

    # Parse dates
    start = datetime.strptime(start_date, '%Y-%m-%d') if start_date else None
    end = datetime.strptime(end_date, '%Y-%m-%d') if end_date else None

    # Build
    builder = PayoffSurfaceBuilder(
        options_dir=options_dir,
        stock_data_path=stock_data,
        symbol=symbol,
        output_dir=output_dir
    )

    surface = builder.build_surface(start, end)

    logger.info(f"Built surface with {len(surface)} entries")
    logger.info(f"Structures: {surface['structure_key'].nunique()}")
    logger.info(f"Date range: {surface['date'].min()} to {surface['date'].max()}")

    return surface_path


# ============================================================================
# PHASE 2: RUN DISCOVERY
# ============================================================================

def run_discovery(
    data_path: Path,
    regime_path: Path,
    output_dir: Path,
    population_size: int = 100,
    n_generations: int = 50,
    walk_forward: bool = False,
    n_folds: int = 3
) -> List[StructureDNA]:
    """
    Run genetic algorithm to discover structures using precision backtesting.
    """
    logger.info("=" * 60)
    logger.info("PHASE 2: Structure Discovery (Precision Backtester)")
    logger.info("=" * 60)

    output_dir.mkdir(parents=True, exist_ok=True)

    # Initialize precision backtester
    logger.info("Initializing precision backtester...")
    backtester = PrecisionBacktester(
        data_path=data_path,
        regime_path=regime_path,
    )

    # Configure evolution
    config = EvolutionConfig(
        population_size=population_size,
        n_generations=n_generations,
        output_dir=output_dir,
        save_every_n_generations=10
    )

    # Create miner
    miner = StructureMiner(config, backtester)

    # Run evolution
    if walk_forward:
        logger.info(f"Using walk-forward validation with {n_folds} folds")
        discovered = run_walk_forward(miner, n_folds)
    else:
        discovered = miner.evolve()

    # Test on held-out data
    test_results = miner.test_discovered(discovered)

    # Save results
    test_results.to_csv(output_dir / 'test_results.csv', index=False)
    logger.info(f"Saved test results to {output_dir / 'test_results.csv'}")

    return discovered


# ============================================================================
# PHASE 3: OUTPUT DISCOVERED STRUCTURES
# ============================================================================

def save_discovered_structures(
    structures: List[StructureDNA],
    output_dir: Path
):
    """
    Save discovered structures in multiple formats.
    """
    logger.info("=" * 60)
    logger.info("PHASE 3: Saving Discovered Structures")
    logger.info("=" * 60)

    output_dir.mkdir(parents=True, exist_ok=True)

    # JSON format
    discovered_dicts = [d.to_dict() for d in structures]
    json_path = output_dir / 'discovered_structures.json'
    with open(json_path, 'w') as f:
        json.dump(discovered_dicts, f, indent=2, default=str)
    logger.info(f"Saved {len(structures)} structures to {json_path}")

    # Summary table
    summary = []
    for i, dna in enumerate(structures):
        summary.append({
            'rank': i + 1,
            'structure_type': dna.structure_type.value,
            'dte': dna.dte_bucket.value,
            'delta': dna.delta_bucket.value,
            'entry_regimes': str(dna.entry_regimes),
            'min_atm_cost': dna.min_atm_cost,
            'min_skew': dna.min_skew,
            'profit_target': dna.profit_target_pct,
            'stop_loss': dna.stop_loss_pct,
            'fitness': dna.fitness_score,
            'n_legs': dna.n_legs,
            'slippage_est': dna.estimated_slippage,
        })

    summary_df = pd.DataFrame(summary)
    summary_path = output_dir / 'structure_summary.csv'
    summary_df.to_csv(summary_path, index=False)
    logger.info(f"Saved summary to {summary_path}")

    # Print summary
    print("\n" + "=" * 70)
    print("DISCOVERED STRUCTURES SUMMARY")
    print("=" * 70)
    print(summary_df.to_string(index=False))


# ============================================================================
# QUICK BASELINE CHECK
# ============================================================================

def run_baseline_check(
    data_path: Path,
    regime_path: Path,
):
    """
    Quick check: how do seed structures perform?

    This validates the pipeline before running full evolution.
    """
    logger.info("=" * 60)
    logger.info("BASELINE CHECK: Testing Seed Structures")
    logger.info("=" * 60)

    backtester = PrecisionBacktester(
        data_path=data_path,
        regime_path=regime_path,
    )

    seeds = get_seed_structures()

    # Parallel baseline evaluation for M4 Pro
    from concurrent.futures import ThreadPoolExecutor

    def eval_seed(dna):
        result = backtester.backtest(dna)
        fitness = compute_fitness(result)
        dna.fitness_score = fitness
        return {
            'structure': format_dna(dna),
            'sharpe': result.sharpe_ratio,
            'return': result.total_return,
            'max_dd': result.max_drawdown,
            'win_rate': result.win_rate,
            'fitness': fitness,
        }

    with ThreadPoolExecutor(max_workers=12) as executor:
        results = list(executor.map(eval_seed, seeds))

    df = pd.DataFrame(results)
    df = df.sort_values('fitness', ascending=False)

    print("\n" + "=" * 70)
    print("SEED STRUCTURE BASELINE PERFORMANCE")
    print("=" * 70)
    print(df.to_string(index=False))

    return df


# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Options Structure Discovery Pipeline',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )

    # Mode
    mode_group = parser.add_mutually_exclusive_group(required=True)
    mode_group.add_argument('--full', action='store_true',
                            help='Run full pipeline (build surface + discover)')
    mode_group.add_argument('--build-surface', action='store_true',
                            help='Only build payoff surface')
    mode_group.add_argument('--discover', action='store_true',
                            help='Only run discovery (surface must exist)')
    mode_group.add_argument('--baseline', action='store_true',
                            help='Quick baseline check of seed structures')

    # Paths
    parser.add_argument('--options-dir', type=str,
                        default=str(DEFAULT_PATHS['options_dir']),
                        help='Directory with daily options parquet files')
    parser.add_argument('--stock-data', type=str,
                        default=str(DEFAULT_PATHS['stock_data']),
                        help='Path to stock OHLCV parquet')
    parser.add_argument('--regimes', type=str,
                        default=str(DEFAULT_PATHS['regimes']),
                        help='Path to regime assignments parquet')
    parser.add_argument('--options-features', type=str,
                        default=str(DEFAULT_PATHS['options_features']),
                        help='Path to options features parquet (for hybrid model)')
    parser.add_argument('--surface-dir', type=str,
                        default=str(DEFAULT_PATHS['surface_dir']),
                        help='Directory for payoff surfaces')
    parser.add_argument('--output-dir', type=str,
                        default=str(DEFAULT_PATHS['output_dir']),
                        help='Output directory for discovered structures')

    # Symbol and dates
    parser.add_argument('--symbol', type=str, default='SPY',
                        help='Symbol to process')
    parser.add_argument('--start', type=str, default='2020-01-01',
                        help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, default='2024-12-01',
                        help='End date (YYYY-MM-DD)')

    # Evolution parameters
    parser.add_argument('--population', type=int, default=100,
                        help='Population size for GA')
    parser.add_argument('--generations', type=int, default=50,
                        help='Number of generations')
    parser.add_argument('--walk-forward', action='store_true',
                        help='Use walk-forward validation')
    parser.add_argument('--n-folds', type=int, default=3,
                        help='Number of walk-forward folds')

    # Logging
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='Verbose logging')

    args = parser.parse_args()

    # Setup logging
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    # Convert paths
    options_dir = Path(args.options_dir)
    stock_data = Path(args.stock_data)
    regime_path = Path(args.regimes)
    options_features_path = Path(args.options_features)
    surface_dir = Path(args.surface_dir)
    output_dir = Path(args.output_dir)

    surface_path = surface_dir / f'{args.symbol}_payoff_surface.parquet'

    print("\n" + "=" * 70)
    print("OPTIONS STRUCTURE DISCOVERY ENGINE")
    print("=" * 70)
    print(f"Symbol: {args.symbol}")
    print(f"Date range: {args.start} to {args.end}")
    print(f"Options data: {options_dir}")
    print(f"Output: {output_dir}")
    print("=" * 70 + "\n")

    try:
        if args.build_surface or args.full:
            # Phase 1: Build surface
            surface_path = build_payoff_surface(
                options_dir=options_dir,
                stock_data=stock_data,
                output_dir=surface_dir,
                symbol=args.symbol,
                start_date=args.start,
                end_date=args.end
            )

        if args.baseline:
            # Quick baseline check
            run_baseline_check(stock_data, regime_path)
            return

        if args.discover or args.full:
            # Phase 2: Discovery
            if not stock_data.exists():
                logger.error(f"Stock data not found: {stock_data}")
                logger.error("Ensure stock data parquet exists")
                sys.exit(1)

            discovered = run_discovery(
                data_path=stock_data,
                regime_path=regime_path,
                output_dir=output_dir,
                population_size=args.population,
                n_generations=args.generations,
                walk_forward=args.walk_forward,
                n_folds=args.n_folds
            )

            # Phase 3: Save
            save_discovered_structures(discovered, output_dir)

        print("\n" + "=" * 70)
        print("PIPELINE COMPLETE")
        print("=" * 70)

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.exception(f"Pipeline failed: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
