/**
 * GenericChart - Universal Chart Renderer
 *
 * Data-driven chart component supporting multiple visualization types.
 * Uses Recharts library with shadcn/ui styling.
 */

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  ChartData,
  LineChartData,
  BarChartData,
  ScatterData,
  PieChartData,
  AreaChartData,
  ComposedChartData,
  HeatmapData,
  CandlestickData,
  GaugeData,
  MultiGaugeData,
  WaterfallData,
  TreemapData,
  PayoffData,
  DEFAULT_COLORS,
} from './types';

class ChartErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  state = { hasError: false, error: undefined };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full text-red-500 p-4">
          <div>Chart Error: {this.state.error?.message || 'Unknown error'}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface GenericChartProps {
  data: ChartData;
}

export function GenericChart({ data }: GenericChartProps) {
  const config = data.config || {};

  const renderChart = () => {
    try {
      switch (data.type) {
        case 'line':
          return <LineChartRenderer data={data as LineChartData} />;
        case 'bar':
          return <BarChartRenderer data={data as BarChartData} />;
        case 'scatter':
          return <ScatterChartRenderer data={data as ScatterData} />;
        case 'pie':
          return <PieChartRenderer data={data as PieChartData} />;
        case 'area':
          return <AreaChartRenderer data={data as AreaChartData} />;
        case 'composed':
          return <ComposedChartRenderer data={data as ComposedChartData} />;
        case 'heatmap':
          return <HeatmapRenderer data={data as HeatmapData} />;
        case 'candlestick':
          return <CandlestickRenderer data={data as CandlestickData} />;
        case 'gauge':
          return <GaugeRenderer data={data as GaugeData} />;
        case 'multi_gauge':
          return <MultiGaugeRenderer data={data as MultiGaugeData} />;
        case 'waterfall':
          return <WaterfallRenderer data={data as WaterfallData} />;
        case 'treemap':
          return <TreemapRenderer data={data as TreemapData} />;
        case 'payoff':
          return <PayoffRenderer data={data as PayoffData} />;
        default:
          return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Unsupported chart type: {(data as { type: string }).type}
            </div>
          );
      }
    } catch (error) {
      return (
        <div className="flex items-center justify-center h-full text-destructive">
          Error rendering chart: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      );
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{data.title}</CardTitle>
        {data.description && <CardDescription>{data.description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <ChartErrorBoundary>
          <ResponsiveContainer
            width={config.width || '100%'}
            height={config.height || 400}
          >
            {renderChart()}
          </ResponsiveContainer>
        </ChartErrorBoundary>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Line Chart Renderer
// ============================================================================

function LineChartRenderer({ data }: { data: LineChartData }) {
  const config = data.config || {};
  const chartData = transformLineData(data.data.series);

  return (
    <LineChart
      data={chartData}
      margin={config.margin || { top: 5, right: 30, left: 20, bottom: 5 }}
    >
      {config.grid !== false && (
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
      )}
      <XAxis
        dataKey="x"
        label={config.xLabel ? { value: config.xLabel, position: 'insideBottom', offset: -5 } : undefined}
        className="text-xs"
      />
      <YAxis
        label={config.yLabel ? { value: config.yLabel, angle: -90, position: 'insideLeft' } : undefined}
        className="text-xs"
      />
      {config.tooltip !== false && (
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px',
          }}
          labelStyle={{ color: 'hsl(var(--popover-foreground))' }}
        />
      )}
      {config.legend !== false && <Legend />}
      {data.data.series.map((series, i) => (
        <Line
          key={series.name}
          type="monotone"
          dataKey={series.name}
          stroke={series.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
          strokeWidth={series.width || 2}
          strokeDasharray={
            series.style === 'dashed' ? '5 5' : series.style === 'dotted' ? '2 2' : undefined
          }
          dot={series.dot !== false}
          activeDot={{ r: 6 }}
        />
      ))}
    </LineChart>
  );
}

function transformLineData(series: LineChartData['data']['series']) {
  if (series.length === 0) return [];

  // Get all unique x values
  const xValues = Array.from(
    new Set(series.flatMap(s => s.values.map(v => v.x)))
  );

  // Transform to Recharts format
  return xValues.map(x => {
    const point: Record<string, number | string | null> = { x };
    series.forEach(s => {
      const value = s.values.find(v => v.x === x);
      point[s.name] = value?.y ?? null;
    });
    return point;
  });
}

// ============================================================================
// Bar Chart Renderer
// ============================================================================

function BarChartRenderer({ data }: { data: BarChartData }) {
  const config = data.config || {};
  const chartData = transformBarData(data);
  const orientation = data.data.orientation || 'vertical';

  const ChartComponent = orientation === 'horizontal' ? BarChart : BarChart;

  return (
    <ChartComponent
      data={chartData}
      layout={orientation === 'horizontal' ? 'horizontal' : 'vertical'}
      margin={config.margin || { top: 5, right: 30, left: 20, bottom: 5 }}
    >
      {config.grid !== false && (
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
      )}
      {orientation === 'horizontal' ? (
        <>
          <XAxis type="number" className="text-xs" />
          <YAxis dataKey="category" type="category" className="text-xs" />
        </>
      ) : (
        <>
          <XAxis dataKey="category" className="text-xs" />
          <YAxis className="text-xs" />
        </>
      )}
      {config.tooltip !== false && (
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px',
          }}
        />
      )}
      {config.legend !== false && <Legend />}
      {data.data.series.map((series, i) => (
        <Bar
          key={series.name}
          dataKey={series.name}
          fill={series.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
          stackId={data.data.stacked ? 'stack' : undefined}
        />
      ))}
    </ChartComponent>
  );
}

function transformBarData(data: BarChartData) {
  return data.data.categories.map((category, i) => {
    const point: Record<string, string | number> = { category };
    data.data.series.forEach(series => {
      point[series.name] = series.values[i] ?? 0;
    });
    return point;
  });
}

// ============================================================================
// Scatter Chart Renderer
// ============================================================================

function ScatterChartRenderer({ data }: { data: ScatterData }) {
  const config = data.config || {};

  return (
    <ScatterChart margin={config.margin || { top: 20, right: 20, bottom: 20, left: 20 }}>
      {config.grid !== false && (
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
      )}
      <XAxis
        type="number"
        dataKey="x"
        name={config.xLabel || 'X'}
        className="text-xs"
      />
      <YAxis
        type="number"
        dataKey="y"
        name={config.yLabel || 'Y'}
        className="text-xs"
      />
      {config.tooltip !== false && (
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px',
          }}
        />
      )}
      <Scatter
        name="Data Points"
        data={data.data.points}
        fill={DEFAULT_COLORS[0]}
      >
        {data.data.points.map((point, index) => (
          <Cell
            key={`cell-${index}`}
            fill={point.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
          />
        ))}
      </Scatter>
    </ScatterChart>
  );
}

// ============================================================================
// Pie Chart Renderer
// ============================================================================

function PieChartRenderer({ data }: { data: PieChartData }) {
  const config = data.config || {};
  const innerRadius = data.data.innerRadius || 0;
  const outerRadius = data.data.outerRadius || 80;

  return (
    <PieChart>
      {config.tooltip !== false && (
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px',
          }}
        />
      )}
      {config.legend !== false && <Legend />}
      <Pie
        data={data.data.slices}
        cx="50%"
        cy="50%"
        innerRadius={innerRadius}
        outerRadius={outerRadius}
        fill="#8884d8"
        dataKey="value"
        nameKey="label"
        label={(entry) => `${entry.label}: ${entry.percentage || entry.value}%`}
      >
        {data.data.slices.map((slice, index) => (
          <Cell
            key={`cell-${index}`}
            fill={slice.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
          />
        ))}
      </Pie>
    </PieChart>
  );
}

