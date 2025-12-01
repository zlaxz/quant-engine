# Dynamic Visualization System - Eliminating the 6×6 Hardcoded Paradigm

**Date:** 2025-12-01
**Status:** Design Document
**Goal:** Transform from hardcoded regime/profile system to flexible, data-driven research workbench

---

## The Problem

The current system is **hardcoded to a specific research paradigm:**

### Hardcoded Assumptions
1. **Visualization Types** - `regime_timeline`, `discovery_matrix`, `equity_curve_overlay`
   - These names assume you're doing regime classification and profile discovery
   - Can't display charts for momentum strategies, pairs trading, or other paradigms

2. **Research Stages** - `regime_mapping`, `strategy_discovery`
   - Workflow is baked into the code
   - Other research flows don't fit

3. **UI Components** - RegimeTimeline, DiscoveryMatrix, etc.
   - Components are purpose-built for 6×6 system
   - Can't reuse for other research types

4. **Directive System** - Directives reference specific types, not pass data
   - `[DISPLAY: regime_timeline]` triggers hardcoded component
   - Doesn't let you show arbitrary charts with your data

**Result:** You can ONLY do regime-based convexity profile research. System is inflexible.

---

## The Vision: Data-Driven Dynamic System

### Core Principle
**Don't hardcode visualization types - pass data and let the UI render it.**

### Architecture

```
Old (Hardcoded):
[DISPLAY: regime_timeline]
  ↓
UI looks up "regime_timeline" → renders RegimeTimeline component
  ↓
Component fetches regime data from backend
  ↓
Displays hardcoded regime heatmap

New (Data-Driven):
[DISPLAY_CHART: {
  type: 'heatmap',
  title: 'Market Regimes 2020-2024',
  data: [[date, value], ...],
  config: { xLabel: 'Date', yLabel: 'Regime', colorScale: [...] }
}]
  ↓
UI receives COMPLETE DATA in directive
  ↓
Generic ChartRenderer component
  ↓
Renders based on type + data + config
  ↓
Displays ANY heatmap you want
```

---

## Design: Generic Visualization System

### 1. Generic Chart Types (Not Domain-Specific)

Replace hardcoded types with composable primitives:

| Old (Hardcoded) | New (Generic) | Use Case |
|-----------------|---------------|----------|
| `regime_timeline` | `HEATMAP` | Any temporal heatmap (regimes, correlations, volatility) |
| `regime_distribution` | `PIE_CHART` | Any distribution (regimes, sector allocation, Greeks) |
| `discovery_matrix` | `HEATMAP` | Any 2D grid (strategy×regime, stock×factor, correlation) |
| `equity_curve_overlay` | `LINE_CHART_MULTI` | Any time series (equity curves, prices, indicators) |
| `performance_heatmap` | `HEATMAP` | Any performance matrix |
| `parameter_sensitivity` | `HEATMAP` or `SURFACE_3D` | Any parameter analysis |
| `swarm_grid` | `STATUS_GRID` | Any agent/task status display |
| `greeks_dashboard` | `METRIC_DASHBOARD` | Any metric collection (Greeks, performance, risk) |
| `allocation_sankey` | `SANKEY_DIAGRAM` | Any flow diagram (capital, dependencies, chains) |

### 2. Data-Driven Directive Format

**Old Directive (Hardcoded):**
```
[DISPLAY: regime_timeline]
```
UI fetches regime data from backend, hardcoded logic, inflexible.

**New Directive (Data-Driven):**
```json
[DISPLAY_CHART: {
  "type": "heatmap",
  "title": "Market Regimes 2020-2024",
  "data": {
    "x": ["2020-01", "2020-02", ...],
    "y": ["Regime 1", "Regime 2", ...],
    "values": [[0.8, 0.2, ...], ...]
  },
  "config": {
    "xLabel": "Date",
    "yLabel": "Regime",
    "colorScale": "viridis",
    "tooltip": true
  }
}]
```
UI receives ALL data in directive, renders generic heatmap, fully flexible.

---

## Proposed New Directive System

### Core Directives (Generic)

#### DISPLAY_CHART
Display any chart type with provided data.

