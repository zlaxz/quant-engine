#!/usr/bin/env python3
"""
STRUCTURAL ENTRY ANALYSIS - NOT OPTIMIZATION

Framework:
- Use FULL dataset (2020-2024, all 384 trades)
- Categorize: peakless, early_fail, good
- Find clustering patterns in entry conditions
- Propose STRUCTURAL filters (not optimized)

DO NOT:
- Optimize detector_score thresholds
- Use train/val/test splits
- Optimize based on final_pnl
- Tune parameters to maximize profit

DO:
- Find conditions that NEVER produce convexity
- Identify regime contexts where entries structurally fail
- Propose "don't trade here" filters
"""

import sys
sys.path.append('/Users/zstoc/rotation-engine')

import json
import numpy as np
from pathlib import Path
from collections import defaultdict

# Load full dataset
results_file = 'data/backtest_results/full_2020-2024/results.json'
if not Path(results_file).exists():
    print(f"ERROR: {results_file} not found")
    sys.exit(1)

with open(results_file) as f:
    all_results = json.load(f)

print("=" * 80)
print("STRUCTURAL ENTRY ANALYSIS - FULL DATASET (2020-2024)")
print("=" * 80)
print()
print("Framework: Find where entries structurally fail (no convexity)")
print("NOT optimization - STRUCTURAL FAILURE DETECTION")
print()

# Categorization threshold
SMALL_THRESHOLD = 20  # $20 - anything below is "peakless"

