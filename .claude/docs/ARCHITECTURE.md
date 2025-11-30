# Quant Chat Workbench — Architecture

## Overview

**Quant Chat Workbench** is a full-stack quantitative research application with:

- **Frontend**: React 18 + TypeScript + Vite, deployed via Lovable
- **Backend**: Supabase (PostgreSQL + Edge Functions on Deno runtime)
- **External Engine**: rotation-engine Python server for real backtests (optional, with stub fallback)
- **LLM Providers**: Multi-provider routing — Google Gemini (PRIMARY tier), DeepSeek (SWARM tier), OpenAI (SECONDARY tier + embeddings)
- **Vector Search**: pgvector extension for semantic memory retrieval

The system is designed for rapid iteration on trading strategies with conversational UX, persistent memory, and side-by-side experiment comparison.

---

## Frontend Structure

### Main Layout (Three-Panel)

```
┌─────────────┬──────────────────┬─────────────┐
│             │                  │             │
│  Left       │   Center         │  Right      │
│  Sidebar    │   Chat Area      │  Panel Tabs │
│             │                  │             │
│  - Workspace│   - Messages     │  - Context  │
│  - Sessions │   - Input        │  - Quant    │
│             │   - Commands     │  - Memory   │
└─────────────┴──────────────────┴─────────────┘
```

### Key Components

#### `src/pages/Index.tsx`
- Main page container
- Orchestrates three-panel layout

#### `src/components/layout/MainLayout.tsx`
- Three-panel structure using `react-resizable-panels`
- Workspace selector and session list in left sidebar
- Chat area in center
- Tabbed right panel (Context/Quant/Memory)

#### `src/components/chat/ChatArea.tsx`
- Displays message history (user, assistant, system)
- Handles slash command detection and execution
- Command autocomplete suggestions
- Sends regular messages to `/chat` edge function
- Polls for assistant responses (non-streaming in current implementation)

#### `src/components/quant/QuantPanel.tsx`
- Strategy selection dropdown
- Backtest form (date range, capital input)
- Results panel (metrics grid + equity curve chart using recharts)
- "Save Insight to Memory" button
- Experiment Browser (run history)
- Run Comparison Panel (when 2–3 runs selected)

#### `src/components/quant/ExperimentBrowser.tsx`
- Lists recent `backtest_runs` for current session
- Run cards with status badges, metrics summary, labels, notes
- Click to load run into Results panel
- Checkboxes for comparison selection (up to 3)

#### `src/components/quant/RunComparisonPanel.tsx`
- Side-by-side metrics table for selected runs
- Normalized equity curves chart (all starting at 1.0)
- Color-coded legend for each run
- "Clear Selection" button

#### `src/components/memory/MemoryPanel.tsx`
- Add Memory Note form (content, type, importance, tags)
- Recent notes list (50 items, ordered by `created_at DESC`)
- Semantic search box with results display
- Filter controls (memory type, importance level)
- "View Run" links for run-linked insights
- Badges for source, type, importance

#### `src/contexts/ChatContext.tsx`
- Global state for active workspace, session, messages
- Provides context to all components

---

## Supabase Schema

### Tables

#### `workspaces`
Multi-tenant containers for research projects.

```sql
id                      uuid PRIMARY KEY
name                    text NOT NULL
description             text
default_system_prompt   text
created_at              timestamp with time zone
updated_at              timestamp with time zone
```

#### `chat_sessions`
Conversation containers within workspaces.

```sql
id            uuid PRIMARY KEY
workspace_id  uuid REFERENCES workspaces(id) NOT NULL
title         text NOT NULL
metadata      jsonb DEFAULT '{}'
created_at    timestamp with time zone
updated_at    timestamp with time zone
```

#### `messages`
Chat message history with role-based structure.

```sql
id           uuid PRIMARY KEY
session_id   uuid REFERENCES chat_sessions(id) NOT NULL
role         text NOT NULL  -- 'system', 'user', 'assistant'
content      text NOT NULL
model        text           -- e.g., 'gpt-4', 'gpt-5-2025-08-07'
provider     text           -- e.g., 'openai'
token_usage  jsonb          -- { prompt_tokens, completion_tokens, total_tokens }
tool_calls   jsonb          -- future: function calling metadata
created_at   timestamp with time zone
```

#### `strategies`
Trading strategy definitions.

```sql
id          uuid PRIMARY KEY
key         text UNIQUE NOT NULL  -- e.g., 'skew_convexity_v1'
name        text NOT NULL
description text
config      jsonb DEFAULT '{}'    -- strategy-specific parameters
active      boolean DEFAULT true
created_at  timestamp with time zone
updated_at  timestamp with time zone
```

#### `backtest_runs`
Backtest execution tracking and results storage.

```sql
id              uuid PRIMARY KEY
session_id      uuid REFERENCES chat_sessions(id)  -- nullable for non-chat runs
strategy_key    text NOT NULL
params          jsonb                               -- { startDate, endDate, capital, ... }
status          text DEFAULT 'pending'              -- 'pending', 'running', 'completed', 'failed'
metrics         jsonb                               -- { cagr, sharpe, max_drawdown, win_rate, total_trades }
equity_curve    jsonb                               -- [{ date, value }, ...]
engine_source   text DEFAULT 'stub'                 -- 'external', 'stub', 'stub_fallback'
raw_results_url text                                -- future: link to full results file
error           text                                -- error message if status='failed'
notes           text                                -- user-added notes
started_at      timestamp with time zone DEFAULT now()
completed_at    timestamp with time zone
```

**Indexes**:
- `idx_backtest_runs_session_id` on `session_id`
- `idx_backtest_runs_strategy_key` on `strategy_key`

#### `memory_notes`
Workspace knowledge base with semantic search.

```sql
id            uuid PRIMARY KEY
workspace_id  uuid REFERENCES workspaces(id) NOT NULL
run_id        uuid REFERENCES backtest_runs(id)     -- nullable, links to specific run
content       text NOT NULL
source        text DEFAULT 'manual'                  -- 'manual', 'run_insight', 'system', 'chat'
memory_type   text DEFAULT 'insight'                 -- 'insight', 'rule', 'warning', 'todo', 'bug', 'profile_change'
importance    text DEFAULT 'normal'                  -- 'low', 'normal', 'high', 'critical'
tags          text[]                                 -- array of user-defined tags
embedding     vector(1536)                           -- OpenAI text-embedding-3-small
metadata      jsonb DEFAULT '{}'                     -- extensible metadata
archived      boolean DEFAULT false                  -- archived notes excluded from chat/search
created_at    timestamp with time zone DEFAULT now()
updated_at    timestamp with time zone DEFAULT now() -- auto-updated via trigger
```

**Indexes**:
- `idx_memory_notes_workspace_id` on `workspace_id`
- `idx_memory_notes_run_id` on `run_id`
- `idx_memory_notes_embedding` using `ivfflat` (vector similarity)
- `idx_memory_notes_memory_type` on `memory_type`
- `idx_memory_notes_importance` on `importance`
- `idx_memory_notes_archived` on `archived`

**Triggers**:
- `update_memory_notes_updated_at` — auto-updates `updated_at` on row modification

**Extensions**:
- `vector` (pgvector) for embedding storage and similarity search

### Database Functions

#### `search_memory_notes(query_embedding, match_workspace_id, match_threshold, match_count)`
Vector similarity search function.

```sql
RETURNS TABLE (
  id uuid,
  workspace_id uuid,
  content text,
  source text,
  tags text[],
  created_at timestamp,
  run_id uuid,
  metadata jsonb,
  memory_type text,
  importance text,
  similarity double precision
)
```

- Computes cosine similarity (`1 - (embedding <=> query_embedding)`)
- Filters by `workspace_id` and `similarity > match_threshold`
- Orders by similarity descending
- Limits to `match_count` results

#### `update_updated_at_column()`
Trigger function to auto-update `updated_at` timestamp on row modifications.

---

## Edge Functions

All edge functions run on Supabase Edge Functions (Deno runtime) and are configured in `supabase/config.toml`.

### Multi-Provider Model Routing

The Quant Chat Workbench implements a **three-tier, multi-provider LLM routing strategy** with parallel execution capabilities:

**PRIMARY Tier** (`chat-primary`):
- **Purpose**: High-stakes reasoning, code writing, architecture decisions, final synthesis
- **Provider**: Google Gemini API
- **Model**: Configurable via `PRIMARY_MODEL` env (defaults to `gemini-3-pro-preview`)
- **Used By**: Main chat interface, `/auto_analyze` final synthesis, user-facing conversation, synthesis of swarm results
- **Characteristics**: Google Gemini 3 Pro Preview for powerful reasoning on novel/complex work

**SECONDARY Tier** (future use):
- **Purpose**: Alternative high-quality reasoning when PRIMARY is unavailable or for specific use cases
- **Provider**: OpenAI API
- **Model**: Configurable via `SECONDARY_MODEL` env (defaults to `gpt-4o`)
- **Used By**: Reserved for future commands requiring OpenAI-specific capabilities
- **Characteristics**: GPT-4o for reliable reasoning as fallback or specialized tasks

**SWARM Tier** (`chat-swarm` + `chat-swarm-parallel`):
- **Purpose**: Agent modes, specialist analysis, repetitive workflows, parallel multi-agent execution
- **Provider**: DeepSeek API
- **Model**: Configurable via `SWARM_MODEL` env (defaults to `deepseek-reasoner`)
- **Used By**: `/audit_run`, `/mine_patterns`, `/curate_memory`, `/suggest_experiments`, `/risk_review`, `/red_team_file` auditors, `/auto_analyze` research agents
- **Parallel Orchestration**: `chat-swarm-parallel` fans out multiple prompts to `chat-swarm` in parallel
- **Characteristics**: DeepSeek-Reasoner for cost-optimized, frequent structured analysis tasks

**Multi-Provider Architecture** (`supabase/functions/_shared/llmClient.ts`):
- **Provider Types**: `'openai' | 'google' | 'anthropic' | 'deepseek' | 'custom'`
- **Tier-to-Provider Mapping**: Each tier routes to its designated provider via `getConfigForTier(tier)`
- **Unified Interface**: `callLlm(tier, messages)` abstracts provider-specific APIs
- **Provider Clients**:
  - `callGemini()`: Google Generative Language API for Gemini models
  - `callOpenAI()`: OpenAI Chat Completions API for GPT models
  - `callDeepSeek()`: DeepSeek API (OpenAI-compatible) for DeepSeek-Reasoner
  - Future: Anthropic Claude, custom endpoints

**Routing Configuration** (`src/config/llmRouting.ts`):
- `LlmTier` type: `'primary' | 'secondary' | 'swarm'`
- `ProviderName` type: `'openai' | 'google' | 'anthropic' | 'deepseek' | 'custom'`
- Environment variables:
  - `PRIMARY_MODEL`, `PRIMARY_PROVIDER` (default: `gemini-3-pro-preview`, `google`)
  - `SECONDARY_MODEL`, `SECONDARY_PROVIDER` (default: `gpt-4o`, `openai`)
  - `SWARM_MODEL`, `SWARM_PROVIDER` (default: `deepseek-reasoner`, `deepseek`)
- Helpers: `getModelForTier(tier)`, `getProviderForTier(tier)`

**API Key Management** (Supabase Secrets):
- `GEMINI_API_KEY`: Required for PRIMARY tier (Google Gemini API)
- `OPENAI_API_KEY`: Required for SECONDARY tier and embeddings (OpenAI API)
- `DEEPSEEK_API_KEY`: Required for SWARM tier (DeepSeek API)
- All keys stored as Supabase secrets, accessed server-side only via `Deno.env`

**Command Tier Annotation**:
Slash commands in `src/lib/slashCommands.ts` include a `tier` field indicating which chat function to use:
- `tier: 'primary'` → Routes to `chat-primary` function (Gemini 3)
- `tier: 'swarm'` → Routes to `chat-swarm` function (DeepSeek-Reasoner) or `chat-swarm-parallel` for multi-agent workflows
- `tier: 'secondary'` → Reserved for future use (GPT-5.1)
- `tier: undefined` → No chat call, uses other endpoints (data fetch, backtest-run, etc.)

**Swarm Orchestration Pattern**:

The system implements a **fan-out → gather → synthesize** pattern for multi-agent workflows:

1. **Fan-out**: Multiple specialized prompts sent to `chat-swarm-parallel` → executes in parallel via `chat-swarm` (DeepSeek)
2. **Gather**: All results collected from parallel execution
3. **Synthesize**: Combined results sent to `chat-primary` (Gemini 3) for coherent report generation

**Examples**:
- `/red_team_file` v2: 5 code auditors (strategy logic, overfit, lookahead-bias, robustness, consistency) execute in parallel via DeepSeek, synthesized via Gemini 3
- `/auto_analyze` v2: 4 research agents (pattern miner, curator, risk officer, experiment director) execute in parallel via DeepSeek, synthesized via Gemini 3

This pattern separates **independent analysis** (cheap, parallel, SWARM tier) from **integration & reasoning** (expensive, PRIMARY tier), reducing total latency and cost.

**Phase Status**:
- Phase 1: Tier routing infrastructure ✅
- Phase 2: `chat-swarm-parallel` and `runSwarm` helper ✅
- Phase 3: Red Team v2 using swarm + synthesis ✅
- Phase 4: `/auto_analyze` v2 using swarm + synthesis ✅
- Phase 5: Multi-provider LLM routing (Gemini PRIMARY, DeepSeek SWARM, OpenAI SECONDARY) ✅
- Future: Additional providers (Anthropic Claude, custom endpoints)

---

### `chat-primary`

**Endpoint**: `POST /functions/v1/chat-primary`

**Request Body**:
```json
{
  "sessionId": "uuid",
  "workspaceId": "uuid",
  "content": "user message text",
  "model": "gpt-5-2025-08-07" // optional
}
```

**Tier**: PRIMARY (high-stakes reasoning, Google Gemini 2.0 Flash thinking mode)

**Behavior**:
1. Initialize Supabase client
2. Fetch workspace details (for `default_system_prompt`)
   - Uses **Chief Quant system prompt** as base identity if workspace prompt is empty
3. Load previous messages from `messages` table (limited to last N for context)
4. **Memory Retrieval**:
   - Generate embedding for user's message using OpenAI embeddings API
   - Call `search_memory_notes` RPC function with embedding
   - Only retrieves **active (non-archived) notes with embeddings**
   - Retrieve top 5–15 semantically similar notes
   - **Prioritize**: critical/high importance rules and warnings
   - Format into system prompt sections:
     - "Relevant Rules and Warnings:" (critical/high rules/warnings first)
     - "Other Relevant Insights:" (remaining notes)
5. Construct message array:
   - System message: **Chief Quant identity** (workspace prompt or fallback) + memory context
   - Previous messages (last N)
   - New user message
6. Save user message to `messages` table
7. Call PRIMARY tier LLM via `callLlm('primary', messages)` → Google Gemini API
8. Save assistant response to `messages` table
9. Return assistant content to client

**Chief Quant System Prompt**:
The chat uses a specialized **Chief Quant Researcher** identity defined in `supabase/functions/_shared/chiefQuantPrompt.ts`:
- **Role**: Quantitative researcher for convexity-focused options strategies (rotation-engine)
- **Philosophy**: Structural edge over parameter fitting, regime-aware analysis, anti-overfitting discipline
- **Capabilities**: Tool-aware (backtests, memory, comparisons), memory-driven reasoning
- **Style**: Direct, analytical, transparent about uncertainty, proposes concrete experiments
- This prompt is used as fallback if workspace `default_system_prompt` is empty

**Error Handling**:
- If memory retrieval fails: log error, skip memory injection, continue with Chief Quant identity
- If Gemini API fails: return 500 with error message
- If workspace not found: return 404

**CORS**: Enabled with `Access-Control-Allow-Origin: *`

**JWT Verification**: Disabled (`verify_jwt = false` in config)

---

### `chat-swarm`

**Endpoint**: `POST /functions/v1/chat-swarm`

**Request Body**:
```json
{
  "sessionId": "uuid",
  "workspaceId": "uuid",
  "content": "user message text",
  "model": "gpt-5-2025-08-07" // optional
}
```

**Tier**: SWARM (agent/specialist workflows, DeepSeek-Reasoner)

**Behavior**:
Uses SWARM tier routing to DeepSeek-Reasoner via `callLlm('swarm', messages)`. Identical workflow to `chat-primary` (workspace prompt, memory context, Chief Quant identity) but routed to cost-optimized DeepSeek API. Used by:
- `/audit_run` — Strategy Auditor agent analysis
- `/mine_patterns` — Pattern Miner cross-run analysis
- `/curate_memory` — Memory Curator rule health review
- `/suggest_experiments` — Experiment Director planning
- `/risk_review` — Risk Officer structural risk analysis
- `/auto_analyze` research agents (pattern miner, curator, risk officer, experiment director)
- Individual red team auditors (called via `chat-swarm-parallel`)

