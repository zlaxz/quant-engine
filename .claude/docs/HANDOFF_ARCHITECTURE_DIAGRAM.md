# Gemini ↔ Claude Code Architecture Diagram

Visual representation of the complete handoff flow.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         QUANT ENGINE APP                            │
│                                                                     │
│  ┌───────────────┐         ┌───────────────┐      ┌──────────────┐│
│  │   React UI    │◄────────┤ Electron Main │◄─────┤ Claude Code  ││
│  │   (Renderer)  │  IPC    │   Process     │ CLI  │     CLI      ││
│  │               │         │               │      │              ││
│  │  - ChatArea   │         │  - llmClient  │      │ - Tool Access││
│  │  - Display    │         │  - toolHandl. │      │ - File Ops   ││
│  │  - Journey    │         │  - Directives │      │ - Python     ││
│  └───────────────┘         └───────────────┘      └──────────────┘│
│         ▲                          │                      ▲        │
│         │                          │                      │        │
│         │                          ▼                      │        │
│         │                  ┌───────────────┐              │        │
│         │                  │  Gemini API   │              │        │
│         │                  │  (Reasoning)  │──────────────┘        │
│         │                  └───────────────┘  "Use Claude Code"    │
│         │                                                          │
│         └──────────────────────────────────────────────────────────┘
│                     Directives trigger UI updates                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Request Flow

