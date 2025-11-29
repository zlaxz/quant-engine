#!/usr/bin/env python3
"""
EXIT SWEEP - PNL-BASED RULE TESTING (FIXED VERSION)

Test simple exit rules on existing trades:
- Family A: Fixed hold times (2, 3, 5, 7, 10 days)
- Family B: Trailing stops (activation + trail size)

Compare to BASELINE (current 14-day exits)

CHANGES FROM ORIGINAL:
1. FIXED BUG-001: peak_pnl now uses only bars UP TO exit point (no look-ahead bias)
2. FIXED BUG-002: avg_peak_pct now includes all trades (peak_pnl != 0, not just > 0)
3. FIXED BUG-003: delta_win_rate properly calculates baseline first
4. FIXED BUG-004: Added explicit comment for trailing stop magic number
5. FIXED BUG-005: Added explicit path length capping logic
"""

import sys
sys.path.append('/Users/zstoc/rotation-engine')

import json
import numpy as np
import pandas as pd
from pathlib import Path

# Load current results (baseline)
results_file = 'data/backtest_results/full_2020-2024/results.json'
with open(results_file) as f:
    all_results = json.load(f)

print("=" * 80)
print("EXIT SWEEP - TESTING SIMPLE EXIT RULES (FIXED VERSION)")
print("=" * 80)
print()
print("Baseline: Current exits (14-day time stop)")
print("Testing: Fixed hold times + Trailing stops")
print()

# BASELINE METRICS
baseline_total_pnl = 0
baseline_total_peak = 0
baseline_trades = 0
baseline_win_count = 0

# FIX BUG-003: Calculate baseline first
print("Calculating baseline (14-day exit)...")
for profile_id, data in all_results.items():
    for trade in data['trades']:
        path = trade.get('path', [])
        if not path:
            continue

        # BUG-001 FIX: Only use bars up to exit point (no look-ahead!)
        baseline_day = min(14, len(path) - 1)
        baseline_peak = max(day['mtm_pnl'] for day in path[:baseline_day+1])
        baseline_exit_pnl = path[baseline_day]['mtm_pnl']

        baseline_total_pnl += baseline_exit_pnl
        baseline_total_peak += baseline_peak
        baseline_trades += 1

        if baseline_exit_pnl > 0:
            baseline_win_count += 1

baseline_win_rate = baseline_win_count / baseline_trades * 100 if baseline_trades > 0 else 0

print("BASELINE (Current Exits at Day 14):")
print(f"  Total P&L: ${baseline_total_pnl:,.0f}")
print(f"  Peak Potential: ${baseline_total_peak:,.0f}")
print(f"  Capture Rate: {baseline_total_pnl/baseline_total_peak*100:.1f}%" if baseline_total_peak != 0 else "  Capture Rate: N/A")
print(f"  Win Rate: {baseline_win_rate:.1f}%")
print(f"  Total Trades: {baseline_trades}")
print()

# FAMILY A: FIXED HOLD TIMES
print("=" * 80)
print("FAMILY A: FIXED HOLD TIMES")
print("=" * 80)
print()

fixed_day_results = []

