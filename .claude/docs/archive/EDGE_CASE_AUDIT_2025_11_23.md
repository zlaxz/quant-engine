# Edge Case Audit: System Vulnerability Analysis
**Date:** 2025-11-23
**Scope:** Complete system (RecallEngine, MemoryDaemon, RegimeTagger, OverfittingDetector, StaleMemoryInjector)
**Goal:** Identify edge cases that break in weird ways

---

## 1. EMPTY STATES

### 1.1 Zero Memories in Workspace
**Scenario:** User has just created workspace with no memories extracted yet.

**Where it breaks:**
- `RecallEngine.warmCache()` (line 509-530): Queries for importance_score > 0.7 with LIMIT 50
  - Returns empty array silently ✓
  - But then tries to recall 3 pre-defined queries regardless
  - **ISSUE:** No check if memory_cache table exists before first query
  - If table doesn't exist, query fails but error is caught and swallowed

**Evidence:**
```typescript
// Line 512-516 - No table existence check
const stmt = this.localDb.prepare(`
  SELECT * FROM memory_cache
  WHERE workspace_id = ? AND importance_score > 0.7
  ...
`);
const hotMemories = stmt.all(workspaceId);  // Can crash if table not created
```

**Current handling:** Try-catch in initializeDb() (line 104-107) suppresses error
**Risk:** Fails silently; user gets empty cache warning without diagnostics

**Fix needed:**
```typescript
private initializeDb(): void {
  try {
    const tableCheck = this.localDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_cache'"
    );
    const exists = tableCheck.get();

    if (!exists) {
      // POTENTIAL BUG: What if schema.sql file is missing?
      const fs = require('fs');
      const path = require('path');
      const schemaPath = path.join(__dirname, 'schema.sql');

      // NO CHECK if file exists!
      const schema = fs.readFileSync(schemaPath, 'utf-8');  // Can throw
      this.localDb.exec(schema);
    }
  } catch (error) {
    console.error('[RecallEngine] Database initialization error:', error);
    // Falls through without initializing
  }
}
```

---

### 1.2 Null WorkspaceId Edge Cases
**Scenario:** Code receives null/undefined workspaceId from multiple sources

**Where it breaks:**

#### RecallEngine.recall() - Line 129
```typescript
if (!workspaceId || typeof workspaceId !== 'string') {
  console.error('[RecallEngine] Invalid workspaceId: must be non-empty string');
  return { memories: [], totalFound: 0, searchTimeMs: 0, usedCache: false, query };
}
```
✓ GOOD validation

#### MemoryDaemon.processSession() - Line 158-163
```typescript
const state = this.localDb
  .prepare('SELECT last_message_id FROM extraction_state WHERE session_id = ?')
  .get(sessionId) as any;

const lastMessageId = state?.last_message_id;  // Can be undefined
```
**ISSUE:** If sessionId doesn't exist in extraction_state, state is null, and lastMessageId is undefined
- Line 172-174 checks `if (lastMessageId)` so safe
- But what if workspaceId is null in processSession call?
- **No validation of workspaceId parameter!**

```typescript
private async processSession(sessionId: string, workspaceId: string): Promise<void> {
  // NO validation that workspaceId is valid UUID
  // Line 198: updateExtractionState() passes it directly to SQL
  this.updateExtractionState(sessionId, workspaceId, lastMessage.id, messages.length);
}
```

**Fix needed:**
```typescript
private async processSession(sessionId: string, workspaceId: string): Promise<void> {
  if (!workspaceId || typeof workspaceId !== 'string' || workspaceId.length === 0) {
    console.error('[MemoryDaemon] Invalid workspaceId in processSession');
    return;
  }
  // ... rest of function
}
```

---

### 1.3 Regime_context Missing from Backtest Runs
**Scenario:** Query for regime-specific memories but regime_context is empty JSONB

**Where it breaks:**

#### StaleMemoryInjector.getStaleMemories() - Line 26-81
```typescript
async getStaleMemories(workspaceId: string, maxResults: number = 20): Promise<StaleMemory[]> {
  // Works fine with null/missing financial_impact
  const { data, error } = await this.supabase
    .from('memories')
    .select('id, content, summary, protection_level, financial_impact, last_recalled_at')
    .eq('workspace_id', workspaceId)
    .eq('protection_level', parseInt(level))  // Line 46
    .or(`last_recalled_at.is.null,last_recalled_at.lt.${threshold.toISOString()}`)
```

**ISSUE:** What if `protection_level` column is null?
- Line 46: `.eq('protection_level', parseInt(level))` treats null as non-matching ✓
- But formatForInjection() (line 86) accesses protection_level directly:
  ```typescript
  const minLevel = Math.min(...memories.map(m => m.protection_level));
  ```
- If protection_level is null, Math.min returns NaN!
- **BREAKS:** String interpolation in line 101 becomes "Level NaN"

**Evidence of issue:**
```typescript
// Line 93-94
const minLevel = Math.min(...memories.map(m => m.protection_level));
formatted += `*These are PROTECTED memories (Level ${minLevel}). Confirm understanding before proceeding.*\n`;
// Could output: "Level NaN"
```

**Current handling:** None
**Risk:** User-facing text shows "Level NaN" - confusing but not crashing

