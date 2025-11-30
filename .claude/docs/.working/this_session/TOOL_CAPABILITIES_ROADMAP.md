# Quant OS Tool Capabilities Implementation Roadmap

## Executive Summary

This document outlines the phased implementation plan for completing the Quant Chat Workbench's tool capabilities. The system currently has robust **read-only** operations but lacks **write, modify, git, and validation** capabilities needed for a complete research-to-production workflow.

**Current Status**: Phase 0 Complete (Read-Only Infrastructure)  
**Target**: Full tool parity enabling end-to-end strategy development, testing, and deployment workflows

---

## Phase 0: Current Capabilities (✅ COMPLETE)

### Read Operations
- ✅ `/open_file <path>` — read any file from rotation-engine
- ✅ `/list_dir [path]` — explore directory structure
- ✅ `/search_code <query>` — search for code patterns across codebase

### Backtest Execution & Analysis
- ✅ `/backtest` — run backtests with external engine integration
- ✅ `/runs [strategy] [limit]` — list recent backtest runs
- ✅ `/compare <run_id1> <run_id2>` — compare two runs
- ✅ Experiment Browser UI — visual run history and comparison

### Memory & Knowledge Management
- ✅ `/note <content>` — create workspace memory
- ✅ Memory tab — browse, search, edit, archive notes
- ✅ Semantic search with embeddings
- ✅ Memory types and importance levels

### Research Agent Modes
- ✅ `/audit_run <run_id>` — deep run analysis
- ✅ `/mine_patterns [scope]` — cross-run pattern detection
- ✅ `/curate_memory` — knowledge base health review
- ✅ `/suggest_experiments [scope]` — hypothesis generation
- ✅ `/risk_review [scope]` — downside risk identification
- ✅ `/auto_analyze [scope]` — parallel multi-agent research
- ✅ `/red_team_file <path>` — parallel code auditing

### Research Reports
- ✅ `/save_report` — persist research findings
- ✅ `/list_reports` — query saved reports
- ✅ `/open_report <id>` — retrieve specific report

### Helper Systems
- ✅ Onboarding helper agent — separate tutorial/guidance chat
- ✅ Slash command palette UI — visual command discovery

---

## Phase 1: Core Write Operations (✅ COMPLETE)

**Goal**: Enable Chief Quant to apply insights by modifying code files safely.

**Rationale**: Without write capabilities, all research insights remain theoretical. This is the single most critical missing capability that prevents the system from being a complete research workflow tool.

**Status**: ✅ Fully implemented via MCP tools with slash commands, safety confirmations, backups, validation, and audit logging.

### Features to Implement

#### 1.1 Basic File Writing
- **`/write_file <path> <content>`** — create or overwrite entire file
  - Confirmation dialog showing full diff before execution
  - Backup creation (`.bak` file) before overwrite
  - Syntax validation for Python files
  - Support for all common file types (`.py`, `.json`, `.yaml`, `.md`, `.txt`)

#### 1.2 Append Operations
- **`/append_file <path> <content>`** — append content to end of file
  - Show preview of final ~20 lines after append
  - Automatic newline handling
  - Useful for adding new functions, config entries, test cases

#### 1.3 Patch/Diff Application
- **`/apply_diff <path> <diff>`** — apply unified diff patch to file
  - Parse unified diff format
  - Validate line numbers and context match
  - Rollback on failure
  - Show before/after preview
  - **This is the preferred method for surgical edits**

#### 1.4 Delete Operations
- **`/delete_file <path>`** — remove file with confirmation
  - Trash/backup before deletion (move to `.trash/` directory)
  - Prevent deletion of critical files (`.git/`, `config/`, etc.)
  - Confirmation prompt with file contents preview

#### 1.5 File Management
- **`/rename_file <old_path> <new_path>`** — rename/move file
- **`/copy_file <source> <dest>`** — duplicate file
- **`/create_dir <path>`** — create directory structure
- **`/move_file <source> <dest>`** — move file (alias for rename)

### Implementation Requirements

