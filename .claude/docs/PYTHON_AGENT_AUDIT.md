# Python Agent Integration Audit Report

**Date:** 2025-11-28
**Auditor:** Claude Code
**Component:** `spawnAgent()` function in `src/electron/tools/toolHandlers.ts`
**Status:** CRITICAL ISSUES FOUND

---

## Executive Summary

The Python agent integration has **5 critical issues** that will cause failures or security vulnerabilities:

| Issue | Severity | Impact | Fixable |
|-------|----------|--------|---------|
| Command injection via backticks | CRITICAL | Arbitrary code execution | Yes |
| Newline handling in task strings | CRITICAL | Command breaks with newlines | Yes |
| Shell metacharacter escaping incomplete | HIGH | Partial injection possible | Yes |
| No stderr capture | HIGH | Silent failures possible | Yes |
| Production path resolution uncertain | HIGH | May fail in packaged build | Maybe |

---

## Detailed Findings

### 1. CRITICAL: Command Injection Vulnerability (Backticks)

**Location:** `src/electron/tools/toolHandlers.ts`, line 1556

**Current Code:**
```typescript
const result = execSync(`python3 "${scriptPath}" "${task.replace(/"/g, '\\"')}" "${agentType}"${context ? ` "${context.replace(/"/g, '\\"')}"` : ''}`, {
```

**Vulnerability:**
The escaping only handles double quotes (`"`). Backticks (`` ` ``) are NOT escaped and will be executed by the shell.

**Test Proof:**
```javascript
const task = 'analyze `echo INJECTION > /tmp/pwned.txt` code';
const escaped = task.replace(/"/g, '\\"');
const cmd = `python3 "/path/script.py" "${escaped}" "analyst"`;
// Shell executes: python3 "/path/script.py" "analyze `echo INJECTION > /tmp/pwned.txt` code" "analyst"
// The backticks ARE EXECUTED, creating /tmp/pwned.txt
```

**Attack Vector:**
A user providing a task like:
```
analyze this code: `rm -rf /important/files`
```
Would result in command execution.

**Status:** ✗ NOT MITIGATED

---

### 2. CRITICAL: Newline Handling Breaks Command

**Location:** `src/electron/tools/toolHandlers.ts`, line 1556

**Vulnerability:**
The task string can contain literal newlines, which break the shell command structure.

**Example Failure:**
```javascript
const task = 'analyze code\nwith newline';
const cmd = `python3 "${scriptPath}" "${task}" "analyst"`;
// Results in: python3 "/path/script.py" "analyze code
// with newline" "analyst"
// Shell interprets this as TWO commands
```

**Status:** ✗ NOT MITIGATED

---

### 3. HIGH: Incomplete Shell Metacharacter Escaping

**Location:** `src/electron/tools/toolHandlers.ts`, line 1556

**Vulnerabilities:**
These shell metacharacters are NOT escaped:
- `` ` `` - Backticks (command substitution)
- `$` - Dollar signs (variable expansion)
- `!` - History expansion (in interactive shells)
- `\` - Backslash (escape character)

**Test Results:**
```
Backticks: INJECTION SUCCESSFUL ✗
$ expansion: NOT ESCAPED ✗
History expansion: NOT ESCAPED ✗
```

**Status:** ✗ NOT MITIGATED

---

### 4. HIGH: No stderr Capture

**Location:** `src/electron/tools/toolHandlers.ts`, line 1556

**Current Code:**
```typescript
const result = execSync(`...`, {
  encoding: 'utf-8',
  timeout: 120000,
  env: { ...process.env },
  maxBuffer: 10 * 1024 * 1024,
  // NO stdio option
});
```

**Problem:**
- Python script writes debug info to stderr: `print(..., file=sys.stderr)`
- The stderr is NOT captured or logged
- If Python script fails silently, we only get stdout (which might be empty)
- Error messages from Python are lost

**Impact:**
- Debugging is nearly impossible
- Failures appear as "empty output" rather than showing actual errors

**Status:** ✗ NOT MITIGATED

---

### 5. HIGH: Production Path Resolution Uncertain

**Location:** `src/electron/tools/toolHandlers.ts`, lines 1538-1541

**Current Code:**
```typescript
const { app } = require('electron');
const isDev = process.env.NODE_ENV === 'development';
const projectRoot = isDev ? process.cwd() : path.join(app.getPath('userData'), '..', '..', '..');
const scriptPath = path.join(projectRoot, 'scripts', 'deepseek_agent.py');
```

**Issues:**

1. **Development Mode:** `process.cwd()` works fine
   - Test: ✓ PASSES
   - Path: `/Users/zstoc/GitHub/quant-chat-scaffold`

2. **Production Mode:** Path calculation is uncertain
   - Uses: `app.getPath('userData')/../../../`
   - Expected userData: `/Users/zstoc/Library/Application Support/quant-chat`
   - Calculated path: `/Users/zstoc/Library/Application Support/` (scripts not here)
   - **Script would NOT be found in production**

3. **In electron-builder packaging:**
   - The `scripts/` directory may not be included in the app bundle
   - Would need `asar` extraction or different path strategy

**Status:** ✓ WORKS IN DEV, ✗ UNCERTAIN IN PRODUCTION

---

## Test Results

### Python Script Validation
```
File exists:        ✓ YES
Syntax check:       ✓ PASS (no syntax errors)
Import validation:  ✓ PASS (all imports work)
Executable:         ✓ YES (-rwx--x--x)
Python available:   ✓ YES (/usr/bin/python3.14)
```

### deepseek_agent.py Review
**Status:** ✓ SCRIPT IS CORRECT

The Python script itself is well-written:
- Proper error handling for missing API key
- Timeout management (120s)
- Correct DeepSeek API call format
- stderr logging of progress
- Proper exit codes

**No issues found in the Python code.**

---

## Path Resolution Test Results

| Scenario | Path Calculated | Script Found | Status |
|----------|-----------------|--------------|--------|
| Dev mode | `/Users/zstoc/GitHub/quant-chat-scaffold` | ✓ YES | ✓ WORKS |
| Prod mode (simulated) | `/` (path goes too far up) | ✗ NO | ✗ FAILS |

---

## Environment Variable Handling

**Good News:**
```typescript
env: { ...process.env }  // Line 1559
```

✓ DEEPSEEK_API_KEY IS correctly passed through to Python
✓ All other env vars are inherited
✓ No isolation issues

**Status:** ✓ CORRECT

---

## Error Handling Analysis

**Current Error Handling:**
```typescript
try {
  const result = execSync(...);
  return { success: true, content: result };
} catch (error: any) {
  return {
    success: false,
    content: '',
    error: `Python agent failed: ${error.message}`
  };
}
```

**Deficiencies:**
1. Only captures `error.message` - not stderr
2. If stdout is empty, returned content is empty even if stderr has errors
3. No distinction between timeout, non-zero exit, and other errors
4. Python's debug output (in stderr) is completely lost

**Impact:** Debugging failures is very difficult

---

## Comparison: execSync vs spawn

**Current approach:** `execSync` with string command
**Issues:** Shell string injection vulnerabilities

**Better approach:** `spawn` with array arguments
```typescript
// SAFER:
const result = spawnSync('python3', [scriptPath, task, agentType, context], {
  encoding: 'utf-8',
  timeout: 120000,
  maxBuffer: 10 * 1024 * 1024,
  stdio: ['pipe', 'pipe', 'pipe'] // Capture stderr
});
```

**Advantages:**
- No shell string injection (arguments are directly passed)
- Arguments don't go through shell parsing
- Can capture stderr separately
- Handles newlines, special chars automatically

**Status:** `execSync` can work but requires proper escaping. `spawn` is safer.

---

## Summary of Issues

### Must Fix (CRITICAL)
- [ ] Command injection via backticks - escaping insufficient
- [ ] Newline handling breaks command
- [ ] Shell metacharacter escaping incomplete

### Should Fix (HIGH)
- [ ] Capture and log stderr from Python script
- [ ] Verify production path resolution works
- [ ] Consider using `spawn` instead of `execSync`

### Information Only (MEDIUM)
- [ ] Error messages could be more granular
- [ ] No timeout detection (will show generic error)

---

## Recommended Fixes (Priority Order)

### Fix 1: Use spawn() instead of execSync() [HIGHEST PRIORITY]
```typescript
import { spawnSync } from 'child_process';

const result = spawnSync('python3', [scriptPath, task, agentType, context].filter(Boolean), {
  encoding: 'utf-8',
  timeout: 120000,
  maxBuffer: 10 * 1024 * 1024,
  stdio: ['pipe', 'pipe', 'pipe']
});

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Python script exited with code ${result.status}: ${result.stderr}`);
}

return {
  success: true,
  content: result.stdout
};
```

**Why:** Eliminates ALL shell injection vulnerabilities, handles newlines, captures stderr

### Fix 2: Verify Production Path Resolution
```typescript
// Test the production path calculation
const scriptPath = isDev ?
  process.cwd() :
  path.join(app.getPath('userData'), '..', '..', 'scripts', 'deepseek_agent.py');

if (!fs.existsSync(scriptPath)) {
  throw new Error(`Python script not found at: ${scriptPath}`);
}
```

**Why:** Prevents silent failures in production

### Fix 3: Add stderr logging
```typescript
if (result.stderr) {
  safeLog('🐍 Python stderr:', result.stderr);
}
```

**Why:** Makes debugging failures possible

---

## Testing Checklist

After fixes are applied, test:

- [ ] Task with simple text: "analyze this code"
- [ ] Task with quotes: "analyze 'quoted' text"
- [ ] Task with newlines: "analyze this\ncode"
- [ ] Task with backticks: "analyze `code` here"
- [ ] Task with $ signs: "analyze $VAR here"
- [ ] Empty task: ""
- [ ] Very long task: 10000+ character string
- [ ] With context parameter: context string with special chars
- [ ] Without API key set: should fail gracefully
- [ ] With API key set: should call DeepSeek successfully
- [ ] Timeout scenario: script takes >120s (if possible to test)

---

## Files Affected

**Primary:**
- `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/tools/toolHandlers.ts` (lines 1519-1581)

**Related:**
- `/Users/zstoc/GitHub/quant-chat-scaffold/scripts/deepseek_agent.py` (no issues found)
- `/Users/zstoc/GitHub/quant-chat-scaffold/src/electron/ipc-handlers/llmClient.ts` (calls spawnAgent, no direct issues)

---

## Conclusion

**The Python script itself is CORRECT.** The vulnerability is entirely in how `toolHandlers.ts` invokes it via shell.

The `spawnAgent()` function needs **immediate fixes** to:
1. Eliminate command injection vulnerabilities
2. Properly handle newlines in input
3. Capture and surface error information

**Recommend refactoring from `execSync()` to `spawn()` to fix all issues at once.**