**Fix needed:**
```typescript
const minLevel = Math.min(
  ...memories
    .map(m => m.protection_level)
    .filter(level => level !== null && level !== undefined)
);
if (isNaN(minLevel)) {
  // Safe fallback
  formatted += `*These are PROTECTED memories. Confirm understanding before proceeding.*\n`;
} else {
  formatted += `*These are PROTECTED memories (Level ${minLevel}). Confirm understanding before proceeding.*\n`;
}
```

---

### 1.4 Statistical_validity is Empty Object {}
**Scenario:** Backtest run with statistical_validity: {} (from migration)

**Where it breaks:**

#### OverfittingDetector.analyzeRun() - Line 64-71
```typescript
async analyzeRun(run: BacktestRun): Promise<OverfittingWarning[]> {
  const warnings: OverfittingWarning[] = [];
  const sv = run.statistical_validity;  // Can be {}

  if (!sv) {  // Empty object {} is truthy!
    console.warn(`[OverfittingDetector] No statistical_validity for run ${run.id}`);
    return warnings;
  }
```

**CRITICAL BUG:** Empty object {} is truthy in JavaScript!
- Line 68-71 checks `if (!sv)` but {} is truthy
- Code continues to line 73 and tries accessing sv.pbo_score
- Line 74: `if (sv.pbo_score && sv.pbo_score > 0.25)` - undefined > 0.25 is false ✓
- Safe by accident due to && operator

**Real issue:** No validation of sv structure
```typescript
if (sv.pbo_score && sv.pbo_score > 0.25) {
  // sv.pbo_score could be string, NaN, Infinity, null, undefined
  // Only > 0.25 check might fail silently
}
```

**Current handling:** Weak truthy check + optional chaining
**Risk:** Doesn't catch malformed data that looks like object but isn't

**Fix needed:**
```typescript
async analyzeRun(run: BacktestRun): Promise<OverfittingWarning[]> {
  const warnings: OverfittingWarning[] = [];
  const sv = run.statistical_validity;

  if (!sv || typeof sv !== 'object' || Object.keys(sv).length === 0) {
    console.warn(`[OverfittingDetector] No statistical_validity for run ${run.id}`);
    return warnings;
  }

  // Validate key fields exist and are numbers
  const pbo = sv.pbo_score;
  if (typeof pbo !== 'number' || isNaN(pbo) || pbo < 0 || pbo > 1) {
    console.warn(`[OverfittingDetector] Invalid pbo_score: ${pbo}`);
    // Don't use pbo_score
  }
}
```

---

## 2. EXTREME VALUES

### 2.1 Sharpe Ratio Edge Cases
**Scenario:** Backtest with extreme Sharpe values (100, -100, Infinity, NaN)

**Where it breaks:**

#### RecallEngine.mergeResults() - Line 235-241
```typescript
const sorted = Array.from(allResults.values())
  .filter((r) => r.importance >= minImportance)
  .sort((a, b) => {
    const scoreA = a.relevanceScore * a.importance;
    const scoreB = b.relevanceScore * b.importance;
    return scoreB - scoreA;
  });
```

**ISSUE:** If relevanceScore is Infinity or NaN:
- Infinity * any_number = Infinity
- NaN * any_number = NaN
- Sorting breaks: NaN comparisons always return false
- Result: Array stays unsorted, arbitrary ordering

**Example breakdown:**
```javascript
[
  { relevanceScore: Infinity, importance: 0.8 },  // Score = Infinity
  { relevanceScore: 5.0, importance: 0.8 },       // Score = 4.0
  { relevanceScore: NaN, importance: 0.8 },       // Score = NaN
].sort((a, b) => (b.score - a.score));
// Result: Random order, no predictable behavior
```

**Current handling:** None
**Risk:** Silent corruption of search results

**Fix needed:**
```typescript
const sorted = Array.from(allResults.values())
  .filter((r) => {
    r.importance >= minImportance &&
    typeof r.relevanceScore === 'number' &&
    !isNaN(r.relevanceScore) &&
    isFinite(r.relevanceScore)
  })
  .sort((a, b) => {
    // Clamp scores to finite range
    const scoreA = Math.min(Math.max(a.relevanceScore * a.importance, -1e10), 1e10);
    const scoreB = Math.min(Math.max(b.relevanceScore * b.importance, -1e10), 1e10);
    return scoreB - scoreA;
  });
```

---

### 2.2 Memory Query Returning 10,000+ Results
**Scenario:** Hybrid search matches 10,000 memories but limit is 100

**Where it breaks:**

#### RecallEngine.hybridSearch() - Line 212-244
```typescript
private async hybridSearch(
  queries: string[],
  workspaceId: string,
  limit: number,
  minImportance: number,
  categories?: string[],
  symbols?: string[]
): Promise<MemoryResult[]> {
  const allResults = new Map<string, MemoryResult>();

  for (const q of queries) {
    const [bm25Results, vectorResults] = await Promise.all([
      this.bm25Search(q, workspaceId, limit, categories),  // limit passed
      this.vectorSearch(q, workspaceId, limit, minImportance, categories, symbols),
    ]);

    // Each adds up to limit results
    this.mergeResults(allResults, bm25Results, 0.3, 'local');
    this.mergeResults(allResults, vectorResults, 0.7, 'remote');
  }

  // allResults map could have limit * queries.length items
  return sorted.slice(0, limit);  // Line 243
}
```

