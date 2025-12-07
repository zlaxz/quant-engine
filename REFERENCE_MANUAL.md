# Quant Engine - Desktop Reference Manual

**Version 1.0 | December 2025**
**Print this for quick reference**

---

## QUICK START (30 seconds)

```bash
# Terminal 1: Start UI
cd /Users/zstoc/GitHub/quant-engine && npm run electron:dev

# Terminal 2: Run analysis (events show in UI)
cd /Users/zstoc/GitHub/quant-engine/python
python scripts/demo_jarvis.py
```

---

## SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────┐
│                    QUANT ENGINE SYSTEM                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   PHYSICS    │    │   FACTOR     │    │   JARVIS     │      │
│  │   ENGINE     │───▶│   STRATEGY   │───▶│   UI         │      │
│  │              │    │   ENGINE     │    │              │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   ▲               │
│         ▼                   ▼                   │               │
│  ┌──────────────────────────────────────────────┘               │
│  │  emit_ui_event() → /tmp/claude-code-results/ → Electron     │
│  └──────────────────────────────────────────────────────────────┤
│                                                                 │
│  DATA: /Volumes/VelocityData/velocity_om/                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## PIPELINE OVERVIEW

### Full Discovery Pipeline (Run in Order)

| Step | Script | Time | Output |
|------|--------|------|--------|
| 1. Features | `main_harvest.py` | 30-60 min | `SPY_master_features.parquet` |
| 2. Scout | `run_scout_swarm.py` | 5 min | `scout_swarm_results.json` |
| 3. Math | `run_math_swarm.py` | 2-4 hrs | `math_swarm_results.json` |
| 4. Jury | `run_jury_swarm.py` | 5 min | `regime_assignments.parquet` |
| 5. AI-Native | `run_ai_native.py` | 10 min | Analysis results |

### Factor Strategy Pipeline

| Step | Module | Purpose |
|------|--------|---------|
| 1 | FactorComputer | Evaluate equations → factors |
| 2 | SignalGenerator | Threshold crossing → signals |
| 3 | StrategyMapper | Signals → option structures |
| 4 | FactorBacktester | Three-set validation |
| 5 | PlaybookBuilder | Generate trading playbook |

---

## COMMAND REFERENCE

### Physics Engine Commands

```bash
cd /Users/zstoc/GitHub/quant-engine/python

# Generate features (MUST RUN FIRST)
python scripts/main_harvest.py --symbol SPY --start 2020-01-01 --end 2025-12-01

# Scout Swarm - feature selection
python scripts/run_scout_swarm.py \
    --input /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet

# Math Swarm - equation discovery
python scripts/run_math_swarm.py \
    --features /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet \
    --scout-results /Volumes/VelocityData/velocity_om/scout_swarm_results.json

# Jury Swarm - regime classification
python scripts/run_jury_swarm.py \
    --features /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet \
    --scout-results /Volumes/VelocityData/velocity_om/scout_swarm_results.json

# AI-Native Analysis
python scripts/run_ai_native.py --symbol SPY \
    --equations /Volumes/VelocityData/velocity_om/math_swarm_results.json \
    --save-result
```

### DeepSeek Agent Commands

```bash
cd /Users/zstoc/GitHub/quant-engine

# Analyst (analysis)
python scripts/deepseek_agent.py "Analyze gamma patterns" analyst

# Reviewer (code review)
python scripts/deepseek_agent.py "Review flow.py for bugs" reviewer

# Fixer (fix bugs)
python scripts/deepseek_agent.py "FIX division by zero at line 142" fixer

# Auditor+Fixer (audit then fix)
python scripts/deepseek_agent.py "Audit and fix dynamics.py" auditor_fixer

# With reasoner model
python scripts/deepseek_agent.py "Deep analysis" analyst --model deepseek-reasoner
```

### Development Commands

```bash
cd /Users/zstoc/GitHub/quant-engine

# Start development (React + Electron)
npm run electron:dev

# Build React only
npm run build && npm run preview

# Build Electron app
npm run electron:build

# Lint
npm run lint
```

---

## DATA LOCATIONS

