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
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ArrowLeft, Moon, Activity, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

import { RegimeDisplay, type RegimeState, type ConvexityBias } from '@/components/dashboard/RegimeDisplay';
import { SymphonyOrchestra, type StrategySlot } from '@/components/dashboard/SymphonyOrchestra';
import { BriefingDeck, type BriefingCard } from '@/components/dashboard/BriefingDeck';

// New dashboard components
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { ShadowPositionMonitor } from '@/components/dashboard/ShadowPositionMonitor';
import { MorningBriefingViewer } from '@/components/dashboard/MorningBriefingViewer';
import { DataInventory } from '@/components/dashboard/DataInventory';
import { StrategyGenomeBrowser } from '@/components/dashboard/StrategyGenomeBrowser';
import { BacktestRunner } from '@/components/dashboard/BacktestRunner';
import { TokenSpendTracker } from '@/components/dashboard/TokenSpendTracker';
import { MemoryBrowser } from '@/components/dashboard/MemoryBrowser';

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

      // Simulate regime state from latest market data
      // In production, this would come from a real-time market data feed
      setRegimeState({
        regime: determineCurrentRegime(strategies),
        vix: 18.5 + Math.random() * 5,
        vix9d: 17.2 + Math.random() * 4,
        termStructure: 'contango',
        realizedVol: 14.3 + Math.random() * 3,
        putCallSkew: 0.05 + Math.random() * 0.1,
        confidence: 0.85 + Math.random() * 0.1,
        timestamp: new Date().toISOString(),
      });

      // Simulate convexity bias based on active strategies
      const activeStrategies = strategies.filter((s) => s.status === 'active');
      setConvexityBias({
        delta: activeStrategies.length > 2 ? 'short' : 'neutral',
        gamma: activeStrategies.length > 0 ? 'long' : 'neutral',
        vega: 'long',
        theta: 'negative',
      });

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
  const navigate = useNavigate();
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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/')}
              title="Back to Chat"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                Conductor's Dashboard
              </h1>
              <p className="text-sm text-muted-foreground">
                Autonomous Research OS Status
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Daemon Status */}
            <div className="flex items-center gap-2 border-l pl-4">
              <div
                className={cn(
                  'w-2 h-2 rounded-full',
                  daemonStatus.isRunning
                    ? 'bg-green-500 animate-pulse'
                    : 'bg-gray-500'
                )}
              />
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Moon className="w-4 h-4" />
                Night Shift
              </span>
              <Badge variant="outline" className="text-xs">
                <Database className="w-3 h-3 mr-1" />
                {daemonStatus.poolSize} strategies
              </Badge>
              {daemonStatus.pendingBacktests > 0 && (
                <Badge variant="secondary" className="text-xs">
                  <Activity className="w-3 h-3 mr-1 animate-pulse" />
                  {daemonStatus.pendingBacktests} pending
                </Badge>
              )}
            </div>

            {/* Refresh Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={cn('w-4 h-4 mr-2', isRefreshing && 'animate-spin')}
              />
              Refresh
            </Button>
          </div>
        </div>
      </header>

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
              <TabsTrigger value="strategies">Strategies</TabsTrigger>
              <TabsTrigger value="trading">Trading</TabsTrigger>
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

            {/* Strategies Tab */}
            <TabsContent value="strategies" className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Strategy Browser */}
                <div className="lg:col-span-2 h-[600px]">
                  <StrategyGenomeBrowser />
                </div>

                {/* Backtest Runner */}
                <div className="h-[600px]">
                  <BacktestRunner />
                </div>
              </div>

              {/* Briefing Deck */}
              <div className="h-[400px]">
                <BriefingDeck
                  briefings={briefings}
                  onBriefingClick={handleBriefingClick}
                  onPromote={handlePromote}
                />
              </div>
            </TabsContent>

            {/* Trading Tab */}
            <TabsContent value="trading" className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Shadow Position Monitor */}
                <div className="h-[500px]">
                  <ShadowPositionMonitor />
                </div>

                {/* Activity Feed */}
                <div className="h-[500px]">
                  <ActivityFeed />
                </div>
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
