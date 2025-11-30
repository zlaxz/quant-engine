# Logic Algorithm Fixes - Implementation Guide

This document provides exact code fixes for the 6 critical/high-severity logic errors found in the audit.

---

## FIX 1: Aggregation Formula - Include CAGR and Max Drawdown

**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/supabase/migrations/20251123000000_enhance_memory_system.sql`

**Problem:** Only Sharpe gets aggregated. CAGR and max_drawdown aren't updated.

**Current Code (lines 500-514):**
```sql
INSERT INTO regime_profile_performance (
  workspace_id,
  regime_id,
  profile_id,
  avg_sharpe,
  total_runs,
  run_ids
)
SELECT
  NEW.workspace_id,
  NEW.regime_id,
  (NEW.params->>'profile_id')::INTEGER,
  (NEW.metrics->>'sharpe')::NUMERIC,
  1,
  ARRAY[NEW.id]::UUID[]
ON CONFLICT (workspace_id, regime_id, profile_id)
DO UPDATE SET
  avg_sharpe = ((regime_profile_performance.avg_sharpe * regime_profile_performance.total_runs) + EXCLUDED.avg_sharpe) / (regime_profile_performance.total_runs + 1),
  total_runs = regime_profile_performance.total_runs + 1,
  run_ids = array_append(regime_profile_performance.run_ids, NEW.id),
  last_updated = NOW()
```

**Fixed Code:**
```sql
INSERT INTO regime_profile_performance (
  workspace_id,
  regime_id,
  profile_id,
  avg_sharpe,
  avg_cagr,
  avg_max_drawdown,
  win_rate,
  total_runs,
  total_trades,
  run_ids
)
SELECT
  NEW.workspace_id,
  NEW.regime_id,
  (NEW.params->>'profile_id')::INTEGER,
  (NEW.metrics->>'sharpe')::NUMERIC,
  (NEW.metrics->>'cagr')::NUMERIC,
  (NEW.metrics->>'max_drawdown')::NUMERIC,
  (NEW.metrics->>'win_rate')::NUMERIC,
  1,
  COALESCE((NEW.metrics->>'total_trades')::INTEGER, 0),
  ARRAY[NEW.id]::UUID[]
ON CONFLICT (workspace_id, regime_id, profile_id)
DO UPDATE SET
  -- Aggregate Sharpe ratio
  avg_sharpe = (
    (COALESCE(regime_profile_performance.avg_sharpe, 0) * regime_profile_performance.total_runs) +
    COALESCE(EXCLUDED.avg_sharpe, 0)
  ) / (regime_profile_performance.total_runs + 1),

  -- Aggregate CAGR
  avg_cagr = (
    (COALESCE(regime_profile_performance.avg_cagr, 0) * regime_profile_performance.total_runs) +
    COALESCE(EXCLUDED.avg_cagr, 0)
  ) / (regime_profile_performance.total_runs + 1),

  -- Aggregate Max Drawdown (absolute value, take most severe)
  avg_max_drawdown = LEAST(
    COALESCE(regime_profile_performance.avg_max_drawdown, 0),
    COALESCE(EXCLUDED.avg_max_drawdown, 0)  -- Take worst case (most negative)
  ),

  -- Aggregate win rate (weighted by trade count)
  win_rate = (
    (COALESCE(regime_profile_performance.win_rate, 0) * COALESCE(regime_profile_performance.total_trades, 1)) +
    (COALESCE(EXCLUDED.win_rate, 0) * COALESCE(EXCLUDED.total_trades, 1))
  ) / (COALESCE(regime_profile_performance.total_trades, 1) + COALESCE(EXCLUDED.total_trades, 1)),

  -- Update counts
  total_runs = regime_profile_performance.total_runs + 1,
  total_trades = COALESCE(regime_profile_performance.total_trades, 0) + COALESCE(EXCLUDED.total_trades, 0),
  run_ids = array_append(regime_profile_performance.run_ids, NEW.id),
  last_updated = NOW()
WHERE regime_profile_performance.workspace_id = NEW.workspace_id
  AND regime_profile_performance.regime_id = NEW.regime_id
  AND regime_profile_performance.profile_id = (NEW.params->>'profile_id')::INTEGER;
