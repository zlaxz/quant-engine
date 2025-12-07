# Factor Strategy Engine

Production-grade factor backtesting with three-set validation to prevent overfitting.

## Overview

The Factor Strategy Engine provides a systematic framework for:
1. Computing factors from market features
2. Generating trading signals from factors
3. Mapping signals to option structures
4. Validating strategies with proper train/test splits

**Key Feature**: Three-set interleaved validation prevents data leakage and overfitting.

## Three-Set Validation

### Date Splits

```
2020-2024: Interleaved odd/even months with embargo
2025: Walk-forward test set

Discovery Set (Odd Months 2020-2024):
  Jan, Mar, May, Jul, Sep, Nov
  ~675 days
  Purpose: Find optimal thresholds

Validation Set (Even Months 2020-2024):
  Feb, Apr, Jun, Aug, Oct, Dec
  ~600 days
  Purpose: Confirm thresholds (NO re-optimization)

Walk-Forward Set (2025):
  All months
  ~245 days
  Purpose: Final test on unseen data (NO re-optimization)
```

### Embargo Period

**5-day embargo** between discovery and validation months:
- Last 5 days of odd months excluded from Discovery
- First 5 days of even months excluded from Validation
- Prevents leakage from autocorrelation

### Survival Criteria

A factor **survives** if it has positive Sharpe in **ALL THREE** sets:
- Discovery Sharpe > 0
- Validation Sharpe > 0
- Walk-Forward Sharpe > 0

If any set has negative Sharpe, the factor **FAILS**.

## Module Structure

```
factors/
├── factor_backtester.py   # Main backtester with three-set validation
├── factor_computer.py     # Compute factors from Math Swarm equations ✓
├── signal_generator.py    # Convert factors to signals (TO BE IMPLEMENTED)
├── strategy_mapper.py     # Map signals to option structures ✓
├── playbook_builder.py    # Validate and optimize strategies ✓
└── README.md              # This file
```

## Usage

See `python/scripts/example_factor_backtest.py` for complete working example.

### Basic Three-Set Validation

```python
from engine.factors.factor_backtester import FactorBacktester

backtester = FactorBacktester(
    factor_computer=factor_computer,
    signal_generator=signal_generator,
    strategy_mapper=strategy_mapper,
    features_path="/path/to/features.parquet",
    initial_capital=100_000.0,
    embargo_days=5
)

result = backtester.three_set_validate("gamma_exposure")

if result.survival:
    print("Factor PASSED all three validation sets!")
    print(f"Entry Threshold: {result.entry_threshold:.4f}")
    print(f"Direction: {result.direction}")
else:
    print("Factor FAILED")

print(result.summary())
```

---

## FactorComputer Module

**Module:** `factor_computer.py`
**Status:** ✓ Implemented
**Purpose:** Evaluate Math Swarm equations on feature data to compute factor values

### Overview

The FactorComputer transforms symbolic equations discovered by the Math Swarm into computable factor signals with strict no-lookahead guarantees.

**Key Features:**
- Equation parsing (variable names `x7` or direct feature names `ret_range_50`)
- Safe evaluation using sandboxed numpy operations
- Expanding window z-score normalization (no lookahead bias)
- Missing value handling (NaN = no signal)
- Metadata extraction (complexity, loss, features)
- Built-in lookahead bias validation

### Usage

```python
from engine.factors import FactorComputer

# Initialize
computer = FactorComputer(
    equations_path="/path/to/math_swarm_results.json",
    features_path="/path/to/SPY_master_features.parquet",
    normalize=True,    # Z-score normalize
    min_periods=20     # Min periods for normalization
)

# Compute best equation factor
factor = computer.compute_factor()

# Compute all factors from Pareto frontier
all_factors = computer.compute_all_factors(max_equations=10)

# Validate no lookahead
is_valid = computer.validate_no_lookahead(factor)
```

### Convenience Function

```python
from engine.factors import compute_factors

factors = compute_factors(
    equations_path="/path/to/math_swarm_results.json",
    features_path="/path/to/features.parquet",
    normalize=True,
    max_equations=5
)
```

### No-Lookahead Normalization

**Standard z-score (WRONG - lookahead bias):**
```python
mean = factor.mean()  # Uses ALL data including future!
std = factor.std()    # Uses ALL data including future!
zscore = (factor - mean) / std
```

**Expanding window (CORRECT):**
```python
expanding_mean = factor.expanding(min_periods=20).mean()
expanding_std = factor.expanding(min_periods=20).std()
zscore = (factor - expanding_mean) / expanding_std
# At time t, only uses data from 0 to t (never t+1 onwards)
```

### Tests & Demo

```bash
# Run test suite
python scripts/test_factor_computer.py

# Run demo
python scripts/demo_factor_computer.py
```

### Integration with Factor Strategy Engine

```
Math Swarm Results
       ↓
  FactorComputer  ← Step 1: Compute factors
       ↓
   Factor Values (z-scored, no lookahead)
       ↓
  StrategyMapper  ← Step 2: Map to structures
       ↓
  PlaybookBuilder ← Step 3: Validate + optimize
       ↓
   Trade Execution
```

---

See README for full documentation.
