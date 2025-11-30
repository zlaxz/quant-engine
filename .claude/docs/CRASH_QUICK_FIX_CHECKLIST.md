# Runtime Crash Quick Fix Checklist

## Critical Path: 12 Crashes to Fix IMMEDIATELY

Copy-paste this checklist and check off as you fix each crash.

---

## CRITICAL TIER (Must fix before any deployment)

### [ ] CRASH #1: MemoryDaemon.ts:348
```
File: src/electron/memory/MemoryDaemon.ts
Line: 348
Issue: return response.data[0].embedding;
Fix: Add bounds check - if (!response.data || response.data.length === 0) return null;
```

### [ ] CRASH #2: RecallEngine.ts:495
```
File: src/electron/memory/RecallEngine.ts
Line: 495
Issue: this.supabase.sql`access_count + 1` - invalid syntax
Fix: Remove sql syntax, use pure update with last_accessed timestamp
```

### [ ] CRASH #3: MemoryDaemon.ts:325
```
File: src/electron/memory/MemoryDaemon.ts
Line: 325
Issue: memoriesWithEmbeddings[i] - array index exceeds bounds
Fix: Check if (i >= memoriesWithEmbeddings.length) before accessing
```

### [ ] CRASH #4: RecallEngine.ts:287 + 354
```
File: src/electron/memory/RecallEngine.ts
Lines: 287, 354
Issue: JSON parse returns null, then used as array
Fix: Validate Array.isArray() after parsing, use safe defaults
```

### [ ] CRASH #5: RecallEngine.ts:603
```
File: src/electron/memory/RecallEngine.ts
Line: 603
Issue: memories[0]?.source accesses on possibly empty array
Fix: Check memories.length > 0 before accessing [0]
```

### [ ] CRASH #6: memoryCuration.ts:172,182,195,208,209
```
File: src/lib/memoryCuration.ts
Lines: 172, 182, 195, 208, 209
Issue: rule.content.slice() on null/undefined (5 locations)
Fix: Create safeContentSlice() helper, use everywhere
```

### [ ] CRASH #7: RecallEngine.ts:238
```
File: src/electron/memory/RecallEngine.ts
Line: 238
Issue: NaN propagation in sort - scoreB - scoreA where scores could be NaN
Fix: Validate typeof === 'number' before math operations
```

### [ ] CRASH #8: patternDetector.ts:166
```
File: src/electron/analysis/patternDetector.ts
Line: 166
Issue: sorted[0] access without bounds check
Fix: if (sorted.length === 0) continue; before accessing [0]
```

### [ ] CRASH #9: staleMemoryInjector.ts:62
```
File: src/electron/memory/staleMemoryInjector.ts
Line: 62
Issue: new Date(m.last_recalled_at).getTime() produces NaN on invalid date
Fix: Check isNaN() after getTime(), return 9999 as fallback
```

### [ ] CRASH #10: MemoryDaemon.ts:197
```
File: src/electron/memory/MemoryDaemon.ts
Line: 197
Issue: messages[messages.length - 1] access without length > 0 check
Fix: if (messages.length > 0) { access here }
```

### [ ] CRASH #11: MemoryDaemon.ts:161
```
File: src/electron/memory/MemoryDaemon.ts
Line: 161
Issue: Unsafe type assertion on database query result
Fix: Add explicit type: { last_message_id?: string } | undefined
```

### [ ] CRASH #12: memoryHandlers.ts:125-140
```
File: src/electron/ipc-handlers/memoryHandlers.ts
Lines: 125-140
Issue: win.webContents.send() without try-catch, destroyed window check
Fix: Wrap in try-catch, check !win.isDestroyed()
```

---

## HIGH TIER (Fix within 1 week)

### [ ] HIGH #1: RecallEngine.ts:276
```
Issue: Category filter without type validation
Fix: Filter categories for typeof === 'string' before SQL
```

### [ ] HIGH #2: MemoryDaemon.ts:145
```
Issue: Promise.all fails on single error
Fix: Use Promise.allSettled() instead
```

### [ ] HIGH #3: MemoryDaemon.ts:342
```
Issue: Missing timeout on OpenAI embedding call
Fix: Add 10s timeout wrapper
```

### [ ] HIGH #4: RecallEngine.ts:482
```
Issue: Missing validation on memoryIds before SQL UPDATE
Fix: Filter for typeof === 'string' and length > 0
```

### [ ] HIGH #5: memoryHandlers.ts:134
```
Issue: errorListener missing error handler
Fix: Same as extractionListener - wrap in try-catch
```

---

## MEDIUM TIER (Fix before next release)

### [ ] MEDIUM #1: patternDetector.ts:160
```
Issue: NaN in sort comparison
Fix: Validate typeof === 'number' for avg_sharpe
```

### [ ] MEDIUM #2: patternDetector.ts:49
```
Issue: textSimilarity called on null content
Fix: Check m.content && before calling function
```

