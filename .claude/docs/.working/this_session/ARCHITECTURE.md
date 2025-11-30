# Quant Engine Architecture
**Last Updated:** 2025-11-30
**Status:** CURRENT - Reflects production implementation

---

## Overview

**Quant Engine** is a desktop quantitative trading research system combining:

- **Frontend:** React 18 + TypeScript + Electron (NOT Lovable - full desktop app)
- **Backend:** Python Flask API + backtesting engine (merged into `python/` directory)
- **AI System:** Multi-model architecture (Gemini → Claude Code CLI → DeepSeek)
- **Memory:** Dual-Supabase (Claude general + Quant domain-specific)
- **Database:** Supabase (PostgreSQL + pgvector)

**Purpose:** AI-powered quantitative research system that can replace an entire hedge fund's research department.

---

## Multi-Model AI Architecture (10X System)

### Three-Tier Intelligence

```
┌─────────────────────────────────────────────────────────────┐
│                      GEMINI 3 PRO                            │
│                   "The Mathematician"                        │
│              (API - $2.50/1M input, $10/1M output)          │
│                                                              │
│  • Complex mathematical reasoning                            │
│  • Alpha hypothesis generation                               │
│  • Strategy formulation                                      │
│  • Statistical analysis                                      │
│                                                              │
│  Tool: execute_via_claude_code(task, context, parallel_hint)│
└──────────────────────────┬──────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                  CLAUDE CODE CLI                             │
│                  "The Orchestrator"                          │
│              (Claude Max subscription - fixed cost)          │
│                                                              │
│  ROUTING STRATEGY:                                           │
│  ├─► Direct execution (single tasks)                        │
│  ├─► Claude native agents (2-5 parallel, free with Max)    │
│  └─► DeepSeek agents (5+ parallel, cost-efficient)         │
│                                                              │
│  Tools: bash, python, file operations, git, agent spawning  │
└──────────────────────────┬──────────────────────────────────┘
                           │ (Only for MASSIVE parallel)
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
   │ DeepSeek    │  │ DeepSeek    │  │ DeepSeek    │
   │ Agent 1     │  │ Agent 2     │  │ Agent N     │
   │ ($0.14/1M)  │  │ ($0.14/1M)  │  │ ($0.14/1M)  │
   └─────────────┘  └─────────────┘  └─────────────┘
```

**Cost Structure:**
- Gemini: Only for reasoning (pay per token)
- Claude Code: Fixed monthly cost (Max subscription)
- DeepSeek: Only for massive parallelization (pennies)
- **Total savings: 60-70% vs all-API**

**Tool Routing Decision Matrix:**
| Task Type | Tool | Cost | Speed |
|-----------|------|------|-------|
| Read/search code | Gemini direct (read_file) | Free | Instant |
| Run existing script | Gemini direct (run_python_script) | Free | Fast |
| Create/modify code | execute_via_claude_code (hint='none') | Fixed | ~30s |
| Small parallel (2-5) | execute_via_claude_code (hint='minor') | Fixed | ~20s |
| MASSIVE parallel (50+) | execute_via_claude_code (hint='massive') | ~$0.50 | ~60s |

---

## Application Architecture

### Desktop App (Electron)