for exit_day in [2, 3, 5, 7, 10]:
    total_pnl = 0
    total_peak = 0
    win_count = 0
    total_count = 0
    total_days_held = 0
    peak_pct_captured = []

    # Apply to all trades
    for profile_id, data in all_results.items():
        for trade in data['trades']:
            path = trade.get('path', [])
            if not path:
                continue

            # BUG-001 FIX: Only use bars up to exit point (no look-ahead!)
            # BUG-005 FIX: Explicitly cap exit_day to path length
            exit_idx = min(exit_day, len(path) - 1)

            # Only calculate peak from bars UP TO exit point
            peak_pnl = max(day['mtm_pnl'] for day in path[:exit_idx+1])

            exit_pnl = path[exit_idx]['mtm_pnl']

            total_pnl += exit_pnl
            total_peak += peak_pnl
            total_count += 1
            total_days_held += path[exit_idx]['day']

            if exit_pnl > 0:
                win_count += 1

            # BUG-002 FIX: Include ALL trades with non-zero peak (not just positive)
            if peak_pnl != 0:  # Changed from > 0 to != 0
                pct_captured = (exit_pnl / peak_pnl) * 100
                peak_pct_captured.append(pct_captured)

    avg_pnl = total_pnl / total_count if total_count > 0 else 0
    win_rate = win_count / total_count * 100 if total_count > 0 else 0
    avg_days = total_days_held / total_count if total_count > 0 else 0
    capture_rate = total_pnl / total_peak * 100 if total_peak > 0 else 0
    avg_peak_pct = np.mean(peak_pct_captured) if peak_pct_captured else 0

    # BUG-003 FIX: Now correctly uses baseline_win_rate calculated above
    delta_win_rate = win_rate - baseline_win_rate
    delta_pnl = total_pnl - baseline_total_pnl

    fixed_day_results.append({
        'rule': f'Exit Day {exit_day}',
        'total_pnl': total_pnl,
        'avg_pnl': avg_pnl,
        'win_rate': win_rate,
        'avg_days': avg_days,
        'capture_rate': capture_rate,
        'avg_peak_pct': avg_peak_pct,
        'delta_pnl': delta_pnl,
        'delta_win_rate': delta_win_rate
    })

# Display Family A results
print(f"{'Rule':<15} {'Total P&L':>12} {'Avg P&L':>10} {'Win Rate':>10} {'Δ WR':>8} {'Avg Days':>10} {'Capture %':>10} {'Δ from Base':>12}")
print("-" * 110)

for result in fixed_day_results:
    print(f"{result['rule']:<15} ${result['total_pnl']:>11,.0f} ${result['avg_pnl']:>9,.0f} "
          f"{result['win_rate']:>9.1f}% {result['delta_win_rate']:>7.1f}% {result['avg_days']:>9.1f} "
          f"{result['capture_rate']:>9.1f}% ${result['delta_pnl']:>11,.0f}")

print(f"{'Baseline':<15} ${baseline_total_pnl:>11,.0f} {'':>10} {baseline_win_rate:>9.1f}% {'0.0':>8}% {'14.0':>10} "
      f"{baseline_total_pnl/baseline_total_peak*100:>9.1f}% {'$0':>12}")

# FAMILY B: TRAILING STOPS
print()
print("=" * 80)
print("FAMILY B: TRAILING STOPS")
print("=" * 80)
print()

trailing_results = []

for activation_k in [150, 300, 500]:
    for trail_d in [100, 200, 300]:

        total_pnl = 0
        total_peak = 0
        total_count = 0
        win_count = 0
        total_days_held = 0
        peak_pct_captured = []

        for profile_id, data in all_results.items():
            for trade in data['trades']:
                path = trade.get('path', [])
                if not path:
                    continue

                # Trailing stop logic
                activated = False
                # BUG-004 FIXED: Explicit comment on magic number
                # Initialize running_peak to extreme value to ensure first activation bar
                # becomes the initial peak (all real P&Ls will exceed -999999)
                running_peak = -999999
                exit_idx = len(path) - 1  # Default: last day

                for idx, day in enumerate(path):
                    pnl = day['mtm_pnl']

                    # Activation
                    if pnl >= activation_k:
                        activated = True

                    if activated:
                        running_peak = max(running_peak, pnl)

                        # Trail stop triggered?
                        if pnl <= running_peak - trail_d:
                            exit_idx = idx
                            break

                # BUG-001 FIX: Only calculate peak up to exit point (no look-ahead!)
                peak_pnl = max(day['mtm_pnl'] for day in path[:exit_idx+1])
                exit_pnl = path[exit_idx]['mtm_pnl']

                total_pnl += exit_pnl
                total_peak += peak_pnl
                total_count += 1
                total_days_held += path[exit_idx]['day']

                if exit_pnl > 0:
                    win_count += 1

                # BUG-002 FIX: Include ALL trades with non-zero peak
                if peak_pnl != 0:  # Changed from > 0 to != 0
                    pct_captured = (exit_pnl / peak_pnl) * 100
                    peak_pct_captured.append(pct_captured)

        avg_pnl = total_pnl / total_count if total_count > 0 else 0
        win_rate = win_count / total_count * 100 if total_count > 0 else 0
        avg_days = total_days_held / total_count if total_count > 0 else 0
        capture_rate = total_pnl / total_peak * 100 if total_peak > 0 else 0
        avg_peak_pct = np.mean(peak_pct_captured) if peak_pct_captured else 0

        # BUG-003 FIX: Now correctly uses baseline_win_rate calculated above
        delta_win_rate = win_rate - baseline_win_rate
        delta_pnl = total_pnl - baseline_total_pnl

        trailing_results.append({
            'rule': f'K={activation_k} D={trail_d}',
            'total_pnl': total_pnl,
            'avg_pnl': avg_pnl,
            'win_rate': win_rate,
            'avg_days': avg_days,
            'capture_rate': capture_rate,
            'avg_peak_pct': avg_peak_pct,
            'delta_pnl': delta_pnl,
            'delta_win_rate': delta_win_rate
        })

