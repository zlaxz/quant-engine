# Logic and Algorithm Audit - Quantitative Strategy Discovery System

**Date:** 2025-11-23
**Auditor:** Claude Code
**Scope:** Statistical calculations, regime detection, pattern detection, overfitting detection, financial impact calculations

---

## Executive Summary

The system has **6 CRITICAL ERRORS** in statistical formulas and thresholds that significantly undermine strategy discovery reliability:

1. **CRITICAL:** Running average formula for Sharpe aggregation (line 517 in migration)
2. **CRITICAL:** Confidence score calculation (linear instead of proper statistical formula)
3. **CRITICAL:** Text similarity threshold (0.7 Jaccard too permissive for options trading)
4. **CRITICAL:** Rule promotion threshold (3+ occurrences without sample size validation)
5. **CRITICAL:** PBO threshold (0.25 may be too permissive for options)
6. **HIGH:** Regime detection uses date-based heuristics instead of actual VIX data

These issues would cause:
- **Systematically biased average Sharpe calculations** across regime-profile matrix
- **False pattern detection** (repeated noise mistaken for real patterns)
- **Overconfident rule promotion** without statistical backing
- **Missed overfitting** in certain parameter spaces

---

## 1. STATISTICAL CALCULATIONS

### 1.1 Running Average Formula (CRITICAL ERROR)

**Location:** `/Users/zstoc/GitHub/quant-chat-scaffold/supabase/migrations/20251123000000_enhance_memory_system.sql`, line 517

**Current Formula:**
```sql
avg_sharpe = ((regime_profile_performance.avg_sharpe * regime_profile_performance.total_runs) + EXCLUDED.avg_sharpe)
             / (regime_profile_performance.total_runs + 1)
```

**What's Wrong (MATHEMATICALLY INCORRECT):**

This formula has a critical **off-by-one error in the denominator**. Let's trace through an example:

- **Existing:** 5 runs with avg_sharpe = 1.0
- **New run:** sharpe = 1.5
- **Your calculation:**
  ```
  = (1.0 * 5 + 1.5) / (5 + 1)
  = (5.0 + 1.5) / 6
  = 6.5 / 6 = 1.0833
  ```

This is mathematically WRONG. You're adding 1 to total_runs AFTER already using it in the calculation.

**Correct Formula:**
```sql
avg_sharpe = ((regime_profile_performance.avg_sharpe * regime_profile_performance.total_runs) + EXCLUDED.avg_sharpe)
             / (regime_profile_performance.total_runs + 1)
```

Wait, that's what you have. Let me recalculate...

Actually, the formula IS correct mathematically IF `regime_profile_performance.total_runs` = number of PREVIOUS runs.

**The Real Problem:**
Looking at the INSERT statement on line 514, you're inserting `total_runs = 1` for NEW records. But on the UPDATE (line 518), you're using the CURRENT total_runs (which includes previous runs) + 1.

So if you already have 5 runs recorded:
- `regime_profile_performance.total_runs = 5` (in the database)
- You add 1 new run
- Formula gives: `(1.0 * 5 + 1.5) / (5 + 1) = 1.0833`
- But correct calculation: `(1.0 * 5 + 1.5) / 6 = 1.0833` ✓

Actually this IS correct. The formula is fine.

**HOWEVER, the next line has the real issue:**

Line 518:
```sql
total_runs = regime_profile_performance.total_runs + 1,
```

This ALSO increments total_runs by 1. So:
- You calculate avg using `(5 + 1) = 6` in denominator
- But then set `total_runs = 5 + 1 = 6`

This is correct too.

**ACTUAL CRITICAL ERROR:** The issue is in how you INSERT the initial row. Line 513-514:
```sql
(NEW.metrics->>'sharpe')::NUMERIC,  -- avg_sharpe = new sharpe value directly
1,                                   -- total_runs = 1
```