**ISSUE:** Memory Map grows without bounds
- Multiple queries = multiple search results added
- allResults.set() adds 100+ items per query
- For 3 queries: 300+ items in memory
- Map holds all in memory even though only limit returned

**Not a crash, but:**
- Memory leak for repeated queries
- Slow sort on large array (300+ items)
- LRU cache hits are beneficial but still holds memory

**Current handling:** None (by design - trades memory for speed)
**Risk:** Long conversations with many queries = growing memory

**Fix needed:**
```typescript
const sorted = Array.from(allResults.values())
  .filter((r) => r.importance >= minImportance)
  .sort((a, b) => {
    const scoreA = a.relevanceScore * a.importance;
    const scoreB = b.relevanceScore * b.importance;
    return scoreB - scoreA;
  })
  .slice(0, limit);  // Slice BEFORE returning to cap memory

return sorted.slice(0, limit);  // Now only returns limit items
```

---

### 2.3 10,000 Memories Extracted in Single Cycle
**Scenario:** User has massive chat session with 10k messages; daemon extracts memories

**Where it breaks:**

#### MemoryDaemon.saveMemories() - Line 254-259
```typescript
const memoriesWithEmbeddings = await Promise.all(
  memories.map(async (m) => ({
    ...m,
    embedding: await this.generateEmbedding(m.content),
  }))
);
```

**ISSUE:** Creates 10k parallel embedding requests!
- Each calls OpenAI API
- Each request takes 100-200ms
- 10k parallel = timeout or rate limit
- OpenAI has rate limits (~3,500 RPM for default)

**Evidence:**
```typescript
// No concurrency control
// If 1000 memories extracted, makes 1000 parallel embedding calls
```

**Current handling:** None (no concurrency limiting)
**Risk:** Rate limit hit; embedding generation fails silently; memories saved without embeddings

**Fix needed:**
```typescript
import pLimit from 'p-limit';

const limit = pLimit(5);  // Max 5 concurrent embeddings
const memoriesWithEmbeddings = await Promise.all(
  memories.map((m) =>
    limit(() =>
      this.generateEmbedding(m.content).then((embedding) => ({
        ...m,
        embedding,
      }))
    )
  )
);
```

---

## 3. MALFORMED DATA

### 3.1 JSONB Field is String Instead of Object
**Scenario:** Migration gone wrong; regime_context stored as string '"{\\"regime\\": 1}"'

**Where it breaks:**

#### StaleMemoryInjector.getStaleMemories() - Line 44-50
```typescript
const { data, error } = await this.supabase
  .from('memories')
  .select('id, content, summary, protection_level, financial_impact, last_recalled_at')
  .eq('workspace_id', workspaceId)
  .eq('protection_level', parseInt(level))
  .or(`last_recalled_at.is.null,last_recalled_at.lt.${threshold.toISOString()}`)
```

**ISSUE:** If data comes back with regime_context as string instead of object:
- Not checked in this function
- But if later code tries to access it:
  ```typescript
  memory.regime_context.primary_regime  // STRING doesn't have .primary_regime!
  ```

**Where it actually breaks:**

#### WarningSystem.getRegimeWarnings() - Line 83
```typescript
.filter('regime_context->primary_regime', 'eq', regimeId)
```

If regime_context is STRING in database (bad migration), Supabase filter fails with:
- Type error if they validate JSON
- Or returns no results silently

**Current handling:** None
**Risk:** Silent query failures; no warnings returned when they should be

**Fix needed:**
```typescript
// Defensive parsing
if (memory.regime_context && typeof memory.regime_context === 'string') {
  try {
    memory.regime_context = JSON.parse(memory.regime_context);
  } catch (e) {
    console.error(`[StaleMemoryInjector] Failed to parse regime_context: ${e}`);
    memory.regime_context = {};
  }
}
```

---

### 3.2 Symbols Array Contains Non-Strings
**Scenario:** Migration corrupted symbols; they're now [1, null, undefined, "SPY", {}]

**Where it breaks:**

#### RecallEngine.bm25Search() - Line 287-289
```typescript
const symbols = r.symbols
  ? safeJSONParse<string[]>(r.symbols, null)
  : null;

return {
  // ... other fields
  symbols,  // Could be null or array with bad values
  // ...
};
```

If symbols is `[1, null, undefined, "SPY", {}]`:
- Passes through safeJSONParse successfully
- Returns to formatForPrompt()

#### RecallEngine.formatForPrompt() - Line 581
```typescript
if (m.symbols?.length) formatted += `  - Symbols: ${m.symbols.join(', ')}\n`;
```

**ISSUE:** Array contains non-strings
- `[1, null, undefined, "SPY", {}].join(', ')` returns: `"1,,SPY,[object Object]"`
- User sees: "Symbols: 1,,SPY,[object Object]"
- Not a crash, but broken output

**Current handling:** None
**Risk:** Malformed display of symbols

**Fix needed:**
```typescript
if (m.symbols?.length) {
  const cleanSymbols = m.symbols
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
  if (cleanSymbols.length > 0) {
    formatted += `  - Symbols: ${cleanSymbols.join(', ')}\n`;
  }
}
```

---

