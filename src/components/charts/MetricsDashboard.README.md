# MetricsDashboard Component

**Location:** `/Users/zstoc/GitHub/quant-engine/src/components/charts/MetricsDashboard.tsx`

## Overview

The MetricsDashboard component displays key performance metrics in a clean, organized grid layout with support for status indicators, trend arrows, sparklines, and multiple formatting options.

## Features

✅ **Grid Layout** - Configurable columns (1-6)
✅ **Status Colors** - good (green), warning (yellow), danger (red), neutral (gray), info (blue)
✅ **Change Indicators** - Up/down/flat arrows with percentage or currency changes
✅ **Sparklines** - Optional mini-charts using SVG (lightweight)
✅ **Compact Mode** - Smaller padding for dense displays
✅ **Format Support** - percent, currency, number, decimal, integer, compact
✅ **Dark Theme** - Full dark mode support via Tailwind
✅ **Responsive** - Mobile-friendly responsive grid

## Usage

```typescript
import { MetricsDashboard } from '@/components/charts/MetricsDashboard';
import { MetricsData } from '@/components/charts/types';

const data: MetricsData = {
  id: 'portfolio-metrics',
  title: 'Portfolio Performance',
  description: 'Key metrics for current strategy',
  metrics: [
    {
      name: 'Total Return',
      value: 14.03,
      format: 'percent',
      status: 'good',
      change: 2.5,
      changeLabel: 'vs benchmark',
      changeFormat: 'percent',
      trend: 'up',
      description: 'Total return since inception',
      sparkline: [10.2, 10.8, 11.5, 12.1, 14.03],
    },
    {
      name: 'Sharpe Ratio',
      value: 0.43,
      format: 'decimal',
      status: 'good',
    },
    {
      name: 'Max Drawdown',
      value: -21.62,
      format: 'percent',
      status: 'warning',
      trend: 'down',
    },
  ],
  config: {
    layout: 'grid',
    columns: 3,
    showTrends: true,
    showSparklines: true,
    compact: false,
  },
};

<MetricsDashboard data={data} />
```

## Props

### MetricsData

```typescript
interface MetricsData {
  id: string;                    // Unique identifier
  title: string;                 // Dashboard title
  description?: string;          // Optional description
  metrics: Metric[];             // Array of metrics to display
  config?: MetricsConfig;        // Layout and display options
}
```

### Metric

```typescript
interface Metric {
  name: string;                  // Metric name (e.g., "Total Return")
  value: number | string;        // Metric value
  format?: string;               // Format type (see below)
  unit?: string;                 // Unit label (e.g., "%", "$")
  status?: MetricStatus;         // Status color
  change?: number;               // Change value
  changeLabel?: string;          // Change label (e.g., "vs benchmark")
  changeFormat?: string;         // Format for change value
  trend?: 'up' | 'down' | 'flat'; // Trend direction
  icon?: string;                 // Icon name (future)
  description?: string;          // Metric description
  sparkline?: number[];          // Sparkline data points
}
```

### MetricStatus

```typescript
type MetricStatus = 'good' | 'warning' | 'danger' | 'neutral' | 'info';
```

### MetricsConfig

```typescript
interface MetricsConfig {
  layout: 'grid' | 'row' | 'column';  // Layout type
  columns?: number;                    // Grid columns (1-6)
  showTrends?: boolean;                // Show trend indicators
  showSparklines?: boolean;            // Show sparkline charts
  compact?: boolean;                   // Use compact padding
}
```

## Format Types

| Format | Example Input | Example Output |
|--------|---------------|----------------|
| `percent` | `14.03` | `+14.03%` |
| `currency` | `1234.56` | `$1,234.56` |
| `decimal` | `0.43` | `0.43` |
| `integer` | `247` | `247` |
| `compact` | `1500000` | `1.5M` |
| `number` | `123.456` | `123.46` |

## Change Formats

| Format | Example Input | Example Output |
|--------|---------------|----------------|
| `percent` | `2.5` | `+2.50%` |
| `basis_points` | `0.25` | `+25 bps` |
| `currency` | `123.45` | `+$123.45` |
| `number` | `12` | `+12` |

## Layout Options

### Grid Layout (Default)
```typescript
config: {
  layout: 'grid',
  columns: 3,  // 1-6 columns
}
```

### Row Layout
```typescript
config: {
  layout: 'row',  // Horizontal scrolling
}
```

### Column Layout
```typescript
config: {
  layout: 'column',  // Vertical stacking
}
```

## Examples

See `MetricsDashboard.demo.tsx` for complete examples including:
- Grid layout with sparklines
- Compact grid layout
- Row layout for real-time metrics

## Visual Design

```
┌─────────────────────────────────────────────────────────────┐
│ Portfolio Performance Metrics                               │
│ Key performance indicators for the current trading strategy │
├─────────────────┬─────────────────┬─────────────────────────┤
│ 📊 Total Return │ 📊 Sharpe Ratio │ 📊 Max Drawdown         │
│ +14.03%     ↑   │ 0.43            │ -21.62%              ↓  │
│ Good            │ Good            │ Warning                 │
│ +2.50% vs bench │                 │                         │
│ ▁▂▃▄▅▆▇█        │ ▁▃▅▄▆           │ ▁▃▅▇▆▄                  │
└─────────────────┴─────────────────┴─────────────────────────┘
```

## Dependencies

- React
- Tailwind CSS
- shadcn/ui (Card, Badge components)
- lucide-react (Icons)
- `./types` (Type definitions)
- `@/lib/utils` (cn utility)

## Testing

Run the demo component to see all features in action:

```bash
# Add to your routing or render directly
<MetricsDashboardDemo />
```

## Integration with JARVIS

This component is designed to work with JARVIS UI events. When receiving a `metrics` event:

```typescript
// JARVIS event handler
if (event.type === 'metrics') {
  const metricsData: MetricsData = {
    id: event.data.id,
    title: event.data.title,
    metrics: event.data.metrics,
    config: event.data.config,
  };

  // Render the dashboard
  <MetricsDashboard data={metricsData} />
}
```

## Status Colors

| Status | Color | Use Case |
|--------|-------|----------|
| `good` | Green | Positive metrics (high Sharpe, positive returns) |
| `warning` | Yellow | Caution metrics (high drawdown, volatility) |
| `danger` | Red | Critical metrics (loss limits, risk breaches) |
| `neutral` | Gray | Informational metrics (trade count, positions) |
| `info` | Blue | Analytical metrics (beta, correlation) |

## Performance

- **Lightweight:** No heavy charting libraries (Recharts removed)
- **Native SVG:** Sparklines use pure SVG for minimal overhead
- **Responsive:** Grid automatically adjusts to screen size
- **Fast:** Simple React components with minimal re-renders

## Accessibility

- Semantic HTML structure
- Color not solely used for meaning (status badges provide text)
- Keyboard navigable (Card components)
- Screen reader friendly labels

## Future Enhancements

- [ ] Custom icon support (icon string mapping)
- [ ] Click handlers for drill-down
- [ ] Export to CSV/JSON
- [ ] Comparison mode (side-by-side metrics)
- [ ] Historical data tooltip on sparkline hover
- [ ] Alerts/notifications on threshold breaches
