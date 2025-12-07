# PlaybookBuilder Usage Guide

## Overview

The PlaybookBuilder module aggregates validated strategies into an executable playbook for production use. It implements strict three-set validation (Discovery/Validation/Walk-Forward) to ensure only robust strategies make it to production.

## Quick Start

```python
from engine.factors import PlaybookBuilder

# Load validation results from your validator
validation_results = [
    ("strategy_01", validation_result_01),
    ("strategy_02", validation_result_02),
    # ... more strategies
]

# Build playbook
builder = PlaybookBuilder(validation_results)

# Filter survivors (only strategies that pass ALL three sets)
survivors = builder.filter_survivors(
    min_sharpe=0.5,
    max_drawdown=0.30,
    min_trades=10
)

# Calculate allocation
allocation = builder.calculate_allocation(
    method="risk_parity"  # or "equal", "sharpe_weighted"
)

# Build and export playbook
playbook = builder.build_playbook()
builder.export_playbook("/path/to/production_playbook.json")

# Generate human-readable report
print(builder.generate_report())
```

## Validation Result Format

The builder expects validation results in this format:

```python
validation_result = {
    "strategy": {
        "factor_name": "ret_range_50_xle",
        "factor_formula": "ret_range_50 * xle_ratio",
        "entry_threshold": 1.5,
        "exit_threshold": -0.5,
        "direction": "long",
        "structure": {"type": "short_strangle", "dte": 30}
    },
    "discovery_metrics": {
        "sharpe_ratio": 1.20,
        "total_return": 0.15,
        "max_drawdown": -0.08
    },
    "validation_metrics": {
        "sharpe_ratio": 0.95,
        "total_return": 0.12,
        "max_drawdown": -0.10
    },
    "walkforward_metrics": {
        "sharpe_ratio": 1.05,
        "total_return": 0.14,
        "max_drawdown": -0.09
    },
    "total_trades": 45,
    "win_rate": 0.62,
    "profit_factor": 1.8,
    "avg_trade_return": 0.003,
    "correlation_to_spy": 0.25
}
```

## Survival Filters

A strategy must pass ALL of these to survive:

1. **Positive Sharpe in ALL three sets** - No negative Sharpe in discovery, validation, OR walk-forward
2. **Average Sharpe > min_sharpe** - Default: 0.5
3. **Max drawdown < max_drawdown** - Across all three sets. Default: 30%
4. **Minimum trades** - At least this many trades total. Default: 10
5. **Not highly correlated** - Not redundant with existing survivors. Default: < 0.80

## Allocation Methods

### Equal Weight
```python
allocation = builder.calculate_allocation(method="equal")
```
Simple 1/N allocation. Most robust for small samples.

### Sharpe Weighted
```python
allocation = builder.calculate_allocation(method="sharpe_weighted")
```
Weight proportional to average Sharpe ratio across three sets.

### Risk Parity
```python
allocation = builder.calculate_allocation(method="risk_parity")
```
Weight by inverse volatility (using max drawdown as risk proxy).

## Playbook JSON Structure

The exported playbook contains:

```json
{
  "version": "1.0",
  "generated_at": "2025-12-06T12:00:00",
  "validation_framework": "three_set_interleaved",
  "filters": {
    "min_sharpe": 0.5,
    "max_drawdown": 0.3,
    "min_trades": 10,
    "max_correlation": 0.8
  },
  "strategies": [
    {
      "factor_name": "...",
      "factor_formula": "...",
      "entry_threshold": 1.5,
      "exit_threshold": -0.5,
      "direction": "long",
      "structure": {...},
      "performance": {
        "discovery": {...},
        "validation": {...},
        "walkforward": {...},
        "avg_sharpe": 1.07,
        "max_drawdown": 0.10,
        "sharpe_stability": 0.10,
        "degradation": 0.12
      },
      "trade_stats": {...},
      "risk": {...}
    }
  ],
  "allocation": {
    "strategy_1": 0.40,
    "strategy_2": 0.35,
    "strategy_3": 0.25
  },
  "combined_metrics": {
    "expected_sharpe": 1.35,
    "expected_return": 0.18,
    "expected_volatility": 0.12,
    "max_correlation": 0.25,
    "avg_correlation": 0.15,
    "diversification_ratio": 1.45,
    "n_strategies": 3,
    "total_trades_per_year": 40
  }
}
```

