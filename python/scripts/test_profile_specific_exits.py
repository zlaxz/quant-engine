#!/usr/bin/env python3
"""
TEST PROFILE-SPECIFIC EXIT DAYS

Based on time-to-peak analysis:
- SDG: Day 5 (median peak 4)
- SKEW: Day 5 (median peak 4)
- LDG: Day 7 (median peak 6)
- VOV: Day 7 (median peak 5)
- VANNA: Day 10 (median peak 9.5)
- CHARM: Day 10 (median peak 10)

Compare to:
- Uniform Day 7 (current best)
- Uniform Day 14 (original baseline)
"""

import sys
sys.path.append('/Users/zstoc/rotation-engine')

import json
from pathlib import Path

# Load current results
results_file = 'data/backtest_results/full_2020-2024/results.json'
with open(results_file) as f:
    all_results = json.load(f)

print("=" * 80)
print("PROFILE-SPECIFIC EXIT DAYS TEST")
print("=" * 80)
print()

# Profile-specific exit days (from time-to-peak analysis)
PROFILE_EXIT_DAYS = {
    'Profile_1_LDG': 7,
    'Profile_2_SDG': 5,
    'Profile_3_CHARM': 10,
    'Profile_4_VANNA': 10,
    'Profile_5_SKEW': 5,
    'Profile_6_VOV': 7
}

# Test configurations
configs = {
    'Uniform Day 14': lambda p: 14,
    'Uniform Day 7': lambda p: 7,
    'Profile-Specific': lambda p: PROFILE_EXIT_DAYS.get(p, 7)
}

results_by_config = {}

for config_name, get_exit_day in configs.items():
    print(f"\n{config_name}:")
    print("-" * 60)

    config_results = {}
    total_pnl = 0
    total_peak = 0
    total_trades = 0
    total_wins = 0

    for profile_id, data in all_results.items():
        exit_day = get_exit_day(profile_id)
        trades = data['trades']

        profile_pnl = 0
        profile_wins = 0
        profile_peak = 0

        for trade in trades:
            path = trade.get('path', [])
            if not path:
                continue

            # Find peak (up to exit)
            exit_idx = min(exit_day, len(path) - 1)
            exit_pnl = path[exit_idx]['mtm_pnl']
            peak_pnl = max(day['mtm_pnl'] for day in path[:exit_idx+1])

            profile_pnl += exit_pnl
            profile_peak += peak_pnl
            if exit_pnl > 0:
                profile_wins += 1

        total_pnl += profile_pnl
        total_peak += profile_peak
        total_trades += len(trades)
        total_wins += profile_wins

        capture_rate = (profile_pnl / profile_peak * 100) if profile_peak != 0 else 0

        print(f"  {profile_id:20s} (Day {exit_day:2d}): ${profile_pnl:>8,.0f}  "
              f"({profile_wins}/{len(trades)} wins, {capture_rate:>5.1f}% capture)")

        config_results[profile_id] = {
            'pnl': profile_pnl,
            'wins': profile_wins,
            'trades': len(trades),
            'peak': profile_peak
        }

    # Overall
    overall_capture = (total_pnl / total_peak * 100) if total_peak != 0 else 0
    print(f"\n  {'TOTAL':20s}          : ${total_pnl:>8,.0f}  "
          f"({total_wins}/{total_trades} wins, {overall_capture:>5.1f}% capture)")

    results_by_config[config_name] = {
        'total_pnl': total_pnl,
        'total_wins': total_wins,
        'total_trades': total_trades,
        'capture_rate': overall_capture,
        'profiles': config_results
    }

# Comparison
print()
print("=" * 80)
print("COMPARISON")
print("=" * 80)
print()

baseline_day14 = results_by_config['Uniform Day 14']
baseline_day7 = results_by_config['Uniform Day 7']
profile_specific = results_by_config['Profile-Specific']

print(f"Uniform Day 14:      ${baseline_day14['total_pnl']:>10,.0f} ({baseline_day14['capture_rate']:>5.1f}% capture)")
print(f"Uniform Day 7:       ${baseline_day7['total_pnl']:>10,.0f} ({baseline_day7['capture_rate']:>5.1f}% capture)")
print(f"Profile-Specific:    ${profile_specific['total_pnl']:>10,.0f} ({profile_specific['capture_rate']:>5.1f}% capture)")
print()
print(f"Day 7 vs Day 14:     ${baseline_day7['total_pnl'] - baseline_day14['total_pnl']:>10,.0f} improvement")
print(f"Profile vs Day 7:    ${profile_specific['total_pnl'] - baseline_day7['total_pnl']:>10,.0f} improvement")
print(f"Profile vs Day 14:   ${profile_specific['total_pnl'] - baseline_day14['total_pnl']:>10,.0f} improvement")
print()

# Verdict
improvement_vs_day7 = profile_specific['total_pnl'] - baseline_day7['total_pnl']

if improvement_vs_day7 > 5000:
    print("✓✓ SIGNIFICANT IMPROVEMENT - Implement profile-specific exits")
elif improvement_vs_day7 > 2000:
    print("✓ MODERATE IMPROVEMENT - Consider profile-specific exits")
elif improvement_vs_day7 > -2000:
    print("≈ SIMILAR - Either works, profile-specific is data-informed")
else:
    print("✗ WORSE - Stick with uniform Day 7")

print()
