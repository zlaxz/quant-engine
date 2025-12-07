# Quant Engine UX Design Specification

**Version:** 1.0  
**Date:** 2025-12-06  
**Status:** Draft for Review

---

## 1. Core Philosophy

### Two-Mode System Architecture

The application operates in two fundamentally distinct modes that feel different, serve different purposes, and require different mental models:

| Aspect | Discovery Mode | Trading Mode |
|--------|----------------|--------------|
| **Purpose** | Learn, explore, understand | Execute, monitor, protect |
| **Tone** | Narrative, educational, exploratory | Factual, precise, serious |
| **Risk** | None (sandbox) | Real money at stake |
| **Interaction** | Choose paths, dive deeper | Monitor, confirm, kill |
| **Complexity** | Progressive disclosure | Essential data always visible |
| **Claude's Role** | Guide/narrator | Reporter/watchdog |

**Mode Switching:** Explicit, deliberate transition with visual confirmation. No accidental switches.

### ADHD-Friendly Design Principles

1. **Visual Primacy**: Show > Tell. Charts/diagrams > Text walls.
2. **Status at a Glance**: Critical information always visible, never hidden.
3. **Initiation Friction Reduction**: Clear starting points, no blank canvas paralysis.
4. **Dopamine-Driven Progression**: Discovery tells a story with milestones, not rigid game mechanics.
5. **External Context Storage**: UI remembers context so user doesn't have to ("character sheets").
6. **Just-in-Time Learning**: Explain when relevant, not upfront.
7. **Seamless, Not Overcomplicated**: Hide complexity behind progressive disclosure.

### JARVIS Observatory Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Claude Code (Terminal) - THE ACTUAL WORK HAPPENS HERE      │
│                                                             │
│ • Running physics engine                                   │
│ • Executing swarms                                         │
│ • Analyzing data                                           │
│                                                             │
│ emit_ui_event() ──────────────────────────────┐           │
└───────────────────────────────────────────────┼───────────┘
                                                 │
                                                 ▼
                        ┌────────────────────────────────────┐
                        │ JSON Event Files                   │
                        │ /tmp/claude-code-results/          │
                        └────────────────────────────────────┘
                                                 │
                                                 ▼
                        ┌────────────────────────────────────┐
                        │ ClaudeCodeResultWatcher            │
                        │ (File system watcher)              │
                        └────────────────────────────────────┘
                                                 │
                                                 ▼ IPC: 'jarvis-event'
                        ┌────────────────────────────────────┐
                        │ React UI (Observatory)             │
                        │                                    │
                        │ • Displays Claude's activity       │
                        │ • Visualizes discoveries           │
                        │ • Shows live trading state         │
                        └────────────────────────────────────┘
```

**Key Principle**: The UI is a **display**, not a controller. Claude does the work, UI shows what's happening.

---

## 2. Discovery Mode (Narrative-Driven Research)

### Screen Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ [Discovery Mode]              Quant Engine            [?] [≡] [×]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ NARRATIVE PANEL                                            │   │
│  │ ──────────────────────────────────────────────────────────│   │
│  │                                                            │   │
│  │ Claude: "We're analyzing SPY's gamma exposure. I've       │   │
│  │ identified an unusual pattern—dealer gamma is positive    │   │
│  │ but customer gamma is deeply negative. This creates a     │   │
│  │ 'spring-loaded' market structure."                        │   │
│  │                                                            │   │
│  │ [💡 What does this mean?] [🔬 Show me the math]          │   │
│  │ [📊 Visualize the pattern] [➡️ What happens next?]       │   │
│  │                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐   │
│  │ VISUALIZATION            │  │ ASSET CHARACTER SHEET        │   │
│  │                          │  │ ────────────────────────────│   │
│  │  [Interactive chart/     │  │ SPY (S&P 500 ETF)           │   │
│  │   diagram based on       │  │                              │   │
│  │   current discovery]     │  │ Current Regime: Volatile     │   │
│  │                          │  │ Dealer Gamma: +0.72          │   │
│  │                          │  │ Customer Gamma: -0.45        │   │
│  │                          │  │ IV Rank: 68th %ile           │   │
│  │                          │  │                              │   │
│  │                          │  │ Recent Discoveries:          │   │
│  │                          │  │ • Gamma flip detected        │   │
│  │                          │  │ • Vol demand spike           │   │
│  │                          │  │                              │   │
│  └──────────────────────────┘  └──────────────────────────────┘   │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ DISCOVERY TRAIL (Breadcrumbs)                              │   │
│  │ Start → Feature Engineering → Gamma Analysis → Pattern → ? │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Components

#### Narrative Panel
- **Purpose**: Claude narrates what's happening in plain language
- **Interaction**: User clicks buttons to direct exploration
- **Props**:
  - `currentNarrative: string` - Claude's current message
  - `actionButtons: ActionButton[]` - User choices
  - `educationalContent?: EducationalCard` - On-demand explanations

**Button Types:**
- 💡 **Explain** - "What does this mean?" → Simple educational popup
- 🔬 **Deep Dive** - "Show me the math" → Progressive disclosure of technical detail
- 📊 **Visualize** - "Show me visually" → Switch/add visualization
- ➡️ **Continue** - "What happens next?" → Advance narrative
- 🔀 **Branch** - "Explore something else" → Choose different path

#### Visualization Panel
- **Purpose**: Show data/patterns visually
- **Types**:
  - Gamma exposure charts (bar, waterfall)
  - Correlation heatmaps
  - Regime state diagrams
  - Payoff surface 3D plots
  - Force vector diagrams
- **Props**:
  - `vizType: 'chart' | 'heatmap' | 'diagram' | 'surface' | ...`
  - `data: any` - Passed from JARVIS event
  - `interactive: boolean` - Can user click/explore?

#### Asset Character Sheet
- **Purpose**: External memory—stores context so user doesn't have to remember
- **Content**:
  - Asset identity (symbol, name, sector)
  - Current state (regime, key metrics)
  - Recent discoveries (timeline of findings)
  - "Why we're looking at this" note
- **Persistence**: Saved to localStorage, survives session
- **Props**:
  - `symbol: string`
  - `currentState: AssetState`
  - `discoveries: Discovery[]`

#### Discovery Trail (Breadcrumbs)
- **Purpose**: Show where you've been, reduce "where am I?" confusion
- **Interaction**: Click to jump back to earlier step
- **Props**:
  - `steps: Step[]`
  - `currentStep: number`

### How Claude Narrates Discoveries

**Good Narrative Examples:**

```
"We just ran the Scout Swarm on SPY. Out of 47 features, the swarm 
identified 6 that show strong predictive power for next-day returns. 
Let me show you the top 3..."

