#!/usr/bin/env python3
"""
Analyze Phase 1 Exit Strategy from Existing Tracked Data

This script does NOT run a new backtest. It analyzes the existing 14-day
tracked data and calculates what P&L would have been realized if we exited
on the profile-specific days.

Peak potential stays constant (14-day maximum), only realized P&L changes.
"""

import json
import sys
from pathlib import Path
from typing import Dict, List

# Profile-specific exit days (from EXIT_STRATEGY_PHASE1_SPEC.md)
PROFILE_EXIT_DAYS = {
    'Profile_1_LDG': 7,
    'Profile_2_SDG': 5,
    'Profile_3_CHARM': 3,
    'Profile_4_VANNA': 8,
    'Profile_5_SKEW': 5,
    'Profile_6_VOV': 7
}


def analyze_phase1_exits(tracked_data: Dict) -> Dict:
    """
    Analyze what Phase 1 exits would have achieved using existing tracked data.

    Args:
        tracked_data: Full tracking results with 14-day paths

    Returns:
        Phase 1 analysis with profile-by-profile breakdown
    """
    results = {}

    for profile_id, profile_data in tracked_data.items():
        exit_day = PROFILE_EXIT_DAYS.get(profile_id, 14)
        trades = profile_data.get('trades', [])

        phase1_pnl = 0.0
        peak_potential = 0.0
        captured_count = 0
        total_trades = len(trades)

        for trade in trades:
            # Get the 14-day path
            path = trade.get('path', [])

            if not path:
                continue

            # Find peak P&L across FULL 14-day window (stays constant)
            peak_pnl = max(day['unrealized_pnl'] for day in path)
            peak_potential += peak_pnl if peak_pnl > 0 else 0

            # Find realized P&L on exit day (what we actually capture)
            if len(path) >= exit_day:
                realized_pnl = path[exit_day - 1]['unrealized_pnl']  # Day 7 = index 6
            else:
                # Trade didn't last that long, use final day
                realized_pnl = path[-1]['unrealized_pnl']

            phase1_pnl += realized_pnl

            # Count captures
            if peak_pnl > 0 and realized_pnl > 0:
                captured_count += 1

        # Calculate metrics
        capture_rate = (phase1_pnl / peak_potential * 100) if peak_potential > 0 else 0
        win_rate = (captured_count / total_trades * 100) if total_trades > 0 else 0

        results[profile_id] = {
            'name': profile_data['config']['name'],
            'exit_day': exit_day,
            'total_trades': total_trades,
            'phase1_pnl': phase1_pnl,
            'peak_potential': peak_potential,  # Should match baseline
            'capture_rate': capture_rate,
            'winners': captured_count,
            'win_rate': win_rate,
            'baseline_pnl': profile_data['summary']['total_pnl'],  # For comparison
            'baseline_capture': profile_data['summary']['total_pnl'] / peak_potential * 100 if peak_potential > 0 else 0
        }

    return results