#### Safety Features (NON-NEGOTIABLE)
1. **All write operations require explicit confirmation** via UI dialog
2. **Automatic backup creation** before any destructive operation
3. **Diff preview** for all modifications (show before/after)
4. **Path validation** — prevent writing outside rotation-engine root
5. **Syntax validation** — lint Python files before writing
6. **Rollback capability** — maintain last 10 backups per file
7. **Write log** — persist all write operations to audit trail

#### Edge Function Architecture
- **`write-file`** edge function — handles all write operations
  - Accepts: `{ operation: 'write' | 'append' | 'patch' | 'delete' | 'rename' | 'copy', path: string, content?: string, diff?: string, ... }`
  - Returns: `{ success: boolean, backup_path?: string, preview?: string, error?: string }`
  - Uses `Deno.env.get("ROTATION_ENGINE_ROOT")` for path resolution
  - Validates paths to prevent traversal attacks
  - Creates `.backups/` directory for automatic backups

#### Frontend Integration
- New slash commands in `src/lib/slashCommands.ts`
- Confirmation dialog component: `src/components/code/WriteConfirmationDialog.tsx`
  - Shows file path, operation type, diff preview
  - "Confirm" / "Cancel" buttons
  - "Create backup" checkbox (default: true)
- Write operation helpers: `src/lib/codeWriter.ts`
  - `confirmWrite(operation, path, content)` — show dialog and execute
  - `showDiffPreview(oldContent, newContent)` — render side-by-side diff
  - `createBackup(path)` — backup before write

### Success Criteria
- [x] Chief Quant can create new strategy files from chat via MCP tools
- [x] Chief Quant can modify existing profiles based on backtest results
- [x] Chief Quant can apply code fixes discovered via `/red_team_file`
- [x] All write operations show clear diffs and require confirmation
- [x] Backups are automatically created and can be restored
- [x] Write operations are logged for audit trail

### Testing Checklist
- [ ] Create new Python strategy file with valid syntax
- [ ] Modify existing profile JSON with parameter changes
- [ ] Append new filter to existing strategy file
- [ ] Apply diff patch to fix bug in existing code
- [ ] Delete temporary test file
- [ ] Rename strategy file
- [ ] Attempt to write outside rotation-engine root (should fail)
- [ ] Attempt to write invalid Python syntax (should fail validation)
- [ ] Restore from backup after bad write

---

## Phase 2: Git Workflow Integration (✅ COMPLETE)

**Goal**: Enable version control operations so insights can be tracked, branched, and rolled back.

**Rationale**: Write operations without git integration create risky, untracked changes. Git commands enable safe experimentation and collaboration.

**Status**: ✅ Fully implemented via MCP tools - all core git operations (status, diff, log, commit, add, branch, checkout, merge, pull, push, revert, stash) available to Chief Quant.

### Features to Implement

#### 2.1 Status & Inspection
- **`/git_status`** — show working tree status (modified, staged, untracked files)
- **`/git_diff [path]`** — show unstaged changes (all files or specific path)
- **`/git_diff_staged [path]`** — show staged changes
- **`/git_log [limit]`** — show recent commits (default: last 10)
- **`/git_show <commit_hash>`** — show specific commit details

#### 2.2 Staging & Committing
- **`/git_add <path>`** — stage file(s) for commit
- **`/git_add_all`** — stage all changes
- **`/git_reset <path>`** — unstage file
- **`/git_commit <message>`** — commit staged changes with message
- **`/git_commit_all <message>`** — stage all and commit (convenience)

#### 2.3 Branch Management
- **`/git_branch`** — list all branches
- **`/git_branch_create <name>`** — create new branch
- **`/git_checkout <branch>`** — switch to branch
- **`/git_checkout_new <name>`** — create and switch to new branch
- **`/git_merge <branch>`** — merge branch into current

#### 2.4 Remote Operations
- **`/git_pull`** — pull latest changes from remote
- **`/git_push`** — push commits to remote
- **`/git_fetch`** — fetch remote changes without merging

