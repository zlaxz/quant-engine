#!/usr/bin/env python3
"""
COMPARE DAY 7 vs DAY 7 + INTRADAY DECAY OVERLAY

Test if intraday decay signals improve Day 7 exits by:
- Cutting losses early (exit failing trades before Day 7)
- Preserving winners (don't exit before peak)

Harm-Awareness Test:
Accept overlay ONLY if: early_failures_saved >= winners_cut_early (each year)

Uses REAL yfinance minute bar data for SPY.
"""

import sys
sys.path.append('/Users/zstoc/rotation-engine')

import json
import numpy as np
import pandas as pd
from pathlib import Path
from collections import defaultdict
from exits.overlay_decay_intraday import IntradayDecayOverlay, PROFILE_TIMEFRAMES

# Load baseline results
results_file = 'data/backtest_results/full_2020-2024/results.json'
with open(results_file) as f:
    all_results = json.load(f)

print("=" * 80)
print("COMPARISON: DAY 7 vs DAY 7 + INTRADAY DECAY OVERLAY")
print("=" * 80)
print()
print("Using REAL yfinance minute bar data for overlay")
print()

# Initialize overlay
overlay_2h = IntradayDecayOverlay(timeframe='2h', lookback_bars=6, min_hold_days=2)
overlay_4h = IntradayDecayOverlay(timeframe='4h', lookback_bars=6, min_hold_days=2)

# Results tracking
v0_results = {'total_pnl': 0, 'trades': 0, 'wins': 0, 'total_days': 0, 'peak_captured': []}
v1_results = {'total_pnl': 0, 'trades': 0, 'wins': 0, 'total_days': 0, 'peak_captured': []}

# Harm tracking
winners_cut_early = []
early_failures_saved = []

# By profile
profile_v0 = defaultdict(lambda: {'pnl': 0, 'trades': 0, 'wins': 0})
profile_v1 = defaultdict(lambda: {'pnl': 0, 'trades': 0, 'wins': 0})

# By year
year_v0 = defaultdict(lambda: {'pnl': 0, 'trades': 0, 'wins': 0})
year_v1 = defaultdict(lambda: {'pnl': 0, 'trades': 0, 'wins': 0})

print("Processing trades...")

trade_count = 0
skip_count = 0

