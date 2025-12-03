/**
 * MissionControl.tsx - The Autopilot Interface
 *
 * Goal-seeking dashboard where you set financial targets and the daemon hunts.
 * NO MOCK DATA - Real Supabase connection.
 *
 * Created: 2025-12-03
 */

import React, { useState, useEffect, useCallback, memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Target,
  Rocket,
  Pause,
  Play,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase, isSupabaseConfigured } from '@/integrations/supabase/client';

// Types matching the missions table schema
interface Mission {
  id: string;
  name: string;
  objective: string;
  target_metric: string;
  target_value: number;
  target_operator: string;
  max_drawdown: number;
  min_win_rate: number;
  min_trades: number;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  priority: number;
  current_best_value: number;
  current_best_strategy_id: string | null;
  attempts: number;
  strategies_evaluated: number;
  strategies_passed: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface MissionConfig {
  name: string;
  targetDailyReturn: number;
  maxDrawdown: number;
  minWinRate: number;
  minTrades: number;
}

function MissionControlComponent() {
  // Connection state
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Active mission state
  const [activeMission, setActiveMission] = useState<Mission | null>(null);
  const [loading, setLoading] = useState(true);

  // New mission config
  const [config, setConfig] = useState<MissionConfig>({
    name: '',
    targetDailyReturn: 2.0,
    maxDrawdown: 15,
    minWinRate: 50,
    minTrades: 50,
  });
  const [launching, setLaunching] = useState(false);

  // Check connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      if (!isSupabaseConfigured) {
        setConnected(false);
        setError('Supabase not configured - check environment variables');
        setLoading(false);
        return;
      }

      try {
        const { error: testError } = await supabase
          .from('missions')
          .select('id')
          .limit(1);

        if (testError) {
          // Table might not exist yet - that's OK
          if (testError.code === '42P01') {
            setConnected(true);
            setError('Missions table not found - run migrations first');
          } else {
            setConnected(false);
            setError(`Connection failed: ${testError.message}`);
          }
        } else {
          setConnected(true);
          setError(null);
        }
      } catch (err) {
        setConnected(false);
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
      setLoading(false);
    };