**Current Provider**: DeepSeek API (`deepseek-reasoner` model)

**CORS**: Enabled with `Access-Control-Allow-Origin: *`

**JWT Verification**: Disabled (`verify_jwt = false` in config)

---

### `chat-swarm-parallel`

**Endpoint**: `POST /functions/v1/chat-swarm-parallel`

**Request Body**:
```json
{
  "sessionId": "uuid",
  "workspaceId": "uuid",
  "prompts": [
    {
      "label": "auditor-1",
      "content": "prompt text"
    },
    {
      "label": "auditor-2",
      "content": "prompt text"
    }
  ],
  "model": "gpt-5-2025-08-07" // optional
}
```

**Tier**: SWARM (parallel orchestration)

**Behavior**:
1. Accept array of labeled prompts
2. Fan out all prompts in parallel to `chat-swarm`
3. Wait for all results using `Promise.all`
4. Return array of results in same order as input

**Response**:
```json
{
  "results": [
    {
      "label": "auditor-1",
      "content": "assistant response",
      "error": "optional error message"
    },
    {
      "label": "auditor-2",
      "content": "assistant response"
    }
  ]
}
```

**Used By**:
- `/red_team_file` v2 — Parallel execution of 5 specialized code auditors
- Frontend helper: `runSwarm()` in `src/lib/swarmClient.ts`

**Error Handling**:
- If individual swarm call fails: Result includes `error` field, other calls continue
- Partial failures allowed: Some auditors can succeed while others fail
- Complete orchestration failure: Returns 500 with error message

**Performance**:
- Executes N prompts in parallel (not sequential)
- Total time ≈ slowest individual call, not sum of all calls
- Example: 5 auditors @ ~10s each = ~10s total (vs ~50s sequential)

**CORS**: Enabled with `Access-Control-Allow-Origin: *`

**JWT Verification**: Disabled (`verify_jwt = false` in config)

---

### `workspace-init-prompt`

**Endpoint**: `POST /functions/v1/workspace-init-prompt`

**Request Body**:
```json
{
  "workspaceId": "uuid",
  "reset": false
}
```

**Behavior**:
1. Initialize Supabase client
2. Fetch workspace's current `default_system_prompt`
3. If empty (or `reset=true`): set to Chief Quant prompt
4. If already set: skip unless `reset=true`
5. Return action taken (initialized, reset, or skipped)

**Use Case**: Initialize new workspaces with Chief Quant identity or reset existing workspaces

**CORS**: Enabled

**JWT Verification**: Disabled

---

## Agent Modes

The Chief Quant identity supports specialized operating modes for different research tasks.

### Strategy Auditor Mode

Accessible via `/audit_run` slash command. Performs deep, structured analysis of individual backtest runs.

**Purpose**: Critical review of a single backtest run for structural edge, robustness, and failure modes.

**Inputs**:
- Backtest run summary (params, metrics, equity curve)
- Relevant memory notes (run-linked, strategy-tagged, high-priority rules/warnings)

**Output Structure**:
1. **Quick Overview**: What the run tests and high-level conclusions
2. **Structural Edge Assessment**: Evidence of true edge vs curve-fitting, convexity vs grind
3. **Failure Modes & Risks**: Major failure scenarios and regime dependencies
4. **Rule & Memory Alignment**: Consistency with stored rules/warnings, conflicts, updates
5. **Suggested Experiments**: Specific follow-up tests with hypotheses and success criteria
6. **Conclusion**: Assessment of promise/fragility and critical takeaways

**Template**: `src/prompts/auditorPrompt.ts` → `buildAuditPrompt(runSummary, memorySummary)`

**Summary Helpers**: `src/lib/auditSummaries.ts`
- `buildRunSummary(run)`: Compact run details (strategy, params, metrics, curve summary)
- `buildMemorySummary(notes)`: Grouped notes (rules/warnings, insights) with type/importance

**Integration**: Command calls `chat` edge function with audit prompt; Chief Quant base identity + memory context + audit instructions → structured analysis returned to chat

---

### Pattern Miner Mode

Accessible via `/mine_patterns` slash command. Analyzes multiple backtest runs to detect recurring structural patterns.

**Purpose**: Identify patterns across 10-200 runs, cross-strategy insights, contradictions with stored rules, and evidence-backed candidate rules.

**Inputs**:
- Aggregated run summaries (10-200 completed runs, grouped by strategy and regime)
- Relevant memory notes (strategy-tagged, high/critical rules/warnings, run-linked)

**Output Structure**:
1. **Repeated Patterns**: Conditions repeatedly associated with success/failure (with evidence counts)
2. **Cross-Strategy Insights**: Patterns visible across different strategies and regime-independent factors
3. **Conflicting Evidence**: Where stored rules contradict empirical results
4. **Candidate Rules**: Proposed new rules with evidence counts, importance levels, and tags
5. **Deprecated Rules**: Existing rules contradicted by recent evidence with counter-evidence
6. **Suggested Experiments**: Concrete tests to confirm/refute detected patterns

**Template**: `src/prompts/patternMinerPrompt.ts` → `buildPatternMinerPrompt(runSummary, memorySummary)`

**Summary Helpers**: `src/lib/patternSummaries.ts`
- `buildRunsAggregate(runs)`: Groups runs by strategy and regime, computes median metrics, failure rates
- `buildRelevantMemory(notes, strategyKeys)`: Prioritizes rules/warnings by importance, limits to top 15

**Integration**: Command fetches recent completed runs, aggregates metrics by strategy/regime, fetches relevant memory, builds summaries, calls `chat` edge function with pattern mining prompt → structured multi-section analysis returned

---

### Memory Curator Mode (`/curate_memory`)

Activated by `/curate_memory` command.

**Purpose**: Review and propose improvements to the rule set and memory organization based on evidence and logical consistency.

**Process**:
1. Fetch all non-archived memory notes for current workspace (up to 200)
2. Analyze using curation helpers:
   - Group notes by strategy tags
   - Find promotion candidates (insights → rules)
   - Find weak rules (lack evidence, old, contradicted)
   - Detect conflicts (opposite rules on same topic)
3. Build comprehensive curation summary
4. Compose Memory Curator prompt
5. Call chat function to generate recommendations

**Output Sections**:
- **Promote to Rules**: Insights that deserve promotion, with rationale
- **Demote or Archive Rules**: Weak rules to downgrade/remove
- **Merge or Refactor Notes**: Duplicates, overlaps
- **Contradictions**: Conflicting rules and resolutions
- **Proposed Updated Ruleset**: Cleaned-up rule list by strategy

**Template**: `src/prompts/memoryCuratorPrompt.ts` → `buildMemoryCuratorPrompt(summary)`

**Curation Helpers**: `src/lib/memoryCuration.ts`
- `groupMemoryByStrategy(notes)`: Groups by strategy tag, with "global" fallback
- `findPromotionCandidates(notes)`: High-importance insights or multi-tagged insights
- `findWeakRules(notes)`: Rules without run evidence, old with low importance
- `findConflicts(notes)`: Keyword-based conflict detection for same-domain rules
- `buildCurationSummary(notes)`: Comprehensive text summary with all analysis sections

**Integration**: Command calls `chat` edge function with curator prompt; Chief Quant base identity + curator instructions → structured recommendations returned to chat

**Important**: Curator only makes recommendations; user must manually implement changes via Memory panel editing.

---

### Experiment Director Mode (`/suggest_experiments`)

Activated by `/suggest_experiments [focus]` command.

**Purpose**: Design concrete next experiments to maximize learning and structural understanding, acting as a research lead who determines what to test next.

**Process**:
1. Fetch last 100 completed runs for current session
2. Fetch non-archived memory notes (up to 200) for current workspace
3. Build experiment planning summaries:
   - Run summary: grouped by strategy with date coverage, typical metrics, regime gaps
   - Memory summary: high/critical rules, warnings, and insights
4. Compose Experiment Director prompt with optional focus parameter
5. Call chat function to generate experiment plan