```
┌─────────────────────────────────────────────────────────────┐
│                     REACT RENDERER                           │
│                  (src/components/, src/pages/)              │
│                                                              │
│  • Chat interface (MessageCard with model badges)           │
│  • Quant panel (backtests, strategy management)             │
│  • Memory browser (semantic search, notes)                  │
│  • Dashboard (system status, health)                        │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC (contextBridge)
┌──────────────────────────┴──────────────────────────────────┐
│                  ELECTRON MAIN PROCESS                       │
│                  (src/electron/main.ts)                      │
│                                                              │
│  IPC Handlers:                                               │
│  ├─► llmClient.ts - Gemini API, tool calling, streaming    │
│  ├─► fileOperations.ts - Sandboxed file access             │
│  ├─► pythonExecution.ts - Python subprocess management     │
│  ├─► memoryHandlers.ts - Memory daemon coordination        │
│  └─► daemonManager.ts - Background research daemon         │
│                                                              │
│  Tool System:                                                │
│  ├─► toolDefinitions.ts - Gemini function declarations     │
│  └─► toolHandlers.ts - executeViaClaudeCode, agents, etc.  │
└──────────────────────────┬──────────────────────────────────┘
                           │ subprocess spawn
┌──────────────────────────┴──────────────────────────────────┐
│                     PYTHON BACKEND                           │
│                     (python/)                                │
│                                                              │
│  • server.py - Flask API (port 5000)                        │
│  • daemon.py - Background research worker                   │
│  • engine/ - Core modules:                                  │
│    ├─► engine/api/routes.py - API endpoints                │
│    ├─► engine/analysis/ - Regime detection, metrics        │
│    ├─► engine/trading/ - Strategy execution, simulation    │
│    ├─► engine/pricing/ - Options pricing, Greeks           │
│    └─► engine/data/ - Data loading, events                 │
│  • scripts/ - Analysis scripts, backtesting                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Dual-Supabase Memory System

### Memory Bridge Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CLAUDE CODE SUPABASE                     │
│                  (cbohxvsvjbtxzxpyepso)                      │
│                                                              │
│  • General lessons (applies to ALL projects)                 │
│  • Cross-project patterns                                    │
│  • Identity and behavioral rules                             │
│  • Non-quant work memories                                   │
│                                                              │
│  LOW VOLUME, HIGH SIGNAL, GENERAL PURPOSE                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     QUANT ENGINE SUPABASE                    │
│                  (ynaqtawyynqikfyranda)                      │
│                                                              │
│  • Alpha hypotheses and strategies                           │
│  • Backtest results and analysis                             │
│  • Regime classifications                                    │
│  • Options data, Greeks, volatility surfaces                 │
│  • session_contexts (multi-model coordination)              │
│                                                              │
│  HIGH VOLUME, DOMAIN SPECIFIC, QUANT ONLY                    │
└─────────────────────────────────────────────────────────────┘
```

**Session Behavior:**
- **Session Start:** Load from BOTH databases (dual query)
- **During Session:** Write to Quant Supabase (session_contexts table)
- **Session End:** Classify and route:
  - `scope='global'` → Claude Supabase (transferable lessons)
  - `scope='project'` → Quant Supabase (domain-specific)

**Implementation:**
- `~/.claude/scripts/memory-retriever` - Dual-Supabase query with `--supabase both`
- `~/.claude/scripts/memory-writer.py` - Dual-write classification
- `~/.claude/hooks/session-start-memory-recall.sh` - Auto-detection of quant-engine

---

## Key Database Tables

### Quant Engine Supabase

**session_contexts** - Multi-model coordination
```sql
id UUID PRIMARY KEY
session_id UUID NOT NULL
model TEXT ('gemini', 'claude', 'deepseek', 'system')
role TEXT ('reasoning', 'execution', 'analysis', 'orchestration', 'error')
content TEXT NOT NULL
summary TEXT
tool_calls JSONB DEFAULT '[]'
tokens_used INTEGER
latency_ms INTEGER
created_at TIMESTAMPTZ DEFAULT NOW()
```

**backtest_runs** - Backtest execution tracking
```sql
id UUID PRIMARY KEY
session_id UUID REFERENCES chat_sessions(id)
strategy_key TEXT NOT NULL
params JSONB (startDate, endDate, capital)
status TEXT ('pending', 'running', 'completed', 'failed')
metrics JSONB (cagr, sharpe, max_drawdown, win_rate, total_trades)
equity_curve JSONB
engine_source TEXT ('python-engine', 'stub', 'stub_fallback', 'external')
```

**memory_notes** - Knowledge base
```sql
id UUID PRIMARY KEY
workspace_id UUID REFERENCES workspaces(id)
run_id UUID REFERENCES backtest_runs(id)
content TEXT NOT NULL
memory_type TEXT ('insight', 'rule', 'warning', 'todo', 'bug')
importance TEXT ('low', 'normal', 'high', 'critical')
tags TEXT[]
embedding vector(1536)
archived BOOLEAN DEFAULT false
```

---

## File System Structure