**Format:**
```json
[DISPLAY_CHART: {
  "id": "optional-id-for-updating",
  "type": "line" | "bar" | "heatmap" | "scatter" | "candlestick" | "surface3d",
  "title": "Chart Title",
  "data": <chart-specific-format>,
  "config": {
    "xLabel": "X Axis",
    "yLabel": "Y Axis",
    "legend": true,
    "tooltip": true,
    "height": 400,
    ...
  }
}]
```

**Chart Types:**

1. **LINE_CHART** (time series, equity curves, indicators)
```json
{
  "type": "line",
  "data": {
    "series": [
      {"name": "Strategy A", "values": [[date, value], ...]},
      {"name": "Strategy B", "values": [[date, value], ...]}
    ]
  }
}
```

2. **HEATMAP** (correlations, regimes, performance grids)
```json
{
  "type": "heatmap",
  "data": {
    "x": ["Label1", "Label2", ...],
    "y": ["Label1", "Label2", ...],
    "values": [[v11, v12, ...], [v21, v22, ...]]
  }
}
```

3. **BAR_CHART** (distributions, comparisons)
```json
{
  "type": "bar",
  "data": {
    "categories": ["Cat1", "Cat2", ...],
    "values": [10, 20, 30, ...]
  }
}
```

4. **SCATTER** (parameter sweeps, relationships)
```json
{
  "type": "scatter",
  "data": {
    "points": [[x, y, label], ...]
  }
}
```

5. **CANDLESTICK** (price data)
```json
{
  "type": "candlestick",
  "data": {
    "ohlc": [[date, open, high, low, close], ...]
  }
}
```

---

#### DISPLAY_TABLE
Display any tabular data.

**Format:**
```json
[DISPLAY_TABLE: {
  "id": "results-table",
  "title": "Backtest Results",
  "columns": [
    {"key": "strategy", "label": "Strategy", "type": "string"},
    {"key": "sharpe", "label": "Sharpe", "type": "number", "format": "0.00"},
    {"key": "return", "label": "Return", "type": "percent"}
  ],
  "rows": [
    {"strategy": "Momentum", "sharpe": 1.8, "return": 0.23},
    ...
  ],
  "config": {
    "sortable": true,
    "filterable": true,
    "exportable": true
  }
}]
```

---

#### DISPLAY_METRICS
Display key metrics dashboard.

**Format:**
```json
[DISPLAY_METRICS: {
  "title": "Strategy Performance",
  "metrics": [
    {"name": "Sharpe Ratio", "value": 1.8, "format": "0.00", "status": "good"},
    {"name": "Max Drawdown", "value": -0.15, "format": "0.0%", "status": "warning"},
    {"name": "Win Rate", "value": 0.58, "format": "0.0%", "status": "good"}
  ],
  "config": {
    "layout": "grid" | "row",
    "size": "compact" | "normal" | "large"
  }
}]
```

---

#### DISPLAY_CODE
Display code with syntax highlighting.

**Format:**
```json
[DISPLAY_CODE: {
  "title": "Strategy Implementation",
  "language": "python",
  "code": "class Strategy:\n    def run(self):\n        ...",
  "annotations": [
    {"line": 2, "text": "Entry logic here"}
  ],
  "highlightLines": [2, 3, 4]
}]
```

---

#### UPDATE_CHART / UPDATE_TABLE
Update existing display without recreating.

**Format:**
```json
[UPDATE_CHART: {
  "id": "equity-curve",
  "data": {
    "series": [...]  // New data
  }
}]
```

Enables real-time updates (e.g., equity curve growing as backtest runs).

---

#### DISPLAY_NOTIFICATION
Show toast/banner notification.

**Format:**
```json
[DISPLAY_NOTIFICATION: {
  "type": "info" | "success" | "warning" | "error",
  "title": "Backtest Complete",
  "message": "Sharpe ratio: 1.8",
  "duration": 5000
}]
```

---

### Generic Research Stages (Not Domain-Specific)

Replace:
```typescript
'idle' | 'regime_mapping' | 'strategy_discovery' | 'backtesting' | 'tuning' | 'analysis' | 'portfolio' | 'conclusion'
```

With:
```typescript
'idle' | 'exploring' | 'testing' | 'analyzing' | 'optimizing' | 'validating' | 'complete'
```

