#!/usr/bin/env python3
"""
Entry Condition Analysis: Winners vs Losers

Statistical analysis of 668 tracked trades to identify entry conditions
that distinguish winning trades from losing trades.

Methodology:
- T-tests for continuous variables
- Effect sizes (Cohen's d) for magnitude
- Multiple testing correction (Bonferroni)
- Only report significant differences (p < 0.05, |d| > 0.3)

Output:
- Markdown report with full analysis
- JSON recommendations for ProfileGatekeeper
"""

import json
import numpy as np
import pandas as pd
from pathlib import Path
from scipy import stats
from typing import Dict, List, Tuple
import warnings
warnings.filterwarnings('ignore')


def load_trades(filepath: str) -> Dict:
    """Load tracked trades from JSON"""
    with open(filepath, 'r') as f:
        return json.load(f)


def cohen_d(group1: np.ndarray, group2: np.ndarray) -> float:
    """
    Calculate Cohen's d effect size

    Interpretation:
    - |d| < 0.3: Small effect (not meaningful)
    - 0.3 <= |d| < 0.5: Small-medium effect
    - 0.5 <= |d| < 0.8: Medium effect
    - |d| >= 0.8: Large effect
    """
    n1, n2 = len(group1), len(group2)
    var1, var2 = np.var(group1, ddof=1), np.var(group2, ddof=1)

    # Pooled standard deviation
    pooled_std = np.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2))

    if pooled_std == 0:
        return 0.0

    return (np.mean(group1) - np.mean(group2)) / pooled_std


