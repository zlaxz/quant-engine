#!/usr/bin/env python3
"""
SIMPLE PRE-BACKTEST AUDIT: Manually verify critical calculation logic
"""

import sys
sys.path.insert(0, '/Users/zstoc/rotation-engine')

import pandas as pd
import numpy as np
from datetime import datetime

# ============================================================================
# AUDIT 1: Profile Detector Logic
# ============================================================================

def audit_profile_logic():
    """Check profile scoring logic is sensible."""
    print("\n" + "="*80)
    print("AUDIT 1: PROFILE DETECTOR FORMULA VERIFICATION")
    print("="*80)

    from src.profiles.features import sigmoid

    # Test sigmoid function
    print("\n1.1: Sigmoid Function")
    print(f"  sigmoid(0) = {sigmoid(pd.Series([0]))[0]:.4f} (expect 0.5)")
    print(f"  sigmoid(5) = {sigmoid(pd.Series([5]))[0]:.4f} (expect ~1.0)")
    print(f"  sigmoid(-5) = {sigmoid(pd.Series([-5]))[0]:.4f} (expect ~0.0)")

    issues = []

    # Verify sigmoid(0) = 0.5
    s0 = float(sigmoid(pd.Series([0]))[0])
    if abs(s0 - 0.5) > 0.001:
        issues.append(f"sigmoid(0) = {s0}, expected 0.5")

    # Verify sigmoid is monotonic
    s_vals = [float(sigmoid(pd.Series([x]))[0]) for x in [-5, -2, 0, 2, 5]]
    monotonic = all(s_vals[i] <= s_vals[i+1] for i in range(len(s_vals)-1))
    print(f"\n  Monotonicity: {monotonic}")
    if not monotonic:
        issues.append("Sigmoid not monotonic")

    return {
        'status': 'CLEAN' if len(issues) == 0 else 'BUGS_FOUND',
        'critical_bugs': len(issues),
        'issues': issues
    }


# ============================================================================
# AUDIT 2: Greeks Calculations
# ============================================================================

def audit_greeks():
    """Verify Greeks calculations against expected ranges."""
    print("\n" + "="*80)
    print("AUDIT 2: GREEKS CALCULATIONS")
    print("="*80)

    from src.pricing.greeks import calculate_all_greeks

    issues = []

    # Test case 1: ATM call
    greeks = calculate_all_greeks(S=450, K=450, T=0.083, r=0.05, sigma=0.25, option_type='call')

    print(f"\nTest 1: ATM Call (S=450, K=450, T=0.083yr, σ=0.25)")
    print(f"  Delta: {greeks['delta']:.4f}")
    print(f"  Gamma: {greeks['gamma']:.6f}")
    print(f"  Vega: {greeks['vega']:.4f}")
    print(f"  Theta: {greeks['theta']:.4f}")

    # ATM call delta should be around 0.5-0.6
    if not (0.45 < greeks['delta'] < 0.70):
        issues.append(f"ATM call delta {greeks['delta']} outside [0.45, 0.70]")
        print(f"  FAIL: Delta out of range")
    else:
        print(f"  PASS: Delta in reasonable range")

    # Gamma should be positive
    if greeks['gamma'] <= 0:
        issues.append(f"Gamma should be positive, got {greeks['gamma']}")
        print(f"  FAIL: Gamma not positive")
    else:
        print(f"  PASS: Gamma positive")

    # Vega should be positive for long call
    if greeks['vega'] <= 0:
        issues.append(f"Vega should be positive, got {greeks['vega']}")
        print(f"  FAIL: Vega not positive")
    else:
        print(f"  PASS: Vega positive")

    # Test case 2: OTM put
    greeks_put = calculate_all_greeks(S=450, K=430, T=0.083, r=0.05, sigma=0.25, option_type='put')

    print(f"\nTest 2: OTM Put (S=450, K=430)")
    print(f"  Delta: {greeks_put['delta']:.4f} (expect negative)")

    if greeks_put['delta'] >= 0:
        issues.append(f"Put delta should be negative, got {greeks_put['delta']}")
        print(f"  FAIL: Delta should be negative")
    else:
        print(f"  PASS: Put delta negative")

    # Test case 3: Greeks scale with quantity
    print(f"\nTest 3: Greeks Scale with Quantity")
    # 1 contract
    greeks_1 = calculate_all_greeks(S=450, K=450, T=0.083, r=0.05, sigma=0.25, option_type='call')
    # When we multiply by 100 (contract multiplier), deltas should match
    print(f"  1 contract delta: {greeks_1['delta']:.4f}")
    print(f"  (× 100 for notional exposure)")

    return {
        'status': 'CLEAN' if len(issues) == 0 else 'BUGS_FOUND',
        'critical_bugs': len(issues),
        'issues': issues
    }


