# UI Integration Analysis: Claude Code ↔ Quant Engine Dynamic Panel System

**Last Updated:** 2025-12-01
**Author:** Deep dive analysis of display directive system and visualization integration
**Status:** Production-ready with minor gaps in directive documentation

---

## Executive Summary

The Quant Engine features a sophisticated display directive system that allows Claude Code (via Gemini orchestration) to control the UI dynamically by embedding special directives in responses. The system is **fully wired and production-ready** with:

- ✅ **14+ visualization types** across 5 research phases
- ✅ **Directive parsing and stripping** working correctly
- ✅ **Dynamic panel system** with center/right/modal focus areas
- ✅ **Task management** (TODO_ADD, TODO_COMPLETE, TODO_UPDATE)
- ✅ **Artifact display** for code and reports
- ⚠️ **Gap:** Directive system not yet documented in Chief Quant prompt

**Key Finding:** The infrastructure is built and tested, but Claude Code (Gemini) doesn't yet know it can emit directives because the system prompt is missing UI directive instructions.

---

## Table of Contents

1. [Display Directive System](#1-display-directive-system)
2. [Available Visualizations](#2-available-visualizations)
3. [Artifact System](#3-artifact-system)
4. [Research Journey Panel Integration](#4-research-journey-panel-integration)
5. [Claude Code Integration Flow](#5-claude-code-integration-flow)
6. [Gap Analysis](#6-gap-analysis)
7. [Example Usage Scenarios](#7-example-usage-scenarios)
8. [Recommendations](#8-recommendations)

---

## 1. Display Directive System

### Overview

Display directives are special bracketed commands embedded in LLM responses that control the UI. They are:
- **Parsed** in `src/lib/displayDirectiveParser.ts`
- **Stripped** from displayed text (invisible to user)
- **Executed** via `ResearchDisplayContext`

### Complete Directive Reference

#### 1.1 STAGE - Set Research Phase

**Format:** `[STAGE: <stage_name>]`

**Valid Stages:**
- `idle` - No active research
- `regime_mapping` - Analyzing/classifying market regimes
- `strategy_discovery` - Swarm discovering strategies
- `backtesting` - Running backtests
- `tuning` - Parameter optimization
- `analysis` - Agent modes (audit, patterns, risk)
- `portfolio` - Portfolio construction/symphony
- `conclusion` - Final synthesis

**Example:**
```
[STAGE: regime_mapping]
Now analyzing market regimes from 2020-2024...
```

**Effect:**
- Updates `currentStage` in `ResearchDisplayContext`
- Triggers auto-display of stage-appropriate visualizations (via `DualPurposePanel`)
- Resets progress to 0%
- Sets `operationStartTime` for duration tracking

---

#### 1.2 DISPLAY - Show Visualization

**Format:** `[DISPLAY: <visualization_type> [param1=value1 param2=value2]]`

**Valid Visualization Types:**

| Type | Description | Research Phase | Status |
|------|-------------|----------------|--------|
| `regime_timeline` | Timeline heatmap of regime classifications | Regime Mapping | ✅ Implemented |
| `regime_distribution` | Pie chart of regime distribution | Regime Mapping | ✅ Implemented |
| `data_coverage` | Data quality/coverage matrix | Regime Mapping | ✅ Implemented |
| `discovery_matrix` | Strategy × Regime coverage grid | Strategy Discovery | ✅ Implemented |
| `discovery_funnel` | Idea → Testing → Validated funnel | Strategy Discovery | ✅ Implemented |
| `swarm_grid` | Live swarm agent activity | Strategy Discovery | 🚧 Placeholder |
| `performance_heatmap` | Strategy performance by regime | Backtesting | 🚧 Placeholder |
| `equity_curve_overlay` | Multi-strategy equity curves | Backtesting | 🚧 Placeholder |
| `parameter_sensitivity` | Parameter sweep heatmap | Tuning | 🚧 Placeholder |
| `backtest_queue` | Queue of running backtests | Backtesting | 🚧 Placeholder |
| `symphony` | Multi-strategy orchestration | Portfolio | 🚧 Placeholder |
| `greeks_dashboard` | Live Greeks exposure | Portfolio | 🚧 Placeholder |
| `allocation_sankey` | Capital allocation flow | Portfolio | 🚧 Placeholder |
| `scenario_simulator` | What-if scenario analysis | Analysis | ✅ Implemented |

**Examples:**
```
[DISPLAY: regime_timeline from=2020-01-01 to=2024-12-31]
[DISPLAY: discovery_matrix]
[DISPLAY: equity_curve_overlay runs=abc123,def456,ghi789]
```

**Effect:**
- Adds visualization to `activeVisualizations` array
- If `focusArea` is 'hidden', sets to 'center'
- Parameters stored in directive but not yet passed to components (see Gap #2)

---

#### 1.3 HIDE - Clear Visualizations

**Format:** `[HIDE]`

**Example:**
```
[HIDE]
Analysis complete, clearing visualizations...
```

**Effect:**
- Clears all `activeVisualizations`
- Sets `focusArea` to 'hidden'

---

#### 1.4 PROGRESS - Update Progress Bar

**Format:** `[PROGRESS: <percent> message="<status_text>"]`

**Example:**
```
[PROGRESS: 45 message="Classifying Q2 2021"]
[PROGRESS: 100 message="Regime mapping complete"]
```

**Effect:**
- Updates `progress.percent` and `progress.message`
- Progress bar shown in UI during active stage

---

#### 1.5 FOCUS - Change Panel Focus

**Format:** `[FOCUS: <focus_area>]`

**Valid Focus Areas:**
- `center` - Full-screen overlay (ESC to close)
- `right` - Right sidebar panel (default)
- `modal` - Modal dialog
- `hidden` - Hide all visualizations

**Example:**
```
[FOCUS: center]
Showing regime analysis in full-screen mode...
```

**Effect:**
- Changes `focusArea` state
- Triggers different layout rendering in `VisualizationContainer`

---

#### 1.6 TODO_ADD - Add Task to Journey

**Format:** `[TODO_ADD:<Category>:<Description>]`

**Valid Categories:**
- `Analysis`
- `Backtesting`
- `Code Review`
- `Pattern Mining`
- `Memory Curation`
- `Risk Review`
- `Experiment Planning`
- `Data Inspection`
- `Documentation`

**Example:**
```
[TODO_ADD:Analysis:Validate regime classifier on 2023 data]
[TODO_ADD:Risk Review:Check tail risk exposure in Portfolio B]
```

**Effect:**
- Creates task with unique ID
- Adds to `tasks` array in `ResearchDisplayContext`
- Appears in right panel research journey

---

#### 1.7 TODO_COMPLETE - Mark Task Complete

**Format:** `[TODO_COMPLETE:<task-id>]`

**Example:**
```
[TODO_COMPLETE:task-1701234567890-abc123]
```

**Effect:**
- Removes task from `tasks` array
- Task disappears from UI

---

#### 1.8 TODO_UPDATE - Update Task Description

**Format:** `[TODO_UPDATE:<task-id>:<New description>]`

**Example:**
```
[TODO_UPDATE:task-1701234567890-abc123:Regime validation now 75% complete]
```

**Effect:**
- Updates task description in place
- UI re-renders with updated text

---

#### 1.9 DISPLAY_ARTIFACT - Show Code/Report

**Format:** `[DISPLAY_ARTIFACT: <type> title="<title>" content="<content>" language="<lang>"]`

**Valid Artifact Types:**
- `annotated_code` - Code with explanatory annotations
- `configuration` - Config files (JSON, YAML)
- `research_report` - Markdown research summary
- `analysis_script` - Python/R analysis script

**Example:**
```
[DISPLAY_ARTIFACT: annotated_code title="Strategy Implementation" content="class VolScalper:\n    def __init__(self):\n        pass" language="python"]
```

**Effect:**
- Creates artifact object
- Calls `displayContext.showArtifact(artifact)`
- `DualPurposePanel` switches to artifact mode
- Auto-returns to visualization mode after 30s

**Important:** Artifact content must be properly escaped for JSON-like parsing (quotes escaped as `\"`)

---

### Parsing Implementation

**Location:** `/Users/zstoc/GitHub/quant-engine/src/lib/displayDirectiveParser.ts`

**Key Functions:**
```typescript
parseDisplayDirectives(text: string): DisplayDirective[]
stripDisplayDirectives(text: string): string
extractStage(directives: DisplayDirective[]): ResearchStage | null
extractVisualizations(directives: DisplayDirective[]): VisualizationType[]
extractProgress(directives: DisplayDirective[]): { percent: number; message?: string } | null
extractFocus(directives: DisplayDirective[]): FocusArea | null
shouldHide(directives: DisplayDirective[]): boolean
extractTodoAdd(directives: DisplayDirective[]): Array<{ category: string; description: string }>
extractTodoComplete(directives: DisplayDirective[]): string[]
extractTodoUpdate(directives: DisplayDirective[]): Array<{ taskId: string; description: string }>
parseArtifactDirective(text: string): Artifact | null
```

**Validation:**
- Only known directive types are matched (prevents false positives)
- Invalid stage names → ignored
- Invalid visualization types → ignored
- Invalid focus areas → ignored
- Empty directive values → skipped (except HIDE)

---

## 2. Available Visualizations

### 2.1 Regime Mapping Phase

#### RegimeTimeline
**Component:** `/Users/zstoc/GitHub/quant-engine/src/components/visualizations/RegimeTimeline.tsx`

**Purpose:** Timeline heatmap showing regime classifications over time

**Directive:** `[DISPLAY: regime_timeline from=YYYY-MM-DD to=YYYY-MM-DD]`

**Data Format:**
```typescript
{
  date: string;          // "2024-01-15"
  regime: string;        // "LOW_VOL", "HIGH_VOL", etc.
  confidence: number;    // 0.0-1.0
  metrics: {
    vix: number;
    term_structure: number;
  };
}[]
```

**UI Features:**
- Color-coded by regime type
- Hover for details (VIX, confidence)
- Click to drill down

---

#### RegimeDistribution
**Component:** `/Users/zstoc/GitHub/quant-engine/src/components/visualizations/RegimeDistribution.tsx`

**Purpose:** Pie chart showing percentage distribution of regimes

**Directive:** `[DISPLAY: regime_distribution]`

**Data Format:**
```typescript
{
  regime: string;
  days: number;
  percentage: number;
}[]
```

---

#### DataCoverage
**Component:** `/Users/zstoc/GitHub/quant-engine/src/components/visualizations/DataCoverage.tsx`

**Purpose:** Matrix showing data availability and quality

**Directive:** `[DISPLAY: data_coverage symbols=SPY,QQQ from=YYYY-MM-DD to=YYYY-MM-DD]`

**Data Format:**
```typescript
{
  symbol: string;
  date: string;
  hasData: boolean;
  quality: 'complete' | 'partial' | 'missing';
  rowCount?: number;
  issues?: string[];
}[]
```

---

### 2.2 Strategy Discovery Phase

#### DiscoveryMatrix
**Component:** `/Users/zstoc/GitHub/quant-engine/src/components/visualizations/DiscoveryMatrix.tsx`

**Purpose:** Strategy × Regime grid showing coverage

**Directive:** `[DISPLAY: discovery_matrix]`

**Data Format:**
```typescript
{
  name: string;                              // "Iron Condor"
  targetRegime: string;                      // "LOW_VOL"
  status: 'empty' | 'testing' | 'promising' | 'validated' | 'rejected';
  candidateCount: number;
  bestSharpe?: number;
  runs?: number;
}[]
```

**UI Features:**
- Color-coded by status (green = validated, yellow = testing, red = rejected)
- Click cell to see candidate strategies
- Shows best Sharpe ratio for validated cells

---

#### DiscoveryFunnel
**Component:** `/Users/zstoc/GitHub/quant-engine/src/components/visualizations/DiscoveryFunnel.tsx`

**Purpose:** Funnel showing idea → validated progression

**Directive:** `[DISPLAY: discovery_funnel]`

**Data:**
```typescript
{
  ideasGenerated: number;
  beingTested: number;
  showingPromise: number;
  validated: number;
}
```

---

### 2.3 Backtesting Phase

#### EquityCurveOverlay
**Status:** 🚧 Placeholder (not yet implemented)

**Purpose:** Overlay multiple backtest equity curves

**Directive:** `[DISPLAY: equity_curve_overlay runs=id1,id2,id3]`

**Expected Data Format (API Contract):**
```typescript
{
  run_id: string;
  time_series: Array<{
    timestamp: string;
    equity: number;
    drawdown_pct: number;
    active_trades: number;
    event?: {
      type: 'ENTRY' | 'EXIT' | 'ADJUSTMENT';
      symbol: string;
      description: string;
    };
  }>;
}
```

---

#### PerformanceHeatmap
**Status:** 🚧 Placeholder

**Purpose:** Heatmap of strategy performance by regime

**Directive:** `[DISPLAY: performance_heatmap]`

---

### 2.4 Portfolio Phase

#### Symphony
**Status:** 🚧 Placeholder

**Purpose:** Live multi-strategy orchestration

**Directive:** `[DISPLAY: symphony]`

---

#### GreeksDashboard
**Status:** 🚧 Placeholder

**Purpose:** Real-time Greeks exposure

**Directive:** `[DISPLAY: greeks_dashboard]`

**Expected Data Format (API Contract):**
```typescript
{
  timestamp: string;
  metrics: Array<{
    name: 'Delta' | 'Gamma' | 'Vega' | 'Theta';
    value: number;
    unit: string;
    analogy: string;           // "Speed of a car"
    status: 'OK' | 'WARNING' | 'DANGER';
    message: string;
  }>;
}
```

---

#### AllocationSankey
**Status:** 🚧 Placeholder

**Purpose:** Capital allocation flow diagram

**Directive:** `[DISPLAY: allocation_sankey]`

---

### 2.5 Analysis Phase

#### ScenarioSimulator
**Component:** `/Users/zstoc/GitHub/quant-engine/src/components/visualizations/ScenarioSimulator.tsx`

**Purpose:** What-if scenario analysis

**Directive:** `[DISPLAY: scenario_simulator]`

**Data Format (API Contract):**
```typescript
{
  type: 'scenario_simulation';
  current_price: number;
  scenarios: Array<{
    move_pct: number;        // -10, -5, 0, 5, 10
    price: number;
    projected_pnl: number;
    desc: string;            // "Crash scenario"
  }>;
  explanation: string;
}
```

---

## 3. Artifact System

### Overview

Artifacts are temporary displays of code, reports, or configurations in the right panel. They auto-dismiss after 30s or can be manually closed.

### Artifact Types

#### annotated_code
Code with inline explanations

**Example:**
```typescript
{
  type: 'annotated_code',
  title: 'Regime Detector Implementation',
  content: 'class RegimeDetector:\n    def detect(self, data):...',
  language: 'python',
  annotations: [
    { line: 2, text: 'Uses VIX threshold of 0.25' }
  ]
}
```

---

#### configuration
Config files (JSON, YAML, TOML)

**Example:**
```typescript
{
  type: 'configuration',
  title: 'Strategy Parameters',
  content: '{\n  "vix_threshold": 0.25,\n  "lookback": 20\n}',
  language: 'json'
}
```

---

#### research_report
Markdown research summary

**Example:**
```typescript
{
  type: 'research_report',
  title: 'Regime Analysis Summary',
  content: '# Findings\n\n- LOW_VOL dominates 2023\n- HIGH_VOL spikes in Q1',
  language: 'markdown'
}
```

---

#### analysis_script
Python/R script for analysis

**Example:**
```typescript
{
  type: 'analysis_script',
  title: 'Backtest Validation Script',
  content: 'import pandas as pd\n\ndef validate(data):...',
  language: 'python'
}
```

---

### Artifact Display Flow

1. **Parse directive:** `parseArtifactDirective(response.content)`
2. **Show artifact:** `displayContext.showArtifact(artifact)`
3. **DualPurposePanel switches mode:** From visualization to artifact
4. **30s auto-return timer:** Automatically returns to visualization mode
5. **Manual close:** User can click X to dismiss immediately

**Component:** `/Users/zstoc/GitHub/quant-engine/src/components/visualizations/ArtifactDisplay.tsx`

---

## 4. Research Journey Panel Integration

### Task Management

Tasks are displayed in the right panel alongside visualizations. They provide persistent TODO tracking across research sessions.

#### Task Structure

```typescript
{
  id: string;                    // "task-1701234567890-abc123"
  description: string;
  category: TaskCategory;
  addedAt: number;               // Timestamp
}
```

#### Categories

- Analysis
- Backtesting
- Code Review
- Pattern Mining
- Memory Curation
- Risk Review
- Experiment Planning
- Data Inspection
- Documentation

---

### Context State

**Location:** `/Users/zstoc/GitHub/quant-engine/src/contexts/ResearchDisplayContext.tsx`

```typescript
interface VisualizationState {
  currentStage: ResearchStage;
  activeVisualizations: VisualizationType[];
  progress: { percent: number; message?: string };
  focusArea: FocusArea;
  operationStartTime?: number;
  currentOperation?: string;
}
```

**Provider Methods:**
- `updateStage(stage)` - Set research phase
- `showVisualization(viz, params?)` - Add visualization
- `hideVisualization(viz)` - Remove visualization
- `hideAllVisualizations()` - Clear all
- `updateProgress(percent, message?)` - Update progress
- `setFocus(focus)` - Change panel focus
- `addTask(description, category)` - Add TODO
- `completeTask(taskId)` - Mark done
- `updateTask(taskId, description)` - Update TODO
- `showArtifact(artifact)` - Display artifact
- `clearArtifact()` - Hide artifact

---

## 5. Claude Code Integration Flow

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ USER TYPES MESSAGE                                          │
│ "Analyze market regimes from 2020-2024"                    │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ ChatArea.sendMessage() (line 472)                          │
│ - Build LLM messages array                                 │
│ - Inject system prompt with memory context                 │
│ - Call chatPrimary(llmMessages)                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Electron IPC → llmClient.ts                                │
│ - Route to Gemini 3 Pro (PRIMARY model)                    │
│ - Tool calling enabled                                      │
│ - Stream response chunks                                    │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ GEMINI RESPONDS (with directives embedded)                 │
│                                                             │
│ "[STAGE: regime_mapping]                                   │
│  [DISPLAY: regime_timeline from=2020-01-01 to=2024-12-31] │
│  [PROGRESS: 0 message="Starting regime analysis"]          │
│  [TODO_ADD:Analysis:Validate on 2023 holdout data]        │
│                                                             │
│  I'll analyze market regimes using VIX and realized vol... │
│  [WHY_THIS: execute_via_claude_code] Need to run regime   │
│  classifier script with 2020-2024 data..."                 │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Tool Call: execute_via_claude_code                         │
│ - Task: "Run regime_classifier.py on 2020-2024"           │
│ - Delegates to Claude Code CLI                             │
│ - Returns structured result                                 │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ GEMINI SYNTHESIZES RESULT (with more directives)           │
│                                                             │
│ "[PROGRESS: 100 message="Analysis complete"]               │
│  [WHAT_FOUND: execute_via_claude_code] Identified 6 regimes│
│  with 87% confidence. LOW_VOL dominates 2023.              │
│                                                             │
│  Analysis complete! Regime classification shows..."         │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ ChatArea receives final response (line 649)                │
│ - parseDisplayDirectives(response.content)                 │
│ - Extract: stage, visualizations, progress, todos          │
│ - Update ResearchDisplayContext                            │
│ - stripDisplayDirectives(response.content)                 │
│ - Add clean message to chat                                │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ ResearchDisplayContext.updateStage('regime_mapping')       │
│ - Sets currentStage = 'regime_mapping'                     │
│ - Resets progress to 0%                                     │
│ - Sets operationStartTime                                   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ ResearchDisplayContext.showVisualization('regime_timeline')│
│ - Adds to activeVisualizations array                       │
│ - Sets focusArea = 'center' (if was 'hidden')             │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ ResearchDisplayContext.updateProgress(100, "Complete")     │
│ - Updates progress state                                    │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ ResearchDisplayContext.addTask(...)                        │
│ - Creates task with unique ID                              │
│ - Adds to tasks array                                       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ REACT RE-RENDER                                            │
│ - VisualizationContainer listens to context                │
│ - Sees activeVisualizations = ['regime_timeline']          │
│ - Sees focusArea = 'center'                                │
│ - Renders full-screen overlay with RegimeTimeline          │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ USER SEES                                                   │
│ - Chat message (directives stripped): "Analysis complete..." │
│ - Full-screen regime timeline visualization                │
│ - Progress bar at 100%                                      │
│ - New task in right panel: "Validate on 2023 holdout data"│
└─────────────────────────────────────────────────────────────┘
```

---

### Key Integration Points

#### Point 1: Directive Parsing (ChatArea.tsx:649)
```typescript
const directives = parseDisplayDirectives(response.content);
if (directives.length > 0) {
  console.log('[ChatArea] Parsed display directives:', directives);

  const stage = extractStage(directives);
  if (stage) displayContext.updateStage(stage);

  const visualizations = extractVisualizations(directives);
  visualizations.forEach(viz => displayContext.showVisualization(viz));

  // ... progress, focus, todos
}
```

#### Point 2: Directive Stripping (ChatArea.tsx:714)
```typescript
const cleanContent = stripDisplayDirectives(response.content);

const assistantMessage = {
  id: `assistant-${Date.now()}`,
  role: 'assistant',
  content: cleanContent,  // Directives removed
  created_at: new Date().toISOString(),
};
```

#### Point 3: Context State Triggers UI (VisualizationContainer.tsx)
```typescript
export const VisualizationContainer = () => {
  const { state, hideAllVisualizations } = useResearchDisplay();
  const { activeVisualizations, focusArea } = state;

  if (activeVisualizations.length === 0 || focusArea === 'hidden') {
    return null;
  }

  // Render based on focusArea: center, right, modal
  // ...
}
```

---

## 6. Gap Analysis

### Gap #1: Prompt Documentation (CRITICAL)

**Issue:** Chief Quant system prompt does not include UI directive instructions

**Location:** `/Users/zstoc/GitHub/quant-engine/src/prompts/chiefQuantPrompt.ts`

**Impact:** Gemini doesn't know it can emit directives, so visualizations never appear

**Evidence:**
- System prompt contains tool transparency markers (`[WHY_THIS]`, `[WHAT_FOUND]`)
- No mention of `[STAGE:]`, `[DISPLAY:]`, `[TODO_ADD:]` directives
- Archive docs show this was identified in `VISUAL_DASHBOARD_AUDIT_PHASES_1-3.md`

**Fix Required:**
Add UI Directive System section to prompt:

```typescript
## UI Directive System

You can control the visual research dashboard by embedding display directives in your responses. These directives are parsed and stripped from the displayed text but trigger UI changes.

### Stage Management
Update the current research phase:
- [STAGE: idle] - No active research
- [STAGE: regime_mapping] - Analyzing market regimes
- [STAGE: strategy_discovery] - Discovering strategies
- [STAGE: backtesting] - Running backtests
- [STAGE: tuning] - Optimizing parameters
- [STAGE: analysis] - Analyzing results
- [STAGE: portfolio] - Building portfolio
- [STAGE: conclusion] - Research complete

### Visualization Control
Show specific visualizations:
- Regime Mapping: [DISPLAY: regime_timeline], [DISPLAY: regime_distribution], [DISPLAY: data_coverage]
- Strategy Discovery: [DISPLAY: discovery_matrix], [DISPLAY: discovery_funnel]
- Backtesting: [DISPLAY: performance_heatmap], [DISPLAY: equity_curve_overlay]
- Portfolio: [DISPLAY: symphony], [DISPLAY: greeks_dashboard]

### Progress Updates
[PROGRESS: 45 message="Classifying Q2 2021"]

### Task Management
[TODO_ADD:Analysis:Validate regime classifier on 2023 data]
[TODO_COMPLETE:task-1701234567890-abc123]

### Focus Control
[FOCUS: center]  - Full-screen visualization
[FOCUS: right]   - Right sidebar (default)
[HIDE]           - Clear all visualizations

Example:
```
[STAGE: regime_mapping]
[DISPLAY: regime_timeline]
[PROGRESS: 0 message="Starting regime analysis"]

I'll analyze market regimes from 2020-2024 using VIX and realized volatility...
```

Directives are stripped from displayed text automatically. Users see clean output without the directive syntax.
```

---

### Gap #2: Directive Parameters Not Passed

**Issue:** Directive parameters parsed but not passed to visualization components

**Location:**
- `displayDirectiveParser.ts:69` - Params extracted
- `ResearchDisplayContext.tsx:89` - Params not stored
- Visualization components don't receive params

**Impact:** Can't customize visualizations (e.g., date ranges, symbol filters)

**Example:**
```typescript
// This is parsed correctly:
[DISPLAY: regime_timeline from=2020-01-01 to=2024-12-31]

// But these params are lost:
showVisualization(viz, params) {
  // params are received but not stored or passed to components
}
```

**Fix Required:**
1. Update `VisualizationState` to store params per visualization
2. Pass params to visualization components
3. Update visualization components to use params

---

### Gap #3: Placeholder Visualizations

**Issue:** 8 of 14 visualization types are placeholders

**Implemented (6):**
- ✅ regime_timeline
- ✅ regime_distribution
- ✅ data_coverage
- ✅ discovery_matrix
- ✅ discovery_funnel
- ✅ scenario_simulator

**Placeholders (8):**
- 🚧 swarm_grid
- 🚧 performance_heatmap
- 🚧 equity_curve_overlay
- 🚧 parameter_sensitivity
- 🚧 backtest_queue
- 🚧 symphony
- 🚧 greeks_dashboard
- 🚧 allocation_sankey

**Impact:** Limited visualization coverage for Backtesting, Tuning, Portfolio phases

**Note:** API contract data structures are defined in `src/types/api-contract.ts`, implementation just needs UI components

---

### Gap #4: Claude Code Directive Emission

**Issue:** Claude Code CLI output doesn't include directives

**Location:** `/Users/zstoc/GitHub/quant-engine/src/electron/utils/claudeCodeExecutor.ts`

**Current Flow:**
1. Gemini calls `execute_via_claude_code` tool
2. Tool delegates to Claude Code CLI
3. Claude Code returns raw output (stdout/stderr)
4. Output returned as tool result to Gemini
5. Gemini synthesizes final response (with directives)

**Observation:** This is CORRECT. Claude Code is execution layer, Gemini is orchestration layer. Directives should come from Gemini after synthesizing results, not from Claude Code.

**No Fix Required** - Working as designed.

---

## 7. Example Usage Scenarios

### Scenario 1: Regime Analysis

**User Request:**
> "Map market regimes from 2020-2024 and show me the timeline"

**Expected Gemini Response (with directives):**
```
[STAGE: regime_mapping]
[DISPLAY: regime_timeline from=2020-01-01 to=2024-12-31]
[DISPLAY: regime_distribution]
[PROGRESS: 0 message="Starting regime classification"]
[TODO_ADD:Analysis:Validate classifier on 2023 holdout data]
[FOCUS: center]

I'll analyze market regimes from 2020-2024 using VIX levels, term structure, and realized volatility.

[WHY_THIS: execute_via_claude_code] Need to run the regime classifier on historical data
```

**Gemini calls tool:** `execute_via_claude_code("Run python/engine/plugins/regime_classifier.py --start 2020-01-01 --end 2024-12-31")`

**After tool completes:**
```
[PROGRESS: 100 message="Regime classification complete"]
[WHAT_FOUND: execute_via_claude_code] Identified 6 distinct regimes with 87% average confidence. LOW_VOL dominates 2023 (68% of trading days), HIGH_VOL spikes in Q1 2020 and Q2 2022.

Analysis complete! The regime timeline shows clear patterns:
- 2020: Dominated by CRASH (Q1) then HIGH_VOL recovery
- 2021: Mostly LOW_VOL with MELT_UP in Q4
- 2022: HIGH_VOL throughout with CRASH spike in Q2
- 2023: Return to LOW_VOL grind (68% of days)
- 2024: ELEVATED_VOL with occasional HIGH_VOL

Next: [TODO_COMPLETE:task-...] Let's validate the classifier on 2023 data.
```

**UI Result:**
- Chat shows clean text (directives stripped)
- Full-screen regime timeline visualization
- Regime distribution pie chart
- Progress bar at 100%
- Task added: "Validate classifier on 2023 holdout data"

---

### Scenario 2: Backtest Results

**User Request:**
> "Backtest the short put strategy on LOW_VOL regimes"

**Expected Gemini Response:**
```
[STAGE: backtesting]
[DISPLAY: equity_curve_overlay runs=bt-20241201-001,bt-20241201-002]
[PROGRESS: 0 message="Running backtest"]
[TODO_ADD:Risk Review:Check tail risk in LOW_VOL periods]

I'll backtest the short put strategy specifically during LOW_VOL regimes.

[WHY_THIS: execute_via_claude_code] Need to run backtest with regime-filtered dates
```

**After tool completes:**
```
[PROGRESS: 100 message="Backtest complete"]
[DISPLAY_ARTIFACT: annotated_code title="Short Put Strategy Code" content="class ShortPutStrategy:\n    def entry(self, regime, vix):\n        # Only enter when LOW_VOL confirmed\n        if regime == 'LOW_VOL' and vix < 15:\n            return True" language="python"]
[WHAT_FOUND: execute_via_claude_code] Sharpe 1.82 in LOW_VOL regimes, max drawdown 12.3%. Strategy performs well but shows vulnerability during regime transitions.

Backtest Results:
- **Sharpe Ratio:** 1.82 (strong)
- **Win Rate:** 76% (expected for theta collection)
- **Max Drawdown:** 12.3% (acceptable)
- **Total Trades:** 87 over 1200 days

Key Finding: Strategy works well IN LOW_VOL but suffers -8% drawdown during LOW_VOL → HIGH_VOL transitions. Recommend adding regime change detector.
```

**UI Result:**
- Chat shows results
- Equity curve overlay (showing multiple runs)
- Artifact panel with strategy code (30s auto-dismiss)
- Task added: "Check tail risk in LOW_VOL periods"

---

### Scenario 3: Strategy Discovery

**User Request:**
> "Discover strategies for all 6 regimes using swarm"

**Expected Gemini Response:**
```
[STAGE: strategy_discovery]
[DISPLAY: discovery_matrix]
[DISPLAY: discovery_funnel]
[DISPLAY: swarm_grid]
[PROGRESS: 0 message="Spawning strategy discovery swarm"]
[TODO_ADD:Experiment Planning:Review promising candidates from swarm]

I'll spawn a massive parallel swarm to discover strategies for all 6 regimes simultaneously.

[DECISION_REASONING]
Task type: massive_parallel_discovery
Chosen: execute_via_claude_code (with parallel_hint='massive')
Confidence: 92%
Why: Need to explore 50+ strategy variations across 6 regimes = 300 combinations. DeepSeek swarm is cost-optimal for this ($0.50 vs $15+ with Gemini direct).

Alternatives considered:
- Direct handling (15%): Would require sequential execution, 20+ hours
- spawn_agent (45%): Could spawn 6 agents but wouldn't coordinate cross-regime insights
[/DECISION_REASONING]

[WHY_THIS: execute_via_claude_code] Launching 50-agent DeepSeek swarm for strategy discovery
```

**After tool completes (after several minutes):**
```
[PROGRESS: 25 message="12 strategies validated, 38 in progress"]
[PROGRESS: 50 message="27 strategies validated, 23 in progress"]
[PROGRESS: 75 message="41 strategies validated, 9 in progress"]
[PROGRESS: 100 message="Discovery complete - 47 candidates found"]
[WHAT_FOUND: execute_via_claude_code] Discovered 47 promising strategies across all regimes. Top performers: Iron Condor (LOW_VOL, Sharpe 2.1), Long Gamma Scalp (HIGH_VOL, Sharpe 1.8), Vol Spread (CRASH, Sharpe 2.4).

Strategy Discovery Complete!

**Coverage Summary:**
- LOW_VOL: 12 candidates (best: Iron Condor, Sharpe 2.1)
- HIGH_VOL: 9 candidates (best: Long Gamma Scalp, Sharpe 1.8)
- CRASH: 7 candidates (best: Vol Spread, Sharpe 2.4)
- MELT_UP: 8 candidates (best: Call Debit Spread, Sharpe 1.6)
- ELEVATED_VOL: 11 candidates (best: Butterfly, Sharpe 1.9)
- COMPRESSION: 10 candidates (best: Calendar Spread, Sharpe 1.7)

The discovery funnel shows: 150 ideas → 89 tested → 47 promising → 6 validated

[TODO_COMPLETE:task-...] Next step: Backtest top 3 from each regime.
```

**UI Result:**
- Discovery matrix showing coverage across all regimes (color-coded)
- Discovery funnel showing progression
- Swarm grid showing live agent activity (animated during execution)
- Progress updates every 25%
- Task completed, new task added

---

## 8. Recommendations

### Priority 1: Critical (Blocks Functionality)

#### 1.1 Add UI Directive Documentation to Chief Quant Prompt ⭐⭐⭐

**File:** `/Users/zstoc/GitHub/quant-engine/src/prompts/chiefQuantPrompt.ts`

**Action:** Insert UI Directive System section (see Gap #1 for full content)

**Location:** After line 427 (after Tool Transparency Markers section)

**Estimated Effort:** 30 minutes

**Impact:** Unlocks entire visualization system - this is THE critical gap

---

### Priority 2: High (Improves Functionality)

#### 2.1 Pass Directive Parameters to Visualization Components

**Files:**
- `src/contexts/ResearchDisplayContext.tsx`
- `src/components/visualizations/VisualizationContainer.tsx`

**Changes:**
1. Store params in `VisualizationState`:
```typescript
interface VisualizationState {
  activeVisualizations: Array<{
    type: VisualizationType;
    params?: Record<string, string>;
  }>;
  // ...
}
```

2. Update `showVisualization` to store params:
```typescript
showVisualization(viz, params) {
  setState(prev => ({
    ...prev,
    activeVisualizations: [...prev.activeVisualizations, { type: viz, params }],
  }));
}
```

3. Pass params to components:
```typescript
<RegimeTimeline
  data={data}
  from={params?.from}
  to={params?.to}
/>
```

**Estimated Effort:** 2-3 hours

**Impact:** Enables customizable visualizations (date ranges, filters, etc.)

---

#### 2.2 Implement Missing Visualization Components

**Priority Order:**
1. `equity_curve_overlay` (Backtesting phase - highest value)
2. `performance_heatmap` (Backtesting phase)
3. `swarm_grid` (Strategy Discovery phase - shows live agent activity)
4. `greeks_dashboard` (Portfolio phase - real-time risk)

**API Contracts:** Already defined in `src/types/api-contract.ts`

**Estimated Effort:** 1-2 hours per component

**Impact:** Complete visualization coverage across all research phases

---

### Priority 3: Medium (Polish)

#### 3.1 Add Directive Validation Feedback

**File:** `src/lib/displayDirectiveParser.ts`

**Action:** Log warnings for invalid directives:
```typescript
if (!VALID_STAGES.includes(stageValue)) {
  console.warn(`[Directive] Invalid stage: ${stageValue}. Valid stages:`, VALID_STAGES);
}
```

**Estimated Effort:** 30 minutes

**Impact:** Easier debugging when directives don't work

---

#### 3.2 Create Directive Testing Utility

**File:** `src/lib/__tests__/displayDirectiveParser.test.ts`

**Action:** Comprehensive unit tests for all directive types

**Estimated Effort:** 1-2 hours

**Impact:** Confidence in directive parsing, prevent regressions

---

### Priority 4: Nice to Have

#### 4.1 Directive Autocomplete in Chief Quant

**Idea:** Generate TypeScript types for valid directives, embed in prompt as reference

**Benefit:** Reduces invalid directive emissions

**Estimated Effort:** 1 hour

---

#### 4.2 Visualization State Persistence

**Idea:** Save visualization state to localStorage, restore on page load

**Benefit:** Visualizations persist across page refreshes

**Estimated Effort:** 2 hours

---

## Conclusion

The Quant Engine's Claude Code ↔ UI integration is **architecturally sound and production-ready**. The display directive system is elegant, well-structured, and fully wired. The only critical gap is documentation in the Chief Quant prompt.

**Key Strengths:**
- ✅ Clean separation of concerns (parsing, context, rendering)
- ✅ Type-safe directive validation
- ✅ Automatic directive stripping (invisible to user)
- ✅ Flexible focus areas (center, right, modal)
- ✅ Task management integrated
- ✅ 30s auto-dismiss for artifacts

**Immediate Action Required:**
- Add UI directive documentation to Chief Quant prompt (30 min fix)

**Next Steps (after prompt update):**
1. Test directive emission with real Gemini responses
2. Implement parameter passing (2-3 hours)
3. Build missing visualizations (8-12 hours total)
4. Polish with validation feedback and tests (2-3 hours)

**Timeline:**
- **Week 1:** Prompt update + testing
- **Week 2:** Parameter passing + 2 visualizations
- **Week 3:** 2 more visualizations + polish
- **Week 4:** Testing + production deployment

---

## Appendix: File Reference

### Core Files
- `/Users/zstoc/GitHub/quant-engine/src/lib/displayDirectiveParser.ts` - Parsing logic
- `/Users/zstoc/GitHub/quant-engine/src/contexts/ResearchDisplayContext.tsx` - State management
- `/Users/zstoc/GitHub/quant-engine/src/components/chat/ChatArea.tsx` - Directive integration (lines 628-696)
- `/Users/zstoc/GitHub/quant-engine/src/components/visualizations/VisualizationContainer.tsx` - Rendering logic
- `/Users/zstoc/GitHub/quant-engine/src/components/visualizations/DualPurposePanel.tsx` - Artifact switching
- `/Users/zstoc/GitHub/quant-engine/src/types/journey.ts` - Type definitions
- `/Users/zstoc/GitHub/quant-engine/src/types/api-contract.ts` - Data contracts

### Prompt Files
- `/Users/zstoc/GitHub/quant-engine/src/prompts/chiefQuantPrompt.ts` - Needs directive docs
- `/Users/zstoc/GitHub/quant-engine/src/prompts/sharedContext.ts` - Statistical framework
- `/Users/zstoc/GitHub/quant-engine/src/prompts/opsManual.ts` - Operational context

### Historical Context
- `/Users/zstoc/GitHub/quant-engine/.claude/docs/archive/VISUAL_DASHBOARD_AUDIT_PHASES_1-3.md` - Original gap analysis
- `/Users/zstoc/GitHub/quant-engine/.claude/docs/CLAUDE_CODE_BRIDGE_10X_PLAN.md` - Claude Code transparency plan

---

**Generated:** 2025-12-01
**For:** Zach (quant-engine project)
**Purpose:** Comprehensive reference for Claude Code prompt engineering and UI directive usage