### Primary Data Vault
```
/Volumes/VelocityData/velocity_om/
├── features/
│   ├── SPY_master_features.parquet      ← MAIN FEATURES
│   ├── scout_swarm_results.json         ← Scout output
│   ├── math_swarm_results.json          ← Math output
│   └── regime_assignments.parquet       ← Jury output
├── massive/
│   ├── options/                         ← Raw options chains
│   └── features/
│       └── SPY_options_features.parquet
├── payoff_surfaces/                     ← Pre-computed payoffs
├── discovered_structures/               ← Structure DNA
└── ai_native_results/                   ← AI analysis
```

---

## JARVIS UI EVENTS

### Python → UI Event Flow

```
Python emit_ui_event()
    ↓
/tmp/claude-code-results/*.json
    ↓
ClaudeCodeResultWatcher (Electron)
    ↓
IPC 'jarvis-event'
    ↓
useJarvisEvents() hook
    ↓
React UI renders
```

### Emit Events from Python

```python
from engine.ui_bridge import (
    emit_ui_event,
    ui_gamma_analysis,
    ui_regime_detected,
    ui_backtest_complete,
    ui_table,
    ui_heatmap,
    ui_payoff
)

# Simple notification
emit_ui_event(
    activity_type="discovery",
    message="Analysis starting...",
    notification={"type": "info", "title": "Started", "message": "Running"}
)

# Progress bar
emit_ui_event(
    activity_type="data_loading",
    message="Loading... 50%",
    progress=50
)

# Gamma analysis with chart
ui_gamma_analysis("SPY", {
    "dealer_gamma": 0.72,
    "customer_gamma": -0.45
})

# Backtest results
ui_backtest_complete(sharpe=1.85, total_return=0.234, max_dd=-0.12)

# Data table
ui_table(
    title="Top Opportunities",
    columns=[
        {"key": "symbol", "label": "Symbol", "type": "text"},
        {"key": "edge", "label": "Edge", "type": "number"}
    ],
    rows=[
        {"symbol": "TSLA", "edge": 2.3},
        {"symbol": "NVDA", "edge": 1.8}
    ]
)

# Heatmap
ui_heatmap(
    title="Correlation Matrix",
    x_labels=["SPY", "QQQ"],
    y_labels=["SPY", "QQQ"],
    values=[[1.0, 0.92], [0.92, 1.0]]
)

# Options payoff
ui_payoff(
    title="Iron Condor",
    strategies=[
        {"type": "put", "strike": 580, "premium": 2.50, "quantity": 1, "position": "short"},
        {"type": "put", "strike": 575, "premium": 1.20, "quantity": 1, "position": "long"}
    ],
    current_price=595
)
```

---

## PHYSICS ENGINE MODULES

### Feature Modules (`python/engine/features/`)

| Module | Purpose | Key Outputs |
|--------|---------|-------------|
| `morphology.py` | Distribution shapes | P/b/B-shape, skew, kurtosis |
| `dynamics.py` | Motion patterns | Velocity, acceleration, Hurst |
| `flow.py` | Order flow | VPIN, Kyle's Lambda, OFI |
| `entropy.py` | Information theory | Shannon, Permutation entropy |
| `correlation.py` | Cross-asset | Correlation matrices |
| `gamma_calc.py` | Gamma/GEX | Dealer gamma, customer gamma |
| `regime.py` | Regime classification | Market regime labels |

### Discovery Modules (`python/engine/discovery/`)

| Module | Purpose |
|--------|---------|
| `swarm_engine.py` | Scout/Jury swarm orchestration |
| `structure_dna.py` | Option structure encoding |
| `structure_miner.py` | Genetic algorithm for structures |
| `fast_backtester.py` | Vectorized backtesting |
| `synthesis_engine.py` | Cross-agent synthesis |

---

## FACTOR STRATEGY ENGINE

### Three-Set Validation

```
Discovery:    Odd months 2020-2024  (~675 days) - Find thresholds
Validation:   Even months 2020-2024 (~600 days) - Confirm signal
Walk-Forward: All of 2025           (245 days)  - Final test

5-day embargo between sets prevents leakage
```

### Factor Strategy Workflow

