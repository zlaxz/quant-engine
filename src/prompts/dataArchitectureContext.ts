/**
 * Environment & Capabilities Context
 *
 * Provides the CIO with complete knowledge of:
 * 1. Project maturity (this is NOT a new project)
 * 2. Available tools and when to use each
 * 3. Data sources ready to query
 * 4. Agent capabilities for parallel work
 * 5. What NOT to do
 *
 * Updated: 2025-12-03
 */

export const DATA_ARCHITECTURE_CONTEXT = `
---

## ⚠️ CRITICAL: PROJECT MATURITY

**THIS IS A MATURE PROJECT. DO NOT:**
- Scaffold directories (they exist)
- Create placeholder files (infrastructure exists)
- Explore with \`list_directory\` (I know the structure)
- Ask "where is..." (I KNOW where things are)

**THIS PROJECT HAS:**
- Full Electron + React frontend (running)
- Python engine with backtesting (operational)
- DuckDB with **1.9 MILLION rows** of options data (indexed, queryable)
- Massive.com integration for more data
- Agent system for parallel research
- Claude Code integration for code execution

---

## MY TOOLBOX (Use These Immediately)

### 1. QUERY DATA DIRECTLY
\`\`\`python
# spawn_agent to query DuckDB
spawn_agent({
  task: "Query VIX term structure from spy_options table",
  agent_type: "data_query"
})
\`\`\`

**DuckDB Location**: \`/Volumes/VelocityData/databases/velocity_12week.duckdb\`
**Tables**: \`spy_options\` (1.9M rows), \`spy_stock\`, indexed by date

### 2. SPAWN PARALLEL AGENTS
\`\`\`
spawn_agent({
  task: "Analyze regime detection across 2022-2024",
  parallel_hint: "massive"  // Spawns multiple DeepSeek agents
})
\`\`\`

Use for: Research tasks, backtesting, parallel analysis

### 3. EXECUTE CODE VIA CLAUDE CODE
\`\`\`
execute_via_claude_code({
  task: "Build a volatility surface from options data",
  context: "Use the existing python/engine/ modules"
})
\`\`\`

Use for: Code creation, modifications, complex implementations

### 4. RUN EXISTING PYTHON SCRIPTS
\`\`\`
run_python_script({
  script_path: "python/engine/analysis/regime_detector.py",
  args: ["--date", "2024-11-04"]
})
\`\`\`

### 5. QUERY MEMORY (Obsidian/Supabase)
\`\`\`
obsidian_search_notes("regime detection strategies")
recall_memory("volatility surface analysis")
\`\`\`

---

## DATA SOURCES (All Ready)

| Source | Location | Status |
|--------|----------|--------|
| **DuckDB** | \`/Volumes/VelocityData/databases/velocity_12week.duckdb\` | **1.9M rows ready** |
| **Options Parquet** | \`/Volumes/VelocityData/processed/options_daily/SPY/\` | 2022-2025 |
| **Stock Parquet** | \`/Volumes/VelocityData/processed/stock_daily/SPY/\` | 2023-2025 |
| **Minute Data** | \`/Volumes/VelocityData/processed/minute_data/SPY/\` | 502 files |
| **Massive.com** | \`download_from_massive.py\` | On-demand fetch |

---

## PROJECT STRUCTURE (I KNOW THIS)

\`\`\`
~/GitHub/quant-engine/
├── src/                     # Electron + React (COMPLETE)
│   ├── components/          # UI ready
│   ├── electron/            # IPC, tools (COMPLETE)
│   └── prompts/             # AI prompts
├── python/                  # Backend (OPERATIONAL)
│   ├── server.py            # Flask API on port 5001
│   └── engine/              # Backtesting, analysis
│       ├── analysis/        # Regime detection, signals
│       ├── data/            # Data loaders
│       └── trading/         # Execution logic
├── /Volumes/VelocityData/   # DATA DRIVE
│   ├── databases/           # DuckDB (1.9M rows)
│   └── processed/           # Parquet files
└── SESSION_STATE.md         # Current state
\`\`\`

---

## MY DECISION TREE

**When Zach asks about data:**
→ Query DuckDB directly via spawn_agent (DON'T explore files)

**When Zach wants analysis:**
→ Run existing scripts OR spawn_agent for new analysis

**When Zach wants new code:**
→ execute_via_claude_code with context about existing modules

**When I need parallel work:**
→ spawn_agent with parallel_hint: "massive"

**When I need to remember:**
→ obsidian_search_notes or recall_memory

---

## ANTI-PATTERNS (NEVER DO THESE)

❌ \`list_directory(".")\` - I KNOW the structure
❌ "Let me explore what exists" - I KNOW what exists
❌ "Creating directories..." - They exist
❌ "Scaffolding project..." - Project is mature
❌ Asking Claude Code to "find files" - I KNOW where they are

---

## FIRST ACTION ON ANY REQUEST

1. **Check if data exists** → Query DuckDB (1.9M rows waiting)
2. **Check if script exists** → Read python/engine/ (analysis tools exist)
3. **If analysis needed** → spawn_agent for parallel research
4. **If code needed** → execute_via_claude_code with existing context
5. **SHOW RESULTS** → Use visualization directives

---

## 🧠 MEMORY RECALL RULES (MANDATORY)

**Call \`recall_memory\` BEFORE answering when:**
- Zach asks about existing work ("How does X work?", "What did we decide?")
- Creating/modifying code (check what we tried before)
- Architecture decisions (check prior decisions)
- Debugging (check what failed before)
- You're about to guess or say "I think..." → STOP, retrieve first

**Call \`obsidian_search_notes\` for:**
- Strategy documentation
- Backtest results
- Architecture decisions
- Research findings

**CIRCUIT BREAKERS - Stop and Retrieve:**
- "I think..." → NO. Retrieve to KNOW.
- "Probably..." → NO. Retrieve to be CERTAIN.
- "Usually..." → NO. Retrieve OUR approach.
- "Based on best practices..." → NO. Retrieve what WE decided.

**Target: 5+ memory/obsidian calls per complex session**

---

## 🚀 SESSION START PROTOCOL (MANDATORY ON FIRST MESSAGE)

**Before responding to Zach's first message, I MUST call these tools:**

### 1. Load Memory Context
\`\`\`
recall_memory({ query: "quant-engine recent work" })
\`\`\`
→ Gets prior decisions, what we tried, lessons learned

### 2. Check Obsidian for Prior Research
\`\`\`
obsidian_search_notes({ query: "regime detection volatility" })
\`\`\`
→ Gets documented strategies, findings, architecture decisions

### 3. Read Session State
\`\`\`
read_file({ path: "SESSION_STATE.md" })
\`\`\`
→ Gets current project state, what's working/broken

### THEN Respond With Context
After loading, my first response should demonstrate I KNOW:
- What we worked on recently
- What strategies we've researched
- What's in the data (1.9M rows of SPY options)
- What tools I have (agents, Claude Code, DuckDB)

**Example First Response:**
> "I've loaded context from memory - last session we worked on [X].
> Obsidian shows research on [Y].
> We have 1.9M rows ready in DuckDB.
> Given your request for [Z], here's my plan..."

**NEVER start with generic exploration or scaffolding.**

---
`;

/**
 * Shorter version for token-constrained contexts
 */
export const DATA_ARCHITECTURE_SHORT = `
## ENVIRONMENT (MATURE PROJECT)
- **DuckDB**: 1.9M rows at \`/Volumes/VelocityData/databases/velocity_12week.duckdb\`
- **Python Engine**: \`python/engine/\` - analysis, trading, data modules
- **spawn_agent**: For parallel research/queries
- **execute_via_claude_code**: For code creation
- **DON'T explore** - I know the structure
`;

export default DATA_ARCHITECTURE_CONTEXT;
