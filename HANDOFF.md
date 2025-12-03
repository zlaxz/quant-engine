# Session Handoff - 2025-12-03

**From:** Dual-Engine Data Architecture Session
**To:** Next session
**Project:** quant-engine
**Status:** Dual-Engine data architecture complete - Massive (discovery) + ThetaData (execution)

---

## What's WORKING (Don't Break)
- **Build Compiles**: `npm run build` succeeds, TypeScript clean
- **Python API**: `/regimes`, `/discovery`, `/health` endpoints serving real data
- **Guardian UI Components**: All render without errors
- **Visualization Data Flow**: `DualPurposePanel.tsx` and `VisualizationContainer.tsx` fetch from Python API
- **DeepSeek Swarm Infrastructure**: `scripts/comprehensive_swarm_audit.py`, `scripts/repair_swarm.py`
- **React Performance**: BacktestRunner, QuantPanel, ActivityFeed have React.memo + useCallback

### NEW - Scribe & Gatekeeper Architecture
- **MemoryScribe** (`src/electron/services/MemoryScribe.ts`)
  - Watches Supabase for strategy/mission events via Realtime
  - Auto-documents to Obsidian when strategies graduate/fail
  - Auto-documents mission completions
  - Wired into main.ts app lifecycle

- **Gatekeeper** (daemon.py upgrades)
  - `conduct_post_mortem()` - DeepSeek analyzes failed strategies
  - `get_swarm_constraints()` - Retrieves lessons from causal_memories
  - Constraint injection into `replenish_pool()`
  - Post-mortem triggered on Red Team failure

### NEW - Failure Type Taxonomy
- `FailureType` enum with 11 standardized categories
- Supabase migration: `failure_type` column on causal_memories
- `failure_type_stats` view for aggregate analysis
- DeepSeek forced to classify every failure

### NEW - Live Data Bridge (The "Transmission")
- **ThetaData Integration** (`python/thetadata_client.py`)
  - Connects to locally-running Theta Terminal (Java-based)
  - Stocks + Options streaming (trades, quotes)
  - Full TradeTick/QuoteTick dataclasses with all fields
  - Auto-reconnection with subscription restoration
  - **Requires**: Theta Terminal running, ThetaData subscription

- **StreamBuffer** (`python/engine/trading/stream_buffer.py`)
  - Aggregates tick firehose into 1-min OHLCV bars
  - Maintains rolling 500-bar DataFrame window
  - VWAP calculation per bar
  - Cold start protection (50 bars min before trading)

- **ShadowTrader Integration**
  - Uses ThetaDataClient for live market data
  - `_tick_consumer` feeds ticks to MultiSymbolBuffer
  - `_on_new_bar()` triggers strategy execution when bars close
  - Dynamic strategy loading via `exec()` for live execution
  - Position sizing with risk management

### NEW - Dual-Engine Data Architecture
- **Engine A: Massive (The Map)** - Polygon.io historical data for DISCOVERY
  - Stock history, OHLCV, market-wide scans
  - `get_market_data` with `use_case: "discovery"`

- **Engine B: ThetaData (The Sniper)** - Live options for EXECUTION
  - Real-time Greeks including 2nd order (Vanna, Charm, Vomma, Veta)
  - `get_market_data` with `use_case: "execution"`
  - Requires Theta Terminal running locally

- **Unified DataRouter** (`python/engine/data/__init__.py`)
  - Intelligent routing based on asset_type and use_case
  - `get_data_router()` singleton pattern
  - REST client (`python/engine/data/theta_client.py`) for Greeks

- **Electron Tools**
  - `get_market_data` - Unified data access with auto-routing
  - `check_data_engines_status` - Shows both engines' availability

- **Python API Endpoints**
  - `POST /data/market` - Unified market data access
  - `GET /data/engines/status` - Engine status check

## What's BROKEN (Known Issues)
1. **Guardian UI is Display-Only** - No action buttons yet
2. **Execution Model Inconsistency**: Two slippage models in execution.py vs simulator.py
3. **3 npm vulnerabilities**: Run `npm audit fix`

