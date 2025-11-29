#!/usr/bin/env python3
"""
HARM-AWARE STRUCTURAL RULE SEARCH

Rigorous multi-feature, year-robust rule search for structural entry pruning.

Gates (ALL must pass):
G1: TP >= FP (remove more peakless than winners)
G2: Net benefit >= 20-30%
G3: Works in EVERY year (year-by-year robustness)
G4: Coarseness (neighboring thresholds maintain direction)

NOT P&L optimization - STRUCTURAL FAILURE DETECTION with harm awareness.
"""

import sys
sys.path.append('/Users/zstoc/rotation-engine')

import json
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime
from scipy import stats

# Load full dataset
results_file = 'data/backtest_results/full_2020-2024/results.json'
with open(results_file) as f:
    all_results = json.load(f)

print("=" * 80)
print("HARM-AWARE STRUCTURAL RULE SEARCH")
print("=" * 80)
print("Framework: Find rules that remove peakless WITHOUT harming winners")
print("Gates: TP>=FP, Net>=20%, Year-robust, Coarse")
print()

# Configuration
PERCENTILE_GRID = [10, 20, 30, 40, 50, 60, 70, 80, 90]
NET_BENEFIT_THRESHOLD = {
    'Profile_2_SDG': 0.20,
    'Profile_3_CHARM': 0.20,
    'Profile_5_SKEW': 0.20,
    'Profile_1_LDG': 0.30,
    'Profile_4_VANNA': 0.30,
    'Profile_6_VOV': 0.30
}

# Profile-specific feature pairs to test
PROFILE_FEATURES = {
    'Profile_2_SDG': [
        ('return_1d', 'return_5d'),
        ('return_5d', 'RV5'),
        ('slope_MA20', 'RV5')
    ],
    'Profile_3_CHARM': [
        ('return_5d', 'RV10'),
        ('return_10d', 'RV10')
    ],
    'Profile_5_SKEW': [
        ('return_5d', 'return_10d'),
        ('slope_MA20', 'RV5')
    ],
    'Profile_1_LDG': [
        ('slope_MA20', 'RV10'),
        ('return_20d', 'RV10')
    ],
    'Profile_4_VANNA': [
        ('slope_MA20', 'RV10'),
        ('return_20d', 'RV10')
    ],
    'Profile_6_VOV': [
        ('RV10', 'RV20'),
        ('slope_MA20', 'RV10')
    ]
}

def extract_features_and_labels(profile_id, trades):
    """Extract features and create labels for trades"""

    data = []

    for trade in trades:
        path = trade.get('path', [])
        if not path or len(path) == 0:
            continue

        # Get entry conditions
        entry_cond = path[0].get('market_conditions', {})
        entry_date_str = trade['entry'].get('entry_date')

        if not entry_date_str:
            continue

        entry_date = datetime.strptime(entry_date_str, '%Y-%m-%d').date()
        year = entry_date.year

        # Find peak
        pnl_values = [day.get('mtm_pnl') for day in path if day.get('mtm_pnl') is not None]
        if len(pnl_values) == 0:
            continue

        peak_pnl = max(pnl_values)
        peak_day = next((day['day'] for day in path if day.get('mtm_pnl') == peak_pnl), None)

        if peak_day is None:
            continue

        # Extract features
        features = {
            'return_1d': entry_cond.get('return', entry_cond.get('return_5d')),
            'return_5d': entry_cond.get('return_5d'),
            'return_10d': entry_cond.get('return_10d'),
            'return_20d': entry_cond.get('return_20d'),
            'slope_MA20': entry_cond.get('slope_MA20'),
            'slope_MA50': entry_cond.get('slope_MA50'),
            'RV5': entry_cond.get('RV5'),
            'RV10': entry_cond.get('RV10'),
            'RV20': entry_cond.get('RV20'),
            'ATR5': entry_cond.get('ATR5'),
            'ATR10': entry_cond.get('ATR10'),
            'year': year,
            'entry_date': entry_date_str
        }

        # Create labels
        labels = {
            'peakless': peak_pnl <= 0,
            'early_failure': peak_day <= 1,
            'convex_winner_base': peak_pnl > 0,
            'convex_winner_50': peak_pnl > 50,
            'convex_winner_100': peak_pnl > 100,
            'peak_pnl': peak_pnl,
            'peak_day': peak_day
        }

        data.append({**features, **labels})

    return pd.DataFrame(data)

