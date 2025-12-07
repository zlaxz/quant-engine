/**
 * MetricsDashboard Demo
 *
 * Example usage of the MetricsDashboard component with sample data
 */

import { MetricsDashboard } from './MetricsDashboard';
import { MetricsData } from './types';

// Sample metrics data matching the visual design requirements
export const sampleMetricsData: MetricsData = {
  id: 'portfolio-metrics',
  title: 'Portfolio Performance Metrics',
  description: 'Key performance indicators for the current trading strategy',
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
      description: 'Total portfolio return since inception',
      sparkline: [10.2, 10.8, 11.5, 12.1, 11.9, 12.8, 13.2, 14.03],
    },
    {
      name: 'Sharpe Ratio',
      value: 0.43,
      format: 'decimal',
      status: 'good',
      description: 'Risk-adjusted return measure',
      sparkline: [0.35, 0.38, 0.42, 0.41, 0.43],
    },
    {
      name: 'Max Drawdown',
      value: -21.62,
      format: 'percent',
      status: 'warning',
      trend: 'down',
      description: 'Maximum peak-to-trough decline',
      sparkline: [-15.2, -18.3, -19.8, -21.62, -20.1, -19.5],
    },
    {
      name: 'Win Rate',
      value: 58.3,
      format: 'percent',
      status: 'good',
      change: 1.2,
      changeFormat: 'percent',
      trend: 'up',
      description: 'Percentage of profitable trades',
    },
    {
      name: 'Total Trades',
      value: 247,
      format: 'integer',
      status: 'neutral',
      change: 12,
      changeLabel: 'this month',
      changeFormat: 'number',
    },
    {
      name: 'Avg Trade P&L',
      value: 123.45,
      format: 'currency',
      status: 'good',
      change: 8.2,
      changeFormat: 'currency',
      trend: 'up',
    },
    {
      name: 'Volatility',
      value: 18.5,
      format: 'percent',
      unit: '%',
      status: 'info',
      description: 'Annualized volatility',
      sparkline: [16.2, 17.1, 18.8, 19.2, 17.9, 18.5],
    },
    {
      name: 'Beta',
      value: 0.87,
      format: 'decimal',
      status: 'neutral',
      description: 'Correlation with market',
    },
    {
      name: 'Sortino Ratio',
      value: 1.24,
      format: 'decimal',
      status: 'good',
      description: 'Downside risk-adjusted return',
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

// Compact version
export const compactMetricsData: MetricsData = {
  id: 'compact-metrics',
  title: 'Quick Stats',
  metrics: [
    {
      name: 'Total Return',
      value: 14.03,
      format: 'percent',
      status: 'good',
      trend: 'up',
    },
    {
      name: 'Sharpe',
      value: 0.43,
      format: 'decimal',
      status: 'good',
    },
    {
      name: 'Max DD',
      value: -21.62,
      format: 'percent',
      status: 'warning',
    },
    {
      name: 'Win Rate',
      value: 58.3,
      format: 'percent',
      status: 'good',
    },
  ],
  config: {
    layout: 'grid',
    columns: 4,
    showTrends: true,
    showSparklines: false,
    compact: true,
  },
};

// Row layout
export const rowMetricsData: MetricsData = {
  id: 'row-metrics',
  title: 'Real-time Metrics',
  metrics: [
    {
      name: 'Current P&L',
      value: 1234.56,
      format: 'currency',
      status: 'good',
      change: 234.12,
      changeFormat: 'currency',
      trend: 'up',
    },
    {
      name: 'Open Positions',
      value: 8,
      format: 'integer',
      status: 'neutral',
    },
    {
      name: 'Portfolio Delta',
      value: 0.45,
      format: 'decimal',
      status: 'info',
    },
  ],
  config: {
    layout: 'row',
    showTrends: true,
    compact: true,
  },
};

// Demo component
export function MetricsDashboardDemo() {
  return (
    <div className="p-8 space-y-8 bg-gray-50 dark:bg-gray-900">
      <div>
        <h1 className="text-3xl font-bold mb-2">MetricsDashboard Component Demo</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Examples of the MetricsDashboard component with different configurations
        </p>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Grid Layout (Default)</h2>
        <MetricsDashboard data={sampleMetricsData} />
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Compact Grid</h2>
        <MetricsDashboard data={compactMetricsData} />
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Row Layout</h2>
        <MetricsDashboard data={rowMetricsData} />
      </div>
    </div>
  );
}

export default MetricsDashboardDemo;
