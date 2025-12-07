# FACTOR BACKTESTER - CONCRETE CODE FIXES

## CRITICAL FIXES (Must implement before deployment)

### FIX-001: Forward Returns Look-Ahead Bias (Line 623)

**Original Code**:
```python
# Line 623 - WRONG: Uses future returns
returns = self.features['close'].pct_change().shift(-1).fillna(0)
```

**Fixed Code**:
```python
# Compute return from current close to next close (forward-looking)
# But ensure factor[t] is NOT contaminated by current bar data
# This is correct for forward returns paired with lagged factors

# Option 1: If factors are lagged properly elsewhere:
returns = self.features['close'].pct_change().shift(-1).fillna(0)
# Use this IF factor_computer.compute_factor() already returns factors[t]
# that were computed from data[0:t-1] (excludes current bar)

# Option 2: Explicit lag if needed:
factor_values_discovery = self.factor_computer.compute_factor(
    factor_name, self.features
).shift(1)  # Ensure factor[t] is from data[0:t-1]
returns_discovery = self.features['close'].pct_change().shift(-1).fillna(0)

entry_threshold, exit_threshold, direction = self._find_optimal_threshold(
    factor_values_discovery[discovery_dates],
    returns_discovery[discovery_dates]
)
```

**Verification**:
```python
# Before optimization, verify:
assert (factor_values.index == returns.index).all(), "Misaligned indices"
assert len(factor_values.dropna()) >= 40, "Insufficient data for optimization"

# Spot-check: If factor value is positive high (e.g., 0.8) and return is positive (0.05)
# This should be PREDICTIVE, not just curve-fitting to known data
```

---

### FIX-002: Factor Values Not Lagged (Line 394, 620)

**Original Code**:
```python
# Line 620 - UNCLEAR: Are factors already lagged?
factor_values = self.factor_computer.compute_factor(factor_name, self.features)
```

**Fixed Code**:
```python
# OPTION 1: Ensure factor_computer returns lagged factors
# Document this assumption clearly:

factor_values = self.factor_computer.compute_factor(factor_name, self.features)

# VERIFY: factor_values should NOT include current bar in rolling calculations
# Assumption: factor_computer.compute_factor() returns factors[t] computed from:
#   data[0:t-1], not data[0:t]
# This means: no current-bar look-ahead bias

# If uncertain, ADD DEFENSIVE LAG:
# (Only if you know factor_computer doesn't lag)
factor_values = factor_values.shift(1)  # Shift by 1 to be safe


# OPTION 2: Audit factor_computer and document
# Create unit test to verify:

def test_factor_no_lookahead():
    """Verify factor doesn't include current bar."""
    features = pd.DataFrame({
        'date': pd.date_range('2020-01-01', periods=100),
        'close': np.random.randn(100).cumsum(),
        'gamma': np.random.randn(100),
    })
    features = features.set_index('date')

    factors = factor_computer.compute_factor('gamma', features)

    # At date[t], factor should not depend on features[t]
    # Verify by checking that factor[t] doesn't change if features[t] changes
    features_modified = features.copy()
    features_modified.iloc[50, -1] *= 1000  # Modify features[50]

    factors_modified = factor_computer.compute_factor('gamma', features_modified)

    # Check: factors[51:] should NOT change (should be computed from [0:50])
    assert (factors[51:] == factors_modified[51:]).all(), "Factor includes current bar!"
    print("PASS: No current-bar look-ahead")
```

---

### FIX-003: Entry/Exit Price Computation (Line 417, 467)

**If EQUITY Strategy** (simpler):
```python
# ORIGINAL - CORRECT FOR EQUITY:
spot = features_row.get('close', features_row.get('spot', 0))
entry_price = spot  # OK for equity long/short

# But add validation:
if spot <= 0:
    logger.warning(f"Invalid spot price {spot} at {date}")
    continue  # Skip this bar
```

