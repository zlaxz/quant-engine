# Edge Case Fixes - Implementation Guide

This document provides code implementations for fixing the critical edge cases identified in EDGE_CASE_AUDIT_2025_11_23.md.

---

## 1. Statistical Validity Empty Object Check

**File:** `src/electron/analysis/overfittingDetector.ts`
**Current Issue:** Empty object {} is truthy; no validation of structure

**Before:**
```typescript
async analyzeRun(run: BacktestRun): Promise<OverfittingWarning[]> {
  const warnings: OverfittingWarning[] = [];
  const sv = run.statistical_validity;

  if (!sv) {  // Empty object passes this check!
    console.warn(`[OverfittingDetector] No statistical_validity for run ${run.id}`);
    return warnings;
  }

  // Check 1: Probability of Backtest Overfitting
  if (sv.pbo_score && sv.pbo_score > 0.25) {  // Weak check
```

**After:**
```typescript
async analyzeRun(run: BacktestRun): Promise<OverfittingWarning[]> {
  const warnings: OverfittingWarning[] = [];
  const sv = run.statistical_validity;

  // Proper validation: check type, structure, and required fields
  if (!sv || typeof sv !== 'object' || Object.keys(sv).length === 0) {
    console.warn(`[OverfittingDetector] No statistical_validity for run ${run.id}`);
    return warnings;
  }

  // Validate key fields are proper types
  const safeSv = {
    pbo_score: this.validateNumber(sv.pbo_score, 0, 1),
    walk_forward_efficiency: this.validateNumber(sv.walk_forward_efficiency, 0, 2),
    n_trades: this.validateNumber(sv.n_trades, 0, 100000),
    t_statistic: this.validateNumber(sv.t_statistic, 0, 50),
    deflated_sharpe: this.validateNumber(sv.deflated_sharpe, -10, 10),
    parameter_sensitivity: sv.parameter_sensitivity as 'low' | 'medium' | 'high' | undefined,
    passes_multiple_testing: Boolean(sv.passes_multiple_testing),
    passes_walk_forward: Boolean(sv.passes_walk_forward),
    passes_pbo: Boolean(sv.passes_pbo),
    overall_valid: Boolean(sv.overall_valid),
  };

  // Check 1: Probability of Backtest Overfitting
  if (safeSv.pbo_score && safeSv.pbo_score > 0.25) {
    // ... rest of checks using safeSv
  }
  // ... rest
}

private validateNumber(value: any, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
    return undefined;
  }
  return Math.max(min, Math.min(max, value));
}
```

---

## 2. WorkspaceId Validation in MemoryDaemon

**File:** `src/electron/memory/MemoryDaemon.ts`
**Current Issue:** No validation of workspaceId parameter in processSession()

**Before:**
```typescript
private async processSession(sessionId: string, workspaceId: string): Promise<void> {
  const state = this.localDb
    .prepare('SELECT last_message_id FROM extraction_state WHERE session_id = ?')
    .get(sessionId) as any;
  // ... uses workspaceId without checking
}
```

**After:**
```typescript
private async processSession(sessionId: string, workspaceId: string): Promise<void> {
  // Validate inputs
  if (!sessionId || typeof sessionId !== 'string') {
    console.error('[MemoryDaemon] Invalid sessionId');
    return;
  }
  if (!workspaceId || typeof workspaceId !== 'string') {
    console.error('[MemoryDaemon] Invalid workspaceId in processSession');
    return;
  }

  // Basic UUID format validation (if needed)
  if (!this.isValidUUID(workspaceId)) {
    console.error(`[MemoryDaemon] Invalid workspaceId format: ${workspaceId}`);
    return;
  }

  const state = this.localDb
    .prepare('SELECT last_message_id FROM extraction_state WHERE session_id = ?')
    .get(sessionId) as any;
  // ... rest of function
}

private isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}
```

---

## 3. Migration Failure Detection

**File:** `src/electron/analysis/regimeTagger.ts`
**Current Issue:** Silent failure when schema not migrated

