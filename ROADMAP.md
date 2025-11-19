# Quant Chat Workbench — Roadmap

## Vision

**Quant Chat Workbench** is a research environment that combines conversational AI, quantitative tools, persistent memory, and backtest orchestration for rotation-engine strategy development. It provides a single interface for running experiments, analyzing results, capturing insights, and iterating on trading strategies without leaving the chat workflow.

---

## Current Capabilities

### Core Infrastructure
- **Workspaces**: Multi-tenant organization of research projects
- **Chat Sessions**: Conversation containers within workspaces with full message history
- **Chat Engine**: OpenAI integration via Supabase edge function with streaming disabled (can be added later)

### Quant Tab
- **Strategy Selection**: Dropdown for available strategies (strategies table)
- **Backtest Runner**: Supabase edge function (`backtest-run`) that:
  - Calls external rotation-engine via `BACKTEST_ENGINE_URL` if configured
  - Falls back to deterministic stub generator if external engine unavailable
  - Records runs in `backtest_runs` table with status tracking
- **Results Display**: Metrics grid (CAGR, Sharpe, Max Drawdown, Win Rate, Total Trades) and equity curve chart
- **Run Metadata**: Labels, notes, and tags for organizing experiments

### Run History
- **Experiment Browser**: Recent runs per session displayed as cards
- **Run Selection**: Click to load historical run into Results panel
- **Filtering**: Filter by label, date range, or status

### Run Comparison
- **Multi-Select**: Checkbox selection for 2–3 runs in Experiment Browser
- **Comparison Panel**: Side-by-side metrics table and normalized equity curves chart
- **Clear Selection**: Quick deselect all button

### Memory System
- **Workspace Notes**: Manual notes created from Memory tab
- **Run-Linked Insights**: Insights saved from Results panel attached to specific backtest runs
- **Structured Memory**:
  - **Types**: insight, rule, warning, todo, bug, profile_change
  - **Importance Levels**: low, normal, high, critical
- **Semantic Search**: Vector similarity search using OpenAI embeddings (pgvector)
- **Filtering**: Filter memory by type and importance level
- **Chat Integration**: Relevant memory (prioritizing rules/warnings) injected into system prompt before each LLM call

### Slash Commands
- `/help` — List available commands
- `/backtest <strategy> [start] [end] [capital]` — Run backtest from chat
- `/runs [limit]` — List recent runs for current session
- `/note <content> [type:TYPE] [importance:LEVEL] [tags:tag1,tag2]` — Create memory note from chat
- `/compare [N]` — Compare N recent completed runs (default 2, max 5)
- `/audit_run N` or `/audit_run id:<runId>` — Deep analysis of a specific run (Strategy Auditor mode)
- `/mine_patterns [limit]` — Detect patterns across runs (Pattern Miner mode, default 100 runs)

---

## v1 DONE Definition

Version 1.0 is considered complete when:

- ✅ I can run **real rotation-engine profiles** from this app (not just stubs)
- ✅ I can see and compare runs with full metrics and equity curves
- ✅ I can save and retrieve insights, rules, and warnings efficiently
- ✅ Memory **actively influences** chat reasoning (rules/warnings prioritized)
- ⬜ I have a stable **"Chief Quant" identity** with specialized system prompts
- ⬜ I can perform basic **agent modes**: audit existing runs, curate memory, suggest experiments
- ⬜ I have lightweight **local-code tools** for bridging to my local rotation-engine repo
- ✅ I can stay in this app for 90% of quant research without switching to CLI/IDE

---

## Remaining Work to v1 DONE

### Stage 1: Rotation-Engine Integration & Run Metadata Refinement ✅
- **Type System**: Implemented strongly-typed BacktestParams, BacktestMetrics, and EquityPoint interfaces shared across frontend and backend
- **Real Engine Bridge**: Finalize POST `/run-backtest` contract with rotation-engine
- **Profile Selection**: Support rotation-engine profile configs in strategy dropdown
- **Run Metadata**: Enhance params structure to capture profile variations (e.g., rebalance frequency, universe filters)
- **Status Polling**: Handle long-running backtests with status updates (if needed)
- **Error Reporting**: Surface engine errors clearly in UI

### Stage 2: Memory Hardening & Retrieval Quality ✅
- ✅ **Embedding Reliability**: Embeddings generated on create/edit with fallback to previous embedding on failure
- ✅ **Memory Editing**: Full edit support for content, type, importance, and tags with embedding regeneration
- ✅ **Memory Archiving**: Archive/unarchive functionality with separate active/archived views
- ✅ **Chat Retrieval Filtering**: Only active (non-archived) notes with embeddings used in chat context
- ⬜ **Retrieval Tuning**: Adjust similarity thresholds and match counts based on real usage
- ⬜ **Rule Enforcement**: Test that critical rules/warnings consistently appear in chat context