for profile_id, data in all_results.items():
    profile_name = profile_id.split('_')[-1] if '_' in profile_id else 'UNKNOWN'

    for trade in data['trades']:
        trade_count += 1

        path = trade.get('path', [])
        if not path or len(path) == 0:
            skip_count += 1
            continue

        entry_info = trade.get('entry')
        if not entry_info:
            skip_count += 1
            continue

        entry_date = entry_info.get('entry_date')
        if not entry_date:
            skip_count += 1
            continue

        year = str(entry_date)[:4]

        # V0: Day 7 exit (baseline)
        v0_exit_idx = min(7, len(path) - 1)
        v0_exit_pnl = path[v0_exit_idx]['mtm_pnl']
        v0_peak_to_exit = max(day['mtm_pnl'] for day in path[:v0_exit_idx+1])

        v0_results['total_pnl'] += v0_exit_pnl
        v0_results['trades'] += 1
        v0_results['total_days'] += v0_exit_idx
        if v0_exit_pnl > 0:
            v0_results['wins'] += 1
        if abs(v0_peak_to_exit) > 0.01:
            v0_results['peak_captured'].append((v0_exit_pnl / abs(v0_peak_to_exit)) * 100)

        # V1: Day 7 + Overlay
        if profile_name in PROFILE_TIMEFRAMES:
            # Apply overlay using real intraday data
            overlay = overlay_2h if PROFILE_TIMEFRAMES[profile_name] == '2h' else overlay_4h

            try:
                v1_exit_day, v1_exit_reason = overlay.check_exit_trigger(
                    entry_date=entry_date,
                    profile=profile_name,
                    symbol='SPY',
                    max_days=7
                )

                # Map exit_day to path index
                v1_exit_idx = min(v1_exit_day, len(path) - 1)

            except Exception as e:
                # Overlay failed, fallback to Day 7
                v1_exit_idx = v0_exit_idx
                v1_exit_reason = 'day7_time_stop'
        else:
            # No overlay for this profile
            v1_exit_idx = v0_exit_idx
            v1_exit_reason = 'day7_time_stop'

        # V1 P&L and tracking
        v1_exit_pnl = path[v1_exit_idx]['mtm_pnl']
        v1_peak_to_exit = max(day['mtm_pnl'] for day in path[:v1_exit_idx+1])

        v1_results['total_pnl'] += v1_exit_pnl
        v1_results['trades'] += 1
        v1_results['total_days'] += v1_exit_idx
        if v1_exit_pnl > 0:
            v1_results['wins'] += 1
        if abs(v1_peak_to_exit) > 0.01:
            v1_results['peak_captured'].append((v1_exit_pnl / abs(v1_peak_to_exit)) * 100)

        # Profile tracking
        profile_v0[profile_name]['pnl'] += v0_exit_pnl
        profile_v0[profile_name]['trades'] += 1
        if v0_exit_pnl > 0:
            profile_v0[profile_name]['wins'] += 1

        profile_v1[profile_name]['pnl'] += v1_exit_pnl
        profile_v1[profile_name]['trades'] += 1
        if v1_exit_pnl > 0:
            profile_v1[profile_name]['wins'] += 1

        # Year tracking
        year_v0[year]['pnl'] += v0_exit_pnl
        year_v0[year]['trades'] += 1
        if v0_exit_pnl > 0:
            year_v0[year]['wins'] += 1

        year_v1[year]['pnl'] += v1_exit_pnl
        year_v1[year]['trades'] += 1
        if v1_exit_pnl > 0:
            year_v1[year]['wins'] += 1

        # Harm analysis: ONLY if overlay exited earlier
        if v1_exit_idx < v0_exit_idx:
            # Overlay exited early - classify outcome

            # What happened AFTER overlay exit (up to Day 7)?
            if len(path) > v1_exit_idx + 1 and v0_exit_idx < len(path):
                # Calculate peak AFTER overlay exit
                future_path = path[v1_exit_idx+1:v0_exit_idx+1]
                if len(future_path) > 0:  # Explicit check for empty
                    peak_after_overlay = max(day['mtm_pnl'] for day in future_path)

                    # Classify: Winner cut OR failure saved (mutually exclusive)
                    if peak_after_overlay > v1_exit_pnl * 1.05:
                        # Peak rose >5% after overlay exit = cut winner early
                        winners_cut_early.append({
                            'profile': profile_name,
                            'year': year,
                            'overlay_exit_pnl': v1_exit_pnl,
                            'eventual_peak': peak_after_overlay,
                            'opportunity_lost': peak_after_overlay - v1_exit_pnl,
                        })

                    elif v0_exit_pnl < v1_exit_pnl * 0.95:
                        # Day 7 was >5% worse = saved from bigger loss
                        early_failures_saved.append({
                            'profile': profile_name,
                            'year': year,
                            'overlay_exit_pnl': v1_exit_pnl,
                            'day7_pnl': v0_exit_pnl,
                            'loss_avoided': v1_exit_pnl - v0_exit_pnl,
                        })

print()
print(f"Processing complete: {trade_count} trades examined, {skip_count} skipped, {v0_results['trades']} processed")
print()

# Calculate summary metrics
v0_win_rate = v0_results['wins'] / v0_results['trades'] * 100 if v0_results['trades'] > 0 else 0
v1_win_rate = v1_results['wins'] / v1_results['trades'] * 100 if v1_results['trades'] > 0 else 0

v0_avg_days = v0_results['total_days'] / v0_results['trades'] if v0_results['trades'] > 0 else 0
v1_avg_days = v1_results['total_days'] / v1_results['trades'] if v1_results['trades'] > 0 else 0

v0_avg_capture = np.mean(v0_results['peak_captured']) if v0_results['peak_captured'] else 0
v1_avg_capture = np.mean(v1_results['peak_captured']) if v1_results['peak_captured'] else 0