**Output Sections**:
- **Objectives**: Key questions we're trying to answer (what to learn, not just P&L)
- **High-Priority Experiments**: 3-10 concrete experiments with:
  - Strategy/profile (exact strategy key)
  - Date range (with regime rationale)
  - Parameter variations (if relevant)
  - Hypothesis (expectations and reasoning)
  - Evidence basis (patterns/rules/gaps addressed)
  - Success criteria (what validates hypothesis)
  - Failure criteria (what invalidates hypothesis)
- **Secondary Experiments**: Lower-priority but valuable tests
- **Dependencies & Missing Info**: Blockers, data limitations, unresolved questions
- **Recommended Execution Order**: Which experiments to run first and why (information gain)

**Template**: `src/prompts/experimentDirectorPrompt.ts` → `buildExperimentDirectorPrompt(runSummary, patternSummary, memorySummary, focus?)`

**Planning Helpers**: `src/lib/experimentPlanning.ts`
- `buildExperimentRunSummary(runs)`: Summarizes last N runs by strategy, date coverage, typical metrics, identifies regime gaps
- `buildExperimentMemorySummary(notes)`: Focuses on high/critical rules/warnings and insights, limits to ~15 notes

**Integration**: Command calls `chat` edge function with Experiment Director prompt; Chief Quant base identity + experiment planning instructions → structured experiment plan returned to chat

**Important**: Proposes experiments only; never auto-executes. Minimum 5 completed runs required.

---

### Risk Officer Mode (`/risk_review`)

Activated by `/risk_review [focus]` command.

**Purpose**: Identify structural risks, failure patterns, rule violations, and tail risk indicators across runs with conservative, evidence-based assessment focused on downside protection.

**Process**:
1. Fetch up to 100 completed runs for current session
2. Fetch non-archived memory notes (up to 200) for current workspace
3. Filter by optional focus parameter (strategy or tag)
4. Build risk-focused summaries:
   - Run summary: extreme drawdowns, worst runs, per-strategy risk profile, regime-specific failures, coverage gaps
   - Memory summary: critical and high-importance rules and warnings
5. Compose Risk Officer prompt
6. Call chat function to generate risk report

**Output Sections**:
- **Key Risks**: Largest structural risks (extreme drawdowns, unstable Sharpe, inconsistent regimes)
- **Violations of Existing Rules**: Where strategy behavior contradicts memory rules/warnings with severity levels
- **Repeated Failure Modes**: Documented patterns (peakless trades, early failures, regime mismatches, metric-based patterns)
- **Dangerous Regimes**: Date ranges or market regimes where failures cluster with strategy-specific vulnerabilities
- **Tail Risk Indicators**: Return asymmetry, fat tail exposure, volatility clustering, extreme loss events
- **Recommended Actions**: Concrete mitigation steps (reduce allocation, test parameters, avoid regimes, additional experiments) with calls to other agent modes
- **Critical Alerts**: Reserved for catastrophic signals requiring immediate attention (optional section)

**Template**: `src/prompts/riskOfficerPrompt.ts` → `buildRiskOfficerPrompt(runSummary, memorySummary, patternSummary)`

**Risk Summarization Helpers**: `src/lib/riskSummaries.ts`
- `buildRiskRunSummary(runs)`: Aggregates max/median drawdowns, identifies worst runs, builds per-strategy risk profiles, detects regime failures and coverage gaps
- `buildRiskMemorySummary(notes)`: Prioritizes critical/high rules and warnings, groups by importance level

**Integration**: Command calls `chat` edge function with Risk Officer prompt; Chief Quant base identity + risk assessment instructions → structured risk report returned to chat

**Important**: Conservative, evidence-based approach focused on what can damage performance. Never auto-edits or auto-executes. Minimum 5 completed runs required.

---

### Autonomous Research Loop Mode (`/auto_analyze`) — v2 with Swarm Orchestration

Activated by `/auto_analyze [scope]` command.

**Purpose**: Orchestrate all agent modes (Pattern Miner, Memory Curator, Risk Officer, Experiment Director) into a single comprehensive research report that synthesizes evidence across runs, memory, patterns, and risks.

**Architecture (v2 — Parallel Swarm + Synthesis)**:

1. **Data Gathering**:
   - Fetch 100 most recent completed runs for the session
   - Fetch all non-archived memory notes for the workspace
   - Build aggregated summaries for each agent type

2. **Parallel Agent Execution via SWARM_MODEL**:
   - **Pattern Miner Agent**: Detects recurring patterns across runs and memory
   - **Memory Curator Agent**: Reviews memory quality and suggests improvements
   - **Risk Officer Agent**: Identifies structural risks, rule violations, and vulnerabilities
   - **Experiment Director Agent**: Proposes concrete next experiments

   All agents execute in parallel via `runSwarm()` → `chat-swarm-parallel` → `chat-swarm`

3. **Synthesis via PRIMARY_MODEL**:
   - Combined agent outputs assembled into unified analysis input
   - `chat-primary` synthesizes final Research Report using Autonomous Research Loop prompt
   - Produces structured 8-section report

**Output Sections (Final Report)**:
- **Executive Summary**: Key findings overview (2-3 sentences)
- **Key Observations (Data-Backed)**: 3-7 concrete observations with specific evidence
- **Structural Conclusions**: Analysis of convexity, regime dependencies, failure modes
- **Conflicts or Rule Violations**: Contradictions, rule breaches, invalidated beliefs
- **Recommended Experiments**: 3-8 prioritized next tests with hypotheses
- **Updated Understanding**: How mental model should shift based on analysis
- **Suggested Memory Updates**: Recommended rule/insight changes (user must confirm)
- **Long-Term Risk Flags**: Systemic risks that persist across runs

**Prompt Templates**:
- `researchAgentPrompts.ts`: Focused prompts for each agent (Pattern Miner, Curator, Risk Officer, Experiment Director)
- `autoAnalyzePrompt.ts`: Final synthesis prompt for PRIMARY_MODEL

**Orchestration Helpers**:
- `src/lib/autoAnalyze.ts`: `buildRunPortfolioSummary()` for aggregated run metrics
- `src/lib/patternSummaries.ts`: `buildRunsAggregate()`, `buildRelevantMemory()`
- `src/lib/memoryCuration.ts`: `buildCurationSummary()` for memory context
- `src/lib/riskSummaries.ts`: `buildRiskRunSummary()`, `buildRiskMemorySummary()`
- `src/lib/experimentPlanning.ts`: `buildExperimentRunSummary()`, `buildExperimentMemorySummary()`

**Integration**: Command uses `runSwarm()` to execute 4 research agents in parallel (SWARM tier), then `chat-primary` to synthesize final report (PRIMARY tier). Results returned to chat as structured report.

**Performance**: Parallel execution significantly reduces latency vs sequential agent calls. Typically 4 agents complete in parallel rather than sequentially, improving total time by ~75%.

**Important**: No auto-execution of backtests or auto-editing of memory. All recommendations require user confirmation. Works best with >20 runs and meaningful memory. Minimum 5 completed runs required.

---

### Local Code Bridge (rotation-engine introspection)

The workbench provides read-only access to the rotation-engine codebase through three edge functions and corresponding slash commands. This allows the Chief Quant and agent modes to analyze actual strategy code, not just backtest results.

**Environment Variable**:
- `ROTATION_ENGINE_ROOT`: Path to the rotation-engine repository (default: `/rotation-engine`)

#### Edge Functions

##### `read-file`

**Endpoint**: `POST /functions/v1/read-file`

**Request Body**:
```json
{
  "path": "profiles/skew.py"
}
```

**Behavior**:
- Validates path (no `..` traversal, no absolute paths)
- Resolves full path under `ROTATION_ENGINE_ROOT`
- Reads file contents as text
- Truncates files > 100KB
- Returns `{ "content": "<file contents>" }`

**Errors**:
- 404 if file not found
- 400 if invalid path

##### `list-dir`

**Endpoint**: `POST /functions/v1/list-dir`

**Request Body**:
```json
{
  "path": "profiles"  // OR "." for root
}
```

**Behavior**:
- Validates path
- Lists directory entries (files and directories)
- Sorts: directories first, then files, alphabetically
- Returns `{ "entries": [{ "name": "skew.py", "type": "file" }, ...] }`

**Errors**:
- 404 if directory not found
- 400 if invalid path

##### `search-code`

**Endpoint**: `POST /functions/v1/search-code`

**Request Body**:
```json
{
  "query": "peakless",
  "path": "profiles"  // optional, defaults to root
}
```