Or even better: **NO hardcoded stages** - just display directives that show/hide content.

---

## Implementation Plan

### Phase 1: Generic Chart Components (Foundation)

**Create new components in `src/components/charts/`:**

1. **GenericChart.tsx** - Universal chart renderer
   - Props: `type`, `data`, `config`
   - Uses Recharts/Plotly library
   - Supports all chart types via switch

2. **GenericTable.tsx** - Universal table renderer
   - Props: `columns`, `rows`, `config`
   - Sorting, filtering, export built-in

3. **MetricsDashboard.tsx** - Universal metrics display
   - Props: `metrics[]`
   - Grid/row layouts
   - Color-coded status

4. **CodeDisplay.tsx** - Universal code renderer
   - Props: `code`, `language`, `annotations`
   - Syntax highlighting via Prism/highlight.js

**Estimated Time:** 6-8 hours

---

### Phase 2: New Directive Parser (Data-Driven)

**Update `src/lib/displayDirectiveParser.ts`:**

**New Functions:**

```typescript
/**
 * Parse DISPLAY_CHART directive with embedded JSON data
 * Format: [DISPLAY_CHART: {...json...}]
 */
export function parseChartDirective(text: string): ChartDirective | null {
  const pattern = /\[DISPLAY_CHART:\s*(\{[^}]+\})\]/gi;
  const match = pattern.exec(text);
  if (!match) return null;

  try {
    const data = JSON.parse(match[1]);
    return {
      type: 'chart',
      id: data.id || generateId(),
      chartType: data.type,
      title: data.title,
      data: data.data,
      config: data.config || {}
    };
  } catch {
    console.warn('[Directive] Invalid DISPLAY_CHART JSON');
    return null;
  }
}

// Similar for parseTableDirective, parseMetricsDirective, etc.
```

**Estimated Time:** 3-4 hours

---

### Phase 3: Update Context to Handle Dynamic Data

**Update `src/contexts/ResearchDisplayContext.tsx`:**

**New State:**
```typescript
interface DynamicVisualizationState {
  charts: Map<string, ChartData>;      // By ID
  tables: Map<string, TableData>;      // By ID
  metrics: Map<string, MetricsData>;   // By ID
  code: Map<string, CodeData>;         // By ID
  notifications: NotificationData[];
}
```

**New Methods:**
```typescript
showChart(id: string, data: ChartData): void
updateChart(id: string, data: Partial<ChartData>): void
hideChart(id: string): void

showTable(id: string, data: TableData): void
showMetrics(id: string, data: MetricsData): void
showCode(id: string, data: CodeData): void
showNotification(notification: NotificationData): void
```

**Estimated Time:** 2-3 hours

---

### Phase 4: Generic Rendering Container

**Create `src/components/visualizations/DynamicRenderer.tsx`:**

```typescript
export function DynamicRenderer() {
  const { charts, tables, metrics, code } = useResearchDisplay();

  return (
    <div className="dynamic-display-area">
      {/* Render all active charts */}
      {Array.from(charts.values()).map(chart => (
        <GenericChart key={chart.id} {...chart} />
      ))}

      {/* Render all active tables */}
      {Array.from(tables.values()).map(table => (
        <GenericTable key={table.id} {...table} />
      ))}

      {/* Render all active metrics */}
      {Array.from(metrics.values()).map(metricSet => (
        <MetricsDashboard key={metricSet.id} {...metricSet} />
      ))}

      {/* Render all active code displays */}
      {Array.from(code.values()).map(codeBlock => (
        <CodeDisplay key={codeBlock.id} {...codeBlock} />
      ))}
    </div>
  );
}
```

**Estimated Time:** 1-2 hours

---

### Phase 5: Update Claude Code Prompt

**New directive documentation:**