// ============================================================================
// Area Chart Renderer
// ============================================================================

function AreaChartRenderer({ data }: { data: AreaChartData }) {
  const config = data.config || {};
  const chartData = transformAreaData(data.data.series);

  return (
    <AreaChart
      data={chartData}
      margin={config.margin || { top: 5, right: 30, left: 20, bottom: 5 }}
    >
      {config.grid !== false && (
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
      )}
      <XAxis dataKey="x" className="text-xs" />
      <YAxis className="text-xs" />
      {config.tooltip !== false && (
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px',
          }}
        />
      )}
      {config.legend !== false && <Legend />}
      {data.data.series.map((series, i) => (
        <Area
          key={series.name}
          type="monotone"
          dataKey={series.name}
          stroke={series.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
          fill={series.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
          fillOpacity={series.opacity || 0.6}
          stackId={data.data.stacked ? 'stack' : undefined}
        />
      ))}
    </AreaChart>
  );
}

function transformAreaData(series: AreaChartData['data']['series']) {
  if (series.length === 0) return [];

  const xValues = Array.from(
    new Set(series.flatMap(s => s.values.map(v => v.x)))
  );

  return xValues.map(x => {
    const point: Record<string, number | string | null> = { x };
    series.forEach(s => {
      const value = s.values.find(v => v.x === x);
      point[s.name] = value?.y ?? null;
    });
    return point;
  });
}

