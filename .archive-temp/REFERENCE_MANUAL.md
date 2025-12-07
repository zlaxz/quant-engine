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

## FUTURES TRADING PIPELINE

### Overview

Production-grade futures trading system built for live trading via Interactive Brokers. Trades 15 contracts across equity indices, micros, energy, metals, treasuries, and currencies.

```
┌─────────────────────────────────────────────────────────────┐
│                FUTURES ENGINE ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  FuturesDataLoader ──▶ FuturesFeatureEngine                 │
│         │                     │                              │
│         ▼                     ▼                              │
│  Raw OHLCV Data      150 Features (pre-computed)            │
│         │                     │                              │
│         └────────┬────────────┘                              │
│                  ▼                                           │
│          SignalGenerator                                     │
│                  │                                           │
│                  ▼                                           │
│       FuturesRiskManager ────▶ Position Sizing              │
│                  │                                           │
│                  ▼                                           │
│       ┌──────────────────────┐                              │
│       │   FuturesBacktester  │ ◀── Strategy Functions       │
│       └──────────────────────┘                              │
│                  │                                           │
│                  ▼                                           │
│       ┌──────────────────────┐                              │
│       │   ExecutionEngine    │                              │
│       │   ├── Backtest Mode  │                              │
│       │   └── IB Live Mode   │ ──▶ Interactive Brokers      │
│       └──────────────────────┘                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Quick Start

```bash
# Verify futures engine works
cd /Users/zstoc/GitHub/quant-engine/python
python3.11 scripts/test_futures_engine.py

# Expected output:
# 1. Data Loader: ~5,894 bars
# 2. Feature Engine: 150 features
# 3. Signal Generator: ~5,600 signals
# 4. Risk Manager: Position sizing check
# 5. Backtester: ~172 trades
# 6. Execution Engine: Order fills
# ALL TESTS PASSED ✓
```

### Futures Pipeline Commands

```bash
cd /Users/zstoc/GitHub/quant-engine/python

# Step 1: Download data (ONLY IF NEEDED - already done)
python scripts/download_futures_databento.py --symbols ES,MES,NQ --start 2015-01-01

# Step 2: Pre-compute features (ONLY IF NEEDED - already done, 24GB)
python scripts/precompute_futures_features.py --symbol ES

# Step 3: Run test suite (DO THIS FIRST)
python3.11 scripts/test_futures_engine.py

# Step 4: Run custom backtest (example)
python3.11 -c "
from engine.futures import FuturesDataLoader, FuturesBacktester
from engine.futures.backtester import BacktestConfig, Order, OrderSide, OrderType

loader = FuturesDataLoader('/Volumes/VelocityData/velocity_om/futures')
df = loader.load_symbol('ES', '1h', '2023-01-01', '2023-12-31')

config = BacktestConfig(initial_capital=100000)
bt = FuturesBacktester(config=config)

def my_strategy(data, backtester):
    # Your strategy logic here
    pass

results = bt.run(df, my_strategy, 'ES')
print(results)
"
```

### Futures Data Locations

```
/Volumes/VelocityData/velocity_om/futures/
├── ES_1m.parquet     ← 3.5M rows (2015-2024)
├── ES_1h.parquet     ← ~90K rows
├── ES_1d.parquet     ← ~2,500 rows
├── NQ_*.parquet      ← Same structure
├── RTY_*.parquet
├── YM_*.parquet
├── MES_*.parquet     ← Micros
├── MNQ_*.parquet
├── CL_*.parquet      ← Energy
├── NG_*.parquet
├── GC_*.parquet      ← Metals
├── SI_*.parquet
├── ZB_*.parquet      ← Treasuries
├── ZN_*.parquet
├── ZF_*.parquet
├── 6E_*.parquet      ← Currencies
└── 6J_*.parquet

