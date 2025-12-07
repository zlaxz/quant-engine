# Session Handoff

**Last Updated:** 2025-12-07
**Project:** quant-engine
**Status:** Major architecture evolution - Multi-layer swarm + Futures pivot

---

## This Session (Dec 7) - FLEET ARCHITECTURE + FUTURES PIVOT

### Big Picture Decisions

1. **Futures First** - Pivoting from options complexity to futures simplicity
   - ES/NQ for validation (simpler: price up/down, no Greeks)
   - MES for live forward testing ($50 risk per trade)
   - Options become "advanced mode" overlay once futures edge proven

2. **Autonomous Claude Fleet** - Zach building secret sauce for autonomous Claude operation
   - Removes human-in-the-loop constraint
   - Enables 24/7 operation

3. **Multi-Layer Swarm Architecture** - See FLEET ARCHITECTURE section below

### Actions Taken

- Created `MissionControl.tsx` - ADHD-friendly focus tracker in Observatory
- Created `mission_control` Supabase table for persistence
- Split Launchpad into Trading vs Discovery sections
- Created `JournalView.tsx` + `pipeline_journal` table for activity tracking
- Signed up for Databento (futures data)
- Created `download_futures_databento.py` (symbology needs fixing)
- Added `DATABENTO_API_KEY` to .env

### Files Created/Modified

```
src/components/observatory/MissionControl.tsx  (NEW)
src/components/observatory/JournalView.tsx     (NEW)
src/pages/Observatory.tsx                      (MissionControl added)
src/pages/Launchpad.tsx                        (Trading/Discovery split)
python/scripts/download_futures_databento.py   (NEW - needs symbology fix)
```

---

## FLEET ARCHITECTURE (The Vision)

### Hierarchy

```
LAYER 0: Zach (strategic direction)
         │
LAYER 1: 5 Claude Sessions (autonomous via secret sauce)
         │  - HUNTER: Opportunity detection
         │  - GUARDIAN: Risk/execution
         │  - ANALYST: Post-trade learning
         │  - ARBITER: Cross-validation
         │  - SYNTHESIS: Combines findings
         │
LAYER 2: 5 DeepSeek Captains per Claude = 25 total
         │  - Domain specialists within each Claude's focus
         │
LAYER 3: 5 DeepSeek Supervisors per Captain = 125 total
         │  - Timeframe or task specialists
         │
LAYER 4: 50 DeepSeek Workers per Supervisor = 6,250 total
            - Atomic task executors (scan, price, backtest)
```

### Math

```
5 Claude × 5 Captains × 5 Supervisors × 50 Workers = 6,250 parallel workers
```

### Communication

- Workers → Supervisors (aggregate results)
- Supervisors → Captains (synthesize findings)
- Captains → Claude (report to coordinator)
- Claude sessions → Fleet message bus (inter-Claude coordination)
- Synthesis Claude → combines all findings → reports to Zach

### Use Cases

| Scenario | How Fleet Handles It |
|----------|---------------------|
| Scan all options | HUNTER deploys 6,250 workers across chains |
| Validate trade thesis | ARBITER swarm attacks thesis from all angles |
| Monitor live positions | GUARDIAN swarm tracks Greeks in parallel |
| Learn from trades | ANALYST swarm runs micro-backtests on outcomes |
| 3am opportunity | System takes MES trade autonomously, you wake to data |

### Cost Estimate

DeepSeek at $0.14/M input, $0.28/M output:
- Full fleet scan (6,250 workers × 1500 tokens): ~$2-3
- Can run hundreds of scans daily for <$100

### Key Insight

The constraint isn't compute or cost - it's **how much edge can you extract before you ARE the market?**

---

## FUTURES PIVOT PLAN

### Why Futures First

| Options (current) | Futures (pivot target) |
|-------------------|----------------------|
| Strike selection | Just price |
| Expiration mgmt | Roll 4x/year |
| Greeks (δγθν...) | Linear P&L |
| Vol surfaces | N/A |
| Wide spreads | Tight spreads |
| Complex backtesting | Simple backtesting |

### Target Instruments

**Primary:**
- ES (E-mini S&P) - $50/point
- MES (Micro E-mini) - $5/point (for testing)
- NQ (E-mini NASDAQ)

**Secondary:**
- CL (Crude), GC (Gold), ZN (10yr Treasury)

### Validation Path

```
1. Backtest on historical (Databento data)
2. Forward test live (1 MES contract, $50 risk)
3. Scale: 5 MES → 1 ES → 5 ES
4. Add options overlay for vol harvesting
```

### Data Source

- **Databento** - signed up, API key in .env
- Need to fix symbol format (ES.FUT not working)
- Target: 2015-2024 data for ES, NQ, MES, major futures

---

## Previous Session Context

### Physics Engine Status
- Feature modules hardened (88+ bugs fixed)
- 56 tests passing
- MTF Physics: 1,291 features across 4 timeframes
- Scout/Math/Jury swarms operational

### JARVIS UI Status
- ✅ Complete pipeline wired
- Observatory with Orchestration, Foundation, Journal tabs
- MissionControl added for focus tracking

### Factor Strategy Engine
- Design complete (see `.claude/docs/FACTOR_STRATEGY_ENGINE.md`)
- Key decision: Regimes don't work → Factor-based approach
- Interleaved sampling: odd/even months 2020-2024

---

## For Next Session

### If Continuing Fleet Build
1. Zach is building autonomous Claude operation
2. Build on `~/.claude/scripts/team_orchestrator.py` pattern
3. Add layer for Claude→Claude coordination

### If Continuing Futures Pivot
1. Fix Databento symbology (check their docs for CME symbol format)
2. Download ES/NQ historical data
3. Build simple futures backtester
4. Adapt existing features for futures (remove options-specific)

### If Operating (Running Analysis)
→ Go to `operator/CLAUDE.md` for commands

---

## Key Documents

| Document | Purpose |
|----------|---------|
| `HANDOFF.md` | This file - session state |
| `operator/CLAUDE.md` | How to operate/run things |
| `.claude/CLAUDE.md` | Project config for building |
| `~/.claude/scripts/team_orchestrator.py` | DeepSeek swarm pattern |

---

**Focus: Fleet Architecture + Futures. Options become advanced mode.**
