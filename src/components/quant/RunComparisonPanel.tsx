import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, X, Loader2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { toast } from 'sonner';
import type { BacktestRun, BacktestParams, BacktestMetrics } from '@/types/backtest';

interface Strategy {
  id: string;
  key: string;
  name: string;
  description: string | null;
}

interface RunComparisonPanelProps {
  selectedRunIds: string[];
  runs: BacktestRun[];
  strategies: Strategy[];
  onClearSelection: () => void;
}

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export const RunComparisonPanel = ({ 
  selectedRunIds, 
  runs: externalRuns, 
  strategies,
  onClearSelection 
}: RunComparisonPanelProps) => {
  const [runs, setRuns] = useState<BacktestRun[]>(externalRuns);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch runs if not provided
  useEffect(() => {
    if (externalRuns.length === 0 && selectedRunIds.length > 0) {
      loadRuns();
    } else {
      setRuns(externalRuns);
    }
  }, [selectedRunIds, externalRuns]);

  const loadRuns = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('backtest_runs')
        .select('*')
        .in('id', selectedRunIds);

      if (error) throw error;
      setRuns(data || []);
    } catch (error) {
      console.error('Error loading runs:', error);
      toast.error('Failed to load comparison runs');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Loading runs for comparison...</span>
        </div>
      </Card>
    );
  }

  // Filter to only selected, completed runs
  const selectedRuns = selectedRunIds
    .map(id => runs.find(r => r.id === id))
    .filter((r): r is BacktestRun => r !== undefined && r.status === 'completed');

  if (selectedRunIds.length < 2) {
    return (
      <Card className="p-6">
        <div className="text-center space-y-2">
          <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Select at least 2 runs from Recent Runs to compare
          </p>
        </div>
      </Card>
    );
  }

  if (selectedRuns.length < 2) {
    return (
      <Card className="p-6">
        <div className="text-center space-y-2">
          <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Not enough completed runs selected. Only completed runs can be compared.
          </p>
          <Button variant="outline" size="sm" onClick={onClearSelection}>
            Clear Selection
          </Button>
        </div>
      </Card>
    );
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Normalize equity curves to start at 1.0 for comparison
  const normalizedData = selectedRuns
    .filter(run => run.equity_curve && Array.isArray(run.equity_curve) && run.equity_curve.length > 0)
    .map((run, idx) => {
      const curve = run.equity_curve!; // Safe after filter
      const firstValue = curve[0]?.value || 1;
      return {
        runId: run.id,
        color: CHART_COLORS[idx % CHART_COLORS.length],
        label: `Run ${idx + 1}: ${strategies.find(s => s.key === run.strategy_key)?.name || run.strategy_key}`,
        data: curve.map(point => ({
          date: point.date,
          normalizedValue: point.value / firstValue,
        })),
      };
    });

  // Merge all dates for combined chart
  const allDates = Array.from(
    new Set(normalizedData.flatMap(d => d.data.map(p => p.date)))
  ).sort();

  const chartData = allDates.map(date => {
    const point: Record<string, string | number | null> = { date };
    normalizedData.forEach((run, idx) => {
      const dataPoint = run.data.find(p => p.date === date);
      point[`run${idx}`] = dataPoint?.normalizedValue || null;
    });
    return point;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold font-mono">Run Comparison ({selectedRuns.length} runs)</h3>
        <Button variant="ghost" size="sm" onClick={onClearSelection}>
          <X className="h-3 w-3 mr-1" />
          Clear Selection
        </Button>
      </div>

      {/* Basic Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {selectedRuns.map((run, idx) => (
          <Card key={run.id} className="p-3 space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                  />
                  <span className="text-xs font-mono font-semibold">Run {idx + 1}</span>
                </div>
                <div className="text-xs font-semibold mt-1">
                  {strategies.find(s => s.key === run.strategy_key)?.name || run.strategy_key}
                </div>
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground space-y-1">
              <div>Period: {run.params.startDate} to {run.params.endDate}</div>
              <div>Capital: {formatCurrency(run.params.capital)}</div>
              <div className="flex items-center gap-1">
                Engine: 
                <Badge variant={run.engine_source === 'external' ? 'default' : 'secondary'} className="h-4 text-[9px]">
                  {run.engine_source === 'external' ? 'Live' : run.engine_source === 'stub_fallback' ? 'Fallback' : 'Stub'}
                </Badge>
              </div>
              {run.notes && <div>📝 {run.notes}</div>}
            </div>
          </Card>
        ))}
      </div>

      {/* Metrics Comparison Table */}
      <Card className="p-4">
        <h4 className="text-xs font-semibold font-mono mb-3">Key Metrics</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 font-mono text-[10px] text-muted-foreground">Metric</th>
                {selectedRuns.map((_, idx) => (
                  <th key={idx} className="text-right py-2 font-mono text-[10px]">
                    <div className="flex items-center justify-end gap-1">
                      <div 
                        className="w-2 h-2 rounded-full" 
                        style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                      />
                      Run {idx + 1}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/50">
                <td className="py-2 font-mono text-muted-foreground">CAGR</td>
                {selectedRuns.map((run, idx) => {
                  const metrics = run.metrics as BacktestMetrics | null;
                  return (
                    <td key={idx} className="text-right py-2 font-semibold">
                      {metrics?.cagr !== undefined ? `${(metrics.cagr * 100).toFixed(2)}%` : 'N/A'}
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2 font-mono text-muted-foreground">Sharpe</td>
                {selectedRuns.map((run, idx) => {
                  const metrics = run.metrics as BacktestMetrics | null;
                  return (
                    <td key={idx} className="text-right py-2 font-semibold">
                      {metrics?.sharpe !== undefined ? metrics.sharpe.toFixed(2) : 'N/A'}
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2 font-mono text-muted-foreground">Max Drawdown</td>
                {selectedRuns.map((run, idx) => {
                  const metrics = run.metrics as BacktestMetrics | null;
                  return (
                    <td key={idx} className="text-right py-2 font-semibold text-destructive">
                      {metrics?.max_drawdown !== undefined ? `${(metrics.max_drawdown * 100).toFixed(2)}%` : 'N/A'}
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2 font-mono text-muted-foreground">Win Rate</td>
                {selectedRuns.map((run, idx) => {
                  const metrics = run.metrics as BacktestMetrics | null;
                  return (
                    <td key={idx} className="text-right py-2 font-semibold">
                      {metrics?.win_rate !== undefined ? `${(metrics.win_rate * 100).toFixed(1)}%` : 'N/A'}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td className="py-2 font-mono text-muted-foreground">Total Trades</td>
                {selectedRuns.map((run, idx) => {
                  const metrics = run.metrics as BacktestMetrics | null;
                  return (
                    <td key={idx} className="text-right py-2 font-semibold">
                      {metrics?.total_trades || 'N/A'}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Normalized Equity Curves */}
      <Card className="p-4">
        <h4 className="text-xs font-semibold font-mono mb-3">Normalized Equity Curves (Starting at 1.0)</h4>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return `${date.getMonth() + 1}/${date.getFullYear().toString().slice(2)}`;
                }}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => value.toFixed(2)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '11px',
                }}
                formatter={(value: number) => [value.toFixed(3), '']}
                labelFormatter={(label) => `Date: ${label}`}
              />
              <Legend 
                wrapperStyle={{ fontSize: '10px' }}
                formatter={(value, _entry, index) => normalizedData[index]?.label || value}
              />
              {normalizedData.map((_, idx) => (
                <Line
                  key={idx}
                  type="monotone"
                  dataKey={`run${idx}`}
                  stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
};
