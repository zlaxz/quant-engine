/**
 * EquityCurve - Performance visualization over time
 *
 * PHASE 2: Money Visibility - Visual performance tracking
 *
 * Features:
 * - Equity curve with performance over time
 * - Drawdown overlay (red shaded area below)
 * - Strategy overlays (toggle individual strategy contributions)
 * - Regime overlays (shade background by market regime)
 * - Zoom/pan for detailed analysis
 * - Key metrics: Sharpe, max drawdown, win rate
 *
 * ADHD Design:
 * - Color-coded performance at a glance
 * - Regime bands provide instant context
 * - Hover tooltips with full details
 * - Simple toggle controls
 */

import { useState, useMemo, useCallback } from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  Brush,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Layers,
  Activity,
  BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group';
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// =========================================================================
// Types
// =========================================================================

interface EquityDataPoint {
  date: string;           // ISO date string
  timestamp: number;      // Unix timestamp for sorting
  equity: number;         // Portfolio value
  dailyPnL: number;       // Daily P&L
  drawdown: number;       // Current drawdown %
  drawdownValue: number;  // Current drawdown $
  highWaterMark: number;  // Peak equity
  // Strategy contributions
  strategyContributions?: Record<string, number>;
  // Regime at this point
  regime?: 'trending' | 'meanReverting' | 'volatile' | 'uncertain';
}

interface Strategy {
  id: string;
  name: string;
  color: string;
}

interface RegimePeriod {
  startDate: string;
  endDate: string;
  regime: 'trending' | 'meanReverting' | 'volatile' | 'uncertain';
}

interface EquityCurveProps {
  data: EquityDataPoint[];
  strategies?: Strategy[];
  regimePeriods?: RegimePeriod[];
  metrics?: {
    sharpe: number;
    sortino: number;
    calmar: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    winRate: number;
    profitFactor: number;
    totalReturn: number;
    totalReturnPercent: number;
    annualizedReturn: number;
  };
  onDateRangeChange?: (start: string, end: string) => void;
  className?: string;
  height?: number;
  showBrush?: boolean;
  compact?: boolean;
}

// Regime colors for background shading
const REGIME_COLORS: Record<string, string> = {
  trending: 'rgba(34, 197, 94, 0.1)',      // Green tint
  meanReverting: 'rgba(59, 130, 246, 0.1)', // Blue tint
  volatile: 'rgba(239, 68, 68, 0.1)',       // Red tint
  uncertain: 'rgba(156, 163, 175, 0.1)',    // Gray tint
};

const REGIME_LABELS: Record<string, string> = {
  trending: 'Trending',
  meanReverting: 'Mean Reverting',
  volatile: 'Volatile',
  uncertain: 'Uncertain',
};

// Default strategy colors
const STRATEGY_COLORS = [
  '#3b82f6', // Blue
  '#10b981', // Green
  '#f59e0b', // Amber
  '#8b5cf6', // Purple
  '#ef4444', // Red
  '#06b6d4', // Cyan
  '#ec4899', // Pink
  '#f97316', // Orange
];

// =========================================================================
// Component
// =========================================================================

