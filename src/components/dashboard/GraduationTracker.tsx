/**
 * GraduationTracker.tsx - The Shadow Mode Pipeline
 *
 * Kanban-style view showing strategies progressing through:
 * - Paper (The Lab) - Strategies under Red Team attack
 * - Shadow (Proving Ground) - Live paper trading (0 size)
 * - Live (The Arena) - Active strategies with real capital
 *
 * NO MOCK DATA - Real Supabase connection.
 *
 * Created: 2025-12-03
 */

import React, { useState, useEffect, useCallback, memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Beaker,
  Ghost,
  Swords,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Activity,
  Shield,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase, isSupabaseConfigured } from '@/integrations/supabase/client';

// Types matching the database schema
interface Strategy {
  id: string;
  name: string;
  status: 'incubating' | 'candidate' | 'shadow' | 'production' | 'retired' | 'failed';
  fitness_score: number | null;
  sharpe_ratio: number | null;
  created_at: string;
}

interface GraduationProgress {
  id: string;
  strategy_id: string;
  shadow_trade_count: number;
  shadow_sharpe: number | null;
  shadow_win_rate: number | null;
  shadow_max_drawdown: number | null;
  shadow_total_pnl: number;
  status: 'pending' | 'graduated' | 'failed' | 'paused';
  graduation_threshold_met: boolean;
  required_trade_count: number;
  required_sharpe: number;
  required_win_rate: number;
  last_evaluation_at: string | null;
}

interface StrategyWithProgress extends Strategy {
  graduation?: GraduationProgress;
}

// Pipeline stages
type PipelineStage = 'paper' | 'shadow' | 'live';

