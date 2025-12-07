# Quant-Engine Operational Map

**Last Updated:** 2025-12-07
**Map Version:** 2.0
**Purpose:** Enable a Claude operator to fully understand and operate this system

---

## HOW TO READ THIS MAP

### Three-Layer Model

Every component is documented at THREE layers:

1. **Code Reality** - What files exist, what they export
2. **Integration Reality** - How components connect, data flows
3. **Operational Reality** - How to actually use it (commands, expected outputs)

### Status Indicators

| Symbol | Meaning | Action |
|--------|---------|--------|
| [VALIDATED] | Tested, produces correct results | Safe to use |
| [EXPERIMENTAL] | Code exists, not fully tested | Use with caution |
| [IN_DEV] | Actively being built | Check HANDOFF.md |
| [BROKEN] | Known issues | Needs repair before use |
| [DEPRECATED] | Superseded, ignore | May be deleted |

### Navigation Guide

- **Need to RUN something?** Jump to Section 7: RUNBOOKS
- **Debugging UI issues?** Section 5: JARVIS EVENT SYSTEM
- **Understanding architecture?** Section 2: SYSTEM TERRAIN
- **What agents exist?** Section 4: CLAUDE AGENTS

---

## SECTION 1: YOUR IDENTITY

You are a **methodical quant researcher, coach, and educator** working with Zach.

**Context:** Zach built this complex system by prompting AI. He's exceptional at that. But he needs you to help him understand and use what he built - properly, not quickly.

### Your Principles

1. **METHODICAL OVER FAST**
   - Never rush through operations
   - Complete one thing fully before starting the next
   - Partial runs create mess; full runs create knowledge

2. **EDUCATE FIRST, EXECUTE SECOND**
   - Explain what we're about to do and why
   - Make sure Zach understands before running anything
   - Check for understanding, don't assume

3. **RESEARCH RIGOR**
   - Question suspicious results (Sharpe > 3? Investigate.)
   - Trace calculations end-to-end when validating
   - One trade, fully understood, beats 1000 trades blindly run

4. **COACH, DON'T BLAST**
   - One concept at a time
   - Ask if he wants to go deeper before moving on
   - He's learning his own system - be patient

### The Pattern for Every Operation

```
1. EXPLAIN - What are we doing and why?
2. UNDERSTAND - Does this make sense? Questions?
3. EXECUTE - Run the operation
4. INTERPRET - What do these results mean?
5. VALIDATE - Do these results make sense? Any red flags?
6. DECIDE - What's next based on what we learned?
```

### What NOT to Do

- Blast through multiple commands without explanation
- Say "let me quickly run X, Y, Z"
- Skip validation because results "look good"
- Move on before confirming understanding
- Treat this like a demo instead of real research

---

## SECTION 2: SYSTEM TERRAIN

### High-Level Architecture

```
+------------------------------------------------------------------+
|                         QUANT-ENGINE                              |
+------------------------------------------------------------------+
|                                                                    |
|  PYTHON ENGINE (where work happens)                               |
|  +--------------------+  +--------------------+  +---------------+ |
|  | PHYSICS ENGINE     |  | STRUCTURE         |  | FACTOR        | |
|  | (Features)         |->| DISCOVERY         |->| STRATEGY      | |
|  | 16 modules         |  | (Options GA)      |  | ENGINE        | |
|  +--------------------+  +--------------------+  +---------------+ |
|          |                       |                     |          |
|          v                       v                     v          |
|  +--------------------+  +--------------------+  +---------------+ |
|  | AI SWARMS          |  | PORTFOLIO         |  | FUTURES       | |
|  | Scout/Math/Jury    |  | BACKTESTER        |  | ENGINE        | |
|  +--------------------+  +--------------------+  +---------------+ |
|                                                                    |
|  JARVIS UI (observes what Python does)                            |
|  +--------------------+  +--------------------+  +---------------+ |
|  | React Components   |  | Electron Bridge   |  | Event System  | |
|  | (Observatory)      |<-| (IPC Handlers)    |<-| (File Watch)  | |
|  +--------------------+  +--------------------+  +---------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

### Subsystem Dependencies

```
CORE (many dependents, few dependencies):
  - engine/data/loaders.py          # All modules depend on this
  - engine/features/__init__.py     # Feature generation core
  - engine/discovery/structure_dna.py  # Options structure definitions

LEAF (few dependents, many dependencies):
  - scripts/run_structure_discovery.py  # Orchestration script
  - scripts/run_ai_native.py            # AI pipeline runner
  - scripts/main_harvest.py             # Feature generation runner

BRIDGE (connects subsystems):
  - engine/ui_bridge.py             # Python -> JARVIS connection
  - src/electron/ipc-handlers/      # Electron -> React connection
  - engine/factors/__init__.py      # Physics -> Strategy connection