```
quant-engine/
├── python/                    # Python backtesting engine (merged rotation-engine)
│   ├── server.py             # Flask API (port 5000)
│   ├── daemon.py             # Research daemon
│   ├── requirements.txt      # Python dependencies
│   ├── engine/               # Core modules
│   │   ├── api/             # API routes
│   │   ├── analysis/        # Regime detection, metrics
│   │   ├── trading/         # Strategy execution
│   │   ├── pricing/         # Options pricing
│   │   └── data/            # Data loaders
│   ├── scripts/             # Analysis scripts
│   └── utils/               # Utilities
│
├── src/                      # React + Electron frontend
│   ├── components/          # UI components
│   │   ├── chat/           # Chat interface, MessageCard
│   │   ├── quant/          # Backtest UI, strategy cards
│   │   ├── memory/         # Memory browser
│   │   └── dashboard/      # System status
│   ├── electron/            # Electron main process
│   │   ├── ipc-handlers/   # IPC communication
│   │   ├── tools/          # Tool system (Gemini function calling)
│   │   └── memory/         # Memory daemon integration
│   ├── prompts/             # LLM system prompts
│   │   └── chiefQuantPrompt.ts  # Includes multi-model routing guidance
│   ├── integrations/        # Supabase client
│   └── config/              # Model configuration
│
├── scripts/                  # Tool scripts
│   └── deepseek_agent.py    # DeepSeek agents with tool access
│
├── supabase/                 # Supabase configuration
│   ├── migrations/          # Database schema
│   │   ├── 20251130000000_add_session_contexts.sql
│   │   └── 20251130000001_add_foreign_keys_and_indexes.sql
│   └── functions/           # Edge functions (Deno runtime)
│       ├── chat-primary/    # Gemini chat endpoint
│       ├── helper-chat/     # Helper chat
│       ├── backtest-run/    # Run backtests
│       └── memory-*/        # Memory operations
│
├── .claude/                  # Project documentation & config
│   ├── docs/                # Current documentation
│   │   ├── ARCHITECTURE.md  # This file
│   │   ├── MULTI_MODEL_ARCHITECTURE_PLAN.md
│   │   ├── AUDIT_IMPROVEMENTS.md
│   │   ├── FULL_SYSTEM_AUDIT.md
│   │   └── archive/        # Historical audit docs
│   └── MERGER_PLAN.md      # Historical: rotation-engine merger
│
├── README.md                 # Public-facing docs
├── CLAUDE.md                 # Claude Code guidance
├── SESSION_STATE.md          # Current session state (second brain)
└── HANDOFF.md                # Session handoff notes (second brain)
```

**Key Points:**
- Python backend is IN this repo (`python/` directory)
- No separate rotation-engine repository
- No `rotation-engine-bridge/` subdirectory (old reference, now removed)
- All Python code merged and self-contained

---

## Multi-Model Workflow

### User Request Flow

```
1. User: "Analyze regime transitions and build a strategy"
         ↓
2. Gemini (Reasoning):
   • Determines what mathematical analysis is needed
   • Designs the statistical approach
   • Decides what code needs to be written
   • Calls: execute_via_claude_code(task, context, parallel_hint)
         ↓
3. Claude Code CLI (Execution):
   • Receives task + Gemini's reasoning context
   • Writes Python code (strategy, analyzer, tests)
   • Runs tests to verify
   • If parallel_hint='massive': spawns DeepSeek agents
   • Returns structured JSON results
         ↓
4. DeepSeek Agents (if massive parallel needed):
   • Analyze 6 regimes simultaneously
   • Run 50-parameter sweeps in parallel
   • Bulk data processing
   • Results aggregated by Claude Code
         ↓
5. Gemini (Synthesis):
   • Receives execution results
   • Interprets findings
   • Provides strategic recommendations
   • Saves causal chains to memory
```

**Tool: execute_via_claude_code**
```typescript
{
  name: 'execute_via_claude_code',
  parameters: {
    task: string,           // What to execute
    context: string,        // Gemini's reasoning (optional)
    parallel_hint: 'none' | 'minor' | 'massive'  // Agent strategy
  }
}
```

**Parallel Strategy:**
- `none`: Claude handles directly
- `minor`: Claude spawns 2-5 Claude native agents (free with Max)
- `massive`: Claude spawns DeepSeek agents via `python scripts/deepseek_agent.py`

---

## Data Flow

### React → Electron → Python

```
React Component
    ↓ window.api.someMethod() (preload.ts exposes)
Electron IPC Handler
    ↓ spawn('python3', ['server.py', ...])
Python Flask API
    ↓ engine/api/routes.py
Python Engine Modules
    ↓ Returns JSON
Electron receives
    ↓ IPC response
React updates UI
```

### Gemini → Claude Code Bridge

```
Gemini decides execution needed
    ↓ execute_via_claude_code tool call
toolHandlers.ts: executeViaClaudeCode()
    ↓ spawnSync('claude', ['--print', '-p', prompt])
Claude Code CLI executes
    ↓ Returns stdout
Gemini receives structured JSON
    ↓ Synthesizes results
User sees final analysis
```

---

## Memory System

### Dual-Database Strategy

