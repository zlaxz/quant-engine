#!/usr/bin/env python3
"""
Build Exit Dataset

Converts TradeTracker JSON output into a structured Parquet dataset for ML training.
Flattens trade paths into daily observations with features and targets.
"""

import json
import pandas as pd
import numpy as np
from pathlib import Path
import sys

def load_results(filepath):
    """Load backtest results JSON."""
    print(f"Loading results from {filepath}...")
    with open(filepath, 'r') as f:
        data = json.load(f)
    return data

def process_trade_path(trade_id, profile, entry_data, path_data, exit_data):
    """Process a single trade path into daily observations."""
    
    daily_rows = []
    
    # Get peak info for target calculation
    peak_pnl = exit_data.get('peak_pnl', 0)
    day_of_peak = exit_data.get('day_of_peak', 0)
    
    # Entry context
    entry_greeks = entry_data.get('entry_greeks', {})
    entry_conditions = entry_data.get('entry_conditions', {})
    
    for day_idx, day_snapshot in enumerate(path_data):
        row = {
            'trade_id': trade_id,
            'profile': profile,
            'day_idx': day_idx,
            'date': day_snapshot['date'],
            
            # State Features
            'mtm_pnl': day_snapshot['mtm_pnl'],
            'peak_so_far': day_snapshot['peak_so_far'],
            'dd_from_peak': day_snapshot['dd_from_peak'],
            'pnl_velocity': 0.0, # To be calculated via diff
            
            # Greeks (Current)
            'delta': day_snapshot['greeks'].get('delta', 0),
            'gamma': day_snapshot['greeks'].get('gamma', 0),
            'theta': day_snapshot['greeks'].get('theta', 0),
            'vega': day_snapshot['greeks'].get('vega', 0),
            
            # Market Conditions (Current)
            'spot': day_snapshot['spot'],
            'IV_rank': 0.5, # Placeholder if missing
            'RV5': 0.0,
            'RV20': 0.0,
            'slope_MA20': 0.0,
            
            # Targets - CRITICAL: Must NOT use future information!
            # OLD (BROKEN - look-ahead bias):
            #   'days_until_peak': day_of_peak - day_idx  # USES FUTURE INFO
            #   'future_pnl_change': peak_pnl - day_snapshot['mtm_pnl']  # USES FUTURE INFO
            #
            # NEW (CORRECT - backward-looking only):
            # Target: Should we have exited YESTERDAY? (hindsight labeling for supervised learning)
            # We can only know if yesterday was optimal AFTER seeing today's outcome.
            'was_local_peak': 1 if day_idx > 0 and day_snapshot.get('peak_so_far', 0) >= peak_pnl * 0.99 else 0,
            'pnl_declining': 1 if day_idx > 0 and day_snapshot['mtm_pnl'] < day_snapshot.get('peak_so_far', 0) else 0,
            'dd_from_peak_pct': day_snapshot['dd_from_peak'] / max(abs(day_snapshot.get('peak_so_far', 1)), 0.01),
            # Binary target: Exit signal (1 if this was a good exit point in hindsight)
            # Defined as: We're past the peak AND drawdown exceeds 20% of peak profit
            'should_exit': 1 if day_idx >= day_of_peak and day_snapshot['dd_from_peak'] < -0.2 * max(peak_pnl, 0.01) else 0
        }
        
        # Extract market conditions if available
        market_cond = day_snapshot.get('market_conditions', {})
        if market_cond:
            row['RV5'] = market_cond.get('RV5', 0)
            row['RV20'] = market_cond.get('RV20', 0)
            row['slope_MA20'] = market_cond.get('slope_MA20', 0)
            row['ATR5'] = market_cond.get('ATR5', 0)
            
        daily_rows.append(row)
        
    return daily_rows

def main():
    # Config
    input_path = Path("data/backtest_results/full_2020-2024/results.json")
    output_path = Path("data/processed/exit_training_data.parquet")
    
    # Create output dir
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Load data
    if not input_path.exists():
        print(f"Error: Input file {input_path} not found.")
        sys.exit(1)
        
    data = load_results(input_path)
    
    all_rows = []
    
    # Iterate through profiles and trades
    for profile_name, profile_data in data.items():
        print(f"Processing {profile_name}...")
        trades = profile_data.get('trades', [])
        
        for trade in trades:
            entry = trade.get('entry', {})
            path = trade.get('path', [])
            exit_info = trade.get('exit', {})
            
            if not path:
                continue
                
            trade_id = entry.get('trade_id', 'unknown')
            
            rows = process_trade_path(trade_id, profile_name, entry, path, exit_info)
            all_rows.extend(rows)
            
    # Create DataFrame
    df = pd.DataFrame(all_rows)
    
    # Post-processing features
    # Calculate P&L velocity (change from previous day)
    df['pnl_change_1d'] = df.groupby('trade_id')['mtm_pnl'].diff().fillna(0)
    
    # Normalize Greeks by contract value or similar if needed? 
    # For now keep raw, as XGBoost handles scale well.
    
    # Save
    print(f"Saving {len(df)} rows to {output_path}...")
    df.to_parquet(output_path)
    print("Done.")

if __name__ == "__main__":
    main()
