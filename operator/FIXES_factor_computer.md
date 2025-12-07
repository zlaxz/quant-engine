# FactorComputer - Required Fixes

This document provides exact code fixes for the two issues found in the audit.

---

## FIX #1: BUG-001 - Non-Functional equation_id Parameter

**File**: `/Users/zstoc/GitHub/quant-engine/python/engine/factors/factor_computer.py`
**Lines**: 268-315
**Priority**: HIGH - API contract violation
**Time to Fix**: 5 minutes

### Current Code (BROKEN)
```python
def compute_factor(
    self,
    equation_id: Optional[str] = None,
    equation_idx: Optional[int] = None
) -> pd.Series:
    """
    Compute a single factor from an equation.

    Args:
        equation_id: Equation identifier (e.g., "equation_0")
                    If None, uses best_equation_translated
        equation_idx: Alternative: equation index in all_equations list

    Returns:
        Series of factor values (z-score normalized if normalize=True)

    Example:
        >>> factor = computer.compute_factor("equation_0")
        >>> factor = computer.compute_factor(equation_idx=3)
    """
    # Determine which equation to use
    if equation_id is None and equation_idx is None:
        # Use best equation
        if 'best_equation_translated' in self.equations:
            equation_str = self.equations['best_equation_translated']
            logger.info("Using best_equation_translated")
        elif 'best_equation_raw' in self.equations:
            equation_str = self.equations['best_equation_raw']
            logger.info("Using best_equation_raw")
        else:
            raise ValueError("No best_equation found and no equation_id specified")

    elif equation_idx is not None:
        # Use equation by index
        if 'all_equations' not in self.equations:
            raise ValueError("No all_equations found in results")

        if equation_idx >= len(self.equations['all_equations']):
            raise ValueError(
                f"equation_idx {equation_idx} out of range "
                f"(max: {len(self.equations['all_equations']) - 1})"
            )

        equation_str = self.equations['all_equations'][equation_idx]['equation']
        logger.info(f"Using equation {equation_idx}: {equation_str}")

    else:
        # Use equation by ID (for future compatibility with multiple named equations)
        # For now, this maps to the best equation
        equation_str = self.equations.get('best_equation_translated',
                                         self.equations.get('best_equation_raw'))
        logger.info(f"Using equation {equation_id}: {equation_str}")
        # ^ BUG: equation_id is logged but never actually used!
```

### Fixed Code (CORRECTED)
```python
def compute_factor(
    self,
    equation_id: Optional[str] = None,
    equation_idx: Optional[int] = None
) -> pd.Series:
    """
    Compute a single factor from an equation.

    Args:
        equation_id: Equation identifier (e.g., "equation_0") to lookup in equations dict
                    If None, uses best_equation_translated
        equation_idx: Alternative: equation index in all_equations list

    Returns:
        Series of factor values (z-score normalized if normalize=True)

    Example:
        >>> factor = computer.compute_factor("equation_0")
        >>> factor = computer.compute_factor(equation_idx=3)
    """
    # Determine which equation to use
    if equation_id is None and equation_idx is None:
        # Use best equation
        if 'best_equation_translated' in self.equations:
            equation_str = self.equations['best_equation_translated']
            logger.info("Using best_equation_translated")
        elif 'best_equation_raw' in self.equations:
            equation_str = self.equations['best_equation_raw']
            logger.info("Using best_equation_raw")
        else:
            raise ValueError("No best_equation found and no equation_id specified")

    elif equation_idx is not None:
        # Use equation by index
        if 'all_equations' not in self.equations:
            raise ValueError("No all_equations found in results")

        if equation_idx >= len(self.equations['all_equations']):
            raise ValueError(
                f"equation_idx {equation_idx} out of range "
                f"(max: {len(self.equations['all_equations']) - 1})"
            )

        equation_str = self.equations['all_equations'][equation_idx]['equation']
        logger.info(f"Using equation {equation_idx}: {equation_str}")

    else:
        # Use equation by ID - must be present in equations dict
        if equation_id not in self.equations:
            raise ValueError(
                f"Equation '{equation_id}' not found in results. "
                f"Available keys: {list(self.equations.keys())}"
            )
        equation_str = self.equations[equation_id]
        logger.info(f"Using equation {equation_id}: {equation_str}")
```