**When in quant-engine directory:**
1. Session starts → Queries BOTH Supabases
2. Work happens → Writes to Quant Supabase (session_contexts)
3. Session ends → Classifies memories:
   - General lessons → Claude Supabase
   - Domain-specific → Quant Supabase

**Implementation Files:**
- `~/.claude/.env` - Contains credentials for both databases
- `~/.claude/scripts/memory-retriever` - Dual-query capability
- `~/.claude/scripts/memory-writer.py` - Dual-write classification
- `~/.claude/hooks/session-start-memory-recall.sh` - Project-aware loading

**Project Detection:**
```python
def is_quant_project():
    cwd = os.getcwd()
    return "quant-engine" in cwd or os.path.exists("python/engine")
```

---

## Python Backend

### Flask API Server

**File:** `python/server.py`
**Port:** 5000
**Endpoints:**
- `/health` - Health check
- `/api/backtest` - Run backtest
- `/regimes` - Regime heatmap
- `/strategies` - List strategies
- `/strategies/<id>` - Strategy details
- `/simulate` - Scenario simulation

### Background Daemon

**File:** `python/daemon.py`
**Purpose:** Background research tasks
**Management:** Via `src/electron/ipc-handlers/daemonManager.ts`

### Core Engine Modules

**engine/analysis/**
- `regime_engine.py` - Market regime classification
- `metrics.py` - Performance metrics calculation
- `trade_tracker.py` - Trade-level tracking

**engine/trading/**
- `simulator.py` - Backtest simulation
- `execution.py` - Execution model (spreads, slippage)
- `exit_engine.py` - Exit strategy logic
- `profiles/` - Convexity profiles (Profile 1-6)

**engine/pricing/**
- `greeks.py` - Options Greeks calculation

**engine/data/**
- `loaders.py` - Data loading utilities
- `polygon_options.py` - Polygon.io integration
- `events.py` - Corporate events, earnings

---

## Tool System (Gemini Function Calling)

### Tool Categories

**CLAUDE_TOOLS** - Multi-model execution
- `execute_via_claude_code` - Delegate to Claude Code CLI

**FILE_TOOLS** - File operations
- `read_file`, `write_file`, `list_directory`, `search_code`

**PYTHON_TOOLS** - Python execution
- `run_python_script`, `manage_environment` (pip)

**GIT_TOOLS** - Version control
- `git_status`, `git_diff`, `git_commit`, etc.

**QUANT_TOOLS** - Backtesting
- `batch_backtest`, `sweep_params`, `cross_validate`
- `get_regime_heatmap`, `list_strategies`, `run_simulation`

**AGENT_TOOLS** - Agent spawning
- `spawn_agent` - Single DeepSeek agent
- `spawn_agents_parallel` - Multiple DeepSeek agents

**Tool execution:** `toolHandlers.ts:executeTool()` dispatches to specific handlers

---

## Configuration

### Environment Variables

**Electron Main Process:**
```
GEMINI_API_KEY          # Google AI API
OPENAI_API_KEY          # OpenAI (embeddings)
DEEPSEEK_API_KEY        # DeepSeek agents
VITE_SUPABASE_URL       # Quant Supabase project
VITE_SUPABASE_PUBLISHABLE_KEY  # Quant Supabase anon key
```

**Claude Code (in ~/.claude/.env):**
```
SUPABASE_PASSWORD       # Claude Supabase DB password
SUPABASE_URL            # cbohxvsvjbtxzxpyepso
QUANT_SUPABASE_PASSWORD # Quant Supabase DB password
QUANT_SUPABASE_URL      # ynaqtawyynqikfyranda
OPENAI_API_KEY          # For embeddings
```

### Model Configuration

**File:** `src/config/models.ts`
```typescript
PRIMARY: {
  provider: 'google',
  model: 'gemini-3-pro-preview',
  description: 'Chief Quant - complex reasoning'
}
SWARM: {
  provider: 'deepseek',
  model: 'deepseek-reasoner',
  description: 'Parallel agents'
}
HELPER: {
  provider: 'openai',
  model: 'gpt-4o-mini',
  description: 'Quick responses'
}
```

---

## Build System

### Development

```bash
npm run electron:dev    # Hot reload (Vite + Electron)
cd python && python server.py  # Start Flask API
```

### Production Build

```bash
npm run electron:build  # Creates DMG in release/
```

**Output:**
- `release/Quant Chat Workbench-1.0.0-arm64.dmg`
- `release/Quant Chat Workbench-1.0.0-arm64-mac.zip`

**Build Process:**
1. `vite build` → React bundle in `dist/`
2. `vite build --config vite.config.electron.ts` → Electron main in `dist-electron/`
3. `electron-builder` → Packaged app in `release/`

---

## Security Model

### Implemented (2025-11-30)

✅ **Environment variable whitelisting** - Only safe vars passed to subprocesses
✅ **Prompt injection defense** - Markdown code fencing for task/context
✅ **Command whitelisting** - runCommand() only allows approved commands
✅ **Path validation** - Symlink-aware path resolution
✅ **Circuit breaker** - Prevents cascade failures (Claude Code)
✅ **Input validation** - Length, empty, enum checks

### Subprocess Security

**executeViaClaudeCode:**
```typescript
const safeEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  USER: process.env.USER,
  TMPDIR: process.env.TMPDIR,
  NODE_ENV: process.env.NODE_ENV
  // NO API KEYS OR SECRETS
};
```

**spawnAgent (DeepSeek):**
```typescript
const safeEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY  // Only what's needed
  // NO OTHER SECRETS
};
```

---

## UI Components

### Model Indicators

Messages display which AI model generated the response:
- 🧠 **Gemini** (emerald) - "Reasoning"
- ⚡ **Claude** (orange) - "Execution"
- 🔀 **DeepSeek** (cyan) - "Parallel"

**Implementation:**
- `MessageCard.tsx` - Memoized component with model badges
- `ChatArea.tsx` - detectModel() function auto-detects from content

### Core Components

**Chat Interface:**
- `ChatArea.tsx` - Main chat with tool visibility
- `MessageCard.tsx` - Individual messages with model badges
- `ChatSessionList.tsx` - Session management

**Quant Panel:**
- `QuantPanel.tsx` - Strategy selection, backtest form, results
- `ExperimentBrowser.tsx` - Run history
- `RunComparisonPanel.tsx` - Side-by-side comparison

**Memory:**
- `MemoryPanel.tsx` - Note creation, search, filtering

**Dashboard:**
- `SystemStatus.tsx` - Health monitoring
- `BacktestRunner.tsx` - Quick backtest interface

---

## Development Patterns

### IPC Handler Pattern

```typescript
// In main.ts
registerLlmHandlers();
registerFileOperationHandlers();
registerPythonExecutionHandlers();

// In each handler file
export function registerXyzHandlers() {
  ipcMain.handle('some-channel', async (_event, args) => {
    // Validate with Zod schema
    const validated = validateIPC(SomeSchema, args, 'description');
    // Execute operation
    // Return result
  });
}
```

### Tool Handler Pattern

```typescript
// Tool definition (toolDefinitions.ts)
{
  name: 'tool_name',
  description: '...',
  parameters: { /* FunctionDeclaration schema */ }
}

