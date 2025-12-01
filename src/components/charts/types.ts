/**
 * Generic Chart System Type Definitions
 *
 * Comprehensive type system for data-driven visualizations.
 * Supports multiple chart types, tables, metrics, and code displays.
 */

// ============================================================================
// Base Types
// ============================================================================

export interface BaseChartData {
  id: string;
  title: string;
  description?: string;
  config?: ChartConfig;
}

export interface ChartConfig {
  xLabel?: string;
  yLabel?: string;
  legend?: boolean;
  tooltip?: boolean;
  height?: number;
  width?: string | number;
  grid?: boolean;
  margin?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  annotations?: ChartAnnotation[];
  theme?: 'light' | 'dark' | 'auto';
}

export interface ChartAnnotation {
  type: 'line' | 'box' | 'text' | 'arrow';
  data: Record<string, unknown>;
  style?: Record<string, string | number>;
}

// ============================================================================
// Chart Data Types (Discriminated Union)
// ============================================================================

export type ChartData =
  | LineChartData
  | HeatmapData
  | BarChartData
  | ScatterData
  | PieChartData
  | CandlestickData
  | AreaChartData
  | ComposedChartData;

// Line Chart
export interface LineChartData extends BaseChartData {
  type: 'line';
  data: {
    series: LineSeriesData[];
    xAxis?: AxisConfig;
    yAxis?: AxisConfig;
  };
}

export interface LineSeriesData {
  name: string;
  values: Array<{ x: number | string; y: number; [key: string]: number | string | boolean | null }>;
  color?: string;
  style?: 'solid' | 'dashed' | 'dotted';
  width?: number;
  dot?: boolean;
  area?: boolean;
}

// Area Chart
export interface AreaChartData extends BaseChartData {
  type: 'area';
  data: {
    series: AreaSeriesData[];
    xAxis?: AxisConfig;
    yAxis?: AxisConfig;
    stacked?: boolean;
  };
}

export interface AreaSeriesData {
  name: string;
  values: Array<{ x: number | string; y: number; [key: string]: number | string | boolean | null }>;
  color?: string;
  opacity?: number;
}

// Bar Chart
export interface BarChartData extends BaseChartData {
  type: 'bar';
  data: {
    categories: string[];
    series: BarSeriesData[];
    orientation?: 'vertical' | 'horizontal';
    stacked?: boolean;
  };
}

export interface BarSeriesData {
  name: string;
  values: number[];
  color?: string;
}

// Scatter Chart
export interface ScatterData extends BaseChartData {
  type: 'scatter';
  data: {
    points: ScatterPoint[];
    xAxis?: AxisConfig;
    yAxis?: AxisConfig;
    colorBy?: string;
    sizeBy?: string;
  };
}

export interface ScatterPoint {
  x: number;
  y: number;
  label?: string;
  color?: string;
  size?: number;
  [key: string]: number | string | boolean | undefined;
}

// Pie Chart
export interface PieChartData extends BaseChartData {
  type: 'pie';
  data: {
    slices: PieSlice[];
    innerRadius?: number;
    outerRadius?: number;
    startAngle?: number;
    endAngle?: number;
  };
}

export interface PieSlice {
  label: string;
  value: number;
  color?: string;
  percentage?: number;
}

// Candlestick Chart
export interface CandlestickData extends BaseChartData {
  type: 'candlestick';
  data: {
    ohlc: CandlestickPoint[];
    volume?: number[];
    indicators?: CandlestickIndicator[];
  };
}

export interface CandlestickPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface CandlestickIndicator {
  type: 'sma' | 'ema' | 'bb' | 'rsi';
  values: number[];
  config?: Record<string, number | string | boolean>;
}

// Heatmap
export interface HeatmapData extends BaseChartData {
  type: 'heatmap';
  data: {
    x: string[];
    y: string[];
    values: number[][];
    colorScale?: ColorScale;
    showValues?: boolean;
    valueFormat?: string;
  };
}

export type ColorScale =
  | 'viridis'
  | 'blues'
  | 'reds'
  | 'greens'
  | 'diverging'
  | 'sequential'
  | 'custom';

// Composed Chart (Multiple chart types combined)
export interface ComposedChartData extends BaseChartData {
  type: 'composed';
  data: {
    series: ComposedSeriesData[];
    xAxis?: AxisConfig;
    yAxis?: AxisConfig[];
  };
}

export interface ComposedSeriesData {
  name: string;
  type: 'line' | 'bar' | 'area';
  values: Array<{ x: number | string; y: number; [key: string]: number | string | boolean | null }>;
  yAxisId?: string;
  color?: string;
  [key: string]: string | number | boolean | undefined | Array<{ x: number | string; y: number; [key: string]: number | string | boolean | null }>;
}