// ============================================================================
// Composed Chart Renderer
// ============================================================================

function ComposedChartRenderer({ data }: { data: ComposedChartData }) {
  const config = data.config || {};
  const chartData = transformComposedData(data.data.series);

  return (
    <ComposedChart
      data={chartData}
      margin={config.margin || { top: 5, right: 30, left: 20, bottom: 5 }}
    >
      {config.grid !== false && (
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
      )}
      <XAxis dataKey="x" className="text-xs" />
      <YAxis className="text-xs" />
      {config.tooltip !== false && (
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px',
          }}
        />
      )}
      {config.legend !== false && <Legend />}
      {data.data.series.map((series, i) => {
        const color = series.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
        switch (series.type) {
          case 'line':
            return (
              <Line
                key={series.name}
                type="monotone"
                dataKey={series.name}
                stroke={color}
                yAxisId={series.yAxisId || 0}
              />
            );
          case 'bar':
            return (
              <Bar
                key={series.name}
                dataKey={series.name}
                fill={color}
                yAxisId={series.yAxisId || 0}
              />
            );
          case 'area':
            return (
              <Area
                key={series.name}
                type="monotone"
                dataKey={series.name}
                stroke={color}
                fill={color}
                fillOpacity={0.6}
                yAxisId={series.yAxisId || 0}
              />
            );
          default:
            return null;
        }
      })}
    </ComposedChart>
  );
}

function transformComposedData(series: ComposedChartData['data']['series']) {
  if (series.length === 0) return [];

  const xValues = Array.from(
    new Set(series.flatMap(s => s.values.map(v => v.x)))
  );

  return xValues.map(x => {
    const point: Record<string, number | string | null> = { x };
    series.forEach(s => {
      const value = s.values.find(v => v.x === x);
      point[s.name] = value?.y ?? null;
    });
    return point;
  });
}

// ============================================================================
// Heatmap Renderer (Custom Implementation)
// ============================================================================

