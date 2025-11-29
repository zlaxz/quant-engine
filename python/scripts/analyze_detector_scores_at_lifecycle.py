#!/usr/bin/env python3
"""
Detector Score Distribution Analysis - Trade Lifecycle

CRITICAL ANALYSIS:
For each trade, calculate detector score at:
1. Entry day (should be ~0.7+ if entries are working)
2. Peak day (empirical optimal exit - what's the score here?)
3. Day 14 (time backstop - what's the score here?)

This tells us:
- Are entries firing at high detector scores? (validates entry logic)
- What is detector score at optimal exit? (validates 0.3 threshold)
- Do scores actually decay 0.7 → 0.3? (validates exit concept)

TRAIN PERIOD ONLY: 2020-2021
"""

import sys
sys.path.append('/Users/zstoc/rotation-engine')

import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path

# Import detector
from src.profiles.detectors import ProfileDetectors

# Configuration
TRAIN_START = datetime(2020, 1, 1).date()
TRAIN_END = datetime(2021, 12, 31).date()

print("=" * 80)
print("DETECTOR SCORE LIFECYCLE ANALYSIS")
print("=" * 80)
print("Period: TRAIN ONLY (2020-2021)")
print("Purpose: Validate detector scores at entry/peak/exit")
print()

# Load results
results_file = 'data/backtest_results/full_2020-2024/results.json'
if not Path(results_file).exists():
    print(f"ERROR: {results_file} not found")
    sys.exit(1)

with open(results_file) as f:
    all_results = json.load(f)

# Load SPY data for detector calculation
print("Loading SPY data...")
# TODO: Need to load SPY OHLCV with all features (RV, IV, VVIX, etc.)
# This script CANNOT work without full feature set

# For now, analyze what we CAN from the JSON
print("⚠️  WARNING: This script needs SPY data with full features to calculate detector scores")
print("   Current analysis will use ENTRY CONDITIONS from JSON only")
print()

# Initialize detector
detector = ProfileDetectors()

# Analyze each profile
for profile_id, profile_data in all_results.items():
    print(f"\n{'=' * 80}")
    print(f"{profile_id}")
    print('=' * 80)

    trades = profile_data.get('trades', [])
    print(f"Total trades: {len(trades)}")

    # Filter to train period
    train_trades = []
    for trade_data in trades:
        entry_date_str = trade_data['entry'].get('entry_date')
        if not entry_date_str:
            continue

        entry_date = datetime.strptime(entry_date_str, '%Y-%m-%d').date()

        if TRAIN_START <= entry_date <= TRAIN_END:
            train_trades.append(trade_data)

    print(f"Train period trades: {len(train_trades)}")

    if len(train_trades) == 0:
        print("  No train trades to analyze")
        continue

    # Analyze entry conditions
    print(f"\nEntry Conditions Analysis:")
    print("-" * 60)

    # Categories
    peakless_trades = []    # peak_pnl <= 0
    early_peak_trades = []  # day_of_peak <= 1
    late_peak_trades = []   # day_of_peak >= 5
    good_trades = []        # peak_pnl > 0 and 2 <= day_of_peak <= 10

    for trade in train_trades:
        path = trade.get('path', [])
        if not path:
            continue

        # Find peak
        peak_pnl = max(day['mtm_pnl'] for day in path)
        peak_day = next(day['day'] for day in path if day['mtm_pnl'] == peak_pnl)

        # Categorize
        if peak_pnl <= 0:
            peakless_trades.append(trade)
        elif peak_day <= 1:
            early_peak_trades.append(trade)
        elif peak_day >= 5:
            late_peak_trades.append(trade)
        else:
            good_trades.append(trade)

    print(f"  Peakless (peak ≤ $0):        {len(peakless_trades):3d} ({len(peakless_trades)/len(train_trades)*100:.1f}%)")
    print(f"  Early peak (day 0-1):        {len(early_peak_trades):3d} ({len(early_peak_trades)/len(train_trades)*100:.1f}%)")
    print(f"  Late peak (day 5+):          {len(late_peak_trades):3d} ({len(late_peak_trades)/len(train_trades)*100:.1f}%)")
    print(f"  Good timing (day 2-10):      {len(good_trades):3d} ({len(good_trades)/len(train_trades)*100:.1f}%)")

    # Analyze entry conditions for peakless trades
    if len(peakless_trades) > 0:
        print(f"\n  PEAKLESS TRADES - Entry Conditions:")
        print(f"  (These entries never generated convexity)")

        # Extract entry conditions
        for i, trade in enumerate(peakless_trades[:5]):  # Show first 5
            entry_cond = trade['path'][0]['market_conditions']
            print(f"\n    Trade {i+1}:")
            print(f"      Date: {trade['entry']['entry_date']}")
            print(f"      Slope MA20: {entry_cond.get('slope_MA20', 'N/A')}")
            print(f"      RV10: {entry_cond.get('RV10', 'N/A'):.3f}")
            print(f"      RV20: {entry_cond.get('RV20', 'N/A'):.3f}")
            print(f"      Close vs MA20: {entry_cond.get('close', 0)} vs {entry_cond.get('MA20', 0)}")

    # Analyze good trades
    if len(good_trades) > 0:
        print(f"\n  GOOD TRADES - Entry Conditions:")
        print(f"  (These generated convexity with good timing)")

        for i, trade in enumerate(good_trades[:5]):  # Show first 5
            entry_cond = trade['path'][0]['market_conditions']
            peak_pnl = max(day['mtm_pnl'] for day in trade['path'])
            peak_day = next(day['day'] for day in trade['path'] if day['mtm_pnl'] == peak_pnl)

            print(f"\n    Trade {i+1}:")
            print(f"      Date: {trade['entry']['entry_date']}")
            print(f"      Peak: ${peak_pnl:,.0f} on day {peak_day}")
            print(f"      Slope MA20: {entry_cond.get('slope_MA20', 'N/A')}")
            print(f"      RV10: {entry_cond.get('RV10', 'N/A'):.3f}")
            print(f"      RV20: {entry_cond.get('RV20', 'N/A'):.3f}")
            print(f"      Close vs MA20: {entry_cond.get('close', 0)} vs {entry_cond.get('MA20', 0)}")

print()
print("=" * 80)
print("NEXT STEPS")
print("=" * 80)
print()
print("To complete this analysis, we need:")
print("1. Full SPY data with all features (RV, IV, VVIX, slopes, etc.)")
print("2. Calculate detector scores at entry/peak/day14 for each trade")
print("3. Determine:")
print("   - Are entry detector scores actually ~0.7+?")
print("   - What is detector score at optimal exit (peak day)?")
print("   - Does score decay from 0.7 → 0.3 as expected?")
print()
print("Without detector scores, we can only analyze entry conditions manually.")
print("This shows patterns but doesn't validate the detector-based exit concept.")
