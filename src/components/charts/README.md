# Generic Chart System

**Production-ready, data-driven visualization components for Quant Engine.**

Replaces the hardcoded 6×6 regime/profile paradigm with flexible, reusable components that accept structured data via props.

---

## Overview

The Generic Chart System provides:

- **Universal chart renderer** - Line, bar, pie, scatter, heatmap, area, composed, candlestick
- **Smart table component** - Sorting, filtering, pagination, export
- **Metrics dashboard** - KPI display with status indicators and sparklines
- **Code viewer** - Syntax highlighting, annotations, copy/download

All components use **shadcn/ui** styling and **Recharts** for visualization.

---

## Quick Start

```tsx
import { GenericChart, LineChartData } from '@/components/charts';

const data: LineChartData = {
  id: 'returns-1',
  type: 'line',
  title: 'Portfolio Returns',
  data: {
    series: [
      {
        name: 'Strategy A',
        values: [
          { x: '2024-01', y: 100 },
          { x: '2024-02', y: 105 },
          { x: '2024-03', y: 108 },
        ],
      },
    ],
  },
};

export function MyComponent() {
  return <GenericChart data={data} />;
}
```

---

## Components

### 1. GenericChart

Universal chart component supporting 8 chart types via discriminated union.

**Props:**
```tsx
interface GenericChartProps {
  data: ChartData; // LineChartData | BarChartData | PieChartData | etc.
}
```

**Supported Types:**
- `line` - Time series, multi-series line charts
- `bar` - Vertical/horizontal, stacked/grouped bars
- `pie` - Pie/donut charts with percentages
- `scatter` - X-Y scatter plots with color/size
- `heatmap` - 2D correlation matrices
- `area` - Stacked/overlapping area charts
- `composed` - Combined line/bar/area charts
- `candlestick` - OHLC financial charts

**Configuration:**
```tsx
config: {
  xLabel?: string;
  yLabel?: string;
  legend?: boolean;      // Default: true
  tooltip?: boolean;     // Default: true
  grid?: boolean;        // Default: true
  height?: number;       // Default: 400
  width?: string;        // Default: '100%'
  margin?: { top, right, bottom, left };
}
```

**Example:**
```tsx
const lineChart: LineChartData = {
  id: 'perf-1',
  type: 'line',
  title: 'Strategy Performance',
  description: 'Daily returns comparison',
  data: {
    series: [
      {
        name: 'Strategy A',
        values: [{ x: '2024-01', y: 100 }, { x: '2024-02', y: 105 }],
        color: '#8b5cf6',
        style: 'solid',
      },
    ],
  },
  config: {
    xLabel: 'Date',
    yLabel: 'Value ($)',
    legend: true,
    grid: true,
  },
};

<GenericChart data={lineChart} />
```

---

### 2. GenericTable

Feature-rich table with sorting, filtering, pagination, and export.

**Props:**
```tsx
interface GenericTableProps {
  data: TableData;
}
```

**Data Structure:**
```tsx
interface TableData {
  id: string;
  title: string;
  description?: string;
  columns: TableColumn[];
  rows: TableRow[];
  config?: TableConfig;
}

interface TableColumn {
  key: string;
  label: string;
  type: 'string' | 'number' | 'percent' | 'currency' | 'date' | 'boolean' | 'badge';
  sortable?: boolean;
  filterable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: number | string;
  render?: (value: unknown, row: TableRow) => React.ReactNode;
}
```

**Configuration:**
```tsx
config: {
  sortable?: boolean;        // Enable sorting
  filterable?: boolean;      // Enable search filter
  exportable?: boolean;      // Enable CSV export
  pageSize?: number;         // Rows per page
  striped?: boolean;         // Alternate row colors
  compact?: boolean;         // Reduced padding
  defaultSort?: {
    column: string;
    direction: 'asc' | 'desc';
  };
}
```