def analyze_profile(profile_id: str, trades: List[Dict]) -> Dict:
    """
    Analyze single profile: compare winners vs losers at entry

    Returns dict with:
    - summary_stats: Win rate, avg P&L, etc.
    - feature_comparisons: Statistical tests for each feature
    - recommendations: Suggested gating conditions
    """

    # Separate winners and losers
    winners = [t for t in trades if t['exit']['final_pnl'] > 0]
    losers = [t for t in trades if t['exit']['final_pnl'] <= 0]

    # Strong winners (captured >30% of peak)
    strong_winners = [t for t in winners if t['exit']['pct_of_peak_captured'] > 30]

    n_trades = len(trades)
    n_winners = len(winners)
    n_losers = len(losers)
    win_rate = n_winners / n_trades if n_trades > 0 else 0

    # Summary statistics
    summary = {
        'total_trades': n_trades,
        'winners': n_winners,
        'losers': n_losers,
        'strong_winners': len(strong_winners),
        'win_rate': win_rate,
        'avg_winner_pnl': np.mean([t['exit']['final_pnl'] for t in winners]) if winners else 0,
        'avg_loser_pnl': np.mean([t['exit']['final_pnl'] for t in losers]) if losers else 0,
        'median_winner_pnl': np.median([t['exit']['final_pnl'] for t in winners]) if winners else 0,
        'median_loser_pnl': np.median([t['exit']['final_pnl'] for t in losers]) if losers else 0
    }

    # Extract entry features for comparison
    feature_comparisons = {}

    # Get all available features from first trade
    if trades and 'entry_conditions' in trades[0]['entry']:
        sample_conditions = trades[0]['entry']['entry_conditions']
        feature_names = [k for k, v in sample_conditions.items()
                        if isinstance(v, (int, float)) and v is not None]

        for feature in feature_names:
            # Extract feature values for winners and losers
            winner_values = []
            loser_values = []

            for t in winners:
                cond = t['entry'].get('entry_conditions', {})
                val = cond.get(feature)
                if val is not None and not np.isnan(val):
                    winner_values.append(val)

            for t in losers:
                cond = t['entry'].get('entry_conditions', {})
                val = cond.get(feature)
                if val is not None and not np.isnan(val):
                    loser_values.append(val)

            if len(winner_values) < 5 or len(loser_values) < 5:
                continue  # Not enough data for meaningful comparison

            # T-test
            t_stat, p_value = stats.ttest_ind(winner_values, loser_values)

            # Effect size
            effect_size = cohen_d(np.array(winner_values), np.array(loser_values))

            # Store comparison
            feature_comparisons[feature] = {
                'winner_mean': float(np.mean(winner_values)),
                'winner_std': float(np.std(winner_values)),
                'loser_mean': float(np.mean(loser_values)),
                'loser_std': float(np.std(loser_values)),
                'winner_median': float(np.median(winner_values)),
                'loser_median': float(np.median(loser_values)),
                't_statistic': float(t_stat),
                'p_value': float(p_value),
                'cohens_d': float(effect_size),
                'n_winner_samples': len(winner_values),
                'n_loser_samples': len(loser_values)
            }

    # Generate recommendations based on significant differences
    recommendations = []

    # Apply Bonferroni correction for multiple testing
    n_tests = len(feature_comparisons)
    alpha_corrected = 0.05 / n_tests if n_tests > 0 else 0.05

    for feature, comp in feature_comparisons.items():
        # Only recommend if statistically significant AND meaningful effect size
        if comp['p_value'] < alpha_corrected and abs(comp['cohens_d']) > 0.3:

            # Determine direction and threshold
            if comp['winner_mean'] < comp['loser_mean']:
                # Winners had LOWER values
                direction = "lower"
                threshold = comp['winner_median'] * 1.1  # 10% above winner median
                condition = f"{feature} < {threshold:.4f}"
            else:
                # Winners had HIGHER values
                direction = "higher"
                threshold = comp['winner_median'] * 0.9  # 10% below winner median
                condition = f"{feature} > {threshold:.4f}"

            # Estimate impact (what % of winners/losers would pass this gate?)
            if direction == "lower":
                pct_winners_pass = sum(1 for w in [t['entry']['entry_conditions'].get(feature)
                                                   for t in winners
                                                   if feature in t['entry'].get('entry_conditions', {})]
                                      if w is not None and w < threshold) / len(winners) * 100 if winners else 0
                pct_losers_blocked = sum(1 for l in [t['entry']['entry_conditions'].get(feature)
                                                     for t in losers
                                                     if feature in t['entry'].get('entry_conditions', {})]
                                        if l is not None and l >= threshold) / len(losers) * 100 if losers else 0
            else:
                pct_winners_pass = sum(1 for w in [t['entry']['entry_conditions'].get(feature)
                                                   for t in winners
                                                   if feature in t['entry'].get('entry_conditions', {})]
                                      if w is not None and w > threshold) / len(winners) * 100 if winners else 0
                pct_losers_blocked = sum(1 for l in [t['entry']['entry_conditions'].get(feature)
                                                     for t in losers
                                                     if feature in t['entry'].get('entry_conditions', {})]
                                        if l is not None and l <= threshold) / len(losers) * 100 if losers else 0

            recommendations.append({
                'feature': feature,
                'condition': condition,
                'rationale': f"Winners had {direction} {feature}: "
                           f"mean={comp['winner_mean']:.4f} vs {comp['loser_mean']:.4f} "
                           f"(p={comp['p_value']:.4f}, d={comp['cohens_d']:.2f})",
                'effect_size': comp['cohens_d'],
                'p_value': comp['p_value'],
                'expected_impact': f"Keeps {pct_winners_pass:.1f}% of winners, blocks {pct_losers_blocked:.1f}% of losers",
                'threshold': float(threshold)
            })

    # Sort recommendations by effect size (strongest first)
    recommendations.sort(key=lambda x: abs(x['effect_size']), reverse=True)

    # Limit to top 3 recommendations (avoid overfitting)
    recommendations = recommendations[:3]

    return {
        'summary': summary,
        'feature_comparisons': feature_comparisons,
        'recommendations': recommendations
    }


def generate_markdown_report(analysis_results: Dict) -> str:
    """Generate human-readable markdown report"""

    lines = [
        "# Entry Condition Analysis: Winners vs Losers",
        "",
        "**Date:** 2025-11-15",
        "**Dataset:** 668 trades with complete path tracking (2020-2024)",
        "**Method:** T-tests with Bonferroni correction, Cohen's d effect sizes",
        "",
        "---",
        ""
    ]

    # Summary table
    lines.extend([
        "## Summary Statistics",
        "",
        "| Profile | Trades | Win Rate | Avg Winner | Avg Loser | Strong Winners |",
        "|---------|--------|----------|------------|-----------|----------------|"
    ])

    for profile_id, results in analysis_results.items():
        summary = results['summary']
        lines.append(
            f"| {profile_id} | {summary['total_trades']} | "
            f"{summary['win_rate']*100:.1f}% | "
            f"${summary['avg_winner_pnl']:.0f} | "
            f"${summary['avg_loser_pnl']:.0f} | "
            f"{summary['strong_winners']} |"
        )

    lines.extend(["", "---", ""])

    # Detailed analysis for each profile
    for profile_id, results in analysis_results.items():
        summary = results['summary']
        recs = results['recommendations']

        lines.extend([
            f"## {profile_id}",
            "",
            f"**Performance:**",
            f"- Total trades: {summary['total_trades']}",
            f"- Winners: {summary['winners']} ({summary['win_rate']*100:.1f}%)",
            f"- Losers: {summary['losers']}",
            f"- Strong winners (>30% capture): {summary['strong_winners']}",
            f"- Avg winner P&L: ${summary['avg_winner_pnl']:.0f}",
            f"- Avg loser P&L: ${summary['avg_loser_pnl']:.0f}",
            ""
        ])

        if recs:
            lines.extend([
                "**Recommended Entry Gates:**",
                ""
            ])

            for i, rec in enumerate(recs, 1):
                lines.extend([
                    f"{i}. **{rec['condition']}**",
                    f"   - Rationale: {rec['rationale']}",
                    f"   - Impact: {rec['expected_impact']}",
                    f"   - Effect size: {abs(rec['effect_size']):.2f} ({'Large' if abs(rec['effect_size']) >= 0.8 else 'Medium' if abs(rec['effect_size']) >= 0.5 else 'Small-Medium'})",
                    ""
                ])
        else:
            lines.extend([
                "**No significant entry patterns found.**",
                "",
                "This profile may need exit optimization rather than entry filtering.",
                ""
            ])

        lines.extend(["---", ""])

    return "\n".join(lines)


