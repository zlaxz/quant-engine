# Comprehensive Repair Plan - All Issues from 5-Agent Audit

**Date:** 2025-12-01
**Audit Scope:** Gemini 3 API compliance, Gemini↔Claude handoff, prompts, error handling, data integrity
**Total Issues Found:** 32
**Estimated Total Repair Time:** 18-24 hours

---

## Issue Categorization

| Priority | Count | Est. Time | Impact |
|----------|-------|-----------|---------|
| **CRITICAL** | 7 | 3 hours | Blocks core functionality |
| **HIGH** | 9 | 6 hours | Causes failures in edge cases |
| **MEDIUM** | 11 | 8 hours | UX degradation, technical debt |
| **LOW** | 5 | 3 hours | Polish, future-proofing |

---

# CRITICAL PRIORITY (3 hours)

## C1: Frontend Not Receiving Claude Code Directives
**Source:** Agent 2 (Handoff), Agent 5 (Data Integrity)
**Impact:** 100% of charts/tables/metrics from Claude Code are lost
**Severity:** CRITICAL - Feature completely broken

**Problem:**
```typescript
// Backend emits (toolHandlers.ts:2689):
mainWindow.webContents.send('claude-code-directives', {
  directives,
  source: 'claude-code',
  timestamp: Date.now()
  // ❌ MISSING: rawOutput field
});

// Frontend expects (ChatArea.tsx:317):
const fullOutput = event.directives.map((d: any) => d.raw || '').join('\n');
// ❌ directives don't have .raw field!
```

**Fix:**
1. **Add rawOutput to IPC emission** (toolHandlers.ts:2689)
```typescript
mainWindow.webContents.send('claude-code-directives', {
  directives,
  source: 'claude-code',
  timestamp: Date.now(),
  rawOutput: result.stdout  // ← ADD THIS
});
```

2. **Update TypeScript type** (electron.d.ts:188-192)
```typescript
onClaudeCodeDirectives: (callback: (event: {
  directives: any[];
  source: string;
  timestamp: number;
  rawOutput: string;  // ← ADD THIS
}) => void) => () => void;
```

3. **Update ChatArea listener** (ChatArea.tsx:317)
```typescript
const fullOutput = event.rawOutput || '';  // ← USE rawOutput instead
```

**Testing:**
- Ask Claude Code (via Gemini) to display a chart
- Verify IPC event includes rawOutput
- Verify directive parsing succeeds
- Verify chart appears in UI

**Time:** 15 minutes
**Files:** 3 (toolHandlers.ts, electron.d.ts, ChatArea.tsx)

---

## C2: Output Exit Code Lost
**Source:** Agent 2 (Handoff), Agent 4 (Error Handling)
**Impact:** Success/failure misreported, circuit breaker logic broken
**Severity:** CRITICAL - Incorrect error handling

**Problem:**
```typescript
// toolHandlers.ts:2647-2653
if (fs.existsSync(outputFile)) {
  const output = fs.readFileSync(outputFile, 'utf-8');
  result = {
    stdout: output,
    stderr: '',
    status: 0  // ❌ ALWAYS 0, WRONG!
  };
}
```

**Why This Is Wrong:**
- Claude Code might fail but return 0 status
- Circuit breaker records false success
- User sees success when task actually failed

**Fix:**
Terminal command needs to capture exit code:

```typescript
// toolHandlers.ts:2595 - Update terminal command
const terminalCommand = `cd "${resolved}" && echo "🚀 Claude Code CLI Execution" && echo "Task: ${task.slice(0, 100)}..." && echo "" && clauded --print --output-format text -p "$(cat ${promptFile})"; EXIT_CODE=$?; echo "EXIT_CODE:$EXIT_CODE" >> ${outputFile}; echo "" && echo "✅ Complete (exit: $EXIT_CODE). Press any key..."; read -n 1`;

// Then parse exit code from output file:
const output = fs.readFileSync(outputFile, 'utf-8');
const exitCodeMatch = output.match(/EXIT_CODE:(\d+)/);
const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1]) : 0;
const cleanOutput = output.replace(/EXIT_CODE:\d+\n?/, '');

result = {
  stdout: cleanOutput,
  stderr: '',
  status: exitCode
};
```

**Testing:**
- Make Claude Code fail intentionally (invalid task)
- Verify non-zero exit code captured
- Verify circuit breaker increments failure count

**Time:** 30 minutes
**Files:** 1 (toolHandlers.ts)

---

## C3: Invalid Response Structure Silent Failure
**Source:** Agent 4 (Error Handling)
**Impact:** System breaks silently if Gemini returns unexpected format
**Severity:** CRITICAL - No user feedback on failure

**Problem:**
```typescript
// llmClient.ts:591 - Assumes candidate exists
const candidate = (response as any).candidates?.[0];
if (!candidate) break;
// ❌ If no candidate, breaks loop silently
```

**Fix:**
```typescript
const candidate = (response as any).candidates?.[0];
if (!candidate) {
  _event.sender.send('llm-stream', {
    type: 'error',
    error: 'Gemini returned invalid response format (no candidates)',
    timestamp: Date.now()
  });
  throw new Error('Invalid Gemini response: no candidates array');
}
```