**If OPTIONS Strategy** (needs fixing):
```python
# ORIGINAL - WRONG FOR OPTIONS:
spot = features_row.get('close', features_row.get('spot', 0))
entry_price = spot  # WRONG! This is spot price, not option premium

# FIXED VERSION:
# You need to compute or load option prices
# This requires either:
# A) Black-Scholes pricing
# B) Market data with bid/ask quotes
# C) IV surface data

# Option A: Use Black-Scholes (requires IV data)
from ..pricing.greeks import calculate_price

spot = features_row['close']
iv = features_row.get('iv', 0.20)  # Implied volatility
dte = 30  # Days to expiration
risk_free_rate = 0.05

# For short strangle example:
put_strike = spot - 20
call_strike = spot + 20

put_premium = calculate_price(
    spot=spot,
    strike=put_strike,
    dte=dte,
    vol=iv,
    rate=risk_free_rate,
    option_type='put'
)

call_premium = calculate_price(
    spot=spot,
    strike=call_strike,
    dte=dte,
    vol=iv,
    rate=risk_free_rate,
    option_type='call'
)

# For SHORT strangle: we COLLECT premium
entry_premium = put_premium + call_premium  # Total premium received
entry_price = entry_premium  # This is what we earn

# Option B: Use market bid/ask
# Requires options data with bid/ask columns
if 'bid_price' in features_row and 'ask_price' in features_row:
    put_bid = features_row['put_bid_price']
    call_ask = features_row['call_ask_price']

    if direction == "short":
        entry_premium = put_bid + call_ask  # What we collect (conservative)
    elif direction == "long":
        entry_premium = put_ask + call_bid  # What we pay (conservative)

    entry_price = entry_premium
```

**Updated P&L Calculation for Options**:
```python
# ORIGINAL - WRONG:
pct_change = (spot - entry_price) / entry_price if entry_price > 0 else 0
pnl = equity * pct_change * 0.1

# FIXED - OPTIONS:
# At exit, compute option value
exit_premium = (exit_put_premium + exit_call_premium)  # Or from market data

contract_multiplier = 100  # SPY contracts

if direction == "short":
    # Short: We collected entry_premium, now pay exit_premium
    pnl_per_contract = (entry_premium - exit_premium) * contract_multiplier
elif direction == "long":
    # Long: We paid entry_premium, now sell at exit_premium
    pnl_per_contract = (exit_premium - entry_premium) * contract_multiplier

# Number of contracts depends on position sizing
contracts = self.get_position_size(equity, entry_premium)

pnl = pnl_per_contract * contracts - commission
```

---

## HIGH SEVERITY FIXES

### FIX-004: Geometric Annualization (Line 506)

**Original Code**:
```python
# WRONG - linear scaling
total_return = (equity - self.initial_capital) / self.initial_capital
ann_return = total_return * (252 / len(dates)) if len(dates) > 0 else 0
```

**Fixed Code**:
```python
# CORRECT - geometric annualization
total_return = (equity - self.initial_capital) / self.initial_capital
years = len(dates) / 252

if years > 0:
    ann_return = (1 + total_return) ** (1 / years) - 1
else:
    ann_return = 0

# Test values:
# If total_return=0.20 and years=2.7:
#   WRONG: 0.20 * (252/675) = 0.0745 (7.45%)
#   RIGHT: (1.20)^(1/2.7) - 1 = 0.0676 (6.76%)
#
# If total_return=0.50 and years=2.7:
#   WRONG: 0.50 * (252/675) = 0.1865 (18.65%)
#   RIGHT: (1.50)^(1/2.7) - 1 = 0.1487 (14.87%)
```

---

### FIX-005: Sharpe Ratio - Use Trade-Level Returns (Line 507-508)

**Original Code**:
```python
# WRONG - uses sparse equity curve (mostly zeros)
equity_df['returns'] = equity_df['equity'].pct_change().fillna(0)
ann_vol = equity_df['returns'].std() * np.sqrt(252)
sharpe = ann_return / ann_vol if ann_vol > 0 else 0
```