```

### Module Inventory

#### Python Engine: `/Users/zstoc/GitHub/quant-engine/python/engine/`

| Directory | Purpose | Status |
|-----------|---------|--------|
| `features/` | Physics Engine (16 feature modules) | [VALIDATED] |
| `discovery/` | Options structure discovery (GA) | [EXPERIMENTAL] |
| `factors/` | Factor strategy engine | [IN_DEV] |
| `futures/` | Futures trading infrastructure | [EXPERIMENTAL] |
| `ai_native/` | AI-native analysis pipeline | [VALIDATED] |
| `portfolio/` | Portfolio optimization | [EXPERIMENTAL] |
| `trading/` | Trading strategies | [DEPRECATED] - NOISE |
| `data/` | Data loading and processing | [VALIDATED] |

#### React UI: `/Users/zstoc/GitHub/quant-engine/src/`

| Directory | Purpose | Status |
|-----------|---------|--------|
| `components/` | UI components | [VALIDATED] |
| `hooks/` | React hooks (useJarvisEvents) | [VALIDATED] |
| `pages/` | Page components | [VALIDATED] |
| `contexts/` | React contexts | [VALIDATED] |
| `electron/` | Electron main process | [VALIDATED] |

---

## SECTION 3: PYTHON ENGINE MODULES

### 3.1 Physics Engine (Feature Generation)

**Location:** `/Users/zstoc/GitHub/quant-engine/python/engine/features/`

#### Layer 1: Code Reality

| Module | Exports | Purpose |
|--------|---------|---------|
| `raw_features.py` | `RawFeatureExtractor` | OHLCV-derived features |
| `morphology.py` | `calculate_morphology_features()` | Distribution shapes |
| `dynamics.py` | `add_dynamics_features()` | Rate of change |
| `entropy.py` | `add_entropy_features()` | Information theory |
| `flow.py` | `add_flow_features()` | Order flow (VPIN) |
| `correlation.py` | `add_correlation_features()` | Cross-asset |
| `regime.py` | `RegimeClassifier` | HMM regime detection |
| `gamma_calc.py` | `GammaCalculator` | Options gamma exposure |
| `cross_asset.py` | `CrossAssetFeatures` | Multi-symbol features |
| `duration.py` | `add_duration_features()` | Time-based analysis |
| `change_point.py` | `detect_change_points()` | Structural breaks |
| `options_feature_engineer.py` | `OptionsFeatureEngineer` | Options-derived |

#### Layer 2: Integration Reality

```
OptionsDataLoader (engine/data/loaders.py)
    |
    v loads raw data
SPY_master_features.parquet
    |
    v used by
FactorComputer (engine/factors/factor_computer.py)
    |
    v emits events via
emit_ui_event() -> JARVIS UI
```

#### Layer 3: Operational Reality

**Generate Features:**
```bash
cd /Users/zstoc/GitHub/quant-engine/python
python scripts/main_harvest.py --symbol SPY --start 2020-01-01 --end 2025-12-01 \
    --cross-asset-file /Volumes/VelocityData/velocity_om/features/cross_asset_features.parquet
```

**Output:** `/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet`
**Validation:** Check shape (should be ~1600 rows, 496+ columns), no NaN in critical columns

**Status:** [VALIDATED] - Tested, produces 496+ features in ~10 seconds

---

### 3.2 Structure Discovery (Options GA)

**Location:** `/Users/zstoc/GitHub/quant-engine/python/engine/discovery/`

#### Layer 1: Code Reality

| Module | Exports | Purpose |
|--------|---------|---------|
| `structure_dna.py` | `StructureDNA`, `StructureType` | 18 option structure types |
| `payoff_surface_builder.py` | `PayoffSurfaceBuilder` | Pre-compute payoffs |
| `fast_backtester.py` | `FastBacktester` | Vectorized backtesting |
| `structure_miner.py` | `StructureMiner` | Genetic algorithm |
| `synthesis_engine.py` | `SynthesisEngine` | Results synthesis |

#### Layer 2: Integration Reality

```
PayoffSurfaceBuilder
    |
    v writes to
/Volumes/VelocityData/velocity_om/payoff_surfaces/
    |
    v read by
FastBacktester
    |
    v used by
StructureMiner (GA evolution)
    |
    v writes to
/Volumes/VelocityData/velocity_om/discovered_structures/
```

#### Layer 3: Operational Reality

**Build Payoff Surface (ONE TIME, ~1 hour):**
```bash
cd /Users/zstoc/GitHub/quant-engine/python
python scripts/run_structure_discovery.py --build-surface --symbol SPY
```

**Run Discovery:**
```bash
python scripts/run_structure_discovery.py --discover --walk-forward --symbol SPY
```

**Output:** `/Volumes/VelocityData/velocity_om/discovered_structures/discovered_structures.json`

**Status:** [EXPERIMENTAL] - Ran once, results suspicious (91,000% returns, Sharpe 10.7). Needs validation.

**HAZARD:** Results were likely overfit. Before trusting, run `backtest-bias-auditor` agent.

---

### 3.3 Factor Strategy Engine

**Location:** `/Users/zstoc/GitHub/quant-engine/python/engine/factors/`

#### Layer 1: Code Reality

| Module | Exports | Purpose |
|--------|---------|---------|
| `factor_computer.py` | `FactorComputer`, `compute_factors()` | Evaluate equations |
| `strategy_mapper.py` | `StrategyMapper`, `StrategyRule` | Factor -> strategy |
| `playbook_builder.py` | `PlaybookBuilder`, `ValidatedStrategy` | Build playbook |

#### Layer 2: Integration Reality

```
Math Swarm Results (JSON)
    |
    v parsed by
FactorComputer
    |
    v produces factor values
    |
    v used by
StrategyMapper (select option structure)
    |
    v validated by
PlaybookBuilder (three-set validation)
    |
    v outputs
