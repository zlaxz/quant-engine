# Quant-Engine System Inventory

**Last Updated:** 2025-12-05
**Purpose:** Authoritative inventory of what exists and how to use it

---

## SYSTEM ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         QUANT-ENGINE                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐      │
│  │ PHYSICS ENGINE  │    │ STRUCTURE       │    │ SIGMA AGENT     │      │
│  │ (Features)      │───▶│ DISCOVERY       │───▶│ (Trading)       │      │
│  │                 │    │ (Options GA)    │    │                 │      │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘      │
│          │                      │                      │                 │
│          ▼                      ▼                      ▼                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐      │
│  │ AI-NATIVE       │    │ PORTFOLIO       │    │ FAST            │      │
│  │ PIPELINE        │    │ BACKTESTER      │    │ BACKTESTER      │      │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘      │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 1. PHYSICS ENGINE (Feature Generation)

**Location:** `python/engine/features/`

### Modules (16 total)

| Module | Purpose | Key Output |
|--------|---------|------------|
| `raw_features.py` | Basic OHLCV-derived features | Returns, ranges, gaps |
| `morphology.py` | Distribution shapes (P/b/D/I/B) | Skewness, kurtosis, Dip test |
| `dynamics.py` | Rate of change features | dγ/dt, Hurst exponent |
| `entropy.py` | Information theory metrics | Sample entropy, ApEn |
| `flow.py` | Order flow analysis | VPIN, Kyle's Lambda, OFI |
| `correlation.py` | Cross-asset relationships | Rolling correlations |
| `regime.py` | Market regime classification | HMM states |
| `gamma_calc.py` | Options gamma exposure | GEX, gamma flip levels |
| `cross_asset.py` | Multi-symbol features | SPY-VIX, sector rotation |
| `duration.py` | Time-based analysis | Duration modeling |
| `change_point.py` | Structural breaks | CUSUM, Bayesian changepoint |
| `momentum_logic.py` | Momentum indicators | Trend strength |
| `domain_features.py` | Domain-specific features | Custom indicators |
| `mm_inventory.py` | Market maker inventory | MM positioning |
| `sector_regime.py` | Sector rotation | Sector momentum |
| `options_feature_engineer.py` | Options-derived features | ATM cost, skew, term structure |

### Scripts

| Script | Purpose | Command |
|--------|---------|---------|
| `main_harvest.py` | Generate all features (daily) | `python3 scripts/main_harvest.py --symbol SPY --start 2020-01-01 --end 2025-12-01` |
| `main_harvest_mtf_physics.py` | Multi-timeframe features | `python3 scripts/main_harvest_mtf_physics.py --symbol SPY ...` |
| `precompute_cross_asset.py` | Pre-compute cross-asset (run once) | `python3 scripts/precompute_cross_asset.py` |
| `run_options_features.py` | Extract options features from 394M rows | `python3 scripts/run_options_features.py --symbol SPY` |

### Output Files

| File | Location | Description |
|------|----------|-------------|
| Master features | `/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet` | 496 daily features |
| MTF features | `/Volumes/VelocityData/velocity_om/features/SPY_mtf_physics.parquet` | 1,291 multi-timeframe features |
| Cross-asset | `/Volumes/VelocityData/velocity_om/features/cross_asset_features.parquet` | 181 cross-asset features |
| Options features | `/Volumes/VelocityData/velocity_om/massive/features/SPY_options_features.parquet` | Options-derived features |

---

## 2. OPTIONS STRUCTURE DISCOVERY (Genetic Algorithm)

**Location:** `python/engine/discovery/`

### Core Modules

| Module | Purpose |
|--------|---------|
| `structure_dna.py` | 18 structure types (straddles, spreads, condors, etc.) + genetic operators |
| `payoff_surface_builder.py` | Pre-compute daily payoffs for fast backtesting |
| `fast_backtester.py` | Vectorized options backtester with slippage |
| `structure_miner.py` | Genetic algorithm with walk-forward validation |

### Structure Types (18)

```
Single Leg: long_call, short_call, long_put, short_put
Straddles:  long_straddle, short_straddle
Strangles:  long_strangle, short_strangle
Spreads:    call_debit_spread, call_credit_spread, put_debit_spread, put_credit_spread
Condors:    iron_condor, iron_butterfly
Calendars:  calendar_spread, diagonal_spread
Complex:    ratio_spread, backspread
```

