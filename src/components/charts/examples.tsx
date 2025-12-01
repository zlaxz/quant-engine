/**
 * Generic Chart System - Usage Examples
 *
 * Demonstrates how to use all chart components with sample data.
 * This file serves as both documentation and testing playground.
 */

import {
  GenericChart,
  GenericTable,
  MetricsDashboard,
  CodeDisplay,
  LineChartData,
  BarChartData,
  PieChartData,
  ScatterData,
  HeatmapData,
  AreaChartData,
  ComposedChartData,
  TableData,
  MetricsData,
  CodeData,
} from './index';

// ============================================================================
// Line Chart Examples
// ============================================================================

export const exampleLineChart: LineChartData = {
  id: 'line-1',
  type: 'line',
  title: 'Portfolio Performance',
  description: 'Daily returns over time',
  data: {
    series: [
      {
        name: 'Strategy A',
        values: [
          { x: '2024-01', y: 100 },
          { x: '2024-02', y: 105 },
          { x: '2024-03', y: 103 },
          { x: '2024-04', y: 108 },
          { x: '2024-05', y: 112 },
        ],
        color: '#8b5cf6',
        style: 'solid',
      },
      {
        name: 'Strategy B',
        values: [
          { x: '2024-01', y: 100 },
          { x: '2024-02', y: 102 },
          { x: '2024-03', y: 106 },
          { x: '2024-04', y: 105 },
          { x: '2024-05', y: 110 },
        ],
        color: '#3b82f6',
        style: 'dashed',
      },
    ],
  },
  config: {
    xLabel: 'Month',
    yLabel: 'Portfolio Value ($)',
    legend: true,
    grid: true,
  },
};

// ============================================================================
// Bar Chart Examples
// ============================================================================

export const exampleBarChart: BarChartData = {
  id: 'bar-1',
  type: 'bar',
  title: 'Monthly Returns by Strategy',
  description: 'Comparison of strategy performance',
  data: {
    categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
    series: [
      {
        name: 'Strategy A',
        values: [5, 8, 3, 12, 7],
        color: '#8b5cf6',
      },
      {
        name: 'Strategy B',
        values: [3, 6, 9, 5, 8],
        color: '#3b82f6',
      },
    ],
    stacked: false,
  },
  config: {
    xLabel: 'Month',
    yLabel: 'Return (%)',
    legend: true,
  },
};

// ============================================================================
// Pie Chart Examples
// ============================================================================

export const examplePieChart: PieChartData = {
  id: 'pie-1',
  type: 'pie',
  title: 'Portfolio Allocation',
  description: 'Asset allocation by strategy',
  data: {
    slices: [
      { label: 'Options', value: 45, percentage: 45, color: '#8b5cf6' },
      { label: 'Stocks', value: 30, percentage: 30, color: '#3b82f6' },
      { label: 'Bonds', value: 15, percentage: 15, color: '#10b981' },
      { label: 'Cash', value: 10, percentage: 10, color: '#f59e0b' },
    ],
    innerRadius: 50,
    outerRadius: 100,
  },
  config: {
    legend: true,
  },
};

// ============================================================================
// Scatter Chart Examples
// ============================================================================

export const exampleScatterChart: ScatterData = {
  id: 'scatter-1',
  type: 'scatter',
  title: 'Risk vs Return',
  description: 'Strategy risk-return profile',
  data: {
    points: [
      { x: 5, y: 12, label: 'Strategy A', color: '#8b5cf6' },
      { x: 8, y: 15, label: 'Strategy B', color: '#3b82f6' },
      { x: 3, y: 7, label: 'Strategy C', color: '#10b981' },
      { x: 12, y: 20, label: 'Strategy D', color: '#f59e0b' },
      { x: 10, y: 18, label: 'Strategy E', color: '#ef4444' },
    ],
  },
  config: {
    xLabel: 'Risk (Volatility %)',
    yLabel: 'Return (%)',
    grid: true,
  },
};

// ============================================================================
// Heatmap Examples
// ============================================================================