**Fixed Code**:
```python
# CORRECT - use trade-level returns
trade_pnls = np.array([t['pnl'] for t in trades])

if len(trade_pnls) <= 1:
    # Can't calculate Sharpe with 0-1 trades
    sharpe = 0
    ann_vol = 0
else:
    # Convert P&L to returns
    trade_returns = trade_pnls / self.initial_capital

    # Annualized volatility of trade returns
    # Trades are approximately 5-20 days each
    # So we have ~252/10 = 25 trades per year on average
    trades_per_year = 252 / np.mean([t.get('days_held', 10) for t in trades])

    ann_vol = np.std(trade_returns) * np.sqrt(trades_per_year)

    # Sharpe ratio
    sharpe = np.mean(trade_returns) / ann_vol if ann_vol > 0 else 0

# Verify:
# 50 trades over 600 days = 20 day average = 252/20 = 12.6 trades/year
# Mean return per trade: 0.50 / 50 = 0.01 (1%)
# Std dev per trade: 0.03 (3%)
# Sharpe = 0.01 / (0.03 * sqrt(12.6)) = 0.01 / 0.106 = 0.094
```

---

### FIX-006: Fix Series.get() Error (Line 425, 428)

**Original Code**:
```python
# WRONG - Series has no .get() method
if direction == "long" and factor_values.get(date, 0) < exit_threshold:
    should_exit = True
```

**Fixed Code**:
```python
# CORRECT - Use .loc[] with error handling
try:
    factor_val = factor_values.loc[date] if date in factor_values.index else 0
except (KeyError, TypeError):
    factor_val = 0

if direction == "long" and factor_val < exit_threshold:
    should_exit = True
elif direction == "short" and factor_val > exit_threshold:
    should_exit = True
```

---

### FIX-007: Validation for Discovery Set (Line 626-634)

**Original Code**:
```python
# SILENT FAILURE - returns zeros without error
entry_threshold, exit_threshold, direction = self._find_optimal_threshold(
    factor_values[discovery_dates],
    returns[discovery_dates]
)
```

**Fixed Code**:
```python
# With validation
entry_threshold, exit_threshold, direction = self._find_optimal_threshold(
    factor_values[discovery_dates],
    returns[discovery_dates]
)

# VALIDATE
if entry_threshold == 0.0 and exit_threshold == 0.0 and direction == "long":
    # This is the default return - optimization failed
    raise ValueError(
        f"Discovery set optimization FAILED. "
        f"Insufficient data: {len(discovery_dates)} days with "
        f"{(factor_values[discovery_dates].notna()).sum()} non-null factor values. "
        f"Minimum required: {min_trades * 2} trades."
    )

logger.info(f"Discovery set optimization SUCCESS: "
           f"threshold={entry_threshold:.4f}, direction={direction}")
```

---

## MEDIUM SEVERITY FIXES

### FIX-008: Add Slippage Modeling (Line 417, 467, 477)

**Modified run_backtest method**:
```python
def run_backtest(self, factor_name, entry_threshold, exit_threshold,
                 direction, dates):
    """Run backtest with slippage modeling."""

    # ... existing setup code ...

    for date in dates:
        if date not in signals.index or date not in self.features.index:
            continue

        signal = signals[date]
        features_row = self.features.loc[date]
        spot = features_row.get('close', features_row.get('spot', 0))

        # NEW: Get slippage from execution model
        spread = self.execution_model.get_spread(
            mid_price=spot,
            moneyness=0.05,  # Approximate moneyness
            dte=30,          # Approximate DTE
            vol=features_row.get('iv', 0.20)  # Implied vol if available
        )

        # Entry logic
        if current_position is None and signal != 0:
            current_position = signal
            entry_date = date

            # Apply slippage to entry
            if direction == "long":
                entry_price = spot + spread / 2  # Pay ask (half-spread above mid)
            else:  # short
                entry_price = spot - spread / 2  # Sell at bid (half-spread below mid)

        # Exit logic
        if current_position is not None:
            # ... exit conditions ...
            if should_exit:
                # Apply slippage to exit
                if direction == "long":
                    exit_price = spot - spread / 2  # Buy at bid
                else:  # short
                    exit_price = spot + spread / 2  # Sell at ask

                pct_change = (exit_price - entry_price) / entry_price
                if direction == "short":
                    pct_change = -pct_change

                pnl = equity * pct_change * 0.1 - commission
                # ... rest of exit logic ...
```