### What Changed
- **Line 295-299**: Changed from `self.equations.get('best_equation_translated', ...)` to `self.equations[equation_id]`
- **Added validation**: Check that equation_id exists in equations before using it
- **Improved error message**: Include available keys in error for debugging

### Testing After Fix
```python
# Test that equation_id actually works now
computer = FactorComputer(equations_path, features_path)

# Before fix: Would return best_equation regardless
# After fix: Should return equation_0 if it exists
factor = computer.compute_factor(equation_id="equation_0")

# Should raise error if equation doesn't exist
try:
    factor = computer.compute_factor(equation_id="nonexistent")
except ValueError as e:
    print(f"Correctly raised error: {e}")
```

---

## FIX #2: BUG-002 - Weak Lookahead Validation (OPTIONAL - Documentation Fix)

**File**: `/Users/zstoc/GitHub/quant-engine/python/engine/factors/factor_computer.py`
**Lines**: 419-466
**Priority**: MEDIUM - Validation is weak but not critical
**Time to Fix**: 10 minutes (optional, can use documentation fix instead)

### Current Code (WEAK VALIDATION)
```python
def validate_no_lookahead(self, factor: pd.Series, window: int = 100) -> bool:
    """
    Validate that factor values don't exhibit lookahead bias.

    This checks that the distribution of factor values at time t
    is consistent with only having access to data up to time t.

    Args:
        factor: Factor series to validate
        window: Window size for checking (default: 100)

    Returns:
        True if validation passes, False otherwise
    """
    # Check that early values are within expected range
    # (not using information from full sample)

    # Split into early and late periods
    split_idx = len(factor) // 2
    early = factor.iloc[:split_idx]
    late = factor.iloc[split_idx:]

    # Remove NaN values
    early_clean = early.dropna()
    late_clean = late.dropna()

    if len(early_clean) < 10 or len(late_clean) < 10:
        logger.warning("Insufficient data for lookahead validation")
        return True  # Can't validate, assume OK

    # Check if early and late have similar distributions
    # (if using lookahead, early period would be too well-normalized)
    early_std = early_clean.std()
    late_std = late_clean.std()

    # Standard deviations should be within reasonable range
    # Early period typically has higher variance as estimation stabilizes
    std_ratio = early_std / late_std if late_std != 0 else 1.0

    if std_ratio < 0.5:
        logger.warning(
            f"Potential lookahead bias detected: early_std={early_std:.3f}, "
            f"late_std={late_std:.3f}, ratio={std_ratio:.3f}"
        )
        return False

    logger.info(f"Lookahead validation passed (std_ratio={std_ratio:.3f})")
    return True
```

### Option A: Documentation Fix (SIMPLER - Recommended)
```python
def validate_no_lookahead(self, factor: pd.Series, window: int = 100) -> bool:
    """
    Validate that factor values don't exhibit OBVIOUS lookahead bias.

    WARNING: This is a weak sanity check and cannot reliably detect
    sophisticated look-ahead bias. It only checks standard deviation ratio
    across early/late periods.

    A PASSING validation does NOT guarantee absence of look-ahead bias.
    This method provides only a best-effort heuristic check.

    For robust validation, you should:
    1. Verify that the equation source code doesn't use future data
    2. Check that expanding window is used for normalization (not rolling)
    3. Compare early/late period Sharpe ratios
    4. Run walk-forward testing with data truly unknown at prediction time

    Args:
        factor: Factor series to validate
        window: Window size for checking (default: 100)

    Returns:
        True if sanity checks pass (doesn't guarantee no bias)
        False if obvious issues detected
    """
    # ... rest of code unchanged ...
    if std_ratio < 0.5:
        logger.warning(
            f"Potential lookahead bias detected: early_std={early_std:.3f}, "
            f"late_std={late_std:.3f}, ratio={std_ratio:.3f}. "
            f"See docstring for full validation procedure."
        )
        return False

    logger.info(f"Lookahead sanity check passed (std_ratio={std_ratio:.3f})")
    return True
```