**Behavior**:
- Validates path
- Recursively scans code files (`.py`, `.js`, `.ts`, `.json`, `.yaml`, `.yml`, `.toml`, `.md`)
- Skips common non-code directories (`.git`, `__pycache__`, `node_modules`, etc.)
- Case-insensitive search
- Returns up to 100 results with file path, line number, and context
- Returns `{ "results": [{ "file": "profiles/skew.py", "line": 184, "context": "..." }, ...] }`

**Errors**:
- 400 if query empty or path invalid

#### Slash Commands

##### `/list_dir path:<path>`

Lists files and directories in the rotation-engine repository.

**Examples**:
- `/list_dir path:profiles`
- `/list_dir path:.`

**Output**: Formatted directory listing with file/directory icons

##### `/open_file path:<path>`

Shows the contents of a rotation-engine file.

**Examples**:
- `/open_file path:profiles/skew.py`
- `/open_file path:engine/filters.py`

**Output**: File contents in code block

##### `/search_code <query>`

Searches rotation-engine code for a term.

**Examples**:
- `/search_code peakless`
- `/search_code path:profiles convexity`

**Output**: List of matches with file path, line number, and context snippet

#### Code-Aware Prompt Template

**Template**: `src/prompts/codeAwarePrompt.ts` → `buildCodeAwarePrompt(code, context)`

Used when analyzing rotation-engine source code. Instructs the Chief Quant to:
1. Summarize code behavior (entry/exit logic, filters, parameters)
2. Identify structural implications (convexity, regime dependencies, risk characteristics)
3. Link code to known patterns, rules, and failure modes
4. Suggest experiments to test hypotheses about code behavior

**Integration**: Can be used manually in chat or integrated into agent modes (Auditor, Pattern Miner, etc.) for code-aware analysis.

**Safety**:
- All access is READ-ONLY
- Path validation prevents traversal attacks
- No write or modification capabilities
- Binary files and large files are skipped or truncated

---

## Research Reports

### Overview

Research Reports provide persistent storage and retrieval of comprehensive analysis outputs from the Autonomous Research Loop (`/auto_analyze`). These reports transform transient chat outputs into durable, queryable artifacts that preserve research conclusions over time.

### Database Schema

#### `research_reports` Table

```sql
id                uuid PRIMARY KEY default gen_random_uuid()
workspace_id      uuid NOT NULL REFERENCES workspaces(id)
session_id        uuid NULL REFERENCES chat_sessions(id)
scope             text NULL          -- e.g. "skew", "strategy:skew_convexity_v1"
title             text NOT NULL      -- human-readable title (auto-generated or custom)
summary           text NOT NULL      -- executive summary extracted from report
content           text NOT NULL      -- full report text (the /auto_analyze output)
tags              text[] DEFAULT '{}'-- strategy names, regimes, extracted terms
created_at        timestamptz DEFAULT now()
updated_at        timestamptz DEFAULT now()
```

**Indexes**:
- `workspace_id` for efficient workspace queries
- `scope` for scope filtering
- `tags` (GIN) for tag-based searches
- `created_at DESC` for chronological ordering

### Edge Functions

#### `report-save`

**Endpoint**: `POST /functions/v1/report-save`

**Request Body**:
```json
{
  "workspaceId": "uuid",
  "sessionId": "uuid | null",
  "scope": "string | null",
  "title": "optional string",
  "summary": "optional string",
  "content": "full report text",
  "tags": ["optional", "tags"]
}
```

**Behavior**:
1. Validates required fields (workspaceId, content)
2. Auto-generates title using `buildDefaultReportTitle()` if not provided
3. Extracts summary from content using `extractSummaryFromReport()` if not provided
4. Builds tags using `buildTagsFromReport()` if not provided
5. Inserts record into `research_reports` table
6. Returns `{ id, title, created_at }`

### Report Management Commands

#### `/save_report [scope:<value>] [title:"Custom Title"]`

Saves the most recent `/auto_analyze` output as a persistent research report.

**Process**:
1. Searches current session messages for latest "Autonomous Research Report"
2. Extracts full report content (removes save tip)
3. Parses optional scope and custom title arguments
4. Calls `report-save` edge function with extracted content
5. Returns confirmation with report title and short ID

**Examples**:
- `/save_report` - saves with auto-generated title
- `/save_report scope:skew` - saves with scope-based title
- `/save_report title:"Q1 2025 Skew Analysis"` - saves with custom title

#### `/list_reports [scope:<value>] [tag:<value>]`

Lists saved research reports with optional filtering.

**Process**:
1. Queries `research_reports` table for current workspace
2. Applies optional scope filter (ILIKE) and tag filter (array contains)
3. Orders by `created_at DESC`, limits to 20 results
4. Formats as numbered list with dates, titles, scope tags, and short IDs

**Examples**:
- `/list_reports` - lists all reports
- `/list_reports scope:skew` - filters by scope
- `/list_reports tag:momentum` - filters by tag

#### `/open_report id:<uuid>`

Opens and displays a saved research report.

**Process**:
1. Fetches report by ID and workspace
2. Formats with title, date, tags, and full content
3. Displays complete report in chat

**Example**:
- `/open_report id:abc12345` - opens specific report

### Report Utilities

#### `src/lib/researchReports.ts`

**Functions**:
- `buildDefaultReportTitle(scope, createdAt)`: Creates scope-aware titles
- `extractSummaryFromReport(content)`: Extracts executive summary sections
- `buildTagsFromReport(scope, content)`: Builds strategy and term tags

**Title Generation**:
- With scope: "Skew Strategy Research – 2025-02-10"
- Without scope: "Workspace Research Report – 2025-02-10"

**Summary Extraction**:
1. Searches for "Executive Summary" section in report
2. Falls back to first 3-5 lines if section not found
3. Truncates to 500 characters maximum

**Tag Building**:
- Includes scope terms (cleaned and split)
- Extracts strategy patterns (e.g., `skew_convexity_v1`)
- Identifies common strategy terms in content
- Limits to 10 most relevant tags

### Integration with Autonomous Research Loop

The `/auto_analyze` command now includes a save tip at the end of each report:

```
💡 **Tip**: Use `/save_report` to store this Research Report for later.
```

This creates a seamless workflow:
1. Run `/auto_analyze [scope]` to generate comprehensive analysis
2. Use `/save_report` to persist the output
3. Use `/list_reports` and `/open_report` to browse and retrieve past analysis

### Use Cases

- **Historical Analysis**: Track research evolution over time
- **Strategy Development**: Compare analysis across different time periods
- **Knowledge Preservation**: Retain insights beyond chat session lifecycle
- **Team Collaboration**: Share structured research findings
- **Regulatory Compliance**: Maintain audit trail of research decisions

---

---

### Red Team Code Audit Mode

The **Red Team Code Audit** provides multi-agent adversarial code review for rotation-engine files.

#### Overview

Instead of a single code review, the system orchestrates 5 specialized auditors, each focusing on a specific vulnerability class:

1. **Strategy Logic Auditor** — Analyzes entry/exit criteria, signal flow, and behavioral consistency across market regimes
2. **Overfit Auditor** — Identifies signs of overfitting (magic numbers, date-specific logic, excessive branching)
3. **Lookahead Bias Auditor** — Detects data leakage and future information usage
4. **Robustness Auditor** — Checks edge case handling (NaN, None, empty data, extreme values)
5. **Implementation Consistency Auditor** — Reviews code quality, naming conventions, and alignment with rotation-engine patterns

#### How It Works

1. User triggers `/red_team_file path:profiles/skew.py`
2. System fetches file via `read-file` edge function
3. For each auditor:
   - Builds specialized prompt using templates from `src/prompts/redTeamPrompts.ts`
   - Calls `chat` edge function with auditor-specific context
   - Captures response as that auditor's section
4. Combines all auditor reports into single structured output
5. Displays full report as system message in chat

#### Key Characteristics

- **READ-ONLY**: No code is modified automatically
- **Sequential Execution**: Auditors run one at a time to avoid rate limiting
- **Graceful Degradation**: If one auditor fails, others continue
- **Advisory Only**: All findings are recommendations requiring human review

#### Prompt Templates

Each auditor uses a structured prompt template (`redTeamPrompts.ts`) that:
- Identifies the auditor's role explicitly
- Provides file path and optional context
- Requests output in consistent format (Summary, Findings, Suggestions, Tests)
- Emphasizes specific vulnerability classes

#### Orchestration