**Example:**
```tsx
const table: TableData = {
  id: 'strategies-1',
  title: 'Strategy Performance',
  columns: [
    { key: 'name', label: 'Strategy', type: 'string', sortable: true },
    { key: 'return', label: 'Return', type: 'percent', sortable: true },
    { key: 'sharpe', label: 'Sharpe', type: 'number', sortable: true },
  ],
  rows: [
    { name: 'Iron Condor', return: 0.15, sharpe: 1.8 },
    { name: 'Butterfly', return: 0.18, sharpe: 2.1 },
  ],
  config: {
    sortable: true,
    filterable: true,
    exportable: true,
    pageSize: 10,
  },
};

<GenericTable data={table} />
```

---

### 3. MetricsDashboard

Display key metrics with status indicators, trends, and sparklines.

**Props:**
```tsx
interface MetricsDashboardProps {
  data: MetricsData;
}
```

**Data Structure:**
```tsx
interface MetricsData {
  id: string;
  title: string;
  metrics: Metric[];
  config?: MetricsConfig;
}

interface Metric {
  name: string;
  value: number | string;
  format?: 'currency' | 'percent' | 'decimal' | 'integer';
  unit?: string;
  status?: 'good' | 'warning' | 'danger' | 'neutral' | 'info';
  change?: number;
  changeLabel?: string;
  trend?: 'up' | 'down' | 'flat';
  sparkline?: number[];
}
```

**Configuration:**
```tsx
config: {
  layout: 'grid' | 'row' | 'column';
  columns?: number;          // For grid layout
  showTrends?: boolean;
  showSparklines?: boolean;
  compact?: boolean;
}
```

**Example:**
```tsx
const metrics: MetricsData = {
  id: 'kpi-1',
  title: 'Portfolio KPIs',
  metrics: [
    {
      name: 'Total Return',
      value: 0.156,
      format: 'percent',
      status: 'good',
      change: 0.023,
      trend: 'up',
      sparkline: [12, 15, 18, 20, 22],
    },
  ],
  config: {
    layout: 'grid',
    columns: 3,
    showTrends: true,
  },
};

<MetricsDashboard data={metrics} />
```

---

### 4. CodeDisplay

Display code with syntax highlighting, line numbers, and annotations.

**Props:**
```tsx
interface CodeDisplayProps {
  data: CodeData;
}
```

**Data Structure:**
```tsx
interface CodeData {
  id: string;
  title: string;
  language: string;
  code: string;
  config?: CodeConfig;
}

interface CodeConfig {
  showLineNumbers?: boolean;
  highlightLines?: number[];
  annotations?: Array<{
    line: number;
    text: string;
    type?: 'info' | 'warning' | 'error' | 'success';
  }>;
  copyable?: boolean;
  downloadable?: boolean;
  fileName?: string;
  maxHeight?: number;
}
```

**Example:**
```tsx
const code: CodeData = {
  id: 'code-1',
  title: 'Strategy Implementation',
  language: 'python',
  code: `def iron_condor(price, vol):
    return calculate_strikes(price, vol)`,
  config: {
    showLineNumbers: true,
    copyable: true,
    downloadable: true,
    fileName: 'strategy.py',
  },
};

<CodeDisplay data={code} />
```

---

## Architecture

### Type System

All components use **discriminated unions** for type safety:

```tsx
type ChartData =
  | LineChartData
  | BarChartData
  | PieChartData
  | ScatterData
  | HeatmapData
  | AreaChartData
  | ComposedChartData
  | CandlestickData;
```

TypeScript enforces correct data shapes at compile time.

### Component Structure

```
src/components/charts/
├── types.ts              # All TypeScript interfaces
├── GenericChart.tsx      # Universal chart renderer
├── GenericTable.tsx      # Table with sorting/filtering
├── MetricsDashboard.tsx  # KPI metrics display
├── CodeDisplay.tsx       # Code viewer with highlighting
├── index.ts              # Barrel exports
├── examples.tsx          # Usage examples
└── README.md             # This file
```

### Data Flow

```
Python Backend → JSON → TypeScript Interface → React Component → Recharts/UI
```

