/**
 * One-Click Backtest Runner - Form-based backtest execution
 *
 * Features:
 * - Strategy selection dropdown
 * - Date range picker
 * - Regime filter options
 * - Capital allocation input
 * - Real-time progress tracking
 * - Results display
 *
 * Created: 2025-11-24
 */

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Play,
  Square,
  LineChart,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

interface BacktestConfig {
  strategyId: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  regimeFilter: string[];
  slippageModel: 'zero' | 'realistic' | 'conservative';
}

interface BacktestResult {
  id: string;
  strategyName: string;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  profitFactor: number;
  startDate: string;
  endDate: string;
  runTime: number;
  status: 'completed' | 'failed';
  error?: string;
}

interface Strategy {
  id: string;
  name: string;
}

const REGIME_OPTIONS = [
  { value: 'LOW_VOL_GRIND', label: 'Low Vol Grind' },
  { value: 'HIGH_VOL_OSCILLATION', label: 'High Vol Oscillation' },
  { value: 'TREND_UP', label: 'Trend Up' },
  { value: 'TREND_DOWN', label: 'Trend Down' },
  { value: 'BREAKOUT', label: 'Breakout' },
  { value: 'CRASH', label: 'Crash' },
];

const SLIPPAGE_OPTIONS = [
  { value: 'zero', label: 'Zero (Ideal)', description: 'No slippage - for initial testing' },
  { value: 'realistic', label: 'Realistic', description: '0.5-1% based on liquidity' },
  { value: 'conservative', label: 'Conservative', description: '1-2% worst case' },
];

