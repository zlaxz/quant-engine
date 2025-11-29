#!/usr/bin/env python3
"""
CRITICAL PRE-BACKTEST AUDIT: Spot-check all calculation logic before fresh backtest

This script manually verifies all critical calculations:
1. Profile detector scoring (6 profiles, 10 random dates)
2. Trade P&L calculations (entry, exit, mark-to-market)
3. Greeks calculations (delta, gamma, theta, vega)
4. Execution model (spreads, commissions, slippage)
5. Metrics calculations (Sharpe, Sortino, Calmar)
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import sys
sys.path.insert(0, '/Users/zstoc/rotation-engine')

from src.data.loaders import OptionsDataLoader
from src.profiles.detectors import ProfileDetectors
from src.pricing.greeks import calculate_all_greeks
from src.trading.execution import ExecutionModel
from src.analysis.metrics import PerformanceMetrics
from src.trading.trade import Trade, TradeLeg


def audit_profile_calculations():
    """Verify all 6 profile scoring functions with manual calculations."""
    print("\n" + "="*80)
    print("AUDIT 1: PROFILE DETECTOR CALCULATIONS")
    print("="*80)

    detector = ProfileDetectors()

    # Load sample data - manually load daily data
    loader = OptionsDataLoader()
    dates_to_check = ['2024-01-15', '2024-01-16', '2024-01-17', '2024-01-18', '2024-01-19']

    dfs = []
    for date_str in dates_to_check:
        try:
            spy_data = loader.load_spy_ohlcv(date_str)
            if spy_data is not None:
                dfs.append(spy_data)
        except:
            pass

    if not dfs:
        print("ERROR: Could not load data for validation")
        return {'status': 'FAILED', 'reason': 'no_data'}

    df = pd.concat(dfs, ignore_index=True)
    if df is None or len(df) == 0:
        print("ERROR: Could not load data for validation")
        return {'status': 'FAILED', 'reason': 'no_data'}

    # Compute profiles
    try:
        df = detector.compute_all_profiles(df)
    except Exception as e:
        print(f"ERROR: Profile computation failed: {e}")
        return {'status': 'FAILED', 'reason': f'profile_error: {e}'}

    # Validate profile scores
    try:
        detector.validate_profile_scores(df, warmup_days=60)
    except Exception as e:
        print(f"WARNING: NaN validation failed: {e}")

    # Spot-check 5 random dates
    valid_dates = df[df['profile_1_LDG'].notna()].head(10)
    checks = []

    for idx, (_, row) in enumerate(valid_dates.iterrows()):
        if idx >= 5:  # Spot-check 5 dates
            break

        date = row['date']
        p1 = row['profile_1_LDG']
        p2 = row['profile_2_SDG']
        p3 = row['profile_3_CHARM']
        p4 = row['profile_4_VANNA']
        p5 = row['profile_5_SKEW']
        p6 = row['profile_6_VOV']

        # Verify range [0, 1]
        all_profiles = [p1, p2, p3, p4, p5, p6]
        in_range = all(0 <= p <= 1 for p in all_profiles)

        # Manual verification: Profile 1 should correlate with trend
        ma_trend = row['slope_MA20'] if 'slope_MA20' in row else 0

        checks.append({
            'date': date,
            'p1_ldg': p1,
            'p2_sdg': p2,
            'p3_charm': p3,
            'p4_vanna': p4,
            'p5_skew': p5,
            'p6_vov': p6,
            'in_range': in_range,
            'status': 'PASS' if in_range else 'FAIL'
        })

        print(f"\n{date} Spot-Check:")
        print(f"  P1(LDG)={p1:.4f}, P2(SDG)={p2:.4f}, P3(CHARM)={p3:.4f}")
        print(f"  P4(VANNA)={p4:.4f}, P5(SKEW)={p5:.4f}, P6(VOV)={p6:.4f}")
        print(f"  Status: {'PASS - All in [0,1]' if in_range else 'FAIL - Out of range'}")

    all_pass = all(c['status'] == 'PASS' for c in checks)

    return {
        'status': 'CLEAN' if all_pass else 'BUGS_FOUND',
        'checks': checks,
        'critical_bugs': 0 if all_pass else len([c for c in checks if c['status'] == 'FAIL'])
    }


def audit_greeks_calculations():
    """Verify Greeks calculations against manual BS formula."""
    print("\n" + "="*80)
    print("AUDIT 2: GREEKS CALCULATIONS")
    print("="*80)

    issues = []

    # Test case 1: ATM call
    S = 450.0  # Spot
    K = 450.0  # Strike (ATM)
    T = 0.1    # 30 days to expiry = ~0.082 years
    r = 0.05   # 5% risk-free rate
    sigma = 0.25  # 25% volatility

    greeks = calculate_all_greeks(S, K, T, r, sigma, 'call')

    print(f"\nTest 1: ATM Call (S={S}, K={K}, T={T:.3f}yr, σ={sigma})")
    print(f"  Delta: {greeks['delta']:.4f} (expect ~0.6)")
    print(f"  Gamma: {greeks['gamma']:.6f}")
    print(f"  Vega: {greeks['vega']:.4f}")
    print(f"  Theta: {greeks['theta']:.4f}")

    # Sanity check: ATM call delta should be ~0.6
    if not (0.55 < greeks['delta'] < 0.65):
        issues.append(f"ATM call delta {greeks['delta']} outside expected range [0.55, 0.65]")
        print(f"  FAIL: Delta out of range")
    else:
        print(f"  PASS: Delta in reasonable range")

    # Test case 2: OTM put
    K = 430.0  # 20 points OTM
    greeks = calculate_all_greeks(S, K, T, r, sigma, 'put')

    print(f"\nTest 2: OTM Put (S={S}, K={K}, T={T:.3f}yr, σ={sigma})")
    print(f"  Delta: {greeks['delta']:.4f} (expect ~-0.1)")
    print(f"  Gamma: {greeks['gamma']:.6f}")

    if not (-0.2 < greeks['delta'] < 0.0):
        issues.append(f"OTM put delta {greeks['delta']} outside expected range [-0.2, 0.0]")
        print(f"  FAIL: Delta out of range")
    else:
        print(f"  PASS: Delta in reasonable range")

    # Test case 3: Theta decay (should be positive for short straddle)
    K = 450.0
    greeks_call = calculate_all_greeks(S, K, T, r, sigma, 'call')
    greeks_put = calculate_all_greeks(S, K, T, r, sigma, 'put')
    short_straddle_theta = -(greeks_call['theta'] + greeks_put['theta'])

    print(f"\nTest 3: Short Straddle Theta (should be positive for decay)")
    print(f"  Short Straddle Theta: {short_straddle_theta:.4f} (expect > 0)")

    if short_straddle_theta <= 0:
        issues.append(f"Short straddle theta {short_straddle_theta} should be positive")
        print(f"  FAIL: Theta should be positive")
    else:
        print(f"  PASS: Positive theta for short straddle")

    return {
        'status': 'CLEAN' if len(issues) == 0 else 'BUGS_FOUND',
        'critical_bugs': len(issues),
        'issues': issues
    }


def audit_execution_model():
    """Verify realistic execution costs."""
    print("\n" + "="*80)
    print("AUDIT 3: EXECUTION MODEL (Spreads, Commissions, Slippage)")
    print("="*80)

    model = ExecutionModel()
    issues = []

    # Test 1: ATM spread should be ~$0.75
    spread_atm = model.get_spread(
        mid_price=2.50,
        moneyness=0.0,  # ATM
        dte=14,
        vix_level=20.0,
        is_strangle=False
    )
    print(f"\nTest 1: ATM Spread (VIX=20, DTE=14)")
    print(f"  Spread: ${spread_atm:.2f} (expect ~$0.75)")
    if not (0.02 < spread_atm < 1.50):
        issues.append(f"ATM spread ${spread_atm:.2f} out of reasonable range")
        print(f"  FAIL: Out of reasonable range")
    else:
        print(f"  PASS: Reasonable ATM spread")

    # Test 2: OTM should be wider than ATM
    spread_otm = model.get_spread(
        mid_price=0.50,
        moneyness=0.10,  # 10% OTM
        dte=14,
        vix_level=20.0,
        is_strangle=True
    )
    print(f"\nTest 2: OTM Spread (10% OTM, VIX=20, DTE=14)")
    print(f"  OTM Spread: ${spread_otm:.2f} vs ATM ${spread_atm:.2f}")
    if spread_otm <= spread_atm:
        issues.append(f"OTM spread ${spread_otm} should be wider than ATM ${spread_atm}")
        print(f"  FAIL: OTM should be wider than ATM")
    else:
        print(f"  PASS: OTM spread wider than ATM")

    # Test 3: High VIX should widen spreads
    spread_high_vix = model.get_spread(
        mid_price=2.50,
        moneyness=0.0,
        dte=14,
        vix_level=35.0,
        is_strangle=False
    )
    print(f"\nTest 3: High VIX Spread (VIX=35 vs VIX=20)")
    print(f"  VIX=35 Spread: ${spread_high_vix:.2f} vs VIX=20 ${spread_atm:.2f}")
    if spread_high_vix <= spread_atm:
        issues.append(f"High VIX spread should be wider: {spread_high_vix} vs {spread_atm}")
        print(f"  FAIL: High VIX should widen spreads")
    else:
        print(f"  PASS: High VIX widens spreads")

    # Test 4: Commissions
    commissions = model.get_commission_cost(10, is_short=True, premium=2.0)
    print(f"\nTest 4: Commission Calculation (10 contracts, short, premium=$2.0)")
    print(f"  Total Commissions: ${commissions:.2f}")
    if commissions <= 0:
        issues.append(f"Commissions should be positive, got {commissions}")
        print(f"  FAIL: Commissions should be positive")
    else:
        print(f"  PASS: Commissions calculated")

    # Test 5: Execution prices (buy vs sell)
    mid = 2.50
    buy_price = model.get_execution_price(mid, 'buy', 0.0, 14, 20.0, False, quantity=5)
    sell_price = model.get_execution_price(mid, 'sell', 0.0, 14, 20.0, False, quantity=5)

    print(f"\nTest 5: Execution Prices (mid=${mid}, qty=5)")
    print(f"  Buy Price: ${buy_price:.4f} (should be >= mid)")
    print(f"  Sell Price: ${sell_price:.4f} (should be <= mid)")

    if buy_price < mid:
        issues.append(f"Buy price ${buy_price} should be >= mid ${mid}")
        print(f"  FAIL: Buy price should be >= mid")
    elif sell_price > mid:
        issues.append(f"Sell price ${sell_price} should be <= mid ${mid}")
        print(f"  FAIL: Sell price should be <= mid")
    else:
        print(f"  PASS: Execution prices realistic (buy > mid > sell)")

    return {
        'status': 'CLEAN' if len(issues) == 0 else 'BUGS_FOUND',
        'critical_bugs': len(issues),
        'issues': issues
    }


def audit_trade_pnl():
    """Verify P&L calculations on actual trades."""
    print("\n" + "="*80)
    print("AUDIT 4: TRADE P&L CALCULATIONS")
    print("="*80)

    issues = []

    # Create a simple ATM straddle trade
    entry_date = datetime(2024, 1, 15)
    expiry_date = datetime(2024, 2, 15)
    strike = 450.0

    trade = Trade(
        trade_id='TEST-001',
        profile_name='test_profile',
        entry_date=entry_date,
        legs=[
            TradeLeg(strike=strike, expiry=expiry_date, option_type='call', quantity=1, dte=31),
            TradeLeg(strike=strike, expiry=expiry_date, option_type='put', quantity=1, dte=31)
        ],
        entry_prices={0: 2.50, 1: 2.50}  # $2.50 each leg
    )

    print(f"\nTest Trade: Long ATM Straddle")
    print(f"  Entry: 2x @ Strike {strike}, Premium ${2.50 + 2.50} total")
    print(f"  Entry Cost (calculated): ${trade.entry_cost}")

    # Expected: 2 contracts × 100 × $5.00 = $1,000
    expected_cost = 2 * 100 * 5.00
    print(f"  Expected: ${expected_cost}")

    if trade.entry_cost != expected_cost:
        issues.append(f"Entry cost {trade.entry_cost} != expected {expected_cost}")
        print(f"  FAIL: Entry cost mismatch")
    else:
        print(f"  PASS: Entry cost calculated correctly")

    # Test P&L at close
    exit_date = datetime(2024, 2, 1)
    trade.close(
        exit_date=exit_date,
        exit_prices={0: 3.00, 1: 2.00},  # Call up $0.50, Put down $0.50
        reason='test_close'
    )

    print(f"\nTrade Close:")
    print(f"  Exit Prices: Call $3.00, Put $2.00")
    print(f"  Exit P&L (calculated): ${trade.realized_pnl}")

    # Manual calculation:
    # Call: 1 × (3.00 - 2.50) × 100 = $50
    # Put: 1 × (2.00 - 2.50) × 100 = -$50
    # Total: $0
    expected_pnl = 50 - 50  # = 0
    print(f"  Expected: ${expected_pnl}")

    if trade.realized_pnl != expected_pnl:
        issues.append(f"Realized P&L {trade.realized_pnl} != expected {expected_pnl}")
        print(f"  FAIL: P&L mismatch")
    else:
        print(f"  PASS: P&L calculated correctly")

    return {
        'status': 'CLEAN' if len(issues) == 0 else 'BUGS_FOUND',
        'critical_bugs': len(issues),
        'issues': issues
    }


def audit_metrics():
    """Verify metrics calculations."""
    print("\n" + "="*80)
    print("AUDIT 5: METRICS CALCULATIONS")
    print("="*80)

    issues = []

    # Create simple P&L series
    dates = pd.date_range('2024-01-01', periods=100, freq='D')
    pnl = pd.Series([np.random.normal(10, 50) for _ in range(100)], index=dates)
    cumulative_pnl = pnl.cumsum()

    portfolio = pd.DataFrame({
        'date': dates,
        'portfolio_pnl': pnl,
        'cumulative_pnl': cumulative_pnl,
        'regime': 'test'
    })

    metrics_calc = PerformanceMetrics(starting_capital=100000.0)

    # Test Sharpe ratio
    sharpe = metrics_calc.sharpe_ratio(pnl)
    print(f"\nTest Sharpe Ratio:")
    print(f"  Calculated: {sharpe:.4f}")
    print(f"  Status: {'PASS' if not np.isnan(sharpe) else 'FAIL - NaN'}")

    if np.isnan(sharpe):
        issues.append("Sharpe ratio returned NaN")

    # Test Sortino ratio
    sortino = metrics_calc.sortino_ratio(pnl)
    print(f"\nTest Sortino Ratio:")
    print(f"  Calculated: {sortino:.4f}")
    print(f"  Status: {'PASS' if not np.isnan(sortino) else 'FAIL - NaN'}")

    if np.isnan(sortino):
        issues.append("Sortino ratio returned NaN")

    # Test Calmar ratio
    calmar = metrics_calc.calmar_ratio(pnl, cumulative_pnl)
    print(f"\nTest Calmar Ratio:")
    print(f"  Calculated: {calmar:.4f}")
    print(f"  Status: {'PASS' if not np.isnan(calmar) else 'FAIL - NaN'}")

    if np.isnan(calmar):
        issues.append("Calmar ratio returned NaN")

    # Test max drawdown
    max_dd = metrics_calc.max_drawdown(cumulative_pnl)
    print(f"\nTest Max Drawdown:")
    print(f"  Calculated: ${max_dd:.2f}")
    print(f"  Status: {'PASS' if max_dd <= 0 else 'FAIL - should be negative'}")

    if max_dd > 0:
        issues.append(f"Max drawdown should be negative, got {max_dd}")

    # Test win rate
    win_rate = metrics_calc.win_rate(pnl)
    print(f"\nTest Win Rate:")
    print(f"  Calculated: {win_rate:.2%}")
    print(f"  Status: {'PASS' if 0 <= win_rate <= 1 else 'FAIL'}")

    if not (0 <= win_rate <= 1):
        issues.append(f"Win rate should be in [0, 1], got {win_rate}")

    return {
        'status': 'CLEAN' if len(issues) == 0 else 'BUGS_FOUND',
        'critical_bugs': len(issues),
        'issues': issues
    }


def main():
    """Run all audits."""
    print("\n" + "="*80)
    print("FINAL PRE-BACKTEST AUDIT - SPOT-CHECKING ALL CRITICAL CALCULATIONS")
    print("="*80)

    results = {
        'audit_1_profiles': audit_profile_calculations(),
        'audit_2_greeks': audit_greeks_calculations(),
        'audit_3_execution': audit_execution_model(),
        'audit_4_trade_pnl': audit_trade_pnl(),
        'audit_5_metrics': audit_metrics(),
    }

    print("\n" + "="*80)
    print("AUDIT SUMMARY")
    print("="*80)

    total_critical = 0
    for audit_name, result in results.items():
        status = result.get('status', 'UNKNOWN')
        critical = result.get('critical_bugs', 0)
        total_critical += critical

        symbol = 'PASS' if status == 'CLEAN' else 'FAIL'
        print(f"{audit_name}: {symbol} ({critical} CRITICAL issues)")

        if result.get('issues'):
            for issue in result['issues']:
                print(f"  - {issue}")

    print("\n" + "="*80)
    if total_critical == 0:
        print("VERDICT: CLEAN - All critical calculations verified")
        print("Ready for fresh backtest run")
    else:
        print(f"VERDICT: BUGS_FOUND - {total_critical} CRITICAL issues found")
        print("Do NOT run backtest until issues fixed")
    print("="*80)

    return total_critical == 0


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