The `src/lib/redTeamAudit.ts` module:
- Manages sequential auditor calls
- Aggregates sub-reports into combined report
- Handles partial failures gracefully
- Adds small delays between calls to respect rate limits

#### Usage Example

```
/list_dir path:profiles
/red_team_file path:profiles/skew.py

# Output: Multi-section report with:
# - Strategy Logic Audit
# - Overfit Audit
# - Lookahead Bias Audit
# - Robustness Audit
# - Implementation Consistency Audit
```

#### Slash Command

##### `/red_team_file path:<path>`

Runs multi-agent red team audit on the specified rotation-engine file.

**Examples**:
- `/red_team_file path:profiles/skew.py`
- `/red_team_file path:engine/detectors/vol_spike.py`

**Output**: Comprehensive audit report with 5 specialized perspectives

This mode replicates the multi-agent red team workflow from Claude Code, integrated directly into the Quant Chat Workbench.


**Endpoint**: `POST /functions/v1/backtest-run`

**Request Body**:
```json
{
  "sessionId": "uuid",
  "strategyKey": "string",
  "params": {
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "capital": 100000
  }
}
```

**Behavior**:
1. Initialize Supabase client
2. Insert `backtest_runs` row with `status='running'`
3. **Try External Engine**:
   - Check `BACKTEST_ENGINE_URL` environment variable
   - If configured: POST to `{BACKTEST_ENGINE_URL}/run-backtest` with request body
   - Parse response: `{ metrics: {...}, equity_curve: [...] }`
   - Set `engine_source='external'`
4. **Fallback to Stub**:
   - If external engine unavailable or returns error:
   - Generate deterministic fake results based on `strategyKey` and `params`
   - Set `engine_source='stub_fallback'` (or `'stub'` if no engine configured)
5. Update `backtest_runs` row with:
   - `status='completed'` (or `'failed'` if error)
   - `metrics`, `equity_curve`, `engine_source`
   - `completed_at=now()`
   - `error` message if applicable
6. Return completed `backtest_runs` row

**External Engine Contract**:
- POST `/run-backtest`
- Request: `{ strategyKey, params: { startDate, endDate, capital } }`
- Response: `{ metrics: { cagr, sharpe, max_drawdown, win_rate, total_trades, ... }, equity_curve: [{ date, value }, ...] }`

**Error Handling**:
- External engine timeout: fall back to stub after 60s
- Validation errors: return 400 with details
- Always set run status to `completed` or `failed` (never leave as `running`)

**CORS**: Enabled

**JWT Verification**: Disabled

---

### `backtest-get`

**Endpoint**: `GET /functions/v1/backtest-get?runId=<uuid>`

**Behavior**:
1. Parse `runId` from query params
2. Fetch single row from `backtest_runs` using `.maybeSingle()`
3. Return run data or 404 if not found

**Use Case**: Load specific historical run by ID (e.g., from memory "View Run" link)

**CORS**: Enabled

**JWT Verification**: Disabled

---

### `memory-search`

**Endpoint**: `POST /functions/v1/memory-search`

**Request Body**:
```json
{
  "workspaceId": "uuid",
  "query": "search query text",
  "limit": 10
}
```

**Behavior**:
1. Initialize Supabase client
2. Generate embedding for `query` using OpenAI embeddings API
3. Call `search_memory_notes` RPC function:
   - `query_embedding`: generated embedding
   - `match_workspace_id`: from request
   - `match_threshold`: 0.7 (configurable)
   - `match_count`: from request (default 10)
4. Return array of matching memory notes with similarity scores

**Response**:
```json
[
  {
    "id": "uuid",
    "content": "text",
    "source": "string",
    "tags": ["tag1", "tag2"],
    "run_id": "uuid or null",
    "created_at": "timestamp",
    "memory_type": "string",
    "importance": "string",
    "similarity": 0.85
  }
]
```

**Error Handling**:
- If embedding generation fails: return 500 with error
- If no results: return empty array

**CORS**: Enabled

**JWT Verification**: Disabled

---

### `memory-create`

**Endpoint**: `POST /functions/v1/memory-create`

**Request Body**:
```json
{
  "workspaceId": "uuid",
  "content": "text",
  "source": "manual | run_insight | system | chat",
  "tags": ["tag1", "tag2"],
  "runId": "uuid or null",
  "memoryType": "insight | rule | warning | todo | bug | profile_change",
  "importance": "low | normal | high | critical"
}
```

**Behavior**:
1. Initialize Supabase client
2. Validate `memoryType` and `importance` values
3. Generate embedding for `content` using OpenAI embeddings API
4. Insert row into `memory_notes` with all fields including `embedding`
5. Return created note

**Error Handling**:
- If embedding generation fails: log error, insert note with `embedding=null` (note still saved)
- Validation errors: return 400

**CORS**: Enabled

**JWT Verification**: Disabled

---

### `memory-update`

**Endpoint**: `POST /functions/v1/memory-update`

**Request Body**:
```json
{
  "noteId": "uuid",
  "content": "updated text",
  "memoryType": "rule",
  "importance": "high",
  "tags": ["tag1", "tag2"],
  "archived": false
}
```

**Behavior**:
1. Initialize Supabase client
2. Fetch existing note to get previous embedding
3. Validate `memoryType` and `importance` if provided
4. If `content` changed:
   - Attempt to regenerate embedding
   - If embedding generation fails: keep previous embedding (if exists)
5. Update row in `memory_notes` with new values
6. `updated_at` auto-updated by trigger
7. Return updated note

**Error Handling**:
- If note not found: return 404
- If embedding regeneration fails: log warning, keep previous embedding
- Validation errors: return 400

**CORS**: Enabled

**JWT Verification**: Disabled

---

## Slash Commands

Implemented in `src/lib/slashCommands.ts`.

All commands are parsed and executed in `ChatArea.tsx` before sending to LLM.

### Command Registry

#### `/help`
- **Description**: List available commands
- **Usage**: `/help`
- **Behavior**: Returns formatted list of all commands with usage examples

#### `/backtest <strategy> [start] [end] [capital]`
- **Description**: Run backtest for current session
- **Usage**: 
  - `/backtest skew_convexity_v1`
  - `/backtest vol_spike_reversal_v1 2020-01-01 2023-12-31 250000`
- **Behavior**:
  1. Parse arguments (strategy required, others optional with defaults)
  2. Call `backtest-run` edge function
  3. Poll for completion (check status every 2s, max 120s)
  4. Format results and display in chat as system message
  5. Update Quant tab's current run display

#### `/runs [limit]`
- **Description**: List recent runs for current session
- **Usage**: 
  - `/runs`
  - `/runs 10`
- **Behavior**:
  1. Query `backtest_runs` for current `session_id`
  2. Order by `started_at DESC`
  3. Limit to N (default 5, max 20)
  4. Format as table with columns: Strategy, Period, Status, Key Metrics
  5. Display in chat as system message

#### `/note <content> [type:TYPE] [importance:LEVEL] [tags:tag1,tag2]`
- **Description**: Create memory note from chat
- **Usage**:
  - `/note This is a quick insight`
  - `/note Strategy X fails in bear markets type:warning importance:high`
  - `/note Momentum works tags:momentum,trend`
- **Behavior**:
  1. Parse `content` (required)
  2. Parse optional flags:
     - `type:VALUE` → `memoryType`
     - `importance:VALUE` → `importance`
     - `tags:VALUE` → `tags` array (comma-separated)
  3. Validate `memoryType` and `importance`
  4. Call `memory-create` edge function
  5. Display confirmation in chat
  6. Update Memory tab if visible

#### `/compare [N]`
- **Description**: Compare recent completed runs
- **Usage**:
  - `/compare` (default N=2)
  - `/compare 3`
- **Behavior**:
  1. Query `backtest_runs` for current session
  2. Filter `status='completed'`
  3. Order by `started_at DESC`
  4. Limit to N (default 2, max 5)
  5. Build comparison summary:
     - Table with Strategy, Period, Engine, Metrics for each run
     - "Best performer" highlights (best CAGR, best Sharpe, lowest Max DD)
  6. Display in chat as system message
  7. Hint user to use Quant tab for visual comparison

#### `/audit_run N` or `/audit_run id:<runId>`
- **Description**: Perform deep Strategy Auditor analysis of a completed backtest run
- **Usage**:
  - `/audit_run 1` (audit most recent completed run)
  - `/audit_run 3` (audit 3rd most recent completed run)
  - `/audit_run id:abc-123-def` (audit specific run by ID)