```python
from engine.factors import (
    FactorComputer,
    SignalGenerator,
    StrategyMapper,
    FactorBacktester,
    PlaybookBuilder
)

# 1. Compute factors from equations
computer = FactorComputer(equations_path, features_path)
factors = computer.compute_all_factors()

# 2. Generate signals
sg = SignalGenerator(factors)
signals = sg.generate_signals(
    factor_name="momentum",
    entry_threshold=1.5,
    exit_threshold=0.5,
    direction="above"
)

# 3. Map to strategies
mapper = StrategyMapper()
positions = mapper.evaluate_rules(factors)

# 4. Backtest with three-set validation
backtester = FactorBacktester(computer, sg, mapper, features_path)
result = backtester.three_set_validate("momentum")

# 5. Build playbook
builder = PlaybookBuilder(validation_results)
playbook = builder.build_playbook()
```

---

## SWARM SYSTEMS

### Swarm Types

| Swarm | Purpose | Agents | Model |
|-------|---------|--------|-------|
| Scout | Feature selection | 100 | Local (sklearn) |
| Math | Equation discovery | PySR GA | Local (Julia) |
| Jury | Regime classification | 3 models | Local (sklearn) |
| Observer | Domain analysis | 20+ | DeepSeek |
| Mega Discovery | Parallel analysis | 100-300 | DeepSeek Reasoner |

### DeepSeek Agent Types

| Type | Tools | Best For |
|------|-------|----------|
| `analyst` | read, search, query | Data analysis |
| `reviewer` | read, search | Code review |
| `fixer` | read, edit | Bug fixes |
| `auditor_fixer` | read, search, edit | Audit + fix |
| `coder` | read, write, edit | Implementation |

---

## TROUBLESHOOTING

| Issue | Solution |
|-------|----------|
| No data found | Check `/Volumes/VelocityData/` is mounted |
| PySR hangs | First run installs Julia (wait 5-10 min) |
| JARVIS not showing | Check Electron running + /tmp/claude-code-results/ |
| DeepSeek timeout | Increase timeout or use deepseek-chat |

---

## COST REFERENCE

| Model | Cost/M tokens | Use For |
|-------|---------------|---------|
| Sonnet | $15 | Main conversation |
| Haiku | $5 | Quick tasks |
| DeepSeek Chat | $0.14 | Fast agents |
| DeepSeek Reasoner | $2.19 | Deep analysis |

**Default for agents:** DeepSeek (89% savings vs Sonnet)

---

## KEY PRINCIPLES

### No-Lookahead Bias
```python
# CORRECT - expanding window (no lookahead)
factor = df['signal'].expanding(min_periods=20).std()

# WRONG - fixed window (uses future data)
factor = df['signal'].rolling(window=50).std()
```

### Position Sizing (Notional-Based)
```python
# CORRECT - % of portfolio
position_pct = 0.05  # 5% of portfolio
notional = portfolio_value * position_pct

# WRONG - contract count
quantity = 10  # Not scaled to portfolio
```

### Event-Driven UI
```python
# Always emit events so JARVIS shows your work
emit_ui_event(
    activity_type="discovery",
    message="Starting analysis..."
)
```

---

## FILE LOCATIONS QUICK REFERENCE

| What | Where |
|------|-------|
| Features | `python/engine/features/` |
| Discovery | `python/engine/discovery/` |
| Factors | `python/engine/factors/` |
| Scripts | `python/scripts/` |
| UI Bridge | `python/engine/ui_bridge.py` |
| React Pages | `src/pages/` |
| Components | `src/components/` |
| IPC Handlers | `src/electron/ipc-handlers/` |
| JARVIS Hook | `src/hooks/useJarvisEvents.ts` |
| Contexts | `src/contexts/` |

---

## ELECTRON APP STRUCTURE

### Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Index | Main chat + visualizations |
| `/dashboard` | Dashboard | Strategy/regime dashboard |
| `/settings` | Settings | Configuration |
| `/popout/:id` | PopoutVisualization | Full-screen viz |

### Right Panel Views

| View | Component | Trigger |
|------|-----------|---------|
| `default` | FindingsPanel | Research findings |
| `mission` | MissionMonitor | Active operations |
| `swarm` | SwarmHiveMonitor | Agent status |
| `backtest` | BacktestRunner | Test execution |
| `insight` | CIOInsightPanel | Tool visibility |

---

**Last Updated:** December 2025
**Focus:** Physics Engine + Factor Strategy + JARVIS Observatory