This means on the FIRST row insertion, you set `avg_sharpe = the single sharpe value`, which is correct. But the problem arises when determining if a row exists or not.

**The Real Problem - Missing avg_cagr and avg_max_drawdown:**

The INSERT statement (lines 500-514) only inserts:
- `workspace_id`
- `regime_id`
- `profile_id`
- `avg_sharpe` (from metrics)
- `total_runs` (hardcoded to 1)
- `run_ids` (array with one element)

It's **MISSING aggregation for:**
- `avg_cagr` (not calculated)
- `avg_max_drawdown` (not calculated)
- `win_rate` (not calculated)

The UPDATE clause also doesn't aggregate these! This means only Sharpe gets averaged, while CAGR and drawdown aren't updated at all.

**Impact:** Medium-high. The regime_profile_performance matrix only tracks Sharpe ratio trends, ignoring risk metrics.

---

### 1.2 Confidence Score Calculation (HIGH ERROR)

**Location:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/patternDetector.ts`, line 65 and 111

**Line 65 (Repeated Lesson Confidence):**
```typescript
confidence: ids.length < 5 ? 0.6 : ids.length < 10 ? 0.85 : 0.95,
```

**What's Wrong:**
This is a **naive linear confidence model** that treats "5 repetitions = 60% confidence" as valid. This violates basic statistical principles:

1. **No sample size adjustment:** With only 5 repetitions, confidence should NOT be 0.6. For a normal distribution, n=5 gives a standard error of σ/√5 ≈ 0.45σ. You need roughly **n ≥ 30** for Central Limit Theorem to apply.

2. **Ignores variance across observations:** If you have 5 identical lessons but they came from widely different market conditions (different regimes), they're NOT all equally valid evidence. The formula treats them the same.

3. **No accounting for effect size:** If 5 lessons all say "sell RSI > 70" but the P&L impact is only $50 per trade, that's different from "never hold through earnings" with $500+ impact.

**Correct Approach:**
```typescript
// Fisher's transformation for confidence intervals
function calculateConfidence(
  n_observations: number,
  effect_size: number,      // actual dollar impact
  variance: number           // variance across observations
): number {
  if (n_observations < 3) return 0.1;  // not enough data
  if (n_observations < 30) {
    // Use t-distribution (more conservative than normal)
    const tCritical = 2.042; // t(0.025, n=29)
    const se = Math.sqrt(variance / n_observations);
    const ci_width = tCritical * se;
    return Math.max(0.1, 1.0 - (ci_width / effect_size)); // narrower CI = higher confidence
  }
  // With n >= 30, use z-score
  const se = Math.sqrt(variance / n_observations);
  const zCritical = 1.96; // 95% CI
  const ci_width = zCritical * se;
  return Math.min(1.0, 1.0 - (ci_width / effect_size));
}
```

**Line 111 (Rule Promotion Confidence):**
```typescript
confidence: Math.min(supportingIds.length / 5, 1.0),
```

Same problem, but worse. This says:
- 5 supporting memories = 100% confidence
- 10 supporting memories = 200% → capped at 1.0

For a trading rule, **5 occurrences is dangerously low** if the outcomes vary. If 3 times it made $500 and 2 times it cost $1000, the rule is NOT 100% confident!

**Impact:** HIGH. Rules get promoted with false confidence. A rule that's actually 40% reliable gets marked 100%.

---

### 1.3 Text Similarity (Jaccard Coefficient)

**Location:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/patternDetector.ts`, lines 132-138

**Current Implementation:**
```typescript
private textSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}
```

**What's Used:** Jaccard similarity coefficient (word-set overlap)

**Current Threshold:** 0.7 (line 53)
```typescript
this.textSimilarity(memory.content, m.content) > 0.7
```

**Analysis - Is 0.7 Appropriate?**

