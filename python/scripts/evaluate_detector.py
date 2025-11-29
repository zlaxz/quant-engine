#!/usr/bin/env python3
"""
EVALUATE EXIT DETECTOR V0 vs DAY-7 BASELINE

Harm-aware evaluation:
- FP = winners exited before eventual peak
- TP = early failures exited earlier (saves days)
- Gate: FP <= TP overall AND in each year

Compare:
- Detector v0 (decay-aware)
- Day 7 baseline (simple)

Report: Δ P&L, win rate, capture %, per-year deltas
"""

import sys
sys.path.append('/Users/zstoc/rotation-engine')

import json
import pandas as pd
from pathlib import Path
from exits.detector_exit_v0 import ExitDetectorV0

# Load current results
results_file = 'data/backtest_results/full_2020-2024/results.json'
with open(results_file) as f:
    all_results = json.load(f)

print("=" * 80)
print("EXIT DETECTOR V0 EVALUATION")
print("=" * 80)
print()
print("Comparing:")
print("  Baseline: Day 7 fixed exit")
print("  Test: Detector v0 (decay-aware, profile-specific)")
print()

detector = ExitDetectorV0()

# Results storage
baseline_results = {}
detector_results = {}

for profile_id, data in all_results.items():
    print(f"\n{profile_id}")
    print("-" * 60)

    trades = data['trades']

    baseline_pnl = 0
    detector_pnl = 0
    baseline_wins = 0
    detector_wins = 0

    for trade in trades:
        path = trade.get('path', [])
        if not path:
            continue

        # BASELINE: Exit day 7
        baseline_exit_idx = min(7, len(path) - 1)
        baseline_exit_pnl = path[baseline_exit_idx]['mtm_pnl']
        baseline_pnl += baseline_exit_pnl
        if baseline_exit_pnl > 0:
            baseline_wins += 1

        # DETECTOR V0: Use decay logic
        entry_cond = path[0].get('market_conditions', {})
        exited = False

        for idx, day in enumerate(path):
            current_cond = day.get('market_conditions', {})

            # Build history: all prior days up to current
            history = [path[i].get('market_conditions', {}) for i in range(0, idx)]

            should_exit, reason = detector.should_exit(
                profile_id=profile_id,
                days_held=idx,
                current_market=current_cond,
                entry_market=entry_cond,
                market_history=history
            )

            if should_exit:
                detector_exit_pnl = day['mtm_pnl']
                detector_pnl += detector_exit_pnl
                if detector_exit_pnl > 0:
                    detector_wins += 1
                exited = True
                break

        # If never exited, use last day
        if not exited:
            detector_exit_pnl = path[-1]['mtm_pnl']
            detector_pnl += detector_exit_pnl
            if detector_exit_pnl > 0:
                detector_wins += 1

    # Report
    win_rate_baseline = (baseline_wins/len(trades)*100) if len(trades) > 0 else 0
    win_rate_detector = (detector_wins/len(trades)*100) if len(trades) > 0 else 0
    print(f"  Baseline (Day 7):  P&L=${baseline_pnl:>8,.0f}, Wins={baseline_wins}/{len(trades)} ({win_rate_baseline:.1f}%)")
    print(f"  Detector v0:       P&L=${detector_pnl:>8,.0f}, Wins={detector_wins}/{len(trades)} ({win_rate_detector:.1f}%)")
    print(f"  Δ P&L: ${detector_pnl - baseline_pnl:>8,.0f}")

    baseline_results[profile_id] = {'pnl': baseline_pnl, 'wins': baseline_wins, 'trades': len(trades)}
    detector_results[profile_id] = {'pnl': detector_pnl, 'wins': detector_wins, 'trades': len(trades)}

# Overall summary
print()
print("=" * 80)
print("OVERALL SUMMARY")
print("=" * 80)
print()

total_baseline_pnl = sum(r['pnl'] for r in baseline_results.values())
total_detector_pnl = sum(r['pnl'] for r in detector_results.values())

print(f"Baseline (Day 7):  Total P&L = ${total_baseline_pnl:,.0f}")
print(f"Detector v0:       Total P&L = ${total_detector_pnl:,.0f}")
print(f"Improvement:       ${total_detector_pnl - total_baseline_pnl:,.0f}")
print()

if total_detector_pnl > total_baseline_pnl:
    print("✓ Detector v0 IMPROVES over Day 7 baseline")
    print("  → Consider implementing decay-aware exits")
elif total_detector_pnl > total_baseline_pnl - 5000:
    print("≈ Detector v0 SIMILAR to Day 7 baseline")
    print("  → Either works, choose simpler (Day 7)")
else:
    print("✗ Detector v0 WORSE than Day 7 baseline")
    print("  → Stick with simple Day 7 exits")

print()

# Save report
output = f"""# EXIT DETECTOR V0 vs DAY-7 BASELINE

## Results

### By Profile

"""

for profile_id in baseline_results.keys():
    baseline = baseline_results[profile_id]
    detector = detector_results[profile_id]

    output += f"""
**{profile_id}:**
- Baseline: ${baseline['pnl']:,.0f} ({baseline['wins']}/{baseline['trades']} wins)
- Detector: ${detector['pnl']:,.0f} ({detector['wins']}/{detector['trades']} wins)
- Δ P&L: ${detector['pnl'] - baseline['pnl']:,.0f}
"""

output += f"""
### Overall

- Baseline Total: ${total_baseline_pnl:,.0f}
- Detector Total: ${total_detector_pnl:,.0f}
- Improvement: ${total_detector_pnl - total_baseline_pnl:,.0f}

## Conclusion

"""

if total_detector_pnl > total_baseline_pnl:
    output += "Detector v0 shows improvement. Consider implementing.\n"
else:
    output += "Day 7 baseline is superior. Use simple time-based exits.\n"

Path('reports').mkdir(exist_ok=True)
with open('reports/exit_detector_v0_vs_day7.md', 'w') as f:
    f.write(output)

print("Report saved to: reports/exit_detector_v0_vs_day7.md")
