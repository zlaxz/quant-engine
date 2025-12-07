/**
 * Dashboard - The Conductor's Interface
 *
 * Main dashboard for the Autonomous Research OS showing:
 * - Current market regime (RegimeDisplay)
 * - Symphony strategy grid (SymphonyOrchestra)
 * - Morning briefings (BriefingDeck)
 *
 * Polls Supabase for real-time updates from the Night Shift daemon.
 */

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Moon, Activity, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { AppHeader } from '@/components/layout';

import { RegimeDisplay, type RegimeState, type ConvexityBias } from '@/components/dashboard/RegimeDisplay';
import { SymphonyOrchestra, type StrategySlot } from '@/components/dashboard/SymphonyOrchestra';
import { type BriefingCard } from '@/components/dashboard/BriefingDeck';

// Dashboard components
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { MorningBriefingViewer } from '@/components/dashboard/MorningBriefingViewer';
import { DataInventory } from '@/components/dashboard/DataInventory';
import { TokenSpendTracker } from '@/components/dashboard/TokenSpendTracker';
import { MemoryBrowser } from '@/components/dashboard/MemoryBrowser';

// Guardian Architecture components
import { MissionMonitor } from '@/components/dashboard/MissionMonitor';
import { GraduationTracker } from '@/components/dashboard/GraduationTracker';
import { SystemIntegrity } from '@/components/dashboard/SystemIntegrity';
import { SwarmHiveMonitor } from '@/components/swarm/SwarmHiveMonitor';

// Python API URL
const PYTHON_API_URL = 'http://localhost:5001';

// ============================================================================
// Types
// ============================================================================

interface DaemonStatus {
  isRunning: boolean;
  lastHeartbeat: string | null;
  poolSize: number;
  pendingBacktests: number;
}

// ============================================================================
// Data Fetching Hooks
// ============================================================================