**Before:**
```typescript
async tagRun(runId: string, startDate: string, endDate: string): Promise<RegimeContext | null> {
  try {
    const regime = await this.detectRegime(startDate, endDate);

    if (!regime) {
      console.warn(`[RegimeTagger] Could not detect regime for ${startDate} to ${endDate}`);
      return null;
    }

    const { error } = await this.supabase
      .from('backtest_runs')
      .update({
        regime_id: regime.primary_regime,
        regime_context: regime,
      })
      .eq('id', runId);

    if (error) {
      console.error('[RegimeTagger] Failed to update run with regime:', error);
      return null;  // Silent failure - user doesn't know
    }
```

**After:**
```typescript
async tagRun(runId: string, startDate: string, endDate: string): Promise<RegimeContext | null> {
  try {
    const regime = await this.detectRegime(startDate, endDate);

    if (!regime) {
      console.warn(`[RegimeTagger] Could not detect regime for ${startDate} to ${endDate}`);
      return null;
    }

    const { error } = await this.supabase
      .from('backtest_runs')
      .update({
        regime_id: regime.primary_regime,
        regime_context: regime,
      })
      .eq('id', runId);

    if (error) {
      // Detect if this is a schema migration error
      const isMigrationError = this.isMigrationError(error);

      if (isMigrationError) {
        console.error(
          '[RegimeTagger] CRITICAL: Database schema not migrated!',
          'Error:', error.message,
          'Solution: Run: supabase migration up'
        );
        throw new Error(
          'Database schema missing required columns. Please run database migrations: supabase migration up'
        );
      }

      console.error('[RegimeTagger] Failed to update run with regime:', error);
      return null;
    }

    console.log(`[RegimeTagger] Tagged run ${runId.slice(0, 8)} as Regime ${regime.primary_regime}`);
    return regime;
  } catch (error) {
    console.error('[RegimeTagger] Error tagging run:', error);
    throw error;  // Propagate migration errors
  }
}

private isMigrationError(error: any): boolean {
  const message = error.message?.toLowerCase() || '';
  return message.includes('column') ||
         message.includes('does not exist') ||
         message.includes('undefined column') ||
         message.includes('relation');
}
```

---

## 4. Fix Embedding Timeout

**File:** `src/electron/memory/RecallEngine.ts`
**Current Issue:** Timeout is set but never applied to request

**Before:**
```typescript
private async generateQueryEmbedding(text: string): Promise<number[] | null> {
  if (!this.openaiClient) {
    console.error('[RecallEngine] OpenAI client not initialized');
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await this.openaiClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.trim(),
      // NO signal passed!
    });
```