## What Changed This Session
1. **Dual-Engine Data Architecture** - Complete implementation
   - `python/engine/data/theta_client.py` - ThetaData REST client with Greeks
   - `python/engine/data/__init__.py` - DataRouter with intelligent routing
   - `src/electron/tools/toolDefinitions.ts` - get_market_data, check_data_engines_status
   - `src/electron/tools/toolHandlers.ts` - Handler implementations
   - `python/server.py` - /data/market, /data/engines/status endpoints
   - `src/prompts/dataArchitectureContext.ts` - Updated for dual-engine
   - `.env.example` - Added ThetaData config variables

2. **ThetaData Auto-Launcher** - Theta Terminal starts with app
   - `src/electron/services/ThetaTerminalService.ts` - Auto-launches Java terminal
   - Credentials: `THETADATA_USERNAME`, `THETADATA_PASSWORD` in `.env`
   - JAR path: `/Users/zstoc/thetadata/ThetaTerminalv3.jar`
   - Ports: 25503 (v3 REST API), 25520 (WebSocket)
   - Auto-shutdown on app close
   - Health monitoring with auto-restart

3. **CIO Prompting Updates** - Dual-engine awareness across all prompts
   - `src/prompts/opsManual.ts` - Major update:
     - Dual-engine architecture section (Engine A vs Engine B)
     - Second-order Greeks interpretation guide (Vanna, Charm, Vomma, Veta)
     - ThetaData Terminal management + troubleshooting
     - Updated environment variables with ThetaData config
   - `src/prompts/cioIdentityCore.ts` - Major update:
     - Added "Data Philosophy" section with Sniper vs Map mindset
     - Updated "MY DIRECT POWERS" table with dual-engine tools
     - CIO now understands when to use each engine

4. **Pre-Flight Safety Fixes** - Critical live trading safety
   - `python/engine/trading/risk_manager.py` - NEW: Contract-aware position sizing
     - x100 multiplier for options (prevents blowing up account)
     - x50 multiplier for ES futures, x20 for NQ, etc.
     - MAX_CONTRACTS safety limits (50 options, 10 futures)
     - validate_order() for pre-submission checks
   - `python/engine/trading/stream_buffer.py` - Added warmup() method
     - Solves Cold Start problem (no more 50-min wait at market open)
     - warmup() injects historical bars instantly
     - get_warmup_requirement() for daemon integration
   - `python/server.py` - Added `/health/theta` endpoint
     - Explicit ThetaData Terminal health check
     - Returns status: online/offline/degraded
     - UI can now show RED indicator if Terminal down

## Next Actions (Priority Order)
1. **Make Guardian UI Actionable**
   - Add "Run White Noise Test" button to SystemIntegrity
   - Add "Launch Swarm" button to SwarmHiveMonitor
   - Add "Promote Strategy" buttons to GraduationTracker
   - Add "Send Directive" input to MissionControl

2. Wire buttons to actual Python endpoints or IPC handlers

3. **Start Theta Terminal** for live data testing
   - Download from ThetaData if not installed
   - Requires Java runtime

4. `npm audit fix` for vulnerabilities

5. Unify execution model (lower priority)

---

## Quick Start

```bash
npm run electron:dev          # Start app (Theta Terminal auto-launches!)
cd python && python server.py # Python server (port 5001)

# ThetaData auto-starts when app opens (configured in .env):
# - THETADATA_USERNAME=zstockco@gmail.com
# - THETADATA_PASSWORD=<stored in .env>
# - THETADATA_AUTO_LAUNCH=true
#
# Manual start if needed:
# java -jar /Users/zstoc/thetadata/ThetaTerminalv3.jar <user> <pass>
```

---

## Architecture Summary

The system now has a complete learning loop:
```
Swarm generates strategies
    ↓
Red Team tests them
    ↓
Gatekeeper learns from failures (conduct_post_mortem)
    ↓
Constraints injected into next generation (get_swarm_constraints)
    ↓
Scribe documents everything to Obsidian
    ↓
Live Data Bridge executes graduated strategies
```

---

**Last Updated:** 2025-12-03T20:00:00Z