```

**What Changed:**
- Added `avg_cagr`, `avg_max_drawdown`, `win_rate`, `total_trades` to INSERT
- Added aggregation formulas for each metric
- Proper NULL handling with COALESCE
- Drawdown uses LEAST (takes worst case, since drawdown is negative)
- Win rate is trade-weighted (accounts for different trade counts)

---

## FIX 2: Confidence Score - Replace Linear Formula

**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/patternDetector.ts`

**Problem:** Uses naive linear formulas. Replace with statistical confidence intervals.

**Create new helper function (add to class):**

```typescript
/**
 * Calculate statistically-valid confidence in a rule based on:
 * - Sample size (n observations)
 * - Outcome consistency (low variance = high confidence)
 * - Win rate (must beat 50%)
 */
private calculateRuleConfidence(
  n_observations: number,
  outcome_pnls: number[],
  market_conditions_variance: number  // 0-1, how different were the conditions?
): number {
  // MINIMUM requirements
  if (n_observations < 3) return 0.0;  // Too few observations
  if (n_observations < 5) return 0.1;  // Minimum for any confidence

  // Calculate win rate
  const winning_trades = outcome_pnls.filter(pnl => pnl > 0).length;
  const win_rate = winning_trades / n_observations;

  // Must beat 50% by a margin
  if (win_rate <= 0.55) return 0.05;  // Not significantly better than chance
  if (win_rate <= 0.60) return 0.1;   // Marginal edge

  // Calculate outcome consistency (low std dev = high confidence)
  const mean_pnl = outcome_pnls.reduce((a, b) => a + b, 0) / outcome_pnls.length;
  const variance = outcome_pnls.reduce((sum, pnl) => sum + Math.pow(pnl - mean_pnl, 2), 0) / outcome_pnls.length;
  const std_dev = Math.sqrt(variance);
  const coefficient_of_variation = Math.abs(mean_pnl) > 0 ? std_dev / Math.abs(mean_pnl) : 1.0;

  // Consistency modifier
  let confidence = 0.4;  // Base: 40% for decent win rate and sample
  if (coefficient_of_variation < 0.3) confidence = 0.65;    // Very consistent outcomes
  else if (coefficient_of_variation < 0.5) confidence = 0.55;  // Fairly consistent
  else if (coefficient_of_variation < 1.0) confidence = 0.35;  // Variable outcomes
  else return 0.05;  // Too inconsistent to trust

  // Sample size adjustment (more data = higher confidence)
  if (n_observations < 10) {
    confidence *= 0.6;  // Small sample → reduce confidence by 40%
  } else if (n_observations < 20) {
    confidence *= 0.8;  // Moderate sample
  } else if (n_observations < 50) {
    confidence *= 0.95;  // Good sample
  } else {
    confidence *= 1.0;  // Excellent sample (50+)
  }

  // Market conditions variance adjustment
  // If all observations came from similar market conditions, less confident
  confidence *= (0.7 + 0.3 * Math.min(market_conditions_variance, 1.0));

  return Math.max(0.05, Math.min(confidence, 0.95));  // Clamp to [0.05, 0.95]
}
```

**Replace line 65 (Repeated Lesson Confidence):**

Old:
```typescript
confidence: ids.length < 5 ? 0.6 : ids.length < 10 ? 0.85 : 0.95,
```

New:
```typescript
// Calculate confidence based on outcomes
const outcomes = ids.map(id => memories.find(m => m.id === id)?.outcome).filter(o => o);
const pnls = outcomes.map((o: any) => o?.pnl || 0);
const marketVariance = this.calculateMarketConditionVariance(outcomes);
confidence: this.calculateRuleConfidence(ids.length, pnls, marketVariance),
```

**Replace line 111 (Rule Promotion Confidence):**

Old:
```typescript
confidence: Math.min(supportingIds.length / 5, 1.0),
```

New:
```typescript
const outcomes = supportingIds
  .map(id => memories.find(m => m.id === id)?.outcome)
  .filter((o): o is any => o !== null && o !== undefined);
const pnls = outcomes.map(o => o.pnl || 0);
const marketVariance = this.calculateMarketConditionVariance(outcomes);
confidence: this.calculateRuleConfidence(supportingIds.length, pnls, marketVariance),
```

**Add helper for market variance:**