### 3.3 Embedding Vector Wrong Dimensions
**Scenario:** Migration corrupts embedding; stored as 1024-dim instead of 1536-dim

**Where it breaks:**

#### RecallEngine.vectorSearch() - Line 331
```typescript
const { data, error } = await this.supabase.rpc('hybrid_search_memories', {
  query_text: query,
  query_embedding: queryEmbedding,  // 1536-dim
  match_workspace_id: workspaceId,
  // ...
});
```

**ISSUE:** If memory embedding is 1024-dim but query is 1536-dim:
- Supabase RPC function tries cosine distance on vectors of different dimensions
- PostgreSQL vector extension returns error:
  ```
  ERROR: operators <=> not supported for different vector dimensions
  ```

**Current handling:** Error caught, logged, returns []
```typescript
if (error) {
  console.error('[RecallEngine] Vector search error:', error);
  return [];
}
```

**Risk:** Vector search silently fails; users get no results
- No indication that data is corrupted
- Fallback to BM25 search only (hidden from user)

**Fix needed:**
```typescript
// Validate embedding dimensions before RPC
if (queryEmbedding.length !== 1536) {
  console.error(`[RecallEngine] Invalid query embedding dimensions: ${queryEmbedding.length}, expected 1536`);
  return [];
}
```

---

## 4. TIMING ISSUES

### 4.1 Daemon Extracts While App is Closing
**Scenario:** App calls app.on('before-quit') but daemon is mid-extraction

**Where it breaks:**

#### main.ts - Line 216-224
```typescript
app.on('before-quit', async () => {
  if (memoryDaemon) {
    await memoryDaemon.stop();  // Waits for daemon to stop
  }
  if (localDb) {
    localDb.close();  // Closes database
  }
});
```

#### MemoryDaemon.stop() - Line 108-122
```typescript
async stop(): Promise<void> {
  console.log('[MemoryDaemon] Stopping daemon...');

  if (this.extractionTimer) {
    clearInterval(this.extractionTimer);  // Stops timer
    this.extractionTimer = undefined;
  }

  while (this.isExtracting) {
    await new Promise((resolve) => setTimeout(resolve, 100));  // Line 116-118
  }
  // ...
}
```

**ISSUE:** Race condition
1. User closes app
2. extractionTimer is cleared
3. BUT extractionCycle() might be in progress (isExtracting = true)
4. Waits in while loop for isExtracting = false
5. What if extractionCycle() is awaiting Supabase?
6. Supabase times out while waiting for response
7. extractionCycle() catches error, sets isExtracting = false
8. **But database is already closed!**
9. Next operation crashes

**Timeline:**
```
t=0: extractionTimer cleared
t=10ms: extractionCycle awaits this.supabase.from().insert()
t=20ms: app.on('before-quit') waits in while loop
t=30ms: database closed (from main.ts)
t=40ms: Supabase response arrives
t=50ms: extractionCycle tries to write to closed database → CRASH
```

**Current handling:** Tries to wait, but no timeout
**Risk:** Unhandled promise rejection; corrupted database

**Fix needed:**
```typescript
async stop(): Promise<void> {
  console.log('[MemoryDaemon] Stopping daemon...');

  if (this.extractionTimer) {
    clearInterval(this.extractionTimer);
    this.extractionTimer = undefined;
  }

  // Wait with timeout to prevent hanging
  const maxWaitTime = 5000;  // 5 seconds max
  const startTime = Date.now();
  while (this.isExtracting && Date.now() - startTime < maxWaitTime) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (this.isExtracting) {
    console.error('[MemoryDaemon] Daemon still extracting after timeout; forcing stop');
    // Could set a flag to mark in-flight operations as unsafe
  }

  this.emit('stopped');
  console.log('[MemoryDaemon] Daemon stopped');
}
```

---

### 4.2 RecallEngine Called Before DB Initialized
**Scenario:** User quickly clicks "recall memory" before MemoryDaemon finishes init

**Where it breaks:**

#### main.ts - Line 199-207
```typescript
memoryDaemon.start().then(() => {
  console.log('[Main] Memory daemon started successfully');
  createWindow();
}).catch(err => {
  console.error('[Main] Failed to start memory daemon:', err);
  createWindow();  // Still creates window even if daemon fails!
});
```

**ISSUE:** Window created before daemon startup completes
- Daemon.start() calls initializeLocalDb() which might fail
- But createWindow() is called anyway
- User can click buttons that call RecallEngine
- RecallEngine tries to query memory_cache table
- **Table doesn't exist yet if async initialization is slow**

**Timeline:**
```
t=0: memoryDaemon.start() called (async)
t=1ms: .then() scheduled
t=2ms: createWindow() scheduled via .catch() path
t=5ms: Window appears, user immediately starts typing
t=10ms: User triggers memory:recall IPC
t=15ms: RecallEngine.recall() tries to query memory_cache
t=20ms: memoryDaemon.start() finally completes initialization
→ Race condition: query might fail
```

**Current handling:** RecallEngine.initializeDb() in constructor catches errors
**Risk:** If schema.sql missing or database locked, user gets empty results silently