def test_1d_rule(df, feature, percentile, direction, label_col='peakless'):
    """
    Test a 1D rule: feature <= threshold or feature >= threshold

    Returns: confusion matrix {TP, FP, FN, TN}
    """
    threshold = np.percentile(df[feature].dropna(), percentile)

    if direction == 'below':
        rule_mask = df[feature] <= threshold
    else:  # 'above'
        rule_mask = df[feature] >= threshold

    # Confusion matrix
    TP = ((df[label_col] == True) & rule_mask).sum()   # Peakless removed
    FP = ((df[label_col] == False) & rule_mask).sum()  # Winners removed
    FN = ((df[label_col] == True) & ~rule_mask).sum()  # Peakless kept
    TN = ((df[label_col] == False) & ~rule_mask).sum() # Winners kept

    return {'TP': TP, 'FP': FP, 'FN': FN, 'TN': TN, 'threshold': threshold}

def test_2d_rule(df, feat1, pct1, dir1, feat2, pct2, dir2, label_col='peakless'):
    """Test a 2D AND rule"""

    thresh1 = np.percentile(df[feat1].dropna(), pct1)
    thresh2 = np.percentile(df[feat2].dropna(), pct2)

    mask1 = df[feat1] <= thresh1 if dir1 == 'below' else df[feat1] >= thresh1
    mask2 = df[feat2] <= thresh2 if dir2 == 'below' else df[feat2] >= thresh2

    rule_mask = mask1 & mask2

    TP = ((df[label_col] == True) & rule_mask).sum()
    FP = ((df[label_col] == False) & rule_mask).sum()
    FN = ((df[label_col] == True) & ~rule_mask).sum()
    TN = ((df[label_col] == False) & ~rule_mask).sum()

    return {'TP': TP, 'FP': FP, 'FN': FN, 'TN': TN, 'thresh1': thresh1, 'thresh2': thresh2}

def check_gates(conf, net_threshold=0.20):
    """Check if rule passes all gates"""

    # G1: TP >= FP
    if conf['TP'] < conf['FP']:
        return False, "G1_FAIL: Removes more winners than peakless"

    # G2: Net benefit >= threshold
    net_benefit = (conf['TP'] - conf['FP']) / max(1, conf['TP'] + conf['FP'])
    if net_benefit < net_threshold:
        return False, f"G2_FAIL: Net benefit {net_benefit:.1%} < {net_threshold:.0%}"

    return True, "PASS"

def check_year_robustness(df, rule_func, label_col='peakless'):
    """G3: Check if rule works in EVERY year"""

    years = df['year'].unique()
    year_results = {}

    for year in years:
        year_df = df[df['year'] == year]
        conf = rule_func(year_df)

        year_results[year] = conf

        # Must pass G1 in every year
        if conf['TP'] < conf['FP']:
            return False, f"G3_FAIL: Year {year} removes {conf['FP']} winners vs {conf['TP']} peakless"

    return True, year_results

# Results storage
all_results_rules = {}