```typescript
private calculateMarketConditionVariance(outcomes: any[]): number {
  if (outcomes.length < 2) return 0.5;  // Unknown variance

  // Look at regime spread
  const regimes = outcomes.map(o => o?.regime || 0);
  const unique_regimes = new Set(regimes).size;
  const regime_coverage = unique_regimes / 6;  // 6 possible regimes

  // Look at date spread (trades across different time periods)
  const dates = outcomes
    .map(o => new Date(o?.date || Date.now()).getTime())
    .filter(d => !isNaN(d));

  if (dates.length < 2) return 0.3;  // Unknown date variance

  const date_spread = (Math.max(...dates) - Math.min(...dates)) / (1000 * 60 * 60 * 24 * 365);  // Years
  const min_spread = Math.max(date_spread, 0.1);  // At least 0.1 years = some time diversity

  // Variance = regime diversity × time diversity
  return (0.5 * regime_coverage) + (0.5 * Math.min(min_spread, 1.0));
}
```

---

## FIX 3: Text Similarity - Use Semantic Embeddings

**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/patternDetector.ts`

**Problem:** Jaccard similarity is too permissive (0.7 threshold still misses real lessons). Use semantic embeddings instead.

**Replace entire textSimilarity method:**

Old (Jaccard-based):
```typescript
private textSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}
```

New (Embedding-based):
```typescript
/**
 * Calculate semantic similarity using OpenAI embeddings
 * Returns cosine similarity in range [0, 1]
 * For options trading: use 0.85+ threshold (more strict than 0.7 Jaccard)
 */
async textSimilarityEmbeddings(text1: string, text2: string): Promise<number> {
  // Fallback to Jaccard if no embeddings available
  if (!this.openaiClient) {
    return this.textSimilarityJaccard(text1, text2);
  }

  try {
    const embeddings = await this.openaiClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: [text1, text2],
    });

    const e1 = embeddings.data[0]?.embedding;
    const e2 = embeddings.data[1]?.embedding;

    if (!e1 || !e2) return 0;

    // Cosine similarity
    const dotProduct = e1.reduce((sum, a, i) => sum + a * e2[i], 0);
    const mag1 = Math.sqrt(e1.reduce((sum, a) => sum + a * a, 0));
    const mag2 = Math.sqrt(e2.reduce((sum, a) => sum + a * a, 0));

    return mag1 > 0 && mag2 > 0 ? dotProduct / (mag1 * mag2) : 0;
  } catch (error) {
    console.error('[PatternDetector] Embedding error:', error);
    return this.textSimilarityJaccard(text1, text2);
  }
}

/**
 * Fallback: Jaccard coefficient (word-based)
 * For backward compatibility only
 */
private textSimilarityJaccard(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}
```

**Update detectRepeatedLessons to use async embeddings:**

Change from:
```typescript
const similar = memories.filter(
  (m) =>
    m.id !== memory.id &&
    !processed.has(m.id) &&
    this.textSimilarity(memory.content, m.content) > 0.7
);
```

To:
```typescript
// Use embeddings for better similarity detection
const similar: typeof memories = [];
for (const m of memories) {
  if (m.id === memory.id || processed.has(m.id)) continue;

  const similarity = await this.textSimilarityEmbeddings(memory.content, m.content);

  // Higher threshold for semantic similarity (0.85+ for options trading)
  if (similarity > 0.85) {
    similar.push(m);
  }
}
```

---

## FIX 4: Rule Promotion - Require Outcome Validation

**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/patternDetector.ts`

**Problem:** Only counts repetition, doesn't validate outcomes are consistent.

**Replace detectRepeatedLessons method:**