```markdown
## UI Directive System (Data-Driven Visualizations)

Display ANY chart, table, or metric by embedding JSON data in your response.

**Chart Display:**
[DISPLAY_CHART: {"type": "line", "title": "Equity Curve", "data": {"series": [{"name": "Strategy", "values": [[date, value], ...]}]}}]

**Table Display:**
[DISPLAY_TABLE: {"title": "Results", "columns": [...], "rows": [...]}]

**Metrics Display:**
[DISPLAY_METRICS: {"title": "Performance", "metrics": [{"name": "Sharpe", "value": 1.8}, ...]}]

**Code Display:**
[DISPLAY_CODE: {"language": "python", "code": "class Strategy:\n    pass"}]

**Update Existing:**
[UPDATE_CHART: {"id": "equity-curve", "data": {...}}]

**Examples:**

Show momentum strategy backtest:
[DISPLAY_CHART: {"type": "line", "title": "Momentum Strategy Returns", "data": {"series": [{"name": "Returns", "values": [["2024-01", 1000], ["2024-02", 1050], ...]}]}}]

Show correlation matrix:
[DISPLAY_CHART: {"type": "heatmap", "title": "Stock Correlations", "data": {"x": ["SPY", "QQQ", "IWM"], "y": ["SPY", "QQQ", "IWM"], "values": [[1.0, 0.8, 0.6], [0.8, 1.0, 0.7], [0.6, 0.7, 1.0]]}}]

Show backtest results table:
[DISPLAY_TABLE: {"title": "Backtest Results", "columns": [{"key": "date", "label": "Date"}, {"key": "pnl", "label": "P&L"}], "rows": [{"date": "2024-01-01", "pnl": 150}, ...]}]
```

**Estimated Time:** 30 minutes

---

## Migration Path (Backwards Compatible)

### Phase 1: Parallel System (Both Work)
- Keep old directives working
- Add new generic directives
- Old: `[DISPLAY: regime_timeline]` → triggers old component
- New: `[DISPLAY_CHART: {...}]` → triggers new component
- Both systems coexist

### Phase 2: Migrate Existing Visualizations
- Convert each old visualization to new format
- RegimeTimeline → GenericChart with heatmap type
- DiscoveryMatrix → GenericChart with heatmap type
- etc.

### Phase 3: Deprecate Old System
- Remove old directive types
- Remove old components
- Only generic system remains

**Total Migration Time:** Can be done incrementally over weeks

---

## Technical Design

### New Component Architecture

```
src/components/
├── charts/                    # NEW: Generic chart library
│   ├── GenericChart.tsx       # Universal chart (line/bar/scatter/heatmap/candlestick)
│   ├── GenericTable.tsx       # Universal table
│   ├── MetricsDashboard.tsx   # Universal metrics
│   ├── CodeDisplay.tsx        # Universal code viewer
│   └── types.ts               # Data format interfaces
│
├── visualizations/            # OLD: Keep for backwards compat during migration
│   ├── RegimeTimeline.tsx     # Eventually delete
│   ├── DiscoveryMatrix.tsx    # Eventually delete
│   └── ...
│
└── research/                  # Research-specific (keep)
    ├── ToolCallTree.tsx
    ├── EvidenceChain.tsx
    └── ...
```

### Data Format Interfaces

```typescript
// Chart data (generic)
interface ChartData {
  id: string;
  type: 'line' | 'bar' | 'heatmap' | 'scatter' | 'candlestick' | 'surface3d' | 'pie';
  title: string;
  data: LineData | HeatmapData | ScatterData | ...; // Discriminated union
  config?: ChartConfig;
}

// Line chart data
interface LineData {
  series: Array<{
    name: string;
    values: Array<[number | string, number]>; // [x, y] pairs
    color?: string;
    style?: 'solid' | 'dashed' | 'dotted';
  }>;
}

// Heatmap data
interface HeatmapData {
  x: string[];           // X-axis labels
  y: string[];           // Y-axis labels
  values: number[][];    // 2D array [y][x]
  colorScale?: string;   // 'viridis', 'blues', 'reds', 'greens'
}

// Table data
interface TableData {
  id: string;
  title: string;
  columns: Array<{
    key: string;
    label: string;
    type: 'string' | 'number' | 'percent' | 'currency' | 'date';
    format?: string;     // Number format: '0.00', '0.0%', etc.
    sortable?: boolean;
  }>;
  rows: Array<Record<string, any>>;
  config?: {
    sortable?: boolean;
    filterable?: boolean;
    exportable?: boolean;
    pageSize?: number;
  };
}

// Metrics data
interface MetricsData {
  id: string;
  title: string;
  metrics: Array<{
    name: string;
    value: number | string;
    format?: string;
    unit?: string;
    status?: 'good' | 'warning' | 'danger' | 'neutral';
    change?: number;      // % change
    changeLabel?: string; // "vs last month"
  }>;
  config?: {
    layout: 'grid' | 'row';
    columns?: number;
  };
}
```