```
USER TYPES MESSAGE
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. FRONTEND (ChatArea.tsx)                                      │
│    - User message captured                                      │
│    - System prompt built (chiefQuantPrompt)                     │
│    - Call: chatPrimary(messages)                               │
└─────────────────────┬───────────────────────────────────────────┘
                      │ IPC invoke('chat-primary')
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. IPC HANDLER (llmClient.ts)                                   │
│    - Validate messages (Zod schema)                            │
│    - Make routing decision                                      │
│    - Initialize Gemini client                                   │
│    - Add tool definitions (ALL_TOOLS)                           │
│    - Set toolConfig: { mode: 'ANY' } ← Forces tool usage       │
└─────────────────────┬───────────────────────────────────────────┘
                      │ API call to Gemini
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. GEMINI REASONING                                             │
│    - Analyzes user request                                      │
│    - Decides: "This needs code execution"                       │
│    - Returns functionCall: execute_via_claude_code              │
│    - Parameters:                                                │
│      • task: "Run backtest for 2024"                           │
│      • context: "User wants to test new strategy"              │
│      • parallel_hint: "none"                                    │
└─────────────────────┬───────────────────────────────────────────┘
                      │ Tool call detected
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. TOOL ROUTER (llmClient.ts tool execution loop)              │
│    - Parse functionCall from Gemini response                    │
│    - Extract: name="execute_via_claude_code"                   │
│    - Extract: args={task, context, parallel_hint}              │
│    - Call: executeTool(name, args)                             │
└─────────────────────┬───────────────────────────────────────────┘
                      │ Route to specific handler
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. TOOL HANDLER (toolHandlers.ts)                              │
│    function executeViaClaudeCode(task, context, parallelHint)  │
│                                                                 │
│    A. INPUT VALIDATION                                          │
│       ✓ Task not empty                                          │
│       ✓ Size limits (1MB max)                                   │
│       ✓ parallelHint enum check                                 │
│                                                                 │
│    B. CIRCUIT BREAKER CHECK                                     │
│       ✓ < 3 recent failures? → Continue                         │
│       ✗ ≥ 3 failures? → Block (return error)                   │
│                                                                 │
│    C. BUILD PROMPT                                              │
│       • Task in code fence (prevent injection)                  │
│       • Context in code fence                                   │
│       • UI directive documentation                              │
│       • Agent strategy instructions                             │
│       • Working directory info                                  │
│                                                                 │
│    D. VALIDATE ENVIRONMENT                                      │
│       ✓ Check: which clauded                                    │
│       ✓ Verify working directory                                │
│       ✓ Check .git, package.json, or python/ exists            │
│                                                                 │
│    E. WRITE TEMP FILES                                          │
│       • promptFile = /tmp/clauded-prompt-[timestamp].txt       │
│       • outputFile = /tmp/clauded-output-[timestamp].txt       │
└─────────────────────┬───────────────────────────────────────────┘
                      │ Execute via Terminal
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. TERMINAL EXECUTION (AppleScript)                            │
│    tell application "Terminal"                                  │
│      activate                                                   │
│      do script "cd /path && clauded ... | tee outputFile"      │
│    end tell                                                     │
│                                                                 │
│    Terminal window opens with:                                  │
│    $ cd /Users/zstoc/GitHub/quant-engine                       │
│    $ clauded --print --output-format text -p "$(cat prompt)"    │
│                                                                 │
│    Output streams to:                                           │
│    • Screen (user can monitor)                                  │
│    • outputFile (for programmatic capture)                      │
└─────────────────────┬───────────────────────────────────────────┘
                      │ Claude Code executes
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. CLAUDE CODE EXECUTION (Anthropic Claude CLI)                │
│    - Reads prompt with task + context                           │
│    - Has full tool access:                                      │
│      • Bash: Run any command                                    │
│      • Read: Access any file                                    │
│      • Write: Create/modify files                               │
│      • Glob: Search files                                       │
│      • Grep: Search content                                     │
│      • Python: Execute scripts                                  │
│      • Git: Commit, diff, status                                │
│                                                                 │
│    Example execution:                                           │
│    1. Read strategy file                                        │
│    2. Run: python backtest.py --strategy SPY --dates 2024      │
│    3. Parse results                                             │
│    4. Generate directives:                                      │
│       [DISPLAY_METRICS: {"title": "Results", ...}]             │
│       [DISPLAY_CHART: {"type": "line", ...}]                    │
│    5. Write summary to stdout                                   │
└─────────────────────┬───────────────────────────────────────────┘
                      │ Writes to outputFile
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 8. OUTPUT CAPTURE (toolHandlers.ts polling)                    │
│    - Poll every 1 second for outputFile                         │
│    - Check file exists and has content                          │
│    - Max wait: 10 minutes (timeout)                            │
│    - Once complete, read full output                            │
└─────────────────────┬───────────────────────────────────────────┘
                      │ Output captured
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 9. RESULT PARSING (toolHandlers.ts)                            │
│    A. PARSE DIRECTIVES                                          │
│       const directives = parseDisplayDirectives(stdout)         │
│       → Finds: [DISPLAY_CHART: {...}], [TODO_ADD:...], etc.    │
│                                                                 │
│    B. VALIDATE DIRECTIVES (AFTER FIX)                           │
│       • Check each has .type                                    │
│       • Validate type-specific fields                           │
│       • Filter out invalid directives                           │
│                                                                 │
│    C. EMIT TO UI (IPC)                                          │
│       mainWindow.webContents.send('claude-code-directives', {   │
│         directives: validDirectives,                            │
│         rawOutput: stdout, ← ADDED IN FIX                       │
│         source: 'claude-code',                                  │
│         timestamp: Date.now()                                   │
│       })                                                        │
│                                                                 │
│    D. BUILD STRUCTURED RESPONSE                                 │
│       return {                                                  │
│         success: true,                                          │
│         content: JSON.stringify({                               │
│           type: 'claude-code-execution',                        │
│           status: 'success',                                    │
│           stdout: truncatedStdout, ← ADDED IN FIX              │
│           stderr: stderr,                                       │
│           directives: directives,                               │
│           metadata: {...}                                       │
│         })                                                      │
│       }                                                         │
│                                                                 │
│    E. CIRCUIT BREAKER UPDATE                                    │
│       claudeCodeCircuitBreaker.recordSuccess()                  │
│       → Resets failure count to 0                               │
│                                                                 │
│    F. CLEANUP                                                   │
│       fs.unlinkSync(promptFile)                                 │
│       fs.unlinkSync(outputFile)                                 │
└─────────────────────┬───────────────────────────────────────────┘
                      │ Returns to tool router
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 10. TOOL RESULT RETURN (llmClient.ts)                          │
│     - Tool result received                                      │
│     - Format as functionResponse for Gemini                     │
│     - Send back to Gemini:                                      │
│       {                                                         │
│         functionResponse: {                                     │
│           name: 'execute_via_claude_code',                     │
│           response: { content: structuredJSON }                 │
│         }                                                       │
│       }                                                         │
└─────────────────────┬───────────────────────────────────────────┘
                      │ Gemini synthesizes
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 11. GEMINI SYNTHESIS                                            │
│     - Receives tool result (JSON)                               │
│     - Parses stdout, metadata                                   │
│     - Generates user-facing response                            │
│     - Streams response back to UI                               │
│                                                                 │
│     Example:                                                    │
│     "I ran the backtest for 2024 and the results look          │
│      promising! Your strategy achieved a 15.2% return with     │
│      a Sharpe ratio of 1.85. The equity curve shows steady     │
│      growth with manageable drawdowns. Check the chart →"      │
└─────────────────────┬───────────────────────────────────────────┘
                      │ IPC send('llm-stream')
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 12. UI UPDATES (ChatArea.tsx)                                  │
│     A. MESSAGE DISPLAY                                          │
│        - Gemini's text appears in chat                          │
│        - Directives stripped from display                       │
│                                                                 │
│     B. DIRECTIVE PROCESSING (lines 290-365)                     │
│        useEffect(() => {                                        │
│          onClaudeCodeDirectives((event) => {                    │
│            const fullOutput = event.rawOutput; ← FIXED         │
│                                                                 │
│            // Parse data-driven directives                      │
│            const chart = parseChartDirective(fullOutput);       │
│            if (chart) displayContext.showChart(chart);          │
│                                                                 │
│            const metrics = parseMetricsDirective(fullOutput);   │
│            if (metrics) displayContext.showMetrics(metrics);    │
│                                                                 │
│            const table = parseTableDirective(fullOutput);       │
│            if (table) displayContext.showTable(table);          │
│          })                                                     │
│        }, [])                                                   │
│                                                                 │
│     C. RESEARCH JOURNEY PANEL UPDATES                           │
│        • Charts rendered in right panel                         │
│        • Metrics displayed as cards                             │
│        • Tables shown in expandable sections                    │
│        • TODO items added to task list                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Structure Flow

### Step 3: Gemini Function Call

```json
{
  "functionCall": {
    "name": "execute_via_claude_code",
    "args": {
      "task": "Run backtest for SPY strategy with 2024 data",
      "context": "User wants to test their new options strategy on recent market data to see if it would have performed well during the 2024 bull run.",
      "parallel_hint": "none"
    }
  }
}
```

### Step 7: Claude Code Output (stdout)

```
I've run the backtest for your SPY options strategy using 2024 data. Here are the results:

[DISPLAY_METRICS: {
  "title": "Backtest Performance",
  "metrics": [
    {"name": "Total Return", "value": "15.2%", "status": "good"},
    {"name": "Sharpe Ratio", "value": 1.85, "status": "good"},
    {"name": "Max Drawdown", "value": "-8.3%", "status": "warning"},
    {"name": "Win Rate", "value": "68%", "status": "good"}
  ]
}]

[DISPLAY_CHART: {
  "type": "line",
  "title": "Equity Curve - 2024",
  "data": {
    "series": [{
      "name": "Strategy",
      "values": [
        ["2024-01-01", 100000],
        ["2024-03-31", 108200],
        ["2024-06-30", 112500],
        ["2024-09-30", 114800],
        ["2024-12-31", 115200]
      ]
    }]
  }
}]

[TODO_ADD:Analysis:Review drawdown periods in detail]

The strategy performed well overall, capturing the bull market gains while maintaining reasonable risk metrics. The 15.2% return exceeded the S&P 500's 13.8% return for the same period, with a Sharpe ratio of 1.85 indicating strong risk-adjusted returns.
```

### Step 9: Structured Response to Gemini

```json
{
  "type": "claude-code-execution",
  "status": "success",
  "exitCode": 0,
  "duration": 12450,
  "stdout": "[Full output from Claude Code above]",
  "stderr": "",
  "timestamp": "2024-12-01T10:30:45.123Z",
  "directives": [
    {
      "type": "display_metrics",
      "data": {
        "title": "Backtest Performance",
        "metrics": [...]
      }
    },
    {
      "type": "display_chart",
      "data": {
        "type": "line",
        "title": "Equity Curve - 2024",
        ...
      }
    },
    {
      "type": "todo_add",
      "category": "Analysis",
      "description": "Review drawdown periods in detail"
    }
  ],
  "metadata": {
    "hasContext": true,
    "parallelHint": "none",
    "taskLength": 52,
    "contextLength": 147,
    "directiveCount": 3,
    "wasTruncated": false
  }
}
```

### Step 12: UI State After Updates

```javascript
// ChatArea message
{
  id: "msg-123",
  role: "assistant",
  content: "I've run the backtest for your SPY options strategy...",
  // Directives stripped - user sees clean text
}