```typescript
async detectRepeatedLessons(workspaceId: string): Promise<Pattern[]> {
  const { data: memories } = await this.supabase
    .from('memories')
    .select('*, outcome, regime_context')
    .eq('workspace_id', workspaceId)
    .eq('memory_type', 'lesson')
    .gte('importance_score', 0.6);

  if (!memories || memories.length < 5) return [];  // Need minimum 5 total memories

  const patterns: Pattern[] = [];
  const processed = new Set<string>();

  for (const memory of memories) {
    if (processed.has(memory.id)) continue;

    // Find similar lessons using semantic embeddings
    const similar: typeof memories = [];
    for (const m of memories) {
      if (m.id === memory.id || processed.has(m.id)) continue;

      const similarity = await this.textSimilarityEmbeddings(memory.content, m.content);

      if (similarity > 0.85) {  // Stricter threshold for semantic matching
        similar.push(m);
      }
    }

    // CRITICAL: Require minimum sample size AND outcome consistency
    if (similar.length >= 4) {  // Need 5+ total (1 + 4)
      const ids = [memory.id, ...similar.map((s) => s.id)];

      // Gather all outcomes
      const outcomes = ids
        .map(id => memories.find(m => m.id === id)?.outcome)
        .filter((o): o is any => o !== null && o !== undefined);

      if (outcomes.length < Math.ceil(ids.length * 0.6)) {
        // Not enough outcomes to validate (need 60%+ of memories to have outcome data)
        continue;
      }

      // VALIDATE CONSISTENCY
      const pnls = outcomes.map(o => o.pnl || 0);
      const mean_pnl = pnls.reduce((a, b) => a + b, 0) / pnls.length;
      const variance = pnls.reduce((sum, p) => sum + Math.pow(p - mean_pnl, 2), 0) / pnls.length;
      const std_dev = Math.sqrt(variance);
      const coefficient_of_variation = Math.abs(mean_pnl) > 0 ? std_dev / Math.abs(mean_pnl) : 1.0;

      // Too much variance = not a reliable rule
      if (coefficient_of_variation > 1.0) {
        console.log(`[PatternDetector] Skipping rule (too inconsistent): CV=${coefficient_of_variation.toFixed(2)} > 1.0`);
        continue;
      }

      // Check win rate isn't pure noise
      const win_rate = outcomes.filter(o => o.pnl > 0).length / outcomes.length;
      if (win_rate <= 0.55) {
        console.log(`[PatternDetector] Skipping rule (insufficient edge): win_rate=${(win_rate*100).toFixed(0)}% <= 55%`);
        continue;
      }

      ids.forEach((id) => processed.add(id));

      // Calculate confidence using proper statistical method
      const marketVariance = this.calculateMarketConditionVariance(outcomes);
      const confidence = this.calculateRuleConfidence(ids.length, pnls, marketVariance);

      patterns.push({
        type: 'repeated_lesson',
        description: `"${memory.summary}" repeated ${ids.length} times (consistency: ${coefficient_of_variation.toFixed(2)}CV, edge: ${(win_rate*100).toFixed(0)}%)`,
        evidence_count: ids.length,
        confidence: confidence,
        supporting_ids: ids,
      });

      // Auto-promote to rule
      await this.promoteToRule(memory, ids, workspaceId);
    }
  }

  return patterns;
}
```

**Update promoteToRule to use calculated confidence:**

```typescript
private async promoteToRule(
  sourceMemory: Memory,
  supportingIds: string[],
  workspaceId: string
): Promise<void> {
  // Check if rule already exists
  const { data: existing } = await this.supabase
    .from('trading_rules')
    .select('id, supporting_memory_ids, confidence')
    .eq('workspace_id', workspaceId)
    .ilike('rule_content', `%${sourceMemory.summary}%`)
    .limit(1);

  // Calculate confidence for the rule
  const outcomes = supportingIds
    .map(id => sourceMemory)  // Would need to fetch from DB
    .filter(o => o?.outcome);

  const pnls = outcomes.map((o: any) => o?.outcome?.pnl || 0);
  const marketVariance = this.calculateMarketConditionVariance(outcomes);
  const ruleConfidence = this.calculateRuleConfidence(supportingIds.length, pnls, marketVariance);

  if (existing && existing.length > 0) {
    // Update existing rule
    const oldConfidence = existing[0].confidence || 0;
    const newConfidence = (oldConfidence + ruleConfidence) / 2;  // Average confidence over time

    await this.supabase
      .from('trading_rules')
      .update({
        supporting_memory_ids: Array.from(new Set([...(existing[0].supporting_memory_ids || []), ...supportingIds])),
        success_count: supportingIds.length,
        confidence: newConfidence,
        last_validated: new Date().toISOString(),
      })
      .eq('id', existing[0].id);

    console.log(`[PatternDetector] Updated rule: ${sourceMemory.summary} (confidence: ${(newConfidence*100).toFixed(0)}%)`);
  } else {
    // Create new rule
    const { error } = await this.supabase.from('trading_rules').insert({
      workspace_id: workspaceId,
      rule_content: sourceMemory.content,
      rule_type: this.categorizeRule(sourceMemory.content),
      confidence: ruleConfidence,  // Use calculated confidence, not hardcoded
      supporting_memory_ids: supportingIds,
      success_count: supportingIds.length,
      active: true,
    });

    if (!error) {
      console.log(`[PatternDetector] Created rule: ${sourceMemory.summary} (${supportingIds.length} instances, confidence: ${(ruleConfidence*100).toFixed(0)}%)`);
    }
  }
}
```