[Visualization appears]

"Notice how dealer gamma and put-call imbalance cluster together? 
They're capturing the same underlying force—dealer hedging behavior."

[Buttons: 💡 What's dealer hedging? | 📊 Show clustering | ➡️ What's next?]
```

**Bad Narrative Examples:**
```
❌ "Analysis complete. 6 features selected. Proceed to next phase?"
   (Too robotic, no story)

❌ "Congratulations! You've unlocked the Gamma Exposure achievement!"
   (Game mechanics—this isn't a game)

❌ "The mathematical formulation indicates a statistically significant..."
   (Text wall without progressive disclosure)
```

### Narrative "Story Beats"

1. **Setup** - "We're about to analyze X because Y"
2. **Action** - "Running analysis... [progress indication]"
3. **Discovery** - "Here's what we found: [key insight]"
4. **Explanation** - "This matters because..." [with progressive detail]
5. **Choice** - "What would you like to do next?" [actionable buttons]

**Progress Indication During Analysis:**
```
┌─────────────────────────────────────────────┐
│ Running Scout Swarm...                      │
│                                             │
│ ████████████████████──────── 67%           │
│                                             │
│ Testing feature: entropy_price_volume       │
│ Agents: 8/12 reporting                      │
└─────────────────────────────────────────────┘
```

### Choose-Your-Own-Adventure Structure

**Not a rigid game**: No fixed quests, no forced progression. Instead:

- **Branches, not levels**: "We could look at regime detection OR equation discovery next—which interests you?"
- **Backtracking allowed**: Discovery Trail lets you jump back
- **No penalties**: Exploring "wrong" path is fine—it's discovery
- **Emergent narrative**: Story unfolds based on what data reveals, not pre-scripted

**Example Flow:**
```
Start Analysis
    ↓
Scout Swarm (feature selection)
    ├─→ "Tell me about dealer gamma" [BRANCH: Educational deep-dive]
    ├─→ "Show me the math" [BRANCH: Technical detail]
    └─→ "Continue to equation discovery" [ADVANCE]
        ↓
    Math Swarm (PySR)
        ├─→ "Explain this equation" [BRANCH: Educational]
        ├─→ "Test this in backtest" [BRANCH: Validation]
        └─→ "Find regime context" [ADVANCE]
            ↓
        Jury Swarm (regime detection)
            └─→ "Synthesize findings" [ADVANCE]
```

---

## 3. Trading Mode (Clear & Crisp Execution)

### Screen Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [LIVE TRADING MODE] ⚠️          Quant Engine                   [?] [≡] [×]  │
├─────────────────────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────────────────────────┐   │
│ │ STATUS BAR                                                            │   │
│ │ System: ● ACTIVE  │  Account: $47,832 (+$234 today)  │  Risk: 12%   │   │
│ │ Strategy: Volatility Harvesting  │  Last Update: 2s ago  │ [🔴 KILL] │   │
│ └───────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ POSITIONS                                                               │ │
│ │ ─────────────────────────────────────────────────────────────────────── │ │
│ │ Symbol  │ Type    │ Size │ Entry  │ Current │ P&L    │ Why             │ │
│ │ ─────────────────────────────────────────────────────────────────────── │ │
│ │ SPY     │ Condor  │ 10   │ $595   │ $602    │ +$470  │ High IV rank,   │ │
│ │         │ (Iron)  │      │        │         │        │ vol compression │ │
│ │         │         │      │        │         │        │ expected        │ │
│ │ ─────────────────────────────────────────────────────────────────────── │ │
│ │ TSLA    │ Put     │ -5   │ $12.30 │ $10.80  │ +$750  │ Gamma flip →    │ │
│ │         │ Credit  │      │        │         │        │ dealer support  │ │
│ │ ─────────────────────────────────────────────────────────────────────── │ │
│ │                                                   Total P&L: +$1,220    │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ ┌──────────────────────────┐  ┌───────────────────────────────────────────┐ │
│ │ RISK MONITOR             │  │ CLAUDE ACTIVITY                           │ │
│ │                          │  │ ───────────────────────────────────────── │ │
│ │ Portfolio Delta: -0.23   │  │ [14:32] Gamma flip detected in SPY       │ │
│ │ Max Loss (VaR): $1,200   │  │ [14:30] Dealer gamma now positive         │ │
│ │ Margin Used: 28%         │  │ [14:28] Monitoring vol surface for        │ │
│ │ Greeks:                  │  │         arbitrage opportunity             │ │
│ │   Delta: -23             │  │ [14:25] Position sizing validated         │ │
│ │   Gamma: +0.45           │  │                                           │ │
│ │   Theta: +12.3           │  │ [Clear explanatory tone, factual]         │ │
│ │   Vega:  -34.2           │  │                                           │ │
│ │                          │  │                                           │ │
│ │ [⚠️ Risk Limits OK]      │  │                                           │ │
│ └──────────────────────────┘  └───────────────────────────────────────────┘ │
│                                                                             │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ MARKET CONDITIONS (Current Regime: Volatile Bearish)                    │ │
│ │ SPY: $602.34 (−0.8%)  │  VIX: 18.2 (+2.3)  │  Dealer Gamma: +0.68      │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Components

#### Status Bar (Always Visible, Top)
- **Purpose**: System health at a glance—WHAT is happening NOW
- **Critical Data**:
  - System state: ● ACTIVE / ⏸ PAUSED / ○ STOPPED
  - Account balance (with today's P&L)
  - Current risk utilization (% of max allowed)
  - Active strategy name
  - Last data update timestamp
  - **KILL SWITCH**: Red button, always accessible
- **Props**:
  - `systemState: 'active' | 'paused' | 'stopped'`
  - `accountBalance: number`
  - `todayPnL: number`
  - `riskUtilization: number` (0-100%)
  - `activeStrategy: string`
  - `lastUpdate: Date`
  - `onKill: () => void`

**Kill Switch Behavior:**
- Single click → Modal: "Close all positions and halt? [YES] [NO]"
- YES → Immediate close, no delay
- Works even if UI is frozen (IPC direct to Python)

#### Position Table
- **Purpose**: See ALL open positions, WHY they exist, current state
- **Columns**:
  - Symbol
  - Type (e.g., Iron Condor, Put Credit Spread, Long Call)
  - Size (contracts/shares)
  - Entry price
  - Current price/value
  - P&L ($ and %)
  - **WHY** - One-sentence reason this position exists
- **Props**:
  - `positions: Position[]`
  - `onPositionClick?: (position) => void` - Drill into detail

**WHY Column Examples:**
```
"High IV rank, vol compression expected"
"Gamma flip → dealer support at 580"
"Regime shift to ranging, mean reversion play"
"Scout swarm identified edge in put skew"
```

#### Risk Monitor Panel
- **Purpose**: Understand portfolio-level risk exposure
- **Metrics**:
  - Portfolio delta (directional exposure)
  - Max loss (VaR or scenario-based)
  - Margin utilization
  - Greeks (aggregate)
  - Risk limit status (visual: green = OK, yellow = warning, red = breach)
- **Props**:
  - `portfolioMetrics: RiskMetrics`
  - `limits: RiskLimits`
  - `status: 'ok' | 'warning' | 'breach'`

#### Claude Activity Feed (Trading Mode)
- **Purpose**: Factual log of what Claude is doing/monitoring
- **Tone**: Crisp, clear, no narrative flourish
- **Examples**:
  ```
  [14:32] Gamma flip detected in SPY at 580 strike
  [14:30] Dealer gamma now positive (+0.68)
  [14:28] Monitoring vol surface for arbitrage opportunity
  [14:25] Position sizing validated: risk within limits
  [14:20] Regime detected: volatile_bearish (confidence: 0.87)
  ```
- **Props**:
  - `events: TradingEvent[]`
  - `maxEvents: number` (rolling window)

#### Market Conditions Bar (Bottom)
- **Purpose**: Contextual market state
- **Data**:
  - Major indices (SPY, QQQ, VIX)
  - Current regime classification
  - Key metrics (dealer gamma, IV rank, etc.)
- **Props**:
  - `marketData: MarketSnapshot`
  - `regime: RegimeState`

### Safety Mechanisms

#### 1. Kill Switch
- **Location**: Status bar, always visible
- **Action**: Closes all positions, halts all strategies, stops trading
- **Confirmation**: Modal with clear consequences
- **Speed**: Direct IPC to Python, bypasses queue
- **Visual Feedback**: System state changes to STOPPED, all panels update

#### 2. Risk Breach Alerts
- **Trigger**: Any risk metric exceeds limit
- **Visual**: Status bar turns red, modal alert
- **Action Options**:
  - Reduce position size
  - Close specific positions
  - Halt all trading
  - Override (requires confirmation + reason)

#### 3. Position Confirmations
- **Any new position**: Claude explains WHAT, WHY, RISK before execution
- **User confirms**: Modal with summary
- **Rejection**: User can say no, Claude logs reason

#### 4. Data Staleness Warning
- **If data feed > 30s old**: Status bar shows warning
- **Action**: Halt trading until fresh data confirmed

### Visual Design (Trading Mode)

- **Color Palette**: Professional, minimal
  - Green: Positive P&L, system OK
  - Red: Negative P&L, risk breach, kill switch
  - Yellow: Warnings, caution
  - Gray: Neutral data
  - **No playful colors** (no purple, no gradients)
- **Typography**: Monospace for numbers, clear sans-serif for text
- **Spacing**: Dense but readable—maximize info density
- **Animations**: Minimal—only for critical alerts

---

## 4. JARVIS Communication Protocol

### Event Types (Python → UI)

**Events are emitted via `emit_ui_event()` in Python, written to JSON files, watched by `ClaudeCodeResultWatcher`, sent to React via IPC.**

#### Event Schema
```typescript
interface JarvisEvent {
  timestamp: string;           // ISO 8601
  activity_type: ActivityType; // See below
  message: string;             // Human-readable description
  data?: any;                  // Type-specific payload
  visualization?: Visualization; // Chart/diagram spec
  notification?: Notification;  // Toast/alert
  progress?: number;            // 0-100 for long-running tasks
}

type ActivityType =
  | 'discovery'          // Discovery mode narrative
  | 'analysis'           // Running analysis
  | 'data_loading'       // Loading data
  | 'swarm_activity'     // Swarm agents working
  | 'equation_found'     // Math swarm result
  | 'regime_detected'    // Regime classification
  | 'backtest_result'    // Backtest complete
  | 'trading_signal'     // Trade signal generated
  | 'position_update'    // Position opened/closed
  | 'risk_alert'         // Risk breach/warning
  | 'system_status';     // System state change
```

#### Visualization Types
```typescript
interface Visualization {
  type: 'chart' | 'table' | 'heatmap' | 'gauge' | 'diagram' | 'surface' | 'payoff';
  title: string;
  data: any; // Type-specific data
  config?: any; // Type-specific config
}

// Examples:
// Chart (time series, bar, waterfall, etc.)
{
  type: 'chart',
  title: 'Dealer Gamma Over Time',
  data: {
    chartType: 'line',
    series: [{ name: 'Dealer Gamma', data: [...] }],
    xAxis: { type: 'datetime' },
    yAxis: { title: 'Gamma Exposure' }
  }
}

// Table
{
  type: 'table',
  title: 'Top Features from Scout Swarm',
  data: {
    columns: [
      { key: 'feature', label: 'Feature', type: 'text' },
      { key: 'importance', label: 'Importance', type: 'number' },
      { key: 'correlation', label: 'Correlation', type: 'number' }
    ],
    rows: [...]
  }
}

// Heatmap
{
  type: 'heatmap',
  title: 'Feature Correlation Matrix',
  data: {
    xLabels: ['feat1', 'feat2', ...],
    yLabels: ['feat1', 'feat2', ...],
    values: [[1.0, 0.8, ...], ...]
  }
}

// Payoff Diagram
{
  type: 'payoff',
  title: 'Iron Condor Payoff - SPY',
  data: {
    strategies: [
      { type: 'put', strike: 580, premium: 2.5, quantity: 1, position: 'short' },
      { type: 'put', strike: 575, premium: 1.2, quantity: 1, position: 'long' },
      { type: 'call', strike: 610, premium: 2.3, quantity: 1, position: 'short' },
      { type: 'call', strike: 615, premium: 1.0, quantity: 1, position: 'long' }
    ],
    currentPrice: 595
  }
}
```

#### Notification Types
```typescript
interface Notification {
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  duration?: number; // ms, defaults to 5000
  action?: { label: string; callback: string }; // e.g., "View Details"
}
```

### Data Flow Architecture

```
Python Script (e.g., run_scout_swarm.py)
    │
    ├─ emit_ui_event(activity_type='swarm_activity', message='Scout swarm starting...', progress=0)
    │       │
    │       ▼
    │   Write: /tmp/claude-code-results/jarvis_event_<timestamp>.json
    │
    ├─ [Work happens: swarm runs]
    │
    ├─ emit_ui_event(activity_type='swarm_activity', message='Testing feature: gamma...', progress=50)
    │       │
    │       ▼
    │   Write: /tmp/claude-code-results/jarvis_event_<timestamp>.json
    │
    ├─ ui_table(title='Top Features', columns=[...], rows=[...])
    │       │
    │       ▼
    │   emit_ui_event(activity_type='discovery', visualization={type: 'table', ...})
    │
    └─ emit_ui_event(activity_type='discovery', message='Scout swarm complete', progress=100)

ClaudeCodeResultWatcher (Electron Main Process)
    │
    ├─ Watches /tmp/claude-code-results/
    │
    ├─ On new file: Parse JSON, send IPC 'jarvis-event' to renderer
    │
    └─ Clean up old files

React (Renderer Process)
    │
    ├─ useJarvisEvents() hook listens to IPC 'jarvis-event'
    │
    ├─ Dispatches to VisualizationContext
    │
    └─ Components re-render with new data
        │
        ├─ NarrativePanel updates message
        ├─ VisualizationPanel shows chart/table
        └─ Activity feed adds entry
```

### How Claude Updates Visualizations

**Example: Gamma Analysis**

```python
# In Python (e.g., analyze_gamma.py)
from engine.ui_bridge import ui_gamma_analysis

# Compute gamma metrics
dealer_gamma = 0.72
customer_gamma = -0.45
mm_hedge = 0.33
vol_demand = -0.18

# Emit to UI
ui_gamma_analysis("SPY", {
    "dealer_gamma": dealer_gamma,
    "customer_gamma": customer_gamma,
    "mm_hedge": mm_hedge,
    "vol_demand": vol_demand
})

# This internally calls:
# emit_ui_event(
#     activity_type='analysis',
#     message='Gamma analysis complete for SPY',
#     visualization={
#         type: 'chart',
#         title: 'Gamma Force Components - SPY',
#         data: { ... waterfall chart data ... }
#     }
# )
```

**React receives this and:**
1. `useJarvisEvents()` picks up the event
2. Dispatches to `VisualizationContext` with `setCurrentVisualization(event.visualization)`
3. `VisualizationPanel` component re-renders with new chart
4. `NarrativePanel` updates: "Claude analyzed SPY gamma exposure. Dealer gamma is positive (+0.72)..."

### Batching for Performance

**Problem**: If Python emits 100 events in 1 second, UI could thrash.

**Solution**: Batch events in ClaudeCodeResultWatcher
- Accumulate events for 100ms window
- Send batch to renderer
- React processes batch, updates once

**Implementation**:
```typescript
// In ClaudeCodeResultWatcher
private eventQueue: JarvisEvent[] = [];
private batchTimer: NodeJS.Timeout | null = null;

private handleNewEvent(event: JarvisEvent) {
  this.eventQueue.push(event);
  
  if (!this.batchTimer) {
    this.batchTimer = setTimeout(() => {
      this.sendBatch();
      this.batchTimer = null;
    }, 100); // 100ms batch window
  }
}

private sendBatch() {
  if (this.eventQueue.length === 0) return;
  
  this.mainWindow?.webContents.send('jarvis-events-batch', this.eventQueue);
  this.eventQueue = [];
}
```

**Result**: 60fps updates even with high event volume.

---

## 5. Educational Layer

### Progressive Disclosure Pattern

**Principle**: Show simple first, reveal complexity on demand.

**Example: Dealer Gamma**

**Level 1 (Default):**
```
┌─────────────────────────────────────────────┐
│ Dealer Gamma: +0.72                        │
│                                             │
│ This means dealers will STABILIZE price    │
│ movement (buy dips, sell rips).            │
│                                             │
│ [💡 Why does this happen?]                 │
└─────────────────────────────────────────────┘
```

**Level 2 (User clicked "Why does this happen?"):**
```
┌─────────────────────────────────────────────┐
│ Dealer Gamma Explained                     │
│                                             │
│ When gamma is positive, dealers are LONG   │
│ options. To stay delta-neutral, they:      │
│                                             │
│ • BUY stock when price falls (support)     │
│ • SELL stock when price rises (resistance) │
│                                             │
│ This creates a "ceiling and floor" effect. │
│                                             │
│ [🔬 Show me the math] [📊 See historical]  │
└─────────────────────────────────────────────┘
```

**Level 3 (User clicked "Show me the math"):**
```
┌─────────────────────────────────────────────┐
│ Dealer Gamma Math                          │
│                                             │
│ Γ_dealer = Σ (Γ_i × Open_Interest_i)       │
│                                             │
│ where:                                      │
│ • Γ_i = option gamma (∂²V/∂S²)             │
│ • Positive for long positions               │
│ • Negative for short positions              │
│                                             │
│ Delta-hedge requirement:                    │
│ Δ_hedge = Γ × ΔS                            │
│                                             │
│ [Close]                                     │
└─────────────────────────────────────────────┘
```

### Visual Over Text

**Good**: Diagram showing how gamma hedging works
```
Price moves UP
     │
     ▼
Dealer delta becomes POSITIVE (due to gamma)
     │
     ▼
Dealer must SELL stock to re-hedge
     │
     ▼
Selling pressure RESISTS further upward movement
```

**Bad**: Paragraph explaining gamma hedging dynamics

### Just-in-Time Learning Triggers

**When to Explain:**
- User encounters concept for first time → Auto-popup with "💡" icon
- User clicks "💡 What does this mean?"
- User hovers over technical term → Tooltip
- User clicks 🔬 "Show me the math" → Modal/panel

**When NOT to Explain:**
- Upfront tutorial → NO. Learn as you go.
- Every time concept appears → Track "user has seen this" in localStorage

### Educational Components

#### ExplainerCard
```typescript
interface ExplainerCard {
  concept: string;          // e.g., "Dealer Gamma"
  level: 1 | 2 | 3;         // Progressive detail
  content: {
    summary: string;        // Level 1: Plain language
    explanation?: string;   // Level 2: How it works
    technical?: string;     // Level 3: Math/formulas
    visual?: Visualization; // Diagram/chart
  };
}
```

**Props**:
- `concept: string`
- `currentLevel: number`
- `onLevelChange: (level) => void`

#### GlossaryTooltip
**Trigger**: Hover over technical term
**Content**: 1-sentence definition + link to full explainer

**Example**:
```
User hovers over "IV Rank"

Tooltip: "IV Rank: Current implied volatility as percentile 
          of past year's range. Click for details."
```

#### LearningProgress (Discovery Mode)
**Purpose**: Track concepts user has learned
**Display**: "You've discovered 12 concepts" with list
**Storage**: localStorage

---

## 6. Multi-Window Architecture

### Window Types

Zach has a 4-monitor setup. JARVIS should support multiple windows for different purposes.

#### 1. Main Window (Primary Control)
- **Discovery Mode**: Narrative + Visualization + Character Sheet
- **Trading Mode**: Positions + Risk + Status + Activity
- **Size**: Full screen on Monitor 1

#### 2. Visualization Window (Charts/Diagrams)
- **Purpose**: Large canvas for complex visualizations
- **Content**: Current visualization (synced with main)
- **Interaction**: Can pop out from main window
- **Size**: Full screen on Monitor 2

#### 3. Data Explorer Window (Tables/Raw Data)
- **Purpose**: Drill into numbers, export data
- **Content**: Tables, feature matrices, historical data
- **Size**: Half screen on Monitor 3

#### 4. Activity Log Window (Claude's Work)
- **Purpose**: Full feed of Claude's activity (both modes)
- **Content**: Timestamped log, filterable
- **Size**: Half screen on Monitor 4

#### 5. Market Monitor Window (Trading Mode)
- **Purpose**: Real-time market data, watchlists
- **Content**: Tickers, charts, news
- **Size**: Half screen on Monitor 3

### Layout Presets

**Discovery Mode Preset:**
- Monitor 1: Main (Narrative + Visualization + Character Sheet)
- Monitor 2: Visualization Window (large)
- Monitor 3: Data Explorer (top) + Activity Log (bottom)
- Monitor 4: Obsidian/Notes (outside JARVIS)

**Trading Mode Preset:**
- Monitor 1: Main (Positions + Risk + Status)
- Monitor 2: Market Monitor (full)
- Monitor 3: Visualization Window (charts)
- Monitor 4: Activity Log (full)

**Implementation**: Save/load presets via Electron `BrowserWindow` positioning

### State Synchronization

**Challenge**: All windows need to reflect same state.

**Solution**: Single source of truth in `VisualizationContext`

```typescript
// Shared Electron store (main process)
class AppStateStore {
  private state: AppState;
  private windows: BrowserWindow[] = [];

  updateState(newState: Partial<AppState>) {
    this.state = { ...this.state, ...newState };
    this.broadcastToAllWindows('state-update', this.state);
  }

  broadcastToAllWindows(channel: string, data: any) {
    this.windows.forEach(win => {
      win.webContents.send(channel, data);
    });
  }
}
```

**React side**: All windows listen to `'state-update'` IPC event, update context.

**Real-time**: <100ms latency between windows.

---

## 7. Component Specifications

### Key React Components

#### Discovery Mode Components

##### `NarrativePanel`
**Purpose**: Display Claude's narrative and user action buttons

**Props**:
```typescript
interface NarrativePanelProps {
  currentNarrative: string;
  actionButtons: ActionButton[];
  educationalContent?: EducationalCard;
  onActionClick: (action: string) => void;
}

interface ActionButton {
  icon: string; // Emoji or icon name
  label: string;
  action: string; // Action ID
  variant: 'primary' | 'secondary';
}
```

**State**:
- `narrativeHistory: string[]` - Track previous narratives for backtracking
- `loading: boolean` - Show spinner when Claude is processing

**JARVIS Events Consumed**:
- `activity_type: 'discovery'` → Update narrative
- `notification` → Show toast

##### `VisualizationPanel`
**Purpose**: Render charts, diagrams, tables

**Props**:
```typescript
interface VisualizationPanelProps {
  visualization: Visualization | null;
  interactive?: boolean;
  onInteraction?: (event: InteractionEvent) => void;
}
```

**State**:
- `visualizationHistory: Visualization[]` - Previous vizs (for backtracking)

**JARVIS Events Consumed**:
- `visualization` field in any event → Render

**Chart Library**: Recharts (already in codebase)

##### `AssetCharacterSheet`
**Purpose**: External memory for asset context

**Props**:
```typescript
interface AssetCharacterSheetProps {
  symbol: string;
  currentState: AssetState;
  discoveries: Discovery[];
}

interface AssetState {
  regime: string;
  dealerGamma: number;
  ivRank: number;
  // ... other key metrics
}

interface Discovery {
  timestamp: string;
  description: string;
  vizLink?: string; // Link to visualization
}
```

**State**:
- Persisted to `localStorage` keyed by symbol
- Loaded on symbol change

**JARVIS Events Consumed**:
- Any event with `data.symbol` → Update that asset's state

##### `DiscoveryTrail`
**Purpose**: Breadcrumb navigation

**Props**:
```typescript
interface DiscoveryTrailProps {
  steps: TrailStep[];
  currentStep: number;
  onStepClick: (stepIndex: number) => void;
}

interface TrailStep {
  label: string;
  timestamp: string;
  data?: any; // Snapshot of state at this step
}
```

**State**:
- Managed by parent (DiscoveryPage component)

#### Trading Mode Components

##### `StatusBar`
**Purpose**: Always-visible system status

**Props**:
```typescript
interface StatusBarProps {
  systemState: 'active' | 'paused' | 'stopped';
  accountBalance: number;
  todayPnL: number;
  riskUtilization: number; // 0-100
  activeStrategy: string;
  lastUpdate: Date;
  onKill: () => void;
}
```

**State**:
- None (purely display, state from context)

**JARVIS Events Consumed**:
- `activity_type: 'system_status'` → Update all fields

##### `PositionTable`
**Purpose**: Display all open positions with WHY column

**Props**:
```typescript
interface PositionTableProps {
  positions: Position[];
  onPositionClick?: (position: Position) => void;
}

interface Position {
  symbol: string;
  type: string; // "Iron Condor", "Put Credit Spread", etc.
  size: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  why: string; // One-sentence reason
  metadata?: any; // Additional details
}
```

**State**:
- Sorting (by symbol, P&L, etc.)

**JARVIS Events Consumed**:
- `activity_type: 'position_update'` → Add/update/remove position

##### `RiskMonitor`
**Purpose**: Portfolio risk metrics

**Props**:
```typescript
interface RiskMonitorProps {
  portfolioMetrics: RiskMetrics;
  limits: RiskLimits;
  status: 'ok' | 'warning' | 'breach';
}

interface RiskMetrics {
  portfolioDelta: number;
  maxLoss: number; // VaR
  marginUsed: number; // %
  greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  };
}