function HeatmapRenderer({ data }: { data: HeatmapData }) {
  const { x, y, values, showValues = true } = data.data;

  // Find min/max for color scaling
  const flatValues = values.flat();
  const min = Math.min(...flatValues);
  const max = Math.max(...flatValues);

  const getColor = (value: number) => {
    const normalized = (value - min) / (max - min);
    // Simple blue gradient for now
    const intensity = Math.round(normalized * 200 + 55);
    return `rgb(${255 - intensity}, ${255 - intensity}, 255)`;
  };

  return (
    <div className="w-full h-full flex items-center justify-center overflow-auto">
      <div className="inline-block">
        <div className="grid gap-0.5" style={{ gridTemplateColumns: `auto repeat(${x.length}, 1fr)` }}>
          {/* Header row */}
          <div className="p-2" />
          {x.map(label => (
            <div key={label} className="p-2 text-xs text-center font-medium">
              {label}
            </div>
          ))}

          {/* Data rows */}
          {y.map((yLabel, i) => (
            <>
              <div key={`label-${yLabel}`} className="p-2 text-xs font-medium flex items-center">
                {yLabel}
              </div>
              {x.map((_, j) => (
                <div
                  key={`cell-${i}-${j}`}
                  className="p-2 text-xs text-center border border-border flex items-center justify-center min-w-[60px] min-h-[40px]"
                  style={{ backgroundColor: getColor(values[i][j]) }}
                >
                  {showValues && values[i][j].toFixed(2)}
                </div>
              ))}
            </>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Candlestick Renderer (Simplified)
// ============================================================================

function CandlestickRenderer({ data }: { data: CandlestickData }) {
  const config = data.config || {};

  // Convert OHLC to format Recharts can understand (using composed chart)
  const chartData = data.data.ohlc.map(candle => ({
    date: candle.date,
    low: candle.low,
    high: candle.high,
    open: candle.open,
    close: candle.close,
  }));

  return (
    <ComposedChart
      data={chartData}
      margin={config.margin || { top: 5, right: 30, left: 20, bottom: 5 }}
    >
      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
      <XAxis dataKey="date" className="text-xs" />
      <YAxis className="text-xs" />
      <Tooltip
        contentStyle={{
          backgroundColor: 'hsl(var(--popover))',
          border: '1px solid hsl(var(--border))',
          borderRadius: '6px',
        }}
      />
      <Legend />
      <Line type="monotone" dataKey="high" stroke="#10b981" strokeWidth={1} dot={false} />
      <Line type="monotone" dataKey="low" stroke="#ef4444" strokeWidth={1} dot={false} />
      <Bar dataKey="close" fill="#3b82f6" />
    </ComposedChart>
  );
}

// ============================================================================
// Gauge Renderer (Circular Progress)
// ============================================================================

function GaugeRenderer({ data }: { data: GaugeData }) {
  const { value, min, max, thresholds = [], unit = '' } = data.data;

  // Calculate percentage
  const percentage = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

  // Find current threshold color
  const currentThreshold = thresholds.find(t => value >= t.from && value <= t.to);
  const color = currentThreshold?.color || '#3b82f6';

  // SVG arc calculation
  const radius = 80;
  const strokeWidth = 12;
  const circumference = 2 * Math.PI * radius;
  const arcLength = (percentage / 100) * circumference * 0.75; // 270 degrees

  return (
    <div className="w-full h-full flex flex-col items-center justify-center">
      <svg width="200" height="180" viewBox="0 0 200 200" className="transform -rotate-[135deg]">
        {/* Background arc */}
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference * 0.75} ${circumference}`}
          strokeLinecap="round"
        />

        {/* Threshold segments */}
        {thresholds.map((threshold, i) => {
          const startPct = ((threshold.from - min) / (max - min)) * 100;
          const endPct = ((threshold.to - min) / (max - min)) * 100;
          const segmentLength = ((endPct - startPct) / 100) * circumference * 0.75;
          const offset = ((startPct) / 100) * circumference * 0.75;

          return (
            <circle
              key={i}
              cx="100"
              cy="100"
              r={radius}
              fill="none"
              stroke={threshold.color}
              strokeWidth={strokeWidth - 4}
              strokeDasharray={`${segmentLength} ${circumference}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              opacity={0.3}
            />
          );
        })}

        {/* Value arc */}
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>

      {/* Value display */}
      <div className="absolute text-center mt-[-60px]">
        <div className="text-3xl font-bold" style={{ color }}>
          {typeof value === 'number' ? value.toFixed(1) : value}{unit}
        </div>
        {currentThreshold?.label && (
          <div className="text-sm text-muted-foreground">{currentThreshold.label}</div>
        )}
      </div>

      {/* Min/Max labels */}
      <div className="flex justify-between w-40 mt-2 text-xs text-muted-foreground">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Multi-Gauge Renderer (Grid of Gauges)
// ============================================================================

function MultiGaugeRenderer({ data }: { data: MultiGaugeData }) {
  const { gauges } = data.data;

  return (
    <div className="w-full h-full grid grid-cols-2 md:grid-cols-3 gap-4 p-4">
      {gauges.map((gauge, i) => (
        <div key={i} className="flex flex-col items-center">
          <h4 className="text-sm font-medium mb-2">{gauge.title}</h4>
          <MiniGauge
            value={gauge.value}
            min={gauge.min}
            max={gauge.max}
            unit={gauge.unit || ''}
            thresholds={gauge.thresholds || []}
          />
        </div>
      ))}
    </div>
  );
}

function MiniGauge({ value, min, max, unit, thresholds }: {
  value: number;
  min: number;
  max: number;
  unit: string;
  thresholds: Array<{ from: number; to: number; color: string; label?: string }>;
}) {
  const percentage = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const currentThreshold = thresholds.find(t => value >= t.from && value <= t.to);
  const color = currentThreshold?.color || '#3b82f6';

  const radius = 40;
  const strokeWidth = 8;
  const circumference = 2 * Math.PI * radius;
  const arcLength = (percentage / 100) * circumference * 0.75;

  return (
    <div className="relative flex flex-col items-center">
      <svg width="100" height="90" viewBox="0 0 100 100" className="transform -rotate-[135deg]">
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference * 0.75} ${circumference}`}
          strokeLinecap="round"
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute top-8 text-center">
        <div className="text-lg font-bold" style={{ color }}>
          {value.toFixed(1)}{unit}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Waterfall Renderer (P&L Attribution)
// ============================================================================

function WaterfallRenderer({ data }: { data: WaterfallData }) {
  const { items } = data.data;

  // Calculate cumulative values for waterfall
  let cumulative = 0;
  const chartData = items.map((item, i) => {
    if (item.isTotal) {
      return {
        name: item.label,
        value: item.value,
        start: 0,
        end: item.value,
        isTotal: true,
        fill: '#3b82f6',
      };
    }

    const start = cumulative;
    cumulative += item.value;

    return {
      name: item.label,
      value: item.value,
      start: Math.min(start, cumulative),
      end: Math.max(start, cumulative),
      height: Math.abs(item.value),
      isTotal: false,
      fill: item.value >= 0 ? '#10b981' : '#ef4444',
    };
  });

  return (
    <BarChart
      data={chartData}
      margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
    >
      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
      <XAxis
        dataKey="name"
        className="text-xs"
        angle={-45}
        textAnchor="end"
        height={60}
      />
      <YAxis className="text-xs" />
      <Tooltip
        contentStyle={{
          backgroundColor: 'hsl(var(--popover))',
          border: '1px solid hsl(var(--border))',
          borderRadius: '6px',
        }}
        formatter={(value: number) => [`$${value.toLocaleString()}`, 'Value']}
      />
      {/* Invisible bars for stacking base */}
      <Bar dataKey="start" stackId="waterfall" fill="transparent" />
      {/* Visible bars */}
      <Bar dataKey="height" stackId="waterfall" fill="#8884d8">
        {chartData.map((entry, index) => (
          <Cell key={`cell-${index}`} fill={entry.fill} />
        ))}
      </Bar>
    </BarChart>
  );
}

// ============================================================================
// Treemap Renderer (Portfolio Allocation)
// ============================================================================

function TreemapRenderer({ data }: { data: TreemapData }) {
  const { items } = data.data;

  // Flatten for display
  const flatItems = flattenTreemap(items);
  const total = flatItems.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="w-full h-full p-2">
      <div className="flex flex-wrap gap-1 h-full">
        {flatItems.map((item, i) => {
          const pct = (item.value / total) * 100;
          const color = item.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];

          return (
            <div
              key={i}
              className="flex flex-col items-center justify-center text-white text-xs font-medium p-2 rounded transition-all hover:opacity-80"
              style={{
                backgroundColor: color,
                flexBasis: `${Math.max(pct * 2, 8)}%`,
                flexGrow: pct,
                minHeight: '60px',
              }}
              title={`${item.name}: $${item.value.toLocaleString()} (${pct.toFixed(1)}%)`}
            >
              <span className="truncate max-w-full">{item.name}</span>
              <span className="opacity-80">${(item.value / 1000).toFixed(0)}K</span>
              <span className="opacity-60">{pct.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function flattenTreemap(items: TreemapData['data']['items'], prefix = ''): Array<{ name: string; value: number; color?: string }> {
  const result: Array<{ name: string; value: number; color?: string }> = [];

  for (const item of items) {
    if (item.children && item.children.length > 0) {
      result.push(...flattenTreemap(item.children, `${prefix}${item.name} / `));
    } else {
      result.push({
        name: `${prefix}${item.name}`,
        value: item.value,
        color: item.color,
      });
    }
  }

  return result.sort((a, b) => b.value - a.value);
}

// ============================================================================
// Payoff Diagram Renderer (Options Strategy)
// ============================================================================

function PayoffRenderer({ data }: { data: PayoffData }) {
  const { strategies, underlyingRange, currentPrice } = data.data;

  // Generate price points
  const [minPrice, maxPrice] = underlyingRange;
  const step = (maxPrice - minPrice) / 100;
  const pricePoints: number[] = [];
  for (let p = minPrice; p <= maxPrice; p += step) {
    pricePoints.push(p);
  }

  // Calculate payoff at each price point
  const chartData = pricePoints.map(price => {
    let totalPayoff = 0;

    for (const leg of strategies) {
      const multiplier = leg.position === 'long' ? 1 : -1;
      const qty = leg.quantity * multiplier;

      let intrinsic = 0;
      if (leg.type === 'call') {
        intrinsic = Math.max(0, price - leg.strike);
      } else {
        intrinsic = Math.max(0, leg.strike - price);
      }

      const legPayoff = (intrinsic - (multiplier > 0 ? leg.premium : -leg.premium)) * qty * 100;
      totalPayoff += legPayoff;
    }

    return {
      price: price.toFixed(0),
      payoff: totalPayoff,
    };
  });

  // Find break-even points
  const breakEvens: number[] = [];
  for (let i = 1; i < chartData.length; i++) {
    if ((chartData[i - 1].payoff < 0 && chartData[i].payoff >= 0) ||
        (chartData[i - 1].payoff > 0 && chartData[i].payoff <= 0)) {
      breakEvens.push(parseFloat(chartData[i].price));
    }
  }

  // Find max profit and max loss
  const maxProfit = Math.max(...chartData.map(d => d.payoff));
  const maxLoss = Math.min(...chartData.map(d => d.payoff));

  return (
    <div className="w-full h-full">
      <AreaChart
        data={chartData}
        margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="price"
          className="text-xs"
          label={{ value: 'Underlying Price', position: 'insideBottom', offset: -10 }}
        />
        <YAxis
          className="text-xs"
          label={{ value: 'P&L ($)', angle: -90, position: 'insideLeft' }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px',
          }}
          formatter={(value: number) => [`$${value.toFixed(0)}`, 'P&L']}
          labelFormatter={(label) => `Price: $${label}`}
        />

        {/* Zero line */}
        <Line
          type="monotone"
          dataKey={() => 0}
          stroke="hsl(var(--muted-foreground))"
          strokeDasharray="3 3"
          dot={false}
          legendType="none"
        />

        {/* Payoff area - split by profit/loss */}
        <Area
          type="monotone"
          dataKey="payoff"
          stroke="#3b82f6"
          strokeWidth={2}
          fill="url(#payoffGradient)"
        />

        {/* Current price reference line */}
        {currentPrice && (
          <Line
            type="monotone"
            dataKey={(d: { price: string }) => parseFloat(d.price) === Math.round(currentPrice) ? maxProfit * 1.1 : null}
            stroke="#f59e0b"
            strokeDasharray="5 5"
            dot={false}
          />
        )}

        <defs>
          <linearGradient id="payoffGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.8} />
            <stop offset="50%" stopColor="#10b981" stopOpacity={0.1} />
            <stop offset="50%" stopColor="#ef4444" stopOpacity={0.1} />
            <stop offset="100%" stopColor="#ef4444" stopOpacity={0.8} />
          </linearGradient>
        </defs>
      </AreaChart>

      {/* Summary stats */}
      <div className="flex justify-center gap-6 mt-2 text-xs">
        <span className="text-green-500">Max Profit: ${maxProfit.toFixed(0)}</span>
        <span className="text-red-500">Max Loss: ${maxLoss.toFixed(0)}</span>
        {breakEvens.length > 0 && (
          <span className="text-muted-foreground">
            Break-even: ${breakEvens.map(b => b.toFixed(0)).join(', $')}
          </span>
        )}
        {currentPrice && (
          <span className="text-amber-500">Current: ${currentPrice.toFixed(0)}</span>
        )}
      </div>
    </div>
  );
}