function GraduationTrackerComponent() {
  // Connection state
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Strategies by stage
  const [paperStrategies, setPaperStrategies] = useState<StrategyWithProgress[]>([]);
  const [shadowStrategies, setShadowStrategies] = useState<StrategyWithProgress[]>([]);
  const [liveStrategies, setLiveStrategies] = useState<StrategyWithProgress[]>([]);

  // Promoting state
  const [promotingId, setPromotingId] = useState<string | null>(null);

  // Check connection and fetch data
  useEffect(() => {
    const fetchStrategies = async () => {
      if (!isSupabaseConfigured) {
        setConnected(false);
        setError('Supabase not configured');
        setLoading(false);
        return;
      }

      try {
        // Fetch all strategies with their graduation progress
        const { data: strategies, error: stratError } = await supabase
          .from('strategy_genome')
          .select('*')
          .in('status', ['incubating', 'candidate', 'shadow', 'production'])
          .order('created_at', { ascending: false });

        if (stratError) {
          if (stratError.code === '42P01') {
            setError('strategy_genome table not found - run migrations');
          } else {
            throw stratError;
          }
          setConnected(true);
          setLoading(false);
          return;
        }

        // Fetch graduation progress for all strategies
        const { data: graduations, error: gradError } = await supabase
          .from('graduation_tracker')
          .select('*');

        if (gradError && gradError.code !== '42P01') {
          console.error('[GraduationTracker] Graduation fetch error:', gradError);
        }

        // Merge strategies with their graduation progress
        const graduationMap = new Map(
          (graduations || []).map((g) => [g.strategy_id, g])
        );

        const enrichedStrategies: StrategyWithProgress[] = (strategies || []).map((s) => ({
          ...s,
          graduation: graduationMap.get(s.id),
        }));

        // Sort into buckets
        const paper: StrategyWithProgress[] = [];
        const shadow: StrategyWithProgress[] = [];
        const live: StrategyWithProgress[] = [];

        enrichedStrategies.forEach((s) => {
          if (s.status === 'incubating' || s.status === 'candidate') {
            paper.push(s);
          } else if (s.status === 'shadow') {
            shadow.push(s);
          } else if (s.status === 'production') {
            live.push(s);
          }
        });

        setPaperStrategies(paper);
        setShadowStrategies(shadow);
        setLiveStrategies(live);
        setConnected(true);
        setError(null);
      } catch (err) {
        console.error('[GraduationTracker] Error:', err);
        setConnected(false);
        setError(err instanceof Error ? err.message : 'Failed to fetch strategies');
      } finally {
        setLoading(false);
      }
    };

    fetchStrategies();

    // Set up real-time subscription
    const channel = supabase
      .channel('graduation-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'strategy_genome' },
        () => fetchStrategies()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'graduation_tracker' },
        () => fetchStrategies()
      )
      .subscribe();

    // Poll every 10 seconds
    const interval = setInterval(fetchStrategies, 10000);

    return () => {
      channel.unsubscribe();
      clearInterval(interval);
    };
  }, []);

  // Promote strategy to next stage
  const promoteStrategy = useCallback(
    async (strategy: StrategyWithProgress, targetStatus: string) => {
      setPromotingId(strategy.id);
      setError(null);

      try {
        const { error: updateError } = await supabase
          .from('strategy_genome')
          .update({ status: targetStatus })
          .eq('id', strategy.id);

        if (updateError) throw updateError;

        // If promoting to production, update graduation tracker
        if (targetStatus === 'production') {
          await supabase
            .from('graduation_tracker')
            .update({
              status: 'graduated',
              graduation_date: new Date().toISOString(),
            })
            .eq('strategy_id', strategy.id);
        }

        console.log('[GraduationTracker] Promoted:', strategy.name, 'to', targetStatus);
      } catch (err) {
        console.error('[GraduationTracker] Promotion failed:', err);
        setError(err instanceof Error ? err.message : 'Promotion failed');
      } finally {
        setPromotingId(null);
      }
    },
    []
  );

  // Check if strategy can be promoted
  const canPromote = useCallback((strategy: StrategyWithProgress): boolean => {
    const g = strategy.graduation;
    if (!g) return false;

    // For shadow → production: need 50+ trades AND sharpe > 1.5
    if (strategy.status === 'shadow') {
      return (
        g.shadow_trade_count >= g.required_trade_count &&
        (g.shadow_sharpe || 0) >= g.required_sharpe &&
        (g.shadow_win_rate || 0) >= g.required_win_rate
      );
    }

    // For paper → shadow: just needs to exist with passing red team
    return true;
  }, []);

  // Strategy card component
  const StrategyCard = ({
    strategy,
    stage,
  }: {
    strategy: StrategyWithProgress;
    stage: PipelineStage;
  }) => {
    const g = strategy.graduation;
    const canPromoteNow = canPromote(strategy);
    const isPromoting = promotingId === strategy.id;

    return (
      <div
        className={cn(
          'p-3 rounded-lg border transition-all',
          stage === 'paper'
            ? 'bg-purple-500/10 border-purple-500/30'
            : stage === 'shadow'
            ? 'bg-blue-500/10 border-blue-500/30'
            : 'bg-green-500/10 border-green-500/30'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-sm truncate">{strategy.name}</span>
          {strategy.sharpe_ratio && (
            <Badge
              variant="outline"
              className={cn(
                'text-xs',
                strategy.sharpe_ratio >= 1.5
                  ? 'border-green-500 text-green-500'
                  : strategy.sharpe_ratio >= 1.0
                  ? 'border-yellow-500 text-yellow-500'
                  : 'border-red-500 text-red-500'
              )}
            >
              SR: {strategy.sharpe_ratio.toFixed(2)}
            </Badge>
          )}
        </div>

        {/* Shadow Progress */}
        {stage === 'shadow' && g && (
          <div className="space-y-2 mb-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Trade Progress</span>
              <span className="font-mono">
                {g.shadow_trade_count} / {g.required_trade_count}
              </span>
            </div>
            <Progress
              value={(g.shadow_trade_count / g.required_trade_count) * 100}
              className="h-2"
            />

            {/* Metrics */}
            <div className="grid grid-cols-2 gap-2 text-xs mt-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sharpe:</span>
                <span
                  className={cn(
                    'font-mono',
                    (g.shadow_sharpe || 0) >= g.required_sharpe
                      ? 'text-green-500'
                      : 'text-red-500'
                  )}
                >
                  {g.shadow_sharpe?.toFixed(2) || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Win Rate:</span>
                <span
                  className={cn(
                    'font-mono',
                    (g.shadow_win_rate || 0) >= g.required_win_rate
                      ? 'text-green-500'
                      : 'text-red-500'
                  )}
                >
                  {g.shadow_win_rate ? `${(g.shadow_win_rate * 100).toFixed(0)}%` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">P&L:</span>
                <span
                  className={cn(
                    'font-mono',
                    g.shadow_total_pnl >= 0 ? 'text-green-500' : 'text-red-500'
                  )}
                >
                  ${g.shadow_total_pnl?.toFixed(0) || '0'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Max DD:</span>
                <span className="font-mono text-red-500">
                  {g.shadow_max_drawdown
                    ? `${(g.shadow_max_drawdown * 100).toFixed(1)}%`
                    : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Paper Stage - Red Team Status */}
        {stage === 'paper' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <Shield className="h-3 w-3 text-purple-400" />
            <span>Under Red Team Review</span>
          </div>
        )}

        {/* Live Stage - Show performance */}
        {stage === 'live' && (
          <div className="flex items-center gap-2 text-xs text-green-400 mb-2">
            <Zap className="h-3 w-3" />
            <span>LIVE with Real Capital</span>
          </div>
        )}

        {/* Promote Button */}
        {stage !== 'live' && (
          <Button
            size="sm"
            variant="outline"
            className={cn(
              'w-full text-xs',
              canPromoteNow
                ? 'border-green-500/50 text-green-500 hover:bg-green-500/10'
                : 'border-gray-600 text-gray-500 cursor-not-allowed'
            )}
            disabled={!canPromoteNow || isPromoting}
            onClick={() =>
              promoteStrategy(strategy, stage === 'paper' ? 'shadow' : 'production')
            }
          >
            {isPromoting ? (
              <Activity className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <ArrowRight className="h-3 w-3 mr-1" />
            )}
            {stage === 'paper' ? 'PROMOTE TO SHADOW' : 'GRADUATE TO LIVE'}
          </Button>
        )}
      </div>
    );
  };

  // Loading state
  if (loading) {
    return (
      <Card className="h-full bg-black/90 border-blue-500/30">
        <CardContent className="flex items-center justify-center h-full">
          <Activity className="h-8 w-8 text-blue-500 animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  // Connection error
  if (!connected) {
    return (
      <Card className="h-full bg-black/90 border-red-500/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-red-500">
            <AlertTriangle className="h-4 w-4" />
            CONNECTION LOST
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>{error || 'Unable to connect'}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const totalStrategies =
    paperStrategies.length + shadowStrategies.length + liveStrategies.length;

  return (
    <Card className="h-full bg-black/90 border-blue-500/30 overflow-hidden">
      <CardHeader className="pb-2 border-b border-blue-500/20">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <div className="flex items-center gap-2 text-blue-400">
            <TrendingUp className="h-4 w-4" />
            GRADUATION PIPELINE
          </div>
          <Badge variant="outline" className="text-xs">
            {totalStrategies} Strategies
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0 h-[calc(100%-3rem)]">
        {error && (
          <Alert variant="destructive" className="m-2 py-2">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        {/* Three Column Layout */}
        <div className="grid grid-cols-3 gap-0 h-full divide-x divide-gray-800">
          {/* Paper / Lab */}
          <div className="flex flex-col">
            <div className="p-2 border-b border-gray-800 bg-purple-500/5">
              <div className="flex items-center gap-2 text-purple-400">
                <Beaker className="h-4 w-4" />
                <span className="text-xs font-medium">THE LAB</span>
                <Badge variant="outline" className="ml-auto text-xs">
                  {paperStrategies.length}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Red Team Attack Phase
              </p>
            </div>
            <ScrollArea className="flex-1 p-2">
              <div className="space-y-2">
                {paperStrategies.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-4">
                    No strategies in lab
                  </div>
                ) : (
                  paperStrategies.map((s) => (
                    <StrategyCard key={s.id} strategy={s} stage="paper" />
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Shadow / Proving Ground */}
          <div className="flex flex-col">
            <div className="p-2 border-b border-gray-800 bg-blue-500/5">
              <div className="flex items-center gap-2 text-blue-400">
                <Ghost className="h-4 w-4" />
                <span className="text-xs font-medium">PROVING GROUND</span>
                <Badge variant="outline" className="ml-auto text-xs">
                  {shadowStrategies.length}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Paper Trading (50+ trades)
              </p>
            </div>
            <ScrollArea className="flex-1 p-2">
              <div className="space-y-2">
                {shadowStrategies.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-4">
                    No strategies in shadow
                  </div>
                ) : (
                  shadowStrategies.map((s) => (
                    <StrategyCard key={s.id} strategy={s} stage="shadow" />
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Live / Arena */}
          <div className="flex flex-col">
            <div className="p-2 border-b border-gray-800 bg-green-500/5">
              <div className="flex items-center gap-2 text-green-400">
                <Swords className="h-4 w-4" />
                <span className="text-xs font-medium">THE ARENA</span>
                <Badge variant="outline" className="ml-auto text-xs">
                  {liveStrategies.length}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Live with Real Capital
              </p>
            </div>
            <ScrollArea className="flex-1 p-2">
              <div className="space-y-2">
                {liveStrategies.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-4">
                    No live strategies yet
                  </div>
                ) : (
                  liveStrategies.map((s) => (
                    <StrategyCard key={s.id} strategy={s} stage="live" />
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export const GraduationTracker = memo(GraduationTrackerComponent);
