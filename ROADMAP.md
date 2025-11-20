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
- `/curate_memory` — Review and propose improvements to memory notes (Memory Curator mode)
- `/suggest_experiments [focus]` — Propose next experiments (Experiment Director mode)
- `/risk_review [focus]` — Review structural risk across runs (Risk Officer mode)
- `/list_dir path:<path>` — List rotation-engine directory contents
- `/open_file path:<path>` — Show rotation-engine file contents
- `/search_code <query>` — Search rotation-engine code for terms
- `/auto_analyze [scope]` — Run autonomous research loop combining all agent modes (Autonomous Research Loop mode)

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

### Stage 6: Memory Curator & Rule Engine ✅
- ✅ **Memory Curation**: `/curate_memory` command reviews all non-archived memory notes (up to 200)
- ✅ **Curation Helpers**: `memoryCuration.ts` with analysis functions:
  - `groupMemoryByStrategy()`: Groups notes by strategy tag with "global" fallback
  - `findPromotionCandidates()`: Identifies insights ready for promotion to rules
  - `findWeakRules()`: Detects rules lacking evidence or outdated
  - `findConflicts()`: Keyword-based conflict detection for same-domain rules
  - `buildCurationSummary()`: Comprehensive text summary for all analysis sections
- ✅ **Curator Prompt**: `memoryCuratorPrompt.ts` with 5-section structured output
- ✅ **Recommendations**:
  - Promote to Rules (with rationale and suggested importance)
  - Demote or Archive Rules (with rationale and suggested action)
  - Merge or Refactor Notes (duplicates/overlaps)
  - Contradictions (conflicting rules and resolutions)
  - Proposed Updated Ruleset (cleaned-up rules by strategy)
- ✅ **Conservative Approach**: Suggestions only; user manually edits via Memory panel
- ✅ **Integration**: Uses Chief Quant Curator mode identity for analysis

### Stage 7: Experiment Director Mode ✅
- ✅ **Experiment Planning**: `/suggest_experiments [focus]` command designs concrete next experiments
- ✅ **Experiment Director Prompt**: `experimentDirectorPrompt.ts` with 5-section structured output
- ✅ **Planning Helpers**: `experimentPlanning.ts` with analysis functions:
  - `buildExperimentRunSummary()`: Summarizes runs by strategy, date coverage, metrics, regime gaps
  - `buildExperimentMemorySummary()`: Focuses on high/critical rules/warnings and insights
- ✅ **Concrete Experiment Design**: Each experiment includes:
  - Strategy/profile (exact key)
  - Date range with regime rationale
  - Parameter variations (if relevant)
  - Hypothesis with expectations
  - Evidence basis (patterns/rules/gaps)
  - Success and failure criteria
- ✅ **Prioritization**: Orders experiments by information gain, flags dependencies
- ✅ **Focus Capability**: Optional focus parameter to target specific strategies or areas
- ✅ **Research Lead Approach**: Emphasizes learning and structural understanding over P&L optimization
- ✅ **Integration**: Uses Chief Quant Experiment Director mode identity
- ✅ **Minimum Data**: Requires at least 5 completed runs

### Stage 8: Risk Officer Mode ✅
- ✅ **Risk Analysis**: `/risk_review [focus]` command identifies structural risks and rule violations
- ✅ **Risk Officer Prompt**: `riskOfficerPrompt.ts` with 7-section structured report
- ✅ **Risk Summarization Helpers**: `riskSummaries.ts` with analysis functions:
  - `buildRiskRunSummary()`: Aggregates extreme drawdowns, worst runs, per-strategy risk profiles, regime failures, coverage gaps
  - `buildRiskMemorySummary()`: Prioritizes critical/high rules and warnings
- ✅ **Conservative Analysis**: Evidence-based focus on downside protection and structural vulnerabilities
- ✅ **Comprehensive Risk Review**: Includes:
  - Key structural risks (extreme DD, unstable metrics, regime inconsistencies)
  - Rule violations with severity levels
  - Repeated failure modes with patterns
  - Dangerous regimes and strategy vulnerabilities
  - Tail risk indicators (asymmetry, fat tails, volatility clustering)
  - Concrete mitigation recommendations
  - Critical alerts for catastrophic signals