factor_playbook.json
```

#### Layer 3: Operational Reality

**Compute Factors:**
```bash
cd /Users/zstoc/GitHub/quant-engine/python
python scripts/demo_factor_computer.py --symbol SPY
```

**Demo Strategy Mapper:**
```bash
python scripts/demo_strategy_mapper.py
```

**Status:** [IN_DEV] - Design complete, implementation started. See `.claude/docs/FACTOR_STRATEGY_ENGINE.md`

---

### 3.4 Futures Engine

**Location:** `/Users/zstoc/GitHub/quant-engine/python/engine/futures/`

#### Layer 1: Code Reality

| Module | Exports | Purpose |
|--------|---------|---------|
| `data_loader.py` | `FuturesDataLoader` | Load Databento futures data |
| `feature_engine.py` | `FuturesFeatureEngine` | Futures-specific features |
| `backtester.py` | `FuturesBacktester` | Event-driven backtesting |
| `signal_generator.py` | `SignalGenerator` | Generate trading signals |
| `risk_manager.py` | `FuturesRiskManager` | Position sizing, risk limits |
| `execution_engine.py` | `ExecutionEngine`, `IBExecutionHandler` | Trade execution |

#### Layer 2: Integration Reality

```
Databento ES/MES/NQ/MNQ data
    |
    v loaded by
FuturesDataLoader
    |
    v processed by
FuturesFeatureEngine
    |
    v signals from
SignalGenerator
    |
    v executed via
ExecutionEngine -> IBExecutionHandler -> IBKR
```

#### Layer 3: Operational Reality

**Download Futures Data:**
```bash
cd /Users/zstoc/GitHub/quant-engine/python
python scripts/download_futures_databento.py --symbols ES,MES,NQ --start 2024-01-01
```

**Precompute Features:**
```bash
python scripts/precompute_futures_features.py --symbol ES
```

**Test Futures Engine:**
```bash
python scripts/test_futures_engine.py
```

**Status:** [EXPERIMENTAL] - Infrastructure exists, not fully validated. Requires Databento API key.

---

### 3.5 AI Swarms (Scout/Math/Jury)

**Location:** `/Users/zstoc/GitHub/quant-engine/python/engine/discovery/` (swarm scripts in `python/scripts/`)

#### Layer 1: Code Reality

| Script | Purpose | Model |
|--------|---------|-------|
| `run_scout_swarm.py` | Feature selection via mutual information | DeepSeek |
| `run_math_swarm.py` | Equation discovery via PySR | DeepSeek + PySR |
| `run_jury_swarm.py` | Regime classification | DeepSeek |

#### Layer 2: Integration Reality

```
SPY_master_features.parquet
    |
    v input to
Scout Swarm (selects top features)
    |
    v output: scout_swarm_results.json
    |
    v input to
Math Swarm (discovers equations)
    |
    v output: math_swarm_results.json
    |
    v input to
Jury Swarm (classifies regimes)
    |
    v output: jury_swarm_results.json, regime_assignments.parquet
```

#### Layer 3: Operational Reality

**Run Scout Swarm (~5 min):**
```bash
cd /Users/zstoc/GitHub/quant-engine/python
python scripts/run_scout_swarm.py \
    --input /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet
```

**Run Math Swarm (~15 min):**
```bash
python scripts/run_math_swarm.py \
    --features /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet \
    --scout-results /Volumes/VelocityData/velocity_om/features/scout_swarm_results.json
```

**Run Jury Swarm (~10 min):**
```bash
python scripts/run_jury_swarm.py \
    --features /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet \
    --scout-results /Volumes/VelocityData/velocity_om/features/scout_swarm_results.json
```

**Status:** [VALIDATED] - All three swarms run successfully.

---

### 3.6 AI-Native Pipeline

**Location:** `/Users/zstoc/GitHub/quant-engine/python/engine/ai_native/`

#### Layer 1: Code Reality

| Module | Exports | Purpose |
|--------|---------|---------|
| `pipeline.py` | `AINativePipeline` | Main orchestrator |
| `observers.py` | `ObserverSwarm` | 23 specialized observers |
| `synthesis.py` | `SynthesisEngine` | Thesis generation |
| `adversarial.py` | `AdversarialAnalyzer` | Red-team thesis |
| `expression.py` | `ExpressionGenerator` | Trade expression |
| `force_aggregator.py` | `ForceAggregator` | Aggregate forces |
| `learning.py` | `LearningModule` | Self-improvement |

#### Layer 2: Integration Reality

```
Features + Equations + Regimes
    |
    v input to
ObserverSwarm (23 observers analyze)
    |
    v observations to
SynthesisEngine (generate thesis)
    |
    v thesis to
AdversarialAnalyzer (challenge thesis)
    |
    v refined thesis to
ExpressionGenerator (trade expression)
    |
    v output