# Display Family B results
print(f"{'Rule':<15} {'Total P&L':>12} {'Avg P&L':>10} {'Win Rate':>10} {'Δ WR':>8} {'Avg Days':>10} {'Capture %':>10} {'Δ from Base':>12}")
print("-" * 110)

for result in trailing_results:
    print(f"{result['rule']:<15} ${result['total_pnl']:>11,.0f} ${result['avg_pnl']:>9,.0f} "
          f"{result['win_rate']:>9.1f}% {result['delta_win_rate']:>7.1f}% {result['avg_days']:>9.1f} "
          f"{result['capture_rate']:>9.1f}% ${result['delta_pnl']:>11,.0f}")

print(f"{'Baseline':<15} ${baseline_total_pnl:>11,.0f} {'':>10} {baseline_win_rate:>9.1f}% {'0.0':>8}% {'14.0':>10} "
      f"{baseline_total_pnl/baseline_total_peak*100:>9.1f}% {'$0':>12}")

# FAMILY C: PROFILE-SPECIFIC TIME ENVELOPES
print()
print("=" * 80)
print("FAMILY C: PROFILE-SPECIFIC TIME ENVELOPES (p25/p75 from time-to-peak)")
print("=" * 80)
print()

# Load envelope configuration
PROFILE_ENVELOPES = {
    "SDG":   {"min_hold": 2, "max_hold": 7},
    "SKEW":  {"min_hold": 1, "max_hold": 9},
    "LDG":   {"min_hold": 2, "max_hold": 10},
    "VOV":   {"min_hold": 1, "max_hold": 12},
    "VANNA": {"min_hold": 5, "max_hold": 13},
    "CHARM": {"min_hold": 6, "max_hold": 14},
}

# RESEARCH VERSION: Find optimal exit within window (look-ahead bias)
print("RESEARCH VERSION (Look-Ahead for Theoretical Max):")
print("Profile envelopes (min/max hold days):")
for prof, env in PROFILE_ENVELOPES.items():
    print(f"  {prof}: {env['min_hold']}-{env['max_hold']} days")
print()

envelope_total_pnl = 0
envelope_total_peak = 0
envelope_win_count = 0
envelope_total_count = 0
envelope_total_days_held = 0
envelope_peak_pct_captured = []

for profile_id, data in all_results.items():
    # BUG-006 FIX: Extract profile name from profile_id key
    # "Profile_1_LDG" -> "LDG"
    profile_name = profile_id.split('_')[-1] if '_' in profile_id else 'UNKNOWN'
    env = PROFILE_ENVELOPES.get(profile_name, {"min_hold": 2, "max_hold": 10})  # Default fallback

    for trade in data['trades']:
        path = trade.get('path', [])
        if not path:
            continue

        # Enforce time envelope: exit within [min_hold, max_hold] window
        min_hold = env['min_hold']
        max_hold = env['max_hold']

        path_len = len(path) - 1

        # BUG-007 FIX: Find peak within envelope window, not just exit at max_hold
        if path_len < min_hold:
            # Path too short to enforce min_hold, exit at end
            exit_idx = path_len
        else:
            # Find peak P&L within [min_hold, max_hold] window
            min_idx = min_hold
            max_idx = min(max_hold, path_len)

            # Search for best exit point within envelope
            best_idx = min_idx
            best_pnl = path[min_idx]['mtm_pnl']

            for idx in range(min_idx, max_idx + 1):
                if path[idx]['mtm_pnl'] > best_pnl:
                    best_pnl = path[idx]['mtm_pnl']
                    best_idx = idx

            exit_idx = best_idx

        # No look-ahead: peak only up to exit point
        peak_pnl = max(day['mtm_pnl'] for day in path[:exit_idx+1])
        exit_pnl = path[exit_idx]['mtm_pnl']

        envelope_total_pnl += exit_pnl
        envelope_total_peak += peak_pnl
        envelope_total_count += 1
        envelope_total_days_held += path[exit_idx]['day']

        if exit_pnl > 0:
            envelope_win_count += 1

        if peak_pnl != 0:
            pct_captured = (exit_pnl / peak_pnl) * 100
            envelope_peak_pct_captured.append(pct_captured)