export const exampleHeatmap: HeatmapData = {
  id: 'heatmap-1',
  type: 'heatmap',
  title: 'Correlation Matrix',
  description: 'Asset correlation heatmap',
  data: {
    x: ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD'],
    y: ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD'],
    values: [
      [1.0, 0.95, 0.88, -0.2, 0.1],
      [0.95, 1.0, 0.85, -0.3, 0.05],
      [0.88, 0.85, 1.0, -0.15, 0.2],
      [-0.2, -0.3, -0.15, 1.0, 0.4],
      [0.1, 0.05, 0.2, 0.4, 1.0],
    ],
    colorScale: 'diverging',
    showValues: true,
  },
  config: {
    height: 500,
  },
};

// ============================================================================
// Area Chart Examples
// ============================================================================

export const exampleAreaChart: AreaChartData = {
  id: 'area-1',
  type: 'area',
  title: 'Cumulative Returns',
  description: 'Stacked cumulative returns by strategy',
  data: {
    series: [
      {
        name: 'Strategy A',
        values: [
          { x: '2024-01', y: 5 },
          { x: '2024-02', y: 8 },
          { x: '2024-03', y: 12 },
          { x: '2024-04', y: 15 },
        ],
        color: '#8b5cf6',
      },
      {
        name: 'Strategy B',
        values: [
          { x: '2024-01', y: 3 },
          { x: '2024-02', y: 6 },
          { x: '2024-03', y: 10 },
          { x: '2024-04', y: 13 },
        ],
        color: '#3b82f6',
      },
    ],
    stacked: true,
  },
};

// ============================================================================
// Composed Chart Examples
// ============================================================================

export const exampleComposedChart: ComposedChartData = {
  id: 'composed-1',
  type: 'composed',
  title: 'Price and Volume',
  description: 'Combined price line and volume bars',
  data: {
    series: [
      {
        name: 'Price',
        type: 'line',
        values: [
          { x: '2024-01', y: 100 },
          { x: '2024-02', y: 105 },
          { x: '2024-03', y: 103 },
          { x: '2024-04', y: 108 },
        ],
        color: '#8b5cf6',
      },
      {
        name: 'Volume',
        type: 'bar',
        values: [
          { x: '2024-01', y: 1000000 },
          { x: '2024-02', y: 1200000 },
          { x: '2024-03', y: 900000 },
          { x: '2024-04', y: 1100000 },
        ],
        color: '#3b82f6',
        yAxisId: 'volume',
      },
    ],
  },
};

// ============================================================================
// Table Examples
// ============================================================================

export const exampleTable: TableData = {
  id: 'table-1',
  title: 'Strategy Performance Summary',
  description: 'Key metrics for all strategies',
  columns: [
    { key: 'strategy', label: 'Strategy', type: 'string', sortable: true },
    { key: 'return', label: 'Return', type: 'percent', sortable: true, align: 'right' },
    { key: 'sharpe', label: 'Sharpe', type: 'number', sortable: true, align: 'right' },
    { key: 'maxDD', label: 'Max DD', type: 'percent', sortable: true, align: 'right' },
    { key: 'trades', label: 'Trades', type: 'number', sortable: true, align: 'right' },
    { key: 'winRate', label: 'Win Rate', type: 'percent', sortable: true, align: 'right' },
    { key: 'active', label: 'Active', type: 'boolean', sortable: true, align: 'center' },
  ],
  rows: [
    { strategy: 'Iron Condor', return: 0.15, sharpe: 1.8, maxDD: -0.08, trades: 52, winRate: 0.73, active: true },
    { strategy: 'Credit Spread', return: 0.12, sharpe: 1.5, maxDD: -0.12, trades: 48, winRate: 0.68, active: true },
    { strategy: 'Butterfly', return: 0.18, sharpe: 2.1, maxDD: -0.06, trades: 36, winRate: 0.78, active: false },
    { strategy: 'Straddle', return: 0.22, sharpe: 1.2, maxDD: -0.18, trades: 24, winRate: 0.58, active: true },
    { strategy: 'Calendar', return: 0.14, sharpe: 1.6, maxDD: -0.10, trades: 40, winRate: 0.70, active: true },
  ],
  config: {
    sortable: true,
    filterable: true,
    exportable: true,
    pageSize: 10,
    striped: true,
    defaultSort: { column: 'return', direction: 'desc' },
  },
};