# Print results
print("=" * 80)
print("OVERALL RESULTS")
print("=" * 80)
print()
print(f"{'Variant':<25} {'Total P&L':>12} {'Win Rate':>10} {'Avg Days':>10} {'Avg Capture':>12}")
print("-" * 80)
print(f"{'V0 (Day 7)':<25} ${v0_results['total_pnl']:>11,.0f} {v0_win_rate:>9.1f}% {v0_avg_days:>9.1f} {v0_avg_capture:>11.1f}%")
print(f"{'V1 (Day 7 + Overlay)':<25} ${v1_results['total_pnl']:>11,.0f} {v1_win_rate:>9.1f}% {v1_avg_days:>9.1f} {v1_avg_capture:>11.1f}%")
print(f"{'Delta (V1 - V0)':<25} ${v1_results['total_pnl'] - v0_results['total_pnl']:>11,.0f} {v1_win_rate - v0_win_rate:>9.1f}% {v1_avg_days - v0_avg_days:>9.1f} {v1_avg_capture - v0_avg_capture:>11.1f}%")
print()

# By profile
print("=" * 80)
print("BY PROFILE")
print("=" * 80)
print()
print(f"{'Profile':<10} {'V0 P&L':>12} {'V1 P&L':>12} {'Delta':>12} {'V0 WR':>8} {'V1 WR':>8}")
print("-" * 80)

for profile in sorted(set(list(profile_v0.keys()) + list(profile_v1.keys()))):
    v0_pnl = profile_v0[profile]['pnl']
    v1_pnl = profile_v1[profile]['pnl']
    v0_wr = profile_v0[profile]['wins'] / profile_v0[profile]['trades'] * 100 if profile_v0[profile]['trades'] > 0 else 0
    v1_wr = profile_v1[profile]['wins'] / profile_v1[profile]['trades'] * 100 if profile_v1[profile]['trades'] > 0 else 0

    print(f"{profile:<10} ${v0_pnl:>11,.0f} ${v1_pnl:>11,.0f} ${v1_pnl - v0_pnl:>11,.0f} {v0_wr:>7.1f}% {v1_wr:>7.1f}%")

# By year
print()
print("=" * 80)
print("BY YEAR")
print("=" * 80)
print()
print(f"{'Year':<10} {'V0 P&L':>12} {'V1 P&L':>12} {'Delta':>12} {'Harm Test':>12}")
print("-" * 80)

year_verdicts = {}

for year in sorted(year_v0.keys()):
    v0_pnl = year_v0[year]['pnl']
    v1_pnl = year_v1[year]['pnl']

    # Year-specific harm check
    year_winners_cut = [w for w in winners_cut_early if w['year'] == year]
    year_failures_saved = [f for f in early_failures_saved if f['year'] == year]

    n_cut = len(year_winners_cut)
    n_saved = len(year_failures_saved)

    year_pass = n_saved >= n_cut
    year_verdicts[year] = 'PASS' if year_pass else 'FAIL'
    verdict_str = f"{n_saved}>={n_cut}"

    print(f"{year:<10} ${v0_pnl:>11,.0f} ${v1_pnl:>11,.0f} ${v1_pnl - v0_pnl:>11,.0f} {verdict_str:>12}")

# Harm analysis
print()
print("=" * 80)
print("HARM ANALYSIS")
print("=" * 80)
print()

n_winners_cut = len(winners_cut_early)
n_failures_saved = len(early_failures_saved)

print(f"Winners cut early: {n_winners_cut}")
print(f"Early failures saved: {n_failures_saved}")
print()

if n_winners_cut > 0:
    total_opp_lost = sum(w['opportunity_lost'] for w in winners_cut_early)
    print(f"  Total opportunity lost: ${total_opp_lost:,.0f}")
    print(f"  Avg per trade: ${total_opp_lost / n_winners_cut:,.0f}")
    print()

if n_failures_saved > 0:
    total_loss_avoided = sum(f['loss_avoided'] for f in early_failures_saved)
    print(f"  Total loss avoided: ${total_loss_avoided:,.0f}")
    print(f"  Avg per trade: ${total_loss_avoided / n_failures_saved:,.0f}")
    print()

# Overall verdict
overall_pass = n_failures_saved >= n_winners_cut
all_years_pass = all(v == 'PASS' for v in year_verdicts.values())

print("ACCEPTANCE TEST:")
print(f"  Overall: {n_failures_saved} >= {n_winners_cut} = {'PASS' if overall_pass else 'FAIL'}")
print(f"  All years: {'PASS' if all_years_pass else 'FAIL'}")
print()

if overall_pass and all_years_pass:
    final_verdict = "APPROVED"
    print("✓ OVERLAY APPROVED - Safe to deploy")
