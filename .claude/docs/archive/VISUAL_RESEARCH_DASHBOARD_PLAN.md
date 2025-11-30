# Visual Research Dashboard - Implementation Plan

## Executive Summary

Transform the Quant Chat Workbench into a **Visual Research Dashboard** where Chief Quant dynamically controls the UI based on the current research stage. Users can follow the entire research lifecycle visually, from regime mapping through strategy discovery to validated portfolio construction.

## Research Lifecycle

The system follows a cyclical workflow:

```
Regime Mapping → Strategy Discovery (Swarm) → Backtest/Tune → Portfolio Construction → [Loop Back]
```

Each stage has dedicated visualizations that appear/disappear automatically based on Chief Quant's work.

---

## Core Architecture: Chief Quant UI Directives

Chief Quant emits **display directives** in its responses to control the UI:

```
Chief Quant Response:
"I'm classifying regimes from 2020-2024..."
[STAGE: regime_mapping]
[DISPLAY: regime_timeline from=2020-01-01 to=2024-12-31]
[PROGRESS: 23 message="Classifying Q2 2021"]
[FOCUS: center]
```

The `ResearchDisplayContext` parses these directives and updates the UI state:

```typescript
{
  currentStage: 'regime_mapping',
  activeVisualizations: ['regime_timeline'],
  progress: { percent: 23, message: 'Classifying Q2 2021' },
  focusArea: 'center'
}
```

---

## Stage Definitions

```typescript
type ResearchStage = 
  | 'idle'              // No active research
  | 'regime_mapping'    // Analyzing/classifying market regimes
  | 'strategy_discovery'// Swarm discovering strategies
  | 'backtesting'       // Running backtests
  | 'tuning'            // Parameter optimization
  | 'analysis'          // Agent modes (audit, patterns, risk)
  | 'portfolio'         // Portfolio construction/symphony
  | 'conclusion';       // Final synthesis
```

---

## Stage-Specific Visualizations

### 1. Regime Mapping Stage

**Goal**: See the "weather map" of market history being classified

#### Regime Timeline Heat Map (`RegimeTimeline.tsx`)
```
2020 |████████░░░░████████████████░░░░░░░░████████|
2021 |████████████████░░░░░░████████████████░░░░░░|
2022 |░░░░░░░░████████████████████████░░░░░░░░░░░░|
2023 |████████████████████████░░░░████████████████|
2024 |████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░|
      ▲ processing here
      
Legend: █ Low Vol  █ High Vol  █ Crash  █ Melt Up  ░ Unclassified
```

**Features**:
- X-axis: Date (year/month)
- Color-coded by regime type (green/yellow/red/gold)
- Gray areas: Unclassified (work remaining)
- Animated cursor showing current analysis position
- Clickable dates to see detailed metrics

#### Regime Distribution Chart (`RegimeDistribution.tsx`)
- Pie or bar chart showing % of time in each regime
- Updates live as classification progresses
- Shows target vs. actual coverage

#### Data Coverage Indicator (`DataCoverage.tsx`)
- Which symbols have data
- Date range coverage
- Missing data gaps (red highlights)
- Data quality scores

**When visible**: Center area overlay when stage = 'regime_mapping'

---

### 2. Strategy Discovery Stage (Swarm)

**Goal**: See the army of agents working and what they're finding