## Key Metrics Explained

### Sharpe Stability
Standard deviation of Sharpe across three sets divided by mean Sharpe.
- < 0.3: Stable
- 0.3 - 0.5: Moderate variability
- \> 0.5: High variability (concerning)

### Degradation
Performance decline from discovery to walk-forward:
```
degradation = (discovery_sharpe - walkforward_sharpe) / discovery_sharpe
```
- Positive: Performance degraded (normal)
- Negative: Performance improved (lucky, or adaptive strategy)
- < 20%: Good
- 20-40%: Acceptable
- \> 40%: Overfitted

### Diversification Ratio
```
diversification_ratio = sum(individual_vols) / portfolio_vol
```
Higher is better (more diversification).
- 1.0: No diversification benefit
- 1.3-1.5: Good diversification
- \> 1.5: Excellent diversification

## Example Report Output

```
================================================================================
FACTOR STRATEGY PLAYBOOK REPORT
================================================================================
Generated: 2025-12-06 12:00:00
Validation: Three-Set Interleaved (Discovery/Validation/Walk-Forward)

SURVIVING STRATEGIES: 3 of 10 tested
--------------------------------------------------------------------------------
Strategy        Factor                    Disc   Valid  WF     Trades
--------------------------------------------------------------------------------
strat_01        ret_range_50 * xle        1.20   0.95   1.05      45
strat_02        entropy_zscore            0.85   0.72   0.90      32
strat_03        gamma_skew                1.10   1.00   0.95      28

PORTFOLIO ALLOCATION (Risk Parity)
--------------------------------------------------------------------------------
strat_01: 40%
strat_02: 35%
strat_03: 25%

COMBINED PORTFOLIO METRICS
--------------------------------------------------------------------------------
Expected Sharpe Ratio:        1.35
Expected Annual Return:       18.0%
Correlation between strategies: 0.25
```

## Integration with Validator

This module expects output from the three-set validator. Here's the typical workflow:

```python
# 1. Run three-set validation
from engine.factors import ThreeSetValidator

validator = ThreeSetValidator(
    discovery_start="2020-01-01",
    discovery_end="2021-12-31",
    validation_start="2022-01-01",
    validation_end="2023-06-30",
    walkforward_start="2023-07-01",
    walkforward_end="2024-12-31"
)

results = validator.validate_all(candidate_strategies)

# 2. Build playbook from survivors
builder = PlaybookBuilder(results)
playbook = builder.build_playbook()
builder.export_playbook("/production/playbook.json")
```

## Production Usage

Load and execute the playbook in production:

```python
import json

# Load playbook
with open("/production/playbook.json") as f:
    playbook = json.load(f)

# Get allocation
allocation = playbook["allocation"]

# Execute each strategy with its weight
for strategy in playbook["strategies"]:
    factor_name = strategy["factor_name"]
    weight = allocation[factor_name]

    # Calculate position size
    position_size = account_size * weight

    # Execute strategy...
```

## Audit Trail

The playbook includes full audit trail:
- Performance in each of three validation sets
- Exact filters used
- Allocation method
- Generation timestamp
- Combined portfolio metrics

This ensures reproducibility and regulatory compliance.

## Notes

- Only strategies with positive Sharpe in ALL three sets survive
- Allocation normalizes to sum = 1.0
- Portfolio metrics assume strategies are executed simultaneously
- Correlation calculations are simplified (use actual return correlations in production)
- The playbook is READ-ONLY - regenerate from validation if parameters change
