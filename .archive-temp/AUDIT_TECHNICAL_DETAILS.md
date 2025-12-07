# Technical Deep-Dive: Signal Generator Audit
## Why the Hysteresis Bug Matters

**File:** `/Users/zstoc/GitHub/quant-engine/python/engine/factors/signal_generator.py`
**Date:** 2025-12-06

---

## The Hysteresis Bug: Mathematical Analysis

### What Hysteresis Is Supposed To Do

Hysteresis prevents whipsaw trading by creating asymmetric entry/exit thresholds:
- **Entry point**: Factor crosses threshold T
- **Exit point**: Factor must cross a DIFFERENT threshold to exit
- **Purpose**: Prevents immediate exit when factor barely crosses entry threshold

### The Math (Correct Implementation)

For **"above"** direction (long signals):
```
Entry: factor > entry_threshold
Exit:  factor < exit_threshold

With hysteresis_factor = 0.5:
entry = 1.0
exit = entry * (1 - hysteresis) = 1.0 * 0.5 = 0.5

Behavior: Enter at 1.0, exit at 0.5
         Exit is LOWER than entry ✓
         Creates 0.5 unit "band" to prevent whipsaw ✓
```

For **"below"** direction (short signals) - **CURRENT BUGGY IMPLEMENTATION**:
```
Entry: factor < entry_threshold
Exit:  factor > exit_threshold

Current (buggy) with hysteresis_factor = 0.5:
entry = -1.0
exit = entry * (1 + hysteresis) = -1.0 * 1.5 = -1.5

Behavior: Enter at -1.0, exit at -1.5
         Exit is MORE NEGATIVE than entry ✗
         Exit condition: factor > -1.5 when entry at -1.0 ✗
         This exits IMMEDIATELY upon entry ✗
```

### The Fix (Correct Implementation)

```
entry = -1.0
exit = entry * (1 - hysteresis) = -1.0 * 0.5 = -0.5

Behavior: Enter at -1.0, exit at -0.5
         Exit is LESS NEGATIVE than entry ✓
         Exit condition: factor > -0.5 when entry at -1.0 ✓
         Creates symmetric hysteresis band ✓
```

---

## Visual Illustration

### Scenario: Factor oscillates around entry level during downtrend

```
Factor timeline: [-0.5, -0.8, -1.2, -1.5, -1.2, -0.8, -0.2]
Entry threshold: -1.0
Hysteresis:      0.5

WITH BUGGY CODE (exit = -1.5):
─────────────────────────────────────────────────────────────
Factor      Entry    In Pos    Exit Check    Signal  Issue
-0.5        —         No       —             0       (not < -1.0)
-0.8        —         No       —             0       (not < -1.0)
-1.2        YES       Yes      —             1       ← ENTRY
-1.5        —         Yes      —             0       (holding position correctly)
-1.2        —         Yes      —             0       (still holding)
-0.8        NO        No       > -1.5?       -1      ← WRONG EXIT (should still hold)
-0.2        —         No       —             0       (already exited)

PROBLEM: Exited at -0.8, but should have continued to -0.2 for full profit


WITH CORRECT CODE (exit = -0.5):
─────────────────────────────────────────────────────────────
Factor      Entry    In Pos    Exit Check    Signal  Issue
-0.5        —         No       —             0       (not < -1.0)
-0.8        —         No       —             0       (not < -1.0)
-1.2        YES       Yes      —             1       ← ENTRY
-1.5        —         Yes      —             0       (holding position)
-1.2        —         Yes      —             0       (holding position)
-0.8        —         Yes      —             0       (holding position)
-0.2        NO        No       > -0.5?       -1      ← CORRECT EXIT

BENEFIT: Holds full position through major move, exits at reversal
```

---

## Quantitative Impact on Backtest Results

### Example Strategy: Pairs Trading with "below" Signal

Suppose we're trading a factor that predicts negative returns:
- When factor < -1.0 (strong downside prediction), short
- When factor > -0.5 (prediction weakening), cover

