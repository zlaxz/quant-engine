/**
 * Shadow Position Monitor - Paper trading visibility
 *
 * Shows:
 * - Open paper positions with live P&L
 * - Graduation progress per strategy
 * - Recent closes with slippage metrics
 *
 * Created: 2025-11-24
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  TrendingUp,
  TrendingDown,
  Target,
  Clock,
  DollarSign,
  GraduationCap,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface ShadowPosition {
  id: string;
  strategy_id: string;
  strategy_name?: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  entry_price: number;
  current_price: number;
  current_pnl: number;
  entry_time: string;
  regime_at_entry: string;
}

interface GraduationProgress {
  strategy_id: string;
  strategy_name: string;
  trade_count: number;
  win_rate: number;
  rolling_sharpe: number;
  total_pnl: number;
  progress_percent: number;
  is_ready: boolean;
}

interface RecentTrade {
  id: string;
  strategy_id: string;
  strategy_name?: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  entry_price: number;
  exit_price: number;
  pnl: number;
  slippage_cost: number;
  duration_seconds: number;
  closed_at: string;
}

const GRADUATION_THRESHOLD = 50;
const SHARPE_THRESHOLD = 1.5;

// Demo data for when no real data exists
function getDemoPositions(): ShadowPosition[] {
  return [
    {
      id: 'demo-pos-1',
      strategy_id: 'strat-1',
      strategy_name: 'MomentumBreakout_v3',
      symbol: 'SPY',
      side: 'long',
      quantity: 100,
      entry_price: 585.20,
      current_price: 588.45,
      current_pnl: 325.00,
      entry_time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      regime_at_entry: 'LOW_VOL_GRIND',
    },
    {
      id: 'demo-pos-2',
      strategy_id: 'strat-2',
      strategy_name: 'VixMeanRevert_2024',
      symbol: 'SVXY',
      side: 'long',
      quantity: 50,
      entry_price: 42.80,
      current_price: 42.15,
      current_pnl: -32.50,
      entry_time: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      regime_at_entry: 'LOW_VOL_GRIND',
    },
  ];
}

function getDemoProgress(): GraduationProgress[] {
  return [
    {
      strategy_id: 'strat-2',
      strategy_name: 'VixMeanRevert_2024',
      trade_count: 48,
      win_rate: 0.625,
      rolling_sharpe: 1.67,
      total_pnl: 4250.00,
      progress_percent: 96,
      is_ready: false,
    },
    {
      strategy_id: 'strat-1',
      strategy_name: 'MomentumBreakout_v3',
      trade_count: 52,
      win_rate: 0.58,
      rolling_sharpe: 1.82,
      total_pnl: 6800.00,
      progress_percent: 100,
      is_ready: true,
    },
    {
      strategy_id: 'strat-3',
      strategy_name: 'ThetaDecay_Weekly',
      trade_count: 31,
      win_rate: 0.74,
      rolling_sharpe: 1.35,
      total_pnl: 2100.00,
      progress_percent: 62,
      is_ready: false,
    },
  ];
}

function getDemoTrades(): RecentTrade[] {
  const now = Date.now();
  return [
    {
      id: 'demo-trade-1',
      strategy_id: 'strat-1',
      strategy_name: 'MomentumBreakout_v3',
      symbol: 'QQQ',
      side: 'long',
      quantity: 50,
      entry_price: 498.20,
      exit_price: 502.85,
      pnl: 232.50,
      slippage_cost: 0.15,
      duration_seconds: 14400,
      closed_at: new Date(now - 30 * 60 * 1000).toISOString(),
    },
    {
      id: 'demo-trade-2',
      strategy_id: 'strat-2',
      strategy_name: 'VixMeanRevert_2024',
      symbol: 'VXX',
      side: 'short',
      quantity: 100,
      entry_price: 28.40,
      exit_price: 27.95,
      pnl: 45.00,
      slippage_cost: 0.25,
      duration_seconds: 7200,
      closed_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'demo-trade-3',
      strategy_id: 'strat-3',
      strategy_name: 'ThetaDecay_Weekly',
      symbol: 'SPY',
      side: 'short',
      quantity: 10,
      entry_price: 586.50,
      exit_price: 588.20,
      pnl: -17.00,
      slippage_cost: 0.08,
      duration_seconds: 86400,
      closed_at: new Date(now - 8 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

export function ShadowPositionMonitor() {
  const [positions, setPositions] = useState<ShadowPosition[]>([]);
  const [graduationProgress, setGraduationProgress] = useState<GraduationProgress[]>([]);
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      // Fetch open positions
      const { data: positionsData, error: positionsError } = await supabase
        .from('shadow_positions')
        .select(`
          id,
          strategy_id,
          symbol,
          side,
          quantity,
          entry_price,
          current_price,
          current_pnl,
          entry_time,
          regime_at_entry,
          strategy_genome(name)
        `)
        .eq('is_open', true)
        .order('entry_time', { ascending: false })
        .limit(20);

      // If table doesn't exist, use demo data
      if (positionsError?.code === '42P01' || positionsError?.code === 'PGRST116') {
        setPositions(getDemoPositions());
        setGraduationProgress(getDemoProgress());
        setRecentTrades(getDemoTrades());
        setError(null);
        setLoading(false);
        return;
      }

      if (positionsError) throw positionsError;

      // Fetch graduation progress
      const { data: graduationData, error: graduationError } = await supabase
        .from('graduation_tracker')
        .select(`
          strategy_id,
          trade_count,
          win_rate,
          rolling_sharpe,
          total_pnl,
          strategy_genome(name)
        `)
        .order('rolling_sharpe', { ascending: false })
        .limit(10);

      if (graduationError) throw graduationError;

      // Fetch recent closed trades
      const { data: tradesData, error: tradesError } = await supabase
        .from('shadow_trades')
        .select(`
          id,
          strategy_id,
          symbol,
          side,
          quantity,
          entry_price,
          exit_price,
          pnl,
          slippage_cost,
          duration_seconds,
          closed_at,
          strategy_genome(name)
        `)
        .not('closed_at', 'is', null)
        .order('closed_at', { ascending: false })
        .limit(20);

      if (tradesError) throw tradesError;

      // Transform positions
      const transformedPositions: ShadowPosition[] = (positionsData || []).map((p: any) => ({
        ...p,
        strategy_name: p.strategy_genome?.name || 'Unknown',
      }));

      // Transform graduation progress
      const transformedProgress: GraduationProgress[] = (graduationData || []).map((g: any) => ({
        strategy_id: g.strategy_id,
        strategy_name: g.strategy_genome?.name || 'Unknown',
        trade_count: g.trade_count || 0,
        win_rate: g.win_rate || 0,
        rolling_sharpe: g.rolling_sharpe || 0,
        total_pnl: g.total_pnl || 0,
        progress_percent: Math.min(100, (g.trade_count / GRADUATION_THRESHOLD) * 100),
        is_ready: g.trade_count >= GRADUATION_THRESHOLD && g.rolling_sharpe >= SHARPE_THRESHOLD,
      }));

      // Transform recent trades
      const transformedTrades: RecentTrade[] = (tradesData || []).map((t: any) => ({
        ...t,
        strategy_name: t.strategy_genome?.name || 'Unknown',
      }));

      setPositions(transformedPositions);
      setGraduationProgress(transformedProgress);
      setRecentTrades(transformedTrades);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch shadow data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const formatPnL = (pnl: number) => {
    const formatted = Math.abs(pnl).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    });
    return pnl >= 0 ? `+${formatted}` : `-${formatted.slice(1)}`;
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  if (loading) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-full">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Target className="h-4 w-4" />
          Shadow Trading
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <Tabs defaultValue="positions" className="h-full flex flex-col">
          <TabsList className="mx-4 grid w-auto grid-cols-3">
            <TabsTrigger value="positions" className="text-xs">
              Positions ({positions.length})
            </TabsTrigger>
            <TabsTrigger value="graduation" className="text-xs">
              Graduation
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs">
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="positions" className="flex-1 min-h-0 mt-2">
            <ScrollArea className="h-full">
              <div className="px-4 pb-4 space-y-2">
                {error ? (
                  <div className="text-center py-4 text-red-500 text-sm">{error}</div>
                ) : positions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No open positions
                    <p className="text-xs mt-1">Start the daemon to begin paper trading</p>
                  </div>
                ) : (
                  positions.map((pos) => (
                    <div
                      key={pos.id}
                      className="p-2 rounded-lg bg-muted/50 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={pos.side === 'long' ? 'default' : 'destructive'}
                            className="text-xs"
                          >
                            {pos.side.toUpperCase()}
                          </Badge>
                          <span className="font-medium">{pos.symbol}</span>
                          <span className="text-xs text-muted-foreground">
                            x{pos.quantity}
                          </span>
                        </div>
                        <div
                          className={cn(
                            'font-mono text-sm font-medium',
                            pos.current_pnl >= 0 ? 'text-green-500' : 'text-red-500'
                          )}
                        >
                          {formatPnL(pos.current_pnl)}
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{pos.strategy_name}</span>
                        <span>Entry: ${pos.entry_price.toFixed(2)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="graduation" className="flex-1 min-h-0 mt-2">
            <ScrollArea className="h-full">
              <div className="px-4 pb-4 space-y-3">
                {graduationProgress.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No strategies in progress
                  </div>
                ) : (
                  graduationProgress.map((prog) => (
                    <div
                      key={prog.strategy_id}
                      className={cn(
                        'p-3 rounded-lg space-y-2',
                        prog.is_ready ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-muted/50'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {prog.is_ready && (
                            <GraduationCap className="h-4 w-4 text-yellow-500" />
                          )}
                          <span className="font-medium text-sm">{prog.strategy_name}</span>
                        </div>
                        <Badge
                          variant={prog.rolling_sharpe >= SHARPE_THRESHOLD ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          Sharpe: {prog.rolling_sharpe.toFixed(2)}
                        </Badge>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            {prog.trade_count}/{GRADUATION_THRESHOLD} trades
                          </span>
                          <span className="text-muted-foreground">
                            Win: {(prog.win_rate * 100).toFixed(0)}%
                          </span>
                        </div>
                        <Progress value={prog.progress_percent} className="h-1.5" />
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Total P&L:</span>
                        <span
                          className={cn(
                            'font-mono',
                            prog.total_pnl >= 0 ? 'text-green-500' : 'text-red-500'
                          )}
                        >
                          {formatPnL(prog.total_pnl)}
                        </span>
                      </div>

                      {prog.is_ready && (
                        <div className="text-xs text-yellow-600 font-medium text-center pt-1">
                          Ready for production review!
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="history" className="flex-1 min-h-0 mt-2">
            <ScrollArea className="h-full">
              <div className="px-4 pb-4 space-y-2">
                {recentTrades.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No closed trades yet
                  </div>
                ) : (
                  recentTrades.map((trade) => (
                    <div
                      key={trade.id}
                      className="p-2 rounded-lg bg-muted/50 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {trade.pnl >= 0 ? (
                            <TrendingUp className="h-3 w-3 text-green-500" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-red-500" />
                          )}
                          <span className="font-medium text-sm">{trade.symbol}</span>
                          <Badge variant="outline" className="text-xs">
                            {trade.side}
                          </Badge>
                        </div>
                        <span
                          className={cn(
                            'font-mono text-sm font-medium',
                            trade.pnl >= 0 ? 'text-green-500' : 'text-red-500'
                          )}
                        >
                          {formatPnL(trade.pnl)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{trade.strategy_name}</span>
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDuration(trade.duration_seconds)}
                          </span>
                          <span className="flex items-center gap-1">
                            <DollarSign className="h-3 w-3" />
                            Slip: ${trade.slippage_cost.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
