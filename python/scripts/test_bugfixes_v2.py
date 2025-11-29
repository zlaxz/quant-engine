#!/usr/bin/env python3
"""
Quick Test: Do Bug Fixes Solve the Capture Rate Problem?

Tests Exit Engine V1 with bug fixes on existing tracked trades.
"""

import sys
sys.path.append('/Users/zstoc/rotation-engine')

import json
from src.trading.exit_engine_v1 import ExitEngineV1

# Load tracked trades
tracking_file = 'data/backtest_results/full_tracking_results.json'
with open(tracking_file) as f:
    all_trades = json.load(f)

print("=" * 80)
print("EXIT ENGINE V1 - WITH BUG FIXES TEST")
print("=" * 80)
print()

# Initialize exit engine with bug fixes
exit_engine = ExitEngineV1()
exit_engine.reset_tp1_tracking()

# Process all profiles
results_by_profile = {}
total_max_potential = 0
total_captured = 0
total_trades = 0

for profile_id, trades in all_trades.items():
    print(f"\n{profile_id}: {len(trades)} trades")

    profile_results = {
        'trades': 0,
        'max_potential': 0,
        'captured': 0,
        'early_exits': 0  # Exits before day 3
    }

    for trade_data in trades:
        daily_path = trade_data.get('path', [])
        if not daily_path:
            continue

        # Get max potential (peak P&L)
        max_pnl = max(day['mtm_pnl'] for day in daily_path)

        # Apply Exit Engine V1 (with bug fixes!)
        exit_result = exit_engine.apply_to_tracked_trade(profile_id, trade_data)
        captured_pnl = exit_result['exit_pnl']
        exit_day = exit_result['exit_day']
        exit_reason = exit_result['exit_reason']

        # Track early exits
        if exit_day < 3:
            profile_results['early_exits'] += 1

        profile_results['trades'] += 1
        profile_results['max_potential'] += max_pnl
        profile_results['captured'] += captured_pnl

        print(f"  Trade: Peak ${max_pnl:>8,.0f} → Captured ${captured_pnl:>8,.0f} "
              f"(Day {exit_day}, {exit_reason})")

    # Calculate capture rate
    if profile_results['max_potential'] > 0:
        capture_rate = (profile_results['captured'] / profile_results['max_potential']) * 100
    else:
        capture_rate = 0

    profile_results['capture_rate'] = capture_rate

    print(f"  → Capture Rate: {capture_rate:.1f}%")
    if profile_results['early_exits'] > 0:
        print(f"  → Early exits (Day < 3): {profile_results['early_exits']} (BUG FIX TEST)")

    results_by_profile[profile_id] = profile_results

    total_trades += profile_results['trades']
    total_max_potential += profile_results['max_potential']
    total_captured += profile_results['captured']

# Overall results
overall_capture_rate = (total_captured / total_max_potential) * 100 if total_max_potential > 0 else 0

print()
print("=" * 80)
print("SUMMARY")
print("=" * 80)
print(f"Total trades: {total_trades}")
print(f"Max potential: ${total_max_potential:,.0f}")
print(f"Captured: ${total_captured:,.0f}")
print(f"Capture rate: {overall_capture_rate:.1f}%")
print()

# Verdict
print("VERDICT:")
print()
if overall_capture_rate < 2:
    print(f"❌ FAILURE: {overall_capture_rate:.1f}% capture rate")
    print("   Bug fixes didn't solve the problem")
    print("   → Need to RE-DERIVE parameters on clean train period")
elif overall_capture_rate < 10:
    print(f"⚠️  MARGINAL: {overall_capture_rate:.1f}% capture rate")
    print("   Bug fixes helped but not enough")
    print("   → Should re-derive parameters")
elif overall_capture_rate < 20:
    print(f"✓ ACCEPTABLE: {overall_capture_rate:.1f}% capture rate")
    print("   Bug fixes significantly improved performance")
    print("   → Proceed with train/val/test methodology")
else:
    print(f"✓✓ EXCELLENT: {overall_capture_rate:.1f}% capture rate")
    print("   Bug fixes solved the problem!")
    print("   → Proceed to validation testing")

print()
print("NOTE: This is on a VERY SMALL sample (" + str(total_trades) + " trades)")
print("Need to run on full dataset to get reliable results")