### Scripts

| Script | Purpose | Command |
|--------|---------|---------|
| `run_structure_discovery.py` | Full GA pipeline | See commands below |

### Commands

```bash
cd /Users/zstoc/GitHub/quant-engine/python

# Build payoff surface (run once, ~1 hour)
python3 scripts/run_structure_discovery.py --build-surface --symbol SPY

# Quick baseline check of seed structures
python3 scripts/run_structure_discovery.py --baseline --symbol SPY

# Run discovery with walk-forward validation
python3 scripts/run_structure_discovery.py --discover --walk-forward --symbol SPY

# Full pipeline
python3 scripts/run_structure_discovery.py --full --walk-forward --symbol SPY
```

### Output Files

| File | Location | Description |
|------|----------|-------------|
| Payoff surface | `/Volumes/VelocityData/velocity_om/payoff_surfaces/SPY_payoff_surface.parquet` | Pre-computed payoffs |
| Discovered structures | `/Volumes/VelocityData/velocity_om/discovered_structures/discovered_structures.json` | GA output |
| Checkpoints | `/Volumes/VelocityData/velocity_om/discovered_structures/checkpoint_gen_*.json` | Generation snapshots |

### Current Discovered Structure

```json
{
  "structure_type": "short_straddle",
  "dte_bucket": 21,
  "delta_bucket": "ATM",
  "entry_regimes": [3],
  "profit_target_pct": 0.3,
  "stop_loss_pct": 1.0,
  "dte_exit_threshold": 7,
  "fitness_score": 8.55
}
```

---

## 3. AI-NATIVE PIPELINE (Layer 7)

**Location:** `python/engine/ai_native/`

### Modules

| Module | Purpose |
|--------|---------|
| `pipeline.py` | Main orchestrator |
| `observers.py` | Observer swarm (23 specialized observers) |
| `synthesis.py` | Thesis generation from observations |
| `adversarial.py` | Red-team challenge of thesis |
| `expression.py` | Trade expression generation |
| `force_aggregator.py` | Aggregate all forces into unified view |
| `learning.py` | Self-improvement based on outcomes |

### Scripts

| Script | Purpose | Command |
|--------|---------|---------|
| `run_ai_native.py` | Run AI-native analysis | `python3 scripts/run_ai_native.py --symbol SPY --features ... --equations ... --regime ...` |

### Output

| File | Location |
|------|----------|
| AI-native results | `/Volumes/VelocityData/velocity_om/ai_native_results/ai_native_SPY_*.json` |

---

## 4. SWARM SYSTEM (Scout, Math, Jury)

**Location:** `python/engine/discovery/`

### Scripts

| Script | Purpose | Command |
|--------|---------|---------|
| `run_scout_swarm.py` | Feature selection via mutual information | `python3 scripts/run_scout_swarm.py --input <features.parquet>` |
| `run_math_swarm.py` | Equation discovery via PySR | `python3 scripts/run_math_swarm.py --features <features.parquet> --scout-results <scout.json>` |
| `run_jury_swarm.py` | Regime classification | `python3 scripts/run_jury_swarm.py --features <features.parquet> --scout-results <scout.json>` |

### Output Files

| File | Location |
|------|----------|
| Scout results | `/Volumes/VelocityData/velocity_om/features/scout_swarm_results.json` |
| Math results | `/Volumes/VelocityData/velocity_om/features/math_swarm_results.json` |
| Jury results | `/Volumes/VelocityData/velocity_om/features/jury_swarm_results.json` |
| Regime assignments | `/Volumes/VelocityData/velocity_om/features/regime_assignments.parquet` |

---

## 5. SIGMA AGENT (Mean Reversion Trading)

**Location:** `python/sigma_agent/`

### Modules

| Module | Purpose |
|--------|---------|
| `agent.py` | Multi-timeframe Z-score mean reversion |
| `options_selector.py` | Optimal strike/DTE selection |
| `exit_optimizer.py` | Exit rule optimization |

### Logic

