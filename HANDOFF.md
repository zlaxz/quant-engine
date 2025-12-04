# SYSTEM STATE - 2025-12-03

**Last Updated:** 2025-12-03 (Very Late Night)
**Status:** FEATURE PIPELINE COMPLETE + 400M ROWS DOWNLOADED

---

## THE COMPLETE PICTURE

This document is the single source of truth for what's built and how to use it.

### What Exists

```
┌─────────────────────────────────────────────────────────────┐
│                         UI LAYER                             │
│  Electron App + React + Chat + Dashboards                   │
│  CIO (Gemini) lives here - can spawn agents, request work   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      PYTHON ENGINE                           │
│  server.py (port 5001) + Feature Pipeline + Backtester      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         DATA LAKE                            │
│  /Volumes/VelocityData/velocity_om/massive                  │
│  13M stock rows + 394M options rows (2020-2025)             │
└─────────────────────────────────────────────────────────────┘
```

---

## FEATURE PIPELINE (Audited 2025-12-03)

**Location:** `python/engine/features/`

All 7 files audited. ~86 bugs fixed. All pass integration tests.

| File | Purpose | Key Features |
|------|---------|--------------|
| `raw_features.py` | OHLCV-derived features | Returns (1-60d), volatility, volume, microstructure, gaps |
| `regime.py` | Market regime classification | VIX regime (PAUSE/SUBOPTIMAL/OPTIMAL), trend (STRONG_DOWN to STRONG_UP), combined 4-state |
| `sector_regime.py` | Sector rotation signals | Per-sector regime, rotation patterns, relative strength |
| `domain_features.py` | VIX term structure | Backwardation/contango, vol crush/spike signals, VIX dynamics |
| `momentum_logic.py` | Momentum scoring | Velocity scores, trend state (DYING/STEADY/ACCELERATING), MTF alignment |
| `cross_asset.py` | Cross-asset relationships | Price ratios, rolling correlations, relative strength vs SPY |
| `gamma_calc.py` | Options gamma exposure | GEX calculation, zero gamma levels, dealer positioning |

### How to Use Features

**Option 1: main_harvest.py (Recommended)**
```bash
# Process single symbol
python scripts/main_harvest.py --symbol SPY --start 2020-01-01 --end 2025-12-01

# Process all Liquid 16
python scripts/main_harvest.py --all-symbols --start 2020-01-01 --end 2025-12-01

# Output: /Volumes/VelocityData/velocity_om/features/{SYMBOL}_master_features.parquet
```

**Option 2: Programmatic API**
```python
from engine.features.raw_features import RawFeatureGenerator
from engine.features.regime import add_regime_features
from engine.features.domain_features import add_domain_features

# Load your OHLCV data (must include 'vix' column)
df = load_data(...)

# Add features (lag=1 prevents lookahead bias)
raw_gen = RawFeatureGenerator()
df = raw_gen.generate(df, include_targets=False)
df = add_regime_features(df, spy_col='close', lag=1)
df = add_domain_features(df, vix_col='vix', lag=1)
```

### Critical Pattern: Epsilon Floors

**NEVER use `1e-10` for division protection.** Use proportional floors:

```python
# BAD - causes explosion
result = value / max(denom, 1e-10)

# GOOD - proportional floor
floor = np.maximum(denom, value.abs() * 0.01)
result = value / floor
```

See: `08-Learnings/what-worked/epsilon-floor-pattern.md`

---

## DATA LAKE (Downloaded 2025-12-03)

**Location:** `/Volumes/VelocityData/velocity_om/massive`

| Dataset | Rows | Format | Status |
|---------|------|--------|--------|
| Stocks | 13,154,539 | Daily parquet | ✅ Complete |
| Options | 394,130,862 | Daily parquet | ✅ Complete |
| Futures | 0 | - | ❌ 403 (subscription tier) |

**Symbols (Liquid 16):**
SPY, QQQ, IWM, DIA, GLD, SLV, TLT, LQD, HYG, USO, VXX, XLF, XLK, XLE, EEM, EFA

**Date Range:** 2020-01-01 to 2025-12-03 (1,546 trading days)

### Data Structure

```
/Volumes/VelocityData/velocity_om/massive/
├── stocks/
│   ├── 2020-01-02.parquet
│   └── ... (1,486 files)
└── options/
    ├── 2020-01-02.parquet
    └── ... (1,488 files, ~260K rows each)
```

