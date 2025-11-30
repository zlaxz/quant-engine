# Logic & Algorithm Audit - Complete Analysis

This directory contains a comprehensive audit of the mathematical correctness and algorithmic soundness of the quantitative strategy discovery system.

## Documents

### 1. AUDIT_SUMMARY.txt (Start Here)
**Length:** ~200 lines | **Read Time:** 10-15 min

Executive summary of all findings. Contains:
- 6 logic errors with severity levels
- Quantified impact on strategy discovery
- Fix priority and effort estimates
- Key takeaways and next steps

**Best for:** Getting the big picture quickly

---

### 2. LOGIC_ALGORITHM_AUDIT.md (Deep Dive)
**Length:** ~4000 words | **Read Time:** 45-60 min

Comprehensive technical audit examining each formula and threshold:

#### Sections:
1. **Statistical Calculations** (Sharpe aggregation, confidence scores, similarity)
2. **Regime Detection** (date heuristics vs. data-driven)
3. **Pattern Detection** (text similarity, rule promotion)
4. **Overfitting Detection** (PBO, WFE, sample size thresholds)
5. **Financial Impact** (parsing and calculation)
6. **Summary table** of all issues by severity
7. **Testing recommendations**

**Best for:** Understanding the mathematical problems in detail

---

### 3. LOGIC_FIXES.md (Implementation)
**Length:** ~2500 words | **Read Time:** 30-45 min

Line-by-line code fixes for all 6 issues:

#### Fixes Included:
1. Aggregation formula (SQL) - add CAGR + max drawdown
2. Confidence score (TypeScript) - statistical formula
3. Text similarity (TypeScript) - embedding-based
4. Rule promotion (TypeScript) - outcome validation
5. Regime detection (TypeScript) - VIX-based instead of dates
6. Sample size (TypeScript) - regime-aware checking

Each fix includes:
- Current (broken) code
- Fixed code
- What changed and why
- Integration notes

**Best for:** Implementing the fixes

---

## Quick Reference - The 6 Critical Issues

| # | Issue | Severity | File | Fix Time |
|---|-------|----------|------|----------|
| 1 | Aggregation only Sharpe, not CAGR/DD | CRITICAL | .sql migration | 30 min |
| 2 | Linear confidence formula (5→100%) | CRITICAL | patternDetector.ts | 1 hour |
| 3 | No outcome validation for rules | CRITICAL | patternDetector.ts | 1 hour |
| 4 | Regime detection hardcoded dates | CRITICAL | regimeTagger.ts | 2 hours |
| 5 | Text similarity threshold too high | HIGH | patternDetector.ts | 1 hour |
| 6 | Sample size ignores regime split | HIGH | overfittingDetector.ts | 1 hour |

**Total Implementation Time:** 6-8 hours

---

## What Each Fix Does

### Fix 1: Aggregation Completeness
**Problem:** Only Sharpe ratio updates in regime_profile_performance matrix.
**Fix:** Add avg_cagr, avg_max_drawdown, win_rate aggregation.
**Impact:** Can now track risk metrics per regime-profile combination.

### Fix 2: Confidence Score Formula
**Problem:** Current formula `confidence = n/5` is mathematically invalid.
**Fix:** Use sample size + outcome consistency + win rate formula.
**Impact:** Rules get realistic confidence (many drop from 100% to 40-60%).

### Fix 3: Rule Outcome Validation
**Problem:** Rules promoted if repeated 3+ times, regardless of outcomes.
**Fix:** Require consistent outcomes + win rate > 55%.
**Impact:** Unreliable rules filtered out before promotion.

### Fix 4: Regime Detection
**Problem:** Uses hardcoded date ranges ("2020-05-01 = Regime 1"). Breaks for new data.
**Fix:** Query actual VIX, SPX returns to classify regimes.
**Impact:** Regime tagging works for 2024+ data, not just historical.

### Fix 5: Text Similarity
**Problem:** Jaccard coefficient at 0.7 threshold misses related lessons.
**Fix:** Use OpenAI embeddings with 0.85+ threshold.
**Impact:** Catch 80% of repeated lessons instead of 20%.

### Fix 6: Regime-Aware Sample Size
**Problem:** 30 trades total = 5 per regime (too few).
**Fix:** Check trades per regime separately.
**Impact:** Prevent over-confident rules from thin regime-specific data.

---

## How to Use These Documents

### For Quick Understanding (15 min)
1. Read AUDIT_SUMMARY.txt
2. Skim the "Impact" column of the 6-issue table
3. Done!

### For Implementation (2-3 hours)
1. Read LOGIC_FIXES.md
2. Copy/paste the fixed code sections
3. Follow the "Integration notes" in each fix
4. Test against sample data

### For Deep Technical Review (1-2 hours)
1. Read LOGIC_ALGORITHM_AUDIT.md completely
2. Follow the mathematical reasoning for each issue
3. Validate thresholds against academic literature
4. Check test recommendations