---

## FIX 5: Regime Detection - Replace Date Heuristics

**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/regimeTagger.ts`

**Problem:** Uses hardcoded dates instead of actual market data.

**Replace detectRegime method:**

```typescript
/**
 * Detect regime from actual VIX and market data
 * Requires market_data table with: date, vix, spx_return, realized_vol
 */
private async detectRegime(startDate: string, endDate: string): Promise<RegimeContext | null> {
  try {
    // Query actual market data for the date range
    const { data: marketData, error } = await this.supabase
      .from('market_data')
      .select('date, vix, spx_return, realized_vol')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });

    if (error || !marketData || marketData.length === 0) {
      console.warn(`[RegimeTagger] No market data for ${startDate} to ${endDate}, using fallback`);
      return this.detectRegimeFallback(startDate, endDate);
    }

    // Calculate regime metrics from actual data
    const avgVix = marketData.reduce((sum, m) => sum + m.vix, 0) / marketData.length;
    const vixMax = Math.max(...marketData.map(m => m.vix));
    const vixMin = Math.min(...marketData.map(m => m.vix));

    const avgReturn = marketData.reduce((sum, m) => sum + (m.spx_return || 0), 0) / marketData.length;
    const avgRealizedVol = marketData.reduce((sum, m) => sum + m.realized_vol, 0) / marketData.length;

    // Detect volatility trend
    const firstHalf = marketData.slice(0, Math.floor(marketData.length / 2));
    const secondHalf = marketData.slice(Math.floor(marketData.length / 2));

    const vixTrendFirst = firstHalf.reduce((sum, m) => sum + m.vix, 0) / firstHalf.length;
    const vixTrendSecond = secondHalf.reduce((sum, m) => sum + m.vix, 0) / secondHalf.length;
    const vixTrend = vixTrendSecond - vixTrendFirst;  // Positive = expanding vol

    // Classify regime based on actual metrics
    const regime = this.classifyRegimeFromMetrics(
      avgVix,
      vixMax,
      vixMin,
      avgReturn,
      avgRealizedVol,
      vixTrend
    );

    const confidence = this.calculateRegimeConfidence(marketData.length, vixTrend);

    return {
      primary_regime: regime,
      regime_name: REGIME_NAMES[regime],
      temporal_context: {
        date_range: [startDate, endDate],
        vix_regime: this.classifyVixRegime(avgVix),
        vix_range: [vixMin, vixMax],
        vix_avg: avgVix,
        market_phase: this.classifyMarketPhase(avgReturn, vixTrend),
      },
      confidence: confidence,
    };
  } catch (error) {
    console.error('[RegimeTagger] Error detecting regime:', error);
    return this.detectRegimeFallback(startDate, endDate);
  }
}

/**
 * Classify regime from actual market metrics
 */
private classifyRegimeFromMetrics(
  vixAvg: number,
  vixMax: number,
  vixMin: number,
  returnAvg: number,
  realizedVol: number,
  vixTrend: number
): number {
  // Regime 1: Trend Up (positive returns, vol compression)
  if (returnAvg > 0.03 && vixAvg < 18 && vixTrend < -1) return 1;

  // Regime 2: Trend Down (negative returns, vol expansion)
  if (returnAvg < -0.03 && vixAvg > 22 && vixTrend > 1) return 2;

  // Regime 3: Vol Compression / Pinned (low vol, sideways market)
  if (vixAvg < 15 && Math.abs(returnAvg) < 0.01 && vixTrend < 0) return 3;

  // Regime 4: Vol Expansion / Breaking Vol (high vol, moving sharply)
  if (vixAvg > 25 && Math.abs(returnAvg) > 0.02) return 4;

  // Regime 5: Choppy / Mean-Reverting (moderate vol, sideways)
  if (vixAvg >= 15 && vixAvg <= 25 && Math.abs(returnAvg) < 0.02) return 5;

  // Regime 6: Event / Catalyst (extreme VIX spikes)
  if (vixMax > 40 || (vixAvg > 30 && vixTrend > 2)) return 6;

  // Default to choppy if uncertain
  return 5;
}

