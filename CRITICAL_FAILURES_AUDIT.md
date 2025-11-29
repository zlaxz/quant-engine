# Critical System Failures Audit
**Date:** 2025-01-29  
**Context:** Comprehensive system audit after discovering Python execution was completely non-functional

---

## 🔴 CRITICAL FAILURE #1: Missing Backtest Entry Point

**File:** `rotation-engine-bridge/cli_wrapper.py`  
**Status:** **DOES NOT EXIST**  
**Impact:** BLOCKS ALL BACKTESTING

### What's Broken
The `run-backtest` IPC handler in `pythonExecution.ts:25-32` references:
```typescript
const cmd = [
  'python3',
  'rotation-engine-bridge/cli_wrapper.py',  // ❌ THIS FILE DOES NOT EXIST
  '--profile', params.strategyKey,
  // ...
];
```

### Why This Is Catastrophic
- **Backtesting is the core feature** of this entire system
- Every backtest call will fail immediately with "file not found"
- User cannot actually use the system for its intended purpose
- The entire UI for running backtests is a facade

### Fix Required
Create `rotation-engine-bridge/cli_wrapper.py` that:
1. Accepts CLI arguments (--profile, --start, --end, --capital, --config)
2. Calls the actual rotation-engine backtest API
3. Returns structured JSON output with:
   - `runId`
   - `metrics` (sharpe, cagr, max_dd, win_rate, etc.)
   - `equity_curve` (array of {date, equity})
   - `trades` (array of trade objects)
   - `regime_context` (optional)

**Suggested Implementation:**
```python
#!/usr/bin/env python3
"""
CLI Wrapper for Rotation Engine Backtests
Bridges Electron app ↔ rotation-engine Python code
"""
import sys
import json
import argparse
from datetime import datetime

# Import your actual rotation engine
# from rotation_engine.backtest import run_backtest
# from rotation_engine.profiles import load_profile

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', required=True)
    parser.add_argument('--start', required=True)
    parser.add_argument('--end', required=True)
    parser.add_argument('--capital', type=float, default=100000)
    parser.add_argument('--config', type=str, default=None)
    
    args = parser.parse_args()
    
    # TODO: Replace with your actual backtest logic
    # results = run_backtest(
    #     profile=args.profile,
    #     start_date=args.start,
    #     end_date=args.end,
    #     capital=args.capital,
    #     config=json.loads(args.config) if args.config else None
    # )
    
    # For now, stub response
    run_id = f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    output = {
        "runId": run_id,
        "metrics": {
            "sharpe": 0.0,
            "cagr": 0.0,
            "max_drawdown": 0.0,
            "win_rate": 0.0,
            "total_trades": 0
        },
        "equity_curve": [],
        "trades": []
    }
    
    print(json.dumps(output))
    return 0

if __name__ == '__main__':
    sys.exit(main())
```

---

## 🔴 CRITICAL FAILURE #2: No Python Environment Validation

**Status:** MISSING  
**Impact:** SILENT FAILURES

### What's Broken
The system never checks if:
- Python3 is installed
- Required Python packages are installed (see `requirements.txt`)
- The rotation-engine directory structure is valid
- The rotation-engine has the expected API

### Why This Is Catastrophic
- User installs app, tries to run backtest → cryptic subprocess error
- No clear error message explaining what's wrong
- User has no guidance on how to set up Python environment
- Debugging requires reading Electron console logs

### Fix Required
Add startup validation in `src/electron/main.ts` after line 80:

```typescript
async function validatePythonEnvironment() {
  const engineRoot = process.env.ROTATION_ENGINE_ROOT;
  
  if (!engineRoot) {
    return {
      valid: false,
      error: 'ROTATION_ENGINE_ROOT not configured. Go to Settings → Project Directory.'
    };
  }
  
  // Check Python3 exists
  try {
    const { execSync } = await import('child_process');
    const pythonVersion = execSync('python3 --version', { encoding: 'utf8' });
    console.log(`[Validation] Python found: ${pythonVersion.trim()}`);
  } catch {
    return {
      valid: false,
      error: 'Python3 not found. Install Python 3.7+ from python.org'
    };
  }
  
  // Check rotation-engine directory
  if (!fs.existsSync(engineRoot)) {
    return {
      valid: false,
      error: `Rotation engine directory not found: ${engineRoot}`
    };
  }
  
  // Check cli_wrapper.py exists
  const cliWrapperPath = path.join(engineRoot, 'rotation-engine-bridge', 'cli_wrapper.py');
  if (!fs.existsSync(cliWrapperPath)) {
    return {
      valid: false,
      error: 'rotation-engine-bridge/cli_wrapper.py not found. See SETUP.md for installation.'
    };
  }
  
  // Check requirements.txt dependencies (optional but recommended)
  const requirementsPath = path.join(engineRoot, 'rotation-engine-bridge', 'requirements.txt');
  if (fs.existsSync(requirementsPath)) {
    try {
      execSync('python3 -m pip list', { encoding: 'utf8', cwd: engineRoot });
      console.log('[Validation] Python dependencies check passed');
    } catch (error) {
      console.warn('[Validation] Could not verify Python dependencies:', error);
    }
  }
  
  return { valid: true };
}

// Call during startup
const validation = await validatePythonEnvironment();
if (!validation.valid) {
  dialog.showErrorBox(
    'Python Environment Error',
    validation.error + '\n\nThe app will start but backtests will not work.'
  );
}
```

---

## 🔴 CRITICAL FAILURE #3: Tool Definition Mismatch

**Files:**
- `src/electron/tools/toolDefinitions.ts:115-138` (defines `run_python_script`)
- `src/electron/tools/toolHandlers.ts:1494-1496` (implements `run_python_script`)
- `src/electron/tools/toolHandlers.ts:2008-2009` (second implementation)

**Status:** PARAMETER NAME MISMATCH  
**Impact:** TOOL CALLS FAIL SILENTLY

### What's Broken

**Tool definition says:**
```typescript
parameters: {
  script_path: { type: SchemaType.STRING },  // ❌ snake_case
  args: { type: SchemaType.ARRAY },
  timeout: { type: SchemaType.NUMBER }
}
```

**Tool handler expects:**
```typescript
case 'run_python_script':
  result = await runPythonScript(
    args.script_path,  // ✅ Correct
    args.args,         // ✅ Correct
    args.timeout       // ✅ Correct
  );
```

**But runPythonScript function signature is:**
```typescript
export async function runPythonScript(
  scriptPath: string,    // ❌ camelCase
  args?: string[],
  timeoutSeconds?: number
): Promise<ToolResult>
```

### Why This Is Subtle But Deadly
- Gemini sends `{ script_path: "path.py" }`
- Handler receives it correctly
- Function call `runPythonScript(args.script_path)` works
- BUT internal logic might use wrong variable names
- Timeout might not work at all

### Fix Required
Standardize ALL parameter names to snake_case matching tool definitions:
```typescript
export async function runPythonScript(
  script_path: string,
  args?: string[],
  timeout?: number
): Promise<ToolResult>
```

---

## 🔴 CRITICAL FAILURE #4: Incomplete Setup Documentation

**Files:**
- `ELECTRON_SETUP.md` (outdated)
- `SETUP.md` (generic, no Python setup)
- No `QUICKSTART.md` for new users

**Status:** MISLEADING / INCOMPLETE  
**Impact:** USER CONFUSION, SETUP FAILURES

### What's Wrong

**ELECTRON_SETUP.md line 38-48:**
```typescript
// Edit pythonExecution.ts to match your CLI
const cmd = [
  'python3',
  'run_backtest.py',  // ❌ This file doesn't exist either
  // ...
];
```

**SETUP.md:**
- No mention of Python environment setup
- No mention of `rotation-engine-bridge` directory
- No mention of `requirements.txt` dependencies
- No validation that setup is correct

### Fix Required

Create **QUICKSTART.md**:

```markdown
# Quant Chat Workbench - Quick Start Guide

## Prerequisites

- Node.js 18+
- Python 3.7+
- Git (for rotation-engine integration)

## Installation (5 minutes)

### 1. Install Node Dependencies
\`\`\`bash
npm install
\`\`\`

### 2. Configure Environment
Create `.env` file:
\`\`\`bash
# Required: Your rotation-engine path
ROTATION_ENGINE_ROOT=/absolute/path/to/rotation-engine

# Required: LLM API Keys
GEMINI_API_KEY=your_gemini_key
OPENAI_API_KEY=your_openai_key
DEEPSEEK_API_KEY=your_deepseek_key

# Required: Supabase (provided)
VITE_SUPABASE_URL=https://ynaqtawyynqikfyranda.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
\`\`\`

### 3. Set Up Python Bridge
\`\`\`bash
cd rotation-engine-bridge
pip install -r requirements.txt
chmod +x cli_wrapper.py
\`\`\`

### 4. Verify Installation
\`\`\`bash
# Test Python
python3 --version  # Should show 3.7+

# Test rotation-engine access
ls $ROTATION_ENGINE_ROOT  # Should show your engine files

# Test CLI wrapper
python3 rotation-engine-bridge/cli_wrapper.py --help
\`\`\`

### 5. Start App
\`\`\`bash
npm run electron:dev
\`\`\`

## Troubleshooting

### "Python3 not found"
Install from python.org or:
\`\`\`bash
# macOS
brew install python@3

# Ubuntu
sudo apt install python3 python3-pip
\`\`\`

### "cli_wrapper.py not found"
Make sure you're in the rotation-engine directory when setting ROTATION_ENGINE_ROOT.

### "Module 'boto3' not found"
Install Python dependencies:
\`\`\`bash
cd rotation-engine-bridge
pip install -r requirements.txt
\`\`\`
```

---

## 🔴 CRITICAL FAILURE #5: Environment Variable Confusion

**Problem:** VITE_ Prefix Inconsistency  
**Impact:** ELECTRON PROCESS CANNOT ACCESS VARS

### What's Broken

**`.env.example` says:**
```bash
VITE_ROTATION_ENGINE_ROOT=/path/to/engine
VITE_PRIMARY_MODEL=gemini-3-pro-preview
VITE_SWARM_MODEL=deepseek-reasoner
```

**But Electron main process reads:**
```typescript
const root = process.env.ROTATION_ENGINE_ROOT;  // ❌ No VITE_ prefix
const model = process.env.PRIMARY_MODEL;        // ❌ No VITE_ prefix
```

**Why:** VITE_ prefix only works in browser/renderer process, NOT in Node.js main process.

### Fix Required

**Update `.env.example`:**
```bash
# For Electron Main Process (no VITE_ prefix)
ROTATION_ENGINE_ROOT=/Users/zstoc/rotation-engine
GEMINI_API_KEY=your_key
OPENAI_API_KEY=your_key
DEEPSEEK_API_KEY=your_key

# For Frontend/Renderer (VITE_ prefix)
VITE_SUPABASE_URL=https://...
VITE_SUPABASE_ANON_KEY=eyJ...
```

**Add to docs:**
> ⚠️ **Important:** Environment variables without `VITE_` prefix are for the Electron main process (backend). Variables with `VITE_` prefix are for the React frontend. Both are required.

---

## 🔴 CRITICAL FAILURE #6: No Data Persistence Validation

**Status:** DATABASE WRITES NEVER VERIFIED  
**Impact:** SILENT DATA LOSS

### What's Broken
After running a backtest:
1. Results saved to local JSON file ✅
2. Results supposedly saved to Supabase `backtest_runs` table ❓
3. **But there's no code that actually writes to Supabase**

**Evidence:**
`src/electron/ipc-handlers/pythonExecution.ts:79-98`
```typescript
// Save raw results to local file
const runId = results.runId || `run_${Date.now()}`;
const resultsPath = path.join(
  ROTATION_ENGINE_ROOT,
  'data',
  'backtest_results',
  'runs',
  `${runId}.json`
);

await fs.mkdir(path.dirname(resultsPath), { recursive: true });
await fs.writeFile(resultsPath, JSON.stringify(results, null, 2), 'utf-8');

return {
  success: true,
  metrics: results.metrics,
  equityCurve: results.equity_curve,
  trades: results.trades,
  rawResultsPath: resultsPath,
};
// ❌ NEVER WRITES TO SUPABASE DATABASE
```

### Why This Is Catastrophic
- Backtest results only exist in local JSON files
- They never appear in the UI's run history
- Memory system can't reference them
- Pattern detection can't analyze them
- Comparison tools can't compare them
- **The entire research workflow is broken**