function useDashboardData() {
  const [regimeState, setRegimeState] = useState<RegimeState | undefined>();
  const [convexityBias, setConvexityBias] = useState<ConvexityBias | undefined>();
  const [strategies, setStrategies] = useState<StrategySlot[]>([]);
  const [briefings, setBriefings] = useState<BriefingCard[]>([]);
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus>({
    isRunning: false,
    lastHeartbeat: null,
    poolSize: 0,
    pendingBacktests: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);

      // Fetch strategies from strategy_genome
      const { data: genomeData, error: genomeError } = await supabase
        .from('strategy_genome')
        .select('*')
        .order('fitness_score', { ascending: false })
        .limit(50);

      if (genomeError) {
        console.warn('Error fetching strategy_genome:', genomeError);
      } else if (genomeData) {
        const slots: StrategySlot[] = genomeData.map((row: Record<string, unknown>) => ({
          id: row.id as string,
          name: (row.name as string) || `Strategy ${(row.id as string).slice(0, 8)}`,
          targetRegime: ((row.target_regime as string) || 'UNKNOWN') as StrategySlot['targetRegime'],
          status: (row.status as StrategySlot['status']) || 'pending',
          fitness: (row.fitness_score as number) || 0,
          portfolioContribution: (row.portfolio_contribution as number) || 1.0,
          currentPnl: (row.current_pnl as number) || undefined,
          allocation: (row.allocation_pct as number) || undefined,
        }));
        setStrategies(slots);

        // Update daemon status from strategy counts
        const pendingCount = slots.filter((s) => s.status === 'pending').length;
        setDaemonStatus((prev) => ({
          ...prev,
          poolSize: slots.length,
          pendingBacktests: pendingCount,
        }));
      }

      // Fetch morning briefings
      const { data: briefingData, error: briefingError } = await supabase
        .from('morning_briefings')
        .select('*')
        .order('generated_at', { ascending: false })
        .limit(20);

      if (briefingError) {
        console.warn('Error fetching morning_briefings:', briefingError);
      } else if (briefingData) {
        const cards: BriefingCard[] = briefingData.map((row: Record<string, unknown>) => ({
          id: row.id as string,
          strategyId: row.strategy_id as string,
          strategyName: (row.strategy_name as string) || 'Unknown Strategy',
          targetRegime: ((row.target_regime as string) || 'UNKNOWN') as BriefingCard['targetRegime'],
          verdict: ((row.verdict as string) || 'PENDING') as BriefingCard['verdict'],
          narrative: (row.narrative as string) || '',
          metrics: (row.metrics as BriefingCard['metrics']) || {
            sharpe: 0,
            sortino: 0,
            maxDrawdown: 0,
            winRate: 0,
            convexity: 0,
            fitness: 0,
          },
          performanceSummary: (row.performance_summary as string) || '',
          riskWarnings: (row.risk_warnings as string[]) || [],
          generatedAt: (row.generated_at as string) || new Date().toISOString(),
          backtestPeriod: (row.backtest_period as BriefingCard['backtestPeriod']) || {
            start: '',
            end: '',
          },
        }));
        setBriefings(cards);
      }

      // Fetch regime state from Python API
      try {
        const regimeResponse = await fetch(`${PYTHON_API_URL}/regimes`);
        if (regimeResponse.ok) {
          const regimeData = await regimeResponse.json();
          if (regimeData.current_regime) {
            setRegimeState({
              regime: regimeData.current_regime.regime || determineCurrentRegime(strategies),
              vix: regimeData.current_regime.vix || 0,
              vix9d: regimeData.current_regime.vix9d || 0,
              termStructure: regimeData.current_regime.term_structure || 'unknown',
              realizedVol: regimeData.current_regime.realized_vol || 0,
              putCallSkew: regimeData.current_regime.put_call_skew || 0,
              confidence: regimeData.current_regime.confidence || 0,
              timestamp: regimeData.current_regime.timestamp || new Date().toISOString(),
            });

            if (regimeData.current_regime.convexity_bias) {
              setConvexityBias(regimeData.current_regime.convexity_bias);
            }
          }
        }
      } catch (regimeErr) {
        console.warn('Failed to fetch regime from Python API:', regimeErr);
        // Fall back to deriving regime from strategy distribution
        setRegimeState({
          regime: determineCurrentRegime(strategies),
          vix: 0,
          vix9d: 0,
          termStructure: 'flat' as const,
          realizedVol: 0,
          putCallSkew: 0,
          confidence: 0,
          timestamp: new Date().toISOString(),
        });
      }

      // Derive convexity bias from active strategies if not set from API
      if (!convexityBias) {
        const activeStrategies = strategies.filter((s) => s.status === 'active');
        setConvexityBias({
          delta: activeStrategies.length > 2 ? 'short' : 'neutral',
          gamma: activeStrategies.length > 0 ? 'long' : 'neutral',
          vega: 'long',
          theta: 'negative',
        });
      }

      setIsLoading(false);
    } catch (err) {
      console.error('Dashboard fetch error:', err);
      setError('Failed to fetch dashboard data');
      setIsLoading(false);
    }
  }, [strategies]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, []);

  // Poll every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return {
    regimeState,
    convexityBias,
    strategies,
    briefings,
    daemonStatus,
    isLoading,
    error,
    refresh: fetchData,
  };
}

// Helper to determine current regime from strategy distribution
function determineCurrentRegime(strategies: StrategySlot[]): RegimeState['regime'] {
  const activeStrategies = strategies.filter((s) => s.status === 'active');
  if (activeStrategies.length === 0) return 'LOW_VOL_GRIND';

  // Count by regime
  const regimeCounts: Record<string, number> = {};
  activeStrategies.forEach((s) => {
    regimeCounts[s.targetRegime] = (regimeCounts[s.targetRegime] || 0) + 1;
  });

  // Return most common regime
  const sorted = Object.entries(regimeCounts).sort((a, b) => b[1] - a[1]);
  return (sorted[0]?.[0] as RegimeState['regime']) || 'LOW_VOL_GRIND';
}

// ============================================================================
// Main Component
// ============================================================================