### How to Load Data

```python
import duckdb

# Query stocks
con = duckdb.connect()
df = con.execute("""
    SELECT * FROM read_parquet('/Volumes/VelocityData/velocity_om/massive/stocks/*.parquet')
    WHERE symbol = 'SPY'
""").df()

# Query options
df = con.execute("""
    SELECT * FROM read_parquet('/Volumes/VelocityData/velocity_om/massive/options/*.parquet')
    WHERE underlying = 'SPY' AND dte BETWEEN 7 AND 45
""").df()
```

---

## DAEMON SYSTEM (Autonomous)

**Location:** `python/daemon.py`

The daemon runs autonomously:

```
Loop (continuous):
  0. DISCOVERY (30 min)  - MorphologyScanner finds opportunities
  1. MISSION (1 hour)    - Hunts for target strategies
  2. HARVEST (5 min)     - Collects mutations
  3. EXECUTE (10 min)    - Runs backtests
  4. PUBLISH (6 AM)      - Morning briefings
  5. SHADOW (continuous) - Live paper trading
```

---

## WHAT'S WORKING (Don't Break)

### Core Systems
- ✅ Electron app + React UI
- ✅ Python API (port 5001)
- ✅ Feature pipeline (7 files, audited)
- ✅ Data lake (400M rows)
- ✅ TradeSimulator (timezone-aware)
- ✅ Greeks (edge cases handled)
- ✅ MorphologyScanner (autonomous discovery)
- ✅ ThetaTerminal integration
- ✅ Memory systems (MCP Obsidian, Supabase)

### Infrastructure
- ✅ Build compiles (`npm run build`)
- ✅ All Python files pass syntax check
- ✅ IPC handlers have error handling

---

## WHAT'S NOT CONNECTED (Known Gaps)

| Gap | Status | Notes |
|-----|--------|-------|
| Feature pipeline → Backtest UI | ❓ Needs verification | Can BacktestRunner use these features? |
| Data lake → Data loaders | ❓ Needs verification | Do loaders know about `/Volumes/VelocityData`? |
| ProfileDetectors | ❌ Stub only | Class doesn't exist, using fallback |
| MissionControl UI | ❌ Not built | Backend exists, no frontend |

---

## FOR THE CIO (Gemini)

When the user asks for research:

1. **Feature Pipeline Ready:** You can request features from `python/engine/features/`
2. **400M Options Rows:** Data is at `/Volumes/VelocityData/velocity_om/massive/options/`
3. **Use DuckDB:** Query parquet files directly, don't load into memory
4. **Epsilon Floor Pattern:** Any division operations must use proportional floors

Example prompt the user might give:
> "Analyze gamma exposure patterns in SPY options during VIX spikes"

What you should do:
1. Query options data for SPY
2. Use `gamma_calc.py` for GEX calculations
3. Use `regime.py` to identify VIX spikes
4. Correlate GEX with price moves

---

## FOR CLAUDE CODE

When starting a session:

1. **Read this file first** - It's the complete picture
2. **Check SESSION_STATE.md** - For what's broken/in-progress
3. **Query memory** - `memory_recall "quant-engine: [topic]"`
4. **Don't break working code** - Feature pipeline is audited and stable

When doing development:
1. **After editing Electron files:** Rebuild with `npx vite build --config vite.config.electron.ts`
2. **Python server:** Port 5001 (not 5000, AirPlay conflict)
3. **New division operations:** Use epsilon floor pattern

---

## QUICK START

```bash
# Start the app
npm run electron:dev

# Start Python server (in separate terminal)
cd python && python3 server.py 5001

# Verify data is accessible
python3 -c "import duckdb; print(duckdb.query(\"SELECT COUNT(*) FROM read_parquet('/Volumes/VelocityData/velocity_om/massive/stocks/*.parquet')\").df())"
```

---

## DOCUMENTATION LOCATIONS

| What | Where |
|------|-------|
| System state | This file (`HANDOFF.md`) |
| Architecture decisions | `DECISIONS.md` |
| Session work log | `python/SESSION_STATE.md` |
| CIO knowledge base | Obsidian `~/ObsidianVault/Projects/quant-engine/` |
| Feature patterns | Obsidian `08-Learnings/what-worked/epsilon-floor-pattern.md` |
| Data status | Obsidian `03-Research/data-download-status-2025-12-03.md` |

---

**This file is the single source of truth. Keep it updated.**