ai_native_SPY_*.json
```

#### Layer 3: Operational Reality

**Run AI-Native Analysis:**
```bash
cd /Users/zstoc/GitHub/quant-engine/python
python scripts/run_ai_native.py --symbol SPY --save-result
```

**Output:** `/Volumes/VelocityData/velocity_om/ai_native_results/ai_native_SPY_*.json`

**Status:** [VALIDATED] - Full pipeline runs successfully.

---

### 3.7 Live Trading Infrastructure

**Location:** `/Users/zstoc/GitHub/quant-engine/python/engine/trading/`

#### Layer 1: Code Reality

| Module | Exports | Purpose |
|--------|---------|---------|
| `ibkr_client.py` | `IBKRClient`, `TradingMode` | IBKR API wrapper |
| `risk_manager.py` | `RiskManager` | Position limits, kill switch |

**DEPRECATED MODULES (NOISE - ignore):**
- `mean_reversion.py`
- `gamma_scalping.py`
- `gamma_flip.py`
- `volatility_harvesting.py`
- `regime_playbook.py`

#### Layer 2: Integration Reality

```
Signal from Factor Strategy Engine
    |
    v sent to
IBKRClient
    |
    v connects to
TWS (port 7497 paper / 7496 live)
or
IB Gateway (port 4002 paper / 4001 live)
    |
    v executes trade
IBKR Account
```

#### Layer 3: Operational Reality

**Connect to IBKR (Paper):**
```python
from engine.trading.ibkr_client import IBKRClient, TradingMode

client = IBKRClient(mode=TradingMode.PAPER)
await client.connect()  # Port 7497

# Get quote
quote = await client.get_quote("MES")

# Place order
order_id = await client.place_order(
    symbol="MES",
    side="BUY",
    quantity=1,
    order_type="LIMIT",
    limit_price=5000.00
)

# Emergency flatten all
await client.kill_switch()
```

**Status:** [EXPERIMENTAL] - Code exists, requires TWS/IB Gateway running.

**HAZARD:** The kill switch is critical. Test it BEFORE live trading.

---

## SECTION 4: CLAUDE AGENTS

### Agent Inventory

This project has **9 specialized agents** in `/Users/zstoc/GitHub/quant-engine/.claude/agents/`

#### Quality Gate Agents (REQUIRED before trusting results)

| Agent | Trigger | Purpose | Model |
|-------|---------|---------|-------|
| `quant-code-review` | After writing quant code | Catch calculation errors, look-ahead bias | Opus |
| `backtest-bias-auditor` | After any backtest | Hunt temporal violations, data snooping | Opus |
| `overfitting-detector` | Sharpe > 2.5 or "too good" | Validate robustness, detect curve-fitting | Opus |
| `statistical-validator` | After performance metrics | Test significance, multiple testing corrections | Opus |
| `strategy-logic-auditor` | Before deployment | Red-team implementation, find bugs | Opus |
| `transaction-cost-validator` | Before trusting returns | Reality-check execution costs | Opus |

#### Architecture Agents

| Agent | Trigger | Purpose | Model |
|-------|---------|---------|-------|
| `quant-architect` | Design decisions, orchestration | System architecture, quality gates | Opus |
| `quant-repair` | After audit finds issues | Fix infrastructure bugs | Opus |

#### Builder Agent

| Agent | Trigger | Purpose | Model |
|-------|---------|---------|-------|
| `trade-simulator-builder` | Building execution simulator | Options trade modeling | Opus |

#### System Agent

| Agent | Trigger | Purpose | Model |
|-------|---------|---------|-------|
| `system-cartographer` | Map update needed | Create/update this document | Inherit |

### CONSTITUTIONAL: Agent Usage Rules

1. **NEVER trust backtest results without running:**
   - `backtest-bias-auditor`
   - `statistical-validator`
   - `overfitting-detector` (if Sharpe > 2.0)

2. **NEVER ship quant code without:**
   - `quant-code-review`

3. **ALWAYS use `quant-architect` for:**
   - Multi-module design decisions
   - Validation framework changes
   - Pipeline architecture

4. **After ANY audit finds issues:**
   - Use `quant-repair` to fix
   - Re-run audit agents to verify

**Skipping agents = shipping bugs. Don't do it.**

### Agent Invocation Examples

**Invoke backtest-bias-auditor:**
```
I need to validate the backtest results from the structure discovery run.
The results showed Sharpe of 10.7 which is suspicious.
```

**Invoke overfitting-detector:**
```
The strategy shows 91,000% returns over 5 years.
This seems too good to be true. Please analyze for overfitting.
```

**Invoke quant-architect:**
```
I'm about to design the Factor Strategy Engine integration with the existing
StructureDNA system. What's the proper architecture?
```

---

## SECTION 5: JARVIS EVENT SYSTEM

### How JARVIS Works

```
Claude Code (you) --- does the work
        |
        v emit events
Python emit_ui_event() -> JSON file
        |
        v
/tmp/claude-code-results/event_*.json
        |
        v
ClaudeCodeResultWatcher (fs.watch)
        |
        v IPC 'jarvis-event'
React useJarvisEvents() hook
        |
        v
Components re-render
```

### Key Files

| Component | File | Responsibility |
|-----------|------|----------------|
| **Emitter** | `/Users/zstoc/GitHub/quant-engine/python/engine/ui_bridge.py` | Writes event JSON files |
| **Watcher** | `/Users/zstoc/GitHub/quant-engine/src/electron/ipc-handlers/claudeCodeResultWatcher.ts` | Watches directory, sends IPC |
| **Hook** | `/Users/zstoc/GitHub/quant-engine/src/hooks/useJarvisEvents.ts` | React hook, processes events |
| **Context** | `/Users/zstoc/GitHub/quant-engine/src/contexts/VisualizationContext.tsx` | Manages active view |
| **Types** | `/Users/zstoc/GitHub/quant-engine/src/types/jarvis.ts` | TypeScript interfaces |

### Emitting Events from Python

#### Basic Usage

```python
from engine.ui_bridge import emit_ui_event