#### Enhanced Swarm Grid (upgrade existing `SwarmMonitor.tsx`)
- Make it LARGER and more prominent during discovery
- Group dots by "search area" (regime they're exploring)
- Animate pulse on active agents
- Show agent role on hover

#### Strategy × Regime Matrix (`DiscoveryMatrix.tsx`)
```
                LOW_VOL   HIGH_VOL   CRASH   MELT_UP
Iron Condor      [✓3]      [?]       [ ]      [ ]
Long Gamma       [ ]       [✓2]      [✓1]     [ ]  
Vol Spread       [?]       [?]       [ ]      [✓1]
Momentum         [✓1]      [ ]       [ ]      [?]

✓ = Promising  ? = Being Tested  Numbers = candidates found
```

**Features**:
- Rows: Strategy types being explored
- Columns: Target regime
- Cells: Status (empty, testing, promising, validated)
- Clicking cell shows specific runs/findings
- Color intensity = confidence level

#### Discovery Funnel (`DiscoveryFunnel.tsx`)
```
Ideas Generated:    ████████████████████████ 47
Being Tested:       ████████████░░░░░░░░░░░░ 23
Show Promise:       ████████░░░░░░░░░░░░░░░░ 12
Validated:          ████░░░░░░░░░░░░░░░░░░░░  5
```

**Features**:
- Shows conversion through discovery pipeline
- Click each bar to see strategies in that stage
- Animated progression as strategies advance

**When visible**: Center area overlay when stage = 'strategy_discovery'

---

### 3. Backtest/Tune Stage

**Goal**: See how strategies perform across conditions

#### Performance Heat Map (`PerformanceHeatMap.tsx`)
```
                 2020    2021    2022    2023    2024
Skew Profile     1.8     2.1     0.4     1.2     1.5   (Sharpe)
Momentum         0.9     1.5    -0.2     0.8     1.1
Vol Carry        1.2     0.8     1.9     0.7     0.6

Color intensity = performance level
Green = positive, Red = negative
```

**Features**:
- Strategy × Year matrix with Sharpe ratios
- Click cell to see detailed run results
- Toggle metric (Sharpe, Sortino, Win Rate, Max DD)

#### Equity Curve Overlay (`EquityCurveOverlay.tsx`)
- Multiple strategies on same chart
- Toggle strategies on/off
- Highlight drawdown periods
- Regime overlays showing market conditions

#### Parameter Sensitivity Surface (`ParameterSensitivitySurface.tsx`)
```
        VIX Filter: 15  20  25  30
Stop %      
  2%               1.2  1.4  1.5  1.3
  5%               1.0  1.6  1.8  1.4
 10%               0.8  1.2  1.4  1.1
 
Darker = better Sharpe
```

**Features**:
- 3D surface or 2D heat map
- Interactive parameter exploration
- Identifies optimal parameter regions

#### Active Backtest Queue (`BacktestQueue.tsx`)
```
┌──────────────────────────────────────────────┐
│ 🔄 Running: skew_v2 on 2022 crash period     │
│ ⏳ Queue: 3 more runs                         │
│ ✅ Completed today: 12 runs                   │
└──────────────────────────────────────────────┘
```

**When visible**: Right panel tab when stage = 'backtesting' or 'tuning'

---

### 4. Portfolio/Symphony Stage

**Goal**: See the final regime × convexity portfolio

#### Enhanced Symphony Orchestra (upgrade existing `SymphonyOrchestra.tsx`)
- Make it the HERO visualization when in portfolio stage
- Live pulse animation on current regime quadrant
- Real-time P&L overlay
- Show active strategies in each quadrant
- Highlight regime transitions

#### Portfolio Greeks Dashboard (`GreeksDashboard.tsx`)
```
Current Regime: HIGH_VOL_OSCILLATION

Delta: ████████░░░░░░░░░░░░ +0.2 (slightly long)
Gamma: ░░░░░░░░████████████ -0.8 (short gamma)
Vega:  ████████████░░░░░░░░ +0.5 (long vol)
Theta: ░░░░░░░░░░░░████████ -150/day
```

**Features**:
- Current portfolio Greeks exposure
- Target vs. actual comparison
- Risk limits and warnings
- Historical Greeks trajectory

#### Regime Allocation Sankey (`AllocationSankey.tsx`)
```
Regimes → Strategies → Greeks Exposure

LOW_VOL ──┬── Iron Condor ──── Short Gamma
          └── Credit Spread ── Neutral Delta

CRASH ────── Long Puts ─────── Long Gamma
                               Long Vega

HIGH_VOL ─┬─ Straddles ────── Long Gamma
          └─ Vol Spreads ──── Long Vega
```

**Features**:
- Flow diagram from regime to strategies to Greeks
- Width = allocation percentage
- Color = performance/risk level
- Interactive filtering

**When visible**: Center area when stage = 'portfolio'

---

## Always-Visible UI Elements (ADHD-Friendly Constraints)

### 1. Chief Quant Status Strip (`ChiefQuantStatus.tsx`)
**Location**: Top of window, always visible

**Contents**:
- Current stage indicator with icon
- Active operation with progress bar
- Elapsed time
- Cancel button (ESC shortcut)
- Recommended next action button

**Example**:
```
🗺️ Regime Mapping | Classifying 2021 Q2 [████████░░░░░░░░ 45%] 2m 15s [Cancel] [What's Next?]
```

### 2. Journey Map (`JourneyMap.tsx`)
**Location**: Below status strip, horizontal progress indicator

**Contents**:
```
[✅ Regime Mapping] → [⏳ Strategy Discovery] → [○ Backtest] → [○ Portfolio] → [○ Conclude]
```

- Completed stages: Green checkmark
- Current stage: Animated pulse
- Future stages: Gray circle
- Clickable to see stage summary

### 3. Activity Log (`ActivityLog.tsx`)
**Location**: Right panel tab, always accessible

**Contents**:
- Scrollable timeline of all Chief Quant actions
- Grouped by stage
- Shows: timestamps, action type, artifacts created
- Clickable to jump to relevant chat message
- Filter by stage, artifact type

---

## Implementation Phases

### Phase 1: Display Infrastructure (Foundation)
**Goal**: Create the core parsing and rendering system

**Files to create**:
1. `src/contexts/ResearchDisplayContext.tsx`
   - Global state for current stage, active visualizations, progress
   - Expose methods: updateStage(), showVisualization(), hideVisualization()

2. `src/lib/displayDirectiveParser.ts`
   - Parse `[STAGE: ...]`, `[DISPLAY: ...]`, `[PROGRESS: ...]` from text
   - Extract parameters (dates, filters, focus areas)

3. `src/components/visualizations/VisualizationContainer.tsx`
   - Conditionally render visualization components
   - Handle layout (center overlay, right panel, modal)
   - Smooth transitions between visualizations

4. **Wire into existing components**:
   - `ChatArea.tsx`: Parse directives from Chief Quant responses
   - `Index.tsx`: Add VisualizationContainer to layout

**Success Criteria**:
- Chief Quant can emit `[STAGE: regime_mapping]` and UI updates
- Context provides current stage to all components
- Empty visualization container renders in correct location

**Estimated Time**: 4-6 hours

---

### Phase 2: Regime Mapping Visualizations
**Goal**: See regime classification progress visually

**Files to create**:
1. `src/components/visualizations/RegimeTimeline.tsx`
   - Heat map timeline component
   - Accept props: dateRange, regimeData, currentPosition
   - Render colored blocks by date
   - Animated cursor for current analysis position
   - Click handler to show date details

2. `src/components/visualizations/RegimeDistribution.tsx`
   - Pie or bar chart showing regime percentages
   - Use recharts library
   - Live updates as classification progresses

3. `src/components/visualizations/DataCoverage.tsx`
   - Grid showing symbol × date coverage
   - Red highlights for missing data
   - Quality score badges

**Database additions**:
```sql
CREATE TABLE regime_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  date DATE NOT NULL,
  regime TEXT NOT NULL,
  confidence REAL,
  metrics JSONB,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(workspace_id, date)
);
```

**Chief Quant prompt update**:
- Add directive instructions: when classifying regimes, emit `[DISPLAY: regime_timeline]`
- Include date range and progress percentage

**Success Criteria**:
- Regime timeline renders with mock data
- Chief Quant can trigger display via directive
- Clicking date shows detailed metrics modal

**Estimated Time**: 8-10 hours

---

### Phase 3: Strategy Discovery Visualizations
**Goal**: See swarm discovery in action

**Files to create**:
1. **Upgrade existing** `src/components/swarm/SwarmMonitor.tsx`
   - Make grid larger when stage = 'strategy_discovery'
   - Group dots by target regime
   - Show agent role tooltips
   - Animate pulse on active agents

2. `src/components/visualizations/DiscoveryMatrix.tsx`
   - Strategy × Regime grid component
   - Cells show status (empty/testing/promising/validated)
   - Click handler to show runs in that cell
   - Color intensity by confidence

3. `src/components/visualizations/DiscoveryFunnel.tsx`
   - Funnel chart showing conversion pipeline
   - Ideas → Testing → Promising → Validated
   - Click bars to filter by stage

**Database additions**:
```sql
CREATE TABLE strategy_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  journey_id UUID REFERENCES research_journeys(id),
  strategy_name TEXT NOT NULL,
  target_regime TEXT NOT NULL,
  status TEXT DEFAULT 'testing', -- testing, promising, validated, rejected
  confidence REAL,
  discovery_metadata JSONB,
  created_at TIMESTAMP DEFAULT now()
);
```

**Chief Quant prompt update**:
- When running discovery swarms, emit `[DISPLAY: discovery_matrix]`
- Include strategy types and target regimes

**Success Criteria**:
- Discovery matrix shows live swarm progress
- Swarm grid upgrades to prominent display
- Funnel chart updates as strategies advance

**Estimated Time**: 10-12 hours

---

### Phase 4: Backtest/Tune Visualizations
**Goal**: See performance across time and parameters

**Files to create**:
1. `src/components/visualizations/PerformanceHeatMap.tsx`
   - Strategy × Year heat map
   - Color by Sharpe ratio (or other metric)
   - Click cell to see run details
   - Metric toggle dropdown

2. `src/components/visualizations/EquityCurveOverlay.tsx`
   - Multi-strategy equity curve chart
   - Toggle strategies on/off
   - Drawdown period highlighting
   - Regime overlay bands

3. `src/components/visualizations/ParameterSensitivitySurface.tsx`
   - 2D heat map of parameter × performance
   - Interactive parameter exploration
   - Optimal region highlighting

4. `src/components/visualizations/BacktestQueue.tsx`
   - Active/queued backtest display
   - Progress indicators
   - Completion stats

**Chief Quant prompt update**:
- When analyzing backtest results, emit `[DISPLAY: performance_heatmap]`
- When tuning parameters, emit `[DISPLAY: parameter_sensitivity]`

**Success Criteria**:
- Performance heat map shows historical results
- Equity curves overlay smoothly
- Parameter surface identifies optimal regions

**Estimated Time**: 12-15 hours

---

### Phase 5: Portfolio Visualizations
**Goal**: See the final regime × convexity portfolio

**Files to modify/create**:
1. **Upgrade** `src/components/dashboard/SymphonyOrchestra.tsx`
   - Add live pulse animation to current regime
   - Show active strategies in each quadrant
   - Real-time P&L overlay
   - Make it HERO size when stage = 'portfolio'

2. `src/components/visualizations/GreeksDashboard.tsx`
   - Portfolio Greeks bars (Delta, Gamma, Vega, Theta)
   - Target vs. actual comparison
   - Risk limit warnings
   - Historical trajectory chart

3. `src/components/visualizations/AllocationSankey.tsx`
   - Sankey flow diagram: Regime → Strategy → Greeks
   - Width = allocation percentage
   - Color = performance/risk
   - Interactive filtering

**Database additions**:
```sql
CREATE TABLE portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  journey_id UUID REFERENCES research_journeys(id),
  snapshot_time TIMESTAMP DEFAULT now(),
  current_regime TEXT,
  allocations JSONB, -- {strategy_id: weight}
  greeks JSONB, -- {delta, gamma, vega, theta}
  pnl REAL
);
```

**Chief Quant prompt update**:
- When building portfolio, emit `[DISPLAY: symphony]`
- Include current regime and allocations

**Success Criteria**:
- Symphony Orchestra displays as hero visualization
- Greeks dashboard shows live portfolio exposure
- Sankey diagram flows from regimes to Greeks

**Estimated Time**: 10-12 hours

---

### Phase 6: Status Strip + Journey Map
**Goal**: Always-visible progress and navigation

**Files to create**:
1. `src/components/status/ChiefQuantStatus.tsx`
   - Top status bar component
   - Shows: stage icon, operation, progress bar, time, cancel button
   - Smooth transitions between states

2. `src/components/journey/JourneyMap.tsx`
   - Horizontal stage progress indicator
   - Stage badges with status (completed/current/future)
   - Click to see stage summary
   - Smooth animations between stages

3. `src/components/journey/ActivityLog.tsx`
   - Scrollable timeline of actions
   - Group by stage
   - Show artifacts created (memory, runs, reports)
   - Click to jump to chat message
   - Filter controls

**Integration**:
- Add to `src/pages/Index.tsx` layout above chat area
- Add ActivityLog as tab in RightPanel

**Success Criteria**:
- Status strip always visible at top
- Journey map shows current position
- Activity log tracks all Chief Quant actions

**Estimated Time**: 8-10 hours

---

### Phase 7: ADHD Constraints Layer
**Goal**: Ensure baseline usability and smooth UX

**Files to create**:
1. `src/lib/adhdConstraints.ts`
   - Define always-visible rules
   - Transition timing constants
   - Focus management utilities

**Rules to enforce**:
1. **Always Visible** (non-negotiable):
   - Current stage indicator
   - Current operation status
   - Cancel/pause button
   - Progress indicator
   - "What should I ask next?" recommendations

2. **Animation/Transition Rules**:
   - Stage changes: 300ms smooth transition
   - New content: Slide in, don't pop
   - Completed items: Brief green flash, then settle
   - Errors: Red shake, stay visible until acknowledged
   - No jarring changes or sudden disappearances

3. **Visual Hierarchy**:
   - Active visualizations: Full contrast
   - Background info: Muted but readable
   - Clickable elements: Clear hover states
   - Loading states: Animated spinners, never blank

4. **Keyboard Shortcuts**:
   - ESC: Cancel current operation
   - Ctrl+K: Command palette
   - Ctrl+J: Toggle activity log
   - Tab: Navigate between visualizations

**Implementation**:
- Create HOC `withADHDConstraints` that wraps all visualization components
- Enforce visibility rules via React Context
- Add keyboard shortcut handlers to Index.tsx

**Success Criteria**:
- No jarring transitions or sudden changes
- ESC always cancels current operation
- Progress always visible during long operations
- Clear visual hierarchy in all states

**Estimated Time**: 6-8 hours

---

## Database Schema Complete

```sql
-- Research journeys (lifecycle tracking)
CREATE TABLE research_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  title TEXT NOT NULL,
  hypothesis TEXT,
  current_stage TEXT DEFAULT 'regime_mapping',
  stage_progress INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active', -- active, paused, completed
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  concluded_at TIMESTAMP,
  conclusion_summary TEXT
);

-- Stage history (activity log)
CREATE TABLE journey_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID REFERENCES research_journeys(id),
  stage TEXT NOT NULL,
  action_type TEXT NOT NULL, -- file_read, backtest, swarm, agent_mode, etc.
  action_summary TEXT,
  artifact_type TEXT, -- memory, run, report, candidate, classification
  artifact_id UUID,
  created_at TIMESTAMP DEFAULT now()
);

-- Regime classifications (heat map data)
CREATE TABLE regime_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  journey_id UUID REFERENCES research_journeys(id),
  date DATE NOT NULL,
  regime TEXT NOT NULL,
  confidence REAL,
  metrics JSONB, -- VIX, term structure, realized vol, etc.
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(workspace_id, date)
);

-- Strategy candidates (discovery matrix)
CREATE TABLE strategy_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  journey_id UUID REFERENCES research_journeys(id),
  strategy_name TEXT NOT NULL,
  target_regime TEXT NOT NULL,
  status TEXT DEFAULT 'testing', -- testing, promising, validated, rejected
  confidence REAL,
  discovery_metadata JSONB,
  created_at TIMESTAMP DEFAULT now(),
  validated_at TIMESTAMP
);

-- Portfolio snapshots (symphony data)
CREATE TABLE portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  journey_id UUID REFERENCES research_journeys(id),
  snapshot_time TIMESTAMP DEFAULT now(),
  current_regime TEXT,
  allocations JSONB, -- {strategy_id: weight}
  greeks JSONB, -- {delta, gamma, vega, theta}
  pnl REAL,
  risk_metrics JSONB
);

-- Link existing backtest_runs to journeys
ALTER TABLE backtest_runs ADD COLUMN journey_id UUID REFERENCES research_journeys(id);
```

---

## New Slash Commands

| Command | Purpose | Example |
|---------|---------|---------|
| `/journey start "hypothesis"` | Start a new research journey | `/journey start "Test convexity in high vol"` |
| `/journey status` | Show current stage and progress | `/journey status` |
| `/journey plan` | Ask Chief Quant to outline full research route | `/journey plan` |
| `/journey conclude` | Force synthesis and final report | `/journey conclude` |
| `/journey history` | Show all activities across stages | `/journey history` |
| `/journey resume <id>` | Resume a paused journey | `/journey resume abc-123` |
| `/show regime_timeline` | Force display regime heat map | `/show regime_timeline from=2020-01-01` |
| `/show discovery_matrix` | Force display strategy × regime grid | `/show discovery_matrix` |
| `/show performance_heatmap` | Force display year × strategy heat map | `/show performance_heatmap` |
| `/show symphony` | Force display portfolio orchestra | `/show symphony` |
| `/hide` | Hide all overlays, return to chat | `/hide` |

---

## Chief Quant Prompt Updates

**Add to `buildChiefQuantPrompt()` in `src/prompts/chiefQuantPrompt.ts`**:

```typescript
## UI Display Directives

You can control what the user sees by including display directives in your responses:

**Stage Control**:
- [STAGE: regime_mapping] - Set current research stage
- [PROGRESS: 45 message="Classifying Q2 2021"] - Update progress bar

**Visualization Control**:
- [DISPLAY: regime_timeline from=2020-01-01 to=2024-12-31] - Show regime heat map
- [DISPLAY: discovery_matrix] - Show strategy × regime grid
- [DISPLAY: performance_heatmap] - Show year × strategy performance
- [DISPLAY: symphony] - Show portfolio orchestra
- [HIDE] - Hide all overlays

**Focus Control**:
- [FOCUS: center] - Overlay visualization in center area
- [FOCUS: right] - Show visualization in right panel
- [FOCUS: modal] - Show visualization in modal dialog

**Usage Guidelines**:
1. **Regime Mapping**: When classifying regimes, show regime_timeline
2. **Strategy Discovery**: When running swarms, show discovery_matrix
3. **Backtesting**: When analyzing results, show performance_heatmap
4. **Portfolio**: When building portfolio, show symphony
5. **Always update progress**: Include [PROGRESS: X] during long operations

**Example Response**:
"I'm analyzing market regimes from 2020-2024 to build our regime map..."
[STAGE: regime_mapping]
[DISPLAY: regime_timeline from=2020-01-01 to=2024-12-31]
[PROGRESS: 0 message="Starting regime classification"]
```

---

## Testing Plan

### Phase 1 Testing: Display Infrastructure
- [ ] Chief Quant emits `[STAGE: regime_mapping]` → UI updates stage indicator
- [ ] Display directives parse correctly from text
- [ ] VisualizationContainer renders in correct location
- [ ] Context provides stage to all components

### Phase 2 Testing: Regime Mapping
- [ ] Regime timeline renders with mock data
- [ ] Heat map colors match regime types
- [ ] Animated cursor shows current position
- [ ] Clicking date shows metrics modal
- [ ] Chief Quant directive triggers display

### Phase 3 Testing: Strategy Discovery
- [ ] Discovery matrix shows strategy × regime grid
- [ ] Swarm grid upgrades to larger display
- [ ] Funnel chart shows conversion pipeline
- [ ] Clicking cells shows detailed runs
- [ ] Live updates as swarm progresses

### Phase 4 Testing: Backtest/Tune
- [ ] Performance heat map shows historical results
- [ ] Equity curves overlay multiple strategies
- [ ] Parameter surface identifies optimal regions
- [ ] Backtest queue shows active/queued runs
- [ ] Toggle metrics updates heat map

### Phase 5 Testing: Portfolio
- [ ] Symphony Orchestra displays as hero viz
- [ ] Live pulse animation on current regime
- [ ] Greeks dashboard shows portfolio exposure
- [ ] Sankey diagram flows correctly
- [ ] P&L overlay updates in real-time

### Phase 6 Testing: Status Strip + Journey Map
- [ ] Status strip always visible at top
- [ ] Journey map shows current stage
- [ ] Activity log tracks all actions
- [ ] Clicking stage shows summary
- [ ] Smooth transitions between stages

### Phase 7 Testing: ADHD Constraints
- [ ] ESC always cancels operation
- [ ] Progress always visible during work
- [ ] No jarring transitions
- [ ] Clear visual hierarchy
- [ ] Keyboard shortcuts work

---

## Success Metrics

### User Experience Goals
1. **Visual Clarity**: User can answer "What is Chief Quant doing right now?" by looking at visualizations
2. **Progress Tracking**: User always knows % complete and time remaining
3. **Stage Awareness**: User knows current research stage at all times
4. **Historical Review**: User can review what was done at each stage
5. **Decision Support**: Visualizations help user make research decisions

### Technical Goals
1. **Performance**: Visualizations render < 100ms
2. **Responsiveness**: UI updates within 200ms of directive
3. **Reliability**: No crashes during visualization transitions
4. **Accessibility**: Keyboard navigation works for all controls
5. **Mobile**: Visualizations adapt to smaller screens (future)

---

## Rollout Plan

### Week 1-2: Foundation
- Implement Phase 1 (Display Infrastructure)
- Implement Phase 6 (Status Strip + Journey Map)
- Implement Phase 7 (ADHD Constraints)
- **Deliverable**: Always-visible status and journey tracking

### Week 3-4: Regime Mapping
- Implement Phase 2 (Regime Mapping Visualizations)
- Update Chief Quant prompts for regime directives
- Test with mock regime classification workflow
- **Deliverable**: Visual regime mapping with heat map

### Week 5-6: Strategy Discovery
- Implement Phase 3 (Strategy Discovery Visualizations)
- Upgrade SwarmMonitor for prominence
- Test with swarm discovery workflow
- **Deliverable**: Visual strategy discovery with matrix and funnel

### Week 7-8: Backtest/Portfolio
- Implement Phase 4 (Backtest/Tune Visualizations)
- Implement Phase 5 (Portfolio Visualizations)
- Test full lifecycle workflow
- **Deliverable**: Complete visual research dashboard

### Week 9: Polish + Documentation
- Comprehensive testing across all phases
- User documentation and tutorial
- Performance optimization
- **Deliverable**: Production-ready visual dashboard

---

## Future Enhancements (Post-MVP)

1. **Regime Timeline Enhancements**:
   - Drill-down to intraday regime changes
   - Regime transition analysis (what triggers changes)
   - Comparison with user-defined regime definitions

2. **Strategy Discovery Enhancements**:
   - Real-time swarm chat messages display
   - Strategy DNA visualization (convexity profile charts)
   - Genetic algorithm ancestry tree

3. **Backtest Enhancements**:
   - 3D parameter surface rotation
   - Walk-forward optimization visualizations
   - Monte Carlo simulation fans

4. **Portfolio Enhancements**:
   - Live trading integration (paper trading)
   - Risk scenario projections
   - What-if regime change simulations

5. **Export/Sharing**:
   - Export visualizations as PNG/PDF
   - Generate PowerPoint decks
   - Share journey snapshots via URL

---

## Conclusion

This plan creates a **Visual Research Dashboard** that transforms the Quant Chat Workbench from a text-only interface into a dynamic, visual research environment where:

1. **You see what Chief Quant sees** - visualizations update as work progresses
2. **Stage-appropriate displays** - regime mapping shows heat maps, discovery shows swarm grids, etc.
3. **Chief Quant controls the UI** - by emitting display directives in responses
4. **ADHD-friendly design** - progress always visible, cancel always accessible, smooth transitions
5. **Full lifecycle tracking** - from initial regime mapping through validated portfolio
6. **The end goal is clear** - Symphony Orchestra shows the regime × convexity portfolio being built

The ultimate outcome: **A portfolio of convexity profiles matched with regimes to generate alpha based on the unique pairing of market regime with convexity profile trading strategies.**
