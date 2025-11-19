import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Loader2, TrendingUp, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useChatContext } from '@/contexts/ChatContext';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Strategy {
  id: string;
  key: string;
  name: string;
  description: string | null;
}

interface BacktestRun {
  id: string;
  strategy_key: string;
  params: any;
  status: string;
  metrics: any;
  equity_curve: any[];
  started_at: string;
  completed_at: string | null;
}

export const QuantPanel = () => {
  const { selectedSessionId, selectedWorkspaceId } = useChatContext();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');
  const [startDate, setStartDate] = useState('2020-01-01');
  const [endDate, setEndDate] = useState('2024-12-31');
  const [capital, setCapital] = useState('100000');
  const [isRunning, setIsRunning] = useState(false);
  const [currentRun, setCurrentRun] = useState<BacktestRun | null>(null);
  const [isSendingSummary, setIsSendingSummary] = useState(false);

  useEffect(() => {
    loadStrategies();
  }, []);

  const loadStrategies = async () => {
    try {
      const { data, error } = await supabase
        .from('strategies')
        .select('*')
        .eq('active', true)
        .order('name');

      if (error) throw error;

      // If no strategies exist, seed sample strategies
      if (!data || data.length === 0) {
        await seedSampleStrategies();
        return;
      }

      setStrategies(data);
      if (data.length > 0) {
        setSelectedStrategy(data[0].key);
      }
    } catch (error: any) {
      console.error('Error loading strategies:', error);
      toast.error('Failed to load strategies');
    }
  };

  const seedSampleStrategies = async () => {
    const sampleStrategies = [
      {
        key: 'skew_convexity_v1',
        name: 'SKEW Convexity v1',
        description: 'Volatility skew arbitrage with convexity hedging',
        active: true,
      },
      {
        key: 'vol_spike_reversal_v1',
        name: 'Vol Spike Reversal v1',
        description: 'Mean reversion on VIX spikes with delta hedging',
        active: true,
      },
      {
        key: 'momentum_breakout_v1',
        name: 'Momentum Breakout v1',
        description: 'Trend-following momentum with volatility filters',
        active: true,
      },
    ];

    try {
      const { error } = await supabase
        .from('strategies')
        .insert(sampleStrategies);

      if (error) throw error;

      toast.success('Sample strategies created');
      await loadStrategies();
    } catch (error: any) {
      console.error('Error seeding strategies:', error);
      toast.error('Failed to create sample strategies');
    }
  };

  const runBacktest = async () => {
    if (!selectedSessionId || !selectedStrategy) {
      toast.error('Please select a session and strategy');
      return;
    }

    setIsRunning(true);
    setCurrentRun(null);

    try {
      const { data, error } = await supabase.functions.invoke('backtest-run', {
        body: {
          sessionId: selectedSessionId,
          strategyKey: selectedStrategy,
          params: {
            startDate,
            endDate,
            capital: parseFloat(capital),
          },
        },
      });

      if (error) throw error;

      setCurrentRun(data);
      toast.success('Backtest completed successfully');
    } catch (error: any) {
      console.error('Error running backtest:', error);
      toast.error(error.message || 'Failed to run backtest');
    } finally {
      setIsRunning(false);
    }
  };

  const sendSummaryToChat = async () => {
    if (!currentRun || !selectedSessionId || !selectedWorkspaceId) return;

    setIsSendingSummary(true);

    try {
      const strategyName = strategies.find(s => s.key === currentRun.strategy_key)?.name || currentRun.strategy_key;
      const metrics = currentRun.metrics;

      const summary = `📊 Backtest Results

Strategy: ${strategyName}
Period: ${currentRun.params.startDate} to ${currentRun.params.endDate}
Initial Capital: $${currentRun.params.capital.toLocaleString()}

Performance Metrics:
• CAGR: ${(metrics.cagr * 100).toFixed(2)}%
• Sharpe Ratio: ${metrics.sharpe.toFixed(2)}
• Max Drawdown: ${(metrics.max_drawdown * 100).toFixed(2)}%
• Win Rate: ${(metrics.win_rate * 100).toFixed(1)}%
• Total Trades: ${metrics.total_trades}
• Avg Trade Duration: ${metrics.avg_trade_duration_days} days

Final Equity: $${currentRun.equity_curve[currentRun.equity_curve.length - 1].value.toLocaleString()}`;

      // Send to chat via the chat edge function
      const { error } = await supabase.functions.invoke('chat', {
        body: {
          sessionId: selectedSessionId,
          workspaceId: selectedWorkspaceId,
          content: summary,
        },
      });

      if (error) throw error;

      toast.success('Summary sent to chat');
    } catch (error: any) {
      console.error('Error sending summary:', error);
      toast.error('Failed to send summary to chat');
    } finally {
      setIsSendingSummary(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold font-mono mb-2">Strategy Backtesting</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Run quantitative strategy backtests with historical data
        </p>
      </div>

      {/* Strategy Selection */}
      <div className="space-y-2">
        <Label htmlFor="strategy" className="text-xs font-mono">Strategy</Label>
        <Select value={selectedStrategy} onValueChange={setSelectedStrategy}>
          <SelectTrigger id="strategy" className="text-xs">
            <SelectValue placeholder="Select strategy..." />
          </SelectTrigger>
          <SelectContent className="bg-background">
            {strategies.map((strategy) => (
              <SelectItem key={strategy.key} value={strategy.key} className="text-xs">
                {strategy.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedStrategy && (
          <p className="text-xs text-muted-foreground">
            {strategies.find(s => s.key === selectedStrategy)?.description}
          </p>
        )}
      </div>

      {/* Backtest Parameters */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="startDate" className="text-xs font-mono">Start Date</Label>
          <Input
            id="startDate"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="text-xs"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endDate" className="text-xs font-mono">End Date</Label>
          <Input
            id="endDate"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="text-xs"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="capital" className="text-xs font-mono">Initial Capital ($)</Label>
        <Input
          id="capital"
          type="number"
          value={capital}
          onChange={(e) => setCapital(e.target.value)}
          className="text-xs"
          min="1000"
          step="1000"
        />
      </div>

      {/* Run Button */}
      <Button
        onClick={runBacktest}
        disabled={isRunning || !selectedStrategy || !selectedSessionId}
        className="w-full"
        size="sm"
      >
        {isRunning ? (
          <>
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            Running Backtest...
          </>
        ) : (
          <>
            <TrendingUp className="mr-2 h-3 w-3" />
            Run Backtest
          </>
        )}
      </Button>

      {/* Results */}
      {currentRun && currentRun.status === 'completed' && (
        <div className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold font-mono">Results</h4>
            <Button
              onClick={sendSummaryToChat}
              disabled={isSendingSummary}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
            >
              {isSendingSummary ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  <Send className="mr-1 h-3 w-3" />
                  Send to Chat
                </>
              )}
            </Button>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-2">
            <Card className="p-3">
              <div className="text-[10px] text-muted-foreground font-mono uppercase">CAGR</div>
              <div className="text-sm font-bold">
                {(currentRun.metrics.cagr * 100).toFixed(2)}%
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-[10px] text-muted-foreground font-mono uppercase">Sharpe</div>
              <div className="text-sm font-bold">
                {currentRun.metrics.sharpe.toFixed(2)}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-[10px] text-muted-foreground font-mono uppercase">Max DD</div>
              <div className="text-sm font-bold text-destructive">
                {(currentRun.metrics.max_drawdown * 100).toFixed(2)}%
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-[10px] text-muted-foreground font-mono uppercase">Win Rate</div>
              <div className="text-sm font-bold">
                {(currentRun.metrics.win_rate * 100).toFixed(1)}%
              </div>
            </Card>
          </div>

          {/* Equity Curve */}
          <div className="space-y-2">
            <div className="text-[10px] text-muted-foreground font-mono uppercase">Equity Curve</div>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={currentRun.equity_curve}>
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
                    tickFormatter={(value) => formatCurrency(value)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--background))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '6px',
                      fontSize: '11px',
                    }}
                    formatter={(value: number) => [formatCurrency(value), 'Equity']}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Additional Info */}
          <div className="text-xs text-muted-foreground font-mono space-y-1">
            <div>Total Trades: {currentRun.metrics.total_trades}</div>
            <div>Avg Trade Duration: {currentRun.metrics.avg_trade_duration_days} days</div>
            <div>
              Final Equity: {formatCurrency(currentRun.equity_curve[currentRun.equity_curve.length - 1].value)}
            </div>
          </div>
        </div>
      )}

      {!selectedSessionId && (
        <div className="p-4 bg-muted/50 rounded-md text-center">
          <p className="text-xs text-muted-foreground">
            Select a chat session to run backtests
          </p>
        </div>
      )}
    </div>
  );
};