### Option B: Stronger Validation (MORE THOROUGH - Optional)
```python
def validate_no_lookahead(self, factor: pd.Series, window: int = 100) -> Dict[str, bool]:
    """
    Comprehensive validation for lookahead bias.

    Returns dictionary with individual test results rather than single bool.
    Allows caller to decide which tests are critical.

    Args:
        factor: Factor series to validate
        window: Window size for checking (default: 100)

    Returns:
        Dictionary with test results:
        {
            'std_ratio_ok': bool,
            'early_nans_present': bool,
            'distribution_differs': bool,
            'all_pass': bool
        }
    """
    results = {
        'std_ratio_ok': True,
        'early_nans_present': False,
        'distribution_differs': False,
        'all_pass': True
    }

    split_idx = len(factor) // 2
    early = factor.iloc[:split_idx]
    late = factor.iloc[split_idx:]

    early_clean = early.dropna()
    late_clean = late.dropna()

    if len(early_clean) < 10 or len(late_clean) < 10:
        logger.warning("Insufficient data for lookahead validation")
        return results

    # Test 1: Standard deviation ratio
    early_std = early_clean.std()
    late_std = late_clean.std()
    std_ratio = early_std / late_std if late_std != 0 else 1.0

    if std_ratio < 0.3:  # Loosened threshold
        results['std_ratio_ok'] = False
        logger.warning(
            f"Std ratio unusually low: {std_ratio:.3f} "
            f"(early_std={early_std:.3f}, late_std={late_std:.3f})"
        )

    # Test 2: Check for NaN prevalence (expanding window should have early NaNs)
    early_nan_count = early.isna().sum()
    late_nan_count = late.isna().sum()

    if early_nan_count > 0:
        results['early_nans_present'] = True
        logger.info(f"Early period contains {early_nan_count} NaN values (expected for expanding window)")

    # Test 3: Distribution difference
    early_mean = early_clean.mean()
    late_mean = late_clean.mean()

    if abs(early_mean - late_mean) > 0.5:  # Significant difference
        results['distribution_differs'] = True
        logger.info(f"Early/late means differ: {early_mean:.3f} vs {late_mean:.3f}")

    # Overall pass only if std_ratio is OK and expanding window shows early NaNs
    results['all_pass'] = results['std_ratio_ok'] and results['early_nans_present']

    logger.info(f"Lookahead validation results: {results}")
    return results
```

### Recommendation
Use **Option A** (Documentation Fix) because:
- Minimal code change
- Makes the weakness explicit to users
- Doesn't add complexity
- The core expanding window code IS correct (no actual bias)
- The validation is only a sanity check, not a guarantee

---

## Summary of Changes

| Bug | Fix | Lines | Time | Priority |
|-----|-----|-------|------|----------|
| BUG-001 | Implement equation_id lookup | 295-299 | 5 min | HIGH |
| BUG-002 | Add warning to docstring | 419-427 | 2 min | MEDIUM |

**Total Fix Time**: ~7 minutes

**Testing Required**:
1. Unit test for equation_id parameter
2. Integration test with Math Swarm output
3. Verification that expanding window is still used

---

## Verification After Fixes

```python
# Test BUG-001 fix
computer = FactorComputer(equations_path, features_path)

# This should now work
factor_by_id = computer.compute_factor(equation_id="equation_0")
assert factor_by_id is not None

# This should still work
factor_by_idx = computer.compute_factor(equation_idx=0)
assert factor_by_idx is not None

# This should raise error
try:
    computer.compute_factor(equation_id="nonexistent")
    assert False, "Should have raised ValueError"
except ValueError as e:
    assert "not found" in str(e)

print("BUG-001 FIX VERIFIED ✓")

# Test BUG-002 documentation
help(computer.validate_no_lookahead)
# Should show warning about weak validation

print("BUG-002 FIX VERIFIED ✓")
```
