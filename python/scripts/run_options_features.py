#!/usr/bin/env python3
"""
Run Options Feature Engineering

Phase 0 of the Hybrid Pipeline:
Extracts market state signals (IV, Skew, Term Structure) from raw options data.

Usage:
    python run_options_features.py --symbol SPY
"""

import argparse
import logging
import sys
from pathlib import Path

# Add project root
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.features.options_feature_engineer import OptionsFeatureEngineer

# Default paths
DEFAULT_OPTIONS_DIR = '/Volumes/VelocityData/velocity_om/massive/options'
DEFAULT_STOCK_DATA = '/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet'

def main():
    parser = argparse.ArgumentParser(description='Build Options Features')
    parser.add_argument('--options-dir', type=str, default=DEFAULT_OPTIONS_DIR,
                        help='Directory containing daily options parquet files')
    parser.add_argument('--stock-data', type=str, default=DEFAULT_STOCK_DATA,
                        help='Path to stock OHLCV/Features parquet')
    parser.add_argument('--symbol', type=str, default='SPY',
                        help='Symbol to process')
    parser.add_argument('--output', type=str, default=None,
                        help='Output directory for features')
    
    args = parser.parse_args()
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    logger = logging.getLogger("RunOptionsFeatures")
    logger.info(f"Starting options feature extraction for {args.symbol}")
    
    engineer = OptionsFeatureEngineer(
        options_dir=Path(args.options_dir),
        stock_data_path=Path(args.stock_data),
        symbol=args.symbol,
        output_dir=Path(args.output) if args.output else None
    )
    
    df = engineer.build_features()
    
    if not df.empty:
        logger.info(f"Successfully built features for {len(df)} days")
        print(df.tail())
    else:
        logger.warning("No features built!")

if __name__ == '__main__':
    main()
