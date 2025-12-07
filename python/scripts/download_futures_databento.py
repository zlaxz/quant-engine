#!/usr/bin/env python3
"""
Download all major futures data from Databento to local storage.

This pulls historical data for backtesting. Once downloaded, no ongoing cost.

Databento symbology for continuous contracts:
- stype_in="continuous"
- Symbol format: "ES.v.0" (front month), "ES.v.1" (second month), etc.

Sources:
- https://databento.com/datasets/GLBX.MDP3
- https://databento.com/catalog/cme/GLBX.MDP3/futures/ES
"""

import os
import databento as db
from pathlib import Path

# Config
API_KEY = os.environ.get('DATABENTO_API_KEY')
OUTPUT_DIR = Path("/Volumes/VelocityData/velocity_om/futures")

# Major futures to download
# Format: symbol.v.0 = continuous front month
FUTURES = {
    # Equity Index
    "ES.v.0": "E-mini S&P 500",
    "NQ.v.0": "E-mini NASDAQ 100",
    "RTY.v.0": "E-mini Russell 2000",
    "YM.v.0": "E-mini Dow",

    # Micro contracts (for live testing)
    "MES.v.0": "Micro E-mini S&P",
    "MNQ.v.0": "Micro E-mini NASDAQ",

    # Energy
    "CL.v.0": "Crude Oil",
    "NG.v.0": "Natural Gas",

    # Metals
    "GC.v.0": "Gold",
    "SI.v.0": "Silver",

    # Bonds
    "ZB.v.0": "30-Year Treasury",
    "ZN.v.0": "10-Year Treasury",
    "ZF.v.0": "5-Year Treasury",

    # Currencies
    "6E.v.0": "Euro FX",
    "6J.v.0": "Japanese Yen",
}

# Date range
START_DATE = "2015-01-01"
END_DATE = "2024-12-06"

# Schemas to download
SCHEMAS = [
    "ohlcv-1m",   # 1-minute bars - main backtesting
    "ohlcv-1h",   # 1-hour bars - faster analysis
    "ohlcv-1d",   # Daily bars - regime analysis
]


def download_futures():
    """Download all futures data."""

    if not API_KEY:
        print("ERROR: DATABENTO_API_KEY not set in environment")
        return

    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    client = db.Historical(key=API_KEY)

    print(f"Downloading futures data to: {OUTPUT_DIR}")
    print(f"Date range: {START_DATE} to {END_DATE}")
    print(f"Contracts: {len(FUTURES)}")
    print(f"Schemas: {SCHEMAS}")
    print("=" * 60)

    for symbol, name in FUTURES.items():
        # Extract base symbol for filename (ES.v.0 -> ES)
        base_symbol = symbol.split('.')[0]
        print(f"\n[{base_symbol}] {name}")

        for schema in SCHEMAS:
            output_file = OUTPUT_DIR / f"{base_symbol}_{schema.replace('-', '_')}_{START_DATE}_{END_DATE}.parquet"

            if output_file.exists():
                print(f"  {schema}: Already exists, skipping")
                continue

            try:
                print(f"  {schema}: Downloading...", end=" ", flush=True)

                # Get data with continuous symbology
                data = client.timeseries.get_range(
                    dataset="GLBX.MDP3",
                    symbols=[symbol],
                    stype_in="continuous",  # KEY: use continuous symbology
                    schema=schema,
                    start=START_DATE,
                    end=END_DATE,
                )

                # Convert to DataFrame and save
                df = data.to_df()
                df.to_parquet(output_file)

                print(f"Done ({len(df):,} rows)")

            except Exception as e:
                print(f"ERROR: {e}")

    print("\n" + "=" * 60)
    print("Download complete!")

    # Show disk usage
    total_size = sum(f.stat().st_size for f in OUTPUT_DIR.glob("*.parquet"))
    print(f"Total size: {total_size / 1e9:.2f} GB")


def estimate_cost():
    """Estimate cost before downloading."""

    if not API_KEY:
        print("ERROR: DATABENTO_API_KEY not set")
        return

    client = db.Historical(key=API_KEY)

    print("Estimating download cost...")
    print("=" * 60)

    total_cost = 0

    for symbol, name in FUTURES.items():
        base_symbol = symbol.split('.')[0]
        for schema in SCHEMAS:
            try:
                cost = client.metadata.get_cost(
                    dataset="GLBX.MDP3",
                    symbols=[symbol],
                    stype_in="continuous",
                    schema=schema,
                    start=START_DATE,
                    end=END_DATE,
                )
                total_cost += cost
                print(f"{base_symbol} {schema}: ${cost:.2f}")
            except Exception as e:
                print(f"{base_symbol} {schema}: Error - {e}")

    print("=" * 60)
    print(f"TOTAL ESTIMATED COST: ${total_cost:.2f}")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "--estimate":
        estimate_cost()
    elif len(sys.argv) > 1 and sys.argv[1] == "--download":
        download_futures()
    else:
        print("Usage:")
        print("  python download_futures_databento.py --estimate  # See cost first")
        print("  python download_futures_databento.py --download  # Download data")
        print()
        print("Running cost estimate...")
        print()
        estimate_cost()
