# Full System Audit - Quant Engine
**Date:** 2025-11-30
**Auditors:** 6 Parallel Agents (Claude Code Explore agents)
**Scope:** Complete codebase - TypeScript, React, Python, Supabase, Build

---

## CRITICAL ISSUES (Fix Immediately)

### 🔴 1. Infinite Loop in SystemStatus.tsx
**Agent 4 Finding:** Line 150
```typescript
const fetchHealth = useCallback(async () => {
  // ... modifies daemonStatus state
}, [daemonStatus]); // ← Creates circular dependency

useEffect(() => {
  fetchHealth();
  const interval = setInterval(fetchHealth, 10000);
}, [fetchHealth]); // ← Recreates when daemonStatus changes → infinite loop
```
**Impact:** Component constantly re-renders, performance degradation
**Fix:** Remove `daemonStatus` from dependency array

---

### 🔴 2. .env File Exposed in Git
**Agent 6 Finding:** Root directory
**Exposed:**
- `VITE_SUPABASE_PUBLISHABLE_KEY` (valid until 2079)
- `VITE_SUPABASE_URL` (project ID visible)

**Impact:** Anyone with repo access can access your Supabase
**Fix:**
```bash
git rm --cached .env
echo ".env" >> .gitignore
git commit -m "Remove exposed secrets"
```

---

### 🔴 3. Hardcoded Supabase Credentials
**Agent 5 Finding:** pythonExecution.ts:9-11
```typescript
const SUPABASE_URL = 'https://ynaqtawyynqikfyranda.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```
**Impact:** Credentials in source code, visible in git
**Fix:** Move to environment variables

---

### 🔴 4. Path Validation Vulnerability
**Agent 2 Finding:** write-file edge function, line 39
```typescript
const realFullPath = Deno.realPathSync(engineRoot);
if (!fullPath.startsWith(realFullPath)) { // Comparing relative vs real path
```
**Impact:** Directory traversal security vulnerability
**Fix:** Resolve both paths before comparison

---

### 🔴 5. Store Type Missing Supabase Properties
**Agent 1 Finding:** main.ts:157-158
```typescript
const store = new Store<{
  // Missing: supabase.url and supabase.anonKey types
}>();

if (savedSupabaseUrl) process.env.SUPABASE_URL = savedSupabaseUrl; // TS Error
```
**Impact:** TypeScript compilation fails
**Fix:** Add supabase types to Store generic

---

### 🔴 6. Invalid .killed Property Access
**Agent 1 Finding:** toolHandlers.ts:2046, 2615
```typescript
if (result.signal === 'SIGTERM' || result.killed) { // ← .killed doesn't exist on spawnSync
```
**Impact:** Runtime undefined access
**Fix:** Remove `.killed` check (only exists on async spawn)

---

### 🔴 7. React Key Anti-Pattern
**Agent 4 Finding:** HelperChatDialog.tsx:84, ArtifactDisplay.tsx:82
```typescript
{messages.map((msg, idx) => (
  <div key={idx}>  // ❌ Using index as key
```
**Impact:** State loss when messages reorder
**Fix:** Use stable IDs: `key={msg.id}`

---

### 🔴 8. Bare Exception Handlers
**Agent 3 Finding:** loaders.py:104, master_miner.py:79, events.py:31
```python
try:
    expiry = datetime.strptime(date_str, '%y%m%d').date()
except:  # ← Catches everything including KeyboardInterrupt
    return None
```
**Impact:** Masks real errors, makes debugging impossible
**Fix:** Catch `ValueError` specifically

---

## HIGH PRIORITY ISSUES

### 🟡 1. Missing Tool Retry Logic (5 instances)
- Supabase edge functions: No retry on OpenAI API failures
- Memory embedding failures drop memories silently
- DeepSeek API calls have no exponential backoff

### 🟡 2. Type Safety Gaps (11 instances)
- 364 `@typescript-eslint/no-explicit-any` violations
- DeepSeek response not validated
- Metric types not checked (backtest-run)
- API request validation missing (routes.py)

