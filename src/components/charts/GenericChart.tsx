/**
 * GenericChart - Universal Chart Renderer
 *
 * Data-driven chart component supporting multiple visualization types.
 * Uses Recharts library with shadcn/ui styling.
 */

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
  DEFAULT_COLORS,
} from './types';

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
        <ResponsiveContainer
          width={config.width || '100%'}
          height={config.height || 400}
        >
          {renderChart()}
        </ResponsiveContainer>
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
  const { x, y, values, colorScale = 'blues', showValues = true } = data.data;

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
