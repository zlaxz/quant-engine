# Crash Fix Priority & Implementation Guide

## TIER 1: Fix NOW (Blocks Production)

These crashes WILL execute in production. Fix in this order:

### Fix T1.1: Array Access Without Bounds Check
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/memory/MemoryDaemon.ts`
**Line:** 348
**Time to Fix:** 2 minutes
**Risk:** DATA LOSS - Memory extraction halts completely

```typescript
// BEFORE:
return response.data[0].embedding;

// AFTER:
if (!response.data || response.data.length === 0) {
  console.error('[MemoryDaemon] Empty embedding response from OpenAI');
  return null;
}
return response.data[0]?.embedding || null;
```

**Test:** Call with OpenAI returning empty response array

---

### Fix T1.2: Invalid Supabase Method Call
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/memory/RecallEngine.ts`
**Line:** 495
**Time to Fix:** 5 minutes
**Risk:** SILENT FAILURE - Access metrics never update, memory ranking breaks

```typescript
// BEFORE (Lines 491-502):
this.supabase
  .from('memories')
  .update({
    access_count: this.supabase.sql`access_count + 1`,
    last_accessed: new Date().toISOString(),
  })
  .in('id', memoryIds)
  .then(() => {})
  .catch((err) => /* ... */);

// AFTER:
if (memoryIds.length === 0) return;

this.supabase
  .from('memories')
  .update({
    last_accessed: new Date().toISOString(),
  })
  .in('id', memoryIds)
  .then(() => {
    console.log('[RecallEngine] Updated access metrics for', memoryIds.length, 'memories');
  })
  .catch((err) => {
    console.error('[RecallEngine] Failed to update access metrics:', err);
  });
```

**Note:** Remove invalid `this.supabase.sql` syntax. Supabase doesn't support raw SQL in UPDATE statements for simple increments.

---

### Fix T1.3: Array Index Out of Bounds in Transaction
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/memory/MemoryDaemon.ts`
**Line:** 325
**Time to Fix:** 3 minutes
**Risk:** CRASH - Memory saving fails when Supabase returns different size array

```typescript
// BEFORE:
const transactionData = data.map((item: any, i: number) => ({
  memory: memoriesWithEmbeddings[i],
  id: item.id,
}));

// AFTER:
const transactionData: Array<{ memory: ExtractedMemory; id: string } | null> = data.map((item: any, i: number) => {
  if (i >= memoriesWithEmbeddings.length) {
    console.error(
      `[MemoryDaemon] Mismatch: data[${i}] but only ${memoriesWithEmbeddings.length} embeddings. Skipping.`
    );
    return null;
  }
  return {
    memory: memoriesWithEmbeddings[i],
    id: item.id,
  };
});

const validTransactionData = transactionData.filter((item): item is NonNullable<typeof item> => item !== null);

if (validTransactionData.length === 0) {
  console.warn('[MemoryDaemon] No valid transaction data after filtering');
  return;
}

try {
  insertTransaction(validTransactionData);
} catch (error) {
  // ...
}
```

**Test:** Mock Supabase returning fewer results than embeddings generated

---

### Fix T1.4: String Slice on Null Content (5 locations)
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/lib/memoryCuration.ts`
**Lines:** 172, 182, 195, 208, 209
**Time to Fix:** 5 minutes (all at once)
**Risk:** CRASH - Memory curation UI completely broken

Add defensive content getter:

```typescript
// Add this helper at top of file (line 20):
function safeContentSlice(content: string | null | undefined, maxLen: number = 100): string {
  if (!content) return '(empty)';
  return content.slice(0, maxLen);
}

function safeContentWithEllipsis(content: string | null | undefined, maxLen: number = 100): string {
  const safe = safeContentSlice(content, maxLen);
  const full = content || '';
  return safe + (full.length > maxLen ? '...' : '');
}

// Then replace all 5 locations:
// OLD: ${rule.content.slice(0, 100)}${rule.content.length > 100 ? '...' : ''}
// NEW: ${safeContentWithEllipsis(rule.content, 100)}

// All affected lines:
// Line 172: rule.content → safeContentWithEllipsis(rule.content, 100)
// Line 182: candidate.content → safeContentWithEllipsis(candidate.content, 100)
// Line 195: rule.content → safeContentWithEllipsis(rule.content, 100)
// Line 208: ruleA.content → safeContentWithEllipsis(ruleA.content, 80)
// Line 209: ruleB.content → safeContentWithEllipsis(ruleB.content, 80)
```

**Test:** Create memory note with null content field

---

### Fix T1.5: JSON Parse with Null Symbol Usage
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/memory/RecallEngine.ts`
**Lines:** 286-290, 353-357
**Time to Fix:** 4 minutes
**Risk:** CRASH - Null reference in array filter

```typescript
// IN bm25Search (around line 286):
// BEFORE:
const symbols = r.symbols
  ? safeJSONParse<string[]>(r.symbols, null)
  : null;

// AFTER:
const symbols = (() => {
  if (!r.symbols) return null;
  const parsed = safeJSONParse<string[]>(r.symbols, null);
  return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
})();

// IN vectorSearch (around line 353):
// BEFORE:
if (symbols && symbols.length > 0) {
  results = results.filter((r: any) =>
    r.symbols?.some((s: string) => symbols.includes(s))
  );
}

// AFTER:
if (symbols && Array.isArray(symbols) && symbols.length > 0) {
  results = results.filter((r: any) => {
    if (!Array.isArray(r.symbols)) return false;
    return r.symbols.some((s: string) => symbols.includes(s));
  });
}
```

**Test:** Create memory with malformed symbols JSON like `"{"invalid}"`

---

### Fix T1.6: Missing Array Bounds Check Before Access
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/memory/MemoryDaemon.ts`
**Lines:** 197-198
**Time to Fix:** 2 minutes
**Risk:** CRASH - Extraction state never updates, memory daemon enters infinite loop

```typescript
// BEFORE:
const lastMessage = messages[messages.length - 1];
this.updateExtractionState(sessionId, workspaceId, lastMessage.id, messages.length);

// AFTER:
if (messages.length > 0) {
  const lastMessage = messages[messages.length - 1];
  this.updateExtractionState(sessionId, workspaceId, lastMessage.id, messages.length);
} else {
  console.warn('[MemoryDaemon] No messages to process for session', sessionId.slice(0, 8));
}
```

**Test:** Mock Supabase returning empty messages array

---

### Fix T1.7: Unsafe Type Assertion on Database Query
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/memory/MemoryDaemon.ts`
**Lines:** 159-173
**Time to Fix:** 4 minutes
**Risk:** CRASH - Query building fails, extraction never advances past first message

```typescript
// BEFORE:
const state = this.localDb
  .prepare('SELECT last_message_id FROM extraction_state WHERE session_id = ?')
  .get(sessionId) as any;

const lastMessageId = state?.last_message_id;

let query = this.supabase
  .from('messages')
  .select('id, role, content, created_at')
  .eq('session_id', sessionId)
  .order('created_at', { ascending: true })
  .limit(this.config.batchSize);

if (lastMessageId) {
  query = query.gt('id', lastMessageId);
}

// AFTER:
let state: { last_message_id?: string } | undefined = undefined;
try {
  state = this.localDb
    .prepare('SELECT last_message_id FROM extraction_state WHERE session_id = ?')
    .get(sessionId) as { last_message_id?: string } | undefined;
} catch (error) {
  console.error('[MemoryDaemon] Error querying extraction state:', error);
}

let query = this.supabase
  .from('messages')
  .select('id, role, content, created_at')
  .eq('session_id', sessionId)
  .order('created_at', { ascending: true })
  .limit(this.config.batchSize);

if (state?.last_message_id && typeof state.last_message_id === 'string') {
  query = query.gt('id', state.last_message_id);
} else if (!state) {
  console.log('[MemoryDaemon] No prior extraction state for session', sessionId.slice(0, 8));
}
```