#### 2.5 History & Rollback
- **`/git_revert <commit>`** — revert specific commit
- **`/git_reset_hard <commit>`** — reset to commit (DANGEROUS - requires confirmation)
- **`/git_stash`** — stash working changes
- **`/git_stash_pop`** — apply stashed changes

### Implementation Requirements

#### Edge Function Architecture
- **`git-cmd`** edge function — executes git commands via Deno subprocess
  - Accepts: `{ command: string, args: string[], cwd: string }`
  - Returns: `{ success: boolean, stdout: string, stderr: string, exit_code: number }`
  - Uses `Deno.Command` to spawn git subprocess
  - Validates git is installed and repo exists
  - Sanitizes command arguments to prevent injection

#### Safety Features
1. **Destructive operations require confirmation** (`git reset --hard`, `git merge`, `git revert`)
2. **Status check before commits** — show what will be committed
3. **Branch protection** — prevent force-push to main/master
4. **Stash prompt** — offer to stash before checkout if working tree is dirty
5. **Remote safety** — confirm before push to remote

#### Frontend Integration
- Git status indicator in UI header (show branch, dirty files count)
- Commit dialog component with multi-line message input
- Branch switcher dropdown
- Visual diff viewer for `git diff` output

### Success Criteria
- [x] Chief Quant can stage and commit changes from chat via MCP tools
- [x] Chief Quant can create branches for experiments
- [x] Chief Quant can switch between branches
- [x] Chief Quant can merge successful experiments into main
- [x] Chief Quant can revert problematic changes
- [x] Chief Quant can stash work-in-progress changes
- [x] Git operations show clear output and confirmation prompts

### Testing Checklist
- [ ] Check git status after write operations
- [ ] Stage and commit new strategy file
- [ ] Create experiment branch for parameter sweep
- [ ] View diff of uncommitted changes
- [ ] Revert bad commit
- [ ] Merge experiment branch into main
- [ ] Pull remote changes
- [ ] Push commits to remote
- [ ] Attempt force-push to main (should fail)
- [ ] Stash and restore working changes

---

## Phase 3: Code Validation & Testing (✅ COMPLETE)

**Goal**: Enable automated testing and validation before applying changes to production code.

**Rationale**: Write operations without validation create risk of introducing bugs. Testing capabilities ensure code quality and catch regressions.

### Features to Implement

#### 3.1 Test Execution
- **`/run_tests [path]`** — run pytest on specific file or directory
  - Default: run all tests
  - Show pass/fail summary
  - Display failed test details
  - Return exit code and coverage metrics

#### 3.2 Strategy Validation
- **`/validate_strategy <path>`** — validate strategy file structure and syntax
  - Check required methods exist (`entry`, `exit`, `position_size`)
  - Validate parameter schema
  - Check for common bugs (lookahead bias, division by zero)
  - Return validation report with errors/warnings

#### 3.3 Dry Run Backtesting
- **`/dry_run_backtest <strategy_key> <params>`** — run backtest without saving to DB
  - Quick validation that strategy runs without crashing
  - Return basic metrics (trades, errors, runtime)
  - No persistence — just validation
  - Faster than full backtest (smaller date range)

#### 3.4 Code Quality Tools
- **`/lint_code <path>`** — run pylint/flake8 on file
  - Return lint errors and warnings
  - Show code quality score
  - Suggest fixes for common issues

- **`/format_code <path>`** — run black formatter on file
  - Show formatted diff
  - Optionally apply formatting

- **`/type_check <path>`** — run mypy type checking
  - Return type errors
  - Useful for catching type-related bugs

#### 3.5 Dependency Management
- **`/check_deps`** — validate all dependencies are installed
  - Compare `requirements.txt` to installed packages
  - Show missing or outdated dependencies

- **`/outdated_packages`** — list packages with available updates
  - Show current vs latest version
  - Security vulnerability warnings

- **`/python_version`** — show Python version and environment info

### Implementation Requirements

#### Edge Function Architecture
- **`run-tests`** edge function — execute pytest via subprocess
- **`validate-code`** edge function — run linters, type checkers, formatters
- **`check-env`** edge function — inspect Python environment and dependencies