**Time:** 20 minutes
**Files:** 1 (llmClient.ts)

---

## C4: Timeout Path Missing Circuit Breaker Update
**Source:** Agent 4 (Error Handling)
**Impact:** Circuit breaker won't protect against timeouts
**Severity:** CRITICAL - Protection mechanism ineffective

**Problem:**
```typescript
// toolHandlers.ts:2659-2667
if (!fs.existsSync(outputFile)) {
  // Cleanup
  if (fs.existsSync(promptFile)) fs.unlinkSync(promptFile);

  return {
    success: false,
    content: '',
    error: `Claude Code timed out after ${Math.floor(waited / 1000)}s`
  };
  // ❌ Circuit breaker not updated!
}
```

**Fix:**
```typescript
if (!fs.existsSync(outputFile)) {
  // Cleanup
  if (fs.existsSync(promptFile)) fs.unlinkSync(promptFile);

  // Record failure in circuit breaker
  claudeCodeCircuitBreaker.recordFailure();

  return {
    success: false,
    content: '',
    error: `Claude Code timed out after ${Math.floor(waited / 1000)}s. Task may be too complex.`
  };
}
```

**Time:** 5 minutes
**Files:** 1 (toolHandlers.ts)

---

## C5: Fragile Bracket Matching in stripDirectives
**Source:** Agent 4 (Error Handling)
**Impact:** Could match wrong closing bracket in nested JSON
**Severity:** HIGH - Data corruption risk

**Problem:**
```typescript
// displayDirectiveParser.ts:181
const bracketEnd = cleaned.indexOf(']', jsonEnd);
// ❌ Finds FIRST ] after JSON, might be wrong one
```

**Edge Case:**
```
Input: [DISPLAY_CHART: {...}] Some [text] with brackets
Result: Removes up to wrong ] bracket
```

**Fix:**
```typescript
// More robust: Look for ] immediately after JSON
let bracketEnd = jsonEnd;
while (bracketEnd < cleaned.length && cleaned[bracketEnd] !== ']') {
  if (cleaned[bracketEnd] === ' ' || cleaned[bracketEnd] === '\n') {
    bracketEnd++;
  } else {
    break; // Non-whitespace before ] means malformed
  }
}
if (cleaned[bracketEnd] === ']') {
  // Found closing bracket
} else {
  // Malformed directive
}
```

**Time:** 20 minutes
**Files:** 1 (displayDirectiveParser.ts)

---

## C6: No Args Validation Schema
**Source:** Agent 4 (Error Handling)
**Impact:** Tools crash with cryptic errors when args missing
**Severity:** HIGH - Poor UX, debugging nightmares

**Problem:**
```typescript
// toolHandlers.ts - executeTool doesn't validate args against schemas
case 'sweep_params':
  return sweepParams(args.strategy_key, args.param_name, ...);
  // ❌ If args.strategy_key is undefined, crashes with "undefined is not a string"
```

**Fix:** Add validation at executeTool entry:
```typescript
export async function executeTool(name: string, args: Record<string, any>): Promise<ToolResult> {
  // Validate args against tool definition
  const toolDef = ALL_TOOLS.find(t => t.name === name);
  if (toolDef?.parameters?.required) {
    for (const requiredParam of toolDef.parameters.required) {
      if (!(requiredParam in args) || args[requiredParam] === undefined) {
        return {
          success: false,
          content: '',
          error: `Missing required parameter: ${requiredParam} for tool ${name}`
        };
      }
    }
  }

  // Continue to switch statement...
}
```

**Time:** 30 minutes
**Files:** 1 (toolHandlers.ts)

---

## C7: No Error Handling Around displayContext Calls
**Source:** Agent 4 (Error Handling)
**Impact:** UI context errors crash entire chat
**Severity:** HIGH - Cascading failures

**Problem:**
```typescript
// ChatArea.tsx:288-304 - Direct context calls with no try-catch
displayContext.updateStage(directive.value);
displayContext.showVisualization(directive.value, directive.params);
// ❌ If context throws, entire useEffect fails
```

**Fix:**
```typescript
event.directives.forEach((directive: any) => {
  try {
    if (directive.type === 'stage') {
      displayContext.updateStage(directive.value);
    } else if (directive.type === 'display') {
      displayContext.showVisualization(directive.value, directive.params);
    }
    // ... etc
  } catch (error) {
    console.error('[ChatArea] Failed to process directive:', directive, error);
    // Continue processing other directives
  }
});
```

**Time:** 15 minutes
**Files:** 1 (ChatArea.tsx, 2 locations)

---

# HIGH PRIORITY (6 hours)

## H1: Too Many Tools (44 vs Recommended 10-20)
**Source:** Agent 1 (Gemini API Compliance)
**Impact:** Reduced tool selection accuracy, increased latency
**Severity:** HIGH - Performance & quality degradation

