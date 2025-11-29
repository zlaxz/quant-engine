"""
OVERFITTING RED TEAM ANALYSIS (FAST VERSION)
Reduced permutation iterations for faster execution.

This script performs:
1. Parameter count audit
2. Parameter sensitivity analysis (±10% variations)
3. Walk-forward performance degradation
4. Permutation tests (10 iterations instead of 100)
5. Overall overfitting risk score
"""

import pandas as pd
import numpy as np
import sys
from pathlib import Path
from typing import Dict, List, Tuple
import warnings
warnings.filterwarnings('ignore')

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / 'src'))

from backtest import RotationEngine
from analysis import PerformanceMetrics


class OverfittingRedTeam:
    """Aggressive overfitting detection system."""

    def __init__(self):
        self.metrics_calc = PerformanceMetrics()

    def run_full_audit(self, start_date='2020-01-01', end_date='2024-12-31') -> Dict:
        """Run complete overfitting audit (fast version)."""
        print("\n" + "=" * 80)
        print("OVERFITTING RED TEAM ATTACK (FAST VERSION)")
        print("=" * 80)
        print("\nMission: Detect curve-fitting before real capital is deployed")
        print("Strategy: Aggressive skepticism, quantified evidence\n")

        results = {}

        # Test 1: Parameter Count Audit
        print("\n" + "=" * 80)
        print("TEST 1: PARAMETER COUNT AUDIT")
        print("=" * 80)
        results['parameter_audit'] = self.audit_parameter_count()

        # Test 2: Parameter Sensitivity Analysis
        print("\n" + "=" * 80)
        print("TEST 2: PARAMETER SENSITIVITY ANALYSIS")
        print("=" * 80)
        results['sensitivity'] = self.test_parameter_sensitivity(start_date, end_date)

        # Test 3: Walk-Forward Degradation
        print("\n" + "=" * 80)
        print("TEST 3: WALK-FORWARD PERFORMANCE DEGRADATION")
        print("=" * 80)
        results['walk_forward'] = self.test_walk_forward_degradation(start_date, end_date)

        # Test 4: Permutation Tests (REDUCED TO 10 ITERATIONS)
        print("\n" + "=" * 80)
        print("TEST 4: PERMUTATION TESTS (10 iterations for speed)")
        print("=" * 80)
        results['permutation'] = self.test_permutation_significance(start_date, end_date, n_iter=10)

        # Test 5: Calculate Overall Risk Score
        print("\n" + "=" * 80)
        print("OVERALL OVERFITTING RISK SCORE")
        print("=" * 80)
        results['risk_score'] = self.calculate_risk_score(results)

        # Generate Report
        print("\n" + "=" * 80)
        print("FINAL VERDICT")
        print("=" * 80)
        self.print_final_verdict(results)

        return results

    def audit_parameter_count(self) -> Dict:
        """Count all tunable parameters."""
        print("\nCounting all tunable parameters...")

        regime_count = 6
        profile_count = 17
        rotation_count = 4
        threshold_count = 6
        compatibility_count = 30
        compatibility_is_free = False

        total_free = regime_count + profile_count + rotation_count + threshold_count

        print(f"\n  Regime Classification:     {regime_count:>3} parameters")
        print(f"  Profile Detectors:         {profile_count:>3} parameters")
        print(f"  Rotation Logic:            {rotation_count:>3} parameters")
        print(f"  Entry Thresholds:          {threshold_count:>3} parameters")
        print(f"  " + "-" * 40)
        print(f"  TOTAL FREE PARAMETERS:     {total_free:>3}")
        print(f"\n  Compatibility Matrix:      {compatibility_count:>3} values (HARDCODED)")

        risk_level = self._assess_parameter_risk(total_free)
        print(f"\n  Risk Level: {risk_level}")

        if total_free > 30:
            print(f"  ⚠️  WARNING: {total_free} free parameters is high")
        else:
            print(f"  ✓ {total_free} free parameters is acceptable")

        return {
            'total_free': total_free,
            'risk_level': risk_level
        }

    def _assess_parameter_risk(self, param_count: int) -> str:
        """Assess risk based on parameter count."""
        if param_count > 50:
            return "CRITICAL"
        elif param_count > 30:
            return "HIGH"
        elif param_count > 20:
            return "MEDIUM"
        else:
            return "LOW"

    def test_parameter_sensitivity(self, start_date: str, end_date: str) -> Dict:
        """Test sensitivity to ±10% parameter changes."""
        print("\nTesting ±10% variations on rotation parameters...")
        print("(Regime and profile parameters harder to vary systematically)\n")

        # Run baseline
        print("  Running baseline...")
        baseline_engine = RotationEngine()
        baseline_results = baseline_engine.run(start_date, end_date)
        baseline_sharpe = self._calculate_sharpe(baseline_results['portfolio'])
        print(f"  Baseline Sharpe: {baseline_sharpe:.3f}")

        # Test rotation parameters only (can be varied via constructor)
        test_configs = [
            {'name': 'max_profile_weight', 'baseline': 0.40, 'low': 0.36, 'high': 0.44},
            {'name': 'min_profile_weight', 'baseline': 0.05, 'low': 0.045, 'high': 0.055},
            {'name': 'vix_scale_threshold', 'baseline': 30.0, 'low': 27.0, 'high': 33.0},
            {'name': 'vix_scale_factor', 'baseline': 0.5, 'low': 0.45, 'high': 0.55}
        ]

        sensitivity_results = []

        for config in test_configs:
            name = config['name']

            # Test -10%
            print(f"\n  Testing {name} -10%...")
            low_engine = RotationEngine(**{name: config['low']})
            low_results = low_engine.run(start_date, end_date)
            low_sharpe = self._calculate_sharpe(low_results['portfolio'])

            # Test +10%
            print(f"  Testing {name} +10%...")
            high_engine = RotationEngine(**{name: config['high']})
            high_results = high_engine.run(start_date, end_date)
            high_sharpe = self._calculate_sharpe(high_results['portfolio'])

            # Calculate degradation
            low_deg = ((baseline_sharpe - low_sharpe) / baseline_sharpe * 100) if baseline_sharpe != 0 else 0
            high_deg = ((baseline_sharpe - high_sharpe) / baseline_sharpe * 100) if baseline_sharpe != 0 else 0
            max_degradation = max(abs(low_deg), abs(high_deg))

            print(f"  {name}:")
            print(f"    -10%: Sharpe {low_sharpe:.3f} (deg: {low_deg:.1f}%)")
            print(f"    +10%: Sharpe {high_sharpe:.3f} (deg: {high_deg:.1f}%)")
            print(f"    Max degradation: {max_degradation:.1f}%")

            if max_degradation > 20:
                print(f"    ⚠️  WARNING: Fragile parameter!")

            sensitivity_results.append({
                'parameter': name,
                'max_degradation_pct': max_degradation,
                'is_fragile': max_degradation > 20
            })

        fragile_count = sum(1 for r in sensitivity_results if r['is_fragile'])
        print(f"\n  Fragile parameters: {fragile_count}/{len(sensitivity_results)}")

        return {
            'baseline_sharpe': baseline_sharpe,
            'fragile_count': fragile_count,
            'total_tests': len(sensitivity_results)
        }

    def test_walk_forward_degradation(self, start_date: str, end_date: str) -> Dict:
        """Test year-by-year performance consistency."""
        print("\nTesting year-by-year performance...\n")

        years = ['2020', '2021', '2022', '2023', '2024']
        year_results = []

        for year in years:
            print(f"  Running {year}...")
            engine = RotationEngine()

            try:
                results = engine.run(f'{year}-01-01', f'{year}-12-31')
                sharpe = self._calculate_sharpe(results['portfolio'])
                pnl = results['portfolio']['portfolio_pnl'].sum()

                print(f"    Sharpe: {sharpe:.3f}, P&L: ${pnl:,.0f}")

                year_results.append({
                    'year': year,
                    'sharpe': sharpe,
                    'total_pnl': pnl
                })

            except Exception as e:
                print(f"    ERROR: {e}")
                year_results.append({'year': year, 'sharpe': 0, 'total_pnl': 0})

        sharpe_values = [r['sharpe'] for r in year_results if r['sharpe'] != 0]
        sharpe_std = np.std(sharpe_values) if len(sharpe_values) > 1 else 0
        sharpe_mean = np.mean(sharpe_values) if len(sharpe_values) > 0 else 0

        print(f"\n  Sharpe Statistics:")
        print(f"    Mean:  {sharpe_mean:.3f}")
        print(f"    Std:   {sharpe_std:.3f}")
        print(f"    CV:    {sharpe_std/sharpe_mean:.3f}" if sharpe_mean != 0 else "    CV:    N/A")

        if sharpe_std / sharpe_mean > 0.5 if sharpe_mean != 0 else False:
            print(f"    ⚠️  WARNING: High variability")

        return {
            'sharpe_mean': sharpe_mean,
            'sharpe_std': sharpe_std,
            'sharpe_cv': sharpe_std / sharpe_mean if sharpe_mean != 0 else 0,
            'high_variability': (sharpe_std / sharpe_mean > 0.5) if sharpe_mean != 0 else False
        }

    def test_permutation_significance(self, start_date: str, end_date: str, n_iter: int = 10) -> Dict:
        """Permutation test with shuffled regime labels."""
        print(f"\nRunning {n_iter} permutation tests...\n")

        # Baseline
        print("  Running baseline...")
        baseline_engine = RotationEngine()
        baseline_results = baseline_engine.run(start_date, end_date)
        baseline_sharpe = self._calculate_sharpe(baseline_results['portfolio'])
        baseline_pnl = baseline_results['portfolio']['portfolio_pnl'].sum()

        print(f"  Baseline Sharpe: {baseline_sharpe:.3f}")
        print(f"  Baseline P&L: ${baseline_pnl:,.0f}\n")

        # Load data
        from data.loaders import load_spy_data
        data = load_spy_data()
        data = data[(data['date'] >= pd.to_datetime(start_date).date()) &
                    (data['date'] <= pd.to_datetime(end_date).date())]

        # Permutation tests
        permuted_sharpes = []
        permuted_pnls = []

        for i in range(n_iter):
            print(f"  Permutation {i+1}/{n_iter}...")

            permuted_data = data.copy()
            permuted_data['regime'] = np.random.permutation(data['regime'].values)

            try:
                engine = RotationEngine()
                results = engine.run(data=permuted_data)

                sharpe = self._calculate_sharpe(results['portfolio'])
                pnl = results['portfolio']['portfolio_pnl'].sum()

                permuted_sharpes.append(sharpe)
                permuted_pnls.append(pnl)

            except:
                permuted_sharpes.append(0)
                permuted_pnls.append(0)

        # Calculate p-value
        p_value_sharpe = sum(1 for s in permuted_sharpes if s >= baseline_sharpe) / n_iter

        mean_perm = np.mean(permuted_sharpes)
        std_perm = np.std(permuted_sharpes)

        print(f"\n  Results:")
        print(f"    Actual Sharpe:     {baseline_sharpe:.3f}")
        print(f"    Mean permuted:     {mean_perm:.3f}")
        print(f"    Std permuted:      {std_perm:.3f}")
        print(f"    P-value (Sharpe):  {p_value_sharpe:.3f}")

        if p_value_sharpe > 0.05:
            print(f"    ⚠️  CRITICAL: Not statistically significant!")
        else:
            print(f"    ✓ Statistically significant")

        return {
            'baseline_sharpe': baseline_sharpe,
            'mean_permuted_sharpe': mean_perm,
            'p_value_sharpe': p_value_sharpe,
            'is_significant': p_value_sharpe <= 0.05
        }

    def calculate_risk_score(self, results: Dict) -> Dict:
        """Calculate overall risk score (0-100)."""
        score = 0

        # Parameter count (25 points)
        param_count = results['parameter_audit']['total_free']
        if param_count > 50:
            param_score = 25
        elif param_count > 30:
            param_score = 20
        else:
            param_score = 10
        score += param_score

        # Sensitivity (25 points)
        fragile_count = results['sensitivity']['fragile_count']
        total_tests = results['sensitivity']['total_tests']
        sensitivity_score = int((fragile_count / total_tests) * 25) if total_tests > 0 else 0
        score += sensitivity_score

        # Walk-forward (25 points)
        sharpe_cv = results['walk_forward']['sharpe_cv']
        if sharpe_cv > 1.0:
            wf_score = 25
        elif sharpe_cv > 0.5:
            wf_score = 15
        else:
            wf_score = 5
        score += wf_score

        # Permutation (25 points)
        p_value = results['permutation']['p_value_sharpe']
        if p_value > 0.20:
            perm_score = 25
        elif p_value > 0.10:
            perm_score = 20
        elif p_value > 0.05:
            perm_score = 15
        else:
            perm_score = 0
        score += perm_score

        if score >= 80:
            risk_level = "CRITICAL"
            rec = "DO NOT DEPLOY"
        elif score >= 60:
            risk_level = "HIGH"
            rec = "Do not deploy"
        elif score >= 30:
            risk_level = "MEDIUM"
            rec = "Proceed with caution"
        else:
            risk_level = "LOW"
            rec = "Acceptable for deployment"

        return {
            'total_score': score,
            'breakdown': {
                'parameter_count': param_score,
                'sensitivity': sensitivity_score,
                'walk_forward': wf_score,
                'permutation': perm_score
            },
            'risk_level': risk_level,
            'recommendation': rec
        }

    def print_final_verdict(self, results: Dict):
        """Print final verdict."""
        risk = results['risk_score']

        print(f"\n  OVERFITTING RISK SCORE: {risk['total_score']}/100")
        print(f"  Risk Level: {risk['risk_level']}")
        print(f"\n  Score Breakdown:")
        print(f"    Parameter Count:  {risk['breakdown']['parameter_count']:>2}/25")
        print(f"    Sensitivity:      {risk['breakdown']['sensitivity']:>2}/25")
        print(f"    Walk-Forward:     {risk['breakdown']['walk_forward']:>2}/25")
        print(f"    Permutation:      {risk['breakdown']['permutation']:>2}/25")
        print(f"    TOTAL:            {risk['total_score']:>2}/100")

        print(f"\n  RECOMMENDATION: {risk['recommendation']}")

        # Key findings
        print(f"\n  KEY FINDINGS:")
        print(f"    - {results['parameter_audit']['total_free']} free parameters")
        print(f"    - {results['sensitivity']['fragile_count']} fragile parameters")
        print(f"    - Sharpe CV: {results['walk_forward']['sharpe_cv']:.2f}")
        print(f"    - Permutation p-value: {results['permutation']['p_value_sharpe']:.3f}")

        # CRITICAL FINDING
        baseline_sharpe = results['sensitivity']['baseline_sharpe']
        if baseline_sharpe < 0:
            print(f"\n  ⚠️⚠️⚠️  CRITICAL: BASELINE SHARPE IS NEGATIVE ({baseline_sharpe:.3f})")
            print(f"  Strategy is LOSING MONEY on average!")
            print(f"  Overfitting is irrelevant - strategy fundamentals are broken.")

    def _calculate_sharpe(self, portfolio: pd.DataFrame, periods_per_year: int = 252) -> float:
        """Calculate annualized Sharpe ratio."""
        if 'portfolio_pnl' not in portfolio.columns or len(portfolio) < 2:
            return 0.0

        daily_pnl = portfolio['portfolio_pnl'].values
        if len(daily_pnl) == 0 or np.std(daily_pnl) == 0:
            return 0.0

        mean_daily = np.mean(daily_pnl)
        std_daily = np.std(daily_pnl)

        sharpe = (mean_daily / std_daily) * np.sqrt(periods_per_year)
        return sharpe


def main():
    """Run fast overfitting audit."""
    red_team = OverfittingRedTeam()

    results = red_team.run_full_audit(
        start_date='2020-01-01',
        end_date='2024-12-31'
    )

    # Save results
    print("\n" + "=" * 80)
    print("Saving results...")

    import json

    json_results = {
        'parameter_audit': results['parameter_audit'],
        'sensitivity': results['sensitivity'],
        'walk_forward': results['walk_forward'],
        'permutation': results['permutation'],
        'risk_score': results['risk_score']
    }

    with open('overfitting_audit_results.json', 'w') as f:
        json.dump(json_results, f, indent=2)

    print("  Results saved to: overfitting_audit_results.json")
    print("\n" + "=" * 80)
    print("RED TEAM AUDIT COMPLETE")
    print("=" * 80)


if __name__ == '__main__':
    main()
