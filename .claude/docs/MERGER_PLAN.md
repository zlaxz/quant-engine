# Quant Engine Merger Plan

**Created:** 2025-11-29
**Status:** APPROVED
**Scope:** Merge quant-chat-scaffold + rotation-engine into unified **quant-engine**
**Rename:** quant-chat-scaffold → quant-engine

---

## Executive Summary

Merge two projects into a unified AI-powered quantitative discovery and backtesting engine:

| Project | Role | Status |
|---------|------|--------|
| quant-chat-scaffold | AI/UI layer (Electron + React) | Working |
| rotation-engine | Quant engine (Python backtesting) | Production-ready |

**Discovery:** Integration is already 60% complete. The cli_wrapper.py, bridge_server.py, and pythonExecution.ts form an existing communication layer. The api_contract.md defines the data formats. What's missing is the UI visualizations and tighter AI orchestration.

---

## Architecture Decision: Keep Separate Repos

**Recommendation: Maintain two repos, connected via environment variable**

### Why NOT Monorepo
1. rotation-engine is already public on GitHub (github.com/zlaxz/rotation-engine)
2. Python and Node/TypeScript have very different toolchains
3. The CLI interface (`cli_wrapper.py --profile X --start Y --end Z`) is clean
4. Monorepo would require complex build orchestration

### Current Architecture (Keep This)
```
~/github/quant-chat-scaffold/     # Electron + React UI
    ↓ ROTATION_ENGINE_ROOT env var
~/rotation-engine/                 # Python quant engine
```

**Connection Method:** Direct subprocess execution via `pythonExecution.ts`

---

## What Already Exists

### Communication Layer (Working)
```
Gemini 3 → toolHandlers.ts → spawn('python3', ['cli_wrapper.py', ...])
                                    ↓
                            rotation-engine Python
                                    ↓
                            JSON stdout → Electron IPC
```

### API Contract (Defined in rotation-engine/api_contract.md)
| Endpoint | Purpose | Status |
|----------|---------|--------|
| `/api/regimes` | Regime heatmap | Implemented (regime_engine.py) |
| `/api/strategies/{id}` | Strategy card | Schema defined |
| `/api/discovery/matrix` | Coverage matrix | Schema defined |
| `/api/explain/trade/{id}` | Trade explanation | Schema defined |
| `/api/portfolio/greeks` | Greeks dashboard | Schema defined |
| `/api/simulate/scenario` | What-if engine | Schema defined |

### Python Modules Ready
- `src/analysis/regime_engine.py` - `generate_api_response()` returns UI-ready JSON
- `src/api/routes.py` - QuantOSAPI class with `get_regime_heatmap()`
- `rotation-engine-bridge/cli_wrapper.py` - CLI interface (stub + real modes)

---

## What's Missing

### 1. UI Visualizations (Priority: HIGH)
The React components to display rotation-engine data:

| Component | Data Source | Complexity |
|-----------|-------------|------------|
| RegimeHeatmap | `/api/regimes` | Medium |
| StrategyCard | `/api/strategies` | Low |
| DiscoveryMatrix | `/api/discovery/matrix` | Medium |
| TradeExplainer | `/api/explain/trade` | Medium |
| GreeksCockpit | `/api/portfolio/greeks` | Low |
| ScenarioSimulator | `/api/simulate/scenario` | High |

### 2. CLI Wrapper Enhancement (Priority: HIGH)
Current `cli_wrapper.py` only supports backtest. Need to add:
```bash
# Current
python cli_wrapper.py --profile X --start Y --end Z --capital N

# Need to add
python cli_wrapper.py --action regimes --start Y --end Z
python cli_wrapper.py --action strategy --id X
python cli_wrapper.py --action explain --trade-id X
python cli_wrapper.py --action greeks
python cli_wrapper.py --action simulate --scenario {...}
```

### 3. Tool Definitions (Priority: MEDIUM)
Add Gemini tools for each API endpoint:
- `get_regime_heatmap(start_date, end_date)`
- `get_strategy_card(strategy_id)`
- `explain_trade(trade_id)`
- `get_portfolio_greeks()`
- `run_scenario(price_change, vol_change, days)`

