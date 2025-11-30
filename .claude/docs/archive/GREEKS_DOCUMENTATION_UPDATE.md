# Greeks Documentation Update

**Date:** 2025-11-24
**Status:** Complete
**Impact:** Enhanced Chief Quant, Risk Officer, and Auditor prompts with comprehensive Greeks knowledge

---

## Summary

Added comprehensive Greeks documentation to the Quant Chat Workbench system prompts. The audit identified that while Greeks knowledge was present, it was shallow. For serious options strategy work, the system needed deeper understanding of delta hedging, gamma scalping, vega management, and second-order Greeks (charm, vanna).

---

## Changes Made

### 1. Added GREEKS_DEEP_DIVE Export
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/prompts/sharedContext.ts`

Comprehensive Greeks section covering:

**First-Order Greeks:**
- **Delta** - Directional exposure, delta-neutral targeting, hedging frequency guidelines
- **Gamma** - Convexity/acceleration, gamma scalping profitability formulas, gamma explosion near expiry
- **Theta** - Time decay acceleration, DTE-based decay rates (60/30/14/7/1 DTE benchmarks)
- **Vega** - Volatility sensitivity, term structure considerations, vega crush post-events

**Second-Order Greeks:**
- **Charm** - Delta decay over time (~0.01-0.02 delta/day near ATM)
- **Vanna** - Vol-spot correlation, dealer flow implications

**Practical Hedging Guidelines:**
1. Delta hedging (futures/ETF shares, beta-adjusted, dividend risk)
2. Gamma management (scalp when RV > IV, cut exposure into events)
3. Theta harvesting (sell when IV rank > 50%, manage at 50-75% profit)
4. Vega trading (buy low IV rank, sell high IV rank, use term structure)
5. Charm/Vanna awareness (second-order but matter for large books)

**Token Cost:** ~550 tokens for full deep dive

### 2. Added GREEKS_SUMMARY Export
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/prompts/sharedContext.ts`

Condensed Greeks reference for prompts that don't need full detail:
- Quick reference for all 6 Greeks
- Key numbers and thresholds
- **Token Cost:** ~90 tokens

### 3. Updated buildFullFrameworkContext()
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/prompts/sharedContext.ts`

Now includes:
```typescript
${buildFrameworkContext()}
${GREEKS_DEEP_DIVE}  // <-- Added
${QUALITY_GATES}
```

**Used by:** Chief Quant prompt (main conversation mode)

### 4. Updated buildRiskFrameworkContext()
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/prompts/sharedContext.ts`

Now includes:
```typescript
// Risk-focused regime/profile content
${GREEKS_SUMMARY}  // <-- Added
```

**Used by:** Risk Officer prompt

### 5. Added buildFrameworkWithGreeks()
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/prompts/sharedContext.ts`

New helper function:
```typescript
export function buildFrameworkWithGreeks(): string {
  return `${buildFrameworkContext()}
${GREEKS_SUMMARY}`;
}
```

**Used by:** Auditor prompt (and potentially other specialized agents)

### 6. Updated Auditor Prompt
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/prompts/auditorPrompt.ts`

Changed from `buildFrameworkContext()` to `buildFrameworkWithGreeks()`

---

## Token Impact

**Before Greeks Update:**
- Chief Quant prompt: ~3,200 tokens (estimated)
- Risk Officer prompt: ~1,800 tokens (estimated)
- Auditor prompt: ~1,600 tokens (estimated)

**After Greeks Update:**
- Chief Quant prompt: +550 tokens (full deep dive)
- Risk Officer prompt: +90 tokens (summary)
- Auditor prompt: +90 tokens (summary)

**Bundle Size Impact:**
- Before: 1,191.14 kB
- After: 1,195.69 kB
- Increase: +4.55 kB (+0.38%)

---

## Validation

### TypeScript Compilation
Build completed successfully:
```bash
npm run build
✓ 2957 modules transformed
✓ built in 2.13s
```

### Import Dependencies Verified
All imports working correctly:
- `chiefQuantPrompt.ts` → uses `buildFullFrameworkContext()`
- `riskOfficerPrompt.ts` → uses `buildRiskFrameworkContext()`
- `auditorPrompt.ts` → uses `buildFrameworkWithGreeks()`
- `researchAgentPrompts.ts` → uses `buildFrameworkContext()` and `buildRiskFrameworkContext()`
- `patternMinerPrompt.ts` → uses `buildFrameworkContext()`

---

## Knowledge Depth Added

### Delta Hedging
- Delta-neutral formula: Σ(delta × position_size × multiplier) ≈ 0
- Frequency guidelines based on gamma exposure
- Pin risk awareness near expiration

### Gamma Scalping
- Break-even move formula: `sqrt(2 × theta_decay / gamma)`
- Profitability condition: realized vol > implied vol
- Gamma explosion behavior (5-10x increase in final 5 days)
- Position sizing to avoid forced hedging

### Theta Management
- Non-linear acceleration pattern
- DTE-specific decay rates:
  - 60 DTE: ~0.02% of spot/day
  - 30 DTE: ~0.03% of spot/day
  - 14 DTE: ~0.05% of spot/day
  - 7 DTE: ~0.10% of spot/day
  - 1 DTE: ~0.25%+ of spot/day

### Vega Trading
- Term structure: front-month (fast) vs back-month (slow) vega
- Hedging instruments: VIX futures, variance swaps, calendar spreads
- Vega crush: 3-5 vol point drops post-earnings
- Position limits: 0.5-1% of portfolio per vol point

### Second-Order Greeks
- **Charm**: Delta decay (0.01-0.02 delta/day), impacts hedging frequency
- **Vanna**: Vol-spot correlation, dealer flow dynamics, pin risk near large OI strikes

---

## Strategic Value

This update enables the system to:

1. **Analyze gamma scalping strategies** with proper break-even calculations
2. **Evaluate theta harvesting** with realistic decay rate expectations
3. **Assess vega exposure** across term structure
4. **Understand second-order effects** (charm/vanna) that matter for larger books
5. **Provide practical hedging guidance** for delta/gamma/vega management

The knowledge is now sufficient for serious options strategy development, not just basic understanding.

---

## Files Modified

1. `/Users/zstoc/GitHub/quant-chat-scaffold/src/prompts/sharedContext.ts`
   - Added `GREEKS_DEEP_DIVE` constant (~550 tokens)
   - Added `GREEKS_SUMMARY` constant (~90 tokens)
   - Updated `buildFullFrameworkContext()` to include Greeks deep dive
   - Updated `buildRiskFrameworkContext()` to include Greeks summary
   - Added `buildFrameworkWithGreeks()` helper function

2. `/Users/zstoc/GitHub/quant-chat-scaffold/src/prompts/auditorPrompt.ts`
   - Changed import from `buildFrameworkContext` to `buildFrameworkWithGreeks`
   - Updated function call in prompt template

---

## Next Steps (Optional)

Consider adding Greeks knowledge to other specialized agents if they need it:
- Pattern Miner (if analyzing Greeks-related patterns)
- Research Agents (if proposing Greeks-sensitive strategies)

Currently, the distribution is:
- **Full Greeks (deep dive):** Chief Quant only
- **Greeks Summary:** Risk Officer, Auditor
- **No Greeks:** Pattern Miner, Research Agents (use basic framework only)

This seems appropriate given their roles, but can be adjusted if needed.