envelope_avg_pnl = envelope_total_pnl / envelope_total_count if envelope_total_count > 0 else 0
envelope_win_rate = envelope_win_count / envelope_total_count * 100 if envelope_total_count > 0 else 0
envelope_avg_days = envelope_total_days_held / envelope_total_count if envelope_total_count > 0 else 0
envelope_capture_rate = envelope_total_pnl / envelope_total_peak * 100 if envelope_total_peak > 0 else 0
envelope_avg_peak_pct = np.mean(envelope_peak_pct_captured) if envelope_peak_pct_captured else 0
envelope_delta_win_rate = envelope_win_rate - baseline_win_rate
envelope_delta_pnl = envelope_total_pnl - baseline_total_pnl

envelope_result = {
    'rule': 'Profile Envelopes',
    'total_pnl': envelope_total_pnl,
    'avg_pnl': envelope_avg_pnl,
    'win_rate': envelope_win_rate,
    'avg_days': envelope_avg_days,
    'capture_rate': envelope_capture_rate,
    'avg_peak_pct': envelope_avg_peak_pct,
    'delta_pnl': envelope_delta_pnl,
    'delta_win_rate': envelope_delta_win_rate
}

# Display Family C results
print(f"{'Rule':<15} {'Total P&L':>12} {'Avg P&L':>10} {'Win Rate':>10} {'Δ WR':>8} {'Avg Days':>10} {'Capture %':>10} {'Δ from Base':>12}")
print("-" * 110)
print(f"{envelope_result['rule']:<15} ${envelope_result['total_pnl']:>11,.0f} ${envelope_result['avg_pnl']:>9,.0f} "
      f"{envelope_result['win_rate']:>9.1f}% {envelope_result['delta_win_rate']:>7.1f}% {envelope_result['avg_days']:>9.1f} "
      f"{envelope_result['capture_rate']:>9.1f}% ${envelope_result['delta_pnl']:>11,.0f}")
print(f"{'Baseline':<15} ${baseline_total_pnl:>11,.0f} {'':>10} {baseline_win_rate:>9.1f}% {'0.0':>8}% {'14.0':>10} "
      f"{baseline_total_pnl/baseline_total_peak*100:>9.1f}% {'$0':>12}")

# FAMILY D: LEGITIMATE ENVELOPE (Boundary Touch - No Look-Ahead)
print()
print("=" * 80)
print("FAMILY D: LEGITIMATE ENVELOPE (Boundary-Touch Exit)")
print("=" * 80)
print()
print("DEPLOYABLE VERSION:")
print("- Profit target: Exit when P&L reaches +$500 (profit boundary)")
print("- Stop loss: Exit when P&L reaches -$200 (loss boundary)")
print("- Time stop: Exit at max_hold if no boundary hit")
print("- All boundaries defined at entry (no look-ahead)")
print()

# Profit/loss boundaries (could be profile-specific in future)
PROFIT_TARGET = 500  # Exit if P&L >= $500
STOP_LOSS = -200     # Exit if P&L <= -$200

legit_total_pnl = 0
legit_total_peak = 0
legit_win_count = 0
legit_total_count = 0
legit_total_days_held = 0
legit_peak_pct_captured = []
exit_reasons = {'profit_target': 0, 'stop_loss': 0, 'max_hold': 0}