# Analysis per profile
for profile_id, profile_data in all_results.items():
    print(f"\n{'=' * 80}")
    print(f"{profile_id}")
    print('=' * 80)

    trades = profile_data.get('trades', [])
    print(f"Total trades (2020-2024): {len(trades)}")

    if len(trades) == 0:
        print("  No trades to analyze")
        continue

    # Categorize trades
    peakless = []
    early_fail = []
    good = []

    for trade in trades:
        path = trade.get('path', [])
        if not path or len(path) == 0:
            continue

        # Find peak (handle missing mtm_pnl gracefully)
        pnl_values = [day.get('mtm_pnl') for day in path if day.get('mtm_pnl') is not None]
        if len(pnl_values) == 0:
            continue  # No valid P&L data

        peak_pnl = max(pnl_values)
        peak_day = None
        for day in path:
            if day.get('mtm_pnl') == peak_pnl and 'day' in day:
                peak_day = day['day']
                break

        if peak_day is None:
            continue  # Malformed trade - no day index found

        # Categorize by convexity expression
        if peak_pnl <= SMALL_THRESHOLD:
            peakless.append({
                'trade': trade,
                'peak_pnl': peak_pnl,
                'peak_day': peak_day
            })
        elif peak_day <= 1 and peak_pnl > SMALL_THRESHOLD:
            early_fail.append({
                'trade': trade,
                'peak_pnl': peak_pnl,
                'peak_day': peak_day
            })
        elif peak_pnl > SMALL_THRESHOLD and peak_day > 1:
            good.append({
                'trade': trade,
                'peak_pnl': peak_pnl,
                'peak_day': peak_day
            })

    total_categorized = len(peakless) + len(early_fail) + len(good)

    print(f"\nTrade Categorization:")
    if total_categorized == 0:
        print(f"  No valid trades to categorize (all have empty/invalid paths)")
        continue
    else:
        print(f"  Peakless (peak ≤ $20):       {len(peakless):3d} ({len(peakless)/total_categorized*100:5.1f}%)")
        print(f"  Early-fail (peak day 0-1):   {len(early_fail):3d} ({len(early_fail)/total_categorized*100:5.1f}%)")
        print(f"  Good (peak > $20, day > 1):  {len(good):3d} ({len(good)/total_categorized*100:5.1f}%)")

    # Analyze entry conditions for peakless trades
    if len(peakless) > 0:
        print(f"\n  {'─' * 76}")
        print(f"  PEAKLESS TRADES - Entry Condition Analysis")
        print(f"  {'─' * 76}")
        print(f"  (These entries NEVER generated convexity)")
        print()

        # Collect entry conditions
        peakless_conditions = []
        for item in peakless:
            trade = item['trade']
            if 'path' in trade and len(trade['path']) > 0:
                entry_cond = trade['path'][0].get('market_conditions', {})
                if entry_cond:  # Only add if market_conditions exists
                    peakless_conditions.append(entry_cond)

        if len(peakless_conditions) > 0:
            # Analyze key variables
            vars_to_analyze = [
                'slope_MA20', 'slope_MA50', 'RV5', 'RV10', 'RV20',
                'ATR5', 'ATR10', 'return_5d', 'return_10d', 'return_20d',
                'range_10d'
            ]

            print(f"  Summary statistics (n={len(peakless_conditions)}):")
            print()

            for var in vars_to_analyze:
                values = [c.get(var) for c in peakless_conditions if c.get(var) is not None]

                if len(values) > 0:
                    print(f"    {var:20s}: mean={np.mean(values):7.4f}, "
                          f"median={np.median(values):7.4f}, "
                          f"min={np.min(values):7.4f}, "
                          f"max={np.max(values):7.4f}")

            # Show first 3 examples
            print(f"\n  Example peakless trades (first 3):")
            for i, item in enumerate(peakless[:3]):
                trade = item['trade']
                entry_date = trade['entry']['entry_date']
                entry_cond = trade['path'][0].get('market_conditions', {})

                print(f"\n    Trade {i+1} ({entry_date}):")
                print(f"      Peak: ${item['peak_pnl']:.0f} on day {item['peak_day']}")

                # Show key conditions
                print(f"      slope_MA20: {entry_cond.get('slope_MA20', 'N/A')}")
                rv10 = entry_cond.get('RV10')
                rv20 = entry_cond.get('RV20')
                rv10_str = f"{rv10:.3f}" if rv10 is not None else 'N/A'
                rv20_str = f"{rv20:.3f}" if rv20 is not None else 'N/A'
                print(f"      RV10: {rv10_str}")
                print(f"      RV20: {rv20_str}")
                if rv10 is not None and rv20 is not None and rv20 > 0 and np.isfinite(rv10):
                    print(f"      RV10/RV20: {rv10/rv20:.3f}")

    # Analyze entry conditions for GOOD trades (comparison)
    if len(good) > 0:
        print(f"\n  {'─' * 76}")
        print(f"  GOOD TRADES - Entry Condition Analysis")
        print(f"  {'─' * 76}")
        print(f"  (These generated convexity with good timing)")
        print()

        # Collect entry conditions
        good_conditions = []
        for item in good:
            trade = item['trade']
            if 'path' in trade and len(trade['path']) > 0:
                entry_cond = trade['path'][0].get('market_conditions', {})
                good_conditions.append(entry_cond)

        if len(good_conditions) > 0:
            vars_to_analyze = [
                'slope_MA20', 'slope_MA50', 'RV5', 'RV10', 'RV20',
                'ATR5', 'ATR10', 'return_5d', 'return_10d', 'return_20d',
                'range_10d'
            ]

            print(f"  Summary statistics (n={len(good_conditions)}):")
            print()

            for var in vars_to_analyze:
                values = [c.get(var) for c in good_conditions if c.get(var) is not None]

                if len(values) > 0:
                    print(f"    {var:20s}: mean={np.mean(values):7.4f}, "
                          f"median={np.median(values):7.4f}, "
                          f"min={np.min(values):7.4f}, "
                          f"max={np.max(values):7.4f}")

    # STRUCTURAL FILTER RECOMMENDATIONS
    print(f"\n  {'─' * 76}")
    print(f"  STRUCTURAL FILTER RECOMMENDATIONS")
    print(f"  {'─' * 76}")
    print(f"  (Based on peakless trade clustering patterns)")
    print()

    # Placeholder - will fill in based on patterns observed
    if total_categorized == 0:
        print(f"  ⚠️  No categorized trades - cannot assess peakless rate")
    elif len(peakless) > total_categorized * 0.3:
        print(f"  ⚠️  HIGH peakless rate ({len(peakless)/total_categorized*100:.1f}%)")
        print(f"      Entries firing in structurally wrong regimes")
        print(f"      → Review entry conditions above for filtering opportunities")
    else:
        print(f"  ✓ Low peakless rate ({len(peakless)/total_categorized*100:.1f}%)")
        print(f"    Entries mostly firing in correct regimes")

    print()

print()
print("=" * 80)
print("NEXT STEPS")
print("=" * 80)
print()
print("1. Review entry condition patterns for each profile")
print("2. Identify structural filters (based on clustering in peakless trades)")
print("3. Discuss and agree on filters BEFORE implementing")
print("4. Do NOT optimize - only remove structurally dead contexts")
print()
print("NOTE: This analysis shows PATTERNS, not causation")
print("      Use judgment to convert patterns → structural filters")