/Volumes/VelocityData/velocity_om/futures_features/
├── ES_1m_features.parquet  ← 150 features per file
├── ES_1h_features.parquet  ← Total: 24GB pre-computed
└── ... (45 files total)
```

### Futures Engine Modules

| Module | Location | Purpose |
|--------|----------|---------|
| `FuturesDataLoader` | `python/engine/futures/data_loader.py` | Load multi-timeframe parquet data |
| `FuturesFeatureEngine` | `python/engine/futures/feature_engine.py` | Generate 150 features |
| `SignalGenerator` | `python/engine/futures/signal_generator.py` | Composite trading signals |
| `FuturesRiskManager` | `python/engine/futures/risk_manager.py` | Position sizing, risk limits |
| `FuturesBacktester` | `python/engine/futures/backtester.py` | Event-driven backtesting |
| `ExecutionEngine` | `python/engine/futures/execution_engine.py` | Order execution (backtest/IB) |

### Contract Specifications

```python
CONTRACT_SPECS = {
    # Equity Index
    'ES':  {'tick_size': 0.25, 'tick_value': 12.50, 'multiplier': 50},   # S&P 500
    'NQ':  {'tick_size': 0.25, 'tick_value': 5.00,  'multiplier': 20},   # Nasdaq
    'RTY': {'tick_size': 0.10, 'tick_value': 5.00,  'multiplier': 50},   # Russell
    'YM':  {'tick_size': 1.00, 'tick_value': 5.00,  'multiplier': 5},    # Dow

    # Micros (1/10 size - good for forward testing)
    'MES': {'tick_size': 0.25, 'tick_value': 1.25, 'multiplier': 5},
    'MNQ': {'tick_size': 0.25, 'tick_value': 0.50, 'multiplier': 2},

    # Energy
    'CL':  {'tick_size': 0.01, 'tick_value': 10.00, 'multiplier': 1000}, # Crude
    'NG':  {'tick_size': 0.001, 'tick_value': 10.00, 'multiplier': 10000}, # Nat Gas

    # Metals
    'GC':  {'tick_size': 0.10, 'tick_value': 10.00, 'multiplier': 100},  # Gold
    'SI':  {'tick_size': 0.005, 'tick_value': 25.00, 'multiplier': 5000}, # Silver

    # Treasuries
    'ZB':  {'tick_size': 0.03125, 'tick_value': 31.25, 'multiplier': 1000}, # 30Y
    'ZN':  {'tick_size': 0.015625, 'tick_value': 15.625, 'multiplier': 1000}, # 10Y
    'ZF':  {'tick_size': 0.0078125, 'tick_value': 7.8125, 'multiplier': 1000}, # 5Y

    # Currencies
    '6E':  {'tick_size': 0.00005, 'tick_value': 6.25, 'multiplier': 125000}, # Euro
    '6J':  {'tick_size': 0.0000005, 'tick_value': 6.25, 'multiplier': 12500000}, # Yen
}
```

### Risk Limits (Defaults)

```python
RiskLimits = {
    # Position limits
    'max_position_size': 10,          # Max contracts per position
    'max_portfolio_exposure': 0.20,   # 20% of capital
    'max_single_position_pct': 0.05,  # 5% of capital per position

    # Loss limits
    'max_daily_loss': 0.02,           # 2% daily stop
    'max_weekly_loss': 0.05,          # 5% weekly stop
    'max_drawdown': 0.10,             # 10% max drawdown

    # Correlation limits
    'max_correlated_exposure': 0.15,  # Max exposure to correlated positions

    # Correlation groups
    'equity_index': ['ES', 'NQ', 'RTY', 'YM', 'MES', 'MNQ'],
    'energy': ['CL', 'NG'],
    'metals': ['GC', 'SI'],
    'bonds': ['ZN', 'ZB', 'ZF'],
    'currencies': ['6E', '6J'],
}
```

### Interactive Brokers Integration

```python
from engine.futures import ExecutionEngine, IBExecutionHandler

# Paper trading
handler = IBExecutionHandler(
    host="127.0.0.1",
    port=7497,      # ⚠️ PAPER TRADING PORT
    client_id=1
)
engine = ExecutionEngine(handler=handler)
await engine.connect()

# Submit order
order = await engine.submit_order(
    symbol="MES",        # Use micros for testing
    side=OrderSide.BUY,
    quantity=1,
    order_type=OrderType.LIMIT,
    limit_price=5000.00
)

# EMERGENCY FLATTEN ALL
await engine.kill_switch()
```

**⚠️ CRITICAL: IB Port Configuration**

| Port | Purpose | DANGER LEVEL |
|------|---------|--------------|
| 7497 | TWS Paper Trading | Safe for testing |
| 7496 | TWS **LIVE** Trading | ⚠️ REAL MONEY |
| 4002 | IB Gateway Paper | Safe for testing |
| 4001 | IB Gateway **LIVE** | ⚠️ REAL MONEY |

**Connecting to wrong port = trading wrong account = real money at risk**

### MES Risk Calculation (Forward Testing)

```
MES = $1.25 per tick ($5 per point)
1 contract at SPX 6000 = ~$30K notional
Margin required = ~$1,500
10 point stop loss = $50 risk