- ✅ **Focus Capability**: Optional focus parameter to narrow analysis to specific strategies
- ✅ **Safety-First Approach**: Emphasizes preventing disasters over optimizing upside
- ✅ **Integration**: Uses Chief Quant Risk Officer mode identity
- ✅ **Minimum Data**: Requires at least 5 completed runs

### Stage 9: Local Code Bridge (rotation-engine introspection) ✅
- ✅ **Read-Only Code Access**: Three edge functions provide safe access to rotation-engine codebase:
  - `read-file`: Read file contents (with 100KB truncation for large files)
  - `list-dir`: List directory entries (sorted, directories first)
  - `search-code`: Recursive code search (supports `.py`, `.js`, `.ts`, `.json`, `.yaml`, `.yml`, `.toml`, `.md`)
- ✅ **Slash Commands**: `/list_dir path:<path>`, `/open_file path:<path>`, `/search_code <query>`
- ✅ **Path Validation**: Blocks parent traversal (`..`) and absolute paths for security
- ✅ **Smart Filtering**: Skips common non-code directories (`.git`, `__pycache__`, `node_modules`, `.venv`)
- ✅ **Code-Aware Prompt Template**: `codeAwarePrompt.ts` for analyzing strategy code with Chief Quant
- ✅ **Environment Configuration**: `ROTATION_ENGINE_ROOT` environment variable (default: `/rotation-engine`)
- ✅ **Safety**: Completely read-only, no write or modification capabilities
- ✅ **Performance**: Limits search results to 100 matches, truncates large files
- ✅ **Integration Ready**: Can be integrated into agent modes (Auditor, Pattern Miner, etc.) for code-aware analysis

### Stage 10: Autonomous Research Loop v1 ✅
- ✅ **Multi-Agent Orchestration**: `/auto_analyze [scope]` command combines all agent modes into comprehensive research report
- ✅ **Auto-Analyze Prompt**: `autoAnalyzePrompt.ts` with 8-section structured research report
- ✅ **Orchestration Helpers**: `autoAnalyze.ts` with key functions:
  - `selectKeyRuns()`: Intelligently picks 3-5 representative runs (best Sharpe, worst drawdown, most recent, outliers)
  - `buildRunPortfolioSummary()`: Aggregates metrics across all runs, identifies regime gaps, highlights extremes
  - `assembleAgentInputs()`: Merges outputs from all agent modes into unified analysis context
- ✅ **Complete Analysis Pipeline**: Automatically runs:
  - Strategy Auditor on 3 key runs for deep individual analysis
  - Pattern Miner across all runs to detect recurring behaviors
  - Memory Curator to review knowledge base health
  - Risk Officer to identify structural vulnerabilities
  - Experiment Director to propose prioritized next tests
- ✅ **Comprehensive Report Sections**:
  - Executive Summary (key findings overview)
  - Key Observations with specific evidence (runs, metrics, dates)
  - Structural Conclusions (convexity, regimes, failure modes)
  - Conflicts or Rule Violations (contradictions, breaches, invalidated beliefs)
  - Recommended Experiments (3-8 prioritized tests with hypotheses)
  - Updated Understanding (how mental model should shift)
  - Suggested Memory Updates (rule/insight changes requiring user confirmation)
  - Long-Term Risk Flags (systemic vulnerabilities)
- ✅ **Scope Filtering**: Optional scope parameter to focus analysis on specific strategies or tags
- ✅ **Safety Guarantees**: No auto-execution of backtests, no auto-editing of memory, all recommendations require user confirmation
- ✅ **Integration**: Uses Chief Quant base identity with autonomous research synthesis instructions
- ✅ **Minimum Data**: Requires at least 5 completed runs, works best with >20 runs and meaningful memory
- ✅ **Performance**: Limits audits to 3 key runs, aggregates efficiently, handles large run sets gracefully

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