**Test:** Delete extraction_state table row, verify recovery

---

## TIER 2: Fix This Week (Production Issues)

### Fix T2.1: Array Access Without Length Check
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/patternDetector.ts`
**Lines:** 160-164
**Time to Fix:** 3 minutes

```typescript
// BEFORE:
const best = sorted[0];
const worst = sorted[sorted.length - 1];

if (best.total_runs >= 5 && best.avg_sharpe > 0.5) {

// AFTER:
if (sorted.length === 0) {
  console.warn('[PatternDetector] No profile data for sorting');
  continue;
}

const best = sorted[0];
const worst = sorted[sorted.length - 1];

if (best && best.total_runs >= 5 && best.avg_sharpe > 0.5) {
```

---

### Fix T2.2: Missing Timeout on Embedding Generation
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/memory/MemoryDaemon.ts`
**Lines:** 339-353
**Time to Fix:** 5 minutes

```typescript
// BEFORE:
const response = await this.openaiClient.embeddings.create({
  model: 'text-embedding-3-small',
  input: text.trim(),
});

return response.data[0].embedding;

// AFTER:
return new Promise<number[] | null>(async (resolve) => {
  const timeoutId = setTimeout(() => {
    console.error('[MemoryDaemon] Embedding generation timeout after 10s');
    resolve(null);
  }, 10000);

  try {
    const response = await this.openaiClient!.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.trim(),
    });

    clearTimeout(timeoutId);

    if (!response.data || response.data.length === 0) {
      resolve(null);
      return;
    }
    resolve(response.data[0]?.embedding || null);
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('[MemoryDaemon] Embedding generation error:', error);
    resolve(null);
  }
});
```

---

### Fix T2.3: Promise.all Without Error Isolation
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/memory/MemoryDaemon.ts`
**Lines:** 145-150
**Time to Fix:** 3 minutes

```typescript
// BEFORE:
await Promise.all(
  sessions.map((session) =>
    limit(() => this.processSession(session.id, session.workspace_id))
  )
);

// AFTER:
const results = await Promise.allSettled(
  sessions.map((session) =>
    limit(() => this.processSession(session.id, session.workspace_id).catch(err => {
      console.error(`[MemoryDaemon] Failed to process session ${session.id.slice(0, 8)}:`, err);
      // Don't re-throw - let allSettled handle it
    }))
  )
);

const failures = results.filter(r => r.status === 'rejected');
if (failures.length > 0) {
  console.warn(`[MemoryDaemon] ${failures.length}/${sessions.length} sessions failed extraction`);
  this.emit('error', new Error(`${failures.length} sessions failed`));
}
```

---

### Fix T2.4: Missing Error Handler in IPC Event Send
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/ipc-handlers/memoryHandlers.ts`
**Lines:** 125-140
**Time to Fix:** 2 minutes

```typescript
// BEFORE:
extractionListener = (data: { count: number; sessionId: string }) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (win && win.webContents) {
      win.webContents.send('memory:extracted', data);
    }
  });
};

// AFTER:
extractionListener = (data: { count: number; sessionId: string }) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      if (win && !win.isDestroyed() && win.webContents) {
        win.webContents.send('memory:extracted', data);
      }
    } catch (error) {
      console.error('[MemoryHandlers] Failed to send extraction event to window:', error);
    }
  });
};

// Same for errorListener (line 134-141):
errorListener = (error: Error) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      if (win && !win.isDestroyed() && win.webContents) {
        win.webContents.send('memory:error', { message: error.message });
      }
    } catch (err) {
      console.error('[MemoryHandlers] Failed to send error event to window:', err);
    }
  });
};
```

---

### Fix T2.5: Missing Input Validation on SQLite Query
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/memory/RecallEngine.ts`
**Lines:** 275-281
**Time to Fix:** 3 minutes

```typescript
// BEFORE:
if (categories && categories.length > 0) {
  sql += ` AND mc.category IN (${categories.map(() => '?').join(',')})`;
  params.push(...categories);
}

// AFTER:
if (categories && categories.length > 0) {
  const validCategories = categories.filter(c => typeof c === 'string' && c.trim().length > 0);
  if (validCategories.length > 0) {
    sql += ` AND mc.category IN (${validCategories.map(() => '?').join(',')})`;
    params.push(...validCategories);
  }
}
```

---

## TIER 3: Fix Soon (Edge Cases)

### Fix T3.1: Invalid Date Handling in Stale Memory Injector
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/memory/staleMemoryInjector.ts`
**Lines:** 60-64
**Time to Fix:** 3 minutes

```typescript
// BEFORE:
days_since_recall: m.last_recalled_at
  ? Math.floor((now.getTime() - new Date(m.last_recalled_at).getTime()) / (24 * 60 * 60 * 1000))
  : 9999,

// AFTER:
days_since_recall: m.last_recalled_at
  ? (() => {
      const recalledDate = new Date(m.last_recalled_at);
      const timeMs = recalledDate.getTime();
      if (isNaN(timeMs)) {
        console.warn('[StaleMemoryInjector] Invalid date for memory', m.id, ':', m.last_recalled_at);
        return 9999;
      }
      return Math.floor((now.getTime() - timeMs) / (24 * 60 * 60 * 1000));
    })()
  : 9999,
```

---

### Fix T3.2: Incomplete Null Guard Chain
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/analysis/patternDetector.ts`
**Lines:** 45-54
**Time to Fix:** 2 minutes

```typescript
// BEFORE:
for (const memory of memories) {
  if (processed.has(memory.id)) continue;

  const similar = memories.filter(
    (m) =>
      m.id !== memory.id &&
      !processed.has(m.id) &&
      this.textSimilarity(memory.content, m.content) > 0.7
  );

// AFTER:
for (const memory of memories) {
  if (processed.has(memory.id) || !memory.content) continue;

  const similar = memories.filter(
    (m) =>
      m.id !== memory.id &&
      !processed.has(m.id) &&
      m.content &&
      this.textSimilarity(memory.content, m.content) > 0.7
  );
```

---

### Fix T3.3: Missing Length Check on Invalid Date
**File:** `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/memory/RecallEngine.ts`
**Line:** 302
**Time to Fix:** 2 minutes

```typescript
// BEFORE:
createdAt: new Date(r.createdAt).toISOString(),

// AFTER:
createdAt: (() => {
  try {
    const date = new Date(r.createdAt);
    if (isNaN(date.getTime())) {
      console.warn('[RecallEngine] Invalid date:', r.createdAt);
      return new Date().toISOString();
    }
    return date.toISOString();
  } catch (error) {
    console.warn('[RecallEngine] Date parsing error:', error);
    return new Date().toISOString();
  }
})(),
```

---

## Verification Checklist

After each fix:

- [ ] Code compiles without TypeScript errors
- [ ] Function has error logging (console.error or .warn)
- [ ] Null/undefined case is handled gracefully
- [ ] No silent failures - always return safe default
- [ ] No exception thrown that crashes system

## Testing Order

1. **Unit Test:** Create minimal reproduction for each crash
2. **Integration Test:** Run full memory system with each fix
3. **Load Test:** 100+ concurrent recall requests to catch race conditions
4. **Error Injection:** Simulate API failures, network timeouts, malformed data

## Estimated Total Fix Time: 45 minutes
- Tier 1: 25 minutes
- Tier 2: 15 minutes
- Tier 3: 5 minutes

**Recommend blocking all other work until Tier 1 is complete.**
