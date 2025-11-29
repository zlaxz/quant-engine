#!/usr/bin/env python3
"""
Day 1 Demo: Query data spine for any date.

Shows:
- SPY OHLCV + features
- Options chain
- Data quality
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / 'src'))

from datetime import datetime
import pandas as pd
from data import DataSpine

pd.set_option('display.max_columns', None)
pd.set_option('display.width', 120)


def demo_query(date_str: str):
    """Demo query for a specific date."""
    print("="*80)
    print(f"DATA SPINE QUERY: {date_str}")
    print("="*80)

    spine = DataSpine()
    date = datetime.strptime(date_str, '%Y-%m-%d')

    # Get data
    data = spine.get_day_data(date, include_options=True)
    spy = data['spy']
    options = data['options']

    if spy is None:
        print(f"❌ No data for {date_str}")
        return

    # SPY summary
    print("\n--- SPY SUMMARY ---")
    print(f"Date: {spy['date']}")
    print(f"Close: ${spy['close']:.2f}")
    print(f"Volume: {spy['volume']:,.0f}")
    print(f"\n--- VOLATILITY & MOMENTUM ---")
    print(f"RV5:  {spy['RV5']:.2%}")
    print(f"RV10: {spy['RV10']:.2%}")
    print(f"RV20: {spy['RV20']:.2%}")
    print(f"ATR10: {spy['ATR10']:.2f}")
    print(f"\n--- TREND ---")
    print(f"MA20: ${spy['MA20']:.2f} (price {100*spy['price_to_MA20']:.1f}% from MA20)")
    print(f"MA50: ${spy['MA50']:.2f} (price {100*spy['price_to_MA50']:.1f}% from MA50)")
    print(f"MA20 slope: {spy['slope_MA20']:.4f}")
    print(f"20-day return: {100*spy['return_20d']:.1f}%")

    # Options summary
    print(f"\n--- OPTIONS CHAIN ---")
    print(f"Total: {len(options)} contracts")
    print(f"Calls: {(options['option_type']=='call').sum()}")
    print(f"Puts: {(options['option_type']=='put').sum()}")
    print(f"Strike range: ${options['strike'].min():.0f} - ${options['strike'].max():.0f}")
    print(f"DTE range: {options['dte'].min()} - {options['dte'].max()} days")

    # Show ATM options
    print(f"\n--- ATM OPTIONS (within $5 of spot) ---")
    atm = options[
        (options['strike'].between(spy['close'] - 5, spy['close'] + 5))
    ].sort_values(['option_type', 'expiry', 'strike'])

    if not atm.empty:
        print("\nCalls:")
        calls = atm[atm['option_type'] == 'call'].head(10)
        print(calls[['strike', 'expiry', 'dte', 'close', 'volume']].to_string(index=False))

        print("\nPuts:")
        puts = atm[atm['option_type'] == 'put'].head(10)
        print(puts[['strike', 'expiry', 'dte', 'close', 'volume']].to_string(index=False))

    # Show 30-DTE options
    print(f"\n--- 30-DTE OPTIONS ---")
    dte30 = options[options['dte'].between(28, 32)].sort_values(['option_type', 'strike'])

    if not dte30.empty:
        print(f"\nTotal 30-DTE contracts: {len(dte30)}")
        print(f"Strike range: ${dte30['strike'].min():.0f} - ${dte30['strike'].max():.0f}")

        # Show some samples
        calls_30 = dte30[
            (dte30['option_type'] == 'call') &
            (dte30['strike'].between(spy['close'] - 10, spy['close'] + 10))
        ]
        if not calls_30.empty:
            print("\nSample 30-DTE calls near ATM:")
            print(calls_30[['strike', 'close', 'volume', 'bid', 'ask']].head(5).to_string(index=False))

    print("\n" + "="*80)


if __name__ == '__main__':
    # Demo multiple dates
    demo_dates = [
        '2020-03-16',  # COVID crash
        '2021-11-22',  # Low vol grind
        '2022-06-15',  # Bear market
        '2023-08-15',  # Recovery
        '2024-10-10',  # Recent
    ]

    for date_str in demo_dates:
        try:
            demo_query(date_str)
            print("\n")
        except Exception as e:
            print(f"Error for {date_str}: {e}")
            continue