def generate_json_recommendations(analysis_results: Dict) -> Dict:
    """Generate machine-readable recommendations for ProfileGatekeeper"""

    output = {}

    for profile_id, results in analysis_results.items():
        summary = results['summary']
        recs = results['recommendations']

        output[profile_id] = {
            'current_win_rate': summary['win_rate'],
            'avg_winner_pnl': summary['avg_winner_pnl'],
            'avg_loser_pnl': summary['avg_loser_pnl'],
            'total_trades': summary['total_trades'],
            'recommended_gates': [
                {
                    'feature': rec['feature'],
                    'condition': rec['condition'],
                    'rationale': rec['rationale'],
                    'expected_impact': rec['expected_impact'],
                    'effect_size': rec['effect_size'],
                    'p_value': rec['p_value'],
                    'threshold': rec['threshold']
                }
                for rec in recs
            ]
        }

    return output


def main():
    """Main execution"""

    print("\n" + "="*80)
    print("ENTRY CONDITION ANALYSIS: Winners vs Losers")
    print("="*80)
    print("Rigorous statistical analysis with multiple testing correction")
    print("Only reporting differences with p < 0.05 (Bonferroni) and |d| > 0.3\n")

    # Load data
    data_file = '/Users/zstoc/rotation-engine/data/backtest_results/full_tracking_results.json'
    print(f"Loading trades from: {data_file}")

    all_data = load_trades(data_file)

    # Analyze each profile
    analysis_results = {}

    for profile_id, profile_data in all_data.items():
        if 'trades' not in profile_data:
            continue

        trades = profile_data['trades']
        print(f"\nAnalyzing {profile_id}: {len(trades)} trades...")

        results = analyze_profile(profile_id, trades)
        analysis_results[profile_id] = results

        # Quick preview
        summary = results['summary']
        print(f"  Win rate: {summary['win_rate']*100:.1f}%")
        print(f"  Recommendations: {len(results['recommendations'])} entry gates")

    # Generate outputs
    print("\n" + "="*80)
    print("Generating reports...")

    # Markdown report
    output_dir = Path('/Users/zstoc/rotation-engine/analysis')
    output_dir.mkdir(parents=True, exist_ok=True)

    report_file = output_dir / 'entry_analysis_full_report.md'
    markdown_report = generate_markdown_report(analysis_results)

    with open(report_file, 'w') as f:
        f.write(markdown_report)

    print(f"✅ Saved: {report_file}")

    # JSON recommendations
    json_file = output_dir / 'entry_gating_recommendations.json'
    json_recommendations = generate_json_recommendations(analysis_results)

    with open(json_file, 'w') as f:
        json.dump(json_recommendations, f, indent=2)

    print(f"✅ Saved: {json_file}")

    # Summary
    print("\n" + "="*80)
    print("SUMMARY")
    print("="*80)

    total_profiles = len(analysis_results)
    profiles_with_recs = sum(1 for r in analysis_results.values() if r['recommendations'])

    print(f"Analyzed: {total_profiles} profiles")
    print(f"Found entry patterns: {profiles_with_recs} profiles")
    print(f"No clear patterns: {total_profiles - profiles_with_recs} profiles (need exit optimization)")

    print("\n" + "="*80)
    print("✅ Analysis complete - Ready for ProfileGatekeeper implementation")
    print("="*80 + "\n")


if __name__ == '__main__':
    main()