**Current State:**
```typescript
// ALL_TOOLS has 44 tools
export const ALL_TOOLS: FunctionDeclaration[] = [
  respond_directly,        // 1
  ...FILE_TOOLS,          // 6
  ...PYTHON_TOOLS,        // 2
  ...GIT_TOOLS,           // 7
  ...CLAUDE_TOOLS,        // 1
  ...AGENT_TOOLS,         // 2
  ...QUANT_TOOLS,         // 15+
  ...DATA_TOOLS           // 10+
];
```

**Google's Recommendation:** 10-20 tools per request for best accuracy

**Solution Options:**

### Option A: Dynamic Tool Loading (Recommended)
Load context-specific tool subsets based on task type:

```typescript
function selectTools(taskType: 'code' | 'data' | 'git' | 'analysis'): FunctionDeclaration[] {
  const core = [respond_directly];

  switch (taskType) {
    case 'code':
      return [...core, ...FILE_TOOLS, ...PYTHON_TOOLS, ...CLAUDE_TOOLS];
    case 'data':
      return [...core, ...FILE_TOOLS, ...QUANT_TOOLS, ...DATA_TOOLS];
    case 'git':
      return [...core, ...FILE_TOOLS, ...GIT_TOOLS];
    case 'analysis':
      return [...core, ...QUANT_TOOLS, ...DATA_TOOLS];
  }
}

// Detect task type from user message
const taskType = detectTaskType(lastUserMessage);
const tools = selectTools(taskType);

const model = geminiClient.getGenerativeModel({
  model: PRIMARY_MODEL,
  tools: [{ functionDeclarations: tools }],  // ← Subset instead of ALL
  ...
});
```

**Pros:**
- Reduces context per request
- Improves tool selection accuracy
- Speeds up responses

**Cons:**
- Task type detection could be wrong
- More complex logic

**Time:** 3 hours
**Files:** 2 (llmClient.ts, new toolSelector.ts)

---

### Option B: Use allowedFunctionNames
Restrict which tools Gemini can use per request:

```typescript
toolConfig: {
  functionCallingConfig: {
    mode: 'ANY',
    allowedFunctionNames: selectedToolNames  // ← Restrict dynamically
  }
}
```

**Time:** 2 hours
**Files:** 1 (llmClient.ts)

---

### Option C: Tool Consolidation
Merge similar tools into parameterized versions:

```typescript
// Instead of: git_status, git_diff, git_log, git_branch
// Use: git_operation(action: 'status' | 'diff' | 'log' | 'branch')
```

**Time:** 4 hours
**Files:** 2 (toolDefinitions.ts, toolHandlers.ts)

---

## H2: No Output Size Limits
**Source:** Agent 2 (Handoff), Agent 5 (Data Integrity)
**Impact:** >10MB outputs cause JSON parsing failures
**Severity:** HIGH - Memory exhaustion, crashes

**Problem:**
```typescript
// toolHandlers.ts - No size check before reading output file
const output = fs.readFileSync(outputFile, 'utf-8');
// ❌ If outputFile is 100MB, this crashes with OOM
```

**Fix:**
```typescript
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB

const stats = fs.statSync(outputFile);
if (stats.size > MAX_OUTPUT_SIZE) {
  // Truncate large outputs
  const fd = fs.openSync(outputFile, 'r');
  const buffer = Buffer.alloc(MAX_OUTPUT_SIZE);
  fs.readSync(fd, buffer, 0, MAX_OUTPUT_SIZE, 0);
  fs.closeSync(fd);

  result = {
    stdout: buffer.toString('utf-8') + `\n\n[OUTPUT TRUNCATED: File is ${(stats.size / 1024 / 1024).toFixed(1)}MB, showing first 10MB]`,
    stderr: '',
    status: 0
  };
} else {
  const output = fs.readFileSync(outputFile, 'utf-8');
  result = { stdout: output, stderr: '', status: 0 };
}
```

**Time:** 30 minutes
**Files:** 1 (toolHandlers.ts)

---

## H3: No Directive Validation Before UI Emission
**Source:** Agent 2 (Handoff), Agent 4 (Error Handling)
**Impact:** Malformed directives crash renderer
**Severity:** HIGH - UI crashes

**Problem:**
```typescript
// toolHandlers.ts:2689 - Emits directives without validation
mainWindow.webContents.send('claude-code-directives', {
  directives  // ❌ Could be malformed
});
```

**Fix:**
```typescript
if (directives.length > 0) {
  // Validate each directive has required structure
  const validDirectives = directives.filter(d => {
    if (!d.type || !d.value) {
      console.warn('[Claude Code] Invalid directive structure:', d);
      return false;
    }
    return true;
  });

  if (validDirectives.length > 0) {
    mainWindow.webContents.send('claude-code-directives', {
      directives: validDirectives,
      source: 'claude-code',
      timestamp: Date.now(),
      rawOutput: result.stdout
    });
  }
}
```

**Time:** 20 minutes
**Files:** 1 (toolHandlers.ts)

---

## H4: Missing DeepSeek Agent Script
**Source:** Agent 2 (Handoff)
**Impact:** Massive parallelization fails with FileNotFoundError
**Severity:** HIGH - Blocks scaling feature

