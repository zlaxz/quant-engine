/**
 * MetricsDashboard - Metrics Display Component
 *
 * Displays key metrics in grid or row layout with status indicators,
 * trends, and optional sparklines.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUp,
  ArrowDown,
  DollarSign,
  Percent,
  Activity,
  BarChart3,
} from 'lucide-react';
import { MetricsData, Metric, STATUS_COLORS } from './types';

interface MetricsDashboardProps {
  data: MetricsData;
}

export function MetricsDashboard({ data }: MetricsDashboardProps) {
  const config = data.config || { layout: 'grid', columns: 3 };

  const layoutClass =
    config.layout === 'row'
      ? 'flex flex-row gap-4 overflow-x-auto'
      : config.layout === 'column'
        ? 'flex flex-col gap-4'
        : `grid gap-4 grid-cols-1 md:grid-cols-${config.columns || 3}`;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{data.title}</CardTitle>
        {data.description && <CardDescription>{data.description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className={layoutClass}>
          {data.metrics.map((metric, i) => (
            <MetricCard
              key={i}
              metric={metric}
              compact={config.compact}
              showTrends={config.showTrends}
              showSparklines={config.showSparklines}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Metric Card Component
// ============================================================================

interface MetricCardProps {
  metric: Metric;
  compact?: boolean;
  showTrends?: boolean;
  showSparklines?: boolean;
}

function MetricCard({ metric, compact, showTrends, showSparklines }: MetricCardProps) {
  const statusColor = metric.status ? STATUS_COLORS[metric.status] : STATUS_COLORS.neutral;

  return (
    <Card className={compact ? 'p-4' : 'p-6'}>
      <div className="space-y-2">
        {/* Header with icon and name */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getMetricIcon(metric)}
            <h3 className="text-sm font-medium text-muted-foreground">{metric.name}</h3>
          </div>
          {metric.status && (
            <Badge
              variant={getStatusVariant(metric.status)}
              className="text-xs"
            >
              {metric.status}
            </Badge>
          )}
        </div>

        {/* Value */}
        <div className="flex items-baseline gap-2">
          <div className="text-2xl font-bold" style={{ color: statusColor }}>
            {formatMetricValue(metric)}
          </div>
          {metric.unit && (
            <span className="text-sm text-muted-foreground">{metric.unit}</span>
          )}
        </div>

        {/* Change indicator */}
        {showTrends !== false && metric.change !== undefined && (
          <div className="flex items-center gap-1">
            {getTrendIcon(metric.trend || getTrendFromChange(metric.change))}
            <span
              className={`text-sm font-medium ${
                metric.change > 0
                  ? 'text-green-600'
                  : metric.change < 0
                    ? 'text-red-600'
                    : 'text-muted-foreground'
              }`}
            >
              {formatChange(metric.change, metric.changeFormat)}
            </span>
            {metric.changeLabel && (
              <span className="text-xs text-muted-foreground ml-1">
                {metric.changeLabel}
              </span>
            )}
          </div>
        )}

        {/* Description */}
        {metric.description && (
          <p className="text-xs text-muted-foreground">{metric.description}</p>
        )}

        {/* Sparkline */}
        {showSparklines && metric.sparkline && (
          <div className="mt-2">
            <Sparkline data={metric.sparkline} color={statusColor} />
          </div>
        )}
      </div>
    </Card>
  );
}

// ============================================================================
// Sparkline Component
// ============================================================================

interface SparklineProps {
  data: number[];
  color: string;
  height?: number;
}

function Sparkline({ data, color, height = 40 }: SparklineProps) {
  if (data.length < 2) return null;

  const width = 200;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;

  if (range === 0) {
    // All values are the same, draw a flat line
    const y = height / 2;
    return (
      <svg width={width} height={height} className="w-full">
        <polyline
          points={data.map((_, i) => `${(i / (data.length - 1)) * width},${y}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="2"
        />
      </svg>
    );
  }

  const points = data
    .map((value, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} className="w-full">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatMetricValue(metric: Metric): string {
  const value = metric.value;

  if (typeof value === 'string') return value;

  if (metric.format) {
    switch (metric.format) {
      case 'currency':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(value);
      case 'percent':
        return `${(value * 100).toFixed(2)}%`;
      case 'decimal':
        return value.toFixed(2);
      case 'integer':
        return Math.round(value).toLocaleString();
      default:
        return String(value);
    }
  }

  // Default formatting based on magnitude
  if (Math.abs(value) >= 1000000) {
    return `${(value / 1000000).toFixed(2)}M`;
  } else if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(2)}K`;
  } else {
    return value.toFixed(2);
  }
}

function formatChange(change: number, format?: string): string {
  const abs = Math.abs(change);
  const sign = change >= 0 ? '+' : '';

  if (format === 'percent') {
    return `${sign}${(abs * 100).toFixed(2)}%`;
  }

  // Default to percentage
  return `${sign}${abs.toFixed(2)}%`;
}

function getTrendFromChange(change: number): 'up' | 'down' | 'flat' {
  if (change > 0) return 'up';
  if (change < 0) return 'down';
  return 'flat';
}

function getTrendIcon(trend: 'up' | 'down' | 'flat') {
  switch (trend) {
    case 'up':
      return <TrendingUp className="h-4 w-4 text-green-600" />;
    case 'down':
      return <TrendingDown className="h-4 w-4 text-red-600" />;
    case 'flat':
      return <Minus className="h-4 w-4 text-muted-foreground" />;
  }
}

function getMetricIcon(metric: Metric) {
  // Custom icon if provided
  if (metric.icon) {
    // Could map icon strings to actual icon components
    return null;
  }

  // Default icons based on metric type
  if (metric.format === 'currency') {
    return <DollarSign className="h-4 w-4 text-muted-foreground" />;
  }
  if (metric.format === 'percent') {
    return <Percent className="h-4 w-4 text-muted-foreground" />;
  }
  if (metric.sparkline) {
    return <Activity className="h-4 w-4 text-muted-foreground" />;
  }

  return <BarChart3 className="h-4 w-4 text-muted-foreground" />;
}

function getStatusVariant(
  status: 'good' | 'warning' | 'danger' | 'neutral' | 'info'
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'good':
      return 'default';
    case 'warning':
      return 'secondary';
    case 'danger':
      return 'destructive';
    case 'info':
      return 'outline';
    case 'neutral':
    default:
      return 'secondary';
  }
}