- **Behavior**:
  1. Parse argument: 1-based index OR `id:<uuid>`
  2. Fetch the specified completed run from `backtest_runs`
  3. Fetch relevant memory notes:
     - Run-linked notes (`run_id = this run`)
     - Strategy-tagged notes (`tags` contains `strategy_key`)
     - High/critical importance rules/warnings
  4. Build structured summaries:
     - `buildRunSummary(run)`: params, metrics, equity curve summary
     - `buildMemorySummary(notes)`: grouped by type/importance
  5. Build audit prompt using Chief Quant Auditor mode template
  6. Call `chat` edge function with audit prompt
  7. Return structured analysis with sections:
     - Quick Overview
     - Structural Edge Assessment
     - Failure Modes & Risks
     - Rule & Memory Alignment
     - Suggested Experiments
     - Conclusion
  8. Display audit result in chat as system message

#### `/mine_patterns [limit]`
- **Description**: Detect recurring patterns across multiple backtest runs and memory
- **Usage**:
  - `/mine_patterns` (default limit=100)
  - `/mine_patterns 50` (analyze last 50 completed runs)
- **Behavior**:
  1. Parse optional limit argument (10-200, default 100)
  2. Fetch last N completed runs for current session
  3. Extract unique strategy keys from runs
  4. Fetch relevant memory notes:
     - Strategy-tagged notes (tags matching run strategies)
     - High/critical importance rules/warnings
     - Limit to 30 most relevant notes
  5. Build aggregated summaries:
     - `buildRunsAggregate(runs)`: groups by strategy/regime, computes medians, failure rates
     - `buildRelevantMemory(notes, strategyKeys)`: prioritizes rules/warnings, limits to top 15
  6. Build pattern mining prompt using Pattern Miner mode template
  7. Call `chat` edge function with pattern prompt
  8. Return structured analysis with sections:
     - Repeated Patterns (with evidence counts)
     - Cross-Strategy Insights
     - Conflicting Evidence
     - Candidate Rules (proposed new rules)
     - Deprecated Rules (contradicted by evidence)
     - Suggested Experiments
   9. Display pattern mining result in chat as system message
   10. Minimum 5 completed runs required

#### `/curate_memory`
- **Description**: Review and propose improvements to the current rule set and memory notes
- **Usage**: `/curate_memory`
- **Behavior**:
   1. Fetch all non-archived memory notes for current workspace (up to 200)
   2. Analyze memory using curation helpers:
      - Group notes by strategy tags
      - Find promotion candidates (insights → rules based on importance/evidence)
      - Find weak rules (lack run evidence, old with low importance)
      - Detect conflicts (opposite keywords in same-domain rules)
   3. Build comprehensive curation summary:
      - Current rules by strategy with importance levels
      - Promotion candidates with rationale
      - Weak rules with rationale
      - Potential conflicts with details
   4. Build Memory Curator prompt using Chief Quant Curator mode template
   5. Call `chat` edge function with curator prompt
   6. Return structured recommendations with sections:
      - Promote to Rules (with rationale and suggested importance)
      - Demote or Archive Rules (with rationale and suggested action)
      - Merge or Refactor Notes (duplicates/overlaps)
      - Contradictions (conflicting rules and resolutions)
      - Proposed Updated Ruleset (cleaned-up rules by strategy)
   7. Display curator recommendations in chat as system message
   8. Note: Recommendations only; user must manually edit via Memory panel

#### `/suggest_experiments [focus]`
- **Description**: Propose next experiments based on existing runs and memory
- **Usage**:
   - `/suggest_experiments` (analyze all runs)
   - `/suggest_experiments skew` (focus on skew-related experiments)
   - `/suggest_experiments strategy:skew_convexity_v1` (focus on specific strategy)
- **Behavior**:
   1. Parse optional focus parameter (any text after command)
   2. Fetch last 100 completed runs for current session
   3. Fetch non-archived memory notes (up to 200) for current workspace
   4. Build experiment planning summaries:
      - Run summary: grouped by strategy, date coverage, typical metrics, regime gaps
      - Memory summary: high/critical rules, warnings, insights
      - Pattern summary: empty for now (can be enhanced with Pattern Miner output)
   5. Build Experiment Director prompt with focus (if provided)
   6. Call `chat` edge function with experiment planning prompt
   7. Return structured experiment plan with sections:
      - Objectives (key questions to answer)
      - High-Priority Experiments (3-10 concrete tests with all details)
      - Secondary Experiments (lower priority but valuable)
      - Dependencies & Missing Info (blockers, limitations)
      - Recommended Execution Order (which to run first and why)
   8. Display experiment plan in chat as system message
   9. Minimum 5 completed runs required
   10. Note: Proposes experiments only; never auto-executes

### Command Autocomplete

`ChatArea.tsx` implements `getCommandSuggestions(input)`:
- If input starts with `/`: return matching commands
- Display as clickable suggestion buttons above input field
- Clicking suggestion auto-fills command

---

## External Backtest Engine

### Environment Variable

`BACKTEST_ENGINE_URL` — base URL of rotation-engine server (e.g., `http://localhost:8000`)

### Expected Interface

#### POST `/run-backtest`

**Request**:
```json
{
  "strategyKey": "string",
  "params": {
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "capital": 100000,
    "profileConfig": {}  // Optional: rotation-engine profile configuration
  }
}
```

**Response** (200 OK):
```json
{
  "metrics": {
    "cagr": 0.182,
    "sharpe": 1.87,
    "max_drawdown": -0.095,
    "win_rate": 0.62,
    "total_trades": 247,
    "avg_trade_duration_days": 3.5  // Optional
  },
  "equity_curve": [
    { "date": "2020-01-01", "value": 100000 },
    { "date": "2020-01-02", "value": 100250 },
    ...
  ]
}
```

**Error Response** (4xx/5xx):
```json
{
  "error": "error message"
}
```

### Fallback Behavior

If `BACKTEST_ENGINE_URL` is not configured OR external call fails:
- `backtest-run` function generates deterministic stub results
- `engine_source` is set to `'stub_fallback'` or `'stub'`
- Stub uses `strategyKey` as seed for pseudo-random metrics
- Stub equity curve is ~100 data points with realistic trends

### Future Enhancements

- **Polling for Long Runs**: If rotation-engine backtests take >60s, implement async pattern:
  - `backtest-run` immediately returns `status='running'`
  - Frontend polls `backtest-get` every 5s until `status='completed'`
  - Rotation-engine webhooks back to Supabase when complete (optional)

- **Profile Configs**: Pass full rotation-engine profile JSON in `params.profileConfig`

- **Multiple Universes**: Support different asset universes (e.g., S&P 500, Russell 2000)

---

## Data Flow Examples

### Example 1: User Sends Chat Message

```
User types in ChatArea → "What's the best strategy for bear markets?"
  ↓
ChatArea.sendMessage()
  ↓
POST /functions/v1/chat
  {
    sessionId: "abc-123",
    workspaceId: "workspace-xyz",
    content: "What's the best strategy for bear markets?"
  }
  ↓
chat edge function:
  1. Load workspace → default_system_prompt
  2. Generate embedding for user message
  3. Call search_memory_notes() → retrieve top 5 relevant notes
     - Prioritize rules/warnings with high/critical importance
  4. Build system prompt:
     - Workspace prompt
     - "Relevant Rules and Warnings:" section
     - "Other Relevant Insights:" section
  5. Load last 10 messages from DB
  6. Save user message to messages table
  7. Call OpenAI Chat Completions:
     - Model: gpt-5-2025-08-07
     - Messages: [system, ...history, user]
  8. Save assistant response to messages table
  9. Return response
  ↓
ChatArea receives response → appends to message list
```

---

### Example 2: User Runs Backtest via Slash Command