// ResearchDisplayContext state
{
  charts: [
    {
      id: "chart-456",
      type: "line",
      title: "Equity Curve - 2024",
      data: { series: [...] }
    }
  ],
  metrics: [
    {
      id: "metrics-789",
      title: "Backtest Performance",
      metrics: [
        { name: "Total Return", value: "15.2%", status: "good" },
        ...
      ]
    }
  ],
  tasks: [
    {
      id: "task-012",
      category: "Analysis",
      description: "Review drawdown periods in detail",
      status: "pending"
    }
  ]
}
```

---

## Error Flow

```
CLAUDE CODE FAILS
      │
      ▼
┌─────────────────────────────────────────────┐
│ stderr: "FileNotFoundError: backtest.py"    │
│ exitCode: 1                                 │
│ stdout: "Error running backtest..."         │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│ toolHandlers.ts                             │
│ - Captures stderr                           │
│ - Sets status: "failure"                    │
│ - Records in circuit breaker                │
│ - Returns error response                    │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│ Gemini Receives Error                       │
│ - Parses error message                      │
│ - Generates helpful response:               │
│   "The backtest failed because the script   │
│    couldn't be found. The file backtest.py  │
│    should be in python/ directory."         │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│ UI Shows Error                              │
│ - Error message in chat                     │
│ - ErrorCard component displays details      │
│ - Suggestion shown to user                  │
└─────────────────────────────────────────────┘
```

---

## Circuit Breaker State Machine

```
              [SUCCESS]
                  │
                  ▼
┌─────────────────────────────────┐
│  CLOSED (Normal Operation)      │
│  failureCount: 0                │
│  shouldExecute: true             │
└────────┬────────────────────────┘
         │
    [FAILURE]
         │
         ▼
┌─────────────────────────────────┐
│  CLOSED (1 Failure)             │
│  failureCount: 1                │
│  shouldExecute: true             │
└────────┬────────────────────────┘
         │
    [FAILURE]
         │
         ▼
┌─────────────────────────────────┐
│  CLOSED (2 Failures)            │
│  failureCount: 2                │
│  shouldExecute: true             │
└────────┬────────────────────────┘
         │
    [FAILURE]
         │
         ▼
┌─────────────────────────────────┐
│  OPEN (Circuit Breaker Active)  │
│  failureCount: 3                │
│  shouldExecute: false            │
│  Error: "Circuit breaker OPEN"  │
│  timeUntilReset: 300000ms       │
└────────┬────────────────────────┘
         │
    [WAIT 5 MIN]
         │
         ▼
┌─────────────────────────────────┐
│  HALF-OPEN (Testing)            │
│  failureCount: 3 (not reset)    │
│  shouldExecute: true             │
└────────┬────────────────────────┘
         │
         ├─[SUCCESS]─────────────►[CLOSED: Reset count to 0]
         │
         └─[FAILURE]─────────────►[OPEN: Restart 5 min timer]