#### Safety Features
1. **Test runs are isolated** — no side effects on production data
2. **Dry runs use separate data** — don't pollute backtest history
3. **Validation is non-destructive** — only reports issues, doesn't modify

#### Frontend Integration
- Test results viewer component (show pass/fail, coverage)
- Validation report display with expandable errors
- Dependency status panel in settings

### Success Criteria
- [x] Chief Quant can run tests before committing code changes
- [x] Chief Quant can validate strategy files for correctness
- [x] Chief Quant can dry-run strategies to catch crashes early
- [x] Chief Quant can lint and format code to maintain quality
- [x] Chief Quant can detect missing or outdated dependencies

### Testing Checklist
- [ ] Run all tests and see pass/fail summary
- [ ] Run tests for specific strategy file
- [ ] Validate new strategy file structure
- [ ] Dry-run backtest on new strategy
- [ ] Lint existing strategy file
- [ ] Format messy code file
- [ ] Type-check file with type annotations
- [ ] Check for missing dependencies
- [ ] List outdated packages

---

## Phase 4: Advanced Search & Analysis (✅ COMPLETE)

**Goal**: Enable deeper code understanding and navigation beyond basic text search.

**Rationale**: Text search is limited for understanding code structure, dependencies, and relationships. AST-based tools provide semantic understanding.

**Status**: ✅ Fully implemented via MCP tools - all AST-based analysis operations (find_function, find_class, find_usages, call_graph, import_tree, dead_code, complexity, code_stats) available to Chief Quant.

### Features to Implement

#### 4.1 Function/Class Search
- **`/find_function <name>`** — find function definition across codebase
  - Uses AST parsing for accurate results
  - Returns file path, line number, signature
  - Shows function docstring

- **`/find_class <name>`** — find class definition
  - Returns inheritance hierarchy
  - Lists all methods

#### 4.2 Usage Analysis
- **`/find_usages <symbol>`** — find all references to function/class/variable
  - Shows call sites
  - Useful for impact analysis before refactoring

- **`/call_graph <function>`** — generate call graph for function
  - Shows what functions it calls
  - Shows what functions call it
  - Detects circular dependencies

#### 4.3 Dependency Analysis
- **`/import_tree <module>`** — show import dependency tree
  - Visual representation of module dependencies
  - Detect circular imports

- **`/dead_code`** — find unused functions/variables
  - Useful for cleanup

#### 4.4 Code Metrics
- **`/complexity <path>`** — calculate cyclomatic complexity
  - Identify overly complex functions
  - Suggest refactoring targets

- **`/code_stats [path]`** — show codebase statistics
  - Lines of code, comment ratio
  - Function count, class count
  - Test coverage

### Implementation Requirements

#### Edge Function Architecture
- **`analyze-code`** edge function — AST-based code analysis
  - Uses Python `ast` module for parsing
  - Caches parse trees for performance
  - Returns structured analysis results

#### Frontend Integration
- Call graph visualization component
- Dependency tree viewer
- Code metrics dashboard

### Success Criteria
- [x] Chief Quant can find function definitions without grepping
- [x] Chief Quant can analyze function dependencies before refactoring
- [x] Chief Quant can identify complex code needing simplification
- [x] Chief Quant can detect dead code for cleanup

### Testing Checklist
- [ ] Find a function definition across multiple strategy files
- [ ] Find a class and see its inheritance hierarchy and methods
- [ ] Find all usages of a specific function to assess refactoring impact
- [ ] Generate call graph for a strategy's entry function
- [ ] Show import tree for a module to understand dependencies
- [ ] Scan codebase for dead code and identify unused functions
- [ ] Calculate complexity scores for all functions in a file
- [ ] Generate codebase statistics for rotation-engine project

---

## Phase 5: Workflow Automation (✅ COMPLETE)

**Goal**: Enable batch operations and parameter sweeps for systematic experimentation.

**Rationale**: Manual one-off experiments are slow. Automation enables systematic exploration of parameter space.

### Features to Implement

