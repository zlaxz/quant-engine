/**
 * Shared framework context for all quant prompts
 *
 * Architecture:
 * - Domain-agnostic statistical methodology (always included)
 * - Pluggable domain context (optional, injected by caller)
 *
 * Updated: 2025-11-29 - Refactored to remove hardcoded domain assumptions
 */

// =============================================================================
// DOMAIN CONTEXT INTERFACES (Pluggable)
// =============================================================================

/**
 * Interface for domain-specific framework context
 * Allows different research domains to inject their own frameworks
 */
export interface DomainFramework {
  name: string;
  description: string;

  // Primary classification dimensions (e.g., regimes, states, categories)
  classifications?: {
    name: string;
    items: Array<{
      id: string;
      label: string;
      description: string;
    }>;
  }[];

  // Core thesis or hypothesis
  thesis?: string;

  // Domain-specific reference material
  references?: {
    title: string;
    content: string;
  }[];
}

/**
 * Options trading domain context (example of pluggable domain)
 */
export const OPTIONS_DOMAIN: DomainFramework = {
  name: 'Options Trading',
  description: 'Quantitative options strategies based on volatility dynamics and Greeks exposure',

  references: [
    {
      title: 'Greeks Quick Reference',
      content: `### Greeks Quick Reference
- **Delta**: Direction (0 to ±1). Hedge to neutral. Rehedge when |gamma| high.
- **Gamma**: Convexity. Long gamma profits from realized > implied vol.
- **Theta**: Time decay. Accelerates in final 2 weeks. ~0.05% ATM at 14 DTE.
- **Vega**: Vol sensitivity. Peaks ATM, higher for longer dates.
- **Charm**: Delta decay over time. ~0.01-0.02 delta/day near ATM.
- **Vanna**: Vol-spot correlation. Creates systematic dealer hedging flows.`
    },
    {
      title: 'Options Execution Realism',
      content: `### Options Execution Realism

**Bid-Ask Spread Assumptions (SPY Options):**
| Moneyness | Normal VIX (<20) | Elevated VIX (20-30) | High VIX (>30) |
|-----------|------------------|----------------------|----------------|
| ATM | $0.01-0.02 | $0.02-0.05 | $0.05-0.15 |
| 5% OTM | $0.02-0.03 | $0.03-0.08 | $0.10-0.25 |
| 10% OTM | $0.03-0.05 | $0.05-0.15 | $0.15-0.50 |

**Slippage Model:**
\`\`\`
slippage = half_spread + impact_slippage
impact_slippage: 1 tick (default), 3 ticks if VIX > 30, 5 ticks at open/close
\`\`\`

**Commission:** ~$0.65/contract typical retail

**Liquidity:** Never exceed 1% of daily option volume`
    }
  ]
};

// =============================================================================
// DOMAIN-AGNOSTIC STATISTICAL METHODOLOGY
// =============================================================================

/**
 * Quality gates for backtest validation
 * These are NON-NEGOTIABLE checks before trusting any backtest result
 */
export const QUALITY_GATES = `### Quality Gates (NON-NEGOTIABLE)

**Gate 1: Look-Ahead Bias Audit**
- Verify no future data leakage in signal generation
- Check classification uses only past information
- Validate entry/exit timing assumptions

**Gate 2: Overfitting Detection**
- Parameter count limit: max_params = floor(sqrt(num_trades) / 3)
- Walk-forward validation (see WALK_FORWARD_SPEC below)
- Permutation test: randomize trade order 10,000x, compare Sharpe

**Gate 3: Statistical Validation**
- Bootstrap confidence intervals (1000+ resamples)
- Sharpe ratio p-value < 0.05 required
- Multiple testing correction (Bonferroni) for parameter sweeps

**Gate 4: Strategy Logic Audit**
- Verify entry/exit rules match stated hypothesis
- Check position sizing consistency
- Validate classification-strategy alignment

**Gate 5: Transaction Cost Reality**
- Model realistic execution costs for the specific asset class
- Stress test with 2x cost assumptions
- Verify fills are realistic given typical liquidity`;

/**
 * Walk-Forward Validation Specification
 * Rigorous methodology for out-of-sample testing
 */
