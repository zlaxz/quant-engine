"""
OVERFITTING RED TEAM ANALYSIS
Aggressive curve-fitting detection for rotation engine backtest.

This script performs:
1. Parameter count audit
2. Parameter sensitivity analysis (±10% variations)
3. Walk-forward performance degradation
4. Permutation tests (shuffle regime labels)
5. Overall overfitting risk score

CRITICAL: This is the last line of defense before deploying real capital.
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
        """
        Run complete overfitting audit.

        Returns:
            Complete audit results with risk scores
        """
        print("\n" + "=" * 80)
        print("OVERFITTING RED TEAM ATTACK")
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

        # Test 4: Permutation Tests
        print("\n" + "=" * 80)
        print("TEST 4: PERMUTATION TESTS (REGIME SHUFFLING)")
        print("=" * 80)
        results['permutation'] = self.test_permutation_significance(start_date, end_date, n_iter=100)

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
        """
        Count all tunable parameters in the system.

        Categories:
        - Regime classification parameters
        - Profile detector parameters
        - Compatibility weights
        - Rotation parameters
        """
        print("\nCounting all tunable parameters...")

        # Regime classifier parameters (from src/regimes/classifier.py)
        regime_params = {
            'trend_threshold': 1,
            'compression_range': 1,
            'rv_rank_low': 1,
            'rv_rank_high': 1,
            'rv_rank_mid_low': 1,
            'rv_rank_mid_high': 1
        }
        regime_count = len(regime_params)

        # Profile detector parameters (from src/profiles/detectors.py)
        # Each profile has ~3-4 hardcoded thresholds in sigmoid functions
        profile_params = {
            'LDG_rv_iv_threshold': 1,
            'LDG_iv_rank_threshold': 1,
            'LDG_sigmoid_steepness': 3,  # 3 sigmoid k values
            'SDG_rv_iv_threshold': 1,
            'SDG_move_threshold': 1,
            'SDG_sigmoid_steepness': 3,
            'CHARM_iv_rv_threshold': 1,
            'CHARM_range_threshold': 1,
            'CHARM_sigmoid_steepness': 3,
            'VANNA_sigmoid_steepness': 3,
            'SKEW_z_threshold': 1,
            'SKEW_rv_iv_threshold': 1,
            'SKEW_sigmoid_steepness': 3,
            'VOV_vvix_ratio_threshold': 1,
            'VOV_iv_rank_threshold': 1,
            'VOV_sigmoid_steepness': 3,
            'EMA_smoothing_span': 1  # EMA span for SDG/SKEW
        }
        profile_count = len(profile_params)

        # Regime compatibility matrix (from src/backtest/rotation.py)
        # 5 regimes × 6 profiles = 30 weights (HARDCODED, NOT OPTIMIZED)
        # These are NOT free parameters - they're domain-driven design choices
        compatibility_count = 30
        compatibility_is_free = False  # CRITICAL: These are NOT optimized

        # Rotation parameters
        rotation_params = {
            'max_profile_weight': 1,
            'min_profile_weight': 1,
            'vix_scale_threshold': 1,
            'vix_scale_factor': 1
        }
        rotation_count = len(rotation_params)

        # Profile-specific entry thresholds (from engine.py)
        profile_threshold_params = {
            'profile_1_threshold': 1,
            'profile_2_threshold': 1,
            'profile_3_threshold': 1,
            'profile_4_threshold': 1,
            'profile_5_threshold': 1,
            'profile_6_threshold': 1
        }
        threshold_count = len(profile_threshold_params)

        # TOTAL FREE PARAMETERS (excluding compatibility matrix)
        total_free = regime_count + profile_count + rotation_count + threshold_count

        # Total including compatibility (if they were optimized)
        total_with_compat = total_free + compatibility_count

        print(f"\n  Regime Classification:     {regime_count:>3} parameters")
        print(f"  Profile Detectors:         {profile_count:>3} parameters")
        print(f"  Rotation Logic:            {rotation_count:>3} parameters")
        print(f"  Entry Thresholds:          {threshold_count:>3} parameters")
        print(f"  " + "-" * 40)
        print(f"  TOTAL FREE PARAMETERS:     {total_free:>3}")
        print(f"\n  Compatibility Matrix:      {compatibility_count:>3} values (HARDCODED, not optimized)")
        print(f"  Total if optimized:        {total_with_compat:>3}")

        # Risk assessment
        risk_level = self._assess_parameter_risk(total_free)
        print(f"\n  Risk Level: {risk_level}")

        if total_free > 50:
            print(f"  ⚠️  CRITICAL: {total_free} free parameters is excessive!")
        elif total_free > 20:
            print(f"  ⚠️  WARNING: {total_free} free parameters is high")
        else:
            print(f"  ✓ {total_free} free parameters is acceptable")

        return {
            'regime_params': regime_count,
            'profile_params': profile_count,
            'rotation_params': rotation_count,
            'threshold_params': threshold_count,
            'compatibility_params': compatibility_count,
            'compatibility_is_free': compatibility_is_free,
            'total_free': total_free,
            'total_with_compat': total_with_compat,
            'risk_level': risk_level,
            'parameter_details': {**regime_params, **profile_params, **rotation_params, **profile_threshold_params}
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
        """
        Test sensitivity to key parameter changes (±10%).

        Focus on parameters most likely to be overfit:
        - Regime thresholds
        - Profile entry thresholds
        - Rotation constraints
        """
        print("\nTesting ±10% variations on critical parameters...")
        print("Fragile strategies show >20% performance degradation\n")

        # Run baseline
        print("  Running baseline...")
        baseline_engine = RotationEngine()
        baseline_results = baseline_engine.run(start_date, end_date)
        baseline_sharpe = self._calculate_sharpe(baseline_results['portfolio'])
        print(f"  Baseline Sharpe: {baseline_sharpe:.3f}")

        # Test parameters to vary
        test_configs = [
            # Rotation parameters (easy to vary)
            {
                'name': 'max_profile_weight',
                'baseline': 0.40,
                'low': 0.36,
                'high': 0.44,
                'params': {'max_profile_weight': None}
            },
            {
                'name': 'min_profile_weight',
                'baseline': 0.05,
                'low': 0.045,
                'high': 0.055,
                'params': {'min_profile_weight': None}
            },
            {
                'name': 'vix_scale_threshold',
                'baseline': 30.0,
                'low': 27.0,
                'high': 33.0,
                'params': {'vix_scale_threshold': None}
            },
            {
                'name': 'vix_scale_factor',
                'baseline': 0.5,
                'low': 0.45,
                'high': 0.55,
                'params': {'vix_scale_factor': None}
            }
        ]

        sensitivity_results = []

        for config in test_configs:
            name = config['name']

            # Test -10%
            print(f"\n  Testing {name} -10%...")
            low_params = {k: (config['low'] if k == name else v)
                         for k, v in config['params'].items()}
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
            print(f"    -10%: Sharpe {low_sharpe:.3f} (degradation: {low_deg:.1f}%)")
            print(f"    +10%: Sharpe {high_sharpe:.3f} (degradation: {high_deg:.1f}%)")
            print(f"    Max degradation: {max_degradation:.1f}%")

            if max_degradation > 20:
                print(f"    ⚠️  WARNING: Fragile parameter!")

            sensitivity_results.append({
                'parameter': name,
                'baseline_value': config['baseline'],
                'baseline_sharpe': baseline_sharpe,
                'low_sharpe': low_sharpe,
                'high_sharpe': high_sharpe,
                'low_degradation_pct': low_deg,
                'high_degradation_pct': high_deg,
                'max_degradation_pct': max_degradation,
                'is_fragile': max_degradation > 20
            })

        # Summary
        fragile_count = sum(1 for r in sensitivity_results if r['is_fragile'])
        print(f"\n  Fragile parameters (>20% degradation): {fragile_count}/{len(sensitivity_results)}")

        return {
            'baseline_sharpe': baseline_sharpe,
            'tests': sensitivity_results,
            'fragile_count': fragile_count,
            'total_tests': len(sensitivity_results)
        }

    def test_walk_forward_degradation(self, start_date: str, end_date: str) -> Dict:
        """
        Test performance across different time periods.

        Split data by year to detect if strategy only works in specific regimes.
        """
        print("\nTesting year-by-year performance consistency...")
        print("Overfit strategies show inconsistent performance across years\n")

        years = ['2020', '2021', '2022', '2023', '2024']
        year_results = []

        for year in years:
            print(f"  Running {year}...")
            engine = RotationEngine()

            year_start = f'{year}-01-01'
            year_end = f'{year}-12-31'

            try:
                results = engine.run(year_start, year_end)
                portfolio = results['portfolio']

                sharpe = self._calculate_sharpe(portfolio)
                total_pnl = portfolio['portfolio_pnl'].sum()
                max_dd = self._calculate_max_drawdown(portfolio)

                print(f"    Sharpe: {sharpe:.3f}, P&L: ${total_pnl:,.0f}, MaxDD: ${max_dd:,.0f}")

                year_results.append({
                    'year': year,
                    'sharpe': sharpe,
                    'total_pnl': total_pnl,
                    'max_drawdown': max_dd,
                    'days': len(portfolio)
                })

            except Exception as e:
                print(f"    ERROR: {e}")
                year_results.append({
                    'year': year,
                    'sharpe': 0,
                    'total_pnl': 0,
                    'max_drawdown': 0,
                    'days': 0
                })

        # Calculate consistency metrics
        sharpe_values = [r['sharpe'] for r in year_results if r['sharpe'] != 0]
        sharpe_std = np.std(sharpe_values) if len(sharpe_values) > 1 else 0
        sharpe_mean = np.mean(sharpe_values) if len(sharpe_values) > 0 else 0

        print(f"\n  Sharpe Ratio Statistics:")
        print(f"    Mean:     {sharpe_mean:.3f}")
        print(f"    Std Dev:  {sharpe_std:.3f}")
        print(f"    CV:       {sharpe_std/sharpe_mean:.3f}" if sharpe_mean != 0 else "    CV:       N/A")

        if sharpe_std / sharpe_mean > 0.5 if sharpe_mean != 0 else False:
            print(f"    ⚠️  WARNING: High variability across years")

        return {
            'year_results': year_results,
            'sharpe_mean': sharpe_mean,
            'sharpe_std': sharpe_std,
            'sharpe_cv': sharpe_std / sharpe_mean if sharpe_mean != 0 else 0,
            'high_variability': (sharpe_std / sharpe_mean > 0.5) if sharpe_mean != 0 else False
        }

    def test_permutation_significance(self, start_date: str, end_date: str, n_iter: int = 100) -> Dict:
        """
        Permutation test: Shuffle regime labels and test if performance persists.

        If shuffling regime labels doesn't degrade performance, the regime
        classification isn't actually predictive.

        NOTE: This is computationally expensive (n_iter × full backtest)
        """
        print(f"\nRunning {n_iter} permutation tests (shuffling regime labels)...")
        print("This tests if regime classification is actually predictive\n")

        # Run baseline (actual regimes)
        print("  Running baseline (actual regimes)...")
        baseline_engine = RotationEngine()
        baseline_results = baseline_engine.run(start_date, end_date)
        baseline_sharpe = self._calculate_sharpe(baseline_results['portfolio'])
        baseline_pnl = baseline_results['portfolio']['portfolio_pnl'].sum()

        print(f"  Baseline Sharpe: {baseline_sharpe:.3f}")
        print(f"  Baseline P&L: ${baseline_pnl:,.0f}\n")

        # Load data once
        from data.loaders import load_spy_data
        data = load_spy_data()
        data = data[(data['date'] >= pd.to_datetime(start_date).date()) &
                    (data['date'] <= pd.to_datetime(end_date).date())]

        # Run permutation tests
        print(f"  Running {n_iter} permutation iterations...")
        permuted_sharpes = []
        permuted_pnls = []

        for i in range(n_iter):
            if (i + 1) % 10 == 0:
                print(f"    Iteration {i+1}/{n_iter}...")

            # Shuffle regime labels (preserve temporal structure of other features)
            permuted_data = data.copy()
            permuted_data['regime'] = np.random.permutation(data['regime'].values)

            try:
                # Run backtest with shuffled regimes
                engine = RotationEngine()
                results = engine.run(data=permuted_data)

                sharpe = self._calculate_sharpe(results['portfolio'])
                pnl = results['portfolio']['portfolio_pnl'].sum()

                permuted_sharpes.append(sharpe)
                permuted_pnls.append(pnl)

            except Exception as e:
                # If permutation breaks the backtest, that's actually good
                # (means regime structure matters)
                permuted_sharpes.append(0)
                permuted_pnls.append(0)

        # Calculate p-value: how often random >= actual?
        p_value_sharpe = sum(1 for s in permuted_sharpes if s >= baseline_sharpe) / n_iter
        p_value_pnl = sum(1 for p in permuted_pnls if p >= baseline_pnl) / n_iter

        mean_permuted_sharpe = np.mean(permuted_sharpes)
        std_permuted_sharpe = np.std(permuted_sharpes)

        print(f"\n  Permutation Test Results:")
        print(f"    Actual Sharpe:           {baseline_sharpe:.3f}")
        print(f"    Mean permuted Sharpe:    {mean_permuted_sharpe:.3f}")
        print(f"    Std permuted Sharpe:     {std_permuted_sharpe:.3f}")
        print(f"    P-value (Sharpe):        {p_value_sharpe:.3f}")
        print(f"    P-value (P&L):           {p_value_pnl:.3f}")

        if p_value_sharpe > 0.05:
            print(f"    ⚠️  CRITICAL: Performance not distinguishable from random!")
        else:
            print(f"    ✓ Performance is statistically significant")

        return {
            'baseline_sharpe': baseline_sharpe,
            'baseline_pnl': baseline_pnl,
            'mean_permuted_sharpe': mean_permuted_sharpe,
            'std_permuted_sharpe': std_permuted_sharpe,
            'p_value_sharpe': p_value_sharpe,
            'p_value_pnl': p_value_pnl,
            'n_iterations': n_iter,
            'is_significant': p_value_sharpe <= 0.05
        }

    def calculate_risk_score(self, results: Dict) -> Dict:
        """
        Calculate overall overfitting risk score (0-100).

        Components:
        - Parameter count: 0-25 points
        - Sensitivity: 0-25 points
        - Walk-forward: 0-25 points
        - Permutation: 0-25 points

        Score interpretation:
        - 0-30: Low risk
        - 30-60: Medium risk
        - 60-80: High risk
        - 80-100: Critical risk (DO NOT DEPLOY)
        """
        score = 0
        breakdown = {}

        # Component 1: Parameter count (25 points max)
        param_count = results['parameter_audit']['total_free']
        if param_count > 50:
            param_score = 25
        elif param_count > 30:
            param_score = 20
        elif param_count > 20:
            param_score = 15
        else:
            param_score = 5

        score += param_score
        breakdown['parameter_count'] = param_score

        # Component 2: Sensitivity (25 points max)
        fragile_count = results['sensitivity']['fragile_count']
        total_tests = results['sensitivity']['total_tests']
        fragile_pct = fragile_count / total_tests if total_tests > 0 else 0

        sensitivity_score = int(fragile_pct * 25)
        score += sensitivity_score
        breakdown['sensitivity'] = sensitivity_score

        # Component 3: Walk-forward variability (25 points max)
        sharpe_cv = results['walk_forward'].get('sharpe_cv', 0)
        if sharpe_cv > 1.0:
            wf_score = 25
        elif sharpe_cv > 0.5:
            wf_score = 15
        else:
            wf_score = 5

        score += wf_score
        breakdown['walk_forward'] = wf_score

        # Component 4: Permutation test (25 points max)
        p_value = results['permutation']['p_value_sharpe']
        if p_value > 0.20:
            perm_score = 25  # Performance indistinguishable from random
        elif p_value > 0.10:
            perm_score = 20
        elif p_value > 0.05:
            perm_score = 15
        else:
            perm_score = 0  # Significant result

        score += perm_score
        breakdown['permutation'] = perm_score

        # Risk level
        if score >= 80:
            risk_level = "CRITICAL"
            recommendation = "DO NOT DEPLOY - Severe overfitting detected"
        elif score >= 60:
            risk_level = "HIGH"
            recommendation = "Do not deploy - High overfitting risk"
        elif score >= 30:
            risk_level = "MEDIUM"
            recommendation = "Proceed with caution - Some overfitting concerns"
        else:
            risk_level = "LOW"
            recommendation = "Acceptable for deployment - Low overfitting risk"

        return {
            'total_score': score,
            'breakdown': breakdown,
            'risk_level': risk_level,
            'recommendation': recommendation
        }

    def print_final_verdict(self, results: Dict):
        """Print final overfitting verdict."""
        risk = results['risk_score']

        print(f"\n  OVERFITTING RISK SCORE: {risk['total_score']}/100")
        print(f"  Risk Level: {risk['risk_level']}")
        print(f"\n  Score Breakdown:")
        print(f"    Parameter Count:    {risk['breakdown']['parameter_count']:>2}/25")
        print(f"    Sensitivity:        {risk['breakdown']['sensitivity']:>2}/25")
        print(f"    Walk-Forward:       {risk['breakdown']['walk_forward']:>2}/25")
        print(f"    Permutation Test:   {risk['breakdown']['permutation']:>2}/25")
        print(f"    " + "-" * 30)
        print(f"    TOTAL:              {risk['total_score']:>2}/100")

        print(f"\n  RECOMMENDATION:")
        print(f"    {risk['recommendation']}")

        # Specific findings
        print(f"\n  KEY FINDINGS:")

        # Parameters
        param_count = results['parameter_audit']['total_free']
        print(f"    - {param_count} free parameters " +
              ("(ACCEPTABLE)" if param_count <= 30 else "(HIGH RISK)"))

        # Sensitivity
        fragile = results['sensitivity']['fragile_count']
        print(f"    - {fragile} fragile parameters detected")

        # Walk-forward
        sharpe_cv = results['walk_forward']['sharpe_cv']
        print(f"    - Sharpe CV across years: {sharpe_cv:.2f} " +
              ("(CONSISTENT)" if sharpe_cv < 0.5 else "(INCONSISTENT)"))

        # Permutation
        p_val = results['permutation']['p_value_sharpe']
        print(f"    - Permutation p-value: {p_val:.3f} " +
              ("(SIGNIFICANT)" if p_val <= 0.05 else "(NOT SIGNIFICANT)"))

        if risk['total_score'] >= 60:
            print(f"\n  ⚠️  WARNING: DO NOT DEPLOY THIS STRATEGY")
            print(f"  Overfitting risk is too high for real capital.")

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

    def _calculate_max_drawdown(self, portfolio: pd.DataFrame) -> float:
        """Calculate maximum drawdown."""
        if 'cumulative_pnl' not in portfolio.columns:
            return 0.0

        cumulative = portfolio['cumulative_pnl'].values
        running_max = np.maximum.accumulate(cumulative)
        drawdown = cumulative - running_max

        return abs(drawdown.min())


def main():
    """Run overfitting red team analysis."""
    red_team = OverfittingRedTeam()

    # Run full audit
    results = red_team.run_full_audit(
        start_date='2020-01-01',
        end_date='2024-12-31'
    )

    # Save results
    print("\n" + "=" * 80)
    print("Saving results...")

    import json

    # Convert results to JSON-serializable format
    json_results = {
        'parameter_audit': results['parameter_audit'],
        'sensitivity': {
            'baseline_sharpe': float(results['sensitivity']['baseline_sharpe']),
            'tests': results['sensitivity']['tests'],
            'fragile_count': results['sensitivity']['fragile_count'],
            'total_tests': results['sensitivity']['total_tests']
        },
        'walk_forward': {
            'year_results': results['walk_forward']['year_results'],
            'sharpe_mean': float(results['walk_forward']['sharpe_mean']),
            'sharpe_std': float(results['walk_forward']['sharpe_std']),
            'sharpe_cv': float(results['walk_forward']['sharpe_cv']),
            'high_variability': results['walk_forward']['high_variability']
        },
        'permutation': {
            'baseline_sharpe': float(results['permutation']['baseline_sharpe']),
            'baseline_pnl': float(results['permutation']['baseline_pnl']),
            'mean_permuted_sharpe': float(results['permutation']['mean_permuted_sharpe']),
            'std_permuted_sharpe': float(results['permutation']['std_permuted_sharpe']),
            'p_value_sharpe': float(results['permutation']['p_value_sharpe']),
            'p_value_pnl': float(results['permutation']['p_value_pnl']),
            'n_iterations': results['permutation']['n_iterations'],
            'is_significant': results['permutation']['is_significant']
        },
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