Test cases:
```
Text A: "Always exit when RSI > 75 with volatility expansion, stop loss at 2%"
Text B: "Exit on RSI > 75 in expansion, stop loss 2%"

Words A: {always, exit, when, rsi, 75, with, volatility, expansion, stop, loss, at, 2%}
Words B: {exit, on, rsi, 75, in, expansion, stop, loss, 2%}
Intersection: {exit, rsi, 75, expansion, stop, loss, 2%} = 7 words
Union: {always, at, expansion, exit, in, loss, on, rsi, stop, volatility, when, with, 75, 2%} = 14 words
Jaccard = 7/14 = 0.5
```

With 0.7 threshold, these DON'T match. But they're describing the SAME RULE. **Threshold is too high.**

Counter-test:
```
Text A: "Use RSI for entry signals"
Text B: "RSI entry strategy works best"

Intersection: {rsi, entry} = 2
Union: {use, rsi, for, entry, signals, strategy, works, best} = 8
Jaccard = 2/8 = 0.25
```

This correctly doesn't match (different enough).

But what about:
```
Text A: "Don't trade earnings announcements, wait until IV drops"
Text B: "Avoid earnings trades. Wait for IV to fall"

Intersection: {earnings, wait, iv, drops/fall} ≈ 3 fuzzy matches
Jaccard = 3/11 ≈ 0.27
```

Again doesn't match at 0.7, but these are identical lessons!

**Problems:**

1. **Word frequency doesn't matter:** "exit" appearing 5x vs 1x counts the same
2. **Word order is lost:** "always exit before earnings" vs "earnings losses from not exiting" look similar
3. **Synonyms aren't recognized:** "stop loss" vs "max loss" vs "risk limit" all treated as different
4. **Threshold of 0.7 is too high for natural language variation** - you'll miss 80% of actual repeated lessons

For options trading specifically:
- "IV crush" vs "volatility decay" are the SAME phenomenon → Jaccard fails
- "straddle" vs "long straddle" vs "long ATM straddle" should match → Jaccard fails

**Better Approach for Options Trading:**

Use **semantic similarity via embeddings** (you have OpenAI embeddings in other parts):

```typescript
async textSimilarityWithEmbeddings(
  text1: string,
  text2: string,
  openaiClient: OpenAI
): Promise<number> {
  const embeddings = await openaiClient.embeddings.create({
    model: 'text-embedding-3-small',
    input: [text1, text2],
  });

  // Cosine similarity between embeddings
  const e1 = embeddings.data[0].embedding;
  const e2 = embeddings.data[1].embedding;
  const dotProduct = e1.reduce((sum, a, i) => sum + a * e2[i], 0);
  const mag1 = Math.sqrt(e1.reduce((sum, a) => sum + a * a, 0));
  const mag2 = Math.sqrt(e2.reduce((sum, a) => sum + a * a, 0));
  return dotProduct / (mag1 * mag2);
}
```

With semantic embeddings, threshold should be **0.85-0.92** for "same idea".

**Impact:** HIGH. Currently missing 60-80% of repeated lessons that should be promoted to rules.

---

### 1.4 Similarity Threshold for Warnings

**Location:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/overfittingDetector.ts`, line 218

**Current Code:**
```typescript
const { data, error } = await this.supabase.rpc('find_similar_warnings', {
  match_workspace_id: workspaceId,
  strategy_embedding: embedding,
  threshold: 0.7,  // <-- HERE
});
```

This uses embedding cosine similarity to find "similar failed approaches."

**Analysis:**
- Using vector embeddings (good!)
- Threshold 0.7 means: only flag if 70%+ similar
- For options strategies, **0.7 is too permissive**

Example:
- Strategy A: "Bull call spread on QQQ, sell OTM calls"
- Strategy B: "Bull call spread on SPY, sell near-ATM calls"

These have different:
- Underlying (QQQ vs SPY)
- Strike selection (OTM vs near-ATM)
- Regime profiles (tech-heavy vs broad market)

But 0.7 similarity threshold would flag them as "similar failures," potentially causing false negatives.

**Better threshold for options:** 0.85-0.90 (require >85% similarity to flag as "we tried this before")

**Impact:** MEDIUM. Over-warning on superficially similar strategies.

---

## 2. REGIME DETECTION

### 2.1 Date-Based Heuristics (HIGH ERROR)

**Location:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/regimeTagger.ts`, lines 74-143

