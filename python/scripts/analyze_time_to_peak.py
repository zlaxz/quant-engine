#!/usr/bin/env python3
"""
TIME-TO-PEAK SANITY CHECK

For each profile + overall:
- Compute time_to_peak_days = day when PnL peaks
- Report p25/p50/p75 percentiles
- Show % peaking by day 5, 7, 10, 14
- Text histogram of distribution

Uses CURRENT results (349 trades, post-SDG-filter)
"""

import sys
sys.path.append('/Users/zstoc/rotation-engine')

import json
import numpy as np
from pathlib import Path

# Load current results
results_file = 'data/backtest_results/full_2020-2024/results.json'
with open(results_file) as f:
    all_results = json.load(f)

print("=" * 80)
print("TIME-TO-PEAK ANALYSIS - CURRENT DATA")
print("=" * 80)
print()

# Overall aggregation
all_peak_days = []

# Per-profile analysis
for profile_id, data in all_results.items():
    print(f"\n{profile_id}")
    print("-" * 60)

    trades = data['trades']
    peak_days = []

    for trade in trades:
        path = trade.get('path', [])
        if not path:
            continue

        # Find peak day
        pnl_values = [(day['day'], day['mtm_pnl']) for day in path if day.get('mtm_pnl') is not None]
        if not pnl_values:
            continue

        peak_day, peak_pnl = max(pnl_values, key=lambda x: x[1])
        peak_days.append(peak_day)
        all_peak_days.append(peak_day)

    if len(peak_days) == 0:
        print("  No valid trades")
        continue

    # Statistics
    p25 = np.percentile(peak_days, 25)
    p50 = np.percentile(peak_days, 50)
    p75 = np.percentile(peak_days, 75)

    # Cumulative % peaking by day
    pct_by_5 = sum(1 for d in peak_days if d <= 5) / len(peak_days) * 100
    pct_by_7 = sum(1 for d in peak_days if d <= 7) / len(peak_days) * 100
    pct_by_10 = sum(1 for d in peak_days if d <= 10) / len(peak_days) * 100
    pct_by_14 = sum(1 for d in peak_days if d <= 14) / len(peak_days) * 100

    print(f"  Trades: {len(peak_days)}")
    print(f"  Percentiles: p25={p25:.1f}, p50={p50:.1f}, p75={p75:.1f}")
    print(f"  Peak by day:")
    print(f"    ≤5 days:  {pct_by_5:5.1f}%")
    print(f"    ≤7 days:  {pct_by_7:5.1f}%")
    print(f"    ≤10 days: {pct_by_10:5.1f}%")
    print(f"    ≤14 days: {pct_by_14:5.1f}%")

    # Simple histogram
    hist_bins = [0, 2, 4, 6, 8, 10, 12, 15]
    print(f"\n  Histogram:")
    for i in range(len(hist_bins) - 1):
        count = sum(1 for d in peak_days if hist_bins[i] <= d < hist_bins[i+1])
        pct = count / len(peak_days) * 100
        bar = '█' * int(pct / 2)  # Scale for display
        print(f"    Day {hist_bins[i]:>2}-{hist_bins[i+1]:>2}: {count:3d} ({pct:5.1f}%) {bar}")

# Overall summary
print(f"\n{'='*80}")
print("OVERALL (All Profiles)")
print('='*80)

if len(all_peak_days) > 0:
    p25 = np.percentile(all_peak_days, 25)
    p50 = np.percentile(all_peak_days, 50)
    p75 = np.percentile(all_peak_days, 75)

    pct_by_5 = sum(1 for d in all_peak_days if d <= 5) / len(all_peak_days) * 100
    pct_by_7 = sum(1 for d in all_peak_days if d <= 7) / len(all_peak_days) * 100
    pct_by_10 = sum(1 for d in all_peak_days if d <= 10) / len(all_peak_days) * 100
    pct_by_14 = sum(1 for d in all_peak_days if d <= 14) / len(all_peak_days) * 100

    print(f"\nTotal trades: {len(all_peak_days)}")
    print(f"Median time-to-peak: {p50:.1f} days (p25={p25:.1f}, p75={p75:.1f})")
    print()
    print(f"Winners peaking by:")
    print(f"  ≤5 days:  {pct_by_5:5.1f}%")
    print(f"  ≤7 days:  {pct_by_7:5.1f}%")
    print(f"  ≤10 days: {pct_by_10:5.1f}%")
    print(f"  ≤14 days: {pct_by_14:5.1f}%")

    print(f"\nHistogram (All Profiles):")
    hist_bins = [0, 2, 4, 6, 8, 10, 12, 15]
    for i in range(len(hist_bins) - 1):
        count = sum(1 for d in all_peak_days if hist_bins[i] <= d < hist_bins[i+1])
        pct = count / len(all_peak_days) * 100
        bar = '█' * int(pct / 2)
        print(f"  Day {hist_bins[i]:>2}-{hist_bins[i+1]:>2}: {count:3d} ({pct:5.1f}%) {bar}")

print()
print("=" * 80)
print("KEY INSIGHTS")
print("=" * 80)
print()

if len(all_peak_days) > 0:
    median_peak = np.median(all_peak_days)

    if median_peak < 5:
        print(f"✓ Trades peak FAST (median {median_peak:.0f} days)")
        print("  → Early exits (Day 3-5) likely optimal")
    elif median_peak < 8:
        print(f"✓ Trades peak MODERATE (median {median_peak:.0f} days)")
        print("  → Mid exits (Day 5-7) likely optimal")
    else:
        print(f"⚠️  Trades peak LATE (median {median_peak:.0f} days)")
        print("  → Later exits (Day 10+) may be needed")

    pct_early = sum(1 for d in all_peak_days if d <= 7) / len(all_peak_days) * 100
    if pct_early > 60:
        print(f"\n✓ {pct_early:.0f}% peak by day 7")
        print("  → Day 7 exit captures most peaks")
    elif pct_early > 50:
        print(f"\n✓ {pct_early:.0f}% peak by day 7")
        print("  → Day 7 exit is reasonable")
    else:
        print(f"\n⚠️  Only {pct_early:.0f}% peak by day 7")
        print("  → May need longer holding periods")

print()