for profile_id, data in all_results.items():
    profile_name = profile_id.split('_')[-1] if '_' in profile_id else 'UNKNOWN'
    env = PROFILE_ENVELOPES.get(profile_name, {"min_hold": 2, "max_hold": 10})

    for trade in data['trades']:
        path = trade.get('path', [])
        if not path:
            continue

        min_hold = env['min_hold']
        max_hold = env['max_hold']
        path_len = len(path) - 1

        # Default exit: max_hold or path end
        exit_idx = min(max_hold, path_len)
        exit_reason = 'max_hold'

        # Enforce min hold period first
        if path_len < min_hold:
            exit_idx = path_len
            exit_reason = 'max_hold'
        else:
            # Check for boundary touch starting at min_hold
            for idx in range(min_hold, min(max_hold, path_len) + 1):
                current_pnl = path[idx]['mtm_pnl']

                # Check profit target
                if current_pnl >= PROFIT_TARGET:
                    exit_idx = idx
                    exit_reason = 'profit_target'
                    break

                # Check stop loss
                elif current_pnl <= STOP_LOSS:
                    exit_idx = idx
                    exit_reason = 'stop_loss'
                    break

        # Record exit reason
        exit_reasons[exit_reason] += 1

        # Calculate P&L (no look-ahead: peak only up to exit)
        peak_pnl = max(day['mtm_pnl'] for day in path[:exit_idx+1])
        exit_pnl = path[exit_idx]['mtm_pnl']

        legit_total_pnl += exit_pnl
        legit_total_peak += peak_pnl
        legit_total_count += 1
        legit_total_days_held += path[exit_idx]['day']

        if exit_pnl > 0:
            legit_win_count += 1

        if peak_pnl != 0:
            pct_captured = (exit_pnl / peak_pnl) * 100
            legit_peak_pct_captured.append(pct_captured)

legit_avg_pnl = legit_total_pnl / legit_total_count if legit_total_count > 0 else 0
legit_win_rate = legit_win_count / legit_total_count * 100 if legit_total_count > 0 else 0
legit_avg_days = legit_total_days_held / legit_total_count if legit_total_count > 0 else 0
legit_capture_rate = legit_total_pnl / legit_total_peak * 100 if legit_total_peak > 0 else 0
legit_avg_peak_pct = np.mean(legit_peak_pct_captured) if legit_peak_pct_captured else 0
legit_delta_win_rate = legit_win_rate - baseline_win_rate
legit_delta_pnl = legit_total_pnl - baseline_total_pnl

legit_envelope_result = {
    'rule': 'Legit Envelope',
    'total_pnl': legit_total_pnl,
    'avg_pnl': legit_avg_pnl,
    'win_rate': legit_win_rate,
    'avg_days': legit_avg_days,
    'capture_rate': legit_capture_rate,
    'avg_peak_pct': legit_avg_peak_pct,
    'delta_pnl': legit_delta_pnl,
    'delta_win_rate': legit_delta_win_rate
}

# Display Family D results
print("Exit Reasons:")
for reason, count in exit_reasons.items():
    pct = count / legit_total_count * 100 if legit_total_count > 0 else 0
    print(f"  {reason}: {count} ({pct:.1f}%)")
print()

print(f"{'Rule':<15} {'Total P&L':>12} {'Avg P&L':>10} {'Win Rate':>10} {'Δ WR':>8} {'Avg Days':>10} {'Capture %':>10} {'Δ from Base':>12}")
print("-" * 110)
print(f"{legit_envelope_result['rule']:<15} ${legit_envelope_result['total_pnl']:>11,.0f} ${legit_envelope_result['avg_pnl']:>9,.0f} "
      f"{legit_envelope_result['win_rate']:>9.1f}% {legit_envelope_result['delta_win_rate']:>7.1f}% {legit_envelope_result['avg_days']:>9.1f} "
      f"{legit_envelope_result['capture_rate']:>9.1f}% ${legit_envelope_result['delta_pnl']:>11,.0f}")
print(f"{'Baseline':<15} ${baseline_total_pnl:>11,.0f} {'':>10} {baseline_win_rate:>9.1f}% {'0.0':>8}% {'14.0':>10} "
      f"{baseline_total_pnl/baseline_total_peak*100:>9.1f}% {'$0':>12}")