export const WALK_FORWARD_SPEC = `### Walk-Forward Validation Specification

**Purpose:** Prevent overfitting by testing on truly out-of-sample data

**Standard Configuration:**
- Training Window: 12 months (minimum 100 samples)
- Test Window: 3 months
- Step Size: 1 month (anchored walk-forward, expanding training)
- Minimum Walks: 8 (to get statistical significance on OOS performance)

**Anchored vs Rolling:**
- **Anchored (Preferred):** Training window ALWAYS starts at same date, expands each walk
  - Pro: Uses all available data, captures evolution
  - Con: Later walks have much longer training
- **Rolling:** Fixed-size training window that slides forward
  - Pro: Consistent data age
  - Con: Discards older information

**Embargo Period:**
- Gap of 1-5 periods between training and test to prevent information leakage
- Critical for strategies with look-back calculations

**Walk-Forward Efficiency (WFE):**
- Formula: WFE = (OOS Performance / IS Performance) × 100
- Acceptable: WFE > 50% (OOS at least half as good as IS)
- Target: WFE > 70% (indicates robust strategy)
- Red Flag: WFE < 30% (likely overfit)

**Code Pattern:**
\`\`\`python
def walk_forward_validation(data, train_periods=12, test_periods=3, step=1):
    walks = []
    train_start = data.index[0]

    while True:
        train_end = train_start + pd.DateOffset(months=train_periods)
        test_start = train_end + pd.DateOffset(days=5)  # embargo
        test_end = test_start + pd.DateOffset(months=test_periods)

        if test_end > data.index[-1]:
            break

        train_data = data[train_start:train_end]
        test_data = data[test_start:test_end]

        model.fit(train_data)
        is_perf = model.evaluate(train_data)
        oos_perf = model.evaluate(test_data)

        walks.append({
            'train_period': (train_start, train_end),
            'test_period': (test_start, test_end),
            'is_sharpe': is_perf['sharpe'],
            'oos_sharpe': oos_perf['sharpe'],
            'wfe': oos_perf['sharpe'] / is_perf['sharpe'] * 100
        })

        # For anchored: don't update train_start
        # For rolling: train_start += step

    return walks
\`\`\``;

/**
 * Sample Size Requirements for Statistical Validity
 */
export const SAMPLE_SIZE_SPEC = `### Sample Size Requirements

**Minimum Samples for Statistical Significance:**

| Metric | Minimum | Formula/Rationale |
|--------|---------|-------------------|
| Proportion (Win Rate) | 30 | Rule of thumb for binomial |
| Mean Comparison | 50 | t-test requires √n ≈ 7 for p<0.05 |
| Distribution Analysis | 100 | Need multiple cycles |
| Parameter Testing | n² | Where n = number of parameters |
| Subgroup Analysis | 20 per group | Minimum for subsample validity |

**Overfitting Risk by Sample Count:**
- <30 samples: Extremely high risk - results meaningless
- 30-50 samples: High risk - only trust large effects (Sharpe > 2)
- 50-100 samples: Moderate risk - reasonable for initial validation
- 100-200 samples: Acceptable - standard threshold
- 200+ samples: Good - statistical reliability

**Parameter Count Limits:**
Formula: max_params = floor(sqrt(num_samples) / 3)

| Samples | Max Safe Parameters |
|---------|-------------------|
| 50 | 2 |
| 100 | 3 |
| 200 | 4 |
| 400 | 6 |
| 1000 | 10 |

**Multiple Testing Correction (Bonferroni):**
When testing N combinations:
- Adjusted α = 0.05 / N
- Example: Testing 100 combos → need p < 0.0005

**Confidence Interval Width:**
95% CI for Sharpe Ratio: SR ± 1.96 × √((1 + 0.5×SR²)/n)

| Sharpe | 50 Samples | 100 Samples | 200 Samples |
|--------|-----------|------------|------------|
| 1.0 | ±0.31 | ±0.22 | ±0.15 |
| 1.5 | ±0.36 | ±0.25 | ±0.18 |
| 2.0 | ±0.43 | ±0.30 | ±0.21 |`;

/**
 * Generic Execution Realism (not domain-specific)
 */