    checkConnection();
  }, []);

  // Fetch active mission
  const fetchActiveMission = useCallback(async () => {
    if (!connected) return;

    try {
      const { data, error: fetchError } = await supabase
        .from('missions')
        .select('*')
        .eq('status', 'active')
        .order('priority', { ascending: false })
        .limit(1)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        // PGRST116 = no rows returned, that's fine
        console.error('[MissionControl] Fetch error:', fetchError);
      }

      setActiveMission(data || null);
    } catch (err) {
      console.error('[MissionControl] Error fetching mission:', err);
    }
  }, [connected]);

  // Subscribe to mission updates
  useEffect(() => {
    if (!connected) return;

    fetchActiveMission();

    // Real-time subscription
    const channel = supabase
      .channel('mission-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'missions',
        },
        (payload) => {
          console.log('[MissionControl] Real-time update:', payload);
          fetchActiveMission();
        }
      )
      .subscribe();

    // Poll every 5 seconds as backup
    const interval = setInterval(fetchActiveMission, 5000);

    return () => {
      channel.unsubscribe();
      clearInterval(interval);
    };
  }, [connected, fetchActiveMission]);

  // Launch new mission
  const launchMission = useCallback(async () => {
    if (!connected || launching) return;

    setLaunching(true);
    setError(null);

    try {
      // Convert daily return % to Sharpe approximation
      // Rough formula: Sharpe ≈ (annual return) / volatility
      // Daily 2% ≈ ~500% annual, with 20% vol ≈ Sharpe of 25 (unrealistic, but for target)
      // More realistic: daily 0.5% target → Sharpe ~2
      const targetSharpe = config.targetDailyReturn / 0.25; // Rough conversion

      const missionData = {
        name: config.name || `Alpha Hunt ${new Date().toLocaleDateString()}`,
        objective: `Find strategy with ${config.targetDailyReturn}% daily return, max ${config.maxDrawdown}% drawdown`,
        target_metric: 'sharpe',
        target_value: targetSharpe,
        target_operator: 'gte',
        max_drawdown: -(config.maxDrawdown / 100), // Store as negative decimal
        min_win_rate: config.minWinRate / 100,
        min_trades: config.minTrades,
        status: 'active',
        priority: 10,
        current_best_value: 0,
        attempts: 0,
        strategies_evaluated: 0,
        strategies_passed: 0,
      };

      // Pause any existing active missions first
      await supabase
        .from('missions')
        .update({ status: 'paused' })
        .eq('status', 'active');

      // Insert new mission
      const { data, error: insertError } = await supabase
        .from('missions')
        .insert(missionData)
        .select()
        .single();

      if (insertError) throw insertError;

      console.log('[MissionControl] Mission launched:', data);
      setActiveMission(data);

      // Reset form
      setConfig({
        name: '',
        targetDailyReturn: 2.0,
        maxDrawdown: 15,
        minWinRate: 50,
        minTrades: 50,
      });
    } catch (err) {
      console.error('[MissionControl] Launch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to launch mission');
    } finally {
      setLaunching(false);
    }
  }, [connected, launching, config]);

  // Pause/Resume mission
  const toggleMission = useCallback(async () => {
    if (!activeMission) return;

    const newStatus = activeMission.status === 'active' ? 'paused' : 'active';

    try {
      const { error: updateError } = await supabase
        .from('missions')
        .update({ status: newStatus })
        .eq('id', activeMission.id);

      if (updateError) throw updateError;

      setActiveMission({ ...activeMission, status: newStatus });
    } catch (err) {
      console.error('[MissionControl] Toggle failed:', err);
    }
  }, [activeMission]);

  // Abandon mission
  const abandonMission = useCallback(async () => {
    if (!activeMission) return;

    try {
      const { error: updateError } = await supabase
        .from('missions')
        .update({ status: 'abandoned' })
        .eq('id', activeMission.id);

      if (updateError) throw updateError;

      setActiveMission(null);
    } catch (err) {
      console.error('[MissionControl] Abandon failed:', err);
    }
  }, [activeMission]);

  // Calculate progress
  const calculateProgress = useCallback(() => {
    if (!activeMission) return { progress: 0, gap: 0 };

    const current = activeMission.current_best_value || 0;
    const target = activeMission.target_value;

    if (target <= 0) return { progress: 0, gap: target };

    const progress = Math.min((current / target) * 100, 100);
    const gap = target - current;

    return { progress, gap };
  }, [activeMission]);

  const { progress, gap } = calculateProgress();

  // Loading state
  if (loading) {
    return (
      <Card className="h-full bg-black/90 border-green-500/30">
        <CardContent className="flex items-center justify-center h-full">
          <Activity className="h-8 w-8 text-green-500 animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  // Connection error state
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
            <AlertDescription>{error || 'Unable to connect to Supabase'}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-black/90 border-green-500/30 overflow-hidden">
      <CardHeader className="pb-2 border-b border-green-500/20">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <div className="flex items-center gap-2 text-green-400">
            <Target className="h-4 w-4" />
            MISSION CONTROL
          </div>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'w-2 h-2 rounded-full',
                activeMission?.status === 'active'
                  ? 'bg-green-500 animate-pulse'
                  : activeMission?.status === 'paused'
                  ? 'bg-yellow-500'
                  : 'bg-gray-500'
              )}
            />
            <span className="text-xs text-muted-foreground font-mono">
              {activeMission?.status?.toUpperCase() || 'IDLE'}
            </span>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Error Alert */}
        {error && (
          <Alert variant="destructive" className="py-2">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        {/* Active Mission Display */}
        {activeMission ? (
          <div className="space-y-4">
            {/* Mission Header */}
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-green-400">{activeMission.name}</h3>
                <Badge
                  variant="outline"
                  className={cn(
                    activeMission.status === 'active'
                      ? 'border-green-500 text-green-500'
                      : 'border-yellow-500 text-yellow-500'
                  )}
                >
                  {activeMission.status === 'active' ? 'HUNTING' : 'PAUSED'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{activeMission.objective}</p>
            </div>

            {/* Progress to Target */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progress to Target</span>
                <span className="font-mono text-green-400">{progress.toFixed(1)}%</span>
              </div>
              <Progress
                value={progress}
                className="h-3 bg-gray-800"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Current: {activeMission.current_best_value?.toFixed(2) || '0.00'}</span>
                <span>Target: {activeMission.target_value?.toFixed(2)}</span>
              </div>
            </div>

            {/* Gap Indicator */}
            <div
              className={cn(
                'p-3 rounded-lg text-center',
                gap > 0 ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-green-500/10 border border-green-500/30'
              )}
            >
              <div className="flex items-center justify-center gap-2">
                {gap > 0 ? (
                  <TrendingUp className="h-5 w-5 text-yellow-500" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                )}
                <span
                  className={cn(
                    'text-lg font-bold font-mono',
                    gap > 0 ? 'text-yellow-500' : 'text-green-500'
                  )}
                >
                  {gap > 0 ? `GAP: ${gap.toFixed(2)}` : 'TARGET ACHIEVED'}
                </span>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded bg-gray-800/50">
                <div className="text-lg font-bold font-mono text-blue-400">
                  {activeMission.attempts}
                </div>
                <div className="text-xs text-muted-foreground">Swarm Runs</div>
              </div>
              <div className="p-2 rounded bg-gray-800/50">
                <div className="text-lg font-bold font-mono text-purple-400">
                  {activeMission.strategies_evaluated}
                </div>
                <div className="text-xs text-muted-foreground">Evaluated</div>
              </div>
              <div className="p-2 rounded bg-gray-800/50">
                <div className="text-lg font-bold font-mono text-green-400">
                  {activeMission.strategies_passed}
                </div>
                <div className="text-xs text-muted-foreground">Passed</div>
              </div>
            </div>

            {/* Constraints Display */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between p-2 rounded bg-gray-800/30">
                <span className="text-muted-foreground">Max Drawdown:</span>
                <span className="text-red-400 font-mono">
                  {((activeMission.max_drawdown || 0) * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between p-2 rounded bg-gray-800/30">
                <span className="text-muted-foreground">Min Win Rate:</span>
                <span className="text-green-400 font-mono">
                  {((activeMission.min_win_rate || 0) * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            {/* Control Buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className={cn(
                  'flex-1',
                  activeMission.status === 'active'
                    ? 'border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/10'
                    : 'border-green-500/50 text-green-500 hover:bg-green-500/10'
                )}
                onClick={toggleMission}
              >
                {activeMission.status === 'active' ? (
                  <>
                    <Pause className="h-4 w-4 mr-2" />
                    PAUSE
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    RESUME
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                className="border-red-500/50 text-red-500 hover:bg-red-500/10"
                onClick={abandonMission}
              >
                ABANDON
              </Button>
            </div>
          </div>
        ) : (
          /* New Mission Form */
          <div className="space-y-4">
            <div className="text-center p-4 rounded-lg bg-gray-800/30 border border-dashed border-gray-600">
              <Zap className="h-8 w-8 mx-auto mb-2 text-green-500/50" />
              <p className="text-sm text-muted-foreground">No active mission</p>
              <p className="text-xs text-muted-foreground">Configure and launch below</p>
            </div>

            {/* Mission Name */}
            <div className="space-y-2">
              <Label className="text-green-400 text-xs">MISSION NAME</Label>
              <Input
                placeholder="Alpha Hunter v1"
                value={config.name}
                onChange={(e) => setConfig({ ...config, name: e.target.value })}
                className="bg-gray-800/50 border-gray-600"
              />
            </div>

            {/* Target Daily Return */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-green-400 text-xs">TARGET DAILY RETURN</Label>
                <span className="text-sm font-mono text-green-400">
                  {config.targetDailyReturn.toFixed(1)}%
                </span>
              </div>
              <Slider
                value={[config.targetDailyReturn]}
                onValueChange={([v]) => setConfig({ ...config, targetDailyReturn: v })}
                min={0.1}
                max={5.0}
                step={0.1}
                className="py-2"
              />
              <p className="text-xs text-muted-foreground">
                Higher targets = longer hunt time
              </p>
            </div>

            {/* Max Drawdown */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-red-400 text-xs">MAX DRAWDOWN</Label>
                <span className="text-sm font-mono text-red-400">
                  {config.maxDrawdown.toFixed(0)}%
                </span>
              </div>
              <Slider
                value={[config.maxDrawdown]}
                onValueChange={([v]) => setConfig({ ...config, maxDrawdown: v })}
                min={5}
                max={30}
                step={1}
                className="py-2"
              />
            </div>

            {/* Min Win Rate */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-blue-400 text-xs">MIN WIN RATE</Label>
                <span className="text-sm font-mono text-blue-400">
                  {config.minWinRate.toFixed(0)}%
                </span>
              </div>
              <Slider
                value={[config.minWinRate]}
                onValueChange={([v]) => setConfig({ ...config, minWinRate: v })}
                min={30}
                max={70}
                step={5}
                className="py-2"
              />
            </div>

            {/* Min Trades */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-purple-400 text-xs">MIN TRADES (Statistical Validity)</Label>
                <span className="text-sm font-mono text-purple-400">{config.minTrades}</span>
              </div>
              <Slider
                value={[config.minTrades]}
                onValueChange={([v]) => setConfig({ ...config, minTrades: v })}
                min={20}
                max={200}
                step={10}
                className="py-2"
              />
            </div>

            {/* Launch Button */}
            <Button
              className="w-full h-12 bg-green-600 hover:bg-green-700 text-black font-bold"
              onClick={launchMission}
              disabled={launching}
            >
              {launching ? (
                <>
                  <Activity className="h-5 w-5 mr-2 animate-spin" />
                  LAUNCHING...
                </>
              ) : (
                <>
                  <Rocket className="h-5 w-5 mr-2" />
                  LAUNCH MISSION
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const MissionControl = memo(MissionControlComponent);