**Fix needed:**
```typescript
// Explicit initialization handshake
let recallEngineReady = false;

memoryDaemon.start()
  .then(() => {
    recallEngineReady = true;  // Mark as ready
    console.log('[Main] Memory systems initialized');
    createWindow();
  })
  .catch((err) => {
    console.error('[Main] Failed to start memory daemon:', err);
    recallEngineReady = false;  // Still not ready
    createWindow();  // Create window but show warning
  });

// In RecallEngine handler:
ipcMain.handle('memory:recall', async (_event, query: string, workspaceId: string) => {
  if (!recallEngineReady) {
    return {
      memories: [],
      totalFound: 0,
      searchTimeMs: 0,
      usedCache: false,
      query,
      error: 'Memory system still initializing, please wait...'
    };
  }
  // ... continue
});
```

---

### 4.3 Migration Not Applied Yet
**Scenario:** User has old schema; new code expects regime_context column

**Where it breaks:**

#### RegimeTagger.tagRun() - Line 50-56
```typescript
const { error } = await this.supabase
  .from('backtest_runs')
  .update({
    regime_id: regime.primary_regime,
    regime_context: regime,  // Column might not exist!
  })
  .eq('id', runId);

if (error) {
  console.error('[RegimeTagger] Failed to update run with regime:', error);
  return null;
}
```

**ISSUE:** If migration not applied, regime_context column doesn't exist
- Supabase returns error: "column 'regime_context' doesn't exist"
- Error is caught and logged
- Returns null silently
- **User thinks it worked but data isn't tagged**

**Similar in:**
- OverfittingDetector saves to statistical_validity column (might not exist)
- StaleMemoryInjector queries protection_level column (might not exist)

**Current handling:** Error logged, returns null
**Risk:** Silent failure; downstream code breaks when expecting tagged data

**Fix needed:**
```typescript
const { error } = await this.supabase
  .from('backtest_runs')
  .update({
    regime_id: regime.primary_regime,
    regime_context: regime,
  })
  .eq('id', runId);

if (error) {
  if (error.message.includes('column')) {
    console.error('[RegimeTagger] CRITICAL: Schema migration not applied. Column missing:', error.message);
    console.error('[RegimeTagger] Please run: supabase migration up');
    throw new Error('Database schema not migrated. Please run migrations.');
  }
  console.error('[RegimeTagger] Failed to update run with regime:', error);
  return null;
}
```

---

## 5. API FAILURES

### 5.1 OpenAI API Timeout
**Scenario:** OpenAI API is slow; embedding generation times out

**Where it breaks:**

#### RecallEngine.generateQueryEmbedding() - Line 429-469
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 10000);  // 10 second timeout

try {
  const response = await this.openaiClient.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.trim(),
  });

  clearTimeout(timeoutId);
  // Process response...
} catch (error) {
  if ((error as any)?.name === 'AbortError') {
    console.error('[RecallEngine] Embedding generation timeout');
  } else {
    console.error('[RecallEngine] Embedding generation error:', error);
  }
  return null;
} finally {
  clearTimeout(timeoutId);
}
```

**ISSUE:** Timeout is implemented but AbortController might not be propagated
- OpenAI client might not support AbortController in this way
- Actually looking at code: AbortController created but never passed to create()!
- **Timeout is set but never applied**

```typescript
const response = await this.openaiClient.embeddings.create({
  model: 'text-embedding-3-small',
  input: text.trim(),
  // NO abort signal passed!
});
```

**Current handling:** setTimeout creates timeout but doesn't abort request
**Risk:** Embedding generation can hang indefinitely

**Fix needed:**
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 10000);

try {
  const response = await this.openaiClient.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.trim(),
    // Note: OpenAI client might not support abort signal directly
    // Alternative: wrap in Promise.race with timeout promise
  });
  // ... rest
} finally {
  clearTimeout(timeoutId);
}
```

---

### 5.2 Supabase Rate Limit (1000 req/min)
**Scenario:** 100 concurrent memory recall requests hit rate limit

**Where it breaks:**

#### RecallEngine.hybridSearch() - Line 224-227
```typescript
const [bm25Results, vectorResults] = await Promise.all([
  this.bm25Search(q, workspaceId, limit, categories),
  this.vectorSearch(q, workspaceId, limit, minImportance, categories, symbols),
]);
```

**ISSUE:** No retry logic or backoff
- If rate limited (429 Too Many Requests), Supabase returns error
- Error caught: returns []
- **User loses search results**

```typescript
if (error) {
  console.error('[RecallEngine] Vector search error:', error);
  return [];  // Rate limit → empty results
}
```

**Current handling:** Log error and return empty
**Risk:** Under load, system silently degrades

**Fix needed:**
```typescript
import pRetry from 'p-retry';

const vectorResults = await pRetry(
  () => this.vectorSearch(q, workspaceId, limit, minImportance, categories, symbols),
  {
    retries: 3,
    minTimeout: 100,
    maxTimeout: 1000,
    onFailedAttempt: (error) => {
      if (error.response?.status === 429) {
        console.warn('[RecallEngine] Rate limited, retrying...');
      }
    },
  }
);
```

---

### 5.3 Supabase Connection Drops Mid-Transaction
**Scenario:** Network fails while saving 100 memories

**Where it breaks:**

#### MemoryDaemon.saveMemories() - Line 280-287
```typescript
if (supabaseRecords.length > 0) {
  const { data, error } = await this.supabase
    .from('memories')
    .insert(supabaseRecords)
    .select('id');

  if (error) {
    console.error('[MemoryDaemon] Supabase insert error:', error);
    return;  // Lost all 100 records!
  }
```