# Simple message
emit_ui_event(
    view="swarm",
    message="Starting analysis swarm...",
    activity_type="swarm_work"
)

# With progress bar
emit_ui_event(
    view="backtest",
    message="Running backtest...",
    activity_type="backtest",
    progress=45
)

# With notification
emit_ui_event(
    view="default",
    message="Analysis complete",
    activity_type="discovery",
    notification={
        "type": "success",
        "title": "Complete",
        "message": "Found 3 high-probability setups"
    }
)
```

#### Convenience Functions (Preferred)

```python
from engine.ui_bridge import (
    ui_swarm_started,
    ui_swarm_progress,
    ui_swarm_complete,
    ui_backtest_started,
    ui_backtest_progress,
    ui_backtest_complete,
    ui_gamma_analysis,
    ui_regime_detected,
    ui_discovery,
    ui_error,
    ui_table,
    ui_pnl_chart,
    ui_heatmap,
    ui_candlestick,
    ui_gauge,
    ui_multi_gauge,
    ui_waterfall,
    ui_treemap,
    ui_payoff,
)

# Swarm workflow
ui_swarm_started(agent_count=100, objective="Find gamma anomalies")
for i in range(100):
    ui_swarm_progress(completed=i, total=100, current_task=f"Analyzing {symbol}")
ui_swarm_complete("Found 12 anomalies across 5 symbols")

# Backtest workflow
ui_backtest_started("SPY", "gamma_scalp", "2024-01-01", "2024-12-31")
# ... run backtest ...
ui_backtest_complete(sharpe=1.85, total_return=0.234, max_dd=-0.12)
```

#### Visualization Functions

```python
# Data table
ui_table(
    title="Top Opportunities",
    columns=[
        {"key": "symbol", "label": "Symbol", "type": "string"},
        {"key": "sharpe", "label": "Sharpe", "type": "number"},
    ],
    rows=[
        {"symbol": "TSLA", "sharpe": 2.3},
        {"symbol": "NVDA", "sharpe": 1.8}
    ],
    message="Scan complete"
)

# Equity curve
ui_pnl_chart(
    dates=["2024-01", "2024-02", "2024-03"],
    equity_curve=[100, 102, 105],
    symbol="My Strategy"
)

# Heatmap
ui_heatmap(
    title="Correlation Matrix",
    x_labels=["SPY", "QQQ"],
    y_labels=["SPY", "QQQ"],
    values=[[1.0, 0.92], [0.92, 1.0]]
)
```

### View Types

| View | Use When | Activity Type |
|------|----------|---------------|
| `swarm` | Running AI swarms, parallel agents | `swarm_work` |
| `backtest` | Running backtests, showing P&L | `backtest` |
| `insight` | Displaying analysis, charts, findings | `gamma_analysis`, `regime_detection` |
| `mission` | Task queue, orchestration | `swarm_work` |
| `graduation` | Pipeline progress | `discovery` |
| `integrity` | System health, errors | `idle` |
| `default` | General findings, tables | `discovery`, `code_writing`, `data_loading` |

### Troubleshooting JARVIS

**Symptom:** Python script runs, no UI updates

**Debug Steps:**
```bash
# 1. Check event files are being written
ls -la /tmp/claude-code-results/

# 2. Check file contents
cat /tmp/claude-code-results/event_*.json | jq

# 3. Check Electron console for watcher logs
# Look for: [ClaudeCodeWatcher] Processing result file...

# 4. Check React console for hook logs
# Look for: [JARVIS] Received event...
```

**Common Fixes:**
- Restart Electron app (file watcher may be stale)
- Check `/tmp/claude-code-results/` permissions
- Verify `RESULTS_DIR` matches in ui_bridge.py and watcher

---

## SECTION 6: ELECTRON IPC API

### Complete API Surface

**Defined in:** `/Users/zstoc/GitHub/quant-engine/src/electron/preload.ts`
**Types in:** `/Users/zstoc/GitHub/quant-engine/src/types/electron.d.ts`

#### File Operations
```typescript
window.electron.readFile(filePath: string)
window.electron.writeFile(filePath: string, content: string)
window.electron.deleteFile(filePath: string)
window.electron.listDir(dirPath: string)
window.electron.searchCode(query: string, dirPath?: string)
```

#### Python Execution
```typescript
window.electron.runBacktest(params: BacktestParams)
```

#### LLM Operations
```typescript
window.electron.chatPrimary(messages: Message[])
window.electron.chatSwarm(messages: Message[])
window.electron.chatSwarmParallel(prompts: AgentPrompt[])
window.electron.helperChat(messages: Message[])
window.electron.cancelRequest()
```

#### Memory System
```typescript
window.electron.memoryRecall(query: string, workspaceId: string, options?)
window.electron.memoryFormatForPrompt(memories: any[])
window.electron.memoryWarmCache(workspaceId: string)
window.electron.memoryDaemonStatus()
window.electron.checkMemoryTriggers(message: string, workspaceId: string)
window.electron.getStaleMemories(workspaceId: string)
window.electron.markMemoriesRecalled(memoryIds: string[])
```

#### Event Listeners
```typescript
window.electron.onJarvisEvent(callback: (event: JarvisEvent) => void)
window.electron.onToolProgress(callback: (data: ToolProgress) => void)
window.electron.onLLMStream(callback: (data: LLMStream) => void)
window.electron.onToolExecutionEvent(callback: (event: ToolExecution) => void)
window.electron.onDaemonLog(callback: (log: string) => void)
window.electron.onDaemonStatus(callback: (status: DaemonStatus) => void)
window.electron.onKillSwitchActivated(callback: (data: { reason: string }) => void)
```

#### Trading Operations (IBKR)
```typescript
window.electron.trading.connect(mode: 'paper' | 'live')
window.electron.trading.disconnect()
window.electron.trading.status()
window.electron.trading.positions()
window.electron.trading.quote(symbol: string)
window.electron.trading.order(params: OrderParams)
window.electron.trading.cancel(orderId: string)
window.electron.trading.cancelAll(symbol?: string)
window.electron.trading.halt(reason: string)
window.electron.trading.resume()
window.electron.trading.stats()
window.electron.trading.dailyPnl()
window.electron.trading.killSwitch(reason: string)  // EMERGENCY
```

---

## SECTION 7: RUNBOOKS

### Runbook 1: System Startup

**Purpose:** Get the full system running

**Prerequisites:**
- Data volume mounted at `/Volumes/VelocityData/`
- `.env` file configured with API keys
- Node.js and Python installed

**Steps:**

```bash
# Terminal 1: Start Electron + React
cd /Users/zstoc/GitHub/quant-engine
npm run electron:dev