**After:**
```typescript
private async generateQueryEmbedding(text: string): Promise<number[] | null> {
  if (!this.openaiClient) {
    console.error('[RecallEngine] OpenAI client not initialized');
    return null;
  }

  return await Promise.race([
    this.generateEmbeddingWithClient(text),
    this.timeoutPromise(10000),
  ]);
}

private async generateEmbeddingWithClient(text: string): Promise<number[] | null> {
  try {
    const response = await this.openaiClient!.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.trim(),
    });

    if (!response.data || response.data.length === 0) {
      console.error('[RecallEngine] Invalid embedding response: no data');
      return null;
    }

    const embedding = response.data[0]?.embedding;
    if (!embedding || !Array.isArray(embedding)) {
      console.error('[RecallEngine] Invalid embedding data structure');
      return null;
    }

    return embedding;
  } catch (error) {
    console.error('[RecallEngine] Embedding generation error:', error);
    return null;
  }
}

private timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Embedding generation timeout after ${ms}ms`)), ms)
  );
}
```

---

## 5. Concurrency Limiting for Embeddings

**File:** `src/electron/memory/MemoryDaemon.ts`
**Current Issue:** No concurrency control; 10k parallel embedding requests possible

**Before:**
```typescript
private async saveMemories(
  memories: ExtractedMemory[],
  sessionId: string,
  workspaceId: string
): Promise<void> {
  const memoriesWithEmbeddings = await Promise.all(
    memories.map(async (m) => ({
      ...m,
      embedding: await this.generateEmbedding(m.content),
    }))
  );
```

**After:**
```typescript
private async saveMemories(
  memories: ExtractedMemory[],
  sessionId: string,
  workspaceId: string
): Promise<void> {
  // Limit concurrent embedding generation to avoid rate limits
  const EMBEDDING_CONCURRENCY = 5;
  const limit = pLimit(EMBEDDING_CONCURRENCY);

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

  // Continue with saving...
  const supabaseRecords = memoriesWithEmbeddings
    .filter((m) => m.embedding !== null)
    .map((m) => ({
      // ... rest unchanged
    }));

  if (supabaseRecords.length > 0) {
    // Batch inserts to handle partial failures
    await this.savMemoriesBatch(supabaseRecords);
  }
}

private async savMemoriesBatch(records: any[], batchSize: number = 10): Promise<void> {
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    const { data, error } = await this.supabase
      .from('memories')
      .insert(batch)
      .select('id');

    if (error) {
      console.error(`[MemoryDaemon] Batch ${Math.floor(i / batchSize)} insert error:`, error);
      // Continue with next batch instead of giving up
      continue;
    }

    // Save local cache for this batch
    if (data && data.length > 0) {
      // ... insert to local cache
    }
  }
}
```

---

## 6. Graceful Shutdown with Timeout

**File:** `src/electron/memory/MemoryDaemon.ts`
**Current Issue:** No timeout on daemon shutdown; can hang indefinitely

**Before:**
```typescript
async stop(): Promise<void> {
  console.log('[MemoryDaemon] Stopping daemon...');

  if (this.extractionTimer) {
    clearInterval(this.extractionTimer);
    this.extractionTimer = undefined;
  }

  while (this.isExtracting) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  this.emit('stopped');
  console.log('[MemoryDaemon] Daemon stopped');
}
```

**After:**
```typescript
async stop(): Promise<void> {
  console.log('[MemoryDaemon] Stopping daemon...');

  if (this.extractionTimer) {
    clearInterval(this.extractionTimer);
    this.extractionTimer = undefined;
  }

  // Wait with timeout to prevent hanging
  const MAX_SHUTDOWN_TIME = 5000;  // 5 seconds
  const startTime = Date.now();

  while (this.isExtracting && Date.now() - startTime < MAX_SHUTDOWN_TIME) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (this.isExtracting) {
    console.warn('[MemoryDaemon] Daemon still extracting after timeout; forcing stop');
    // Could set a flag to mark in-flight operations as unsafe
    // this.forceStop = true;
  }

  this.emit('stopped');
  console.log('[MemoryDaemon] Daemon stopped after', Date.now() - startTime, 'ms');
}
```

---

## 7. Initialize RecallEngine with Handshake

**File:** `src/electron/main.ts`
**Current Issue:** Window created before memory system ready

**Before:**
```typescript
const recallEngine = new RecallEngine(localDb, supabase);
memoryDaemon = new MemoryDaemon(localDb, supabase, {
  intervalMs: 30000,
  minImportance: 0.3,
});

// Start memory daemon and wait for it before creating window
memoryDaemon.start().then(() => {
  console.log('[Main] Memory daemon started successfully');
  createWindow();
}).catch(err => {
  console.error('[Main] Failed to start memory daemon:', err);
  createWindow();  // Still creates window!
});
```

**After:**
```typescript
let memorySystemReady = false;

const recallEngine = new RecallEngine(localDb, supabase);
memoryDaemon = new MemoryDaemon(localDb, supabase, {
  intervalMs: 30000,
  minImportance: 0.3,
});