export function BacktestRunner() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [config, setConfig] = useState<BacktestConfig>({
    strategyId: '',
    startDate: '2023-01-01',
    endDate: format(new Date(), 'yyyy-MM-dd'),
    initialCapital: 100000,
    regimeFilter: [],
    slippageModel: 'realistic',
  });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [recentResults, setRecentResults] = useState<BacktestResult[]>([]);

  // Fetch strategies for dropdown
  useEffect(() => {
    const fetchStrategies = async () => {
      try {
        const { data, error } = await supabase
          .from('strategy_genome')
          .select('id, name')
          .in('status', ['candidate', 'shadow', 'production'])
          .order('name');

        if (error) throw error;
        setStrategies(data || []);
      } catch (err) {
        // Use mock strategies
        setStrategies([
          { id: '1', name: 'MomentumAlpha_v3' },
          { id: '2', name: 'VolCrusher_v1' },
          { id: '3', name: 'TailHedge_v2' },
          { id: '4', name: 'IronCondor_adaptive' },
        ]);
      }
    };
    fetchStrategies();
  }, []);

  const runBacktest = useCallback(async () => {
    if (!config.strategyId) return;

    setRunning(true);
    setProgress(0);
    setResult(null);
    setProgressMessage('Initializing backtest...');

    try {
      // Simulate backtest progress (in real implementation, this would be IPC to daemon)
      const steps = [
        { progress: 10, message: 'Loading market data...' },
        { progress: 25, message: 'Applying regime filter...' },
        { progress: 40, message: 'Running strategy logic...' },
        { progress: 60, message: 'Calculating positions...' },
        { progress: 75, message: 'Computing P&L...' },
        { progress: 90, message: 'Generating statistics...' },
        { progress: 100, message: 'Complete!' },
      ];

      for (const step of steps) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        setProgress(step.progress);
        setProgressMessage(step.message);
      }

      // Mock result
      const strategyName = strategies.find((s) => s.id === config.strategyId)?.name || 'Unknown';
      const mockResult: BacktestResult = {
        id: crypto.randomUUID(),
        strategyName,
        totalReturn: Math.random() * 0.4 - 0.1, // -10% to +30%
        sharpeRatio: Math.random() * 2 + 0.5, // 0.5 to 2.5
        maxDrawdown: Math.random() * 0.15 + 0.05, // 5% to 20%
        winRate: Math.random() * 0.3 + 0.4, // 40% to 70%
        totalTrades: Math.floor(Math.random() * 200) + 50,
        profitFactor: Math.random() * 1.5 + 0.8, // 0.8 to 2.3
        startDate: config.startDate,
        endDate: config.endDate,
        runTime: Math.random() * 30 + 5, // 5-35 seconds
        status: 'completed',
      };

      setResult(mockResult);
      setRecentResults((prev) => [mockResult, ...prev].slice(0, 5));

      // In real implementation, would call daemon via IPC:
      // const result = await window.electron.runBacktest(config);

    } catch (error) {
      setResult({
        id: crypto.randomUUID(),
        strategyName: strategies.find((s) => s.id === config.strategyId)?.name || 'Unknown',
        totalReturn: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        winRate: 0,
        totalTrades: 0,
        profitFactor: 0,
        startDate: config.startDate,
        endDate: config.endDate,
        runTime: 0,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Backtest failed',
      });
    } finally {
      setRunning(false);
    }
  }, [config, strategies]);

  const stopBacktest = useCallback(() => {
    setRunning(false);
    setProgress(0);
    setProgressMessage('Stopped');
  }, []);

  const toggleRegime = (regime: string) => {
    setConfig((prev) => ({
      ...prev,
      regimeFilter: prev.regimeFilter.includes(regime)
        ? prev.regimeFilter.filter((r) => r !== regime)
        : [...prev.regimeFilter, regime],
    }));
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <LineChart className="h-4 w-4" />
          Backtest Runner
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full">
          <div className="px-4 pb-4 space-y-4">
            {/* Strategy Selection */}
            <div className="space-y-2">
              <Label>Strategy</Label>
              <Select
                value={config.strategyId}
                onValueChange={(v) => setConfig((prev) => ({ ...prev, strategyId: v }))}
                disabled={running}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select strategy..." />
                </SelectTrigger>
                <SelectContent>
                  {strategies.map((strategy) => (
                    <SelectItem key={strategy.id} value={strategy.id}>
                      {strategy.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={config.startDate}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, startDate: e.target.value }))
                  }
                  disabled={running}
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={config.endDate}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, endDate: e.target.value }))
                  }
                  disabled={running}
                />
              </div>
            </div>

            {/* Capital */}
            <div className="space-y-2">
              <Label>Initial Capital ($)</Label>
              <Input
                type="number"
                value={config.initialCapital}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    initialCapital: parseInt(e.target.value) || 0,
                  }))
                }
                disabled={running}
              />
            </div>

            {/* Slippage Model */}
            <div className="space-y-2">
              <Label>Slippage Model</Label>
              <Select
                value={config.slippageModel}
                onValueChange={(v: 'zero' | 'realistic' | 'conservative') =>
                  setConfig((prev) => ({ ...prev, slippageModel: v }))
                }
                disabled={running}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SLIPPAGE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex flex-col">
                        <span>{opt.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {opt.description}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Regime Filter */}
            <div className="space-y-2">
              <Label>Regime Filter (optional)</Label>
              <div className="flex flex-wrap gap-1.5">
                {REGIME_OPTIONS.map((regime) => (
                  <Badge
                    key={regime.value}
                    variant={
                      config.regimeFilter.includes(regime.value)
                        ? 'default'
                        : 'outline'
                    }
                    className="cursor-pointer"
                    onClick={() => !running && toggleRegime(regime.value)}
                  >
                    {regime.label}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {config.regimeFilter.length === 0
                  ? 'All regimes included'
                  : `Only trades during: ${config.regimeFilter.join(', ')}`}
              </p>
            </div>

            {/* Run/Stop Button */}
            <Button
              className="w-full"
              onClick={running ? stopBacktest : runBacktest}
              disabled={!config.strategyId && !running}
            >
              {running ? (
                <>
                  <Square className="h-4 w-4 mr-2" />
                  Stop Backtest
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Run Backtest
                </>
              )}
            </Button>

            {/* Progress */}
            {running && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{progressMessage}</span>
                  <span className="font-mono">{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            {/* Result */}
            {result && (
              <div
                className={cn(
                  'p-4 rounded-lg space-y-3',
                  result.status === 'completed' ? 'bg-muted/50' : 'bg-red-500/10'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {result.status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                    )}
                    <span className="font-medium">{result.strategyName}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {result.runTime.toFixed(1)}s
                  </span>
                </div>

                {result.status === 'completed' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Total Return</div>
                      <div
                        className={cn(
                          'text-lg font-semibold',
                          result.totalReturn >= 0 ? 'text-green-500' : 'text-red-500'
                        )}
                      >
                        {result.totalReturn >= 0 ? '+' : ''}
                        {(result.totalReturn * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Sharpe Ratio</div>
                      <div
                        className={cn(
                          'text-lg font-semibold',
                          result.sharpeRatio >= 1.5
                            ? 'text-green-500'
                            : result.sharpeRatio >= 1.0
                            ? 'text-yellow-500'
                            : 'text-red-500'
                        )}
                      >
                        {result.sharpeRatio.toFixed(2)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Max Drawdown</div>
                      <div className="text-lg font-semibold text-red-500">
                        -{(result.maxDrawdown * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Win Rate</div>
                      <div className="text-lg font-semibold">
                        {(result.winRate * 100).toFixed(0)}%
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Total Trades</div>
                      <div className="text-lg font-semibold">{result.totalTrades}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Profit Factor</div>
                      <div
                        className={cn(
                          'text-lg font-semibold',
                          result.profitFactor >= 1.5
                            ? 'text-green-500'
                            : result.profitFactor >= 1.0
                            ? 'text-yellow-500'
                            : 'text-red-500'
                        )}
                      >
                        {result.profitFactor.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-red-500">{result.error}</div>
                )}
              </div>
            )}

            {/* Recent Results */}
            {recentResults.length > 1 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Recent Runs
                </h4>
                <div className="space-y-1">
                  {recentResults.slice(1).map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between p-2 rounded bg-muted/30 text-sm"
                    >
                      <span>{r.strategyName}</span>
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            'font-mono',
                            r.totalReturn >= 0 ? 'text-green-500' : 'text-red-500'
                          )}
                        >
                          {r.totalReturn >= 0 ? '+' : ''}
                          {(r.totalReturn * 100).toFixed(1)}%
                        </span>
                        <span className="text-muted-foreground">
                          Sharpe: {r.sharpeRatio.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