print()
print("=" * 80)
print("SUMMARY")
print("=" * 80)
print()

# Find best rule (include both envelope versions)
all_rules = fixed_day_results + trailing_results + [envelope_result, legit_envelope_result]
best_rule = max(all_rules, key=lambda r: r['total_pnl'])

# Best deployable rule (exclude research envelope)
deployable_rules = fixed_day_results + trailing_results + [legit_envelope_result]
best_deployable = max(deployable_rules, key=lambda r: r['total_pnl'])

print(f"Best performing rule (overall): {best_rule['rule']}")
print(f"  Total P&L: ${best_rule['total_pnl']:,.0f} (vs ${baseline_total_pnl:,.0f} baseline)")
print(f"  Improvement: ${best_rule['delta_pnl']:,.0f}")
print(f"  Win Rate: {best_rule['win_rate']:.1f}% (vs {baseline_win_rate:.1f}% baseline)")
print(f"  Capture rate: {best_rule['capture_rate']:.1f}%")
print()

print(f"Best DEPLOYABLE rule (no look-ahead): {best_deployable['rule']}")
print(f"  Total P&L: ${best_deployable['total_pnl']:,.0f} (vs ${baseline_total_pnl:,.0f} baseline)")
print(f"  Improvement: ${best_deployable['delta_pnl']:,.0f}")
print(f"  Win Rate: {best_deployable['win_rate']:.1f}% (vs {baseline_win_rate:.1f}% baseline)")
print(f"  Capture rate: {best_deployable['capture_rate']:.1f}%")
print()

if best_rule['delta_pnl'] > 10000:
    print("✓ Significant improvement found - consider implementing this exit rule")
elif best_rule['delta_pnl'] > 5000:
    print("✓ Moderate improvement - consider implementing")
else:
    print("⚠️  Marginal improvement - current exits may be near-optimal")

print()
print("=" * 80)
print("IMPORTANT NOTES")
print("=" * 80)
print()
print("FIXES APPLIED IN THIS VERSION:")
print("1. Look-ahead bias: peak_pnl now calculated from bars UP TO exit point")
print("2. Survivor bias: avg_peak_pct now includes all trades (peak != 0)")
print("3. Win rate delta: Now properly calculates baseline first")
print("4. Code quality: Trailing stop initialization documented")
print("5. Edge cases: Path length explicitly capped")
print("6. BUG-006 FIX: Profile name extraction from profile_id key")
print("7. BUG-007 FIX: Find peak within envelope window (RESEARCH ONLY - look-ahead)")
print()
print("METRICS EXPLANATION:")
print("- Capture Rate: % of peak P&L captured by exiting at this rule")
print("- Avg Peak Pct: Mean % of peak captured across all trades")
print("- Δ WR: Change in win rate compared to baseline")
print("- Δ from Base: Absolute P&L difference vs baseline")
print()
print("NOTE: Envelope exit uses look-ahead bias for RESEARCH purposes only.")
print("      Shows theoretical maximum if perfect timing within profile windows.")
print()

# Save results to file
output = {
    'baseline': {
        'total_pnl': baseline_total_pnl,
        'peak_potential': baseline_total_peak,
        'capture_rate': baseline_total_pnl/baseline_total_peak*100 if baseline_total_peak != 0 else 0,
        'win_rate': baseline_win_rate,
        'total_trades': baseline_trades,
    },
    'fixed_hold_times': fixed_day_results,
    'trailing_stops': trailing_results,
    'envelope_research': envelope_result,  # Research only - look-ahead bias
    'envelope_legitimate': legit_envelope_result,  # Deployable - no look-ahead
    'exit_reasons': exit_reasons,
    'best_rule_overall': best_rule,
    'best_deployable': best_deployable,
}

import json
from datetime import datetime
output_dir = Path('reports')
output_dir.mkdir(exist_ok=True)
output_file = output_dir / f'exit_sweep_results_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'

with open(output_file, 'w') as f:
    json.dump(output, f, indent=2)

print(f"Results saved to: {output_file}")
print()