**Key principle:** Components are **pure functions** of their data props. No internal state for data, only UI state (sort order, filters, etc.).

---

## Advanced Usage

### Custom Rendering

Tables support custom cell rendering:

```tsx
const columns: TableColumn[] = [
  {
    key: 'strategy',
    label: 'Strategy',
    type: 'string',
    render: (value, row) => (
      <Link to={`/strategy/${row.id}`}>
        <Badge>{value}</Badge>
      </Link>
    ),
  },
];
```

### Multi-Panel Layouts

Combine multiple visualizations:

```tsx
import { VisualizationData } from '@/components/charts';

const multiPanel: MultiPanelData = {
  type: 'multi-panel',
  id: 'dashboard-1',
  title: 'Strategy Dashboard',
  panels: [
    { id: 'chart-1', data: lineChart, span: 2 },
    { id: 'metrics-1', data: metrics, span: 1 },
    { id: 'table-1', data: table, span: 3 },
  ],
  layout: 'grid',
  columns: 3,
};
```

### Real-Time Updates

Components accept new data via props for real-time updates:

```tsx
const [data, setData] = useState<LineChartData>(initialData);

useEffect(() => {
  const ws = new WebSocket('ws://...');
  ws.onmessage = (event) => {
    const newPoint = JSON.parse(event.data);
    setData(prev => ({
      ...prev,
      data: {
        ...prev.data,
        series: prev.data.series.map(s => ({
          ...s,
          values: [...s.values, newPoint],
        })),
      },
    }));
  };
}, []);
```

---

## Integration with Python

### Backend Data Serialization

```python
# Python backend example
def generate_chart_data():
    return {
        'id': 'returns-1',
        'type': 'line',
        'title': 'Portfolio Returns',
        'data': {
            'series': [
                {
                    'name': 'Strategy A',
                    'values': [
                        {'x': '2024-01', 'y': 100},
                        {'x': '2024-02', 'y': 105},
                    ],
                },
            ],
        },
    }
```

### IPC Bridge

```typescript
// Electron IPC handler
ipcMain.handle('get-chart-data', async () => {
  const pythonOutput = await runPythonScript('generate_chart_data.py');
  return JSON.parse(pythonOutput);
});

// React component
const data = await window.electron.getChartData();
return <GenericChart data={data} />;
```

---

## Testing

See `examples.tsx` for comprehensive test data for all component types.

To preview all components:

```tsx
import { ChartExamplesDemo } from '@/components/charts/examples';

<ChartExamplesDemo />
```

---

## Migration from Hardcoded Components

**Before (hardcoded):**
```tsx
<RegimeMatrix data={hardcodedData} />
```

**After (data-driven):**
```tsx
const heatmapData: HeatmapData = {
  id: 'regime-matrix',
  type: 'heatmap',
  title: 'Regime Matrix',
  data: {
    x: profiles,
    y: regimes,
    values: correlationMatrix,
  },
};

<GenericChart data={heatmapData} />
```

---

## Performance

- **Recharts** handles rendering optimization internally
- **Virtual scrolling** available for large tables
- **Lazy rendering** - only visible components render
- **Memoization** - charts re-render only when data changes

---

## Styling

All components use **shadcn/ui** primitives and Tailwind CSS. They inherit the app's theme automatically.

Custom styling via `className` prop:

```tsx
<GenericChart data={data} className="custom-chart" />
```

---

## Roadmap

Future enhancements:

- [ ] WebGL renderer for large datasets (100k+ points)
- [ ] 3D charts (surface plots, 3D scatter)
- [ ] Animation support for transitions
- [ ] Interactive annotations
- [ ] Export to PNG/SVG
- [ ] Chart themes (beyond light/dark)

---

## Support

For issues or questions:
- Check `examples.tsx` for reference implementations
- Review type definitions in `types.ts`
- See existing visualizations in `src/components/visualizations/` for migration examples

---

**Last Updated:** 2024-12-01
**Version:** 1.0.0
**Status:** Production Ready