#### 5.1 Batch Backtesting
- **`batch_backtest`** MCP tool — run multiple backtests in parallel
  - Define parameter grid (e.g., `{"stop_loss": [0.02, 0.03, 0.05], "lookback": [10, 20, 30]}`)
  - Generate all combinations (max 100)
  - Execute in parallel via backtest-run edge function
  - Save all results to DB
  - Return summary of best performers ranked by Sharpe

#### 5.2 Parameter Sweeps
- **`sweep_params`** MCP tool — sweep single parameter
  - Example: `sweep_params(strategy_key="skew_convexity", param_name="stop_loss", start=0.01, end=0.10, step=0.01, ...)`
  - Generates N backtests with parameter from start to end by step (max 50 points)
  - Returns curve of metric vs parameter value

#### 5.3 Regression Testing
- **`regression_test`** MCP tool — run strategy against historical benchmarks
  - Compare current version to benchmark run ID
  - Detect performance degradation (Sharpe, CAGR, drawdown, win rate)
  - Alert if metrics fall below thresholds

#### 5.4 Cross-Validation
- **`cross_validate`** MCP tool — run walk-forward analysis
  - Split data into in-sample and out-of-sample periods
  - Configurable in-sample ratio (default 70%) and num_folds (default 5)
  - Train on in-sample, test on out-of-sample
  - Detect overfitting by comparing in-sample vs out-of-sample Sharpe

### Implementation Requirements

#### MCP Tool Architecture ✅
- **`automationOperations.ts`** — batch experimentation helpers
  - `runBatchBacktest` — parallel orchestration with param grid generation
  - `runParameterSweep` — single-parameter sweep with value generation
  - `runRegressionTest` — benchmark comparison with delta calculation
  - `runCrossValidation` — walk-forward analysis with fold splitting

#### MCP Tool Registration ✅
- All tools registered in `MCP_TOOLS` array with detailed schemas
- Executors added to `executeMcpTool` dispatcher
- Chief Quant prompt updated with automation workflow guidance

### Success Criteria
- [x] Chief Quant can sweep parameter ranges systematically via MCP tools
- [x] Chief Quant can run regression tests before deploying changes
- [x] Chief Quant can validate strategies via cross-validation
- [x] Batch operations leverage existing backtest-run infrastructure

### Testing Checklist
- [ ] Test batch_backtest with 2x3 parameter grid (6 combinations)
- [ ] Test sweep_params with 10-point sweep
- [ ] Test regression_test with known benchmark run
- [ ] Test cross_validate with 3 folds on short date range
- [ ] Verify all results save to DB correctly
- [ ] Verify summary outputs are accurate and actionable

### Hardening Complete ✅
- **Input Validation**: All parameters validated (dates, ratios, limits)
- **Error Handling**: Comprehensive try-catch with descriptive messages
- **Edge Cases**: Last fold coverage, failed backtests, missing benchmarks
- **Supabase Safety**: Using `.maybeSingle()` instead of `.single()`
- **Parameter Grid Bug**: Fixed object reference issue in combination generation
- **Drawdown Logic**: Fixed regression test to properly detect degradation
- **Environment Validation**: All executors check for Supabase credentials
- **Failure Reporting**: Batch summaries include failure counts and examples
- **Sweep Validation**: Validates step > 0, start <= end
- **CV Validation**: Validates in-sample ratio (0-1), fold count (2-10), minimum period lengths
- **Date Coverage**: Last fold uses actual end date for full data coverage

---

## Phase 6: Data Access & Inspection (🟢 MEDIUM PRIORITY)

**Goal**: Enable direct inspection of market data and backtest intermediate results.

**Rationale**: Debugging strategy failures requires seeing actual data, not just final metrics.

### Features to Implement

#### 6.1 Data Inspection
- **`/inspect_data <symbol> <start> <end>`** — show raw market data
  - OHLCV bars
  - Derived indicators
  - Filtering applied

- **`/data_quality_check <symbol> <start> <end>`** — validate data integrity
  - Check for missing bars
  - Detect outliers
  - Validate price consistency