---

## Example: Momentum Strategy Research (NOT Regime-Based)

**User:** "Backtest a 20-day momentum strategy on SPY 2020-2024"

**Claude Code Output:**
```
[DISPLAY_METRICS: {
  "title": "Momentum Strategy Performance",
  "metrics": [
    {"name": "Sharpe Ratio", "value": 1.4, "format": "0.00", "status": "good"},
    {"name": "Total Return", "value": 0.34, "format": "0.0%", "status": "good"},
    {"name": "Max Drawdown", "value": -0.18, "format": "0.0%", "status": "warning"},
    {"name": "Win Rate", "value": 0.56, "format": "0.0%", "status": "neutral"}
  ]
}]

[DISPLAY_CHART: {
  "type": "line",
  "title": "Equity Curve: 20-Day Momentum on SPY",
  "data": {
    "series": [
      {"name": "Strategy", "values": [["2020-01-01", 10000], ["2020-01-02", 10050], ...]},
      {"name": "Buy & Hold", "values": [["2020-01-01", 10000], ["2020-01-02", 10020], ...]}
    ]
  },
  "config": {
    "xLabel": "Date",
    "yLabel": "Portfolio Value ($)",
    "legend": true
  }
}]

[DISPLAY_TABLE: {
  "title": "Monthly Returns",
  "columns": [
    {"key": "month", "label": "Month"},
    {"key": "return", "label": "Return", "type": "percent", "format": "0.00%"},
    {"key": "trades", "label": "Trades", "type": "number"}
  ],
  "rows": [
    {"month": "2020-01", "return": 0.05, "trades": 12},
    {"month": "2020-02", "return": -0.03, "trades": 15},
    ...
  ]
}]

Backtest complete. 20-day momentum showed Sharpe of 1.4 with 34% total return over the period.
```

**UI Shows:**
- Metrics dashboard with 4 key stats
- Line chart comparing strategy to buy-and-hold
- Table of monthly returns
- Clean chat message (directives stripped)

**No mention of regimes, profiles, or 6×6 paradigm!**

---

## Example: Pairs Trading Research

**User:** "Test pairs trading on XLF/XLE"

**Claude Code Output:**
```
[DISPLAY_CHART: {
  "type": "scatter",
  "title": "XLF vs XLE Spread Relationship",
  "data": {
    "points": [[spread_value, return, date_label], ...]
  },
  "config": {
    "xLabel": "Spread (XLF - XLE)",
    "yLabel": "Forward 5-Day Return",
    "colorBy": "date"
  }
}]

[DISPLAY_METRICS: {
  "title": "Pairs Trading Metrics",
  "metrics": [
    {"name": "Mean Reversion Speed", "value": 3.2, "unit": "days"},
    {"name": "Correlation", "value": 0.87, "format": "0.00"},
    {"name": "Entry Threshold", "value": 2.0, "unit": "std devs"}
  ]
}]
```

Again - NO regime/profile assumptions!

---

## Example: Options Greeks Analysis

**User:** "Show my current Greeks exposure"

**Claude Code Output:**
```
[DISPLAY_METRICS: {
  "title": "Portfolio Greeks",
  "metrics": [
    {"name": "Delta", "value": 0.25, "status": "neutral"},
    {"name": "Gamma", "value": 0.05, "status": "good"},
    {"name": "Vega", "value": 150, "status": "warning"},
    {"name": "Theta", "value": -25, "unit": "$/day", "status": "neutral"}
  ]
}]

[DISPLAY_CHART: {
  "type": "bar",
  "title": "Greeks by Position",
  "data": {
    "categories": ["SPY Call", "QQQ Put", "IWM Spread"],
    "series": [
      {"name": "Delta", "values": [0.5, -0.3, 0.05]},
      {"name": "Gamma", "values": [0.02, 0.03, 0.01]}
    ]
  }
}]
```

