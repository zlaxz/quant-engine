# Quant-Engine - Claude Code Configuration

**Last Updated:** 2025-12-05
**Current Phase:** Physics Engine + JARVIS completion

---

## STOP - READ THIS FIRST

Before doing ANYTHING in this project:

1. **Read `HANDOFF.md`** in project root - session state
2. **Understand the focus** - Physics Engine + JARVIS only
3. **Check the prohibitions below** - things you must NOT do

If you skip this, you WILL add noise that confuses future sessions.

---

## Current Focus (December 2025)

### What We're Building
1. **Factor Strategy Engine** - Factor-based trading (NOT regime-based)
2. **Market Physics Engine** - Discover causal market mechanics
3. **JARVIS UI** - Observatory displaying Claude Code activity

### What Phase We're In
- **Factor Strategy Engine**: Design complete, implementation starting
- Physics Engine: Feature modules hardened, discovery swarms ready
- JARVIS: ✅ Complete - full pipeline wired and working

### What's Next
1. Build Factor Strategy Engine modules (see `.claude/docs/FACTOR_STRATEGY_ENGINE.md`)
2. Implement interleaved sampling (odd/even months 2020-2024, WF=2025)
3. Run Scout/Math Swarm on discovery set only

### Key Decision (2025-12-06)
**Regimes don't work** - each year is too unique. Pivoted to **factor-based** approach:
- Continuous signals, not discrete buckets
- 1-3 day hold periods (eventually intraday)
- Three-set validation: Discovery/Validation/Walk-Forward

---

## PROHIBITIONS (Do NOT)

These are constitutional - violating them creates noise:

| DO NOT | WHY |
|--------|-----|
| Add trading strategies to `python/engine/trading/` | Focus is physics engine, not strategies |
| Build Gemini CIO chat features | JARVIS superseded this architecture |
| Create UI components without JARVIS events | UI is observatory, not interactive IDE |
| Use "Research IDE" framing | We pivoted to JARVIS observatory |
| Ignore HANDOFF.md | It has current session state |

### Noise That Already Exists (Ignore These)
```
python/engine/trading/mean_reversion.py      # NOISE
python/engine/trading/gamma_scalping.py      # NOISE
python/engine/trading/gamma_flip.py          # NOISE
python/engine/trading/volatility_harvesting.py  # NOISE
python/engine/trading/regime_playbook.py     # NOISE
```

---

## Architecture Summary

### The Pivot (Why Things Are This Way)
Zach realized all work happens in Claude Code terminal, not Electron chat. So:
- **Before:** Research IDE with Gemini CIO chat interface
- **After:** JARVIS Observatory displaying Claude Code activity

### How JARVIS Works
```
Claude Code (you) ─── does the work
        │
        ▼ emit events
Python emit_ui_event() → JSON file
        │
        ▼
ClaudeCodeResultWatcher → IPC 'jarvis-event'
        │
        ▼
React UI ─── displays your activity
```

### Key Locations
| What | Where |
|------|-------|
| Physics Engine | `python/engine/features/`, `python/engine/discovery/` |
| JARVIS bridge | `python/engine/ui_bridge.py` |
| JARVIS hook | `src/hooks/useJarvisEvents.ts` |
| JARVIS app | `/Applications/Quant Chat Workbench.app` |
| JARVIS docs | `operator/CLAUDE.md` → JARVIS UI INTEGRATION |
| Session state | `HANDOFF.md` |

---

## Authoritative Documents

| Document | Purpose | Location |
|----------|---------|----------|
| **Operator Manual** | How to RUN things | `operator/CLAUDE.md` |
| **Runbooks** | Step-by-step procedures | `operator/RUNBOOKS.md` |
| Start Here | Entry point | Obsidian: `00-START-HERE.md` |
| Physics Engine | Core architecture | Obsidian: `01-Architecture/MARKET-PHYSICS-ENGINE.md` |
| JARVIS UI | Observatory architecture | Obsidian: `01-Architecture/JARVIS-UI-ARCHITECTURE.md` |
| Decisions | Why things are this way | Obsidian: `DECISIONS.md` |
| Session State | Current state | `HANDOFF.md` in project root |

**If you're here to OPERATE (not build), go straight to `operator/CLAUDE.md`**

---

## Session Workflow

### Start
1. Read this file (you're doing that now)
2. Read `HANDOFF.md` for session state
3. Confirm you understand the focus before proceeding

### During
- Stay focused on Physics Engine OR JARVIS
- Emit UI events with `emit_ui_event()` so JARVIS displays activity
- Update HANDOFF.md if you make progress

### End
- Update `HANDOFF.md` with what changed
- Update Obsidian if architectural decisions made

---

## Memory Systems

### Obsidian (Authoritative)
```python
mcp__obsidian__read_note("Projects/quant-engine/00-START-HERE.md")
```

### Supabase (Dev Context)
```bash
memory_recall "quant-engine: [topic]"
```

---

## SPECIALIZED AGENTS (MANDATORY)

**This project has 9 specialized agents. You MUST use them.**

### Quality Gate Agents (REQUIRED before trusting results)

| Agent | Trigger | Purpose |
|-------|---------|---------|
| `quant-code-review` | After writing quant code | Catch calculation errors, look-ahead bias |
| `backtest-bias-auditor` | After any backtest | Hunt temporal violations, data snooping |
| `overfitting-detector` | Sharpe > 2.5 or "too good" | Validate robustness, detect curve-fitting |
| `statistical-validator` | After performance metrics | Test significance, multiple testing corrections |
| `strategy-logic-auditor` | Before deployment | Red-team implementation, find bugs |
| `transaction-cost-validator` | Before trusting returns | Reality-check execution costs |

### Architecture Agents

| Agent | Trigger | Purpose |
|-------|---------|---------|
| `quant-architect` | Design decisions, orchestration | System architecture, quality gates |
| `quant-repair` | After audit finds issues | Fix infrastructure bugs |

### Builder Agent

| Agent | Trigger | Purpose |
|-------|---------|---------|
| `trade-simulator-builder` | Building execution simulator | Options trade modeling |

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

---

## If You're Confused

1. Re-read the PROHIBITIONS section
2. Re-read the SPECIALIZED AGENTS section
3. Check Obsidian `08-Learnings/2025-12-05-architecture-pivot.md`
4. Ask Zach before doing something that might be noise

---

**Focus: Factor Strategy Engine + Physics Engine. Use the agents.**