**Problem:**
```typescript
// Prompt tells Claude Code (toolHandlers.ts:2535-2539):
"For this task, use DeepSeek agents for cost-efficient parallel processing.
Script: python3 scripts/deepseek_agent.py "<task>" "<agent_type>" "<context>""
// ❌ But scripts/deepseek_agent.py doesn't exist!
```

**Fix Option 1 - Create Stub:**
```python
# /Users/zstoc/GitHub/quant-engine/scripts/deepseek_agent.py
#!/usr/bin/env python3
"""
DeepSeek Agent Runner - Spawns DeepSeek agents via API
"""
import sys
import os
from openai import OpenAI

def run_agent(task: str, agent_type: str, context: str = ""):
    api_key = os.getenv('DEEPSEEK_API_KEY')
    if not api_key:
        print("Error: DEEPSEEK_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    client = OpenAI(
        api_key=api_key,
        base_url='https://api.deepseek.com'
    )

    system_prompt = {
        'analyst': 'You are a data analyst specializing in quantitative research.',
        'reviewer': 'You are a code reviewer focusing on correctness and edge cases.',
        'researcher': 'You are a research assistant investigating hypotheses.',
        'coder': 'You are a Python developer implementing algorithms.'
    }.get(agent_type, 'You are a helpful assistant.')

    messages = [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': f"Context: {context}\n\nTask: {task}"}
    ]

    response = client.chat.completions.create(
        model='deepseek-chat',
        messages=messages
    )

    print(response.choices[0].message.content)

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: deepseek_agent.py <task> <agent_type> [context]", file=sys.stderr)
        sys.exit(1)

    task = sys.argv[1]
    agent_type = sys.argv[2]
    context = sys.argv[3] if len(sys.argv) > 3 else ""

    run_agent(task, agent_type, context)
```

**Fix Option 2 - Remove Feature:**
Remove lines 2531-2544 from toolHandlers.ts (massive parallel hint instructions)

**Time:** 30 minutes (create stub) or 5 minutes (remove)
**Files:** 1 new file or 1 edit

---

## H5: No Validation of Directive Structure Before Emission
**Source:** Agent 4 (Error Handling)
**Impact:** Bad directives reach UI, cause React errors
**Severity:** HIGH - Renderer crashes

**Problem:**
Already covered in H3 above (same fix)

---

## H6: Missing Context - SESSION_STATE.md Not Passed
**Source:** Agent 2 (Handoff)
**Impact:** Claude Code lacks project state awareness
**Severity:** MEDIUM-HIGH - Suboptimal decisions

**Problem:**
Claude Code doesn't see SESSION_STATE.md, so it doesn't know:
- What's working (don't break it)
- What's broken (known issues)
- What's in progress (pick up where left off)

**Fix:**
```typescript
// toolHandlers.ts:2520 - Add SESSION_STATE to context
const sessionStatePath = path.join(resolved, 'SESSION_STATE.md');
if (fs.existsSync(sessionStatePath)) {
  const sessionState = fs.readFileSync(sessionStatePath, 'utf-8');
  prompt += `
## Project Current State
${sessionState}

**Important:** Don't break anything marked "Working". Focus on "In Progress" and "Next Actions".
`;
}
```

**Time:** 15 minutes
**Files:** 1 (toolHandlers.ts)

---

## H7: No Terminal Fallback
**Source:** Agent 2 (Handoff)
**Impact:** If AppleScript fails, task fails entirely
**Severity:** MEDIUM-HIGH - Feature unavailable on error

**Problem:**
```typescript
// toolHandlers.ts:2611-2619
if (terminalResult.status !== 0) {
  safeLog(`❌ Failed to open Terminal: ${terminalResult.stderr}`);
  fs.unlinkSync(promptFile);
  return {
    success: false,
    error: `Failed to open Terminal window: ${terminalResult.stderr || 'Unknown error'}`
  };
  // ❌ Could fallback to background execution!
}
```

**Fix:**
```typescript
if (terminalResult.status !== 0) {
  safeLog(`⚠️ Terminal launch failed, falling back to background execution`);

  // Fallback: Execute in background with spawnSync
  const bgResult = spawnSync('clauded', ['--print', '--output-format', 'text', '-p', prompt], {
    encoding: 'utf-8',
    cwd: resolved,
    timeout: 600000,
    maxBuffer: 10 * 1024 * 1024
  });

  result = {
    stdout: bgResult.stdout,
    stderr: bgResult.stderr,
    status: bgResult.status || 0
  };
} else {
  // Normal Terminal execution path...
}
```

**Time:** 45 minutes
**Files:** 1 (toolHandlers.ts)

---

## H8: Max Iterations Silent Exit
**Source:** Agent 4 (Error Handling)
**Impact:** Gemini stops working with no warning
**Severity:** HIGH - Confusing UX

**Problem:**
```typescript
// llmClient.ts:573
while (iterations < MAX_TOOL_ITERATIONS) {
  // ... tool loop
}
// ❌ Loop exits silently at iteration 10
```