export function EquityCurve({
  data,
  strategies = [],
  regimePeriods = [],
  metrics,
  onDateRangeChange,
  className,
  height = 400,
  showBrush = true,
  compact = false,
}: EquityCurveProps) {
  // Toggle states for overlays
  const [showDrawdown, setShowDrawdown] = useState(true);
  const [showRegimes, setShowRegimes] = useState(true);
  const [showStrategies, setShowStrategies] = useState(false);
  const [visibleStrategies, setVisibleStrategies] = useState<string[]>(
    strategies.map((s) => s.id)
  );

  // Zoom state
  const [zoomDomain, setZoomDomain] = useState<{
    start?: number;
    end?: number;
  }>({});

  // Process data for chart
  const chartData = useMemo(() => {
    if (!data.length) return [];

    return data.map((point, index) => ({
      ...point,
      // Format date for display
      dateFormatted: new Date(point.date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
      // Calculate drawdown area (for visual)
      drawdownArea: showDrawdown ? point.highWaterMark - point.equity : 0,
      // Index for zoom reference
      index,
    }));
  }, [data, showDrawdown]);

  // Calculate regime reference areas
  const regimeAreas = useMemo(() => {
    if (!showRegimes || !regimePeriods.length) return [];

    return regimePeriods.map((period, index) => {
      const startIndex = chartData.findIndex((d) => d.date >= period.startDate);
      const endIndex = chartData.findIndex((d) => d.date > period.endDate);

      return {
        key: `regime-${index}`,
        x1: startIndex >= 0 ? startIndex : 0,
        x2: endIndex >= 0 ? endIndex : chartData.length - 1,
        fill: REGIME_COLORS[period.regime],
        regime: period.regime,
      };
    });
  }, [showRegimes, regimePeriods, chartData]);

  // Handle brush change (zoom)
  const handleBrushChange = useCallback(
    (brushData: { startIndex?: number; endIndex?: number }) => {
      if (brushData.startIndex !== undefined && brushData.endIndex !== undefined) {
        setZoomDomain({
          start: brushData.startIndex,
          end: brushData.endIndex,
        });

        if (onDateRangeChange && chartData[brushData.startIndex] && chartData[brushData.endIndex]) {
          onDateRangeChange(
            chartData[brushData.startIndex].date,
            chartData[brushData.endIndex].date
          );
        }
      }
    },
    [chartData, onDateRangeChange]
  );

  // Reset zoom
  const handleResetZoom = useCallback(() => {
    setZoomDomain({});
    if (onDateRangeChange && chartData.length) {
      onDateRangeChange(chartData[0].date, chartData[chartData.length - 1].date);
    }
  }, [chartData, onDateRangeChange]);

  // Toggle strategy visibility
  const toggleStrategy = useCallback((strategyId: string) => {
    setVisibleStrategies((prev) =>
      prev.includes(strategyId)
        ? prev.filter((id) => id !== strategyId)
        : [...prev, strategyId]
    );
  }, []);

  // Calculate display data (filtered by zoom)
  const displayData = useMemo(() => {
    if (zoomDomain.start === undefined || zoomDomain.end === undefined) {
      return chartData;
    }
    return chartData.slice(zoomDomain.start, zoomDomain.end + 1);
  }, [chartData, zoomDomain]);

  // Current performance (last point)
  const currentPerformance = useMemo(() => {
    if (!chartData.length) return null;
    const lastPoint = chartData[chartData.length - 1];
    const firstPoint = chartData[0];
    const totalReturn = lastPoint.equity - firstPoint.equity;
    const totalReturnPercent = (totalReturn / firstPoint.equity) * 100;
    return {
      equity: lastPoint.equity,
      totalReturn,
      totalReturnPercent,
      drawdown: lastPoint.drawdown,
      regime: lastPoint.regime,
    };
  }, [chartData]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;

    const point = payload[0]?.payload as EquityDataPoint & { dateFormatted: string };
    if (!point) return null;

    return (
      <div className="bg-background border border-border rounded-lg shadow-lg p-3 min-w-[200px]">
        <div className="font-medium mb-2">{point.dateFormatted}</div>

        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Equity:</span>
            <span className="font-mono">
              ${point.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-muted-foreground">Daily P&L:</span>
            <span
              className={cn(
                'font-mono',
                point.dailyPnL >= 0 ? 'text-green-500' : 'text-red-500'
              )}
            >
              {point.dailyPnL >= 0 ? '+' : ''}
              ${point.dailyPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>

          {point.drawdown < 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Drawdown:</span>
              <span className="font-mono text-red-500">
                {point.drawdown.toFixed(2)}%
              </span>
            </div>
          )}

          {point.regime && (
            <div className="flex justify-between mt-2 pt-2 border-t border-border">
              <span className="text-muted-foreground">Regime:</span>
              <Badge variant="outline" className="text-xs">
                {REGIME_LABELS[point.regime]}
              </Badge>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className={compact ? 'pb-2' : undefined}>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Equity Curve
            </CardTitle>
            {!compact && (
              <CardDescription>
                Performance over time with regime and drawdown overlays
              </CardDescription>
            )}
          </div>

          {/* Quick metrics */}
          {currentPerformance && (
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-2xl font-bold font-mono">
                  ${currentPerformance.equity.toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })}
                </div>
                <div
                  className={cn(
                    'text-sm flex items-center justify-end gap-1',
                    currentPerformance.totalReturnPercent >= 0
                      ? 'text-green-500'
                      : 'text-red-500'
                  )}
                >
                  {currentPerformance.totalReturnPercent >= 0 ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  {currentPerformance.totalReturnPercent >= 0 ? '+' : ''}
                  {currentPerformance.totalReturnPercent.toFixed(2)}%
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        {!compact && (
          <div className="flex items-center gap-4 mt-4 flex-wrap">
            {/* Overlay toggles */}
            <TooltipProvider>
              <div className="flex items-center gap-2">
                <UITooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={showDrawdown ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setShowDrawdown(!showDrawdown)}
                    >
                      <TrendingDown className="h-4 w-4 mr-1" />
                      Drawdown
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Toggle drawdown overlay</TooltipContent>
                </UITooltip>

                <UITooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={showRegimes ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setShowRegimes(!showRegimes)}
                    >
                      <Layers className="h-4 w-4 mr-1" />
                      Regimes
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Toggle regime background shading</TooltipContent>
                </UITooltip>

                {strategies.length > 0 && (
                  <UITooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={showStrategies ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setShowStrategies(!showStrategies)}
                      >
                        <BarChart3 className="h-4 w-4 mr-1" />
                        Strategies
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Toggle strategy contribution lines</TooltipContent>
                  </UITooltip>
                )}
              </div>

              {/* Zoom controls */}
              {(zoomDomain.start !== undefined || zoomDomain.end !== undefined) && (
                <UITooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" onClick={handleResetZoom}>
                      <RefreshCw className="h-4 w-4 mr-1" />
                      Reset Zoom
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reset to full date range</TooltipContent>
                </UITooltip>
              )}
            </TooltipProvider>

            {/* Strategy toggles */}
            {showStrategies && strategies.length > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                {strategies.map((strategy, index) => (
                  <Button
                    key={strategy.id}
                    variant={visibleStrategies.includes(strategy.id) ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => toggleStrategy(strategy.id)}
                    style={{
                      borderColor: strategy.color || STRATEGY_COLORS[index % STRATEGY_COLORS.length],
                      backgroundColor: visibleStrategies.includes(strategy.id)
                        ? strategy.color || STRATEGY_COLORS[index % STRATEGY_COLORS.length]
                        : 'transparent',
                    }}
                    className="text-xs"
                  >
                    {visibleStrategies.includes(strategy.id) ? (
                      <Eye className="h-3 w-3 mr-1" />
                    ) : (
                      <EyeOff className="h-3 w-3 mr-1" />
                    )}
                    {strategy.name}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Metrics bar */}
        {metrics && !compact && (
          <div className="grid grid-cols-4 md:grid-cols-8 gap-4 mt-4 text-sm">
            <div>
              <div className="text-muted-foreground">Sharpe</div>
              <div
                className={cn(
                  'font-mono font-medium',
                  metrics.sharpe >= 2
                    ? 'text-green-500'
                    : metrics.sharpe >= 1
                      ? 'text-yellow-500'
                      : 'text-red-500'
                )}
              >
                {metrics.sharpe.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Sortino</div>
              <div className="font-mono font-medium">{metrics.sortino.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Calmar</div>
              <div className="font-mono font-medium">{metrics.calmar.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Max DD</div>
              <div className="font-mono font-medium text-red-500">
                {metrics.maxDrawdownPercent.toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Win Rate</div>
              <div className="font-mono font-medium">{(metrics.winRate * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-muted-foreground">Profit Factor</div>
              <div
                className={cn(
                  'font-mono font-medium',
                  metrics.profitFactor >= 1.5
                    ? 'text-green-500'
                    : metrics.profitFactor >= 1
                      ? 'text-yellow-500'
                      : 'text-red-500'
                )}
              >
                {metrics.profitFactor.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Total Return</div>
              <div
                className={cn(
                  'font-mono font-medium',
                  metrics.totalReturnPercent >= 0 ? 'text-green-500' : 'text-red-500'
                )}
              >
                {metrics.totalReturnPercent >= 0 ? '+' : ''}
                {metrics.totalReturnPercent.toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Annual Return</div>
              <div
                className={cn(
                  'font-mono font-medium',
                  metrics.annualizedReturn >= 0 ? 'text-green-500' : 'text-red-500'
                )}
              >
                {metrics.annualizedReturn >= 0 ? '+' : ''}
                {metrics.annualizedReturn.toFixed(1)}%
              </div>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            data={displayData}
            margin={{ top: 10, right: 30, left: 0, bottom: showBrush ? 30 : 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />

            {/* Regime background areas */}
            {regimeAreas.map((area) => (
              <ReferenceArea
                key={area.key}
                x1={area.x1}
                x2={area.x2}
                fill={area.fill}
                fillOpacity={1}
              />
            ))}

            {/* Zero line reference */}
            <ReferenceLine y={chartData[0]?.equity} stroke="#666" strokeDasharray="3 3" />

            <XAxis
              dataKey="dateFormatted"
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />

            <YAxis
              yAxisId="equity"
              orientation="left"
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
              domain={['dataMin - 1000', 'dataMax + 1000']}
            />

            {showDrawdown && (
              <YAxis
                yAxisId="drawdown"
                orientation="right"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${value}%`}
                domain={['dataMin - 5', 0]}
              />
            )}

            <Tooltip content={<CustomTooltip />} />

            {!compact && (
              <Legend
                verticalAlign="top"
                height={36}
                formatter={(value) => <span className="text-sm">{value}</span>}
              />
            )}

            {/* Drawdown area */}
            {showDrawdown && (
              <Area
                yAxisId="drawdown"
                type="monotone"
                dataKey="drawdown"
                name="Drawdown"
                stroke="#ef4444"
                fill="#ef4444"
                fillOpacity={0.2}
                strokeWidth={1}
              />
            )}

            {/* Main equity line */}
            <Line
              yAxisId="equity"
              type="monotone"
              dataKey="equity"
              name="Portfolio Value"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 6, fill: '#3b82f6' }}
            />

            {/* High water mark line */}
            <Line
              yAxisId="equity"
              type="monotone"
              dataKey="highWaterMark"
              name="High Water Mark"
              stroke="#94a3b8"
              strokeWidth={1}
              strokeDasharray="5 5"
              dot={false}
            />

            {/* Strategy contribution lines */}
            {showStrategies &&
              strategies
                .filter((s) => visibleStrategies.includes(s.id))
                .map((strategy, index) => (
                  <Line
                    key={strategy.id}
                    yAxisId="equity"
                    type="monotone"
                    dataKey={`strategyContributions.${strategy.id}`}
                    name={strategy.name}
                    stroke={strategy.color || STRATEGY_COLORS[index % STRATEGY_COLORS.length]}
                    strokeWidth={1.5}
                    dot={false}
                    strokeOpacity={0.7}
                  />
                ))}

            {/* Brush for zoom/pan */}
            {showBrush && (
              <Brush
                dataKey="dateFormatted"
                height={30}
                stroke="#3b82f6"
                onChange={handleBrushChange}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>

        {/* Regime legend */}
        {showRegimes && regimePeriods.length > 0 && !compact && (
          <div className="flex items-center justify-center gap-4 mt-4 text-sm">
            <span className="text-muted-foreground">Regimes:</span>
            {Object.entries(REGIME_COLORS).map(([regime, color]) => (
              <div key={regime} className="flex items-center gap-1">
                <div
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: color.replace('0.1', '0.5') }}
                />
                <span>{REGIME_LABELS[regime]}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default EquityCurve;