```
User types in ChatArea → "/backtest momentum_breakout_v1 2020-01-01 2023-12-31 150000"
  ↓
ChatArea detects "/" → parseCommand()
  ↓
executeCommand('backtest', [...args])
  ↓
POST /functions/v1/backtest-run
  {
    sessionId: "abc-123",
    strategyKey: "momentum_breakout_v1",
    params: {
      startDate: "2020-01-01",
      endDate: "2023-12-31",
      capital: 150000
    }
  }
  ↓
backtest-run edge function:
  1. Insert backtest_runs row (status='running')
  2. Check BACKTEST_ENGINE_URL:
     - If set: POST to {URL}/run-backtest
     - If response OK: parse metrics + equity_curve, engine_source='external'
     - If fails: generate stub, engine_source='stub_fallback'
  3. Update backtest_runs row:
     - status='completed'
     - metrics={...}
     - equity_curve=[...]
     - completed_at=now()
  4. Return completed run
  ↓
executeCommand() polls until completed:
  - Checks status every 2s
  - Max 120s timeout
  ↓
formatBacktestResults() → display in chat as system message:
  - Strategy: momentum_breakout_v1
  - Period: 2020-01-01 to 2023-12-31
  - CAGR: 18.2%
  - Sharpe: 1.87
  - Max Drawdown: -9.5%
  - ...
  ↓
QuantPanel.currentRun updates → Results panel shows chart
```

---

### Example 3: User Saves Insight from Results Panel

```
User clicks "Save Insight to Memory" in QuantPanel Results section
  ↓
Dialog opens:
  - Importance dropdown (default: normal)
  - Tags input
  - Submit button
  ↓
User selects importance='high', tags=['momentum', 'trend'], submits
  ↓
POST /functions/v1/memory-create
  {
    workspaceId: "workspace-xyz",
    content: "Momentum strategy performs well in 2020-2023 period with 18.2% CAGR",
    source: "run_insight",
    runId: "run-abc-123",
    memoryType: "insight",
    importance: "high",
    tags: ["momentum", "trend"]
  }
  ↓
memory-create edge function:
  1. Validate memoryType and importance
  2. Generate embedding using OpenAI embeddings API
  3. Insert into memory_notes:
     - All fields including embedding vector
  4. Return created note
  ↓
MemoryPanel updates → new note appears in "Recent Notes" list
  - Badge: "Run Insight" (source)
  - Badge: "insight" (memory_type)
  - Badge: "high" (importance, highlighted)
  - "View Run" link → loads run-abc-123 into QuantPanel
```

---

## Security Notes

### Authentication

**Current State**: No user authentication implemented. All edge functions use `verify_jwt = false`.

**Future**: When adding auth:
- Enable `verify_jwt = true` in `supabase/config.toml`
- Add Row Level Security (RLS) policies on all tables
- Associate workspaces with user IDs
- Implement session-based access control

### API Keys

- `OPENAI_API_KEY` stored in Supabase secrets (server-side only)
- Never exposed to frontend
- Used by edge functions for OpenAI API calls

### CORS

- All edge functions currently allow `Access-Control-Allow-Origin: *`
- In production: restrict to specific domains

---

## Performance Considerations

### Memory Search

- **Current**: Fetching 15 candidates, re-ranking to 5 for chat context
- **Vector Index**: `ivfflat` on `memory_notes.embedding` column
- **Threshold**: Similarity > 0.7 (adjustable in search function)
- **Tuning**: May need to adjust threshold, match_count based on real usage

### Chat Context Window

- **Current**: Loading last 10 messages per session
- **Risk**: Long sessions may exceed OpenAI context limits
- **Future**: Implement sliding window or summarization for old messages

### Backtest Storage

- **Current**: Full equity curves stored as JSONB in `backtest_runs.equity_curve`
- **Type Safety**: BacktestParams, BacktestMetrics, and EquityPoint types enforce consistent structure across frontend and backend
- **Risk**: Large equity curves (1000+ points) may impact query performance
- **Future**: Consider storing raw results in S3 and linking via `raw_results_url`

### Frontend State

- **Current**: Full message history loaded on session switch
- **Risk**: Sessions with 1000+ messages may slow down UI
- **Future**: Implement pagination or virtualized scrolling for message list

---

## Development Setup

### Prerequisites

- Node.js 18+
- Supabase CLI (for local development)
- OpenAI API key

### Environment Variables

Create `.env` file:

```
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
```

### Supabase Secrets

Set via Supabase dashboard or CLI:

```bash
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set BACKTEST_ENGINE_URL=http://localhost:8000  # optional
```

### Local Development

```bash
npm install
npm run dev  # starts Vite dev server on localhost:5173
```

### Database Migrations

Migrations in `supabase/migrations/` are applied automatically on Supabase.

To create new migration:
```bash
supabase db diff --schema public > supabase/migrations/YYYYMMDD_description.sql
```

### Edge Function Deployment

Edge functions deploy automatically when pushed to Supabase project.

To test locally:
```bash
supabase functions serve
```

---

## Known Technical Debt

### High Priority

- **No User Authentication**: All data currently public (no RLS)
- **Chat Non-Streaming**: Responses appear all at once (streaming disabled for simplicity)
- **Memory Embedding Failures**: If OpenAI embeddings API fails, notes save without embeddings (invisible to semantic search)

### Medium Priority

- **No Run Deletion**: Backtest runs accumulate indefinitely (no cleanup)
- **No Memory Editing**: Memory notes are write-only (can't update after creation)
- **Limited Error Messaging**: Some edge function errors return generic 500s

### Low Priority

- **No Export**: Can't export runs or memory as JSON/CSV
- **No Workspace Sharing**: Single-user only (no collaboration)
- **No Real-Time Updates**: Must refresh to see changes from other tabs/users

---

## Testing Strategy

### Manual Testing Checklist

- [ ] Create workspace and session
- [ ] Send chat message, verify response
- [ ] Run backtest via UI, verify results appear
- [ ] Run backtest via `/backtest` command
- [ ] View run history, select past run
- [ ] Compare 2-3 runs, verify metrics table and chart
- [ ] Create memory note manually, verify in Memory tab
- [ ] Save insight from Results panel, verify in Memory tab with "View Run" link
- [ ] Search memory semantically, verify results
- [ ] Filter memory by type/importance
- [ ] Verify memory appears in chat context (check for rules/warnings in responses)
- [ ] Switch workspaces, verify data isolation
- [ ] Test all slash commands: `/help`, `/backtest`, `/runs`, `/note`, `/compare`, `/audit_run`

### Edge Function Logs

Check logs in Supabase dashboard:
- `chat` function: https://supabase.com/dashboard/project/ynaqtawyynqikfyranda/functions/chat/logs
- `backtest-run` function: https://supabase.com/dashboard/project/ynaqtawyynqikfyranda/functions/backtest-run/logs
- `memory-search` function: https://supabase.com/dashboard/project/ynaqtawyynqikfyranda/functions/memory-search/logs
- `memory-create` function: https://supabase.com/dashboard/project/ynaqtawyynqikfyranda/functions/memory-create/logs

### Database Queries

Use Supabase SQL Editor to inspect data:
```sql
-- Check recent runs
SELECT id, strategy_key, status, started_at, engine_source 
FROM backtest_runs 
ORDER BY started_at DESC 
LIMIT 10;

-- Check memory notes with embeddings
SELECT id, content, memory_type, importance, embedding IS NOT NULL as has_embedding 
FROM memory_notes 
ORDER BY created_at DESC 
LIMIT 10;

-- Check chat sessions
SELECT s.title, COUNT(m.id) as message_count 
FROM chat_sessions s 
LEFT JOIN messages m ON m.session_id = s.id 
GROUP BY s.id, s.title 
ORDER BY s.updated_at DESC;
```

---

## Deployment

### Frontend

Frontend auto-deploys via Lovable on every commit.

Production URL: `{project}.lovable.app`

### Backend (Supabase)

- Database migrations auto-apply on push
- Edge functions auto-deploy on push
- Secrets managed via Supabase dashboard

### External Engine

Rotation-engine server must be deployed separately:
- Set `BACKTEST_ENGINE_URL` secret in Supabase
- Ensure server is publicly accessible or on same VPC
- Implement `/run-backtest` endpoint per contract above

---

## Future Architecture Considerations

### Stage 1: Rotation-Engine Integration

- Finalize API contract with rotation-engine
- Add profile config support in `backtest_runs.params`
- Implement status polling for long-running backtests

### Stage 2: Memory Hardening

- Add retry logic for embedding generation
- Implement memory editing (update type, importance, content)
- Add memory archiving (archived flag)

### Stage 3: Chief Quant Identity

- Specialized system prompt for quant research
- Agent modes: audit, curate, suggest
- Proactive experiment suggestions

### Stage 4: Local-Code Tools

- Read-only API bridge to local rotation-engine repo
- Code search command
- Config preview in chat

### Post-v1: Advanced Features

- Real-time collaboration
- Auto-experimentation (parameter sweeps)
- Advanced dashboards and analytics
- Git integration
- Alerting and notifications