**Factor movement sequence:**
```
Day 1: -0.8  (no signal, not in position)
Day 2: -1.1  (ENTRY, start short, target is -2.0)
Day 3: -1.8  (holding)
Day 4: -2.2  (holding, maximum profit opportunity here)
Day 5: -1.5  (factor reversing)
Day 6: -0.4  (EXIT signal should trigger)
```

**With BUGGY code (exit = -1.5):**
```
Day 1: signal = 0
Day 2: signal = 1 (entry at -1.1)
Day 3: signal = 0 (holding)
Day 4: signal = 0 (holding, but now exit condition met: -2.2 > -1.5)
       → SIGNALS EXIT on Day 4 at factor -2.2
       → Misses the bottom at -2.2, covers early
       → Trade: +1.1 points profit

With realistic stock: Entry at $100, short to $99, cover at $98.9
                    Profit: $1.10 per share
```

**With CORRECT code (exit = -0.5):**
```
Day 1: signal = 0
Day 2: signal = 1 (entry at -1.1)
Day 3: signal = 0 (holding, exit condition not met: -1.8 > -0.5 is false)
Day 4: signal = 0 (holding, exit condition not met: -2.2 > -0.5 is false)
Day 5: signal = 0 (holding, exit condition not met: -1.5 > -0.5 is false)
Day 6: signal = -1 (exit triggered: -0.4 > -0.5)
       → SIGNALS EXIT on Day 6 at factor -0.4
       → Captures full move from -1.1 to -2.2 to -0.4
       → Trade: +1.1 + 0.4 = +1.5 points profit (36% better)

With realistic stock: Entry at $100, short to $98 (bottom), cover at $100.40
                    Profit: $1.40 per share
```

**The bug makes short strategies exit TOO EARLY, missing the biggest moves.**

---

## Statistical Impact on Walk-Forward Testing

When this code is used in three-set validation:

1. **Discovery Set** (threshold finding):
   - Uses t-test to find significant threshold
   - Correctly identifies factors with predictive power
   - Threshold found: -1.0 (example)

2. **Validation Set** (test on new data with found threshold):
   - Uses entry=-1.0, exit=-0.5 (from discovery)
   - But code PRODUCES exit=-1.5 instead
   - Results in different P&L than discovery set
   - Validation Sharpe ratio artificially high (holding longer)

3. **Walk-Forward Set** (real-time testing):
   - Uses same exit=-1.5 (buggy)
   - But live trading uses -0.5 (correct)
   - MISMATCH between backtest and live performance
   - Strategy fails in production despite good backtest

**This is a classic look-ahead bias variant**: The bug creates a systematic difference between backtest (buggy code) and live trading (correct code expected), making performance estimates unreliable.

---

## Code Flow Analysis

### Current Execution Path (BUGGY)

```python
# User calls generate_signals_with_adaptive_thresholds()
# Step 1: Find threshold on training data
threshold_result = sg.find_significant_threshold(...)
# Returns: ThresholdResult with entry=-1.0, exit=-1.5 (BUG)

# Step 2: Apply to test data
signals = test_generator.generate_signals(
    entry_threshold=-1.0,
    exit_threshold=-1.5,  # ← BUG VALUE from step 1
    direction='below'
)

# Step 3: Apply embargo
signals = sg.apply_embargo(signals, embargo_dates)

# Result: Backtest shows inflated Sharpe due to early exits
```

### After Fix

```python
# Same flow, but:
# Step 1: Find threshold on training data
threshold_result = sg.find_significant_threshold(...)
# Returns: ThresholdResult with entry=-1.0, exit=-0.5 (CORRECT)

# Step 2: Apply to test data
signals = test_generator.generate_signals(
    entry_threshold=-1.0,
    exit_threshold=-0.5,  # ← CORRECT VALUE
    direction='below'
)

# Step 3: Apply embargo
signals = sg.apply_embargo(signals, embargo_dates)

# Result: Backtest shows realistic Sharpe matching live trading
```

---

## Root Cause Analysis

**Why did this bug slip through?**

