import pandas as pd
import os

file_path = 'data/processed/exit_training_data.parquet'

print(f"--- INSPECTING: {file_path} ---")

if not os.path.exists(file_path):
    print(f"ERROR: File not found at {file_path}")
else:
    try:
        df = pd.read_parquet(file_path)
        print(f"Shape: {df.shape}")
        print(f"Columns: {df.columns.tolist()}")
        
        if 'timestamp' in df.columns:
            print(f"Start Date: {df['timestamp'].min()}")
            print(f"End Date:   {df['timestamp'].max()}")
        
        if 'ticker' in df.columns:
            tickers = df['ticker'].unique()
            print(f"Tickers Found ({len(tickers)}): {tickers[:10]}...")
            
        print("\nSample Data (First 3 rows):")
        print(df.head(3))
        
    except Exception as e:
        print(f"ERROR reading parquet: {e}")
