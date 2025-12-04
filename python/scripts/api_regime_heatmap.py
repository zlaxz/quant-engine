#!/usr/bin/env python3
"""
API Endpoint: Get Regime Heatmap
Usage: python scripts/api_regime_heatmap.py --start 2023-01-01 --end 2023-01-31
Output: JSON Array to stdout
"""

import sys
import os
import json
import argparse
import pandas as pd

# Add project root to path
sys.path.append(os.getcwd())

from src.data.drive_loader import DriveLoader
from src.analysis.regime_engine import RegimeEngine

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ticker', type=str, default='SPY')
    parser.add_argument('--start', type=str, required=True)
    parser.add_argument('--end', type=str, required=True)
    args = parser.parse_args()
    
    # 1. Load Data
    loader = DriveLoader()
    engine = RegimeEngine()
    
    # We iterate through days to build the full history
    # Optimization: In production, we'd load a pre-computed parquet file.
    # Here we load day-by-day from the drive.
    
    dates = pd.date_range(start=args.start, end=args.end, freq='D')
    full_history = []
    
    for date_obj in dates:
        date_str = date_obj.strftime('%Y-%m-%d')
        try:
            # Load Trades (Price + IV)
            df = loader.load_trades(args.ticker, date_str, columns=['timestamp', 'underlying_price', 'iv'])
            if not df.empty:
                # Resample to 5min for the Engine
                resampled = df.set_index('timestamp').resample('5min').agg({
                    'underlying_price': 'last',
                    'iv': 'median'
                }).dropna()
                resampled.columns = ['close', 'iv']
                full_history.append(resampled)
        except Exception as e:
            print(f"[WARN] Failed to load data: {e}", file=sys.stderr)
            continue
            
    if not full_history:
        print(json.dumps({"error": "No data found for range"}))
        return

    # Combine
    combined_df = pd.concat(full_history)
    
    # 2. Run Engine
    labeled_df = engine.label_historical_data(combined_df)
    
    # 3. Format for API
    api_response = engine.generate_api_heatmap(labeled_df)
    
    # 4. Output JSON
    print(json.dumps(api_response, indent=2))

if __name__ == "__main__":
    main()