**ISSUE:** No partial success handling
- If 50 records inserted before network fails
- Error caught, returns silently
- **Those 50 records are in Supabase, but local extraction_state still shows old position**
- Next extraction tries to re-insert same messages
- **Duplicate memories created**

**Current handling:** Log and return
**Risk:** Duplicate memories in database

**Fix needed:**
```typescript
if (supabaseRecords.length > 0) {
  // Batch smaller inserts to reduce failure domain
  const BATCH_SIZE = 10;
  const batches = chunk(supabaseRecords, BATCH_SIZE);

  const insertedIds: string[] = [];
  for (const batch of batches) {
    const { data, error } = await this.supabase
      .from('memories')
      .insert(batch)
      .select('id');

    if (error) {
      console.error('[MemoryDaemon] Batch insert error:', error);
      // Partial success - at least we got some
      if (data?.length > 0) {
        insertedIds.push(...data.map((d: any) => d.id));
      }
      // Don't return - try to save what we have
      break;
    } else {
      insertedIds.push(...(data?.map((d: any) => d.id) || []));
    }
  }

  // Update extraction state with what we actually inserted
  if (insertedIds.length > 0) {
    // Update locally
  }
}
```

---

## 6. USER BEHAVIOR

### 6.1 Running Migrate-Lessons Twice
**Scenario:** User accidentally runs migrate-lessons.ts twice

**Where it breaks:**

This depends on the script but typically:

**Issue:** If script does:
```typescript
const { data } = await supabase
  .from('memories')
  .insert(allMemories)
  .select('id');
```

Without ON CONFLICT handling:
- Second run inserts duplicate memories
- Same content, summary, created_at
- User now has 2x memories

**If script has unique constraint on something:**
- Second run gets error
- Script crashes
- User confused about state

**Fix needed:** Script should:
```typescript
// Idempotent operation
const { data, error } = await supabase
  .from('memories')
  .upsert(allMemories, {
    onConflict: 'content',  // If content exists, update
  })
  .select('id');
```

---

### 6.2 Delete Workspace While Daemon Running
**Scenario:** User deletes workspace from Supabase dashboard while daemon extracting

**Where it breaks:**

#### MemoryDaemon.extractionCycle() - Line 133-149
```typescript
const { data: sessions } = await this.supabase
  .from('chat_sessions')
  .select('id, workspace_id')
  .order('updated_at', { ascending: false })
  .limit(10);

if (!sessions || sessions.length === 0) {
  return;  // ← Workspace gone, sessions query returns 0
}

// Still tries to process empty list safely
const limit = pLimit(3);
await Promise.all(
  sessions.map((session) =>
    limit(() => this.processSession(session.id, session.workspace_id))
  )
);
```

**ISSUE:** If workspace deleted but extraction_state in SQLite still references it:
```typescript
private updateExtractionState(
  sessionId: string,
  workspaceId: string,
  lastMessageId: string,
  messagesProcessed: number
): void {
  this.localDb.prepare(`
    INSERT OR REPLACE INTO extraction_state
    ...
    VALUES (?, ?, ?, ?, COALESCE(...), ?)
  `).run(sessionId, workspaceId, lastMessageId, Date.now(), sessionId, messagesProcessed);
}
```

Inserts orphaned record referencing deleted workspace

**Current handling:** None
**Risk:** Orphaned extraction_state records; potential FK violations if schema has constraints

**Fix needed:**
```typescript
private async extractionCycle(): Promise<void> {
  if (this.isExtracting) return;
  this.isExtracting = true;

  try {
    const { data: sessions } = await this.supabase
      .from('chat_sessions')
      .select('id, workspace_id');

    if (!sessions || sessions.length === 0) {
      console.log('[MemoryDaemon] No sessions found - workspace might have been deleted');
      // Clean up extraction_state for non-existent workspaces
      // (optional - could be expensive)
      return;
    }

    // Validate workspace exists before processing
    for (const session of sessions) {
      const { data: ws } = await this.supabase
        .from('workspaces')
        .select('id')
        .eq('id', session.workspace_id)
        .single();

      if (!ws) {
        console.warn(`[MemoryDaemon] Workspace ${session.workspace_id} not found for session ${session.id}`);
        continue;  // Skip this session
      }

      await this.processSession(session.id, session.workspace_id);
    }
  } catch (error) {
    console.error('[MemoryDaemon] Extraction cycle error:', error);
    this.emit('error', error);
  } finally {
    this.isExtracting = false;
  }
}
```

---

### 6.3 Query for Regime That Doesn't Exist
**Scenario:** User asks for "Regime 7" but only 1-6 exist

**Where it breaks:**

#### RegimeTagger.classifyVixRegime() - Line 145-150
```typescript
private classifyVixRegime(vixAvg: number): 'low' | 'normal' | 'high' | 'extreme' {
  if (vixAvg < 15) return 'low';
  if (vixAvg < 20) return 'normal';
  if (vixAvg < 30) return 'high';
  return 'extreme';
}
```

This is fine, but if user queries regime_context directly:

#### WarningSystem.getRegimeWarnings() - Line 83
```typescript
.filter('regime_context->primary_regime', 'eq', regimeId)
```