```

---

## Files Involved

### Core Integration Files

| File | Role | Lines of Interest |
|------|------|-------------------|
| `src/electron/tools/toolDefinitions.ts` | Tool definition for Gemini | 669-696 |
| `src/electron/tools/toolHandlers.ts` | Execution handler | 2437-2777 |
| `src/electron/ipc-handlers/llmClient.ts` | Gemini client | 331-1006 |
| `src/components/chat/ChatArea.tsx` | Frontend listener | 286-370 |
| `src/lib/displayDirectiveParser.ts` | Directive parsing | 46-509 |
| `src/electron/preload.ts` | IPC bridge | 134-143 |

### Supporting Files

| File | Role |
|------|------|
| `src/electron/utils/claudeCodeExecutor.ts` | Execution lifecycle manager |
| `src/contexts/ResearchDisplayContext.tsx` | UI state management |
| `src/components/research/*` | UI components for directives |

---

## Key Design Decisions

### 1. Why Visible Terminal?

**Pros:**
- User can monitor progress
- Transparency builds trust
- Easy debugging (see what Claude Code does)
- User can cancel via Ctrl+C

**Cons:**
- Requires macOS (AppleScript)
- Window management overhead

**Alternative:** Background execution (fallback implemented)

### 2. Why Circuit Breaker?

**Prevents:**
- Cascade failures (Claude Code unavailable → spam retries)
- Resource exhaustion (rapid Terminal spawns)
- User frustration (repeated failures)

**Configuration:**
- 3 failures → Open
- 5 minute reset
- Success → Immediate reset

### 3. Why Structured JSON Response?

**Enables:**
- Programmatic parsing by Gemini
- Metadata tracking (duration, exit code)
- Directive extraction
- Error handling

**Alternative:** Raw text would force Gemini to parse unstructured output

### 4. Why Directive System?

**Enables:**
- Real-time UI updates
- Separation of data and presentation
- Claude Code → UI direct communication
- Gemini doesn't need to parse data for charts

**Trade-off:** More complex integration (worth it for UX)

---

## Performance Characteristics

| Metric | Typical | Max | Notes |
|--------|---------|-----|-------|
| **Tool call latency** | 0.5-2s | 5s | Time from Gemini decision to Terminal open |
| **Claude Code execution** | 5-30s | 10min | Depends on task complexity |
| **Polling overhead** | ~1s | 10min | Checks every second for output |
| **Directive parsing** | <10ms | 100ms | Depends on output size |
| **UI update latency** | <50ms | 200ms | IPC + React render time |
| **Memory overhead** | 50-200MB | 500MB | Terminal + Claude Code process |

---

## Security Boundaries

```
┌─────────────────────────────────────────────┐
│ UNTRUSTED INPUT (User message)             │
└─────────────────┬───────────────────────────┘
                  │
                  ▼ Validated by Zod schema
┌─────────────────────────────────────────────┐
│ GEMINI (Tool decision)                      │
└─────────────────┬───────────────────────────┘
                  │
                  ▼ Tool args extracted
┌─────────────────────────────────────────────┐
│ HANDLER (Input validation)                  │
│ • Size limits                               │
│ • Enum validation                           │
│ • Markdown fencing (injection prevention)   │
└─────────────────┬───────────────────────────┘
                  │
                  ▼ Sandboxed execution
┌─────────────────────────────────────────────┐
│ CLAUDE CODE (Working directory validated)   │
│ • Must have .git, package.json, or python/  │
│ • Path resolved (no symlink attacks)        │
└─────────────────┬───────────────────────────┘
                  │
                  ▼ Output sanitized
┌─────────────────────────────────────────────┐
│ DIRECTIVE PARSER (Validation)               │
│ • Type checking                             │
│ • Schema validation                         │
└─────────────────┬───────────────────────────┘
                  │
                  ▼ Rendered safely
┌─────────────────────────────────────────────┐
│ UI (React components)                       │
│ • Props validated                           │
│ • XSS prevention                            │
└─────────────────────────────────────────────┘
```

---

**End of Architecture Diagram**

For implementation details, see:
- Full audit: `GEMINI_CLAUDE_HANDOFF_AUDIT.md`
- Quick fixes: `HANDOFF_QUICK_FIXES.md`
- Test checklist: `HANDOFF_TEST_CHECKLIST.md`