Fully flexible - works for ANY strategy paradigm!

---

## Benefits of Dynamic System

### 1. Strategy Agnostic
- ✅ Works for momentum, mean reversion, pairs trading, options, futures
- ✅ Not tied to regime classification
- ✅ Not tied to specific asset classes

### 2. Data-Driven
- ✅ Claude Code provides data → UI renders it
- ✅ No backend API calls needed for display
- ✅ Self-contained directives (all data embedded)

### 3. Extensible
- ✅ New chart types: just add to GenericChart switch
- ✅ New metrics: just pass different data
- ✅ Custom visualizations: compose primitives

### 4. Real-Time Updates
- ✅ UPDATE_CHART directives enable live updates
- ✅ Progressive display (show metrics, then chart, then table)
- ✅ Stream results as backtest runs

### 5. Portable
- ✅ Directives with data are self-contained
- ✅ Can copy/paste into different sessions
- ✅ No dependency on hardcoded backend state

---

## Migration Strategy

### Week 1: Build Generic Components
- Day 1-2: GenericChart with Recharts
- Day 3: GenericTable
- Day 4: MetricsDashboard
- Day 5: CodeDisplay

### Week 2: New Directive System
- Day 1-2: Parse DISPLAY_CHART, DISPLAY_TABLE, DISPLAY_METRICS
- Day 3: Update ResearchDisplayContext
- Day 4: Wire ChatArea to process new directives
- Day 5: Update Claude Code prompt

### Week 3: Test & Refine
- Test with 5 different strategy types (not regime-based)
- Verify directives work end-to-end
- Polish UI rendering
- Add error handling

### Week 4: Deprecate Old System
- Migrate old visualizations to new format
- Remove hardcoded regime/profile components
- Clean up code

---

## Immediate Next Steps

**Option A: Start Fresh (Recommended)**
1. Create new generic chart components
2. Add new directive parsers
3. Test with non-regime strategies
4. Keep old system working in parallel

**Option B: Refactor In-Place**
1. Rename existing components (RegimeTimeline → Heatmap)
2. Make them data-generic
3. Update directive system to pass data

**Option C: Hybrid Approach**
1. Add DISPLAY_CHART for new use cases
2. Keep DISPLAY: regime_timeline for backwards compat
3. Gradually migrate

---

## Recommendation

**Start with Option A** - build new generic system in parallel. This:
- Doesn't break existing functionality
- Lets you test with real use cases
- Provides clean architecture
- Can deprecate old system when ready

**First Implementation Target:**
Build GenericChart + DISPLAY_CHART directive to show equity curves for ANY strategy (momentum, mean reversion, whatever). This proves the concept and provides immediate value.

**Estimated Time to Working Prototype:** 2-3 days (8-12 hours work)

---

## Questions for You

1. **Chart Library Preference?**
   - Recharts (React-native, good for financial charts)
   - Plotly (more powerful, 3D, but heavier)
   - D3 (ultimate flexibility, steeper learning curve)
   - Lightweight (chart.js, lightweight but less features)

2. **Data Format?**
   - JSON embedded in directives (self-contained)
   - Reference to backend data (fetch on demand)
   - Hybrid (summary in directive, details on demand)

3. **Migration Timeline?**
   - Immediate (start now, finish this week)
   - Gradual (build new, migrate over time)
   - Aggressive (rip out old system first)

4. **Backwards Compatibility?**
   - Keep old directives working (parallel systems)
   - Hard break (force migration)
   - Deprecation period (warnings, then removal)

---

## Summary

The current system is **locked to the 6×6 regime/profile paradigm** through hardcoded visualization types and research stages. To make it a **true general-purpose quant workbench**, we need to:

1. Replace named visualizations with **generic chart types** (line, bar, heatmap, etc.)
2. Make directives **data-driven** (embed complete data in JSON)
3. Build **generic rendering components** (not domain-specific)
4. Eliminate **hardcoded research stages** (or make them generic)

This transforms the system from **inflexible rotation engine tool** to **flexible research workbench for ANY quant strategy.**

**Ready to start building the generic system?**
