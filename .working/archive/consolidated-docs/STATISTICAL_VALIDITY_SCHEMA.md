# Statistical Validity JSONB Schema

## Purpose
The `statistical_validity` field in `backtest_runs` table stores comprehensive statistical metrics to detect overfitting and validate backtest robustness.

## Schema Definition

```typescript
interface StatisticalValidity {
  // Sample size
  n_trades: number;           // Total number of trades in backtest
  n_observations: number;     // Data points used (bars/ticks)
  date_range_days: number;    // Calendar days in test period

  // Basic statistical tests
  t_statistic: number;        // Student's t-test statistic
  p_value: number;            // Statistical significance (< 0.05 typically)

  // Overfitting detection (Bailey & López de Prado)
  deflated_sharpe: number;    // DSR - Sharpe adjusted for multiple testing
  pbo_score: number;          // Probability of Backtest Overfitting (0-1)
  n_tests_conducted: number;  // How many variations tested

  // Walk-forward validation
  walk_forward_efficiency: number;  // OOS Sharpe / IS Sharpe (> 0.5 preferred)
  is_sharpe: number;                // In-sample Sharpe
  oos_sharpe: number;               // Out-of-sample Sharpe

  // Parameter sensitivity
  parameter_sensitivity: 'low' | 'medium' | 'high';
  sensitivity_details?: {
    param_name: string;
    nominal_value: number;
    degradation_at_plus_10pct: number;  // Performance loss at +10%
    degradation_at_minus_10pct: number; // Performance loss at -10%
  }[];

  // Sample size adequacy
  min_trades_required: number;    // Minimum for statistical significance (typically 30)
  sample_adequate: boolean;       // n_trades >= min_trades_required

  // Returns distribution
  skewness: number;              // Return distribution skewness
  kurtosis: number;              // Return distribution kurtosis (tail risk)

  // Validation status
  passes_multiple_testing: boolean;  // t_statistic > threshold
  passes_walk_forward: boolean;      // WFE > 0.5
  passes_pbo: boolean;                // PBO < 0.25
  overall_valid: boolean;             // All checks passed
}
```

## Example

```json
{
  "n_trades": 247,
  "n_observations": 1260,
  "date_range_days": 1825,

  "t_statistic": 3.42,
  "p_value": 0.0008,

  "deflated_sharpe": 1.42,
  "pbo_score": 0.18,
  "n_tests_conducted": 24,

  "walk_forward_efficiency": 0.72,
  "is_sharpe": 1.8,
  "oos_sharpe": 1.3,

  "parameter_sensitivity": "low",
  "sensitivity_details": [
    {
      "param_name": "lookback_period",
      "nominal_value": 20,
      "degradation_at_plus_10pct": 0.08,
      "degradation_at_minus_10pct": 0.12
    }
  ],

  "min_trades_required": 30,
  "sample_adequate": true,

  "skewness": -0.23,
  "kurtosis": 4.2,

  "passes_multiple_testing": true,
  "passes_walk_forward": true,
  "passes_pbo": true,
  "overall_valid": true
}
```

## Validation Rules

### Overfitting Thresholds
- **PBO Score**: < 0.25 (acceptable), < 0.10 (excellent)
- **Deflated Sharpe**: > 0 (likely real), > 1.0 (robust)
- **Walk-Forward Efficiency**: > 0.5 (acceptable), > 0.7 (excellent)
- **t-statistic**: > 2.0 (basic), > 3.0 (with multiple testing)

### Sample Size Requirements
- **Minimum trades**: 30 (central limit theorem)
- **Recommended**: 100+ (robust conclusions)
- **Ideal**: 200-300+ spanning multiple regimes

### Parameter Sensitivity
- **Low**: < 15% degradation at ±10% parameter change
- **Medium**: 15-30% degradation
- **High**: > 30% degradation (likely overfit)

## Usage in Code

### Checking Validity
```typescript
function isBacktestValid(run: BacktestRun): boolean {
  const sv = run.statistical_validity;

  return sv.overall_valid &&
         sv.passes_multiple_testing &&
         sv.passes_walk_forward &&
         sv.passes_pbo &&
         sv.sample_adequate;
}
```

### Creating Warnings
```typescript
function checkOverfitting(run: BacktestRun): string[] {
  const sv = run.statistical_validity;
  const warnings: string[] = [];

  if (sv.pbo_score > 0.25) {
    warnings.push(`HIGH PBO: ${(sv.pbo_score * 100).toFixed(0)}% overfitting probability`);
  }

  if (sv.walk_forward_efficiency < 0.5) {
    warnings.push(`POOR WFE: ${sv.walk_forward_efficiency.toFixed(2)} (threshold: 0.50)`);
  }

  if (!sv.sample_adequate) {
    warnings.push(`LOW SAMPLE: ${sv.n_trades} trades (minimum: ${sv.min_trades_required})`);
  }

  return warnings;
}
```

## Calculation Functions

### Deflated Sharpe Ratio
```python
# From Bailey & López de Prado (2014)
def deflated_sharpe(observed_sharpe, n_trials, sample_length, skew, kurt):
    """
    Adjusted Sharpe accounting for multiple testing and non-normality
    """
    from scipy import stats

    # Variance of Sharpe under multiple testing
    var_sharpe = ((1 + (0.5 * observed_sharpe**2)) *
                  (kurt - 1) / 4 +
                  observed_sharpe**2 - 1) / (sample_length - 1)

    # Multiple testing penalty
    adjusted_threshold = ((var_sharpe * (1 - stats.norm.cdf(n_trials)) *
                          n_trials) / stats.norm.pdf(stats.norm.ppf(1 - 1/n_trials)))**0.5

    dsr = observed_sharpe / (var_sharpe**0.5)
    return dsr
```

### Probability of Backtest Overfitting (PBO)
```python
def probability_backtest_overfitting(is_returns, oos_returns):
    """
    Measures probability that IS outperformance is due to overfitting
    """
    is_sharpe = sharpe(is_returns)
    oos_sharpe = sharpe(oos_returns)

    # Count how often OOS < IS (sign of overfitting)
    # Over multiple train/test splits
    count_oos_underperforms = sum(oos < is for oos, is in splits)
    pbo = count_oos_underperforms / len(splits)

    return pbo
```

## References
- Bailey, D. H., & López de Prado, M. (2014). The deflated Sharpe ratio
- Harvey, C. R., & Liu, Y. (2015). Backtesting
- pypbo library: https://github.com/fmilthaler/pypbo