// ============================================================================
// Metrics Examples
// ============================================================================

export const exampleMetrics: MetricsData = {
  id: 'metrics-1',
  title: 'Portfolio Metrics',
  description: 'Key performance indicators',
  metrics: [
    {
      name: 'Total Return',
      value: 0.156,
      format: 'percent',
      status: 'good',
      change: 0.023,
      changeLabel: 'vs last month',
      trend: 'up',
      sparkline: [12, 15, 13, 16, 18, 20, 19, 22, 24, 23, 25],
    },
    {
      name: 'Sharpe Ratio',
      value: 1.85,
      format: 'decimal',
      status: 'good',
      change: 0.05,
      trend: 'up',
    },
    {
      name: 'Max Drawdown',
      value: -0.087,
      format: 'percent',
      status: 'warning',
      change: -0.012,
      trend: 'down',
    },
    {
      name: 'Win Rate',
      value: 0.73,
      format: 'percent',
      status: 'good',
      change: 0.03,
      trend: 'up',
    },
    {
      name: 'Total Trades',
      value: 156,
      format: 'integer',
      status: 'neutral',
    },
    {
      name: 'Portfolio Value',
      value: 1250000,
      format: 'currency',
      status: 'good',
      change: 0.045,
      changeLabel: 'vs last week',
      trend: 'up',
    },
  ],
  config: {
    layout: 'grid',
    columns: 3,
    showTrends: true,
    showSparklines: true,
  },
};

// ============================================================================
// Code Examples
// ============================================================================

export const exampleCode: CodeData = {
  id: 'code-1',
  title: 'Strategy Implementation',
  description: 'Python code for Iron Condor strategy',
  language: 'python',
  code: `def iron_condor_strategy(
    underlying_price: float,
    days_to_expiry: int,
    volatility: float
) -> dict:
    """
    Construct an Iron Condor options strategy.

    Args:
        underlying_price: Current price of underlying
        days_to_expiry: Days until expiration
        volatility: Implied volatility

    Returns:
        Dictionary containing strike prices and P&L profile
    """
    # Calculate strike prices
    strikes = calculate_strikes(
        underlying_price,
        volatility,
        days_to_expiry
    )

    # Define legs
    short_call = create_option('call', strikes['short_call'], 'sell')
    long_call = create_option('call', strikes['long_call'], 'buy')
    short_put = create_option('put', strikes['short_put'], 'sell')
    long_put = create_option('put', strikes['long_put'], 'buy')

    return {
        'legs': [short_call, long_call, short_put, long_put],
        'max_profit': calculate_max_profit(strikes),
        'max_loss': calculate_max_loss(strikes),
        'breakevens': calculate_breakevens(strikes)
    }`,
  config: {
    showLineNumbers: true,
    highlightLines: [1, 2, 3],
    annotations: [
      { line: 1, text: 'Main strategy function', type: 'info' },
      { line: 18, text: 'Critical calculation', type: 'warning' },
    ],
    copyable: true,
    downloadable: true,
    fileName: 'iron_condor.py',
  },
};

// ============================================================================
// Demo Component
// ============================================================================

export function ChartExamplesDemo() {
  return (
    <div className="space-y-8 p-8">
      <h1 className="text-3xl font-bold">Generic Chart System Examples</h1>

      <section>
        <h2 className="text-2xl font-semibold mb-4">Charts</h2>
        <div className="space-y-6">
          <GenericChart data={exampleLineChart} />
          <GenericChart data={exampleBarChart} />
          <GenericChart data={examplePieChart} />
          <GenericChart data={exampleScatterChart} />
          <GenericChart data={exampleHeatmap} />
          <GenericChart data={exampleAreaChart} />
          <GenericChart data={exampleComposedChart} />
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-4">Table</h2>
        <GenericTable data={exampleTable} />
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-4">Metrics</h2>
        <MetricsDashboard data={exampleMetrics} />
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-4">Code</h2>
        <CodeDisplay data={exampleCode} />
      </section>
    </div>
  );
}