// Start memory daemon with proper handshake
memoryDaemon.start()
  .then(async () => {
    // Warm cache to ensure everything is initialized
    const defaultWorkspaceId = process.env.DEFAULT_WORKSPACE_ID || 'default';
    await recallEngine.warmCache(defaultWorkspaceId);
    memorySystemReady = true;
    console.log('[Main] Memory system initialized and ready');
    createWindow();
  })
  .catch((err) => {
    console.error('[Main] Failed to start memory daemon:', err);
    memorySystemReady = false;
    createWindow();  // Create window but show warning
  });

// In IPC handler:
ipcMain.handle('memory:recall', async (_event, query: string, workspaceId: string, options?: any) => {
  if (!memorySystemReady) {
    return {
      memories: [],
      totalFound: 0,
      searchTimeMs: 0,
      usedCache: false,
      query,
      error: 'Memory system initializing. Please wait a moment and try again.',
    };
  }

  try {
    return await recallEngine.recall(query, workspaceId, options);
  } catch (error: any) {
    console.error('[MemoryHandlers] Recall error:', error);
    return {
      memories: [],
      totalFound: 0,
      searchTimeMs: 0,
      usedCache: false,
      query,
      error: error.message,
    };
  }
});
```

---

## 8. Validate Sharpe Values Before Sorting

**File:** `src/electron/memory/RecallEngine.ts`
**Current Issue:** Infinite/NaN values break sorting

**Before:**
```typescript
const sorted = Array.from(allResults.values())
  .filter((r) => r.importance >= minImportance)
  .sort((a, b) => {
    const scoreA = a.relevanceScore * a.importance;
    const scoreB = b.relevanceScore * b.importance;
    return scoreB - scoreA;
  });
```

**After:**
```typescript
const sorted = Array.from(allResults.values())
  .filter((r) => {
    // Validate importance
    if (typeof r.importance !== 'number' || isNaN(r.importance) || !isFinite(r.importance)) {
      console.warn(`[RecallEngine] Invalid importance score: ${r.importance}`);
      return false;
    }
    return r.importance >= minImportance;
  })
  .filter((r) => {
    // Validate relevance score
    if (typeof r.relevanceScore !== 'number' || isNaN(r.relevanceScore) || !isFinite(r.relevanceScore)) {
      console.warn(`[RecallEngine] Invalid relevance score: ${r.relevanceScore}`);
      return false;
    }
    return true;
  })
  .sort((a, b) => {
    // Safe calculation with clamping
    const scoreA = Math.max(-1e10, Math.min(1e10, a.relevanceScore * a.importance));
    const scoreB = Math.max(-1e10, Math.min(1e10, b.relevanceScore * b.importance));
    return scoreB - scoreA;
  });
```

---

## 9. Regime Context Type Safety

**File:** `src/electron/analysis/warningSystem.ts`
**Current Issue:** regime_context might be string instead of object

**Before:**
```typescript
private async getRegimeWarnings(regimeId: number | null, workspaceId: string): Promise<RegimeWarning[]> {
  if (!regimeId) return [];

  const { data } = await this.supabase
    .from('memories')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('memory_type', 'warning')
    .filter('regime_context->primary_regime', 'eq', regimeId)
    .gte('importance_score', 0.7)
    .order('importance_score', { ascending: false })
    .limit(5);

  return data || [];
}
```

**After:**
```typescript
private async getRegimeWarnings(regimeId: number | null, workspaceId: string): Promise<RegimeWarning[]> {
  if (!regimeId) return [];

  // Validate regime_id is in valid range
  if (!Number.isInteger(regimeId) || regimeId < 1 || regimeId > 6) {
    console.warn(`[WarningSystem] Invalid regime_id: ${regimeId}. Must be 1-6.`);
    return [];
  }

  const { data, error } = await this.supabase
    .from('memories')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('memory_type', 'warning')
    .filter('regime_context->primary_regime', 'eq', regimeId)
    .gte('importance_score', 0.7)
    .order('importance_score', { ascending: false })
    .limit(5);

  if (error) {
    console.error(`[WarningSystem] Failed to query regime warnings:`, error);
    // Check if this is a type error (regime_context is string)
    if (error.message?.includes('type') || error.message?.includes('JSONB')) {
      console.error('[WarningSystem] WARNING: regime_context column might be corrupted (expected JSONB, got string?)');
    }
    return [];
  }

  return (data || []).map((m) => this.validateRegimeWarning(m));
}