```
Entry: LONG if 3+ timeframes have Z < -2.0
       SHORT if 3+ timeframes have Z > 2.0
Exit:  +25% profit target, -15% stop loss, or 10-day time stop
```

### Scripts

| Script | Purpose | Command |
|--------|---------|---------|
| `run_sigma_agent_scan.py` | Scan for setups | `python3 scripts/run_sigma_agent_scan.py` |
| `test_sigma_agent.py` | Test the agent | `python3 scripts/test_sigma_agent.py` |
| `backtest_sigma_agent.py` | Backtest the agent | `python3 scripts/backtest_sigma_agent.py` |
| `optimize_sigma_parameters.py` | Optimize parameters | `python3 scripts/optimize_sigma_parameters.py` |

---

## 6. PORTFOLIO BACKTESTER

**Location:** `python/engine/portfolio/`

### Modules

| Module | Purpose |
|--------|---------|
| `portfolio_backtester.py` | Multi-strategy portfolio simulation |
| `portfolio_dna.py` | Portfolio configuration (weighting, rebalancing) |
| `portfolio_optimizer.py` | Portfolio optimization |

### Scripts

| Script | Purpose | Command |
|--------|---------|---------|
| `run_portfolio_optimization.py` | Optimize portfolio | `python3 scripts/run_portfolio_optimization.py` |

---

## 7. EQUATION BACKTESTER (Simple)

**Location:** `python/scripts/run_backtest.py`

### Purpose

Tests discovered equations as simple long/flat equity signals with regime filtering.

### Command

```bash
python3 scripts/run_backtest.py \
    --features /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet \
    --math-results /Volumes/VelocityData/velocity_om/features/math_swarm_results.json \
    --regime-assignments /Volumes/VelocityData/velocity_om/features/regime_assignments.parquet \
    --skip-regimes 1 \
    --holding-period 5
```

### Output

| File | Location |
|------|----------|
| Backtest results | `/Volumes/VelocityData/velocity_om/features/backtest_results.json` |
| Equity curves | `/Volumes/VelocityData/velocity_om/features/equity_curves.parquet` |

---

## 8. TRADING PROFILES (6 Convexity Profiles)

**Location:** `python/engine/trading/profiles/`

### Profiles

| Profile | Strategy | Description |
|---------|----------|-------------|
| Profile 1 | Long-dated gamma | Long ATM straddle, 60-90 DTE |
| Profile 2 | Short-dated gamma | Short-term gamma, 7-14 DTE |
| Profile 3 | Charm | Time decay focused |
| Profile 4 | Vanna | Vol-spot correlation |
| Profile 5 | Skew | Vol surface plays |
| Profile 6 | Vol-of-vol | Second-order vol |
| Mission 1 | Combined mission | Multi-profile strategy |

**Note:** These are hand-designed profiles. The Structure Discovery system is meant to REPLACE these with data-driven discoveries.

---

## 9. DATA LOCATIONS

### Raw Data

| Data | Location | Size |
|------|----------|------|
| Options chain data | `/Volumes/VelocityData/velocity_om/massive/options/` | 394M rows |
| Stock minute data | `/Volumes/VelocityData/velocity_om/massive/stocks/` | Multi-year |
| VIX data | `/Volumes/VelocityData/velocity_om/massive/stocks/VXX/` | |

### Generated Features

| Data | Location |
|------|----------|
| Cross-asset features | `/Volumes/VelocityData/velocity_om/features/cross_asset_features.parquet` |
| Master features (daily) | `/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet` |
| MTF physics | `/Volumes/VelocityData/velocity_om/features/SPY_mtf_physics.parquet` |
| Options features | `/Volumes/VelocityData/velocity_om/massive/features/SPY_options_features.parquet` |

### Discovery Outputs

| Data | Location |
|------|----------|
| Scout results | `/Volumes/VelocityData/velocity_om/features/scout_swarm_results.json` |
| Math results | `/Volumes/VelocityData/velocity_om/features/math_swarm_results.json` |
| Jury results | `/Volumes/VelocityData/velocity_om/features/jury_swarm_results.json` |
| Regime assignments | `/Volumes/VelocityData/velocity_om/features/regime_assignments.parquet` |
| Backtest results | `/Volumes/VelocityData/velocity_om/features/backtest_results.json` |
| Equity curves | `/Volumes/VelocityData/velocity_om/features/equity_curves.parquet` |