If regimeId = 7:
- Query runs: regime_context->primary_regime EQ 7
- Returns 0 results (no regime 7 exists)
- **Silently returns empty array**

**Current handling:** Returns []
**Risk:** No indication that regime_id was invalid

**Fix needed:**
```typescript
private async getRegimeWarnings(regimeId: number | null, workspaceId: string): Promise<RegimeWarning[]> {
  if (!regimeId) return [];

  if (regimeId < 1 || regimeId > 6) {
    console.warn(`[WarningSystem] Invalid regime_id: ${regimeId}. Must be 1-6.`);
    return [];
  }

  const { data, error } = await this.supabase
    .from('memories')
    // ... rest
}
```

---

### 6.4 Backtest with No Date Range
**Scenario:** params = { capital: 10000 } (missing startDate, endDate)

**Where it breaks:**

#### RegimeTagger.tagRun() - Line 166-168
```typescript
if (run && run.params?.startDate && run.params?.endDate) {
  await this.tagRun(runId, run.params.startDate, run.params.endDate);  // Safe
}
```

**Good:** Checks for startDate and endDate

But if called directly:

#### RegimeTagger.detectRegime() - Line 76-79
```typescript
private async detectRegime(startDate: string, endDate: string): Promise<RegimeContext | null> {
  const start = new Date(startDate);  // Can be Invalid Date!
  const end = new Date(endDate);

  // No validation
  for (const period of knownRegimes) {
    if (start >= period.start && start <= period.end) {  // Comparison with Invalid Date always false
```

**ISSUE:** If startDate is null or empty string:
- `new Date(null)` creates current date
- `new Date('')` creates Invalid Date
- Comparisons with Invalid Date return false
- Falls through to default regime 5

**Current handling:** Falls back to default
**Risk:** Wrong regime assigned without warning

**Fix needed:**
```typescript
private async detectRegime(startDate: string, endDate: string): Promise<RegimeContext | null> {
  if (!startDate || !endDate) {
    console.warn('[RegimeTagger] Missing date range for regime detection');
    return null;
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    console.warn('[RegimeTagger] Invalid date format:', startDate, endDate);
    return null;
  }

  // ... rest
}
```

---

## 7. CONCURRENCY ISSUES

### 7.1 Two Daemons Running on Same Machine
**Scenario:** User opens two instances of app simultaneously

**Where it breaks:**

#### main.ts - Line 153-154
```typescript
const memoryDbPath = path.join(app.getPath('userData'), 'memory.db');
localDb = new Database(memoryDbPath);
```

**ISSUE:** Both instances open same SQLite file
- SQLite allows multiple readers
- But writes conflict
- better-sqlite3 throws error on lock conflict

**Timeline:**
```
App1: Open memory.db
App2: Open memory.db (same file)
App1: Memory daemon writes extraction_state
App2: Memory daemon tries to write same table
  → SQLITE_BUSY error (database is locked)
```

**Current handling:** Error logged, extraction skipped
**Risk:** Whichever app wins gets to extract; other loses memories

**Fix needed:**
```typescript
const memoryDbPath = path.join(app.getPath('userData'), 'memory.db');
try {
  localDb = new Database(memoryDbPath);
  // Set write timeout to prevent lock errors
  localDb.pragma('busy_timeout = 5000');  // 5 second timeout
} catch (error) {
  console.error('[Main] Failed to open local memory database:', error);
  dialog.showErrorBox(
    'Database Error',
    'Another instance of this app is running. Please close it first.'
  );
  app.quit();
}
```

---

### 7.2 Race Condition: updateAccessMetrics
**Scenario:** Rapid recalls of same memory

**Where it breaks:**

#### RecallEngine.updateAccessMetrics() - Line 474-503
```typescript
private async updateAccessMetrics(memoryIds: string[]): Promise<void> {
  if (memoryIds.length === 0) return;

  const now = Date.now();

  try {
    const placeholders = memoryIds.map(() => '?').join(',');
    this.localDb.prepare(`
      UPDATE memory_cache
      SET access_count = access_count + 1, last_accessed = ?
      WHERE id IN (${placeholders})
    `).run(now, ...memoryIds);  // Local write
  } catch (error) {
    // Swallowed
  }

  // Async update to Supabase (fire and forget)
  this.supabase
    .from('memories')
    .update({
      access_count: this.supabase.sql`access_count + 1`,  // Increment
      last_accessed: new Date().toISOString(),
    })
    .in('id', memoryIds)
    .then(() => {})
    .catch((err) => console.error('...', err));
}
```

**ISSUE:** Race condition on Supabase side
- Local SQLite correctly increments with SQL: `access_count + 1`
- But Supabase uses this.supabase.sql`` which might not work as intended
- If two recalls happen in parallel:
  - Supabase receives two increment requests
  - Both read current value, increment, write back
  - One overwrites the other
  - **access_count doesn't reflect actual count**

Example:
```
t=0: access_count = 5
t=1: Request A reads access_count = 5
t=2: Request B reads access_count = 5
t=3: Request A writes access_count = 6
t=4: Request B writes access_count = 6 (should be 7!)
Result: access_count = 6 instead of 7
```

**Current handling:** None - this.supabase.sql might not handle correctly
**Risk:** Access metrics gradually diverge from reality under load