→ Negligible risk for forward testing real strategies
```

### ⚠️ CRITICAL WARNINGS

1. **KILL SWITCH IS UNTESTED** - Test in paper trading before live
2. **IB ports matter** - Wrong port = wrong account = real money
3. **Databento symbology** - Use `ES.v.0` format, NOT bare `ES`
4. **Commission bug was fixed** - Double-counting removed, but audit any changes
5. **Daily loss includes unrealized** - Fixed, but verify if modifying

### Bugs Found and Fixed (Audit History)

| Bug | Impact | Status |
|-----|--------|--------|
| Commission double-counting | P&L error | ✅ Fixed |
| RSI confirmation inverted | Wrong signals | ✅ Fixed |
| Sortino ratio formula | Wrong risk metric | ✅ Fixed |
| Margin ignored existing positions | Unlimited leverage | ✅ Fixed |
| Daily loss ignored unrealized | Could exceed limit | ✅ Fixed |
| Division by zero (7 locations) | Feature crashes | ✅ Fixed |

### Databento Data Source

```python
# API key in .env
DATABENTO_API_KEY=db-XXX

# Symbology (CRITICAL - use continuous contracts)
symbols = ["ES.v.0", "NQ.v.0", "MES.v.0"]  # .v.0 = front month
stype_in = "continuous"
dataset = "GLBX.MDP3"  # CME Globex

# Data range available
start = "2015-01-01"
end = "2024-12-06"

# Cost: $176.59 one-time for 10 years
```

### Strategy Development Pattern

```python
from engine.futures import FuturesDataLoader, FuturesBacktester
from engine.futures.backtester import BacktestConfig, Order, OrderSide, OrderType

# Strategy function signature
def my_strategy(
    current_data: pd.DataFrame,    # Historical data up to current bar
    bt: FuturesBacktester          # Backtester for position access
) -> Optional[Order]:
    """
    Args:
        current_data: OHLCV data up to current bar (NO lookahead)
        bt: Backtester instance for position queries

    Returns:
        Order to execute, or None
    """
    if len(current_data) < 20:
        return None  # Not enough data

    close = current_data['close'].iloc[-1]
    sma = current_data['close'].rolling(20).mean().iloc[-1]

    pos = bt.get_position("ES")

    if close > sma * 1.001 and (pos is None or pos.side.value == "FLAT"):
        return Order(
            order_id=f"order_{bt._order_counter}",
            symbol="ES",
            side=OrderSide.BUY,
            quantity=1,
            order_type=OrderType.MARKET
        )

    return None

# Run backtest
loader = FuturesDataLoader('/Volumes/VelocityData/velocity_om/futures')
df = loader.load_symbol('ES', '1h', '2023-01-01', '2023-12-31')

config = BacktestConfig(initial_capital=100000, commission_per_contract=2.50)
bt = FuturesBacktester(config=config)
results = bt.run(df, my_strategy, 'ES')

print(f"Total trades: {results['total_trades']}")
print(f"Return: {results['total_return_pct']:.2f}%")
print(f"Sharpe: {results['sharpe_ratio']:.2f}")
print(f"Max DD: {results['max_drawdown_pct']:.2f}%")
```

### Futures vs Options Comparison

| Aspect | Options | Futures |
|--------|---------|---------|
| Greeks | Delta, gamma, theta, vega, vanna, charm | None |
| Structure selection | 18+ types (straddle, condor, etc.) | Long/short only |
| Roll frequency | Weekly/monthly | Quarterly |
| Leverage | Varies by strike | Fixed |
| Bid/ask | Wide on illiquid strikes | Tight |
| Complexity | High | Low |

**Why futures was built:** "We should have built for futures first" - simpler, transfers swarm/JARVIS infrastructure 100%

---

## FILE LOCATIONS QUICK REFERENCE

| What | Where |
|------|-------|
| Features | `python/engine/features/` |
| Discovery | `python/engine/discovery/` |
| Factors | `python/engine/factors/` |
| **Futures** | `python/engine/futures/` |
| Scripts | `python/scripts/` |
| Futures Data | `/Volumes/VelocityData/velocity_om/futures/` |
| Futures Features | `/Volumes/VelocityData/velocity_om/futures_features/` |
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
