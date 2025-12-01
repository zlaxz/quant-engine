# Gemini ↔ Claude Code Handoff - Quick Fix Guide

**Estimated Time:** 2 hours
**Priority:** HIGH - Blocks production deployment

---

## Critical Issue 1: Data-Driven Directives Not Parsing

**Symptom:** Charts, tables, and metrics from Claude Code don't display in UI

**Root Cause:** ChatArea.tsx tries to parse directives from `d.raw` which doesn't exist

**File:** `src/components/chat/ChatArea.tsx` line 317

### Fix Step 1: Update IPC Emission

**File:** `src/electron/tools/toolHandlers.ts` line 2721

**Current code:**
```typescript
mainWindow.webContents.send('claude-code-directives', {
  directives,
  source: 'claude-code',
  timestamp: Date.now()
});
```

**Fixed code:**
```typescript
mainWindow.webContents.send('claude-code-directives', {
  directives,
  rawOutput: result.stdout, // ⬅️ ADD THIS
  source: 'claude-code',
  timestamp: Date.now()
});
```

### Fix Step 2: Update Frontend Parser

**File:** `src/components/chat/ChatArea.tsx` line 317

**Current code:**
```typescript
const fullOutput = event.directives.map((d: any) => d.raw || '').join('\n');
```

**Fixed code:**
```typescript
const fullOutput = (event as any).rawOutput || '';
```

### Fix Step 3: Update TypeScript Types

**File:** `src/types/electron.d.ts` (find the onClaudeCodeDirectives definition)

**Add rawOutput to event type:**
```typescript
onClaudeCodeDirectives: (callback: (event: {
  directives: any[];
  rawOutput: string; // ⬅️ ADD THIS
  source: string;
  timestamp: number;
}) => void) => () => void;
```

### Test Fix

```
User: "Use Claude Code to show a test chart"

Claude Code outputs:
[DISPLAY_CHART: {"type": "line", "title": "Test", "data": {"series": [{"name": "Series1", "values": [[1,100],[2,200],[3,150]]}]}}]

Expected: Chart displays in UI
```

---

## Critical Issue 2: Missing DeepSeek Agent Script

**Symptom:** Massive parallelization fails with FileNotFoundError

**Root Cause:** Prompt references `python/scripts/deepseek_agent.py` which doesn't exist

### Solution Option A: Create Stub Script (RECOMMENDED)

**File:** `python/scripts/deepseek_agent.py`

```python
#!/usr/bin/env python3
"""
DeepSeek Agent - Lightweight agent spawner for cost-efficient parallel compute
Used by Claude Code when parallel_hint="massive"

Usage:
  python3 deepseek_agent.py "<task>" "<agent_type>" "<context>"

Agent Types:
  - analyst: Data analysis and pattern recognition
  - reviewer: Code review and quality checks
  - researcher: Research and documentation
  - coder: Code generation and modification
"""

import sys
import os
import json
from datetime import datetime

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 deepseek_agent.py '<task>' '<agent_type>' ['<context>']", file=sys.stderr)
        sys.exit(1)

    task = sys.argv[1]
    agent_type = sys.argv[2]
    context = sys.argv[3] if len(sys.argv) > 3 else ""

    # Validate agent type
    valid_types = ["analyst", "reviewer", "researcher", "coder"]
    if agent_type not in valid_types:
        print(f"Invalid agent type: {agent_type}. Must be one of: {', '.join(valid_types)}", file=sys.stderr)
        sys.exit(1)

    print(f"[DeepSeek Agent] Type: {agent_type}", file=sys.stderr)
    print(f"[DeepSeek Agent] Task: {task}", file=sys.stderr)
    print(f"[DeepSeek Agent] Started at: {datetime.now().isoformat()}", file=sys.stderr)

    # TODO: Actual DeepSeek API integration
    # For now, return a stub response indicating the agent ran
    result = {
        "agent_type": agent_type,
        "task": task,
        "status": "completed",
        "output": f"[STUB] {agent_type.title()} agent would process: {task}",
        "timestamp": datetime.now().isoformat(),
        "context_used": bool(context)
    }

    # Output JSON result to stdout
    print(json.dumps(result, indent=2))
    print(f"[DeepSeek Agent] Completed at: {datetime.now().isoformat()}", file=sys.stderr)
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

**Create the file:**
```bash
cd /Users/zstoc/GitHub/quant-engine
mkdir -p python/scripts
cat > python/scripts/deepseek_agent.py << 'EOF'
[paste code above]
EOF
chmod +x python/scripts/deepseek_agent.py
```

**Test it:**
```bash
python3 python/scripts/deepseek_agent.py "Test task" "analyst" "Some context"
```

### Solution Option B: Remove Feature (TEMPORARY)

If you don't need massive parallelization yet, remove references:

**File:** `src/electron/tools/toolDefinitions.ts` lines 674-676

**Remove these lines:**
```typescript
• MASSIVE parallel compute: Claude spawns DeepSeek agents via curl (cost-efficient at scale)
  Examples of massive: analyze all 6 regimes simultaneously, 50+ parameter sweeps, bulk data processing