// Axis Configuration
export interface AxisConfig {
  type?: 'number' | 'category' | 'time';
  domain?: [number | string, number | string];
  tickFormat?: string;
  tickCount?: number;
  scale?: 'linear' | 'log' | 'sqrt';
}

// ============================================================================
// Table Data Types
// ============================================================================

export interface TableData {
  id: string;
  title: string;
  description?: string;
  columns: TableColumn[];
  rows: TableRow[];
  config?: TableConfig;
}

export interface TableColumn {
  key: string;
  label: string;
  type: 'string' | 'number' | 'percent' | 'currency' | 'date' | 'boolean' | 'badge';
  format?: string;
  sortable?: boolean;
  filterable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: number | string;
  render?: (value: unknown, row: TableRow) => React.ReactNode;
}

export type TableRow = Record<string, unknown>;

export interface TableConfig {
  sortable?: boolean;
  filterable?: boolean;
  exportable?: boolean;
  pageSize?: number;
  striped?: boolean;
  bordered?: boolean;
  compact?: boolean;
  sticky?: boolean;
  virtualScroll?: boolean;
  defaultSort?: {
    column: string;
    direction: 'asc' | 'desc';
  };
}

// ============================================================================
// Metrics Data Types
// ============================================================================

export interface MetricsData {
  id: string;
  title: string;
  description?: string;
  metrics: Metric[];
  config?: MetricsConfig;
}

export interface Metric {
  name: string;
  value: number | string;
  format?: string;
  unit?: string;
  status?: MetricStatus;
  change?: number;
  changeLabel?: string;
  changeFormat?: string;
  trend?: 'up' | 'down' | 'flat';
  icon?: string;
  description?: string;
  sparkline?: number[];
}

export type MetricStatus = 'good' | 'warning' | 'danger' | 'neutral' | 'info';

export interface MetricsConfig {
  layout: 'grid' | 'row' | 'column';
  columns?: number;
  showTrends?: boolean;
  showSparklines?: boolean;
  compact?: boolean;
}

// ============================================================================
// Code Display Types
// ============================================================================

export interface CodeData {
  id: string;
  title: string;
  description?: string;
  language: string;
  code: string;
  config?: CodeConfig;
}

export interface CodeConfig {
  annotations?: CodeAnnotation[];
  highlightLines?: number[];
  showLineNumbers?: boolean;
  theme?: 'light' | 'dark' | 'auto';
  maxHeight?: number;
  downloadable?: boolean;
  copyable?: boolean;
  fileName?: string;
}

export interface CodeAnnotation {
  line: number;
  text: string;
  type?: 'info' | 'warning' | 'error' | 'success';
}

// ============================================================================
// Visualization Container Types
// ============================================================================

export type VisualizationData =
  | ChartData
  | TableData
  | MetricsData
  | CodeData
  | MultiPanelData;

export interface MultiPanelData {
  type: 'multi-panel';
  id: string;
  title: string;
  description?: string;
  panels: VisualizationPanel[];
  layout?: 'grid' | 'tabs' | 'accordion' | 'carousel';
  columns?: number;
}

export interface VisualizationPanel {
  id: string;
  title?: string;
  data: ChartData | TableData | MetricsData | CodeData;
  span?: number;
}

// ============================================================================
// Utility Types
// ============================================================================

export interface DataPoint {
  x: number | string;
  y: number;
  [key: string]: number | string;
}

export interface ColorPalette {
  primary: string[];
  sequential: string[];
  diverging: string[];
  categorical: string[];
}

export const DEFAULT_COLORS = [
  '#8b5cf6', // purple
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
] as const;

export const STATUS_COLORS = {
  good: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  neutral: '#6b7280',
  info: '#3b82f6',
} as const;

// ============================================================================
// Format Functions
// ============================================================================

export const formatValue = (
  value: number | string,
  format?: string,
  type?: string
): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '-';

  switch (type) {
    case 'percent':
      return `${(value * 100).toFixed(2)}%`;
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(value);
    case 'number':
      return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    default:
      if (format) {
        // Custom format parsing could go here
        return value.toString();
      }
      return value.toString();
  }
};

// ============================================================================
// Real-time Update Types
// ============================================================================

/**
 * Update directive for real-time chart updates
 */
export interface ChartUpdate {
  id: string;
  data: unknown; // New data to append or replace
  mode?: 'append' | 'replace';
}

/**
 * Update directive for table updates
 */
export interface TableUpdate {
  id: string;
  rows: Array<Record<string, unknown>>;
  mode?: 'append' | 'replace' | 'update';
}

// ============================================================================
// Notification Types
// ============================================================================

/**
 * Notification data structure
 */
export interface NotificationData {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number; // milliseconds, default 5000
  dismissible?: boolean;
}