**Fix:**
```typescript
while (iterations < MAX_TOOL_ITERATIONS) {
  // ... tool loop
  iterations++;
}

if (iterations >= MAX_TOOL_ITERATIONS) {
  _event.sender.send('llm-stream', {
    type: 'chunk',
    content: '\n\n*⚠️ Reached maximum tool call iterations (10). Task may be too complex for single execution. Consider breaking into smaller steps.*\n',
    timestamp: Date.now()
  });
  safeLog(`⚠️ Hit MAX_TOOL_ITERATIONS (${iterations}) - possible infinite loop`);
}
```

**Time:** 10 minutes
**Files:** 1 (llmClient.ts)

---

## H9: Misleading "Fallback to Background" Comment
**Source:** Agent 4 (Error Handling)
**Impact:** Code behavior doesn't match comment
**Severity:** MEDIUM - Confusing for maintainers

**Problem:**
```typescript
// toolHandlers.ts:2612-2613
safeLog(`❌ Failed to open Terminal: ${terminalResult.stderr}`);
// Fallback to background execution  ← ❌ NEVER ACTUALLY FALLS BACK
fs.unlinkSync(promptFile);
return { success: false, error: ... };
```

**Fix:**
Either implement fallback (see H7) or fix comment:
```typescript
// Terminal launch failed - no fallback available
fs.unlinkSync(promptFile);
```

**Time:** 2 minutes (comment) or 45 minutes (implement fallback per H7)
**Files:** 1 (toolHandlers.ts)

---

# MEDIUM PRIORITY (8 hours)

## M1: UI Directive Types Not Clearly Distinguished
**Source:** Agent 3 (Prompt Engineering)
**Impact:** Gemini confusion about when to use data vs journey directives
**Severity:** MEDIUM - Suboptimal directive usage

**Fix:** Add clarification to chiefQuantPrompt.ts around line 429:

```typescript
## UI Directive System (Two Types)

You can control the UI using TWO directive systems. Choose based on use case:

### Type 1: Data-Driven Directives (For Custom Visualizations)
**Use when:** You have CUSTOM data to visualize (backtest results, custom analysis, etc.)

[DISPLAY_CHART: {
  "type": "line",
  "title": "Momentum Strategy Returns",
  "data": {"series": [{"name": "Strategy", "values": [["2024-01-01", 10000], ["2024-02-01", 11500]]}]}
}]

[DISPLAY_TABLE: {
  "title": "Trade Log",
  "columns": [{"key": "date", "label": "Date"}, {"key": "pnl", "label": "P&L"}],
  "rows": [{"date": "2024-01-15", "pnl": 150}]
}]

[DISPLAY_METRICS: {
  "title": "Performance",
  "metrics": [{"name": "Sharpe", "value": 1.8, "status": "good"}]
}]

### Type 2: Journey Directives (For Workflow Coordination)
**Use when:** Coordinating the research workflow, using pre-built visualizations

[STAGE: regime_mapping]  // Set research stage
[DISPLAY: regime_timeline from=2020-01-01 to=2024-12-31]  // Pre-built viz
[PROGRESS: 45 message="Classifying Q2 2021"]
[FOCUS: center]

**Decision Rule:**
- Have custom data to show? → Use data-driven directives (Type 1)
- Using pre-built visualizations? → Use journey directives (Type 2)
```

**Time:** 30 minutes
**Files:** 1 (chiefQuantPrompt.ts)

---

## M2: Claude Code Prompt Lacks Environment Details
**Source:** Agent 3 (Prompt Engineering)
**Impact:** Claude Code doesn't know where it's executing
**Severity:** MEDIUM - Suboptimal file paths, confusion

**Fix:** Enhance Claude Code prompt (toolHandlers.ts:2520):

```typescript
prompt += `
## Execution Environment Details

**Project Structure:**
\`\`\`
/Users/zstoc/GitHub/quant-engine/
├── python/                    # Python quant engine (YOU ARE HERE)
│   ├── server.py              # Flask server (port 5000)
│   ├── engine/                # Core modules
│   │   ├── data/              # Data loaders, features
│   │   ├── analysis/          # Regime detection, metrics
│   │   ├── trading/           # Backtesting, strategies
│   │   ├── pricing/           # Options pricing, Greeks
│   │   └── plugins/           # Extensible analysis plugins
│   └── requirements.txt       # Python dependencies
├── src/                       # React/Electron frontend
└── SESSION_STATE.md           # Current project state
\`\`\`

**Data Storage:**
- Market Data: /Volumes/VelocityData/market_data/ (8TB external SSD)
  - Options: /us_options_opra/day_aggs_v1/
  - Stocks: /velocity_om/parquet/stock/
- Use yfinance as fallback if VelocityData unavailable

**Python Environment:**
- Version: 3.14.0
- Key Packages: pandas, numpy, scipy, flask, yfinance

**Your Tools:**
- Bash: cd, ls, mkdir, grep, curl, etc.
- Python: Can execute any .py script
- Git: Full access (status, commit, push, etc.)
- File I/O: Read, write, search anywhere in project
`;
```

**Time:** 20 minutes
**Files:** 1 (toolHandlers.ts)

---

## M3: UI Directive Examples Use Placeholders
**Source:** Agent 3 (Prompt Engineering)
**Impact:** Gemini might emit invalid data format
**Severity:** MEDIUM - Directive parsing failures

**Problem:**
```typescript
// chiefQuantPrompt.ts:449 (example)
"data": {"series": [{"name": "Strategy", "values": [[dates], [values]]}]}
//                                                     ^^^^^^  ^^^^^^
//                                                     Placeholders, not realistic
```

**Fix:**
Replace all examples with realistic data:

```typescript
// GOOD Example:
[DISPLAY_CHART: {
  "type": "line",
  "title": "Equity Curve",
  "data": {
    "series": [{
      "name": "Strategy",
      "values": [
        ["2024-01-01", 10000],
        ["2024-01-15", 10750],
        ["2024-02-01", 11200],
        ["2024-02-15", 10950]
      ]
    }, {
      "name": "Buy & Hold",
      "values": [
        ["2024-01-01", 10000],
        ["2024-01-15", 10300],
        ["2024-02-01", 10600],
        ["2024-02-15", 10500]
      ]
    }]
  },
  "config": {
    "xLabel": "Date",
    "yLabel": "Portfolio Value ($)"
  }
}]

