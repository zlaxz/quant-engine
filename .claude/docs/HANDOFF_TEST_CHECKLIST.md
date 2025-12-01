# Gemini ↔ Claude Code Handoff Test Checklist

Quick reference for testing the integration after fixes are applied.

---

## Pre-Test Setup

```bash
# 1. Verify clauded alias exists
which clauded
# Should output: clauded: aliased to claude --dangerously-skip-permissions

# 2. Check working directory
cd /Users/zstoc/GitHub/quant-engine
ls -la .git package.json python/
# All should exist

# 3. Verify API keys configured
# Open Quant Engine → Settings → verify Gemini API key present
```

---

## Test 1: Simple File Read

**Goal:** Verify basic handoff works

```
User Input: "Use Claude Code to read python/server.py and tell me what it does"

Expected Flow:
1. Gemini decides to use execute_via_claude_code
2. Claude Code opens in Terminal
3. Claude Code reads the file
4. Result returns to Gemini
5. Gemini synthesizes summary

✅ PASS Criteria:
- Terminal window opens with Claude Code
- File content is read successfully
- Gemini provides accurate summary
- No errors in console

❌ FAIL if:
- Tool call times out
- Gemini says "I cannot read files"
- Error: "clauded alias not configured"
```

---

## Test 2: Multi-Step Execution

**Goal:** Verify Claude Code can handle complex tasks

```
User Input: "Use Claude Code to run git status, then git diff, then summarize changes"

Expected Flow:
1. Gemini calls execute_via_claude_code with multi-step task
2. Claude Code executes all 3 steps sequentially
3. Returns combined output
4. Gemini synthesizes results

✅ PASS Criteria:
- All 3 commands execute
- Output includes git status AND diff
- Gemini provides coherent summary of changes
- Tool progress shows in UI

❌ FAIL if:
- Only first step executes
- Partial results returned
- Claude Code says "I don't have access to git"
```

---

## Test 3: UI Directives (Old-Style)

**Goal:** Verify old-style directives work

```
User Input: "Use Claude Code to show me a test metric"

Claude Code should output:
[TODO_ADD:Testing:This is a test task]

Expected Flow:
1. Claude Code outputs directive in text
2. parseDisplayDirectives() extracts it
3. IPC event emitted to renderer
4. ChatArea processes directive
5. Research Journey panel updates

✅ PASS Criteria:
- New task appears in Research Journey panel
- Task shows "This is a test task"
- Category is "Testing"
- No console errors

❌ FAIL if:
- Task doesn't appear
- Directive visible in chat text
- Console error: "Cannot read property 'type'"
```

---

## Test 4: Data-Driven Directives (Charts) 🔴 CURRENTLY BROKEN

**Goal:** Verify data-driven directives work (after fix)

```
User Input: "Use Claude Code to show a test chart"

Claude Code should output:
[DISPLAY_CHART: {"type": "line", "title": "Test", "data": {"series": [{"name": "Test", "values": [[1,100],[2,200],[3,150]]}]}}]

Expected Flow:
1. Claude Code outputs chart directive
2. toolHandlers.ts line 2711 parses directives
3. IPC emits with rawOutput included (AFTER FIX)
4. ChatArea.tsx parses from rawOutput (AFTER FIX)
5. Chart displays in UI

✅ PASS Criteria (AFTER FIX):
- Chart appears in Research Journey panel
- Shows line chart with 3 data points
- Title is "Test"
- No console errors

❌ CURRENTLY FAILS:
- Chart doesn't appear
- Console: fullOutput is empty string
- Reason: directives.map(d => d.raw) fails because d.raw undefined
```

**Fix Required Before Test:**
```typescript
// In toolHandlers.ts line 2721:
mainWindow.webContents.send('claude-code-directives', {
  directives,
  rawOutput: result.stdout, // ⬅️ ADD THIS LINE
  source: 'claude-code',
  timestamp: Date.now()
});

// In ChatArea.tsx line 317:
const fullOutput = (event as any).rawOutput || ''; // ⬅️ CHANGE THIS LINE
```

---

## Test 5: Context Preservation

**Goal:** Verify Gemini's reasoning reaches Claude Code

```
User Input: "Based on our earlier discussion about SPY options, use Claude Code to create a test strategy file"

Expected Flow:
1. Gemini passes context parameter with summary of earlier discussion
2. Claude Code receives context in prompt
3. Claude Code creates file reflecting that context
4. Result shows understanding of prior conversation

✅ PASS Criteria:
- File created mentions SPY options
- Strategy aligns with earlier discussion
- Claude Code didn't ask for context it should have

❌ FAIL if:
- File is generic, doesn't reference SPY
- Claude Code asks "What options were we discussing?"
- Context parameter empty in tool call
```

---

## Test 6: Error Handling

**Goal:** Verify graceful failures

```
User Input: "Use Claude Code to run a command that will fail: ls /nonexistent"

Expected Flow:
1. Claude Code executes command
2. Command fails with exit code 1
3. stderr captured
4. Structured response returned with status: "failure"
5. Gemini explains the error clearly

✅ PASS Criteria:
- Error message is clear and helpful
- stderr content included in response
- Gemini doesn't say "Unknown error"
- Circuit breaker NOT triggered (single failure)

❌ FAIL if:
- Generic error message
- No stderr content shown
- Circuit breaker opens after 1 failure
```

---

## Test 7: Circuit Breaker