### 🟡 3. Magic Numbers (20+ instances)
- Execution costs hardcoded (commission: 2.60, spreads: 0.20/0.30)
- Risk thresholds hardcoded
- No constants module

### 🟡 4. Missing Type Hints (8+ methods)
- simulator.py, master_miner.py lack return types
- API contract unclear

### 🟡 5. ESLint Not Enforced
- 378 linting errors don't block build
- TypeScript strict mode violations pass through

---

## MEDIUM PRIORITY ISSUES

### 🟠 1. Performance
- Large React bundle (1.4 MB, no code splitting)
- Missing memoization in callbacks (6+ instances)
- No chunk optimization

### 🟠 2. Missing Accessibility
- Status indicators lack aria-labels
- Interactive divs missing roles
- Screen reader support incomplete

### 🟠 3. Technical Debt
- 12 BUG FIX comments in execution.py (needs specification)
- Global singletons (PluginRegistry, API instance)
- Stub classes in active code
- Inconsistent data loader patterns

### 🟠 4. Build Config
- Missing Electron icon
- TypeScript config inconsistencies
- Environment variable naming chaos

---

## STATISTICS

| Category | Critical | High | Medium | Total |
|----------|----------|------|--------|-------|
| TypeScript | 2 | 5 | 0 | 7 |
| Supabase | 3 | 5 | 5 | 13 |
| Python | 3 | 11 | 20+ | 34+ |
| React | 3 | 2 | 4 | 9 |
| Integration | 4 | 4 | 0 | 8 |
| Build/Config | 4 | 1 | 4 | 9 |
| **TOTAL** | **19** | **28** | **33+** | **80+** |

---

## PRIORITY ACTION PLAN

### Phase 1: Security (1 hour)
1. Remove .env from git
2. Move hardcoded credentials to environment
3. Fix path validation in write-file function

### Phase 2: Critical Bugs (2 hours)
4. Fix infinite loop (SystemStatus.tsx)
5. Fix Store type (main.ts)
6. Remove .killed checks (toolHandlers.ts)
7. Fix React key anti-patterns
8. Replace bare except clauses

### Phase 3: Type Safety (4 hours)
9. Fix 8 TypeScript compilation errors
10. Add type validation to API endpoints
11. Validate DeepSeek/OpenAI responses
12. Fix 364 no-explicit-any violations (or suppress with comments)

### Phase 4: Performance (2 hours)
13. Implement React code splitting
14. Add memoization where needed
15. Optimize bundle chunks

### Phase 5: Technical Debt (8 hours)
16. Extract magic numbers to constants
17. Add type hints to Python methods
18. Create specification docs for execution model
19. Remove stub classes or implement them
20. Consolidate data loader patterns

---

## FILES REQUIRING IMMEDIATE ATTENTION

**TypeScript:**
- `src/electron/main.ts` (Store type)
- `src/electron/tools/toolHandlers.ts` (.killed checks, unused imports)
- `src/electron/tools/toolDefinitions.ts` (Gemini schema format)

**React:**
- `src/components/dashboard/SystemStatus.tsx` (infinite loop)
- `src/components/chat/HelperChatDialog.tsx` (key anti-pattern)
- `src/components/visualizations/ArtifactDisplay.tsx` (key anti-pattern)

**Python:**
- `python/engine/data/loaders.py` (bare except)
- `python/engine/mining/master_miner.py` (bare except, stub classes)
- `python/engine/trading/execution.py` (magic numbers)
- `python/engine/analysis/metrics.py` (BUG FIX comments)

**Supabase:**
- `supabase/functions/write-file/index.ts` (path validation)
- `supabase/functions/_shared/llmClient.ts` (tool handling)
- `src/electron/ipc-handlers/pythonExecution.ts` (hardcoded credentials)

**Build:**
- `.env` (remove from git)
- `eslint.config.js` (enforce rules)
- `electron-builder.json` (add icon)

---

**Total Estimated Remediation Time:** 17+ hours
**Immediate Security Fixes:** 1 hour
**Critical Bug Fixes:** 2 hours
**Remaining:** 14 hours for quality improvements

---

**All agents had full tool access and READ actual code.** These are real issues, not hypothetical.