**Fix needed:**
```typescript
this.supabase
  .from('memories')
  .update({
    access_count: this.supabase.sql`access_count + ${memoryIds.length}`,
    last_accessed: new Date().toISOString(),
  })
  .in('id', memoryIds)
  // Or use a direct RPC that atomically increments
```

---

## 8. DATABASE CONSTRAINT VIOLATIONS

### 8.1 Unique Constraint on regime_profile_performance
**Scenario:** Update trigger fires twice for same (regime_id, profile_id) pair

**Where it breaks:**

#### Migration - Line 500-524
```typescript
-- Create trigger for auto-population
CREATE TRIGGER update_regime_matrix_on_run_complete
  AFTER INSERT OR UPDATE ON backtest_runs
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND NEW.regime_id IS NOT NULL)
  EXECUTE FUNCTION update_regime_performance_matrix();
```

If function is slow and backtest_runs updated twice:
- First backtest completes: trigger fires, inserts into regime_profile_performance
- Second backtest completes with same regime/profile: trigger fires again
- Tries to INSERT with UNIQUE(workspace_id, regime_id, profile_id)
- **Duplicate key error** (caught by ON CONFLICT but might log noise)

**Current handling:** ON CONFLICT clause (line 515) handles it
**Risk:** Error logs polluted; silent failure

**Fix needed:** Already in place:
```sql
ON CONFLICT (workspace_id, regime_id, profile_id)
DO UPDATE SET
  avg_sharpe = ...,
  total_runs = ...,
  ...
```

This is already correct.

---

## 9. SUMMARY TABLE: Critical Edge Cases

| # | Scenario | Component | Risk Level | Status | Fix Priority |
|---|----------|-----------|-----------|--------|--------------|
| 1.1 | Zero memories in workspace | RecallEngine.warmCache() | MEDIUM | Missing table check | HIGH |
| 1.2 | Null workspaceId in processSession | MemoryDaemon.processSession() | MEDIUM | No validation | HIGH |
| 1.3 | regime_context JSONB is empty | StaleMemoryInjector | LOW | Handled by safety | MEDIUM |
| 1.4 | statistical_validity = {} | OverfittingDetector | HIGH | Empty object is truthy | HIGH |
| 2.1 | Sharpe = Infinity | RecallEngine sort | HIGH | Breaks sorting | HIGH |
| 2.2 | 10k results from hybrid search | RecallEngine | LOW | Memory leak only | LOW |
| 2.3 | 10k embeddings to generate | MemoryDaemon | HIGH | Rate limit hit | HIGH |
| 3.1 | regime_context is string | WarningSystem | HIGH | Silent query failure | HIGH |
| 3.2 | Symbols array has [1, null, {}] | RecallEngine formatForPrompt | LOW | Display corruption only | LOW |
| 3.3 | Embedding vector wrong dimensions | RecallEngine vector search | HIGH | Postgres error | HIGH |
| 4.1 | Daemon extracting while closing | main.ts close handler | HIGH | Race condition | HIGH |
| 4.2 | RecallEngine before DB init | main.ts | HIGH | Silent failure | HIGH |
| 4.3 | Migration not applied | RegimeTagger | CRITICAL | Silent failure | CRITICAL |
| 5.1 | OpenAI API timeout | RecallEngine embedding | MEDIUM | Timeout not working | HIGH |
| 5.2 | Supabase rate limit | RecallEngine | MEDIUM | Returns empty | MEDIUM |
| 5.3 | Connection drops mid-transaction | MemoryDaemon save | MEDIUM | Duplicates | HIGH |
| 6.1 | Migrate-lessons twice | Script | LOW | Duplicate data | LOW |
| 6.2 | Delete workspace while extracting | MemoryDaemon | MEDIUM | Orphaned records | MEDIUM |
| 6.3 | Query regime that doesn't exist | WarningSystem | LOW | Silent empty | LOW |
| 6.4 | Backtest with no date | RegimeTagger | MEDIUM | Wrong regime | MEDIUM |
| 7.1 | Two daemon instances | SQLite lock | MEDIUM | One loses data | HIGH |
| 7.2 | Race condition: access_count | RecallEngine metrics | LOW | Count drifts | LOW |

---

## Recommendations

### Immediate (Critical)
1. **Fix statistical_validity empty object check** (1.4)
2. **Add workspaceId validation in MemoryDaemon** (1.2)
3. **Handle migration failures explicitly** (4.3)
4. **Fix embedding timeout implementation** (5.1)
5. **Add concurrency limiting to embedding generation** (2.3)

### High Priority
1. Validate Sharpe values before sorting (2.1)
2. Add initialization handshake for RecallEngine (4.2)
3. Add graceful shutdown timeout (4.1)
4. Fix regime_context type safety (3.1)
5. Handle JSONB parsing defensively (3.1)

### Medium Priority
1. Implement retry logic for Supabase (5.2, 5.3)
2. Add regex validation for parameters (6.4)
3. Add SQLite write timeout (7.1)
4. Clean up orphaned records (6.2)

### Nice to Have
1. Add protection_level to RecallEngine response (for triggerRecall filtering)
2. Sanitize arrays in formatForPrompt() (3.2)
3. Add regime existence validation (6.3)