**Goal:** Verify protection against cascade failures

```
Test Sequence:
1. Force 3 failures in a row (e.g., invalid commands)
2. Attempt a valid command
3. Wait 5 minutes
4. Retry valid command

Expected Flow:
Failure 1: Circuit breaker records (count: 1)
Failure 2: Circuit breaker records (count: 2)
Failure 3: Circuit breaker records (count: 3, OPENS)
Valid command: ❌ BLOCKED - "Circuit breaker is OPEN"
After 5 min: ✅ EXECUTES - Circuit reset

✅ PASS Criteria:
- After 3 failures, circuit opens
- Error message shows "Will reset in Xs"
- After timeout, circuit resets automatically
- Next success resets failure count

❌ FAIL if:
- Circuit never opens
- Timer doesn't countdown
- Circuit doesn't reset after timeout
```

---

## Test 8: Massive Parallelization 🔴 CURRENTLY BROKEN

**Goal:** Verify DeepSeek agent spawning (after fix)

```
User Input: "Analyze all 6 market regimes in parallel using Claude Code"

Expected Flow:
1. Gemini calls execute_via_claude_code with parallel_hint="massive"
2. Claude Code sees hint in prompt
3. Claude Code tries to spawn DeepSeek agents
4. Agents execute in parallel
5. Results aggregated and returned

✅ PASS Criteria (AFTER FIX):
- Multiple agent processes spawn
- Each analyzes different regime
- Results from all 6 regimes returned
- Execution faster than sequential

❌ CURRENTLY FAILS:
- FileNotFoundError: scripts/deepseek_agent.py
- Task fails immediately
- Only 1 regime analyzed (Claude Code falls back to sequential)
```

**Fix Required Before Test:**

**Option A: Implement script**
```bash
# Create python/scripts/deepseek_agent.py
mkdir -p python/scripts
touch python/scripts/deepseek_agent.py
chmod +x python/scripts/deepseek_agent.py
```

**Option B: Remove feature**
```typescript
// In toolDefinitions.ts, remove references to:
// - "MASSIVE parallel compute"
// - DeepSeek agent spawning
// - parallel_hint parameter
```

---

## Test 9: Large Output Handling

**Goal:** Verify large outputs don't break JSON parsing

```
User Input: "Use Claude Code to generate a 50MB file and return its contents"

Expected Flow:
1. Claude Code generates large file
2. Output exceeds reasonable size
3. Handler truncates output (AFTER FIX)
4. Gemini receives truncated version
5. Message indicates truncation

✅ PASS Criteria (AFTER FIX):
- Tool call completes without crash
- Output is truncated with notice
- JSON parsing succeeds
- User sees: "[... OUTPUT TRUNCATED ...]"

❌ CURRENTLY FAILS:
- Tool call hangs or crashes
- Error: "Invalid JSON" in Gemini handler
- UI freezes trying to render huge output
```

**Fix Required Before Test:**
```typescript
// In toolHandlers.ts before line 2734:
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB
let truncatedStdout = result.stdout;
if (truncatedStdout.length > MAX_OUTPUT_SIZE) {
  truncatedStdout = truncatedStdout.slice(0, MAX_OUTPUT_SIZE) +
    `\n\n[... OUTPUT TRUNCATED - ${result.stdout.length} bytes total]`;
}
```

---

## Test 10: Directive Stripping

**Goal:** Verify directives don't pollute chat

```
User Input: "Use Claude Code to create a todo and show a chart"

Claude Code outputs:
[TODO_ADD:Testing:New task]
[DISPLAY_CHART: {...}]
Here's your chart showing test data.

Expected Flow:
1. Directives parsed
2. UI updated (task added, chart shown)
3. Directives stripped from text
4. Only clean text displayed in chat

✅ PASS Criteria:
- Chat shows: "Here's your chart showing test data."
- Directives NOT visible in message text
- Task appears in Research Journey
- Chart appears in visualization panel

❌ FAIL if:
- Directives visible in chat text
- Text shows: "[TODO_ADD:Testing:New task]..."
- stripDisplayDirectives() not called
```

---

## Regression Test Suite

After fixes, run ALL 10 tests in sequence:

```bash
# Run regression suite
npm run test:integration:handoff

# Or manually:
# 1. Test 1: Simple file read
# 2. Test 2: Multi-step
# 3. Test 3: Old-style directives
# 4. Test 4: Data-driven directives ⬅️ AFTER FIX
# 5. Test 5: Context preservation
# 6. Test 6: Error handling
# 7. Test 7: Circuit breaker
# 8. Test 8: Massive parallel ⬅️ AFTER FIX
# 9. Test 9: Large output ⬅️ AFTER FIX
# 10. Test 10: Directive stripping
```

**Target:** 10/10 PASS ✅

---

## Known Issues Requiring Fixes

1. 🔴 **Test 4 FAILS:** Data-driven directives not parsed (rawOutput missing)
2. 🔴 **Test 8 FAILS:** DeepSeek agent script doesn't exist
3. 🔴 **Test 9 FAILS:** No output size limits

**Estimated fix time:** 2-3 hours

---

## Success Criteria

**Before Deployment:**
- [ ] All 10 tests pass
- [ ] No console errors during execution
- [ ] UI responsive during long operations
- [ ] Circuit breaker works as expected
- [ ] Directives display correctly in UI
- [ ] Large outputs handled gracefully

**Sign-off:** _______________ Date: _______________
