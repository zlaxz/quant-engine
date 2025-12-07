# Quant Engine UX Design Specification

**Synthesized from 5-Agent Design Team Debate**
**Date:** December 6, 2025

---

## 1. Core Philosophy

### The Two-Mode Distinction (CONSTITUTIONAL)

| Mode | UX Philosophy | Feel | Forbidden |
|------|---------------|------|-----------|
| **Discovery** | Narrative-driven exploration | Video game | Points, levels, XP, "unlocking" |
| **Trading** | Crystal clarity + safety | Airplane cockpit | Any decoration, storytelling, gamification |

> "The difference between these two modes should feel like the difference between a video game and an airplane cockpit. There is no ambiguity." - Alex (UX Lead)

### ADHD-Friendly Principles

1. **External Memory**: The UI remembers so the user doesn't have to
2. **Zero-Friction Navigation**: Cmd+K command palette for everything
3. **Visible State**: Always show what's happening, no hidden modes
4. **Interruption Survival**: Can leave and return without losing context
5. **Minimal Decision Fatigue**: Smart defaults, few choices

---

## 2. Discovery Mode (Narrative-Driven Research)

### Screen Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Status Bar: "Exploring: SPY Gamma Patterns"  [Now] [Next] [?]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────┐  ┌───────────────────────────────┐│
│  │ CLAUDE'S NARRATIVE      │  │ MARKET PHYSICS CANVAS         ││
│  │                         │  │                               ││
│  │ "Let's see what happens │  │  [Interactive Visualization]  ││
│  │ when we look at gamma   │  │                               ││
│  │ exposure during         │  │  Drag price → See hedging     ││
│  │ earnings..."            │  │  flow react in real-time      ││
│  │                         │  │                               ││
│  │ [Historian] [Physicist] │  │  "Click Apply News Shock"     ││
│  │ [Detective] personas    │  │                               ││
│  └─────────────────────────┘  └───────────────────────────────┘│
│                                                                 │
│  ┌─────────────────────────┐  ┌───────────────────────────────┐│
│  │ DISCOVERY JOURNAL       │  │ CHARACTER SHEET: SPY          ││
│  │                         │  │                               ││
│  │ - You discovered that   │  │ Dealer Gamma: +$2.3B          ││
│  │   positive gamma means  │  │ → "Market Shock Absorber"     ││
│  │   price stabilization   │  │ → Dealers buy dips, sell      ││
│  │                         │  │   rallies (stabilizing)       ││
│  │ - Session 3 connection: │  │                               ││
│  │   This explains the     │  │ [Why This Matters]            ││
│  │   March 2020 event...   │  │ High gamma = slow moves       ││
│  └─────────────────────────┘  └───────────────────────────────┘│
│                                                                 │
│  [Trail of Breadcrumbs: AI Stocks → Semiconductors → SPY]      │
└─────────────────────────────────────────────────────────────────┘
```

### Claude's Narrative Personas

| Persona | Use Case | Example |
|---------|----------|---------|
| **The Historian** | Past pattern context | "This pattern last appeared during the 2020 volatility spike..." |
| **The Physicist** | Market mechanics | "Think of gamma exposure like pressure building in a system..." |
| **The Detective** | Pattern connections | "Notice how these three anomalies might be connected..." |

### Narrative Rules (Blake's Non-Negotiables)

1. No points, levels, or explicit progression tracking
2. No "quests" or "missions" - only exploration paths
3. No gamified rewards - the insight IS the reward
4. Narrative emerges from actual data, not predetermined stories
5. Claude is research partner, not game master

### Educational Layer (Two-Click Rule)

**Level 1 (Default):** Intuitive label + visual metaphor
- Gamma → "Market Shock Absorber" 📉➡️📈

**Level 2 (Hover):** Simple mechanism
- "Dealers with positive gamma hedge by buying low and selling high"

**Level 3 (Click "Details"):** Actual formula
- `Γ = ∂²V/∂S²`

### Greek Translations (Dana)

| Greek | Plain English | Visual |
|-------|---------------|--------|
| Delta | "Stock Sensitivity" | Speedometer needle |
| Gamma | "Acceleration Risk" | Pressure gauge |
| Theta | "Time Drain" | Dripping hourglass |
| Vega | "Volatility Bet" | Storm cloud |

---

## 3. Trading Mode (Clear & Crisp Execution)

### Screen Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚪ LIVE │ System: READY │ [KILL ALL] │ [CANCEL & FLATTEN] │ $125k│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ POSITIONS                                                  │ │
│  │                                                            │ │
│  │ Symbol │ Size │ Entry │ P&L    │ Why           │ Risk │Act│ │
│  │ ───────────────────────────────────────────────────────── │ │
│  │ AAPL   │ +100 │$178.50│ +$234  │ Momentum play │ ██░░ │ X │ │
│  │ SPY    │ +5C  │ $2.50 │ -$89   │ Gamma hedge   │ ███░ │ X │ │
│  │ TSLA   │ -3P  │ $8.20 │ +$156  │ Vol harvest   │ █░░░ │ X │ │
│  │                                                            │ │
│  │ [Risk bars: Green=safe, Yellow=watch, Red=danger]         │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─────────────────────────┐  ┌───────────────────────────────┐│
│  │ SYSTEM ACTIVITY LOG     │  │ RISK DASHBOARD                ││
│  │                         │  │                               ││
│  │ 10:15:23 SELL filled    │  │ Portfolio Concentration       ││
│  │   100 AAPL @ $182.45    │  │ ┌──────────────────────────┐ ││
│  │                         │  │ │ AAPL ████████            │ ││
│  │ 10:15:20 Stop triggered │  │ │ SPY  ████                │ ││
│  │   AAPL @ $178.00        │  │ │ TSLA ███                 │ ││
│  │                         │  │ └──────────────────────────┘ ││
│  │ [Filter: Orders│Errors] │  │                               ││
│  │                         │  │ Daily P&L at Risk: $1,240    ││
│  └─────────────────────────┘  └───────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Command & Control Header (Always Visible)

| Component | Purpose | Behavior |
|-----------|---------|----------|
| Live/Paper Toggle | Mode indicator | Prominent, never hidden |
| System Status | Connection health | Green/Yellow/Red |
| **KILL ALL** | Emergency stop | Red, press-and-hold OR type "KILL" to confirm |
| **CANCEL & FLATTEN** | Interrupt trading | Yellow, one-click with undo |
| Account Equity | Portfolio value | Always current |

### Position Table Requirements (Casey)

Every position row MUST show:
1. **WHAT**: Ticker, Size, Entry Price, Current P&L ($ and %)
2. **WHY**: One-line strategy tag (e.g., "Momentum Breakout (Entered 10:05)")
3. **RISK**: Visual bar showing distance to stop-loss
4. **ACTION**: "Close" and "Manage" buttons

### Kill Switch System

**Primary Kill Switch:**
1. Large, red button in header
2. Press → "This will market sell ALL positions. Confirm?"
3. Type "KILL" to execute
4. Action logged and visually confirmed

**Per-Strategy Kill:**
- Each running strategy has its own "STOP STRATEGY" button

### Interruptibility

- Any order entry: 1.5-second "Confirm/Cancel" hold before sending
- Automated actions show "PAUSE AUTO" button (10-second pause window)
- Any pending order: "Cancel" button visible in Activity Log

### Crisis Visualization

- Portfolio drawdown > threshold: Entire UI border pulses red
- Position hits stop: Tile flashes red, logged in red in Activity Log

---

## 4. JARVIS Communication Protocol

### Event Types

```python
# Progress & Status
emit_ui_event(
    activity_type="data_loading",
    message="Loading SPY options chain...",
    progress=50
)