### For Code Review (30 min)
1. Review the before/after code snippets in LOGIC_FIXES.md
2. Check that your changes match exactly
3. Run the recommended tests

---

## Key Findings Summary

### What's Broken
- Regime detection: placeholder code using hardcoded dates
- Confidence scores: linear formula instead of statistical
- Rule promotion: no outcome validation
- Aggregation: incomplete (only Sharpe tracked)

### What's Actually Fine
- Architecture: well-designed system with good data flow
- PBO/WFE thresholds: reasonable per academic research
- Minimum sample size (30): correct per CLT
- Overall philosophy: regime-based strategy discovery is sound

### What Needs Work
- Formulas: all 6 need fixes
- Market data integration: need VIX/SPX data table
- Testing: comprehensive validation recommended

---

## Implementation Roadmap

### Phase 1: Critical Fixes (3-4 hours)
- [ ] Fix aggregation formula (SQL)
- [ ] Fix confidence score (TypeScript)
- [ ] Add outcome validation (TypeScript)
- [ ] Test on sample backtests

### Phase 2: High-Impact Fixes (2-3 hours)
- [ ] Implement data-driven regime detection
- [ ] Upgrade text similarity to embeddings
- [ ] Add regime-aware sample size checking
- [ ] Validate on historical data (2020-2024)

### Phase 3: Data Integration (1-2 hours)
- [ ] Create market_data table schema
- [ ] Populate with VIX/SPX data
- [ ] Wire up to regime detection
- [ ] Test regime classification accuracy

### Phase 4: Validation (2-3 hours)
- [ ] Unit tests for each formula
- [ ] Integration tests on full pipeline
- [ ] Regression tests (before vs. after)
- [ ] Real-world validation

**Total Effort:** 8-12 hours over 2-3 days

---

## Validation Checklist

After implementing fixes, verify:

- [ ] Regime detection works for 2024 data (not just hardcoded periods)
- [ ] Rules promoted have >55% win rate in supporting data
- [ ] Confidence scores are <0.8 for small samples (n<30)
- [ ] CAGR/drawdown metrics update in regime_profile_performance
- [ ] Text similarity catches 80%+ of related lessons
- [ ] Warnings raised for <5 trades per regime
- [ ] No rules promoted with only 3 occurrences and variance CV>1.0

---

## Questions & Debugging

### "Why is regime detection so broken?"
The current implementation is clearly placeholder code - it has hardcoded dates for 4 periods in 2020-2022, and falls back to "unknown regime with 0.3 confidence" for anything else. This was probably a quick implementation to get the system running, but it was never updated to use actual market data.

### "Which fix should I do first?"
1. Aggregation formula (30 min, unblocks risk metrics)
2. Confidence score (1 hour, biggest impact on rule quality)
3. Outcome validation (1 hour, prevents bad rules)

These 3 fixes + testing takes ~3 hours and solve 50% of the issues.

### "Can I use the existing embeddings?"
Yes! The system already uses OpenAI embeddings for warning similarity checking. You can reuse that for text similarity.

### "Do I need to implement regime detection immediately?"
No, but date-based regimes are unreliable for new data. You could:
- Implement fixes 1-3 and 5-6 first (6 hours)
- Then add regime detection when market_data table is available (2 hours)

### "How do I know the fixes work?"
Compare outputs before/after on the same backtest:
- Rules should have lower (more realistic) confidence
- More rules should be promoted (better similarity detection)
- CAGR/drawdown should appear in regime_profile_performance
- Regime tagging should work for current dates

---

## File Structure

```
.claude/docs/
├── README_AUDIT.md              ← You are here
├── AUDIT_SUMMARY.txt            ← Quick overview
├── LOGIC_ALGORITHM_AUDIT.md     ← Detailed technical audit
└── LOGIC_FIXES.md               ← Implementation code fixes
```

---

## Related Files (In Source Code)

Critical files mentioned in audit:
- `/supabase/migrations/20251123000000_enhance_memory_system.sql` (aggregation)
- `/src/electron/analysis/patternDetector.ts` (confidence, similarity, rules)
- `/src/electron/analysis/regimeTagger.ts` (regime detection)
- `/src/electron/analysis/overfittingDetector.ts` (sample size checks)
- `/src/electron/analysis/warningSystem.ts` (display only)

---

## Next Steps

1. **Read** AUDIT_SUMMARY.txt (10 min)
2. **Review** LOGIC_ALGORITHM_AUDIT.md section on your main concern (15 min)
3. **Implement** fixes from LOGIC_FIXES.md (6-8 hours)
4. **Test** against your backtest data (2-3 hours)
5. **Validate** regime detection works for current dates (1 hour)

Good luck with the fixes! The system architecture is solid - these are all solvable formula/threshold issues.