```

**File:** `src/electron/tools/toolHandlers.ts` lines 2563-2571

**Remove this block:**
```typescript
if (parallelHint === 'massive') {
  prompt += `
## Parallel Execution (MASSIVE scale indicated)
For this task, use DeepSeek agents for cost-efficient parallel processing.
Script: python3 scripts/deepseek_agent.py "<task>" "<agent_type>" "<context>"
Agent types: analyst, reviewer, researcher, coder
Spawn multiple agents in parallel when tasks are independent.
Example: python3 scripts/deepseek_agent.py "Analyze regime 3" "analyst" &
`;
```

---

## Medium Priority: Output Size Limits

**Symptom:** Large outputs (100MB+) cause JSON parsing failures

**Root Cause:** No size limits on stdout before JSON serialization

**File:** `src/electron/tools/toolHandlers.ts` before line 2734

### Fix: Add Truncation

**Insert before line 2734 (`const structuredResponse = {`):**

```typescript
// Truncate large outputs to prevent JSON parsing issues
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB
let truncatedStdout = result.stdout;
let wasTruncated = false;

if (truncatedStdout.length > MAX_OUTPUT_SIZE) {
  const originalSize = truncatedStdout.length;
  truncatedStdout = truncatedStdout.slice(0, MAX_OUTPUT_SIZE);
  truncatedStdout += `\n\n[... OUTPUT TRUNCATED - Original size: ${(originalSize / 1024 / 1024).toFixed(2)}MB, showing first ${(MAX_OUTPUT_SIZE / 1024 / 1024).toFixed(2)}MB]`;
  wasTruncated = true;
  safeLog(`⚠️  Output truncated from ${originalSize} to ${MAX_OUTPUT_SIZE} bytes`);
}
```

**Update line 2739 to use truncatedStdout:**

```typescript
stdout: truncatedStdout, // ⬅️ Changed from result.stdout
```

**Add truncation flag to metadata:**

```typescript
metadata: {
  hasContext: !!context,
  parallelHint: parallelHint || 'none',
  taskLength: task.length,
  contextLength: context?.length || 0,
  directiveCount: directives.length,
  wasTruncated // ⬅️ ADD THIS
}
```

---

## Medium Priority: Directive Validation

**Symptom:** Malformed directives could crash renderer

**Root Cause:** No validation before UI emission

**File:** `src/electron/tools/toolHandlers.ts` after line 2711

### Fix: Add Validation

**Replace lines 2711-2730 with:**

```typescript
// ====== PARSE AND VALIDATE DIRECTIVES ======
const { parseDisplayDirectives } = await import('../../lib/displayDirectiveParser');
const directives = parseDisplayDirectives(result.stdout);

if (directives.length > 0) {
  safeLog(`📊 Found ${directives.length} UI directives in Claude Code output`);

  // VALIDATE each directive before emitting
  const validDirectives = directives.filter(d => {
    // Must have type
    if (!d.type) {
      safeLog(`⚠️  Skipping invalid directive (no type): ${JSON.stringify(d).slice(0, 100)}`);
      return false;
    }

    // Type-specific validation
    if (d.type === 'display' && !d.value) {
      safeLog(`⚠️  Skipping display directive without value`);
      return false;
    }

    if (d.type === 'todo_add' && (!d.value || !d.params?.description)) {
      safeLog(`⚠️  Skipping todo_add directive without category or description`);
      return false;
    }

    return true;
  });

  const invalidCount = directives.length - validDirectives.length;
  if (invalidCount > 0) {
    safeLog(`⚠️  Filtered out ${invalidCount} invalid directive${invalidCount > 1 ? 's' : ''}`);
  }

  // Emit only valid directives to renderer for real-time UI updates
  if (validDirectives.length > 0) {
    const windows = BrowserWindow.getAllWindows();
    const mainWindow = windows.find(w => !w.isDestroyed());
    if (mainWindow?.webContents) {
      try {
        mainWindow.webContents.send('claude-code-directives', {
          directives: validDirectives, // ⬅️ Use validDirectives
          rawOutput: result.stdout,
          source: 'claude-code',
          timestamp: Date.now()
        });
        safeLog(`✅ Emitted ${validDirectives.length} valid directives to UI`);
      } catch (error) {
        safeLog(`⚠️  Failed to emit directives:`, error);
      }
    }
  }
}
```

---

## Build & Test

After applying fixes:

```bash
cd /Users/zstoc/GitHub/quant-engine

# 1. Build TypeScript
npm run build

# 2. Build Electron
npm run electron:build

# 3. Run in dev mode
npm run electron:dev

# 4. Run test suite
npm run test:integration:handoff
```

---

## Verification Checklist

After applying ALL fixes:

- [ ] **Fix 1 Applied:** rawOutput added to IPC emission
- [ ] **Fix 1 Applied:** ChatArea.tsx uses rawOutput
- [ ] **Fix 1 Applied:** TypeScript types updated
- [ ] **Fix 2 Applied:** deepseek_agent.py created OR feature removed
- [ ] **Fix 3 Applied:** Output size limits added
- [ ] **Fix 4 Applied:** Directive validation added
- [ ] **Build Succeeds:** No TypeScript errors
- [ ] **Test 4 Passes:** Data-driven directives display
- [ ] **Test 8 Passes:** Massive parallel doesn't crash
- [ ] **Test 9 Passes:** Large outputs handled

---

## Rollback Plan

If fixes cause issues:

```bash
# Rollback to pre-fix state
cd /Users/zstoc/GitHub/quant-engine
git diff HEAD src/electron/tools/toolHandlers.ts
git diff HEAD src/components/chat/ChatArea.tsx
git diff HEAD src/types/electron.d.ts

# Revert specific file
git checkout HEAD -- src/electron/tools/toolHandlers.ts
```

---

## Post-Fix Documentation

Update these files after fixes are tested:

1. **CHANGELOG.md** - Add fix notes
2. **README.md** - Update integration status
3. **HANDOFF_TEST_CHECKLIST.md** - Mark tests as passing

---

## Support

If issues arise:

1. Check console for errors
2. Run test suite: `npm run test:integration:handoff`
3. Review audit: `.claude/docs/GEMINI_CLAUDE_HANDOFF_AUDIT.md`
4. Contact: [your-team-channel]

---

**Quick Fix Summary:**

| Issue | File | Lines | Time | Priority |
|-------|------|-------|------|----------|
| Data-driven directives | toolHandlers.ts | 2721 | 15 min | 🔴 CRITICAL |
| Data-driven directives | ChatArea.tsx | 317 | 5 min | 🔴 CRITICAL |
| Data-driven directives | electron.d.ts | Find onClaudeCodeDirectives | 5 min | 🔴 CRITICAL |
| DeepSeek script | python/scripts/deepseek_agent.py | New file | 30 min | 🔴 CRITICAL |
| Output size limits | toolHandlers.ts | Before 2734 | 20 min | 🟡 MEDIUM |
| Directive validation | toolHandlers.ts | After 2711 | 30 min | 🟡 MEDIUM |

**Total Estimated Time:** 1 hour 45 minutes

---

**STATUS:** Ready to implement ✅
