#!/usr/bin/env python3
"""
Compare SDG Filter Impact

Compare results before/after implementing:
SDG HARD FILTER: slope_MA20 < 0 (downtrend context required)

Reports:
1. SDG trade count change
2. SDG peakless rate change
3. Average winner/loser size change
4. Peak day distribution change
5. Any good trades removed
6. Impact on other profiles
7. Net system impact
"""

import sys
sys.path.append('/Users/zstoc/rotation-engine')

import json
from pathlib import Path

# Load BEFORE results (no filter)
before_file = 'data/backtest_results/full_2020-2024/results.json'
if not Path(before_file).exists():
    print(f"ERROR: Before results not found: {before_file}")
    sys.exit(1)

with open(before_file) as f:
    before_results = json.load(f)

# AFTER results will be at same location (overwritten)
# So we need to save before results first or compare from log

print("=" * 80)
print("SDG STRUCTURAL FILTER IMPACT ANALYSIS")
print("=" * 80)
print()
print("Filter: SDG requires slope_MA20 < 0 (downtrend context)")
print()

# Extract SDG results BEFORE
sdg_before = before_results['Profile_2_SDG']
sdg_trades_before = sdg_before['trades']

print(f"SDG BEFORE Filter:")
print(f"  Total trades: {len(sdg_trades_before)}")

# Categorize
peakless_before = []
good_before = []

for trade in sdg_trades_before:
    path = trade.get('path', [])
    if not path:
        continue

    peak_pnl = max(day.get('mtm_pnl', -999999) for day in path)

    if peak_pnl <= 20:
        peakless_before.append(trade)
    else:
        good_before.append(trade)

print(f"  Peakless (peak ≤ $20): {len(peakless_before)} ({len(peakless_before)/len(sdg_trades_before)*100:.1f}%)")
print(f"  Good (peak > $20): {len(good_before)} ({len(good_before)/len(sdg_trades_before)*100:.1f}%)")

# Show which trades would be filtered
print(f"\n  Trades that would be FILTERED by slope_MA20 < 0:")
filtered_count = 0
filtered_good_count = 0

for trade in sdg_trades_before:
    path = trade.get('path', [])
    if not path:
        continue

    entry_cond = path[0].get('market_conditions', {})
    slope_ma20 = entry_cond.get('slope_MA20', 0)

    if slope_ma20 >= 0:  # Would be filtered
        filtered_count += 1

        # Check if this was a good trade
        peak_pnl = max(day.get('mtm_pnl', -999999) for day in path)
        if peak_pnl > 20:
            filtered_good_count += 1
            print(f"    {trade['entry']['entry_date']}: slope={slope_ma20:.4f}, peak=${peak_pnl:.0f} (GOOD TRADE REMOVED)")

print(f"\n  Total filtered: {filtered_count}")
print(f"  Good trades removed: {filtered_good_count}")
print(f"  Peakless removed: {filtered_count - filtered_good_count}")

print()
print("Waiting for AFTER results from backtest...")
print("Run this script again after backtest completes")