interface RiskLimits {
  maxDelta: number;
  maxLoss: number;
  maxMargin: number;
}
```

**State**:
- None (display only)

**JARVIS Events Consumed**:
- `activity_type: 'risk_alert'` → Update status, show alert

##### `ClaudeActivityFeed`
**Purpose**: Log of Claude's actions (different in Discovery vs Trading)

**Props**:
```typescript
interface ClaudeActivityFeedProps {
  mode: 'discovery' | 'trading';
  events: ActivityEvent[];
  maxEvents?: number; // Default 100
}

interface ActivityEvent {
  timestamp: string;
  message: string;
  type: ActivityType;
  data?: any;
}
```

**State**:
- Event buffer (rolling window)
- Filter/search

**JARVIS Events Consumed**:
- ALL events → Add to feed

**Formatting**:
- Discovery mode: Narrative tone
- Trading mode: Factual, timestamped

##### `MarketConditionsBar`
**Purpose**: Current market snapshot

**Props**:
```typescript
interface MarketConditionsBarProps {
  marketData: MarketSnapshot;
  regime: RegimeState;
}

interface MarketSnapshot {
  spy: { price: number; change: number };
  qqq: { price: number; change: number };
  vix: { price: number; change: number };
  dealerGamma: number;
}

interface RegimeState {
  current: string; // "volatile_bearish"
  confidence: number; // 0-1
  probabilities?: { [regime: string]: number };
}
```

**State**:
- None (display only)

**JARVIS Events Consumed**:
- `activity_type: 'regime_detected'` → Update regime
- Market data updates (via separate data feed or events)

### Shared Components

##### `ExplainerCard`
**Purpose**: Progressive disclosure education

**Props**:
```typescript
interface ExplainerCardProps {
  concept: string;
  currentLevel: 1 | 2 | 3;
  onLevelChange: (level: number) => void;
}
```

**State**:
- Fetches content from explainer JSON file keyed by `concept`

##### `KillSwitchButton`
**Purpose**: Emergency stop

**Props**:
```typescript
interface KillSwitchButtonProps {
  onConfirm: () => void;
}
```

**State**:
- `showConfirmation: boolean`

**Behavior**:
- Click → Modal: "Close all positions and halt system?"
- YES → Call `onConfirm()`, which sends IPC to Python to stop trading

---

## 8. Open Questions for Zach

### 1. Discovery Mode Narrative Voice
**Question**: How much personality should Claude have in Discovery mode? On a scale:
- **Minimal**: "Analysis complete. 6 features selected."
- **Moderate**: "I found 6 features that show strong predictive power."
- **Conversational**: "Interesting! Out of 47 features, 6 really stand out. Let me show you why..."

**Impact**: Affects tone of all narrative text.

### 2. Trading Mode Confirmations
**Question**: For NEW positions, how much confirmation do you want?
- **High friction**: Modal with full details, must click "Confirm"
- **Low friction**: Toast notification, auto-executes unless you click "Cancel" within 5s
- **No friction**: Auto-executes, logs to activity feed

**Impact**: Balance between safety and speed.

### 3. Multi-Window Default
**Question**: Should JARVIS open multi-window layout by default, or single window with "Pop out" buttons?
- **Default multi-window**: On startup, opens 3-4 windows in preset layout
- **Single window default**: User manually pops out as needed

**Impact**: Initial UX, complexity.

### 4. Data Update Frequency (Trading Mode)
**Question**: How often should positions/risk update?
- **Real-time (1s)**: Highest accuracy, more CPU/network
- **5s intervals**: Balance
- **10s intervals**: Lower load

**Impact**: System resources, data costs.

### 5. Backtest Results in Discovery
**Question**: When Claude runs a backtest in Discovery mode, how should results display?
- **Narrative summary**: "This strategy returned 23% with Sharpe 1.85..."
- **Chart + metrics**: Show equity curve + table of stats
- **Interactive deep-dive**: Full tearsheet with drawdowns, exposures, etc.

**Impact**: Complexity of backtest visualization.

### 6. Educational Content Curation
**Question**: Should explainer content be:
- **Claude-generated on-the-fly**: Ask Claude to explain concept when user clicks
- **Pre-written library**: We write explanations in advance, stored in JSON
- **Hybrid**: Pre-written for common concepts, Claude for edge cases

**Impact**: Quality vs. speed.

### 7. Alert Fatigue (Trading Mode)
**Question**: Risk alerts—how aggressive?
- **Every breach**: Even minor limit violations → toast
- **Only critical**: Major breaches or position losses > X% → modal
- **Configurable**: User sets thresholds

**Impact**: Notification volume.

### 8. Discovery Mode "Save Points"
**Question**: Should users be able to save their Discovery session progress and resume later?
- **Yes**: Save trail, narrative, visualizations to file
- **No**: Each session is fresh, ephemeral
- **Partial**: Save only key findings (like discovered equations)

**Impact**: Session persistence complexity.

### 9. Trading Mode "Why" Column Detail
**Question**: The WHY column in position table—how much detail?
- **One sentence**: "Gamma flip → dealer support"
- **Short paragraph**: 2-3 sentences with context
- **Expandable**: One sentence + click to see full reasoning

**Impact**: Table density vs. information.

### 10. Performance vs. Polish
**Question**: For Phase 1 (MVP), where to focus?
- **Core functionality first**: Get Discovery + Trading modes working, minimal styling
- **Polish first**: Make it look good even if features are limited
- **Balanced**: Basic polish + basic features

**Impact**: Development priorities.

---

**END OF SPECIFICATION**

---

## Appendix: ASCII Wireframes

### Discovery Mode - Full Layout
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ☰ Quant Engine - Discovery Mode                              [Mode] [?] [×] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ 📖 NARRATIVE PANEL                                                    │ │
│  │ ───────────────────────────────────────────────────────────────────── │ │
│  │                                                                       │ │
│  │ Claude: "We've just completed the Scout Swarm analysis on SPY.       │ │
│  │ Out of 47 features in the master dataset, the swarm identified 6     │ │
│  │ that show strong predictive power for next-day returns. The top      │ │
│  │ performer is dealer_gamma_normalized with a correlation of 0.68.     │ │
│  │                                                                       │ │
│  │ I also noticed something interesting: dealer gamma and put-call      │ │
│  │ imbalance cluster together. They're capturing the same underlying    │ │
│  │ force—dealer hedging behavior."                                      │ │
│  │                                                                       │ │
│  │ ┌──────────────────┐ ┌──────────────────┐ ┌────────────────────┐   │ │
│  │ │ 💡 What's dealer │ │ 📊 Show me the   │ │ ➡️ Continue to    │   │ │
│  │ │    hedging?      │ │    clustering    │ │    equation search │   │ │
│  │ └──────────────────┘ └──────────────────┘ └────────────────────┘   │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────┐   │
│  │ 📊 VISUALIZATION                 │  │ 📋 SPY CHARACTER SHEET       │   │
│  │                                  │  │                              │   │
│  │  Top 6 Features by Importance   │  │ SPY - S&P 500 ETF            │   │
│  │                                  │  │                              │   │
│  │  dealer_gamma_norm     ████████  │  │ Current State:               │   │
│  │  put_call_imbalance    ██████    │  │  Regime: Volatile            │   │
│  │  entropy_price_vol     █████     │  │  Dealer Gamma: +0.72         │   │
│  │  hurst_exponent        ████      │  │  IV Rank: 68%                │   │
│  │  fractal_dimension     ███       │  │  Customer Gamma: -0.45       │   │
│  │  gex_skew             ███        │  │                              │   │
│  │                                  │  │ Recent Discoveries:          │   │
│  │  [Interactive: Click to explore] │  │  [14:23] Top 6 features ID'd │   │
│  │                                  │  │  [14:20] Gamma flip detected │   │
│  │                                  │  │  [14:15] Scout swarm started │   │
│  └──────────────────────────────────┘  └──────────────────────────────┘   │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ 🧭 DISCOVERY TRAIL                                                    │ │
│  │ Start → Scout Swarm → Feature Results → [Next: Equation Discovery?]  │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Trading Mode - Full Layout
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚠️  LIVE TRADING MODE                                         [Mode] [?] [×] │
├─────────────────────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────────────────────────┐   │
│ │ ● ACTIVE │ $47,832 (+$234) │ Risk: 12% │ Vol Harvesting │ 2s │ 🔴 KILL│   │
│ └───────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│ ┌───────────────────────────────────────────────────────────────────────┐   │
│ │ POSITIONS                                                             │   │
│ │ ───────────────────────────────────────────────────────────────────── │   │
│ │ Symbol │ Type      │ Size │ Entry │ Current │ P&L    │ Why            │   │
│ │ ────────────────────────────────────────────────────────────────────  │   │
│ │ SPY    │ Iron      │  10  │ $595  │ $602    │ +$470  │ High IV rank,  │   │
│ │        │ Condor    │      │       │         │        │ vol compress   │   │
│ │ ────────────────────────────────────────────────────────────────────  │   │
│ │ TSLA   │ Put Credit│  -5  │$12.30 │ $10.80  │ +$750  │ Gamma flip →   │   │
│ │        │ Spread    │      │       │         │        │ dealer support │   │
│ │ ────────────────────────────────────────────────────────────────────  │   │
│ │                                                 Total P&L: +$1,220    │   │
│ └───────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│ ┌─────────────────────────┐  ┌──────────────────────────────────────────┐  │
│ │ RISK MONITOR            │  │ CLAUDE ACTIVITY                          │  │
│ │                         │  │ ──────────────────────────────────────── │  │
│ │ Portfolio Delta: -0.23  │  │ [14:32] Gamma flip detected SPY 580     │  │
│ │ Max Loss (VaR): $1,200  │  │ [14:30] Dealer gamma now positive       │  │
│ │ Margin Used: 28%        │  │ [14:28] Monitoring vol surface for arb  │  │
│ │                         │  │ [14:25] Position sizing validated       │  │
│ │ Greeks:                 │  │ [14:20] Regime: volatile_bearish (0.87) │  │
│ │   Delta:  -23           │  │                                          │  │
│ │   Gamma:  +0.45         │  │                                          │  │
│ │   Theta:  +12.3         │  │                                          │  │
│ │   Vega:   -34.2         │  │                                          │  │
│ │                         │  │                                          │  │
│ │ ✅ Risk Limits OK       │  │                                          │  │
│ └─────────────────────────┘  └──────────────────────────────────────────┘  │
│                                                                             │
│ ┌───────────────────────────────────────────────────────────────────────┐   │
│ │ MARKET CONDITIONS │ Regime: Volatile Bearish                          │   │
│ │ SPY: $602.34 (-0.8%) │ VIX: 18.2 (+2.3) │ Dealer Gamma: +0.68        │   │
│ └───────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

**This specification is ready for implementation. Awaiting Zach's answers to open questions before proceeding with development.**