else:
    final_verdict = "REJECTED"
    failed_years = [y for y, v in year_verdicts.items() if v == 'FAIL']
    print(f"✗ OVERLAY REJECTED")
    if failed_years:
        print(f"  Failed years: {failed_years}")

print()

# Save results
report = {
    'v0_day7': {
        'total_pnl': v0_results['total_pnl'],
        'win_rate': v0_win_rate,
        'avg_days': v0_avg_days,
        'avg_capture': v0_avg_capture,
    },
    'v1_overlay': {
        'total_pnl': v1_results['total_pnl'],
        'win_rate': v1_win_rate,
        'avg_days': v1_avg_days,
        'avg_capture': v1_avg_capture,
    },
    'harm_analysis': {
        'winners_cut_early': n_winners_cut,
        'early_failures_saved': n_failures_saved,
        'overall_verdict': 'PASS' if overall_pass else 'FAIL',
    },
    'by_profile': {
        profile: {
            'v0_pnl': profile_v0[profile]['pnl'],
            'v1_pnl': profile_v1[profile]['pnl'],
            'delta': profile_v1[profile]['pnl'] - profile_v0[profile]['pnl'],
        } for profile in profile_v0.keys()
    },
    'by_year': {
        year: {
            'v0_pnl': year_v0[year]['pnl'],
            'v1_pnl': year_v1[year]['pnl'],
            'delta': year_v1[year]['pnl'] - year_v0[year]['pnl'],
            'verdict': year_verdicts[year],
        } for year in year_v0.keys()
    },
    'final_verdict': final_verdict,
}

# Save files
output_dir = Path('reports')
output_dir.mkdir(exist_ok=True)

from datetime import datetime
json_file = output_dir / f'day7_vs_overlay_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'

with open(json_file, 'w') as f:
    json.dump(report, f, indent=2)

# Markdown report
md_file = output_dir / 'day7_vs_overlay.md'
with open(md_file, 'w') as f:
    f.write("# Day 7 vs Day 7 + Intraday Decay Overlay\n\n")
    f.write(f"**Analysis Date:** {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
    f.write("**Data Source:** Real yfinance minute bars\n\n")

    f.write("## Overall Results\n\n")
    f.write("| Variant | Total P&L | Win Rate | Avg Days | Avg Capture |\n")
    f.write("|---------|-----------|----------|----------|-------------|\n")
    f.write(f"| V0 (Day 7) | ${v0_results['total_pnl']:,.0f} | {v0_win_rate:.1f}% | {v0_avg_days:.1f} | {v0_avg_capture:.1f}% |\n")
    f.write(f"| V1 (Overlay) | ${v1_results['total_pnl']:,.0f} | {v1_win_rate:.1f}% | {v1_avg_days:.1f} | {v1_avg_capture:.1f}% |\n")
    f.write(f"| **Delta** | **${v1_results['total_pnl'] - v0_results['total_pnl']:,.0f}** | **{v1_win_rate - v0_win_rate:.1f}%** | **{v1_avg_days - v0_avg_days:.1f}** | **{v1_avg_capture - v0_avg_capture:.1f}%** |\n\n")

    f.write("## Harm Analysis\n\n")
    f.write(f"- Winners cut early: {n_winners_cut}\n")
    f.write(f"- Early failures saved: {n_failures_saved}\n")
    f.write(f"- Overall verdict: {'PASS' if overall_pass else 'FAIL'}\n\n")

    f.write("## By Year Harm Check\n\n")
    f.write("| Year | V0 P&L | V1 P&L | Delta | Verdict |\n")
    f.write("|------|--------|--------|-------|----------|\n")
    for year in sorted(year_v0.keys()):
        v0_pnl = year_v0[year]['pnl']
        v1_pnl = year_v1[year]['pnl']
        verdict_icon = "✓" if year_verdicts[year] == 'PASS' else "✗"
        f.write(f"| {year} | ${v0_pnl:,.0f} | ${v1_pnl:,.0f} | ${v1_pnl - v0_pnl:,.0f} | {verdict_icon} {year_verdicts[year]} |\n")

    f.write(f"\n## Final Verdict\n\n**{final_verdict}**\n")

print(f"Results saved to: {json_file}")
print(f"Report saved to: {md_file}")