### Stage 3: Chief Quant Identity & Agent Modes ✅
- ✅ **Chief Quant Persona**: Specialized system prompt installed as default workspace identity with quant research expertise, memory awareness, and tool knowledge
- ✅ **Audit Mode**: `/audit_run` command to review individual runs with deep structural analysis
- ⬜ **Curation Mode**: `/curate` command to help organize and consolidate memory notes
- ⬜ **Experiment Suggestions**: Proactive suggestions for next experiments based on memory and run history

### Stage 4: Strategy Auditor Mode ✅
- ✅ **Single-Run Analysis**: `/audit_run` command implemented with 1-based indexing or direct run ID lookup
- ✅ **Structured Output**: 6-section analysis (Overview, Structural Edge, Failure Modes, Rule Alignment, Suggested Experiments, Conclusion)
- ✅ **Memory Integration**: Automatic retrieval of run-linked and strategy-tagged memory notes
- ✅ **Audit Prompt Template**: `auditorPrompt.ts` with comprehensive analysis framework
- ✅ **Summary Helpers**: `auditSummaries.ts` with `buildRunSummary` and `buildMemorySummary`

### Stage 5: Pattern Miner Mode ✅
- ✅ **Multi-Run Analysis**: `/mine_patterns` command analyzes 10-200 completed runs (default 100)
- ✅ **Aggregation Logic**: `patternSummaries.ts` groups runs by strategy/regime, computes median metrics and failure rates
- ✅ **Pattern Detection**: Identifies repeated patterns, cross-strategy insights, and conflicting evidence
- ✅ **Rule Management**: Proposes evidence-backed candidate rules and identifies deprecated rules
- ✅ **Pattern Mining Prompt**: `patternMinerPrompt.ts` with 6-section structured output
- ✅ **Evidence Counting**: Emphasis on evidence counts and recurring themes across runs

### Stage 6: Thin Local-Code Tools
- **Repo Bridge**: Simple API bridge to local rotation-engine repo for reading code/configs
- **Code Search**: `/code <query>` to search local repo from chat
- **Config Preview**: Show current rotation-engine config in chat when discussing strategies
- **Minimal Read-Only**: No git operations, just read access for context

---

## Deferred / Post-v1 Ideas

These are valuable but not required for v1.0:

- **Export/Sharing**: Export comparisons as JSON/CSV, shareable links
- **Advanced Dashboards**: Time-series views of strategy performance over multiple runs
- **Auto-Experimentation**: Automated parameter sweeps or hyperparameter optimization
- **Multi-User Collaboration**: Workspace sharing, comments, activity feeds
- **Real-Time Data**: Live market data integration for strategy monitoring
- **Alerting**: Email/Slack notifications for backtest completion or anomalies
- **Run Tagging Automation**: Auto-tag runs based on results (e.g., "high_sharpe", "drawdown_spike")
- **Memory Analytics**: Visualizations of memory usage, tag clouds, citation counts
- **Version Control Integration**: Link runs to specific git commits in rotation-engine repo

---

## How to Work on This Project

### Development Philosophy
- **Small, Focused Phases**: Break work into clear phases with explicit goals
- **Documentation First**: Update ROADMAP.md and ARCHITECTURE.md before major changes
- **No Feature Creep**: Avoid adding "nice-to-have" features without explicit user request
- **Stabilization Between Phases**: After each phase, perform light stabilization pass

### Phase Execution Standards
- Complete every step fully before moving to the next phase
- Fix broken dependencies silently (don't ask for approval on obvious fixes)
- Use checkpoints only when explicitly required
- Report actions clearly at each step

### Code Standards
- Use TypeScript strict mode with proper types (no `any` unless absolutely necessary)
- Add null guards for all database queries (use `.maybeSingle()` not `.single()`)
- Use semantic design tokens from `index.css` and `tailwind.config.ts`
- Keep components focused and under 300 lines when possible
- Test edge functions with `/functions/{name}/logs` after changes

### Documentation Maintenance
- When adding new slash commands: update command registry and `/help` text
- When adding database tables/columns: update ARCHITECTURE.md schema section
- When changing major workflows: update ARCHITECTURE.md flow descriptions
- When deferring features: move them to "Deferred" section in ROADMAP.md

---

## Current Status

**Phase Completed**: Phase 10 (Run Comparison)

**Next Phase**: Stage 1 — Rotation-Engine Integration

**Known Issues**: See ARCHITECTURE.md for technical notes