# Force Analysis
ui_gamma_analysis("SPY", {
    "dealer_gamma": 0.72,
    "customer_gamma": -0.45,
    "mm_hedge": 0.33,
    "vol_demand": -0.18
})

# Regime Detection
ui_regime_detected("volatile_bearish", 0.87, {...})

# Backtest Results
ui_backtest_complete(sharpe=1.85, total_return=0.234, max_dd=-0.12)

# Tables, Charts, Payoffs
ui_table(...), ui_heatmap(...), ui_payoff(...)
```

### Event Priority

| Priority | Type | Latency Target |
|----------|------|----------------|
| Critical | Kill switch, errors | <10ms |
| High | Position updates, orders | <50ms |
| Medium | Chart updates, analytics | <100ms |
| Low | Educational content | <500ms |

### Real-Time Architecture (Eli)

```
Current: Python → JSON file → Watcher → React (100-200ms latency)
Proposed: Python → WebSocket → React (direct, <50ms)
```

---

## 5. Educational Layer

### "Why This Matters" Corner (Dynamic)

A dedicated, small UI zone that contextually updates:

**In Discovery:**
> "Why this matters: High positive gamma below current price means dealers will likely **slow down** a sell-off here."

**In Trading:**
> "Why this position exists: You're short gamma. This means you need to **hedge frequently** if the market moves."

### Visual Metaphor Library

| Concept | Metaphor | Visual |
|---------|----------|--------|
| Gamma Exposure | Car suspension | Stiff = stabilizing, Loose = volatile |
| Term Structure | Geological layers | Time stacked visually |
| Dealer Positioning | Ocean currents | Flow arrows showing pressure |
| Volatility Surface | Topographic map | 3D terrain of expectations |

### Market Physics Playground (First Session)

Interactive sandbox with SPY data:
1. Drag price line → See dealer hedging flow react
2. Click "Apply News Shock" → Watch gamma wall hold or break
3. Learn by feeling, then naming the concept

---

## 6. Technical Implementation

### What's Buildable Now (Eli's Reality Check)

| Feature | Status | Timeline |
|---------|--------|----------|
| 4-monitor dashboard | Works | Now |
| Real-time chart updates | Works (50ms) | Now |
| JARVIS event pipeline | Works | Now |
| Multi-window Electron | Works | Now |
| Window state persistence | Needs work | 2 weeks |
| WebSocket event pipeline | Enhancement | 2 weeks |
| Pre-baked narrative branches | Doable | 4 weeks |

### What's NOT Buildable Soon

| Feature | Reality | Alternative |
|---------|---------|-------------|
| AI layout suggestions | 6+ months | Pre-defined templates |
| Voice control everything | Performance killer | Keyboard shortcuts |
| Real-time AI narratives | 500ms+ latency | Rule-based triggers |
| Predictive view loading | Reactive only | Pre-load common views |

### Performance Budget

- Each window: Render under 16ms (60fps)
- Market data updates: Throttle to 10Hz max per window
- React.memo + useMemo aggressively

---

## 7. Resolved Debates

### Discovery vs Trading Boundary

**Decision:** Hard modal boundary with sensory gate.

Switching modes triggers:
1. Brief calming animation (psychological airlock)
2. Distinct sound cue
3. Mute non-essential notifications
4. Optional focus timer appears

### Gamification in Discovery

**Decision:** NO explicit gamification.

Instead of:
- "Quest complete! +50 XP!"
- "Level up! You've unlocked Gamma Module!"

Use:
- "You've discovered..." (insight-focused)
- Discovery Journal showing understanding growth
- Insights collected, not badges earned

### Kill Switch Design

**Decision:** Two-step confirmation + physical typing.

1. Press KILL ALL button
2. Modal: "This will market sell ALL positions"
3. Type "KILL" to confirm
4. Visual + audio confirmation of execution

### External Memory Implementation

**Decision:** Automatic, invisible state saving.

- Never require manual "save"
- Continuous background persistence
- "What Was I Doing?" recovery (Cmd+?)
- Timeline of last N interactions

---

## 8. Open Questions for Zach

1. **Monitor Layout Preference**: Do you want saved layout presets (F1-F4) or fully manual window management?

2. **Audio Cues**: Should mode switching and critical alerts have sound? What style?

3. **Discovery Journal Storage**: Obsidian integration for notes, or in-app only?

4. **Risk Thresholds**: Default values for crisis visualization (e.g., -5% daily P&L triggers red border)?

5. **Narrative Depth**: How much Claude narration in Discovery? Always on, or triggered by "Explain this"?

6. **Paper Trading First**: Should Trading Mode start paper-only with explicit "Go Live" graduation?

---

## Appendix: Component Mapping

### Existing Components to Keep

- `RegimeDisplay.tsx` → Both modes
- `SwarmHiveMonitor.tsx` → Discovery mode
- `MissionMonitor.tsx` → Rename to SystemMonitor
- All `src/components/ui/` → Keep

### New Components Needed

**Discovery Mode:**
- `DiscoveryNarrative.tsx` - Claude's story panel
- `DiscoveryJournal.tsx` - Insight collection
- `MarketPhysicsCanvas.tsx` - Interactive visualization
- `CharacterSheet.tsx` - Asset profile with history

**Trading Mode:**
- `CommandControlHeader.tsx` - Always-visible status + kill switches
- `PositionTable.tsx` - With Why column and risk bars
- `SystemActivityLog.tsx` - Filterable event stream
- `RiskDashboard.tsx` - Concentration + P&L at risk

**Shared:**
- `StatusBar.tsx` - Now/Next/Recovery
- `ModeTransition.tsx` - Sensory gate animation
- `ContextualEducation.tsx` - Two-click progressive disclosure

---

*Specification synthesized from 5-agent debate. Ready for implementation.*
