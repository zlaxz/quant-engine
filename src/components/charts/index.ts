/**
 * Generic Chart System - Barrel Export
 *
 * Exports all chart components and types for easy importing.
 */

// Components
export { GenericChart } from './GenericChart';
export { GenericTable } from './GenericTable';
export { MetricsDashboard } from './MetricsDashboard';
export { CodeDisplay } from './CodeDisplay';

// Types
export type {
  // Chart types
  ChartData,
  LineChartData,
  AreaChartData,
  BarChartData,
  ScatterData,
  PieChartData,
  CandlestickData,
  HeatmapData,
  ComposedChartData,
  BaseChartData,
  ChartConfig,
  ChartAnnotation,
  LineSeriesData,
  AreaSeriesData,
  BarSeriesData,
  ScatterPoint,
  PieSlice,
  CandlestickPoint,
  CandlestickIndicator,
  ComposedSeriesData,
  AxisConfig,
  ColorScale,

  // Table types
  TableData,
  TableColumn,
  TableRow,
  TableConfig,

  // Metrics types
  MetricsData,
  Metric,
  MetricStatus,
  MetricsConfig,

  // Code types
  CodeData,
  CodeConfig,
  CodeAnnotation,

  // Container types
  VisualizationData,
  MultiPanelData,
  VisualizationPanel,

  // Utility types
  DataPoint,
  ColorPalette,
} from './types';

// Constants
export { DEFAULT_COLORS, STATUS_COLORS } from './types';

// Utility functions
export { formatValue } from './types';
