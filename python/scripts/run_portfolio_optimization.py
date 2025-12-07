#!/usr/bin/env python3
"""
Run Portfolio Optimization: Discover Optimal Portfolio Allocation Strategies

This script orchestrates the discovery of optimal portfolio allocation strategies
for a given set of previously discovered individual options structures.

It uses a PortfolioDNA to define the meta-rules for portfolio construction,
a PortfolioOptimizer to dynamically calculate weights based on market regimes,
and a PortfolioBacktester to simulate the performance.

Usage:
    python run_portfolio_optimization.py --discovered discovered_structures.json --regimes regime_assignments.parquet
"""

import argparse
import json
import logging
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.discovery.structure_dna import StructureDNA
from engine.discovery.precision_backtester import PrecisionBacktester
from engine.portfolio.portfolio_dna import PortfolioDNA
from engine.portfolio.portfolio_backtester import PortfolioBacktester
from engine.portfolio.portfolio_optimizer import PortfolioOptimizer

logger = logging.getLogger("PortfolioOptimization")


# ============================================================================
# DEFAULT PATHS
# ============================================================================

DEFAULT_PATHS = {
    'regimes': Path('/Volumes/VelocityData/velocity_om/features/SPY/regime_assignments.parquet'),
    'options_features': Path('/Volumes/VelocityData/velocity_om/features/SPY_options_features.parquet'),
    'surface_dir': Path('/Volumes/VelocityData/velocity_om/payoff_surfaces'),
    'discovered_structures_file': Path('/Volumes/VelocityData/velocity_om/discovered_structures/discovered_structures.json'),
    'output_dir': Path('/Volumes/VelocityData/velocity_om/portfolio_results'),
}


# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Portfolio Optimization Pipeline',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )

    # Required paths
    parser.add_argument('--discovered', type=str,
                        default=str(DEFAULT_PATHS['discovered_structures_file']),
                        help='Path to JSON file containing discovered StructureDNA objects')
    parser.add_argument('--regimes', type=str,
                        default=str(DEFAULT_PATHS['regimes']),
                        help='Path to regime assignments parquet')
    parser.add_argument('--surface', type=str,
                        default=str(DEFAULT_PATHS['surface_dir'] / 'SPY_payoff_surface.parquet'),
                        help='Path to payoff surface parquet')
    
    # Stock data for PrecisionBacktester
    parser.add_argument('--stock-data', type=str,
                        default=str(Path('/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet')),
                        help='Path to stock OHLCV parquet')
    
    # Portfolio config
    parser.add_argument('--portfolio-dna-config', type=str,
                        help='Path to JSON file with PortfolioDNA configuration (otherwise uses default)')
    parser.add_argument('--output-dir', type=str,
                        default=str(DEFAULT_PATHS['output_dir']),
                        help='Output directory for portfolio backtest results')
    parser.add_argument('--symbol', type=str, default='SPY',
                        help='Symbol being processed (used for default paths)')

    # Date range for portfolio backtest
    parser.add_argument('--start', type=str, default='2020-01-01',
                        help='Start date for portfolio backtest (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, default='2024-12-01',
                        help='End date for portfolio backtest (YYYY-MM-DD)')

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

    logger.info("=" * 70)
    logger.info("STARTING PORTFOLIO OPTIMIZATION")
    logger.info("=" * 70)

    try:
        # Load discovered StructureDNAs
        discovered_structures_path = Path(args.discovered)
        if not discovered_structures_path.exists():
            logger.error(f"Discovered structures file not found: {discovered_structures_path}")
            sys.exit(1)

        with open(discovered_structures_path, 'r') as f:
            discovered_dicts = json.load(f)
        
        # Filter out strategies with 0 fitness from prior discovery for efficiency
        discovered_structures = [StructureDNA.from_dict(d) for d in discovered_dicts if d.get('fitness_score', 0.0) > 0.001]
        if not discovered_structures:
            logger.error("No valid discovered structures with positive fitness found. Exiting.")
            sys.exit(1)
            
        logger.info(f"Loaded {len(discovered_structures)} valid StructureDNAs.")

        # Load PortfolioDNA configuration
        if args.portfolio_dna_config:
            with open(args.portfolio_dna_config, 'r') as f:
                portfolio_dna_dict = json.load(f)
            portfolio_dna = PortfolioDNA.from_dict(portfolio_dna_dict)
            logger.info(f"Loaded PortfolioDNA from {args.portfolio_dna_config}")
        else:
            portfolio_dna = PortfolioDNA() # Use default DNA
            logger.info("Using default PortfolioDNA configuration.")
        
        # Initialize PrecisionBacktester (needed by PortfolioBacktester)
        precision_backtester = PrecisionBacktester(
            data_path=Path(args.stock_data),
            regime_path=Path(args.regimes),
        )
        logger.info("PrecisionBacktester initialized.")

        # Initialize PortfolioBacktester
        portfolio_backtester = PortfolioBacktester(
            precision_backtester=precision_backtester,
            discovered_structures=discovered_structures
        )
        logger.info("PortfolioBacktester initialized.")
        
        # Initialize PortfolioOptimizer
        # The PortfolioOptimizer needs the full regime history for lookbacks
        regime_data = pd.read_parquet(Path(args.regimes))
        regime_data['date'] = pd.to_datetime(regime_data.get('timestamp', regime_data.get('date')))
        regime_data = regime_data.set_index('date')['regime']
        portfolio_optimizer = PortfolioOptimizer(regime_data=regime_data)
        logger.info("PortfolioOptimizer initialized.")

        # Set date range for portfolio backtest
        start_date = datetime.strptime(args.start, '%Y-%m-%d')
        end_date = datetime.strptime(args.end, '%Y-%m-%d')

        # Run portfolio backtest
        logger.info(f"Running portfolio backtest from {args.start} to {args.end}...")
        portfolio_result = portfolio_backtester.backtest_portfolio(
            portfolio_dna=portfolio_dna,
            optimizer_func=portfolio_optimizer.get_portfolio_weights,
            start_date=start_date,
            end_date=end_date
        )
        logger.info("Portfolio backtest completed.")

        # Output results
        output_dir = Path(args.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        # Save metrics
        metrics_path = output_dir / 'portfolio_metrics.json'
        with open(metrics_path, 'w') as f:
            json.dump(portfolio_result.to_dict(), f, indent=2, default=str)
        logger.info(f"Portfolio metrics saved to {metrics_path}")

        # Save equity curve
        equity_path = output_dir / 'portfolio_equity_curve.csv'
        portfolio_result.equity_curve.to_csv(equity_path)
        logger.info(f"Portfolio equity curve saved to {equity_path}")

        # Save weights history
        if portfolio_result.weights_history:
            weights_df = pd.DataFrame.from_dict(portfolio_result.weights_history, orient='index')
            weights_path = output_dir / 'portfolio_weights_history.csv'
            weights_df.to_csv(weights_path)
            logger.info(f"Portfolio weights history saved to {weights_path}")
        
        logger.info("\n" + "=" * 70)
        logger.info("PORTFOLIO OPTIMIZATION COMPLETE")
        logger.info(f"Annual Return: {portfolio_result.ann_return:.2%}")
        logger.info(f"Sharpe Ratio: {portfolio_result.sharpe_ratio:.2f}")
        logger.info(f"Max Drawdown: {portfolio_result.max_drawdown:.2%}")
        logger.info("=" * 70)

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.exception(f"Portfolio optimization failed: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