#### 6.2 Trade Log Inspection
- **`/trade_log <run_id>`** — show all trades from backtest run
  - Entry/exit times and prices
  - P&L per trade
  - Hold duration
  - Exit reason (stop loss, take profit, signal)

- **`/trade_detail <run_id> <trade_idx>`** — deep dive on specific trade
  - Show market data at entry/exit
  - Show indicator values at decision points
  - Replay trade execution step-by-step

### Implementation Requirements

#### Edge Function Architecture
- **`inspect-data`** edge function — query market data from storage
- **`trade-log`** edge function — extract trade details from backtest results

#### Frontend Integration
- Data viewer component (table/chart toggle)
- Trade log table with filtering/sorting
- Trade replay visualization

### Success Criteria
- [x] Chief Quant can inspect market data when debugging strategies
- [x] Chief Quant can review individual trades from backtest runs
- [x] Data quality issues are detected and reported
- [x] Trade logs stored locally alongside backtest results
- [x] MCP tools accessible via workspace-init-prompt edge function
- [x] Slash commands integrated into command registry

**Status**: ✅ **COMPLETE** (Phase 6 complete as of 2025-01-19)

**Implementation Summary**:
- Created `dataInspectionOperations.ts` with `inspectMarketData`, `checkDataQuality`, `getTradeLog`, `getTradeDetail`
- Extended `backtest-run` edge function to save full results locally to `data/backtest_results/runs/<run_id>.json`
- Added 4 new MCP tools: `inspect_market_data`, `data_quality_check`, `get_trade_log`, `get_trade_detail`
- Integrated tools into `mcpTools.ts` catalog and execution dispatcher
- Added 4 slash commands: `/inspect_data`, `/data_quality`, `/trade_log`, `/trade_detail`
- All tools accessible to Chief Quant for debugging strategies and analyzing trade-level results

---

## Phase 7: Documentation & Code Generation (🔵 LOW PRIORITY)

**Goal**: Automate documentation and boilerplate generation.

**Rationale**: Documentation maintenance is tedious but critical. Automation improves code quality.

### Features to Implement

#### 7.1 Documentation Generation
- **`/generate_docstrings <path>`** — auto-generate docstrings for functions
  - Uses LLM to generate descriptive docstrings
  - Follows numpy/google docstring format
  - Applies to all undocumented functions in file

- **`/generate_readme <path>`** — create README for module/package
  - Summarizes module purpose
  - Lists key functions/classes
  - Includes usage examples

#### 7.2 Code Scaffolding
- **`/create_strategy <name>`** — generate strategy template
  - Creates file with required methods stubbed
  - Includes docstrings and type hints
  - Follows naming conventions

- **`/create_profile <strategy_key> <name>`** — generate profile template
  - JSON structure with all parameters
  - Includes descriptions and default values

### Success Criteria
- [x] Chief Quant can auto-document code with LLM-generated docstrings
- [x] Chief Quant can scaffold new strategies quickly with proper templates
- [x] Documentation generation uses Lovable AI for intelligent analysis
- [x] Templates follow rotation-engine conventions (numpy docstrings, type hints)

**Status**: ✅ **COMPLETE** (Phase 7 complete as of 2025-01-19)

**Implementation Summary**:
- Created `documentationOperations.ts` with `generateDocstrings`, `generateReadme`, `createStrategy`, `createProfile`
- Integrated Lovable AI (google/gemini-2.5-flash) for intelligent docstring and README generation
- Added 4 new MCP tools: `generate_docstrings`, `generate_readme`, `create_strategy`, `create_profile`
- Integrated tools into `mcpTools.ts` catalog and execution dispatcher
- Templates include numpy-style docstrings, type hints, and follow rotation-engine patterns
- All tools accessible to Chief Quant for automated documentation and scaffolding

---

## Summary

All 7 phases of the Tool Capabilities Roadmap are now complete:

- ✅ **Phase 0**: Read Operations, Backtest Execution, Memory Management (baseline)
- ✅ **Phase 1**: Core Write Operations (write, append, delete, rename, copy, create_dir)
- ✅ **Phase 2**: Git Workflow Integration (status, diff, log, commit, add, branch, merge, push, pull, revert, stash)
- ✅ **Phase 3**: Code Validation & Testing (run_tests, validate_strategy, dry_run_backtest, lint, format, type_check, deps)
- ✅ **Phase 4**: Advanced Search & Analysis (find_function, find_usages, call_graph, import_tree, dead_code, complexity, stats)
- ✅ **Phase 5**: Workflow Automation (batch_backtest, sweep_params, regression_test, cross_validate)
- ✅ **Phase 6**: Data Access & Inspection (inspect_market_data, data_quality_check, get_trade_log, get_trade_detail)
- ✅ **Phase 7**: Documentation & Code Generation (generate_docstrings, generate_readme, create_strategy, create_profile)

**Total MCP Tools Implemented**: 60+ tools across file ops, git, validation, analysis, automation, data inspection, and documentation

**Architecture**:
- All tools follow MCP protocol for discoverability by Chief Quant and other agents
- Tools are accessible via `workspace-init-prompt` edge function
- Slash commands provide user-facing interface for all tool capabilities
- Safety features include confirmations, backups, validation, and audit logging
- Multi-provider LLM routing (Gemini 3, OpenAI GPT-5, DeepSeek) for optimal cost/performance

**v1 DONE**: The Quant OS now has a complete research-to-production tool ecosystem with read/write operations, git integration, validation, automation, data inspection, and documentation generation. Chief Quant can autonomously manage the entire research workflow from code exploration to strategy deployment.

---

## Implementation Priorities Summary

### Must Have (Phase 1-2) — Target: Next 2-4 Weeks
1. **Write operations** — blocking all code modification workflows
2. **Git integration** — essential for safe experimentation

### Should Have (Phase 3-4) — Target: Following 4-6 Weeks
3. **Testing & validation** — critical for code quality
4. **Advanced search** — significantly improves code understanding

### Nice to Have (Phase 5-7) — Target: Future Iterations
5. **Workflow automation** — productivity multiplier
6. **Data inspection** — debugging aid
7. **Documentation** — quality of life improvement

---

## Success Metrics

### Phase 1 Success: Chief Quant can...
- Create new strategy files from research insights
- Modify profiles based on backtest results
- Fix bugs discovered via code audits
- All with safety confirmations and backups

### Phase 2 Success: Chief Quant can...
- Commit changes with descriptive messages
- Create experiment branches for risky changes
- Revert bad commits
- Track code evolution via git history

### Phase 3 Success: Chief Quant can...
- Run tests before committing
- Validate strategy correctness
- Dry-run strategies to catch crashes
- Maintain code quality via linting

### Full System Success: Chief Quant can...
- Execute complete research workflow: ideate → code → test → backtest → analyze → commit
- Operate autonomously with minimal user intervention
- Maintain high code quality and safety standards
- Scale from single experiments to systematic parameter exploration

---

## Architecture Principles

### Safety First
- All destructive operations require explicit confirmation
- Automatic backups before modifications
- Rollback capabilities for all operations
- Audit trail logging

### Gradual Disclosure
- Simple operations are easy
- Complex operations are possible
- Power users get full control
- Beginners get guardrails

### Composability
- Each tool does one thing well
- Tools can be combined in sequences
- Agent modes leverage primitive tools
- No monolithic "do everything" commands

### Observability
- All operations return clear status
- Errors are descriptive and actionable
- Progress tracking for long operations
- Audit logs for debugging

---

## Next Steps

1. **Review this roadmap** — validate phases and priorities
2. **Begin Phase 1 implementation** — start with `/write_file` and `/apply_diff`
3. **Establish testing protocol** — create test rotation-engine repo for validation
4. **Iterate quickly** — ship Phase 1, gather feedback, refine Phase 2
5. **Update Chief Quant prompt** — document new capabilities as they ship

---

**Document Status**: Draft v1.0  
**Last Updated**: 2025  
**Owner**: Chief Architect  
**Next Review**: After Phase 1 completion