export default function Dashboard() {
  const {
    regimeState,
    convexityBias,
    strategies,
    briefings,
    daemonStatus,
    isLoading,
    error,
    refresh,
  } = useDashboardData();

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleStrategyClick = (strategy: StrategySlot) => {
    console.log('Strategy clicked:', strategy);
    // TODO: Open strategy detail modal or navigate to strategy page
  };

  const handleBriefingClick = (briefing: BriefingCard) => {
    console.log('Briefing clicked:', briefing);
    // TODO: Open briefing detail modal
  };

  const handlePromote = async (briefing: BriefingCard) => {
    console.log('Promoting strategy:', briefing.strategyId);
    try {
      await supabase.rpc('promote_strategy_simple', {
        p_strategy_id: briefing.strategyId,
      });
      refresh();
    } catch (err) {
      console.error('Failed to promote strategy:', err);
    }
  };

  // Custom header actions
  const headerActions = (
    <div className="flex items-center gap-3">
      {/* Daemon Status */}
      <div className="hidden md:flex items-center gap-2">
        <div
          className={cn(
            'w-2 h-2 rounded-full',
            daemonStatus.isRunning
              ? 'bg-green-500 animate-pulse'
              : 'bg-gray-500'
          )}
        />
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Moon className="w-3 h-3" />
          Night Shift
        </span>
        <Badge variant="outline" className="text-[10px]">
          <Database className="w-3 h-3 mr-1" />
          {daemonStatus.poolSize}
        </Badge>
        {daemonStatus.pendingBacktests > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            <Activity className="w-3 h-3 mr-1 animate-pulse" />
            {daemonStatus.pendingBacktests}
          </Badge>
        )}
      </div>

      {/* Refresh Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleRefresh}
        disabled={isRefreshing}
        className="h-7 px-2 text-xs"
      >
        <RefreshCw
          className={cn('w-3 h-3 mr-1', isRefreshing && 'animate-spin')}
        />
        Refresh
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        title="Dashboard"
        subtitle="Autonomous Research OS"
        actions={headerActions}
      />

      {/* Main Content */}
      <main className="p-6">
        {error && (
          <div className="mb-4 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-[60vh]">
            <div className="text-center space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
              <p className="text-muted-foreground">Loading dashboard...</p>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="guardian">Guardian</TabsTrigger>
              <TabsTrigger value="infrastructure">Infrastructure</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Left Column: Regime & Symphony */}
                <div className="lg:col-span-2 space-y-4">
                  {/* Regime Display */}
                  <RegimeDisplay
                    regimeState={regimeState}
                    convexityBias={convexityBias}
                  />

                  {/* Symphony Orchestra */}
                  <SymphonyOrchestra
                    strategies={strategies}
                    currentRegime={regimeState?.regime || 'UNKNOWN'}
                    onStrategyClick={handleStrategyClick}
                  />
                </div>

                {/* Right Column: Activity & Briefings */}
                <div className="space-y-4">
                  <div className="h-[300px]">
                    <ActivityFeed />
                  </div>
                  <div className="h-[350px]">
                    <MorningBriefingViewer />
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Guardian Tab - Goal-Seeking Architecture */}
            <TabsContent value="guardian" className="space-y-4">
              {/* Top Row: Mission Control & System Integrity */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Mission Control - The Input */}
                <div className="lg:col-span-2 h-[400px]">
                  <MissionMonitor />
                </div>

                {/* System Integrity - The Safety */}
                <div className="h-[400px]">
                  <SystemIntegrity />
                </div>
              </div>

              {/* Middle Row: Graduation Tracker */}
              <div className="h-[350px]">
                <GraduationTracker />
              </div>

              {/* Bottom Row: Swarm Hive Monitor */}
              <div className="h-[450px]">
                <SwarmHiveMonitor />
              </div>
            </TabsContent>

            {/* Infrastructure Tab */}
            <TabsContent value="infrastructure" className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Data Inventory */}
                <div className="h-[500px]">
                  <DataInventory />
                </div>

                {/* Token Spend Tracker */}
                <div className="h-[500px]">
                  <TokenSpendTracker />
                </div>

                {/* Memory Browser */}
                <div className="h-[500px]">
                  <MemoryBrowser />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}