export const EXECUTION_REALISM_GENERIC = `### Execution Realism Specification

**CRITICAL: These are common sources of backtest-to-live slippage**

#### Transaction Cost Components

\`\`\`
total_cost = spread_cost + slippage + commission + market_impact
\`\`\`

**Spread Cost:**
- Always use mid-price minus half-spread as entry baseline
- Research actual spreads for specific instruments
- Spreads widen during volatility spikes (2-5x typical)

**Slippage Model:**
\`\`\`
slippage = base_slippage × volatility_multiplier × size_multiplier

volatility_multiplier: 1.0 (normal), 2.0 (elevated), 3.0 (extreme)
size_multiplier: 1.0 (small), 1.5 (medium), 3.0+ (large relative to volume)
\`\`\`

**Liquidity Constraints:**
- Never exceed 1% of average daily volume
- Model partial fills for larger orders
- Account for time-of-day effects

**Best Practices:**
1. Research actual costs for your specific instruments
2. Stress test with 2x cost assumptions
3. Model execution as individual components, not aggregated
4. Verify assumptions against actual trading data when possible
5. Be skeptical of strategies that only work with optimistic assumptions`;

// =============================================================================
// BUILDER FUNCTIONS
// =============================================================================

/**
 * Build basic statistical context (always applicable)
 */
export function buildStatisticalContext(): string {
  return `## Statistical Methodology

${QUALITY_GATES}

${SAMPLE_SIZE_SPEC}`;
}

/**
 * Build full statistical context including walk-forward and execution
 */
export function buildFullStatisticalContext(): string {
  return `## Statistical Methodology

${QUALITY_GATES}

${WALK_FORWARD_SPEC}

${SAMPLE_SIZE_SPEC}

${EXECUTION_REALISM_GENERIC}`;
}

/**
 * Build context for a specific domain framework
 */
export function buildDomainContext(domain: DomainFramework): string {
  let context = `## Domain Context: ${domain.name}\n\n${domain.description}\n\n`;

  // Add classifications if present
  if (domain.classifications) {
    for (const classification of domain.classifications) {
      context += `### ${classification.name}\n`;
      for (const item of classification.items) {
        context += `${item.id}. **${item.label}** - ${item.description}\n`;
      }
      context += '\n';
    }
  }

  // Add thesis if present
  if (domain.thesis) {
    context += `### Core Thesis\n${domain.thesis}\n\n`;
  }

  // Add references if present
  if (domain.references) {
    for (const ref of domain.references) {
      context += `${ref.content}\n\n`;
    }
  }

  return context;
}

/**
 * Build framework context (domain-agnostic version)
 * Returns only statistical methodology
 */
export function buildFrameworkContext(): string {
  return buildStatisticalContext();
}

/**
 * Build framework context with optional domain injection
 */
export function buildFrameworkContextWithDomain(domain?: DomainFramework): string {
  let context = buildStatisticalContext();

  if (domain) {
    context = buildDomainContext(domain) + '\n---\n\n' + context;
  }

  return context;
}

/**
 * Build full framework context with optional domain injection
 */
export function buildFullFrameworkContext(domain?: DomainFramework): string {
  let context = buildFullStatisticalContext();

  if (domain) {
    context = buildDomainContext(domain) + '\n---\n\n' + context;
  }

  return context;
}

// =============================================================================
// GREEKS REFERENCE (Optional - for options domain)
// =============================================================================

/**
 * Deep dive into Options Greeks
 * Comprehensive understanding for serious options strategy work
 * This is DOMAIN-SPECIFIC and should only be included when relevant
 */