# ============================================================================
# AUDIT 3: Execution Model
# ============================================================================

def audit_execution():
    """Verify execution model calculations."""
    print("\n" + "="*80)
    print("AUDIT 3: EXECUTION MODEL")
    print("="*80)

    from src.trading.execution import ExecutionModel

    model = ExecutionModel()
    issues = []

    # Test 1: ATM spread
    spread = model.get_spread(mid_price=2.50, moneyness=0.0, dte=14, vix_level=20.0)
    print(f"\nTest 1: ATM Spread (mid=$2.50, VIX=20, DTE=14)")
    print(f"  Spread: ${spread:.2f}")

    if not (0.01 < spread < 2.0):
        issues.append(f"Spread ${spread} outside reasonable range (0.01, 2.0)")
        print(f"  FAIL: Out of range")
    else:
        print(f"  PASS: Reasonable spread")

    # Test 2: OTM wider than ATM
    spread_otm = model.get_spread(mid_price=0.50, moneyness=0.15, dte=14, vix_level=20.0)
    print(f"\nTest 2: OTM vs ATM (15% OTM)")
    print(f"  ATM spread: ${spread:.2f}")
    print(f"  OTM spread: ${spread_otm:.2f}")

    if spread_otm <= spread:
        issues.append(f"OTM spread ${spread_otm} should be > ATM ${spread}")
        print(f"  FAIL: OTM not wider")
    else:
        print(f"  PASS: OTM wider than ATM")

    # Test 3: High VIX widens spreads
    spread_low_vix = model.get_spread(mid_price=2.50, moneyness=0.0, dte=14, vix_level=15.0)
    spread_high_vix = model.get_spread(mid_price=2.50, moneyness=0.0, dte=14, vix_level=40.0)

    print(f"\nTest 3: VIX Impact")
    print(f"  VIX=15: ${spread_low_vix:.2f}")
    print(f"  VIX=40: ${spread_high_vix:.2f}")

    if spread_high_vix <= spread_low_vix:
        issues.append(f"High VIX spread ${spread_high_vix} should be > low VIX ${spread_low_vix}")
        print(f"  FAIL: High VIX should widen")
    else:
        print(f"  PASS: High VIX widens spreads")

    # Test 4: Execution prices
    mid = 2.50
    buy = model.get_execution_price(mid, 'buy', 0.0, 14, 20.0, False, quantity=5)
    sell = model.get_execution_price(mid, 'sell', 0.0, 14, 20.0, False, quantity=5)

    print(f"\nTest 4: Execution Prices (mid=${mid})")
    print(f"  Buy: ${buy:.4f} (should be > mid)")
    print(f"  Sell: ${sell:.4f} (should be < mid)")

    if buy <= mid:
        issues.append(f"Buy ${buy} should be > mid ${mid}")
        print(f"  FAIL: Buy price wrong")
    elif sell >= mid:
        issues.append(f"Sell ${sell} should be < mid ${mid}")
        print(f"  FAIL: Sell price wrong")
    else:
        print(f"  PASS: Prices realistic")

    return {
        'status': 'CLEAN' if len(issues) == 0 else 'BUGS_FOUND',
        'critical_bugs': len(issues),
        'issues': issues
    }


# ============================================================================
# AUDIT 4: Trade P&L
# ============================================================================

def audit_trade_pnl():
    """Verify Trade P&L calculations."""
    print("\n" + "="*80)
    print("AUDIT 4: TRADE P&L CALCULATIONS")
    print("="*80)

    from src.trading.trade import Trade, TradeLeg

    issues = []

    # Create ATM straddle
    trade = Trade(
        trade_id='TEST-001',
        profile_name='test',
        entry_date=datetime(2024, 1, 15),
        legs=[
            TradeLeg(strike=450, expiry=datetime(2024, 2, 15), option_type='call', quantity=1, dte=31),
            TradeLeg(strike=450, expiry=datetime(2024, 2, 15), option_type='put', quantity=1, dte=31)
        ],
        entry_prices={0: 2.50, 1: 2.50}
    )

    print(f"\nTest Trade: ATM Straddle")
    print(f"  Entry: 1 call + 1 put, each $2.50")
    print(f"  Entry Cost (calculated): ${trade.entry_cost:.2f}")

    # Expected: 2 contracts × 100 × $5.00 = $1,000
    expected = 2 * 100 * 5.00
    print(f"  Expected: ${expected:.2f}")

    if trade.entry_cost != expected:
        issues.append(f"Entry cost {trade.entry_cost} != {expected}")
        print(f"  FAIL")
    else:
        print(f"  PASS")

    # Close trade
    trade.close(
        exit_date=datetime(2024, 1, 20),
        exit_prices={0: 3.00, 1: 2.00},
        reason='test'
    )

    print(f"\nTrade Close:")
    print(f"  Exit: Call $3.00, Put $2.00")
    print(f"  P&L (calculated): ${trade.realized_pnl:.2f}")

    # Expected: 1×(3-2.5)×100 + 1×(2-2.5)×100 = 50 - 50 = 0
    expected_pnl = 50 - 50
    print(f"  Expected: ${expected_pnl:.2f}")

    if trade.realized_pnl != expected_pnl:
        issues.append(f"P&L {trade.realized_pnl} != {expected_pnl}")
        print(f"  FAIL")
    else:
        print(f"  PASS")

    return {
        'status': 'CLEAN' if len(issues) == 0 else 'BUGS_FOUND',
        'critical_bugs': len(issues),
        'issues': issues
    }


