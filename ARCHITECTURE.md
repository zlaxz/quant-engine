# Quant Chat Workbench — Architecture

## Overview

**Quant Chat Workbench** is a full-stack quantitative research application with:

- **Frontend**: React 18 + TypeScript + Vite, deployed via Lovable
- **Backend**: Supabase (PostgreSQL + Edge Functions on Deno runtime)
- **External Engine**: rotation-engine Python server for real backtests (optional, with stub fallback)
- **LLM Provider**: OpenAI for chat completions (GPT-4+) and embeddings (text-embedding-3-small)
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
created_at    timestamp with time zone DEFAULT now()
```

**Indexes**:
- `idx_memory_notes_workspace_id` on `workspace_id`
- `idx_memory_notes_run_id` on `run_id`
- `idx_memory_notes_embedding` using `ivfflat` (vector similarity)
- `idx_memory_notes_memory_type` on `memory_type`
- `idx_memory_notes_importance` on `importance`

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

### `chat`

**Endpoint**: `POST /functions/v1/chat`

**Request Body**:
```json
{
  "sessionId": "uuid",
  "workspaceId": "uuid",
  "content": "user message text"
}
```

**Behavior**:
1. Initialize Supabase client
2. Fetch workspace details (for `default_system_prompt`)
3. Load previous messages from `messages` table (limited to last N for context)
4. **Memory Retrieval**:
   - Generate embedding for user's message using OpenAI embeddings API
   - Call `search_memory_notes` RPC function with embedding
   - Retrieve top 5–15 semantically similar notes
   - **Prioritize**: critical/high importance rules and warnings
   - Format into system prompt sections:
     - "Relevant Rules and Warnings:" (critical/high rules/warnings first)
     - "Other Relevant Insights:" (remaining notes)
5. Construct message array:
   - System message: workspace prompt + memory context
   - Previous messages (last N)
   - New user message
6. Save user message to `messages` table
7. Call OpenAI Chat Completions API (`gpt-5-2025-08-07` by default)
8. Save assistant response to `messages` table
9. Return assistant content to client

**Error Handling**:
- If memory retrieval fails: log error, skip memory injection, continue with chat
- If OpenAI API fails: return 500 with error message
- If workspace not found: return 404

**CORS**: Enabled with `Access-Control-Allow-Origin: *`

**JWT Verification**: Disabled (`verify_jwt = false` in config)

---

### `backtest-run`

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
    "capital": 100000
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
    "total_trades": 247
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
- [ ] Test all slash commands: `/help`, `/backtest`, `/runs`, `/note`, `/compare`

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