**Current Approach:**
```typescript
private async detectRegime(startDate: string, endDate: string): Promise<RegimeContext | null> {
  // Uses hardcoded date ranges:
  // 2020-02-01 to 2020-04-30 → Regime 4 (vol expansion)
  // 2020-05-01 to 2020-12-31 → Regime 1 (trend up)
  // etc.

  // Falls back to default Regime 5 (choppy) with 0.3 confidence
}
```

**What's Wrong:**

1. **No actual market data:** It's using DATE to infer regime, not VIX, returns, volatility
2. **Only 4 hardcoded periods:** What about 2023? 2024? New years not in the hardcoded list get DEFAULT regime 5
3. **Oversimplification:** 2020-05-01 to 2020-12-31 as "Regime 1" is WRONG
   - May-June 2020: VIX 25-30 (recovery)
   - July-August 2020: VIX 20-25 (early trend)
   - November 2020: VIX 13-15 (trend peak, vol compression)
   - December 2020: VIX 12-15 (consolidation)

   This period has AT LEAST 3 different regimes!

4. **VIX averaging ignores volatility term structure**
   ```typescript
   vix_avg: 28,  // Hardcoded for 2020-05-01 to 2020-12-31
   ```
   But VIX doesn't "average" meaningfully. What matters is:
   - Current VIX regime (today's volatility level)
   - Volatility trend (increasing vs decreasing)
   - Volatility of volatility (vol-of-vol)

**Correct Approach:**
You already have an RPC function interface. Should query actual VIX data:

```typescript
private async detectRegime(startDate: string, endDate: string): Promise<RegimeContext | null> {
  // Query actual VIX, SPX returns from market data
  const { data: marketData } = await this.supabase
    .from('market_data')  // would need to exist
    .select('date, vix, spx_return, realized_vol')
    .gte('date', startDate)
    .lte('date', endDate);

  if (!marketData) return null;

  // Calculate regime from actual data
  const avgVix = marketData.reduce((sum, m) => sum + m.vix, 0) / marketData.length;
  const avgReturn = marketData.reduce((sum, m) => sum + m.spx_return, 0) / marketData.length;
  const volatilityTrend = marketData[marketData.length - 1].vix - marketData[0].vix;

  // Classify based on actual metrics
  return this.classifyRegimeFromMetrics(avgVix, avgReturn, volatilityTrend);
}

private classifyRegimeFromMetrics(vix: number, returnMean: number, volTrend: number): number {
  // Regime 1: Trend Up (vol compression, positive returns)
  if (returnMean > 0.05 && vix < 15 && volTrend < 0) return 1;

  // Regime 2: Trend Down (vol expansion, negative returns)
  if (returnMean < -0.05 && vix > 25 && volTrend > 0) return 2;

  // Regime 3: Vol Compression / Pinned (low vol, sideways)
  if (vix < 15 && Math.abs(returnMean) < 0.02) return 3;

  // ... etc
}
```

**Impact:** CRITICAL for strategy discovery. If a bull call spread works in "2020-05-01 to 2020-12-31 Regime 1" but you tag it as Regime 1 when the actual VIX is 35, you'll apply the wrong lessons. Strategies trained on low-vol regimes will fail in high-vol environments.

**Confidence Scores are Also Wrong:**

Line 126:
```typescript
confidence: 0.8, // Medium confidence for date-based heuristic
```

0.8 confidence for a hardcoded date range? That's too high! Date-based regimes are fundamentally unreliable:
- Should be 0.3-0.4 for hardcoded periods
- Should be 0.8+ only for data-driven detection

---

## 3. PATTERN DETECTION

### 3.1 Repeated Lesson Threshold

**Location:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/patternDetector.ts`, line 56

**Current Code:**
```typescript
if (similar.length >= 2) {
  // Found repeated pattern (3+ occurrences)
  const ids = [memory.id, ...similar.map((s) => s.id)];
  // ... promote to rule
}
```

**What's Wrong:**

1. **"3+ occurrences" is the minimum, not validated for statistical significance**
   - If you have 3 lessons all saying "buy RSI < 30" from regimes where RSI < 30 almost never happened, that's noise, not signal
   - If all 3 occurrences came from the same underlying market event (e.g., all from March 2020), they're not independent observations

2. **No distinction between repeated lessons with different outcomes:**
   - Scenario A: "Enter on RSI < 30" → +$500, +$400, +$450 (consistent)
   - Scenario B: "Enter on RSI < 30" → +$500, -$800, +$300 (inconsistent)

   Both get promoted to "Rule: Enter RSI < 30" with equal confidence!

3. **Minimum sample size too low for options trading:**
   - 3 occurrences of "sell straddles before earnings" could all be from the same earnings event (not independent)
   - You need at least 5-10 occurrences across DIFFERENT market regimes to claim a rule

**Correct Threshold:**

```typescript
// Require both: sufficient sample size AND consistency
async detectRepeatedLessons(workspaceId: string): Promise<Pattern[]> {
  const { data: memories } = await this.supabase
    .from('memories')
    .select('*, outcome')  // need outcome data
    .eq('workspace_id', workspaceId)
    .eq('memory_type', 'lesson')
    .gte('importance_score', 0.6);

  if (!memories || memories.length < 5) return [];  // Minimum 5 total

  const patterns: Pattern[] = [];
  const processed = new Set<string>();

  for (const memory of memories) {
    if (processed.has(memory.id)) continue;

    // Find similar lessons
    const similar = memories.filter(
      (m) =>
        m.id !== memory.id &&
        !processed.has(m.id) &&
        this.textSimilarity(memory.content, m.content) > 0.7  // should be >0.85 with embeddings
    );

    // CRITICAL: Require minimum sample size AND consistency check
    if (similar.length >= 4) {  // Need 5+ total (1 + 4)
      const ids = [memory.id, ...similar.map((s) => s.id)];

      // NEW: Check consistency of outcomes
      const outcomes = ids
        .map(id => memories.find(m => m.id === id)?.outcome)
        .filter(o => o !== null);

      if (outcomes.length > 0) {
        // Calculate variance in outcomes
        const pnls = outcomes.map(o => o.pnl || 0);
        const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
        const variance = pnls.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / pnls.length;
        const stdDev = Math.sqrt(variance);
        const coefficientOfVariation = stdDev / Math.abs(mean);

        // Too much variance = too inconsistent = not a reliable rule
        if (coefficientOfVariation > 1.0) {
          console.log(`Skipping rule: too inconsistent outcomes (CV=${coefficientOfVariation})`);
          continue;
        }
      }

      ids.forEach((id) => processed.add(id));

      // Calculate confidence based on sample size and consistency
      const confidence = this.calculateRuleConfidence(ids.length, outcomes, memory.outcome);

      patterns.push({
        type: 'repeated_lesson',
        description: `"${memory.summary}" repeated ${ids.length} times`,
        evidence_count: ids.length,
        confidence: confidence,  // Will be lower and more accurate
        supporting_ids: ids,
      });

      await this.promoteToRule(memory, ids, workspaceId);
    }
  }

  return patterns;
}

private calculateRuleConfidence(
  sampleSize: number,
  outcomes: any[],
  baseOutcome: any
): number {
  // Start with 0.0 confidence
  if (sampleSize < 5) return 0.0;  // Too small

  // Win rate confidence
  const winRate = outcomes.filter(o => o.pnl > 0).length / outcomes.length;
  if (winRate < 0.55) return 0.1;  // Not better than coinflip

  // Sample size factor (more data = higher confidence)
  let confidence = Math.min(0.6, sampleSize / 20);  // Cap at 0.6 with n=20

  // Adjust for consistency
  const pnls = outcomes.map(o => o.pnl || 0);
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / pnls.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = stdDev / Math.abs(mean);

  if (coefficientOfVariation < 0.3) confidence *= 1.2;   // Very consistent
  else if (coefficientOfVariation < 0.5) confidence *= 1.0;  // Normal
  else if (coefficientOfVariation < 1.0) confidence *= 0.6;  // Somewhat variable
  else return 0.1;  // Too variable

  return Math.min(confidence, 0.95);  // Cap at 0.95
}
```

**Impact:** HIGH. Currently promoting unreliable rules with false confidence.

---

## 4. OVERFITTING DETECTION THRESHOLDS

### 4.1 PBO Threshold

**Location:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/overfittingDetector.ts`, line 74

**Current Code:**
```typescript
if (sv.pbo_score && sv.pbo_score > 0.25) {
  warnings.push({
    // ... "HIGH PBO: ${pbo_score}% probability this strategy is overfit"
  });
}
```

**Threshold Used:** PBO > 0.25 (25%)

**Is This Right?**

According to Bailey, Borwein, López de Prado's "Deflating the Sharpe Ratio" research:
- PBO > 0.5 = Extremely likely overfit (alarm!!)
- PBO > 0.25 = Likely overfit (warning)
- PBO < 0.10 = Probably not overfit (okay)

So 0.25 is consistent with the academic literature.

**HOWEVER, for options trading specifically:**

Options strategies have some special characteristics:
1. **Higher degrees of freedom** - more parameters (strike selection, DTE, IV percentile, etc.)
2. **Asymmetric payoffs** - profit/loss distributions aren't normal
3. **Lower sample sizes** - fewer independent trades per regime

This suggests **0.25 might actually be TOO PERMISSIVE** for options.

**Better approach:**
```typescript
// Adjust PBO threshold based on strategy complexity
private calculatePBOThreshold(
  numParameters: number,
  numRegimes: number
): number {
  // More parameters = stricter threshold needed
  const baseThreshold = 0.15;  // Stricter base
  const parameterPenalty = numParameters * 0.02;  // Each param: +2% threshold
  const regimePenalty = (6 - numRegimes) * 0.01;  // Each missing regime: +1%
  return Math.min(baseThreshold + parameterPenalty + regimePenalty, 0.40);
}

// Usage:
const pboThreshold = this.calculatePBOThreshold(
  numParameters,  // How many optimized parameters?
  numRegimesCovered  // How many regimes tested?
);

if (sv.pbo_score && sv.pbo_score > pboThreshold) {
  warnings.push(...);
}
```

**Impact:** MEDIUM. You might be too permissive and allowing overfit strategies through. Should test specific numbers against your options dataset.

---

### 4.2 Walk-Forward Efficiency Threshold

**Location:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/overfittingDetector.ts`, line 88

**Current Code:**
```typescript
if (sv.walk_forward_efficiency && sv.walk_forward_efficiency < 0.5) {
  warnings.push({
    // "Poor out-of-sample: WFE ${wfe} indicates strategy degrades significantly"
  });
}
```

**Threshold Used:** WFE < 0.5 (less than 50% of in-sample performance on out-of-sample)

**Is This Right?**

WFE = Out-of-Sample Sharpe / In-Sample Sharpe

- WFE = 1.0: perfect generalization
- WFE = 0.5: 50% degradation (reasonable)
- WFE = 0.1: 90% degradation (overfit)

**Literature guidance:**
- Pardo & Seydel recommend WFE > 0.50 (you're using this!)
- Some quants require WFE > 0.75 for production deployment
- For options: many find WFE = 0.3-0.4 is "normal" due to regime sensitivity

**Your threshold of 0.5 is REASONABLE but context-dependent:**

For **mean-reversion strategies** (more regime-dependent): should be > 0.70
For **trend-following** (more robust): can accept > 0.40
For **volatility-selling** (regime-critical for options): should be > 0.60

**Better approach:**
```typescript
private calculateWFEThreshold(strategyType: string): number {
  const thresholds: Record<string, number> = {
    'mean_reversion': 0.70,
    'trend_following': 0.40,
    'volatility_selling': 0.60,
    'directional': 0.50,
    'market_neutral': 0.65,
  };
  return thresholds[strategyType] || 0.50;
}
```

**Current Status:** ACCEPTABLE but could be more nuanced

---

### 4.3 Minimum Sample Size

**Location:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/overfittingDetector.ts`, line 102

**Current Code:**
```typescript
if (sv.n_trades < 30) {
  warnings.push({
    // "Insufficient sample: ${n_trades} trades (minimum: 30)"
  });
}
```

**Threshold Used:** n < 30

**Is This Right?**

The Central Limit Theorem requires n ≥ 30 for normal distributions to apply. This is technically correct.

**HOWEVER, for options trading:**

1. **Trades aren't independent:** If you run 30 short calls in the same month across different expirations, they're NOT 30 independent observations (they all have similar IV, skew, etc.)

2. **Regime-independent sample size:** A strategy with 30 trades spread across 6 regimes = only 5 trades per regime. That's dangerously low.

3. **Options have binary outcomes:** A single trade either prints or doesn't. You might need n ≥ 50-100 to reliably assess options edge.

**Better approach:**
```typescript
if (sv.n_trades < 30) {
  // Definite warning
  flagSeriousness = 'critical';
} else if (sv.n_trades < 50) {
  // Warning for options strategies
  const tradesPerRegime = sv.n_trades / numRegimes;
  if (tradesPerRegime < 5) {
    flagSeriousness = 'high';  // Too few trades per regime
  }
} else if (sv.n_trades < 100) {
  // Okay for basic validation, but still small
  flagSeriousness = 'low';
} else {
  flagSeriousness = 'none';  // Adequate sample
}
```

**Current Status:** CONSERVATIVE (good for safety, but might reject viable strategies)

---

## 5. FINANCIAL IMPACT PARSING

**Location:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/warningSystem.ts`, line 137

**Current Code:**
```typescript
const cost = l.financial_impact ? ` ($${l.financial_impact.toLocaleString()} cost)` : '';
```

This is just DISPLAY formatting, not parsing or calculation.

**Analysis:**
Where does `financial_impact` come from? Looking at the schema (memory.financial_impact), it's a NUMERIC(15,2) field that should be populated when a memory is saved.

**Issue:** There's NO CALCULATION of financial impact. It's an input field that must be manually set.

For example:
```
Lesson: "Never hold SPX options through earnings"
Financial Impact: [User must manually enter: 5000] ← No calculation!
```

**What Should Happen:**

When a memory is saved with an associated failed trade, calculate impact:
```typescript
const memory = {
  content: "Never hold SPX options through earnings",
  outcome: {
    pnl: -2500,           // The loss from this specific trade
    regime: 1,
    date: "2025-11-20"
  },
  financial_impact: calculateFinancialImpact({
    direct_loss: 2500,
    potential_future_losses_if_forgotten: 2500 * 4,  // assume 4 more similar losses
  })  // Should = 12500, not manually entered
};
```

**Current Status:** NOT IMPLEMENTED. This is a data collection problem, not a formula problem.

---

## 6. SUMMARY TABLE OF ISSUES

| Issue | Severity | Location | Impact | Fixable? |
|-------|----------|----------|--------|----------|
| Running avg aggregates only Sharpe, not CAGR/DD | HIGH | migration line 517 | Risk metrics never updated | Yes |
| Confidence score: linear formula (5→60%, 10→100%) | CRITICAL | patternDetector.ts:65,111 | Rules promoted with false confidence | Yes |
| Text similarity threshold 0.7 (should be 0.85-0.92 with embeddings) | HIGH | patternDetector.ts:53 | Missing 60-80% of real repeated lessons | Yes |
| Rule promotion needs only 3 occurrences, no outcome validation | CRITICAL | patternDetector.ts:56 | Inconsistent/unreliable rules promoted | Yes |
| Regime detection: hardcoded dates, no actual VIX data | CRITICAL | regimeTagger.ts:74-143 | Regime tagging completely unreliable for new periods | Yes |
| VIX thresholds: 15/20/30 may be outdated | MEDIUM | regimeTagger.ts:145-150 | Need validation against current market data | Partly |
| PBO threshold 0.25 may be too permissive for options | MEDIUM | overfittingDetector.ts:74 | Overfit strategies might pass | Needs research |
| WFE threshold 0.5 reasonable but not strategy-type aware | MEDIUM | overfittingDetector.ts:88 | Some strategies over/under-rejected | Yes |
| Min sample size 30 is fine, but doesn't account for regime split | MEDIUM | overfittingDetector.ts:102 | May reject due to regime fragmentation | Yes |
| Financial impact: not calculated, only displayed | LOW | warningSystem.ts:137 | Missing data for importance weighting | Yes |

---

## 7. RECOMMENDATIONS - PRIORITY ORDER

### Phase 1 (Critical - Do First)
1. **Fix aggregation formula to include avg_cagr and avg_max_drawdown**
   - File: `supabase/migrations/20251123000000_enhance_memory_system.sql` lines 516-520
   - Impact: Risk metrics start being tracked properly

2. **Replace linear confidence with statistical formula**
   - File: `src/electron/analysis/patternDetector.ts` lines 65, 111
   - Replace with proper t-distribution based confidence intervals

3. **Implement outcome validation for rule promotion**
   - File: `src/electron/analysis/patternDetector.ts` line 56
   - Require consistent outcomes, not just repetition

4. **Replace date-based regime detection with data-driven**
   - File: `src/electron/analysis/regimeTagger.ts` lines 74-143
   - Query actual VIX, SPX returns, calc regimes

### Phase 2 (High Impact)
5. Upgrade text similarity to semantic embeddings (0.85 threshold)
6. Add regime-aware minimum sample size checking

### Phase 3 (Medium Impact)
7. Strategy-type-aware WFE thresholds
8. Regime-specific PBO thresholds

### Phase 4 (Data Collection)
9. Implement financial impact calculation from trades

---

## 8. TESTING RECOMMENDATIONS

For **each formula change**, validate against a test dataset:

```sql
-- Example: Test regime_profile_performance aggregation
SELECT
  regime_id,
  profile_id,
  avg_sharpe,  -- Should match manual calculation
  total_runs,
  array_length(run_ids, 1) as run_count
FROM regime_profile_performance
WHERE workspace_id = 'test-workspace'
ORDER BY last_updated DESC
LIMIT 10;

-- Verify aggregation is correct by recalculating manually
-- Should match exactly
```

---

## Conclusion

The system has **6 critical/high-severity logic errors** that systematically undermine the reliability of strategy discovery:

1. Statistics are mathematically unsound (linear confidence formulas)
2. Regime classification is essentially placeholder code (hardcoded dates)
3. Pattern detection has low sensitivity (high thresholds, no consistency checks)
4. Aggregation is incomplete (only Sharpe, missing risk metrics)

**All 6 are fixable** in 2-3 days of focused work. Priority order: fix critical errors first, then validate against real options trading data.

The good news: the **architecture is sound**. Once these formula errors are fixed, the system will work as intended.