private validateRegimeWarning(data: any): RegimeWarning {
  // Defensive parsing of regime_context if it's string
  let regimeContext = data.regime_context;
  if (typeof regimeContext === 'string') {
    try {
      regimeContext = JSON.parse(regimeContext);
    } catch (e) {
      console.error('[WarningSystem] Failed to parse regime_context:', e);
      regimeContext = {};
    }
  }

  return {
    ...data,
    regime_context: regimeContext,
  };
}
```

---

## 10. SQLite Write Timeout for Multi-Instance

**File:** `src/electron/main.ts`
**Current Issue:** Two app instances conflict on database lock

**Before:**
```typescript
const memoryDbPath = path.join(app.getPath('userData'), 'memory.db');
localDb = new Database(memoryDbPath);
```

**After:**
```typescript
const memoryDbPath = path.join(app.getPath('userData'), 'memory.db');
try {
  localDb = new Database(memoryDbPath);

  // Set write timeout to prevent immediate lock errors
  // This allows one instance to wait for the other to complete writes
  localDb.pragma('busy_timeout = 5000');  // 5 second timeout

  // Also set journal mode for better multi-instance support
  localDb.pragma('journal_mode = WAL');  // Write-Ahead Logging

  console.log('[Main] Memory database initialized with timeout protection');
} catch (error: any) {
  console.error('[Main] Failed to open local memory database:', error);

  // Check if it's a lock error
  if (error.message?.includes('locked') || error.code === 'SQLITE_BUSY') {
    dialog.showErrorBox(
      'Database Locked',
      'Another instance of this application is running. Please close it first or wait a few seconds.'
    );
  } else {
    dialog.showErrorBox(
      'Database Error',
      `Failed to open memory database: ${error.message}`
    );
  }

  app.quit();
}
```

---

## Testing Recommendations

For each fix, add test cases:

```typescript
describe('EdgeCaseHandling', () => {
  // 1. Test empty statistical_validity
  test('analyzeRun handles empty statistical_validity', async () => {
    const run = { statistical_validity: {} };
    const warnings = await detector.analyzeRun(run);
    expect(warnings).toEqual([]);
  });

  // 2. Test null workspaceId
  test('processSession rejects null workspaceId', async () => {
    const spy = jest.spyOn(console, 'error');
    await daemon.processSession('session-123', null);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Invalid workspaceId'));
  });

  // 3. Test migration error detection
  test('tagRun throws on migration error', async () => {
    const mockError = { message: "column 'regime_context' does not exist" };
    jest.spyOn(supabase, 'from').mockReturnValue({
      update: () => ({ eq: () => Promise.resolve({ error: mockError }) })
    });

    await expect(tagger.tagRun('run-123', '2020-01-01', '2020-12-31'))
      .rejects.toThrow('schema');
  });

  // 4. Test embedding timeout
  test('generateQueryEmbedding times out after 10s', async () => {
    jest.useFakeTimers();
    const promise = engine.generateQueryEmbedding('test query');
    jest.advanceTimersByTime(11000);
    await expect(promise).rejects.toThrow('timeout');
  });

  // 5. Test concurrency limiting
  test('embedding generation respects concurrency limit', async () => {
    const memories = Array(20).fill(null).map((_, i) => ({ content: `Memory ${i}` }));
    let concurrent = 0;
    let maxConcurrent = 0;

    jest.spyOn(openai, 'create').mockImplementation(() => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      return new Promise(resolve => setTimeout(() => {
        concurrent--;
        resolve({ data: [{ embedding: [] }] });
      }, 100));
    });

    await daemon.saveMemories(memories, 'session', 'workspace');
    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });
});
```