# ============================================================================
# AUDIT 5: Metrics
# ============================================================================

def audit_metrics():
    """Verify metrics calculations."""
    print("\n" + "="*80)
    print("AUDIT 5: METRICS CALCULATIONS")
    print("="*80)

    from src.analysis.metrics import PerformanceMetrics

    issues = []

    # Create sample P&L
    dates = pd.date_range('2024-01-01', periods=100, freq='D')
    pnl = pd.Series([10 if i % 2 == 0 else -5 for i in range(100)], index=dates)
    cum_pnl = pnl.cumsum()

    metrics = PerformanceMetrics(starting_capital=100000)

    # Test Sharpe
    sharpe = metrics.sharpe_ratio(pnl)
    print(f"\nTest Sharpe Ratio:")
    print(f"  Value: {sharpe:.4f}")

    if np.isnan(sharpe):
        issues.append("Sharpe returned NaN")
        print(f"  FAIL: NaN")
    else:
        print(f"  PASS: Valid value")

    # Test Sortino
    sortino = metrics.sortino_ratio(pnl)
    print(f"\nTest Sortino Ratio:")
    print(f"  Value: {sortino:.4f}")

    if np.isnan(sortino):
        issues.append("Sortino returned NaN")
        print(f"  FAIL: NaN")
    else:
        print(f"  PASS: Valid value")

    # Test max drawdown
    max_dd = metrics.max_drawdown(cum_pnl)
    print(f"\nTest Max Drawdown:")
    print(f"  Value: ${max_dd:.2f}")

    if max_dd > 0:
        issues.append(f"Max DD should be negative, got {max_dd}")
        print(f"  FAIL: Should be negative")
    else:
        print(f"  PASS: Negative as expected")

    # Test win rate
    wr = metrics.win_rate(pnl)
    print(f"\nTest Win Rate:")
    print(f"  Value: {wr:.2%}")

    if not (0 <= wr <= 1):
        issues.append(f"Win rate out of [0,1]: {wr}")
        print(f"  FAIL: Out of range")
    else:
        print(f"  PASS: Valid range")

    return {
        'status': 'CLEAN' if len(issues) == 0 else 'BUGS_FOUND',
        'critical_bugs': len(issues),
        'issues': issues
    }


# ============================================================================
# MAIN
# ============================================================================

def main():
    """Run all audits."""
    print("\n" + "="*80)
    print("SIMPLE PRE-BACKTEST AUDIT - CORE CALCULATION VERIFICATION")
    print("="*80)

    results = {
        'profiles': audit_profile_logic(),
        'greeks': audit_greeks(),
        'execution': audit_execution(),
        'trade_pnl': audit_trade_pnl(),
        'metrics': audit_metrics(),
    }

    print("\n" + "="*80)
    print("AUDIT SUMMARY")
    print("="*80)

    total_bugs = 0
    for name, result in results.items():
        status = result['status']
        critical = result['critical_bugs']
        total_bugs += critical

        symbol = 'CLEAN' if status == 'CLEAN' else 'BUGS'
        print(f"{name:20} : {symbol:4} ({critical} critical)")

        if result.get('issues'):
            for issue in result['issues'][:3]:  # Show first 3
                print(f"    - {issue}")

    print("\n" + "="*80)
    if total_bugs == 0:
        print("VERDICT: CLEAN - All critical calculations verified")
        print("         Ready for fresh backtest")
    else:
        print(f"VERDICT: BUGS_FOUND - {total_bugs} critical issues")
        print("         Do NOT run backtest until fixed")
    print("="*80 + "\n")

    return total_bugs == 0


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