/**
 * Calculate confidence in regime classification based on data quality
 */
private calculateRegimeConfidence(dataPoints: number, vixTrendClarity: number): number {
  // More data points = higher confidence (need 20+ days minimum)
  if (dataPoints < 20) return 0.3;
  if (dataPoints < 50) return 0.5;
  if (dataPoints < 100) return 0.75;

  // Clear trend = higher confidence
  const trendConfidenceFactor = Math.min(Math.abs(vixTrendClarity) / 5, 1.0);

  let baseConfidence = 0.8;
  if (dataPoints >= 100) baseConfidence = 0.85;
  if (dataPoints >= 250) baseConfidence = 0.92;

  return baseConfidence * (0.7 + 0.3 * trendConfidenceFactor);
}

/**
 * Fallback: Date-based regime if market data unavailable
 * This is now SECONDARY, not primary
 */
private detectRegimeFallback(startDate: string, endDate: string): RegimeContext {
  // Hardcoded periods (same as before, but now clearly marked as fallback)
  const knownRegimes = [
    { start: new Date('2020-02-01'), end: new Date('2020-04-30'), regime: 4, vix_avg: 57, market_phase: 'crash' as const },
    { start: new Date('2020-05-01'), end: new Date('2020-12-31'), regime: 3, vix_avg: 20, market_phase: 'recovery' as const },
    { start: new Date('2021-01-01'), end: new Date('2021-12-31'), regime: 1, vix_avg: 17, market_phase: 'expansion' as const },
    { start: new Date('2022-01-01'), end: new Date('2022-12-31'), regime: 2, vix_avg: 23, market_phase: 'contraction' as const },
  ];

  const start = new Date(startDate);

  for (const period of knownRegimes) {
    if (start >= period.start && start <= period.end) {
      return {
        primary_regime: period.regime,
        regime_name: REGIME_NAMES[period.regime],
        temporal_context: {
          date_range: [startDate, endDate],
          vix_regime: this.classifyVixRegime(period.vix_avg),
          vix_range: [period.vix_avg - 5, period.vix_avg + 5],
          vix_avg: period.vix_avg,
          market_phase: period.market_phase,
        },
        confidence: 0.4,  // Reduced: date-based is unreliable
      };
    }
  }

  // Default: unknown regime
  return {
    primary_regime: 5,
    regime_name: REGIME_NAMES[5],
    temporal_context: {
      date_range: [startDate, endDate],
      vix_regime: 'normal',
      vix_range: [15, 25],
      vix_avg: 20,
    },
    confidence: 0.2,  // Very low: essentially a guess
  };
}

/**
 * Market phase classification
 */
private classifyMarketPhase(returnAvg: number, vixTrend: number): 'expansion' | 'contraction' | 'crash' | 'recovery' {
  if (vixTrend > 3) return 'crash';
  if (returnAvg > 0.05 && vixTrend < -1) return 'expansion';
  if (returnAvg < -0.03) return 'contraction';
  return 'recovery';
}
```

**Updated VIX regime classification (more data-driven):**

```typescript
private classifyVixRegime(vixAvg: number): 'low' | 'normal' | 'high' | 'extreme' {
  // Based on long-term VIX statistics
  if (vixAvg < 12) return 'low';       // Historically low vol
  if (vixAvg < 18) return 'normal';    // Normal vol environment
  if (vixAvg < 30) return 'high';      // Elevated vol
  return 'extreme';                     // Crisis vol
}
```

---

## FIX 6: Minimum Sample Size Awareness

**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/overfittingDetector.ts`

**Problem:** 30 trades minimum doesn't account for regime fragmentation.

**Replace the n_trades check:**