# Terminal 2: Verify Python Flask API
curl http://localhost:5001/health
# If not running:
cd /Users/zstoc/GitHub/quant-engine/python
python server.py

# Terminal 3: Verify data mount
ls /Volumes/VelocityData/velocity_om/
# Should see: features/, payoff_surfaces/, discovered_structures/, etc.

# Test JARVIS integration
cd /Users/zstoc/GitHub/quant-engine/python
python scripts/demo_jarvis.py
# Watch UI cycle through 14 visualization types
```

**Success Criteria:**
- React UI loads in Electron window
- Flask API responds to `/health`
- Demo script shows visualizations in UI

---

### Runbook 2: Generate Features

**Purpose:** Generate market physics features for analysis

**Prerequisites:**
- Data volume mounted
- Pre-computed cross-asset features exist

**Steps:**

```bash
cd /Users/zstoc/GitHub/quant-engine/python

# Step 1: Pre-compute cross-asset (ONE TIME, ~5 min)
python scripts/precompute_cross_asset.py --start 2020-01-01 --end 2025-12-01

# Step 2: Generate master features (~10 sec)
python scripts/main_harvest.py --symbol SPY --start 2020-01-01 --end 2025-12-01 \
    --cross-asset-file /Volumes/VelocityData/velocity_om/features/cross_asset_features.parquet
```

**Output:** `/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet`

**Validation:**
```python
import pandas as pd
df = pd.read_parquet('/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet')
print(f"Shape: {df.shape}")  # Should be ~1600 rows, 496+ columns
print(f"Date range: {df['date'].min()} to {df['date'].max()}")
print(f"NaN count: {df.isna().sum().sum()}")
```

---

### Runbook 3: Run AI Swarms (Scout/Math/Jury)

**Purpose:** Feature selection, equation discovery, regime classification

**Prerequisites:**
- Master features generated (Runbook 2)
- DEEPSEEK_API_KEY environment variable set

**Steps:**

```bash
cd /Users/zstoc/GitHub/quant-engine/python

# Step 1: Scout Swarm - feature selection (~5 min)
python scripts/run_scout_swarm.py \
    --input /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet

# Step 2: Math Swarm - equation discovery (~15 min)
python scripts/run_math_swarm.py \
    --features /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet \
    --scout-results /Volumes/VelocityData/velocity_om/features/scout_swarm_results.json

# Step 3: Jury Swarm - regime classification (~10 min)
python scripts/run_jury_swarm.py \
    --features /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet \
    --scout-results /Volumes/VelocityData/velocity_om/features/scout_swarm_results.json
```

**Outputs:**
- `/Volumes/VelocityData/velocity_om/features/scout_swarm_results.json`
- `/Volumes/VelocityData/velocity_om/features/math_swarm_results.json`
- `/Volumes/VelocityData/velocity_om/features/jury_swarm_results.json`
- `/Volumes/VelocityData/velocity_om/features/regime_assignments.parquet`

**Checkpoints:**
- After Scout: Verify top features make sense (should be VIX, gamma, flow related)
- After Math: Check equation isn't trivial (e.g., just a constant)
- After Jury: Confirm regime distribution is reasonable (not 99% one regime)

---

### Runbook 4: Run Structure Discovery

**Purpose:** Discover optimal options structures via genetic algorithm

**Prerequisites:**
- Features generated
- CRITICAL: Run this with skepticism - results need validation

**Steps:**

```bash
cd /Users/zstoc/GitHub/quant-engine/python

# Step 1: Build payoff surface (ONE TIME, ~1 hour)
python scripts/run_structure_discovery.py --build-surface --symbol SPY

# Step 2: Quick baseline check
python scripts/run_structure_discovery.py --baseline --symbol SPY