### 4. AI Orchestration (Priority: HIGH)
Chief Quant needs workflow prompts:
- "Analyze current regime and recommend strategy"
- "Run discovery sweep across all profiles"
- "Explain why this trade lost money"
- "What happens if VIX spikes 20%?"

---

## Implementation Phases

### Phase 1: CLI Unification (1-2 sessions)
**Goal:** Single CLI entry point for all rotation-engine operations

1. Extend `cli_wrapper.py` with `--action` parameter
2. Add handlers for each API endpoint
3. Test each endpoint returns valid JSON
4. Update `pythonExecution.ts` to route actions

**Deliverables:**
- [ ] `cli_wrapper.py --action regimes` working
- [ ] `cli_wrapper.py --action strategy` working
- [ ] `cli_wrapper.py --action greeks` working

### Phase 2: Tool Integration (1-2 sessions)
**Goal:** Gemini can call rotation-engine APIs

1. Add tool definitions to `toolDefinitions.ts`
2. Add handlers to `toolHandlers.ts`
3. Update prompts to teach Gemini about new tools
4. Test multi-turn conversations using tools

**Deliverables:**
- [ ] `get_regime_heatmap` tool working
- [ ] `get_strategy_performance` tool working
- [ ] Chief Quant can describe current market regime

### Phase 3: Visualization Components (2-3 sessions)
**Goal:** UI displays rotation-engine data

1. Create `RegimeHeatmap.tsx` component
2. Create `StrategyCard.tsx` component
3. Create `DiscoveryMatrix.tsx` component
4. Add routing/panels to display components
5. Connect to IPC handlers

**Deliverables:**
- [ ] Regime heatmap calendar view
- [ ] Strategy cards with sparklines
- [ ] Discovery matrix grid

### Phase 4: AI Discovery Workflows (2-3 sessions)
**Goal:** Chief Quant orchestrates end-to-end research

1. Create workflow prompts for discovery patterns
2. Add memory persistence for research findings
3. Implement "research session" tracking
4. Add report generation

**Deliverables:**
- [ ] "Discovery sweep" workflow
- [ ] "Regime analysis" workflow
- [ ] Research findings persisted to memory
- [ ] Exportable reports

---

## File Changes Summary

### quant-chat-scaffold
```
src/electron/tools/toolDefinitions.ts   # Add quant tools
src/electron/tools/toolHandlers.ts      # Add quant handlers
src/electron/ipc-handlers/pythonExecution.ts  # Extend for actions
src/components/quant/                   # New folder
    RegimeHeatmap.tsx
    StrategyCard.tsx
    DiscoveryMatrix.tsx
    GreeksCockpit.tsx
    ScenarioSimulator.tsx
src/prompts/                            # Extend with workflows
    discoveryWorkflow.ts
    regimeAnalysis.ts
```

### rotation-engine
```
rotation-engine-bridge/cli_wrapper.py   # Extend with --action
src/api/routes.py                       # Add all endpoint handlers
src/api/strategy_api.py                 # New: strategy card generation
src/api/discovery_api.py                # New: discovery matrix
src/api/explain_api.py                  # New: trade explanation
src/api/greeks_api.py                   # New: portfolio Greeks
```

---

## Success Criteria

1. **AI can describe market regime** - Gemini explains "We're in BULL_QUIET with VIX at 15"
2. **AI can run backtests** - Already working
3. **AI can recommend strategies** - "Profile 2 performs best in this regime"
4. **UI shows live data** - Heatmap, cards, matrices populated from engine
5. **Research persists** - Findings saved to memory, retrievable next session

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Python/Node compatibility | Keep subprocess model, clean JSON interface |
| Performance (large data) | Paginate API responses, use streaming for long ops |
| Development coordination | Use SESSION_STATE.md in both repos |
| Data file paths | ROTATION_ENGINE_ROOT handles all path resolution |

---

## Decisions Made

1. **Naming:** Rename to **quant-engine** (reflects unified engine concept)
2. **Communication:** Keep **both** models - subprocess for Electron, HTTP bridge for external tools
3. **Visualization library:** Use Recharts (already installed) - evaluate D3 if needed for complex heatmaps
4. **Real mode vs stub:** Switch to real after Phase 1 CLI unification is complete

---

## Next Action

Approve this plan, then begin **Phase 1: CLI Unification** in rotation-engine.