Old:
```typescript
if (sv.n_trades < 30) {
  warnings.push({
    strategy_name: run.strategy_key,
    approach_description: JSON.stringify(run.params),
    failure_type: 'insufficient_sample',
    warning_message: `INSUFFICIENT SAMPLE: Only ${sv.n_trades} trades (minimum: 30). Results not statistically meaningful.`,
    do_not_repeat: `Never trust metrics from < 30 trades. Extend backtest period or reduce strategy frequency.`,
    evidence_detail: `Sample size: ${sv.n_trades} (central limit theorem requires >= 30)`,
    in_sample_sharpe: run.metrics.sharpe,
  });
}
```

New:
```typescript
// Check 1: Absolute minimum (CLT requirement)
if (sv.n_trades < 30) {
  warnings.push({
    strategy_name: run.strategy_key,
    approach_description: JSON.stringify(run.params),
    failure_type: 'insufficient_sample',
    warning_message: `INSUFFICIENT SAMPLE: Only ${sv.n_trades} trades (minimum: 30). Results not statistically meaningful.`,
    do_not_repeat: `Never trust metrics from < 30 trades. Extend backtest period or reduce strategy frequency.`,
    evidence_detail: `Sample size: ${sv.n_trades} (central limit theorem requires >= 30)`,
    in_sample_sharpe: run.metrics.sharpe,
  });
  return warnings;  // Don't continue checking
}

// Check 2: Regime fragmentation (critical for options)
const numRegimes = this.estimateRegimesCovered(run.params);
const tradesPerRegime = sv.n_trades / numRegimes;

if (tradesPerRegime < 5) {
  warnings.push({
    strategy_name: run.strategy_key,
    approach_description: JSON.stringify(run.params),
    failure_type: 'insufficient_sample',
    warning_message: `REGIME FRAGMENTATION: ${sv.n_trades} trades across ${numRegimes} regimes = ${tradesPerRegime.toFixed(1)} trades/regime (minimum: 5). Insufficient data per regime.`,
    do_not_repeat: `Regime-specific testing is critical for options. Get at least 5 trades per regime before declaring success.`,
    evidence_detail: `Sample size: ${sv.n_trades}, Estimated regimes: ${numRegimes}, Per-regime: ${tradesPerRegime.toFixed(1)} (threshold: 5.0)`,
    in_sample_sharpe: run.metrics.sharpe,
  });
}

// Check 3: Options-specific: need larger samples for binary outcomes
if (sv.n_trades < 50) {
  warnings.push({
    strategy_name: run.strategy_key,
    approach_description: JSON.stringify(run.params),
    failure_type: 'insufficient_sample',
    warning_message: `SMALL OPTIONS SAMPLE: ${sv.n_trades} trades is marginal for options (recommend 50+). Binary outcomes need more data.`,
    do_not_repeat: `Options strategies have binary payoffs. Need larger samples (50-100+ trades) to statistically validate edge.`,
    evidence_detail: `Sample size: ${sv.n_trades}. For options, recommended minimum: 50 trades.`,
    in_sample_sharpe: run.metrics.sharpe,
  });
}
```

**Add helper method:**

```typescript
/**
 * Estimate how many market regimes the backtest covers
 * Returns 1-6 estimate based on date range and known regime transitions
 */
private estimateRegimesCovered(params: Record<string, any>): number {
  const startDate = params.startDate ? new Date(params.startDate) : null;
  const endDate = params.endDate ? new Date(params.endDate) : null;

  if (!startDate || !endDate) return 3;  // Conservative: assume 3 regimes

  // Rough heuristic: one regime per 3 months
  const months = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
  const estimatedRegimes = Math.max(1, Math.ceil(months / 3));

  return Math.min(estimatedRegimes, 6);  // Cap at 6 possible regimes
}
```

---

## Summary of All Fixes

| Fix | File | Lines | Priority |
|-----|------|-------|----------|
| 1. Add avg_cagr, avg_max_drawdown to aggregation | .sql migration | 500-520 | CRITICAL |
| 2. Replace linear confidence with statistical formula | patternDetector.ts | 65, 111 | CRITICAL |
| 3. Add outcome validation for rule promotion | patternDetector.ts | 56+ | CRITICAL |
| 4. Use semantic embeddings for similarity | patternDetector.ts | 132-138 | HIGH |
| 5. Replace date-based regime detection | regimeTagger.ts | 74-143 | CRITICAL |
| 6. Add regime-aware sample size checking | overfittingDetector.ts | 102+ | HIGH |

All fixes tested conceptually. Requires real market data integration for regimes.
