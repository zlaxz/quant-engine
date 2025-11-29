#!/usr/bin/env python3
"""
UI Data Generator.
Runs the engine on sample data and outputs JSON files for the Frontend.
"""

import sys
import os
import json
import pandas as pd
from datetime import datetime

# Add src to path
sys.path.append(os.getcwd())

from src.analysis.regime_engine import RegimeEngine
from src.mining.master_miner import MasterMiner
from src.mining.genome import StrategyGenome
from src.data.drive_loader import DriveLoader

def generate_data():
    print("--- GENERATING UI ARTIFACTS ---")
    
    # 1. SETUP
    loader = DriveLoader()
    regime_engine = RegimeEngine()
    
    # Target Range (Jan 2023 Sample)
    start_date = '2023-01-03'
    end_date = '2023-01-05'
    
    # 2. GENERATE REGIMES (The Heatmap)
    print("Mapping Regimes...")
    all_trades = []
    dates = pd.date_range(start=start_date, end=end_date, freq='D')
    
    for d in dates:
        d_str = d.strftime('%Y-%m-%d')
        try:
            df = loader.load_trades('SPY', d_str, columns=['timestamp', 'underlying_price', 'iv'])
            if not df.empty:
                # Add regime labels
                # We need to reshape the DF for the engine (resample first)
                resampled = df.set_index('timestamp').resample('5min').agg({'underlying_price':'last', 'iv':'median'}).rename(columns={'underlying_price':'close'}).dropna()
                
                if not resampled.empty:
                    df_labeled = regime_engine.label_historical_data(resampled)
                    df_labeled['date'] = df_labeled.index.date
                    # We need 'iv' column for the generator (it was renamed to iv_norm inside labeler? No, labeler adds iv_norm but keeps iv).
                    # Actually labeler expects 'iv' column. Resampled has it.
                    all_trades.append(df_labeled)
        except Exception as e:
            print(f"Skipping {d_str}: {e}")
            
    if all_trades:
        full_df = pd.concat(all_trades)
        regime_json = regime_engine.generate_api_response(full_df)
        
        # Save
        with open('data/ui_regimes.json', 'w') as f:
            json.dump(regime_json, f, indent=2)
        print(f"SAVED: data/ui_regimes.json ({len(regime_json)} days)")
    
    # 3. GENERATE BACKTEST (The Strategy Card)
    print("Running Backtest...")
    json_genome = """
    {
     "id": "strat_vanna_short_put_v1",
     "name": "Vanna Harvester",
     "ticker": "SPY",
     "trigger": { "type": "vix_level", "operator": ">", "value": 15 },
     "instrument": { "type": "put", "dte": 7, "delta": -0.05, "action": "sell" },
     "sizing": { "value": 5 },
     "exit": { "hold_days": 5 }
    }
    """
    genome = StrategyGenome.from_json(json_genome)
    miner = MasterMiner(start_date=start_date, end_date=end_date)
    results_df = miner.run(genome)
    
    # Format for API
    if not results_df.empty:
        # Convert Timestamps to strings
        results_df['entry_date'] = results_df['entry_date'].dt.strftime('%Y-%m-%d %H:%M:%S')
        results_df['exit_date'] = results_df['exit_date'].dt.strftime('%Y-%m-%d %H:%M:%S')
        
        # Trade List
        trades_list = results_df.to_dict('records')
        
        # Equity Curve (Simulated from PnL)
        equity = 100000.0
        curve = []
        curve.append({"time": start_date, "equity": equity})
        
        for t in trades_list:
            equity += t['pnl']
            curve.append({
                "time": t['exit_date'],
                "equity": equity
            })
            
        backtest_json = {
            "strategy_id": genome.id,
            "metrics": {
                "total_pnl": float(results_df['pnl'].sum()),
                "sharpe": 1.5, # Mock
                "win_rate": float(len(results_df[results_df['pnl']>0]) / len(results_df))
            },
            "equity_curve": curve,
            "trades": trades_list
        }
        
        with open('data/ui_backtest.json', 'w') as f:
            json.dump(backtest_json, f, indent=2)
        print("SAVED: data/ui_backtest.json")

if __name__ == "__main__":
    generate_data()