// Tool handler (toolHandlers.ts)
export async function toolName(arg1, arg2): Promise<ToolResult> {
  return {
    success: boolean,
    content: string,
    error?: string,
    metadata?: any
  };
}

// Dispatcher (toolHandlers.ts:executeTool)
case 'tool_name':
  return toolName(args.arg1, args.arg2);
```

---

## Testing

**Manual Testing:**
1. `npm run electron:dev` - Full app with hot reload
2. `python server.py` - Test Python API endpoints
3. Browser DevTools + Electron DevTools for debugging

**Verification:**
- TypeScript: `npx tsc --noEmit`
- Linting: `npm run lint`
- Build: `npm run electron:build`

---

## Recent Major Changes (2025-11-30)

1. **Multi-model architecture** - Complete Gemini → Claude Code → DeepSeek pipeline
2. **Dual-Supabase memory** - Isolated general vs domain-specific memories
3. **21 audit improvements** - Security hardening, performance, validation
4. **19 critical bug fixes** - TypeScript errors, React bugs, Python issues, security
5. **Directory cleanup** - Removed 31 stale docs, fixed rotation-engine-bridge references

---

## Cost Optimization

**Per-Session Estimate (Heavy Use):**
- Gemini API: $0.50-2.00 (reasoning only)
- Claude Max: $0.00 (fixed monthly subscription)
- DeepSeek: $0.10-0.50 (massive parallel only)
- **Total: $0.60-2.50 per session**

**vs. All-API Approach:**
- Would be: $2.00-8.00 per session
- **Savings: 60-70%**

---

**This document reflects the ACTUAL current architecture as of 2025-11-30.**
**For historical context, see `.claude/docs/archive/`**
