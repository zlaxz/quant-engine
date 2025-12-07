# Futures Pipeline Archaeological Dig

**Extracted From:** Session 3d1eacc6-e0ef-4fac-bb12-d383d125cfa7
**Extraction Date:** 2025-12-07
**Session Duration:** ~4,518 JSONL lines, spanning multiple context compactions

---

## ARCHITECTURAL DECISIONS

### Decision: Futures Over Options

**Rationale (Exact Quote):**
> "i think once we turn to futures and crypto though.... futures alone ....i mean geez"
>
> "we should have built for futures first"

**Detailed Rationale Extracted:**
> "Options complexity we've dealt with:
> - Strike/expiration selection
> - Greeks management (delta, gamma, theta, vega, vanna, charm)
> - Volatility surfaces
> - Roll logic
> - Spread construction
> - Wide bid/asks in illiquid strikes
>
> Futures equivalent:
> - Price goes up or down
> - Fixed leverage
> - Roll 4x/year
> - Done"

**What Transfers From Options System:**
- "Swarm infrastructure (100%)"
- "JARVIS UI (100%)"
- "Memory/coordination (100%)"
- "Many physics features (correlation, flow, regime, entropy)"

### Decision: Pre-Computed Features (Not On-the-Fly)

**User Requirement:**
> "yes when downloads are done or if you can start now you can run that, you can run in parallel, remember this is an m4pro with 48gb of memory"

**Rationale:**
- 10 years of 1-minute data = ~35M bars across all contracts
- Generating 150 features on-the-fly each backtest would be slow
- Pre-computing makes backtests "near-instant"

### Decision: Event-Driven Backtester

**Architecture:** Backtester takes a **strategy function**, not raw signals
```python
def run(
    self,
    data: pd.DataFrame,
    strategy: Callable[[pd.DataFrame, 'FuturesBacktester'], Optional[Order]],
    symbol: str = 'ES'
) -> Dict[str, Any]
```

### Decision: Separation of Execution Handlers

**Implemented Pattern:**
- `ExecutionHandler` - Abstract base class
- `BacktestExecutionHandler` - Simulated execution for backtests
- `IBExecutionHandler` - Interactive Brokers integration
- `SchwabExecutionHandler` - Schwab API (stubbed, user planned to use this initially)