### Structure Discovery Outputs

| Data | Location |
|------|----------|
| Payoff surfaces | `/Volumes/VelocityData/velocity_om/payoff_surfaces/` |
| Discovered structures | `/Volumes/VelocityData/velocity_om/discovered_structures/` |

### AI-Native Outputs

| Data | Location |
|------|----------|
| AI-native results | `/Volumes/VelocityData/velocity_om/ai_native_results/` |

---

## 10. COMPLETE PIPELINE COMMANDS

### Daily Feature Pipeline (2-3 minutes)

```bash
cd /Users/zstoc/GitHub/quant-engine/python

# Step 1: Pre-compute cross-asset (ONE TIME)
python3 scripts/precompute_cross_asset.py --start 2020-01-01 --end 2025-12-01

# Step 2: Generate features
python3 scripts/main_harvest.py --symbol SPY --start 2020-01-01 --end 2025-12-01 \
    --cross-asset-file /Volumes/VelocityData/velocity_om/features/cross_asset_features.parquet

# Step 3: Scout Swarm (feature selection)
python3 scripts/run_scout_swarm.py --input /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet

# Step 4: Math Swarm (equation discovery)
python3 scripts/run_math_swarm.py \
    --features /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet \
    --scout-results /Volumes/VelocityData/velocity_om/features/scout_swarm_results.json

# Step 5: Jury Swarm (regime classification)
python3 scripts/run_jury_swarm.py \
    --features /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet \
    --scout-results /Volumes/VelocityData/velocity_om/features/scout_swarm_results.json

# Step 6: Backtest equation
python3 scripts/run_backtest.py \
    --features /Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet \
    --math-results /Volumes/VelocityData/velocity_om/features/math_swarm_results.json \
    --regime-assignments /Volumes/VelocityData/velocity_om/features/regime_assignments.parquet
```

### Options Structure Discovery Pipeline

```bash
cd /Users/zstoc/GitHub/quant-engine/python

# Full pipeline with walk-forward validation
python3 scripts/run_structure_discovery.py --full --walk-forward --symbol SPY

# Or step by step:
# 1. Build payoff surface (one time)
python3 scripts/run_structure_discovery.py --build-surface --symbol SPY

# 2. Run discovery
python3 scripts/run_structure_discovery.py --discover --walk-forward --symbol SPY
```

### Multi-Timeframe Pipeline

```bash
cd /Users/zstoc/GitHub/quant-engine/python

# Generate MTF features (5min, 15min, 1H, 1D)
python3 scripts/main_harvest_mtf_physics.py --symbol SPY --start 2020-01-01 --end 2025-12-01 \
    --cross-asset-file /Volumes/VelocityData/velocity_om/features/cross_asset_features.parquet
```

---

## 11. WHAT'S ACTUALLY WORKING (Tested)

| Component | Status | Notes |
|-----------|--------|-------|
| Feature generation | ✅ Working | 496+ features in ~10s |
| MTF feature generation | ✅ Working | 1,291 features in ~2min |
| Scout Swarm | ✅ Working | Feature selection |
| Math Swarm | ✅ Working | PySR equation discovery |
| Jury Swarm | ✅ Working | Regime classification |
| Simple backtest | ✅ Working | Equity long/flat |
| Payoff surface builder | ✅ Working | Surface exists |
| Structure discovery GA | ⚠️ Ran once | Needs more testing |
| Sigma agent | ⚠️ Untested | Exists but not validated |
| Portfolio backtester | ⚠️ Untested | Exists but not validated |
| AI-native pipeline | ✅ Working | Full pipeline runs |

---

## 12. WHAT'S NOT BUILT / MISSING

| Component | Status | Notes |
|-----------|--------|-------|
| Live data feed | ❌ Missing | No real-time pipeline |
| Execution engine | ❌ Missing | No broker integration |
| Position management | ❌ Missing | No live position tracking |
| Walk-forward validation | ⚠️ Partial | Exists but needs testing |
| Out-of-sample testing | ⚠️ Partial | Run_backtest does in-sample only |

---

**This is the authoritative inventory. If something isn't here, it doesn't exist.**