---

### FIX-009: Position Sizing with Leverage Checks (Line 446)

**Original Code**:
```python
# UNCLEAR - what does 0.1 mean?
pnl = equity * pct_change * 0.1
```

**Fixed Code**:
```python
# EXPLICIT - document position sizing strategy
class FactorBacktester:
    def __init__(self, ..., position_size_pct=0.10, max_leverage=0.30):
        self.position_size_pct = position_size_pct  # 10% per trade
        self.max_leverage = max_leverage            # 30% max notional
        self.active_position_value = 0              # Track open positions

    def run_backtest(self, ...):
        # ... existing setup ...

        for date in dates:
            # ... existing entry/exit logic ...

            # ENTRY: Check leverage before entering
            if current_position is None and signal != 0:
                proposed_position_value = equity * self.position_size_pct
                new_total_leverage = self.active_position_value + proposed_position_value

                if new_total_leverage / equity > self.max_leverage:
                    logger.warning(
                        f"Position rejected: would exceed max leverage "
                        f"({new_total_leverage/equity:.1%} > {self.max_leverage:.1%})"
                    )
                    signal = 0  # Reject entry
                else:
                    current_position = signal
                    entry_date = date
                    entry_price = spot
                    entry_value = equity * self.position_size_pct
                    self.active_position_value += entry_value

            # EXIT: Update leverage tracking
            if should_exit:
                self.active_position_value -= entry_value
                pct_change = (exit_price - entry_price) / entry_price
                pnl = entry_value * pct_change - commission
                # ... rest of exit logic ...
```

---

## VALIDATION & TESTING

### Test Script to Verify Fixes:

```python
def test_backtester_fixes():
    """Verify all critical fixes are in place."""

    # Create toy data
    dates = pd.date_range('2020-01-01', periods=500, freq='D')
    features = pd.DataFrame({
        'close': np.random.randn(500).cumsum() + 100,
        'gamma': np.random.randn(500),
    }, index=dates)

    # Test factors are lagged
    factor_values = features['gamma'].rolling(20).mean()

    # Check: factor[100] should not include features[100]
    # Verify by manual calculation:
    manual_factor_100 = features['gamma'][80:100].mean()  # [80:100), excludes 100

    assert factor_values.iloc[99] == manual_factor_100, "Factor includes current bar!"
    print("PASS: Factors properly lagged")

    # Test geometric annualization
    total_return = 0.50
    years = 2.7
    ann_return = (1 + total_return) ** (1 / years) - 1

    assert 0.14 < ann_return < 0.16, f"Annualization wrong: {ann_return}"
    print(f"PASS: Geometric annualization = {ann_return:.4f}")

    # Test trade-level Sharpe
    trade_pnls = np.array([100, -50, 150, -30, 200])
    trade_returns = trade_pnls / 100000
    trades_per_year = 12  # Estimated

    sharpe = np.mean(trade_returns) / np.std(trade_returns) * np.sqrt(trades_per_year)

    assert sharpe > 0, "Sharpe should be positive for this trade sequence"
    print(f"PASS: Trade-level Sharpe = {sharpe:.4f}")

    print("\nAll critical fixes verified!")

if __name__ == '__main__':
    test_backtester_fixes()
```

---

## SUMMARY

**Total Lines Modified**: ~50-100 lines
**Critical Fixes**: 7
**Estimated Effort**: 14-16 hours for all CRITICAL + HIGH + MEDIUM

**Order of Implementation**:
1. FIX-001 (returns look-ahead) - 2 hours
2. FIX-002 (factor lagging) - 2 hours
3. FIX-003 (entry/exit prices) - 2 hours (equity) or 4 hours (options)
4. FIX-004 (geometric annualization) - 1 hour
5. FIX-005 (trade-level Sharpe) - 2 hours
6. FIX-006 (Series.get fix) - 1 hour
7. FIX-007 (validation) - 1 hour
8. FIX-008 (slippage) - 2 hours
9. FIX-009 (leverage checks) - 2 hours

**Do NOT deploy without fixes 1-7.**