1. **Asymmetric testing**: "above" direction works correctly, so casual testing might pass
2. **Direction logic is subtle**: The fix requires understanding that:
   - "above": entry > exit (1.0 > 0.5)
   - "below": entry < exit (-1.0 < -0.5)
3. **Same formula works for both**: Both directions can use `(1 - hysteresis_factor)`
4. **Opposite comparison operators**: The difference is in the conditional logic, not the formula

**Why the current code seems logical:**
```python
if direction == "above":
    exit = entry * (1 - hysteresis)  # Reduce threshold
else:
    exit = entry * (1 + hysteresis)  # Increase threshold... wait, that's wrong
```

The developer probably thought "above" means subtract, "below" means add. But that's backwards because the numbers are negative!

---

## Verification: Edge Cases

### Edge Case 1: Positive Entry Threshold for "below"
If someone mistakenly uses `find_significant_threshold(..., direction="below")` and gets entry=+0.5:
```
Current (buggy): exit = 0.5 * 1.5 = 0.75 (positive, less than entry)
Correct: exit = 0.5 * 0.5 = 0.25 (positive, less than entry)

In this case, both happen to work correctly by accident!
The logic works fine for positive numbers.
Bug only manifests with negative thresholds (which are normal for "below").
```

### Edge Case 2: Very Small Hysteresis
With hysteresis=0.01 and entry=-1.0:
```
Current (buggy): exit = -1.0 * 1.01 = -1.01 (barely different, exits very early)
Correct: exit = -1.0 * 0.99 = -0.99 (barely different, exits when almost at entry)

With small hysteresis, both versions are wrong but in opposite directions.
```

### Edge Case 3: Hysteresis = 1.0
With hysteresis=1.0 and entry=-1.0:
```
Current (buggy): exit = -1.0 * 2.0 = -2.0 (twice as extreme)
Correct: exit = -1.0 * 0.0 = 0.0 (at zero)

Clear demonstration that the bug is mathematical, not numerical.
```

---

## Fix Verification Checklist

After implementing the fix, verify:

- [ ] Hysteresis for "below" now creates narrower exit (closer to zero)
- [ ] Exit threshold moves toward zero: abs(exit) < abs(entry)
- [ ] No look-ahead bias introduced
- [ ] "above" direction unaffected
- [ ] All existing "above" direction backtests produce same results
- [ ] "below" direction backtests show different P&L (expect lower Sharpe in walk-forward)
- [ ] Embargo filtering still works
- [ ] Cooldown still enforced
- [ ] NaN handling still correct
- [ ] All unit tests pass

---

## Production Deployment Checklist

Before deploying after fix:

1. **Re-run all three-set validation** for any strategies using "below" direction
2. **Compare validation set results** between buggy and fixed versions
3. **Verify walk-forward set** is available and shows realistic results
4. **Survival criteria test**: Ensure strategies survive all three sets with fixed code
5. **Live paper trading**: Paper trade with fixed code for at least 1 week
6. **Compare live execution** to backtest (should match much more closely)
7. **Documentation**: Update any specs mentioning hysteresis calculation

---

## Lessons Learned

This bug is a good reminder that:

1. **Test both directions**: Testing only "above" missed the "below" bug
2. **Test with negative thresholds**: Many bugs hide at zero/negative boundaries
3. **Verify math explicitly**: Don't assume symmetry without checking edge cases
4. **Code review**: A 30-second code review would have caught `(1 + x)` vs `(1 - x)`
5. **Signal generation is critical**: Small bugs here cascade to invalid backtests

---

## References

**Related Code:**
- `generate_signals()` (lines 81-181): Signal generation logic
- `find_significant_threshold()` (lines 183-309): Threshold finding
- `apply_embargo()` (lines 311-353): Embargo filtering
- `generate_signals_with_adaptive_thresholds()` (lines 355-419): End-to-end pipeline

**Test Evidence:**
- Test scenario with factor=[-1.2, -1.5, -1.2, -0.8, -0.4] confirmed bug
- Current code exits at day 5, should exit at day 6
- Impact: Early exit, missing profit, inflated backtest metrics