**Why IB over Schwab (Decision During Session):**
> "IB is **much better** for futures than Schwab. IB has:
> - **Native futures support** (ES, MES, NQ, etc. directly)
> - **Better API** (`ib_insync` library is excellent)
> - **Lower commissions** (~$0.85/contract vs Schwab's $2.25)
> - **Two accounts** = paper trade on one, live on another simultaneously"

### Decision: Independent Risk Manager

**Design Principles:**
1. Portfolio-level exposure management
2. Correlation-adjusted risk limits
3. Drawdown protection with circuit breakers
4. Real-time P&L tracking

---

## COMPONENT MAP

### FuturesDataLoader (`python/engine/futures/data_loader.py`)

**Purpose:** Multi-timeframe data loading, contract specifications, resampling

**Dependencies:**
- pandas, numpy
- parquet files from `/Volumes/VelocityData/velocity_om/futures/`

**Dependents:**
- FuturesFeatureEngine
- FuturesBacktester
- Test scripts

**Testing Status:** PASSED
- 5,894 bars loaded (ES 1h 2023)

**Known Issues:** None identified

**Contract Specs Defined:**
```python
'ES': {'tick_size': 0.25, 'tick_value': 12.50, 'multiplier': 50}
'NQ': {'tick_size': 0.25, 'tick_value': 5.00, 'multiplier': 20}
'MES': {'tick_size': 0.25, 'tick_value': 1.25, 'multiplier': 5}
'MNQ': {'tick_size': 0.25, 'tick_value': 0.50, 'multiplier': 2}
'RTY': {'tick_size': 0.10, 'tick_value': 5.00, 'multiplier': 50}
'YM': {'tick_size': 1.00, 'tick_value': 5.00, 'multiplier': 5}
'CL': {'tick_size': 0.01, 'tick_value': 10.00, 'multiplier': 1000}
'GC': {'tick_size': 0.10, 'tick_value': 10.00, 'multiplier': 100}
'ZN': {'tick_size': 0.015625, 'tick_value': 15.625, 'multiplier': 1000}
'ZB': {'tick_size': 0.03125, 'tick_value': 31.25, 'multiplier': 1000}
'6E': {'tick_size': 0.00005, 'tick_value': 6.25, 'multiplier': 125000}
```

---

### FuturesFeatureEngine (`python/engine/futures/feature_engine.py`)

**Purpose:** Generate 150 features from OHLCV data

**Feature Categories:**
- Price action features
- Volume features
- Volatility features
- Structure features
- Time-based features

**Dependencies:**
- pandas, numpy
- FuturesDataLoader output

**Dependents:**
- SignalGenerator
- Feature pre-computation scripts

**Testing Status:** PASSED
- 150 features generated

**Bugs Found and Fixed (3 Audit Rounds):**

1. **Hardcoded 252 annualization factor**
   - Bug: Used 252 for all timeframes
   - Fix: Dynamic by timeframe

2. **Division by zero in RSI**
   - Location: RSI calculation
   - Fix: Added zero check

3. **Division by zero in BB%**
   - Location: Bollinger Band percentage
   - Fix: Added zero check

4. **Division by zero in close_vs_high**
   - Fix: Added range check

5. **Division by zero in range_position**
   - Fix: Added range check

6. **VWAP/clv division by zero**
   - Fix: Added high-low check

7. **Keltner channel division by zero**
   - Fix: Added ATR check

---

### FuturesBacktester (`python/engine/futures/backtester.py`)

**Purpose:** Event-driven walk-forward backtester

**Features:**
- Event-driven architecture
- Realistic transaction costs
- Slippage modeling
- Position and risk tracking
- Full trade audit trail
- Walk-forward support
- Performance analytics

**Dependencies:**
- pandas, numpy
- FuturesDataLoader
- FuturesFeatureEngine (for feature data)
- ExecutionHandler (abstract)

**Dependents:**
- Strategy development scripts
- Test scripts

**Testing Status:** PASSED (3 Audit Rounds)
- 172 trades, 16.15% return, 0.49 Sharpe
- 21.26% max drawdown, 34.88% win rate

**CRITICAL BUGS FOUND AND FIXED:**

1. **Double-counting exit commissions (CRITICAL P&L ERROR)**
   - Original: Commissions charged on entry AND exit, then doubled
   - Impact: Could overstate/understate P&L significantly
   - Fix: Single commission per side

2. **Sortino ratio formula wrong**
   - Original: Using mean of negative returns only
   - Correct: Using `np.minimum(daily_returns, 0)` to treat positive days as 0 deviation

3. **Daily returns sum vs compound**
   - Issue: Simple sum instead of compound return
   - Impact: Slightly incorrect return calculations

4. **Margin check ignored existing positions**
   - Original: Only checked new position margin
   - Bug: Allowed unlimited leverage
   - Fix: Calculate total margin including existing positions

5. **max_position_size ignored**
   - Original: Position sizing didn't respect max
   - Fix: Added enforcement check

**Warnings:**
- Always audit commission logic when modifying
- Verify margin calculations include ALL positions

---

### SignalGenerator (`python/engine/futures/signal_generator.py`)

**Purpose:** Composite signal generation from features

**Signal Generator Types Implemented:**
1. **MomentumSignalGenerator** - Multiple timeframe momentum with trend confirmation
2. **MeanReversionSignalGenerator** - Bollinger Bands and z-score for reversals
3. **BreakoutSignalGenerator** - Range breakouts (implied from structure)
4. **VolatilityRegimeSignalGenerator** - Vol-regime based signals (implied)

**Dependencies:**
- pandas, numpy
- Feature DataFrame from FeatureEngine

**Dependents:**
- FuturesBacktester
- Strategy implementations

**Testing Status:** PASSED
- 2,585 long / 3,038 short signals generated

**Bug Found and Fixed:**
1. **RSI confirmation logic inverted**
   - Original: Confirming wrong direction
   - Fix: Corrected conditional logic

---

### FuturesRiskManager (`python/engine/futures/risk_manager.py`)

**Purpose:** Position sizing, risk limits, portfolio protection

**Risk Limit Defaults:**
```python
# Position limits
max_position_size: int = 10  # Max contracts per position
max_portfolio_exposure: float = 0.20  # 20% of capital
max_single_position_pct: float = 0.05  # 5% of capital per position

# Loss limits
max_daily_loss: float = 0.02  # 2% daily stop
max_weekly_loss: float = 0.05  # 5% weekly stop
max_drawdown: float = 0.10  # 10% max drawdown

# Correlation limits
max_correlated_exposure: float = 0.15  # Max exposure to correlated positions

# Volatility adjustments
vol_scaling: bool = True
target_vol: float = 0.15  # Target annualized vol
max_vol_scale: float = 2.0  # Max scale-up in low vol
min_vol_scale: float = 0.25  # Min scale-down in high vol
```

**Correlation Groups Defined:**
```python
'equity_index': ['ES', 'NQ', 'RTY', 'YM', 'MES', 'MNQ']
'energy': ['CL', 'NG']
'metals': ['GC', 'SI']
'bonds': ['ZN', 'ZB', 'ZF']
'currencies': ['6E', '6J']
```

**Dependencies:**
- pandas, numpy
- Contract specifications

**Dependents:**
- FuturesBacktester
- ExecutionEngine (for live risk checks)

**Testing Status:** PASSED
- Position sizing works (blocked at limit correctly)

**Bug Found and Fixed:**
1. **Daily loss limit checked only realized P&L**
   - Bug: Ignored unrealized P&L in open positions
   - Impact: Could exceed daily loss limit
   - Fix: Now includes unrealized P&L in daily loss calculation

---

### ExecutionEngine (`python/engine/futures/execution_engine.py`)

**Purpose:** Order execution, broker integration

**Classes:**
- `ExecutionHandler` (ABC) - Abstract base
- `BacktestExecutionHandler` - Simulated execution
- `IBExecutionHandler` - Interactive Brokers
- `SchwabExecutionHandler` - Schwab API (incomplete)

**Order Types Supported:**
- MARKET
- LIMIT
- STOP
- STOP_LIMIT
- MIT (Market If Touched)

**Time In Force Options:**
- DAY
- GTC (Good Till Cancelled)
- IOC (Immediate or Cancel)
- FOK (Fill or Kill)
- GTD (Good Till Date)

**Backtest Execution Features:**
- Configurable slippage models ("fixed", "proportional", "volatility")
- Partial fills simulation
- Latency simulation
- Commission per contract

**Testing Status:** PASSED
- Orders filled, PnL tracking works

**Known Issues:** None identified

---

## CRITICAL WARNINGS

### 1. Kill Switch Not Tested
> "Live trading kill switch untested"

**Context:** The risk manager has a `_trading_halted` flag and halt mechanism, but it was never tested with live execution.

**Required Before Live Trading:**
- Test kill switch in paper trading
- Verify halt propagates to all open orders
- Verify positions can be flattened

### 2. IB Connection Port Configuration
**Port Assignments (Critical for Live Trading):**
```
7497 = TWS Paper Trading
7496 = TWS Live Trading
4002 = IB Gateway Paper
4001 = IB Gateway Live
```

**WARNING:** Connecting to wrong port could execute on wrong account.

### 3. Databento Data Quality Warnings
During download, Databento flagged degraded data quality on specific dates:
> "BentoWarning: The streaming request contained one or more days which have reduced quality: 2017-11-13 (degraded), 2018-10-21 (degraded), 2019-01-15 (degraded)"

**Impact:** Some historical data may have gaps or quality issues on these dates.

### 4. Margin Calculation
**Original Bug:** Margin check ignored existing positions
**Fix Applied:** But the fix was self-reported as verified.

**Recommendation:** Manually verify margin logic before live trading.

### 5. Commission Double-Counting
This was identified as a CRITICAL bug. While fixed, any future modifications to commission logic should be carefully audited.

---

## INTEGRATION DETAILS

### Interactive Brokers

**Package:** `ib_insync`

**Connection Details:**
```python
IBExecutionHandler(
    host="127.0.0.1",
    port=7497,  # Paper trading
    client_id=1,
    account=None  # Uses first available
)
```

**Port Reference:**
| Port | Purpose |
|------|---------|
| 7497 | TWS Paper Trading |
| 7496 | TWS Live Trading |
| 4002 | IB Gateway Paper |
| 4001 | IB Gateway Live |

**Contract Qualification:**
```python
contract = Future(
    symbol=order.symbol,
    exchange='CME',
    currency='USD'
)
await self._ib.qualifyContractsAsync(contract)
```

**Account Features Mentioned:**
- User has 2 IB accounts
- Can hold separate long and short positions on same instrument
- Use different `client_id` values for different strategies on same account

### Databento

**Package:** `databento`

**API Key Storage:** `.env` file
**Key Format:** `DATABENTO_API_KEY=db-XXX`

**Symbology (CRITICAL - Initial Attempts Failed):**
```python
# WRONG - Initial attempt (failed with 422 errors)
symbols=["ES", "NQ"]

# CORRECT - Continuous contract format
stype_in="continuous"
symbols=["ES.v.0", "NQ.v.0"]  # .v.0 = front month continuous
```

**Dataset:** `GLBX.MDP3` (CME Globex)

**Schemas Downloaded:**
- `ohlcv-1m` (1-minute bars)
- `ohlcv-1h` (1-hour bars)
- `ohlcv-1d` (daily bars)

**Data Range:** 2015-01-01 to 2024-12-06

**Contracts Downloaded (15 total):**
- Equity Index: ES, NQ, RTY, YM
- Micros: MES, MNQ
- Energy: CL, NG
- Metals: GC, SI
- Treasuries: ZB, ZN, ZF
- Currencies: 6E, 6J

**Row Counts (1-minute data):**
- ES: 3,483,845 rows
- NQ: 3,446,720 rows
- RTY: 2,430,000+ rows
- (Similar for others)

**Total Data Size:**
- Raw OHLCV: 0.69 GB (45 parquet files)
- Pre-computed features: 24 GB (45 files x 150 features)

**Cost:** $176.59 one-time for 10 years of data

---

## DEFERRED/INCOMPLETE

### 1. Schwab Integration
`SchwabExecutionHandler` is stubbed but incomplete:
```python
class SchwabExecutionHandler(ExecutionHandler):
    """
    Note: Requires schwab-py package and API credentials.
    """
```

**Session Decision:** Pivoted to IB instead of Schwab

### 2. Strategy Development
**Status:** Infrastructure complete, no actual trading strategies built
> "All infrastructure is ready - need to build actual trading strategies"

### 3. Live Forward Testing
**User Requirement:**
> "i want to quit fucking around, i want to be live trading tomorrow with futures"

**Status:** Not completed in session. Infrastructure ready but not connected to live.

### 4. Gold Alpha System
A complex gold trading system was accidentally injected via context recovery:
- Regime detection via Real Rates, Liquidity, Convexity Vortex
- Multiple data sources (FRED, options, etc.)

**Session Decision:**
> "skip that crazy system for now, sorry didn't mean to inject that now"

### 5. Multi-Layer Swarm Architecture
Discussed but not implemented:
- 5 Claude sessions
- Each running 5 DeepSeek captains
- Each running 5 DeepSeek supervisors
- Each running 50 DeepSeek workers
- = 6,250 potential parallel workers

**Status:** Documented in HANDOFF.md but not built

---

## USER REQUIREMENTS (Direct Quotes)

### On Quality
> "no simple, no shortcuts, i want full production grade, we can run the whole pipeline in no time, we can fill parquet with parallel processing, this will be production ready"

### On Live Trading Urgency
> "i want to quit fucking around, i want to be live trading tomorrow with futures"

### On Risk Tolerance for Forward Testing
> "what nice is we can start trading automated instantly with es mini because the risk in 1 contract is negligible so we can forward test in real time after running our pipeline with minimal risk"

**MES Risk Calculation Provided:**
```
MES = $5 per point
1 contract at SPX 6000 = ~$30K notional
Margin required = ~$1,500
10 point stop loss = $50 risk
```

### On Capital and Returns
> "i don't need infinite but i assume running a 10X return on a $1M is pretty easy at that point"

**Session Response on Achievability:**
| Timeframe | CAGR needed | Achievable? |
|-----------|-------------|-------------|
| 1 year | 900% | No. That's lottery territory. |
| 3 years | ~115% | Aggressive but possible with leverage + real edge |
| 5 years | ~58% | Very doable with consistent edge |

### On Hardware
> "remember this is an m4pro with 48gb of memory"
> "14 cores"

**Parallel Processing Used:** 12 workers (leaving 2 for OS)

---

## TEST RESULTS SUMMARY

**Full Pipeline Test (`test_futures_engine.py`):**

| Component | Status | Results |
|-----------|--------|---------|
| Data Loader | PASS | 5,894 bars loaded (ES 1h 2023) |
| Feature Engine | PASS | 150 features generated |
| Signal Generator | PASS | 2,585 long / 3,038 short signals |
| Risk Manager | PASS | Position sizing works (blocked at limit) |
| Backtester | PASS | 172 trades, 16.15% return, 0.49 Sharpe |
| Execution Engine | PASS | Orders filled, PnL tracking works |

**Backtest Metrics (Simple Momentum on ES 1h 2023):**
- Trades: 172
- Return: 16.15%
- Sharpe: 0.49
- Max Drawdown: 21.26%
- Win Rate: 34.88%

---

## FILES CREATED

**Engine Modules:**
- `/Users/zstoc/GitHub/quant-engine/python/engine/futures/__init__.py`
- `/Users/zstoc/GitHub/quant-engine/python/engine/futures/data_loader.py`
- `/Users/zstoc/GitHub/quant-engine/python/engine/futures/feature_engine.py`
- `/Users/zstoc/GitHub/quant-engine/python/engine/futures/backtester.py`
- `/Users/zstoc/GitHub/quant-engine/python/engine/futures/signal_generator.py`
- `/Users/zstoc/GitHub/quant-engine/python/engine/futures/risk_manager.py`
- `/Users/zstoc/GitHub/quant-engine/python/engine/futures/execution_engine.py`

**Scripts:**
- `/Users/zstoc/GitHub/quant-engine/python/scripts/download_futures_databento.py`
- `/Users/zstoc/GitHub/quant-engine/python/scripts/precompute_futures_features.py`
- `/Users/zstoc/GitHub/quant-engine/python/scripts/test_futures_engine.py`

**Data Locations:**
- Raw OHLCV: `/Volumes/VelocityData/velocity_om/futures/` (0.69 GB)
- Features: `/Volumes/VelocityData/velocity_om/futures_features/` (24 GB)

---

## SESSION HANDOFF PROMPT (Preserved from Session)

The session ended with this handoff prompt being generated for future sessions:

```
**FUTURES TRADING ENGINE - SESSION HANDOFF**

## Mission
Build a production-grade futures trading system. Goal: live trading with real capital via Interactive Brokers. Infrastructure is complete - now need trading strategies.

## Project Location
`/Users/zstoc/GitHub/quant-engine/`

## What Exists (All Built & Tested)

### Data Layer
Raw OHLCV Data: /Volumes/VelocityData/velocity_om/futures/
- 15 contracts: ES, NQ, RTY, YM (equity index), MES, MNQ (micros),
                CL, NG (energy), GC, SI (metals), ZB, ZN, ZF (treasuries), 6E, 6J (currencies)
- 3 timeframes each: 1m, 1h, 1d
- Date range: 2015-01-01 to 2024-12-06
- Source: Databento

Pre-computed Features: /Volumes/VelocityData/velocity_om/futures_features/
- 45 parquet files (15 symbols x 3 timeframes)
- 150 features per file (price action, volume, volatility, structure, time-based)
- Total: 24 GB ready for instant backtest loading

### Engine Modules (python/engine/futures/)
- FuturesDataLoader - Multi-timeframe data loading
- FuturesFeatureEngine - 150-feature generation
- SignalGenerator - Composite signal generation
- FuturesRiskManager - Position sizing, risk limits
- FuturesBacktester - Event-driven backtesting
- ExecutionEngine + IBExecutionHandler - IB integration ready

## Test Command
cd /Users/zstoc/GitHub/quant-engine/python && python3.11 scripts/test_futures_engine.py

## What's Next
1. Strategy development - Build strategies using pre-computed features
2. IB paper trading - Test with IBExecutionHandler
3. Live trading - Goal was "live trading tomorrow with futures"
```

---

**End of Archaeological Extraction**

*This document preserves the complete development history of the futures trading engine from session 3d1eacc6-e0ef-4fac-bb12-d383d125cfa7. It is intended to serve as the definitive historical record for future development work.*