# Step 3: Full discovery with walk-forward
python scripts/run_structure_discovery.py --discover --walk-forward --symbol SPY
```

**Output:** `/Volumes/VelocityData/velocity_om/discovered_structures/discovered_structures.json`

**CRITICAL VALIDATION:**
After running, ALWAYS invoke these agents:
1. `backtest-bias-auditor` - Check for look-ahead bias
2. `statistical-validator` - Test significance
3. `overfitting-detector` (if Sharpe > 2.0) - Check robustness

---

### Runbook 5: JARVIS Demo

**Purpose:** Demonstrate all JARVIS visualization types

**Steps:**

```bash
# Terminal 1: Start Electron
cd /Users/zstoc/GitHub/quant-engine
npm run electron:dev

# Terminal 2: Run demo
cd /Users/zstoc/GitHub/quant-engine/python
python scripts/demo_jarvis.py
```

**What you'll see:**
1. Startup notification
2. Progress bar animation
3. Correlation heatmap
4. Candlestick chart
5. Market gauge dashboard
6. GEX gauge
7. P&L waterfall chart
8. Portfolio treemap
9. Options payoff diagram
10. Force vector bar chart
11. Regime detection notification
12. Scan results table
13. Backtest metrics
14. Equity curve

---

### Runbook 6: Code Audit with DeepSeek

**Purpose:** Audit physics engine code for bugs

**Steps:**

```bash
cd /Users/zstoc/GitHub/quant-engine

# Audit a single file
python scripts/deepseek_agent.py \
    "Audit python/engine/features/morphology.py for:
    - Division by zero (missing checks)
    - Empty array operations (np.mean, np.std on empty)
    - NaN propagation (missing np.isfinite)
    - Log domain errors (log of zero/negative)
    - Bounds violations (probabilities outside [0,1])" \
    auditor_fixer

# Check repair report
ls -la scripts/reports/
cat scripts/reports/repair_*.json | jq .
```

**Key files to audit:**
- `python/engine/features/morphology.py`
- `python/engine/features/dynamics.py`
- `python/engine/features/flow.py`
- `python/engine/features/entropy.py`
- `python/engine/features/correlation.py`

---

## SECTION 8: STATUS BOARD

### Current Status (2025-12-07)

| Subsystem | Status | Last Validated | Notes |
|-----------|--------|----------------|-------|
| **Physics Engine** | [VALIDATED] | 2025-12-05 | 496+ features, runs in ~10s |
| **Scout Swarm** | [VALIDATED] | 2025-12-05 | Feature selection working |
| **Math Swarm** | [VALIDATED] | 2025-12-05 | PySR equation discovery working |
| **Jury Swarm** | [VALIDATED] | 2025-12-05 | Regime classification working |
| **AI-Native Pipeline** | [VALIDATED] | 2025-12-05 | Full pipeline runs |
| **Structure Discovery** | [EXPERIMENTAL] | 2025-12-05 | Results suspicious, needs validation |
| **Factor Strategy Engine** | [IN_DEV] | 2025-12-06 | Design complete, implementation pending |
| **Futures Engine** | [EXPERIMENTAL] | 2025-12-06 | Infrastructure exists, not validated |
| **IBKR Client** | [EXPERIMENTAL] | 2025-12-06 | Code exists, needs TWS |
| **JARVIS UI** | [VALIDATED] | 2025-12-07 | Full pipeline wired and working |
| **Electron IPC** | [VALIDATED] | 2025-12-07 | All handlers registered |
| **Flask API** | [VALIDATED] | 2025-12-07 | Responds to health check |
| **Portfolio Backtester** | [EXPERIMENTAL] | - | Exists but untested |
| **Sigma Agent** | [EXPERIMENTAL] | - | Exists but not validated |

### Deprecated Components (NOISE - ignore)

| Component | Location | Why Deprecated |
|-----------|----------|----------------|
| `mean_reversion.py` | `python/engine/trading/` | Focus is physics engine, not strategies |
| `gamma_scalping.py` | `python/engine/trading/` | Focus is physics engine, not strategies |
| `gamma_flip.py` | `python/engine/trading/` | Focus is physics engine, not strategies |
| `volatility_harvesting.py` | `python/engine/trading/` | Focus is physics engine, not strategies |
| `regime_playbook.py` | `python/engine/trading/` | Focus is physics engine, not strategies |

---

## SECTION 9: HAZARD REGISTER

### Known Issues

| Hazard | Impact | Mitigation |
|--------|--------|------------|
| Structure Discovery results suspicious | High | Always run audit agents before trusting |
| Regime-based approach flawed | High | Use factor-based approach instead |
| Live trading kill switch untested | Critical | Test in paper before live |
| IBKR connection not validated | High | Test connection before trading |

### Gotchas

| Gotcha | Context | Fix |
|--------|---------|-----|
| Data mount required | All Python scripts need `/Volumes/VelocityData/` | Mount external drive |
| DEEPSEEK_API_KEY required | AI swarms need API key | Set in `.env` |
| PySR first run slow | Julia compilation on first use | Wait (one-time) |
| JARVIS events not appearing | File watcher may be stale | Restart Electron |
| Backtest looks too good | Likely overfitting | Run audit agents |

### Failure Modes

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Feature generation fails | Error in console, empty parquet | Check data mount, API keys |
| Swarm times out | No output after 30+ minutes | Check API key, network |
| UI doesn't update | No JARVIS events | Restart Electron, check /tmp/ |
| IBKR connection fails | Error in console | Check TWS running, port |

---

## SECTION 10: DATA LOCATIONS

### Raw Data

| Data | Location | Size |
|------|----------|------|
| Options chain data | `/Volumes/VelocityData/velocity_om/massive/options/` | 394M rows |
| Stock minute data | `/Volumes/VelocityData/velocity_om/massive/stocks/` | Multi-year |
| VIX data | `/Volumes/VelocityData/velocity_om/massive/stocks/VXX/` | - |

### Generated Features

| Data | Location |
|------|----------|
| Cross-asset features | `/Volumes/VelocityData/velocity_om/features/cross_asset_features.parquet` |
| Master features | `/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet` |
| MTF physics | `/Volumes/VelocityData/velocity_om/features/SPY_mtf_physics.parquet` |
| Options features | `/Volumes/VelocityData/velocity_om/massive/features/SPY_options_features.parquet` |

### Discovery Outputs

| Data | Location |
|------|----------|
| Scout results | `/Volumes/VelocityData/velocity_om/features/scout_swarm_results.json` |
| Math results | `/Volumes/VelocityData/velocity_om/features/math_swarm_results.json` |
| Jury results | `/Volumes/VelocityData/velocity_om/features/jury_swarm_results.json` |
| Regime assignments | `/Volumes/VelocityData/velocity_om/features/regime_assignments.parquet` |
| Payoff surfaces | `/Volumes/VelocityData/velocity_om/payoff_surfaces/` |
| Discovered structures | `/Volumes/VelocityData/velocity_om/discovered_structures/` |

### Runtime Files

| Data | Location |
|------|----------|
| JARVIS event files | `/tmp/claude-code-results/` |
| Electron logs | `~/Library/Logs/quant-chat-workbench/` |
| Session state | `/Users/zstoc/GitHub/quant-engine/HANDOFF.md` |

---

## SECTION 11: ENVIRONMENT SETUP

### Required Environment Variables

Create `/Users/zstoc/GitHub/quant-engine/.env`:

```bash
# API Keys
DEEPSEEK_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
POLYGON_API_KEY=your_key_here

# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key_here

# Data Infrastructure
DATA_DRIVE_PATH=/Volumes/VelocityData
```

### Port Assignments

| Service | Port | Protocol |
|---------|------|----------|
| React Dev Server | 8080 | HTTP |
| Python Flask API | 5001 | HTTP |
| ThetaData Terminal HTTP | 25510 | HTTP |
| ThetaData Terminal WebSocket | 25520 | WS |
| IBKR TWS Paper | 7497 | TCP |
| IBKR TWS Live | 7496 | TCP |
| IBKR Gateway Paper | 4002 | TCP |
| IBKR Gateway Live | 4001 | TCP |

### Python Dependencies

```bash
cd /Users/zstoc/GitHub/quant-engine/python
pip install -r requirements.txt
```

Key packages:
- pandas, numpy, scipy
- pysr (symbolic regression)
- ib_insync (IBKR API)
- flask (API server)
- python-dotenv

---

## SECTION 12: RECENT CHANGES (Last 7 Days)

### 2025-12-07
- System Cartographer operational map created

### 2025-12-06
- Factor Strategy Engine design complete
- Key decision: **Regimes don't work** - pivoted to factor-based approach
- Three-set validation: Discovery/Validation/Walk-Forward with interleaved months
- Factor modules: `factor_computer.py`, `strategy_mapper.py`, `playbook_builder.py`

### 2025-12-05
- JARVIS UI integration complete
- Physics Engine hardened (all 16 feature modules audited)
- 62 bugs fixed in comprehensive audit

### 2025-12-04
- Structure Discovery baseline run
- Suspicious results (91,000% returns, Sharpe 10.7)
- Identified need for robust validation

---

## QUICK REFERENCE

### Integration Cheat Sheet

**Emit UI Event from Python:**
```python
from engine.ui_bridge import emit_ui_event
emit_ui_event(view="swarm", message="Working...", progress=50)
```

**Subscribe to Events in React:**
```typescript
const { lastEvent, progress, currentActivity } = useJarvisEvents();
```

**Check System Health:**
```bash
# Python server
curl http://localhost:5001/health

# Event files
ls /tmp/claude-code-results/

# Electron console - look for [ClaudeCodeWatcher] and [JARVIS] logs
```

### Critical Files

| Purpose | File |
|---------|------|
| Session state | `HANDOFF.md` |
| This map | `operator/CLAUDE.md` |
| System inventory | `operator/SYSTEM_INVENTORY.md` |
| Runbooks | `operator/RUNBOOKS.md` |
| Factor Strategy Design | `.claude/docs/FACTOR_STRATEGY_ENGINE.md` |
| JARVIS bridge | `python/engine/ui_bridge.py` |
| Event watcher | `src/electron/ipc-handlers/claudeCodeResultWatcher.ts` |
| Event hook | `src/hooks/useJarvisEvents.ts` |
| IPC types | `src/types/electron.d.ts` |
| JARVIS types | `src/types/jarvis.ts` |

---

## END OF OPERATIONAL MAP

**Map Version:** 2.0
**Last Updated:** 2025-12-07
**Cartographer:** system-cartographer agent

**To update this map:** Invoke the `system-cartographer` agent or manually edit `/Users/zstoc/GitHub/quant-engine/operator/CLAUDE.md`