export const GREEKS_DEEP_DIVE = `
### Options Greeks - Deep Understanding

**DELTA (Directional Exposure)**
- Definition: ∂Price/∂Spot - Rate of change of option price vs underlying
- Range: 0 to 1 for calls, 0 to -1 for puts
- Delta-Neutral: Target Σ(delta × position_size × multiplier) ≈ 0
- Hedging Frequency:
  - Daily if |gamma| > 0.05 (high gamma positions)
  - Weekly for low gamma or high theta strategies
  - Immediate if delta exceeds ±0.3 per unit notional

**GAMMA (Convexity/Acceleration)**
- Definition: ∂Delta/∂Spot - Rate of change of delta
- Peaks at ATM, decays toward ITM/OTM
- Long Gamma Benefits: Profit when realized vol > implied vol
- Gamma Scalping: Break-even move = sqrt(2 × theta_decay / gamma)

**THETA (Time Decay)**
- Definition: ∂Price/∂Time - Daily value loss from time passing
- Accelerates: NOT linear - accelerates in final 2 weeks
- DTE-Based Decay Rates (ATM):
  - 60 DTE: ~0.02% of spot per day
  - 30 DTE: ~0.03% of spot per day
  - 14 DTE: ~0.05% of spot per day
  - 7 DTE: ~0.10% of spot per day

**VEGA (Volatility Sensitivity)**
- Definition: ∂Price/∂IV - Sensitivity to implied volatility changes
- Peaks at ATM, higher for longer-dated options
- Vega Crush: Post-earnings, IV typically drops 3-5 vol points

**CHARM (Delta Decay / Delta-Theta)**
- Definition: ∂Delta/∂Time - How delta changes as time passes
- For OTM: Delta decays toward 0
- For ITM: Delta moves toward ±1
- Magnitude: ~0.01-0.02 delta per day near ATM

**VANNA (Vol-Spot Correlation)**
- Definition: ∂Delta/∂IV = ∂Vega/∂Spot
- Creates systematic dealer hedging flows
- Volatility Skew Impact: OTM put vanna creates "vol down, spot down" correlation
`;

/**
 * Build options-specific context
 * Only use when working on options-related research
 */
export function buildOptionsContext(): string {
  return `${buildDomainContext(OPTIONS_DOMAIN)}

${GREEKS_DEEP_DIVE}`;
}

// =============================================================================
// LEGACY EXPORTS (Backwards compatibility)
// =============================================================================

/**
 * Regime Framework for options strategies
 * Used by evolution prompts
 */
export const REGIME_FRAMEWORK = `### Regime Framework

**6 Market Regimes:**
1. **LOW_VOL_GRIND** - VIX < 15, steady uptrend, low realized vol
2. **ELEVATED_VOL_TREND** - VIX 15-25, trending with higher daily ranges
3. **HIGH_VOL_OSCILLATION** - VIX 25-35, choppy, mean-reverting
4. **CRASH_ACCELERATION** - VIX > 35, panic selling, gap downs
5. **MELT_UP** - VIX < 20, parabolic moves, FOMO rallies
6. **COMPRESSION** - VIX declining, vol crush, range contraction

**Regime Detection Signals:**
- VIX level and trend
- Realized vs implied vol ratio
- Put/call skew
- Term structure (contango/backwardation)`;

/**
 * Convexity Profiles for options strategies
 * Used by evolution prompts
 */
export const CONVEXITY_PROFILES = `### Convexity Profiles

**6 Core Profiles:**
1. **Long Gamma ATM** - Profit from realized > implied vol (straddles)
2. **Short Gamma ATM** - Harvest theta in low vol (iron condors)
3. **Skew Convexity** - Exploit put skew steepness
4. **Vanna Harvesting** - Profit from vol-spot correlation
5. **Charm Decay** - Capture delta decay over time
6. **Vol-of-Vol** - Trade VIX options/futures

**Profile-Regime Alignment:**
- Long Gamma → HIGH_VOL_OSCILLATION, CRASH_ACCELERATION
- Short Gamma → LOW_VOL_GRIND, COMPRESSION
- Skew → ELEVATED_VOL_TREND, CRASH_ACCELERATION
- Vanna → Dealer hedging flows, quarterly expirations
- Charm → Time decay acceleration near expiration`;

/**
 * Build framework context with Greeks (legacy)
 * @deprecated Use buildOptionsContext() + buildFullStatisticalContext() instead
 */
export function buildFrameworkWithGreeks(): string {
  return `${buildOptionsContext()}

${buildFullStatisticalContext()}`;
}

/**
 * Build risk-focused framework context
 * Includes full statistical context with emphasis on risk metrics
 */
export function buildRiskFrameworkContext(): string {
  return `${buildOptionsContext()}

${buildFullStatisticalContext()}

### Risk-Specific Focus

**Drawdown Analysis:**
- Maximum drawdown (MDD) threshold: 20% absolute limit
- Drawdown duration: Track recovery time
- Underwater equity curve analysis

**Tail Risk Metrics:**
- CVaR (Conditional Value at Risk) at 95% and 99%
- Maximum single-day loss
- Skewness and kurtosis of returns

**Correlation Risk:**
- Strategy correlation matrix
- Regime-dependent correlations
- Concentration risk assessment`;
}