### [ ] MEDIUM #3: patternDetector.ts:133
```
Issue: Regex split on huge strings causes OOM
Fix: Limit string to 10k chars before split
```

### [ ] MEDIUM #4: RecallEngine.ts:302
```
Issue: Invalid date handling
Fix: Wrap new Date().toISOString() in try-catch
```

### [ ] MEDIUM #5: overfittingDetector.ts:162
```
Issue: Missing validation on embedding array
Fix: Check Array.isArray() and length > 0
```

---

## Verification After Each Fix

Run this checklist for EACH crash fix:

```typescript
// ✓ Code compiles: npm run type-check
// ✓ No TypeScript errors
// ✓ Has error logging (console.error/warn)
// ✓ Returns safe default, never throws
// ✓ Null/undefined case handled
// ✓ No silent failures
```

---

## Quick Grep Commands to Find Each Crash

```bash
# CRASH #1 - MemoryDaemon embedding
grep -n "return response.data\[0\].embedding" src/electron/memory/MemoryDaemon.ts

# CRASH #2 - RecallEngine supabase.sql
grep -n "this.supabase.sql" src/electron/memory/RecallEngine.ts

# CRASH #3 - MemoryDaemon array access
grep -n "memoriesWithEmbeddings\[i\]" src/electron/memory/MemoryDaemon.ts

# CRASH #4 - RecallEngine JSON parse
grep -n "safeJSONParse.*symbols" src/electron/memory/RecallEngine.ts

# CRASH #5 - memories[0]
grep -n "memories\[0\]" src/electron/memory/RecallEngine.ts

# CRASH #6 - content.slice
grep -n "\.content\.slice" src/lib/memoryCuration.ts

# CRASH #7 - relevanceScore math
grep -n "scoreB - scoreA" src/electron/memory/RecallEngine.ts

# CRASH #8 - sorted[0]
grep -n "const best = sorted" src/electron/analysis/patternDetector.ts

# CRASH #9 - getTime() NaN
grep -n "getTime()" src/electron/memory/staleMemoryInjector.ts

# CRASH #10 - messages[length-1]
grep -n "messages\[messages.length - 1\]" src/electron/memory/MemoryDaemon.ts

# CRASH #11 - type assertion
grep -n "as any" src/electron/memory/MemoryDaemon.ts | head -5

# CRASH #12 - webContents.send
grep -n "win.webContents.send" src/electron/ipc-handlers/memoryHandlers.ts
```

---

## Testing Each Fix

After fixing, test with these scenarios:

### CRASH #1 Test
```typescript
// Mock OpenAI returning empty array
const mockResponse = { data: [] };
// Should return null, not crash
```

### CRASH #2 Test
```typescript
// Verify Supabase update works without sql syntax
// Call updateAccessMetrics with sample IDs
// Should log success or error, not crash
```

### CRASH #3 Test
```typescript
// Mock Supabase returning 5 IDs but 3 embeddings
// Should skip missing embeddings, not crash
```

### CRASH #4 Test
```typescript
// Create memory with symbols: '{"invalid}'
// Should parse safely, not crash
```

### CRASH #5 Test
```typescript
// Call formatForPrompt with empty array
// Should return valid string, not crash
```

### CRASH #6 Test
```typescript
// Create memory with null content field
// Should display "(empty)", not crash
```

### CRASH #7 Test
```typescript
// Mock importance field as NaN
// Should sort stably, not crash
```

### CRASH #8 Test
```typescript
// Call detectRegimeProfilePatterns with empty data
// Should return [], not crash
```

### CRASH #9 Test
```typescript
// Create memory with last_recalled_at: "invalid-date"
// Should show 9999 days, not crash
```

### CRASH #10 Test
```typescript
// Mock processSession with empty messages array
// Should log warning, not crash
```

### CRASH #11 Test
```typescript
// Delete extraction_state row for session
// Should handle gracefully, not crash
```

### CRASH #12 Test
```typescript
// Close window while memory extraction sending event
// Should not crash IPC handler
```

---

## Deployment Checklist

Before deploying, verify:

- [ ] All 12 CRITICAL crashes fixed and tested
- [ ] All 5 HIGH crashes fixed and tested
- [ ] npm run build succeeds
- [ ] npm run type-check passes
- [ ] No unhandled promise rejections
- [ ] Memory system integration tests pass
- [ ] 1 hour of manual testing with edge cases

---

## Files to Modify

**Remember:** Only these 8 files need changes:

1. `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/memory/MemoryDaemon.ts`
2. `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/memory/RecallEngine.ts`
3. `/Users/zstoc/GitHub/quant-chat-scaffold/src/lib/memoryCuration.ts`
4. `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/memory/staleMemoryInjector.ts`
5. `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/patternDetector.ts`
6. `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/ipc-handlers/memoryHandlers.ts`
7. `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/overfittingDetector.ts`

---

**Estimated Time to Fix All:** 45 minutes
**Risk if Not Fixed:** Complete memory system failure in production
**Priority:** MUST FIX BEFORE ANY RELEASE