def print_analysis(results: Dict):
    """Print Phase 1 analysis in clean format"""

    print("\n" + "="*80)
    print("PHASE 1 EXIT STRATEGY ANALYSIS")
    print("Using existing 14-day tracked data")
    print("="*80)

    total_baseline_pnl = 0
    total_phase1_pnl = 0
    total_peak = 0
    total_trades = 0

    for profile_id, data in results.items():
        print(f"\n{profile_id} - {data['name']}")
        print(f"  Exit Day: {data['exit_day']}")
        print(f"  Trades: {data['total_trades']}")
        print(f"  Peak Potential: ${data['peak_potential']:,.0f} (14-day max)")
        print(f"  ")
        print(f"  BASELINE (14-day hold):")
        print(f"    P&L: ${data['baseline_pnl']:,.0f}")
        print(f"    Capture: {data['baseline_capture']:.1f}%")
        print(f"  ")
        print(f"  PHASE 1 (Day {data['exit_day']} exit):")
        print(f"    P&L: ${data['phase1_pnl']:,.0f}")
        print(f"    Capture: {data['capture_rate']:.1f}%")
        print(f"    Winners: {data['winners']} ({data['win_rate']:.1f}%)")
        print(f"  ")
        print(f"  IMPROVEMENT: ${data['phase1_pnl'] - data['baseline_pnl']:+,.0f}")

        total_baseline_pnl += data['baseline_pnl']
        total_phase1_pnl += data['phase1_pnl']
        total_peak += data['peak_potential']
        total_trades += data['total_trades']

    print("\n" + "="*80)
    print("TOTAL - PHASE 1 vs BASELINE")
    print("="*80)
    print(f"Trades: {total_trades}")
    print(f"Peak Potential: ${total_peak:,.0f} (unchanged)")
    print(f"")
    print(f"BASELINE (14-day):")
    print(f"  P&L: ${total_baseline_pnl:,.0f}")
    print(f"  Capture: {total_baseline_pnl / total_peak * 100:.1f}%")
    print(f"")
    print(f"PHASE 1 (time-based):")
    print(f"  P&L: ${total_phase1_pnl:,.0f}")
    print(f"  Capture: {total_phase1_pnl / total_peak * 100:.1f}%")
    print(f"")
    print(f"IMPROVEMENT: ${total_phase1_pnl - total_baseline_pnl:+,.0f}")
    print(f"  ({(total_phase1_pnl - total_baseline_pnl) / abs(total_baseline_pnl) * 100:+.1f}% vs baseline)")
    print("="*80)

    # Success criteria check
    print("\n" + "="*80)
    print("SUCCESS CRITERIA CHECK")
    print("="*80)

    profitable_profiles = sum(1 for d in results.values() if d['phase1_pnl'] > 0)
    capture_rate = total_phase1_pnl / total_peak * 100

    print(f"✓ Minimum bar (proves exits work):")
    print(f"  Total P&L > $0: {total_phase1_pnl > 0} (${total_phase1_pnl:,.0f})")
    print(f"  Capture rate > 5%: {capture_rate > 5} ({capture_rate:.1f}%)")
    print(f"  Profitable profiles ≥ 3: {profitable_profiles >= 3} ({profitable_profiles}/6)")
    print(f"")
    print(f"✓ Good outcome:")
    print(f"  Total P&L > $30K: {total_phase1_pnl > 30000} (${total_phase1_pnl:,.0f})")
    print(f"  Capture rate > 15%: {capture_rate > 15} ({capture_rate:.1f}%)")
    print(f"  Profitable profiles ≥ 4: {profitable_profiles >= 4} ({profitable_profiles}/6)")
    print(f"")
    print(f"✓ Excellent outcome:")
    print(f"  Total P&L > $60K: {total_phase1_pnl > 60000} (${total_phase1_pnl:,.0f})")
    print(f"  Capture rate > 20%: {capture_rate > 20} ({capture_rate:.1f}%)")
    print(f"  All profiles profitable: {profitable_profiles == 6} ({profitable_profiles}/6)")
    print("="*80)


def main():
    """Main execution"""

    # Load existing tracked data
    data_file = Path('/Users/zstoc/rotation-engine/data/backtest_results/full_tracking_results.json')

    if not data_file.exists():
        print(f"ERROR: Tracked data not found at {data_file}")
        print("Run the fresh backtest first to generate tracked data.")
        sys.exit(1)

    print(f"Loading tracked data from {data_file}...")
    with open(data_file, 'r') as f:
        tracked_data = json.load(f)

    print(f"✓ Loaded data for {len(tracked_data)} profiles")

    # Analyze Phase 1 exits
    results = analyze_phase1_exits(tracked_data)

    # Print analysis
    print_analysis(results)

    # Save results
    output_file = Path('/Users/zstoc/rotation-engine/data/backtest_results/phase1_analysis.json')
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\n✓ Saved analysis to {output_file}")
    print(f"\n🎯 Phase 1 analysis complete (no new backtest run, used existing data)")


if __name__ == '__main__':
    main()