// Each series is array of [date_string, number] pairs
```

**Time:** 30 minutes (update all examples)
**Files:** 1 (chiefQuantPrompt.ts)

---

## M4: Unknown Directives Silently Ignored
**Source:** Agent 4 (Error Handling)
**Impact:** Debugging nightmares when directives don't work
**Severity:** MEDIUM - Poor developer experience

**Problem:**
```typescript
// displayDirectiveParser.ts:54-61
if (directiveType === 'stage') {
  if (VALID_STAGES.includes(directiveValue as ResearchStage)) {
    directives.push({ type: 'stage', value: directiveValue });
  }
  // ❌ If invalid stage, silently skipped
}
```

**Fix:**
```typescript
if (directiveType === 'stage') {
  if (VALID_STAGES.includes(directiveValue as ResearchStage)) {
    directives.push({ type: 'stage', value: directiveValue });
  } else {
    console.warn(`[Directive] Invalid stage: "${directiveValue}". Valid stages:`, VALID_STAGES);
  }
}
```

Apply to all directive types (stage, display, focus, todo_add, etc.)

**Time:** 30 minutes
**Files:** 1 (displayDirectiveParser.ts)

---

## M5: Generic Directive Error Messages
**Source:** Agent 4 (Error Handling)
**Impact:** Hard to debug when directives fail
**Severity:** MEDIUM - Poor DX

**Problem:**
```typescript
// displayDirectiveParser.ts:340
if (!data.type || !data.title || !data.data) {
  console.warn('[Directive] DISPLAY_CHART missing required fields');
  // ❌ Doesn't say WHICH fields are missing
  return null;
}
```

**Fix:**
```typescript
const missingFields = [];
if (!data.type) missingFields.push('type');
if (!data.title) missingFields.push('title');
if (!data.data) missingFields.push('data');

if (missingFields.length > 0) {
  console.warn(`[Directive] DISPLAY_CHART missing required fields: ${missingFields.join(', ')}`);
  console.warn('[Directive] Received data:', data);
  return null;
}
```

Apply to all directive parsers.

**Time:** 30 minutes
**Files:** 1 (displayDirectiveParser.ts)

---

## M6: Decision Reasoning Too Verbose
**Source:** Agent 3 (Prompt Engineering)
**Impact:** 7 lines of metadata per delegation, token overhead
**Severity:** MEDIUM - Performance degradation

**Current Requirement:**
```typescript
[DECISION_REASONING]
Task type: <type>
Chosen: execute_via_claude_code
Confidence: 75%
Why: <reason>

Alternatives considered:
- Direct handling (40%): <why not>
- spawn_agent (25%): <why not>
[/DECISION_REASONING]
```

**Simplified Alternative:**
```typescript
[DELEGATING: execute_via_claude_code]
Reason: Multi-file refactoring + git commit (only when non-obvious)
```

**Fix:** Make reasoning optional, only for ambiguous cases

**Time:** 15 minutes
**Files:** 1 (chiefQuantPrompt.ts)

---

## M7: No Documentation of Claude Code's Specific Tools
**Source:** Agent 3 (Prompt Engineering)
**Impact:** Gemini doesn't know Claude Code's exact capabilities
**Severity:** MEDIUM - Suboptimal delegation

**Fix:** Add to chiefQuantPrompt.ts:

```typescript
### Claude Code's Tool Arsenal

When delegating, Claude Code has access to:

**File Operations:**
- Read: Read any file in project
- Write: Create or overwrite files
- Edit: Modify existing files (line-based)
- Search: Grep-based code search
- Glob: Pattern-based file finding

**Execution:**
- Bash: Any shell command (cd, ls, mkdir, grep, curl, etc.)
- Python: Execute .py scripts with arguments
- Package Management: pip install (updates requirements.txt)