### Fix Required
Add Supabase write after local file save:

```typescript
// Save to Supabase
const { data, error } = await supabase
  .from('backtest_runs')
  .insert({
    id: runId,
    strategy_key: params.strategyKey,
    params: {
      start_date: params.startDate,
      end_date: params.endDate,
      capital: params.capital,
      profile_config: params.profileConfig
    },
    metrics: results.metrics,
    equity_curve: results.equity_curve,
    status: 'completed',
    engine_source: 'rotation-engine',
    raw_results_url: resultsPath,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString()
  });

if (error) {
  console.error('[Backtest] Failed to save to database:', error);
  // Continue anyway - local file is saved
}
```

**CRITICAL:** Must import Supabase client in `pythonExecution.ts` first.

---

## 🔴 CRITICAL FAILURE #7: No Error Visibility

**Status:** ERRORS HIDDEN FROM USER  
**Impact:** DEBUGGING IMPOSSIBLE

### What's Broken
When things fail:
- Electron console shows errors → **User never sees them**
- IPC handlers catch and log errors → **User never sees them**
- Python subprocess fails → **User sees "Backtest failed"** (no details)
- Tool execution errors → **Chief Quant might hallucinate success**

**Example:**
```typescript
} catch (error) {
  console.error('Error running backtest:', error);  // ❌ Only in Electron console
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',  // ✅ But too generic
  };
}
```

### Fix Required

1. **Add error detail dialog:**
```typescript
import { dialog } from 'electron';

} catch (error) {
  const errorDetails = error instanceof Error 
    ? `${error.message}\n\nStack:\n${error.stack}`
    : String(error);
  
  console.error('[Backtest] Error:', errorDetails);
  
  // Show to user in development
  if (process.env.NODE_ENV === 'development') {
    dialog.showErrorBox('Backtest Failed', errorDetails);
  }
  
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
    errorDetails: errorDetails  // Include full details in response
  };
}
```

2. **Add error toast in UI:**
```typescript
// In BacktestRunner.tsx or wherever backtest is triggered
const result = await window.electron.runBacktest(params);

if (!result.success) {
  toast({
    title: "Backtest Failed",
    description: result.error,
    variant: "destructive",
    action: result.errorDetails ? (
      <Button onClick={() => {
        navigator.clipboard.writeText(result.errorDetails);
        toast({ title: "Error details copied to clipboard" });
      }}>
        Copy Details
      </Button>
    ) : undefined
  });
}
```

---

## Summary of Critical Failures

| # | Failure | Impact | Blocks | Fix Time |
|---|---------|--------|--------|----------|
| 1 | Missing `cli_wrapper.py` | ALL BACKTESTING | Everything | 2 hours |
| 2 | No Python validation | Silent failures | Setup | 1 hour |
| 3 | Parameter name mismatch | Tool failures | AI execution | 30 min |
| 4 | Incomplete docs | User confusion | Onboarding | 1 hour |
| 5 | VITE_ prefix confusion | Config errors | Setup | 30 min |
| 6 | No DB persistence | Data loss | Research workflow | 1 hour |
| 7 | No error visibility | Debugging impossible | Everything | 1 hour |

**Total estimated fix time:** 7-8 hours

---

## Recommended Fix Order

1. **Create `cli_wrapper.py`** (blocks everything else)
2. **Add Python environment validation** (prevents silent failures)
3. **Fix DB persistence** (critical for research workflow)
4. **Add error visibility** (enables debugging remaining issues)
5. **Fix parameter naming** (subtle but important)
6. **Update documentation** (helps new users)
7. **Fix env var confusion** (prevents config errors)

---

## Testing Checklist After Fixes

- [ ] Python3 is detected and version displayed
- [ ] Rotation engine directory is validated on startup
- [ ] `cli_wrapper.py` exists and is executable
- [ ] Running a backtest completes successfully
- [ ] Backtest results appear in local JSON file
- [ ] Backtest results appear in Supabase `backtest_runs` table
- [ ] Backtest results appear in UI run history
- [ ] Errors are shown to user with full details
- [ ] Tool execution logs are visible in chat
- [ ] Chief Quant can read backtest results
- [ ] Memory system can reference backtest runs
- [ ] Pattern detection can analyze multiple runs