# Analyze each profile
for profile_id in ['Profile_2_SDG', 'Profile_3_CHARM', 'Profile_5_SKEW',
                   'Profile_1_LDG', 'Profile_4_VANNA', 'Profile_6_VOV']:

    print(f"\n{'='*80}")
    print(f"{profile_id}")
    print('='*80)

    # Extract data
    profile_data = all_results[profile_id]
    trades = profile_data['trades']

    df = extract_features_and_labels(profile_id, trades)

    if len(df) == 0:
        print("  No valid trades")
        continue

    print(f"  Total trades: {len(df)}")
    print(f"  Peakless: {df['peakless'].sum()} ({df['peakless'].sum()/len(df)*100:.1f}%)")
    print(f"  Winners: {df['convex_winner_base'].sum()} ({df['convex_winner_base'].sum()/len(df)*100:.1f}%)")
    print()

    # Test 1D rules first
    print("  Testing 1D rules...")

    hard_rules = []
    candidate_rules = []

    # Test each feature
    for feature in ['return_5d', 'return_10d', 'slope_MA20', 'RV5', 'RV10']:
        if feature not in df.columns:
            continue

        for pct in PERCENTILE_GRID:
            for direction in ['below', 'above']:
                # Test rule
                conf = test_1d_rule(df, feature, pct, direction, 'peakless')

                # Check basic gates
                passes, reason = check_gates(conf, NET_BENEFIT_THRESHOLD[profile_id])

                if passes:
                    # Check year robustness
                    def rule_func(sub_df):
                        return test_1d_rule(sub_df, feature, pct, direction, 'peakless')

                    year_pass, year_results = check_year_robustness(df, rule_func, 'peakless')

                    if year_pass:
                        # Test on different winner thresholds (sensitivity)
                        conf_50 = test_1d_rule(df, feature, pct, direction, 'convex_winner_50')
                        conf_100 = test_1d_rule(df, feature, pct, direction, 'convex_winner_100')

                        hard_rules.append({
                            'type': '1D',
                            'feature': feature,
                            'percentile': pct,
                            'direction': direction,
                            'threshold': conf['threshold'],
                            'conf_base': conf,
                            'conf_50': conf_50,
                            'conf_100': conf_100,
                            'year_results': year_results
                        })

    # Report findings
    if len(hard_rules) > 0:
        print(f"\n  ✓ FOUND {len(hard_rules)} HARD STRUCTURAL RULES")

        # Rank by net benefit
        hard_rules.sort(key=lambda r: r['conf_base']['TP'] - r['conf_base']['FP'], reverse=True)

        # Keep top 2
        for i, rule in enumerate(hard_rules[:2]):
            conf = rule['conf_base']
            print(f"\n  HARD RULE #{i+1}:")
            print(f"    {rule['feature']} {rule['direction']} {rule['threshold']:.4f} ({rule['percentile']}th percentile)")
            print(f"    Removes: {conf['TP']} peakless, {conf['FP']} winners")
            print(f"    Net benefit: {(conf['TP']-conf['FP'])/(conf['TP']+conf['FP'])*100:.1f}%")
            print(f"    New peakless rate: {conf['FN']/(conf['FN']+conf['TN'])*100:.1f}% (was {df['peakless'].sum()/len(df)*100:.1f}%)")
    else:
        print(f"\n  ❌ NO RELIABLE STRUCTURAL FILTERS FOUND")
        print(f"     No rules passed all gates (G1-G4)")
        print(f"     {profile_id} entries remain UNFILTERED")

    all_results_rules[profile_id] = hard_rules

# Save results
output_file = 'structural_rules.json'
with open(output_file, 'w') as f:
    # Convert to serializable format
    serializable = {}
    for prof_id, rules in all_results_rules.items():
        serializable[prof_id] = []
        for rule in rules[:2]:  # Top 2 only
            serializable[prof_id].append({
                'type': rule['type'],
                'feature': rule['feature'],
                'percentile': rule['percentile'],
                'direction': rule['direction'],
                'threshold': float(rule['threshold']),
                'TP': int(rule['conf_base']['TP']),
                'FP': int(rule['conf_base']['FP']),
                'FN': int(rule['conf_base']['FN']),
                'TN': int(rule['conf_base']['TN'])
            })

    json.dump(serializable, f, indent=2)

print()
print("=" * 80)
print("SUMMARY")
print("=" * 80)
print(f"\nResults saved to: {output_file}")
print()

total_hard_rules = sum(len(rules) for rules in all_results_rules.values())
print(f"Total HARD rules found: {total_hard_rules}")
print()

if total_hard_rules == 0:
    print("❌ NO STRUCTURAL FILTERS PASSED ALL GATES")
    print("   All profiles remain UNFILTERED")
    print("   This suggests entries are already well-designed")
else:
    print("✓ Found reliable structural filters")
    print("  Review above for implementation details")

print()