**Git:**
- Status, diff, log (inspection)
- Add, commit, push (modifications)
- Branch, checkout (workflow)

**Agent Spawning:**
- Native Claude agents (parallel work, free with Max subscription)
- DeepSeek agents (massive parallel, cost-efficient via API)

**Limitations:**
- No direct database access (use Python scripts)
- No browser automation (headless)
- 10-minute timeout per execution
```

**Time:** 20 minutes
**Files:** 1 (chiefQuantPrompt.ts)

---

## M8: No Error Handling Guidance in Prompts
**Source:** Agent 3 (Prompt Engineering)
**Impact:** Unclear how to handle failures
**Severity:** MEDIUM - Poor error recovery

**Fix:** Add to both prompts:

**For Gemini (chiefQuantPrompt.ts):**
```typescript
### If Claude Code Execution Fails

You will receive error details:
- Exit code (non-zero on failure)
- Error output (stderr)
- Partial output (if available)

Your options:
1. **Retry with modifications** - Simpler task, clearer instructions
2. **Break down** - Split into smaller tasks
3. **Fallback** - Use direct tools instead
4. **Explain limitation** - If task is impossible, tell user why

Example:
\`\`\`
Claude Code failed (exit 1): "Python module 'foo' not found"

[DECISION] Installing missing dependency...
execute_via_claude_code(
  task: "Install foo package: pip install foo && update requirements.txt",
  context: "Previous task failed due to missing module"
)
\`\`\`
```

**For Claude Code (toolHandlers.ts):**
```typescript
## If You Encounter Errors

Report failures clearly:
- **What failed:** Command, script, or operation
- **Error message:** Full stderr if relevant
- **What you tried:** Debugging steps taken
- **Suggested fix:** How user or Gemini can resolve
- **Partial results:** Any output before failure

Example:
\`\`\`
ERROR: pytest failed on test_regime_detector.py

Attempted: python3 -m pytest tests/test_regime_detector.py
Error: ModuleNotFoundError: No module named 'scipy'

Fix needed: Install scipy via pip install scipy

Partial results: 12 tests passed before failure
\`\`\`
```

**Time:** 30 minutes
**Files:** 2 (chiefQuantPrompt.ts, toolHandlers.ts)

---

## M9: No Output Format Expectation in Claude Code Prompt
**Source:** Agent 3 (Prompt Engineering)
**Impact:** Claude Code returns inconsistent formats
**Severity:** MEDIUM - Parsing difficulties

**Fix:** Add to toolHandlers.ts prompt:

```typescript
## Expected Response Format

Structure your response like this:

**Summary:** <What you did in 1-2 sentences>

**Results:**
<Data, output, or confirmation. Use UI directives if displaying charts/tables>

**Files Modified:**
- path/to/file1.py (created)
- path/to/file2.py (updated lines 45-67)

**Issues:** <Any problems encountered, or "None">

**Next Steps:** <If task is incomplete, what remains>
```

**Time:** 10 minutes
**Files:** 1 (toolHandlers.ts)

---

## M10: No Size Limit Warning in Prompt
**Source:** Agent 5 (Data Integrity)
**Impact:** Users don't know about 10MB limit
**Severity:** LOW-MEDIUM - Unexpected truncation

**Fix:** Add to toolHandlers.ts prompt:

```typescript
## Output Limits

- **Maximum output size:** 10MB
- **If output exceeds limit:** First 10MB returned + truncation notice
- **For large results:** Write to file and return file path instead

Example for large data:
\`\`\`python
# Don't print 100MB of data
results.to_csv('/tmp/backtest_results.csv')
print("Results written to /tmp/backtest_results.csv (15MB)")
\`\`\`
```

**Time:** 10 minutes
**Files:** 1 (toolHandlers.ts)

---

## M11: Context Preservation Not Validated
**Source:** Agent 5 (Data Integrity)
**Impact:** Can't verify Gemini's reasoning reaches Claude Code
**Severity:** MEDIUM - Quality assurance gap

**Fix:** Add logging to verify context:

```typescript
// toolHandlers.ts:2514-2520
if (context) {
  safeLog(`   Context provided: ${context.length} bytes`);
  safeLog(`   Context preview: ${context.slice(0, 200)}...`);

  prompt += `
## Context (Gemini's Analysis)
\`\`\`
${context}
\`\`\`
`;
}
```

**Time:** 5 minutes
**Files:** 1 (toolHandlers.ts)

---

# LOW PRIORITY (3 hours)

## L1: Add finishReason Logging
**Source:** Agent 1 (Gemini API Compliance)
**Impact:** Debugging when responses terminate unexpectedly
**Severity:** LOW - Nice to have

**Fix:**
```typescript
// llmClient.ts - After getting candidate
const finishReason = candidate.finishReason;
if (finishReason && finishReason !== 'STOP') {
  safeLog(`[Gemini] Finish reason: ${finishReason}`);
  if (finishReason === 'SAFETY') {
    console.warn('[Gemini] Response blocked by safety filters');
  } else if (finishReason === 'MAX_TOKENS') {
    console.warn('[Gemini] Response truncated at max tokens');
  }
}
```

**Time:** 15 minutes
**Files:** 1 (llmClient.ts)

---

## L2: Enable includeThoughts Flag
**Source:** Agent 1 (Gemini API Compliance)
**Impact:** Get reasoning summaries for debugging
**Severity:** LOW - Debugging aid

**Fix:**
```typescript
// llmClient.ts:504
generationConfig: {
  temperature: 1.0,
  includeThoughts: true  // ← ADD THIS (Gemini 3 feature)
},
```

Log thoughts when present for debugging.

**Time:** 10 minutes
**Files:** 1 (llmClient.ts)

---

## L3: Use Versioned Model Name
**Source:** Agent 1 (Gemini API Compliance)
**Impact:** Model behavior could change unexpectedly
**Severity:** LOW - Stability concern

**Current:**
```typescript
model: 'gemini-3-pro-preview'  // ← Latest, changes over time
```

**Recommended:**
```typescript
model: 'gemini-3-pro-preview-11-2025'  // ← Locked to specific version
```

**Time:** 2 minutes
**Files:** 1 (models.ts)

---

## L4: Simplify Decision Reasoning Requirement
**Source:** Agent 3 (Prompt Engineering)
**Impact:** Verbose metadata in every delegation
**Severity:** LOW - UX preference

**Already covered in M6 above**

---

## L5: Add Troubleshooting Section to Prompts
**Source:** Agent 3 (Prompt Engineering)
**Impact:** Common issues not documented
**Severity:** LOW - User convenience

**Fix:** Add to chiefQuantPrompt.ts:

```typescript
## Troubleshooting Common Issues

**"Tool execution timeout":**
- Task too complex for single execution
- Break into smaller tasks
- Check if Python server is running (port 5000)

**"File not found":**
- Check working directory (use list_directory first)
- Verify file path is relative to engine root
- File might be in /Volumes/VelocityData/

**"Module not found" (Python):**
- Use manage_environment tool to install
- Check requirements.txt for version

**"Circuit breaker is OPEN":**
- Claude Code has failed 3+ times recently
- Wait 5 minutes for auto-reset
- Check if Claude Code CLI is accessible
```

**Time:** 20 minutes
**Files:** 1 (chiefQuantPrompt.ts)

---

# IMPLEMENTATION ROADMAP

## Phase 1: Critical Fixes (3 hours)
**When:** This week
**Must have for production:**
- C1: Fix rawOutput in IPC event (15 min)
- C2: Capture exit code properly (30 min)
- C3: Invalid response validation (20 min)
- C4: Timeout circuit breaker (5 min)
- C5: Bracket matching fix (20 min)
- C6: Args validation schema (30 min)
- C7: Error handling around context (15 min)

**Result:** Zero critical bugs, rock-solid error handling

---

## Phase 2: High Priority (6 hours)
**When:** Next 2 weeks
**Improves quality & reliability:**
- H1: Tool count optimization (3 hours)
- H2: Output size limits (30 min)
- H3: Directive validation (20 min)
- H4: DeepSeek agent script (30 min)
- H6: SESSION_STATE context (15 min)
- H7: Terminal fallback (45 min)
- H8: Max iterations warning (10 min)
- H9: Fix misleading comment (2 min)

**Result:** Professional-grade error handling, optimized performance

---

## Phase 3: Medium Priority (8 hours)
**When:** Next month
**Improves UX & clarity:**
- M1: Clarify directive types (30 min)
- M2: Environment details (20 min)
- M3: Fix examples (30 min)
- M4: Log unknown directives (30 min)
- M5: Better error messages (30 min)
- M6: Simplify reasoning (15 min)
- M7: Document tools (20 min)
- M8: Error guidance (30 min)
- M9: Response format (10 min)
- M10: Size limit warning (10 min)
- M11: Context validation (5 min)

**Result:** Crystal-clear prompts, excellent developer experience

---

## Phase 4: Low Priority (3 hours)
**When:** Future
**Polish & future-proofing:**
- L1: finishReason logging (15 min)
- L2: includeThoughts flag (10 min)
- L3: Versioned model name (2 min)
- L5: Troubleshooting docs (20 min)

**Result:** Production polish, long-term stability

---

## TOTAL SCOPE

**All Issues:** 32 issues across 4 priorities
**Total Time:** 20 hours (spread across 4 phases)
**Critical Path:** 3 hours (Phase 1)
**To Production Ready:** 9 hours (Phase 1 + 2)

---

## RETURN ON INVESTMENT

| Phase | Time | Result |
|-------|------|--------|
| Phase 1 | 3 hrs | **System bulletproof** (zero critical bugs) |
| Phase 2 | 6 hrs | **Professional quality** (optimized, reliable) |
| Phase 3 | 8 hrs | **Best-in-class UX** (clear, well-documented) |
| Phase 4 | 3 hrs | **Future-proof** (stable, maintainable) |

**Recommendation:** Do Phase 1 immediately (this session if possible), Phase 2 this week, Phase 3-4 as time allows.

---

**Want me to start Phase 1 right now (3 hours of critical fixes)?**