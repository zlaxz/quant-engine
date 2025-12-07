/**
 * Trading Terminal - Gamified Observatory Experience
 *
 * A mindblowing interactive trading experience featuring:
 * - Real-time pipeline visualization with diverge/merge flows
 * - Live swarm agent monitoring with particle effects
 * - P&L calendar heatmap
 * - Force vectors and regime detection
 * - Full JARVIS event integration
 *
 * Designed to impress traders and make complex systems intuitive.
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  LayoutDashboard,
  Activity,
  Calendar,
  GitBranch,
  Zap,
  TrendingUp,
  Settings,
  Maximize2,
  Minimize2,
  RefreshCw,
  Wifi,
  WifiOff,
  Play,
  Pause,
  Target,
  Award,
  Flame,
  Trophy,
  Sparkles,
  Brain,
  Cpu,
  Users,
  Search,
  Calculator,
  Scale
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';

// Import our new trading components
import { PipelineVisualization, PipelineStage } from '@/components/trading/PipelineVisualization';
import { SwarmActivityMonitor, SwarmState, SwarmAgent } from '@/components/trading/SwarmActivityMonitor';
import { PnLHeatmap, DailyPnL } from '@/components/trading/PnLHeatmap';
import { InteractiveFlowDiagram, FlowNode, FlowEdge } from '@/components/trading/InteractiveFlowDiagram';
import { KeyboardShortcuts } from '@/components/trading/KeyboardShortcuts';
import { LiveTradingPanel } from '@/components/trading/LiveTradingPanel';

// ============================================================================
// Types
// ============================================================================

interface TradingStats {
  accountValue: number;
  dayPnL: number;
  weekPnL: number;
  monthPnL: number;
  winRate: number;
  sharpe: number;
  streak: number;
  level: number;
  xp: number;
  xpToNext: number;
  achievements: Achievement[];
}

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  unlocked: boolean;
  progress?: number;
}

interface ForceVector {
  name: string;
  symbol: string;
  value: number;
  direction: 'bullish' | 'bearish' | 'neutral';
  color: string;
}

// ============================================================================
// Demo Data Generation
// ============================================================================

function generateDemoStats(): TradingStats {
  return {
    accountValue: 125430.50,
    dayPnL: 1842.30,
    weekPnL: 4567.80,
    monthPnL: 12340.25,
    winRate: 68.5,
    sharpe: 2.34,
    streak: 5,
    level: 12,
    xp: 7850,
    xpToNext: 10000,
    achievements: [
      { id: '1', name: 'First Trade', description: 'Execute your first trade', icon: <Target className="h-4 w-4" />, unlocked: true },
      { id: '2', name: 'Win Streak 5', description: '5 winning trades in a row', icon: <Flame className="h-4 w-4" />, unlocked: true },
      { id: '3', name: 'Sharpe Master', description: 'Maintain Sharpe > 2.0', icon: <Award className="h-4 w-4" />, unlocked: true },
      { id: '4', name: 'Century Club', description: '100 total trades', icon: <Trophy className="h-4 w-4" />, unlocked: false, progress: 78 },
    ]
  };
}

function generateForceVectors(): ForceVector[] {
  return [
    { name: 'Gamma', symbol: 'γ', value: 0.73, direction: 'bullish', color: 'bg-blue-500' },
    { name: 'Order Flow', symbol: 'Φ', value: 0.42, direction: 'bullish', color: 'bg-green-500' },
    { name: 'MM Inventory', symbol: 'Δ', value: -0.28, direction: 'bearish', color: 'bg-orange-500' },
    { name: 'Correlation', symbol: 'ρ', value: 0.15, direction: 'neutral', color: 'bg-purple-500' },
    { name: 'Entropy', symbol: 'S', value: 0.55, direction: 'bullish', color: 'bg-cyan-500' },
    { name: 'Volatility', symbol: 'σ', value: -0.12, direction: 'neutral', color: 'bg-pink-500' },
  ];
}

// ============================================================================
// Sub-Components
// ============================================================================

function GamifiedHeader({ stats }: { stats: TradingStats }) {
  const xpPercent = (stats.xp / stats.xpToNext) * 100;

  return (
    <div className="flex items-center gap-6">
      {/* Level Badge */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-bold text-lg">
            {stats.level}
          </div>
          <Sparkles className="absolute -top-1 -right-1 w-4 h-4 text-amber-400" />
        </div>
        <div className="text-xs">
          <div className="font-medium">Level {stats.level}</div>
          <div className="text-muted-foreground">{stats.xp.toLocaleString()} XP</div>
        </div>
      </div>

      {/* XP Bar */}
      <div className="w-32">
        <Progress value={xpPercent} className="h-2" />
        <div className="text-[10px] text-muted-foreground mt-0.5 text-center">
          {stats.xpToNext - stats.xp} XP to Level {stats.level + 1}
        </div>
      </div>

      {/* Streak */}
      {stats.streak > 0 && (
        <Badge className="bg-gradient-to-r from-orange-500 to-red-500 text-white gap-1">
          <Flame className="w-3 h-3" />
          {stats.streak} Win Streak!
        </Badge>
      )}
    </div>
  );
}

function AccountStrip({ stats }: { stats: TradingStats }) {
  return (
    <div className="flex items-center gap-8 text-sm">
      <div>
        <span className="text-muted-foreground">Account: </span>
        <span className="font-mono font-semibold text-lg">
          ${stats.accountValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      </div>
      <div>
        <span className="text-muted-foreground">Today: </span>
        <span className={cn(
          "font-mono font-semibold",
          stats.dayPnL >= 0 ? "text-green-500" : "text-red-500"
        )}>
          {stats.dayPnL >= 0 ? '+' : ''}{stats.dayPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      </div>
      <div>
        <span className="text-muted-foreground">Week: </span>
        <span className={cn(
          "font-mono font-semibold",
          stats.weekPnL >= 0 ? "text-green-500" : "text-red-500"
        )}>
          {stats.weekPnL >= 0 ? '+' : ''}{stats.weekPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      </div>
      <div>
        <span className="text-muted-foreground">Win Rate: </span>
        <span className="font-mono font-semibold text-green-500">
          {stats.winRate}%
        </span>
      </div>
      <div>
        <span className="text-muted-foreground">Sharpe: </span>
        <span className="font-mono font-semibold text-blue-500">
          {stats.sharpe.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function ForceVectorPanel({ forces }: { forces: ForceVector[] }) {
  const netForce = forces.reduce((sum, f) => sum + f.value, 0);
  const netDirection = netForce > 0.1 ? 'bullish' : netForce < -0.1 ? 'bearish' : 'neutral';

  return (
    <Card className="bg-card/50 backdrop-blur h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-1 pt-2 px-3 flex-shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          Force Vectors
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto px-3 pb-2 space-y-1">
        {forces.slice(0, 4).map((force) => (
          <div key={force.name} className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-muted-foreground w-4">{force.symbol}</span>
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full", force.color)}
                style={{ width: `${Math.abs(force.value) * 100}%` }}
              />
            </div>
            <span className={cn(
              "font-mono text-[10px] w-8 text-right",
              force.direction === 'bullish' ? "text-green-500" :
              force.direction === 'bearish' ? "text-red-500" : "text-muted-foreground"
            )}>
              {force.value > 0 ? '+' : ''}{force.value.toFixed(2)}
            </span>
          </div>
        ))}
        {/* Net Force */}
        <div className="pt-1 border-t flex items-center justify-between">
          <span className="text-[10px] font-medium">NET</span>
          <span className={cn(
            "font-mono font-bold text-sm",
            netDirection === 'bullish' ? "text-green-500" :
            netDirection === 'bearish' ? "text-red-500" : "text-muted-foreground"
          )}>
            {netForce > 0 ? '+' : ''}{netForce.toFixed(2)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function RegimeIndicator() {
  const [regime, setRegime] = useState('TRENDING_UP');
  const [confidence, setConfidence] = useState(0.78);

  const regimeConfig: Record<string, { color: string; label: string; short: string }> = {
    TRENDING_UP: { color: 'bg-green-500', label: 'Trending Up', short: '↑' },
    TRENDING_DOWN: { color: 'bg-red-500', label: 'Trending Down', short: '↓' },
    MEAN_REVERSION: { color: 'bg-blue-500', label: 'Mean Reversion', short: '↔' },
    HIGH_VOL: { color: 'bg-orange-500', label: 'High Vol', short: '⚡' },
    LOW_VOL: { color: 'bg-purple-500', label: 'Low Vol', short: '—' },
    CRISIS: { color: 'bg-red-600', label: 'Crisis', short: '!' },
  };

  const current = regimeConfig[regime] || regimeConfig['TRENDING_UP'];

  return (
    <Card className="bg-card/50 backdrop-blur h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-1 pt-2 px-3 flex-shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          Market Regime
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 px-3 pb-2 flex flex-col justify-center">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0",
            current.color
          )}>
            <span className="text-white font-bold text-lg">
              {Math.round(confidence * 100)}%
            </span>
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold truncate">{current.label}</div>
            <div className="text-[10px] text-muted-foreground">Confidence</div>
          </div>
        </div>
        {/* Mini regime selector */}
        <div className="mt-2 flex gap-0.5">
          {Object.entries(regimeConfig).map(([key, config]) => (
            <div
              key={key}
              className={cn(
                "flex-1 h-1.5 rounded-full transition-all cursor-pointer",
                key === regime ? config.color : "bg-muted hover:bg-muted-foreground/30"
              )}
              onClick={() => setRegime(key)}
              title={config.label}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function LiveEventsPanel() {
  const { events, isConnected, lastEventTime } = useJarvisEvents();

  return (
    <Card className="bg-card/50 backdrop-blur h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Live Events
          </CardTitle>
          <Badge variant={isConnected ? "default" : "destructive"} className="text-xs">
            {isConnected ? (
              <>
                <Wifi className="w-3 h-3 mr-1" />
                Live
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 mr-1" />
                Offline
              </>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden min-h-0">
        <ScrollArea className="h-full">
          <div className="space-y-2 font-mono text-xs">
            {events.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>Waiting for events...</p>
                <p className="text-[10px] mt-1">Run Python scripts to see activity</p>
              </div>
            ) : (
              events.slice(0, 50).map((event, i) => (
                <div
                  key={event.id || i}
                  className={cn(
                    "p-2 rounded-lg border-l-2 transition-all",
                    event.activity_type === 'discovery' && "border-l-blue-500 bg-blue-500/5",
                    event.activity_type === 'backtest' && "border-l-green-500 bg-green-500/5",
                    event.activity_type === 'error' && "border-l-red-500 bg-red-500/5",
                    !['discovery', 'backtest', 'error'].includes(event.activity_type || '') && "border-l-muted-foreground bg-muted/30"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-muted-foreground">
                      [{new Date(event.timestamp || Date.now()).toLocaleTimeString()}]
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {event.activity_type}
                    </Badge>
                  </div>
                  <div className="text-sm">{event.message}</div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function AchievementsPanel({ achievements }: { achievements: Achievement[] }) {
  return (
    <Card className="bg-card/50 backdrop-blur">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-500" />
          Achievements
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {achievements.map((achievement) => (
            <div
              key={achievement.id}
              className={cn(
                "p-2 rounded-lg border transition-all",
                achievement.unlocked
                  ? "border-amber-500/50 bg-amber-500/10"
                  : "border-muted bg-muted/30 opacity-60"
              )}
            >
              <div className="flex items-center gap-2">
                <div className={cn(
                  "p-1.5 rounded-full",
                  achievement.unlocked ? "bg-amber-500/20 text-amber-500" : "bg-muted text-muted-foreground"
                )}>
                  {achievement.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{achievement.name}</div>
                  {achievement.progress !== undefined && !achievement.unlocked && (
                    <Progress value={achievement.progress} className="h-1 mt-1" />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function TradingTerminal() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [stats] = useState(generateDemoStats);
  const [forces] = useState(generateForceVectors);

  // JARVIS event integration
  const {
    events,
    pipelineStages,
    swarmState,
    pnlData,
    isConnected
  } = useJarvisEvents();

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey)) {
        switch (e.key) {
          case '1':
            e.preventDefault();
            setActiveTab('overview');
            break;
          case '2':
            e.preventDefault();
            setActiveTab('trade');
            break;
          case '3':
            e.preventDefault();
            setActiveTab('pipeline');
            break;
          case '4':
            e.preventDefault();
            setActiveTab('swarm');
            break;
          case '5':
            e.preventDefault();
            setActiveTab('pnl');
            break;
          case 'f':
            e.preventDefault();
            setIsFullscreen(!isFullscreen);
            break;
          case 'k':
            e.preventDefault();
            setShowShortcuts(true);
            break;
        }
      }
      // Show shortcuts on ? key
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShowShortcuts(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, setShowShortcuts]);

  return (
    <div className={cn(
      "h-screen bg-background flex flex-col overflow-hidden",
      isFullscreen && "fixed inset-0 z-50"
    )}>
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur px-4 py-3 flex items-center gap-4 flex-shrink-0">
        {/* Back Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/')}
          title="Back to Chat"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>

        {/* Title */}
        <div className="flex items-center gap-2">
          <Cpu className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">
            Trading Terminal
          </h1>
        </div>

        {/* Gamified Header */}
        <div className="flex-1 flex justify-center">
          <GamifiedHeader stats={stats} />
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <Badge variant={isConnected ? "default" : "destructive"} className="gap-1">
            {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {isConnected ? 'Live' : 'Offline'}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsFullscreen(!isFullscreen)}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 min-h-0 overflow-hidden p-4 flex flex-col">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="grid w-full max-w-3xl mx-auto grid-cols-5 mb-4 flex-shrink-0">
            <TabsTrigger value="overview" className="gap-2">
              <LayoutDashboard className="w-4 h-4" />
              <span className="hidden sm:inline">Overview</span>
              <kbd className="hidden lg:inline text-[10px] opacity-50">⌘1</kbd>
            </TabsTrigger>
            <TabsTrigger value="trade" className="gap-2">
              <Zap className="w-4 h-4" />
              <span className="hidden sm:inline">Trade</span>
              <kbd className="hidden lg:inline text-[10px] opacity-50">⌘2</kbd>
            </TabsTrigger>
            <TabsTrigger value="pipeline" className="gap-2">
              <GitBranch className="w-4 h-4" />
              <span className="hidden sm:inline">Pipeline</span>
              <kbd className="hidden lg:inline text-[10px] opacity-50">⌘3</kbd>
            </TabsTrigger>
            <TabsTrigger value="swarm" className="gap-2">
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">Swarm</span>
              <kbd className="hidden lg:inline text-[10px] opacity-50">⌘4</kbd>
            </TabsTrigger>
            <TabsTrigger value="pnl" className="gap-2">
              <Calendar className="w-4 h-4" />
              <span className="hidden sm:inline">P&L</span>
              <kbd className="hidden lg:inline text-[10px] opacity-50">⌘5</kbd>
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="flex-1 min-h-0 mt-0">
            <div className="h-full flex gap-4">
              {/* Left Column - Flow + Forces */}
              <div className="flex-[2] flex flex-col gap-4 min-h-0">
                <InteractiveFlowDiagram className="flex-1 min-h-0" />
                <div className="grid grid-cols-2 gap-4 h-[180px] flex-shrink-0">
                  <ForceVectorPanel forces={forces} />
                  <RegimeIndicator />
                </div>
              </div>

              {/* Right Column - Events + Achievements */}
              <div className="flex-1 flex flex-col gap-4 min-h-0">
                <div className="flex-1 min-h-0">
                  <LiveEventsPanel />
                </div>
                <AchievementsPanel achievements={stats.achievements} />
              </div>
            </div>
          </TabsContent>

          {/* Trade Tab - Live IBKR Trading */}
          <TabsContent value="trade" className="flex-1 min-h-0 mt-0">
            <div className="h-full flex gap-4">
              {/* Main Trading Panel */}
              <div className="flex-[2] min-h-0 overflow-auto">
                <LiveTradingPanel />
              </div>

              {/* Side Panel - Events + Forces */}
              <div className="flex-1 flex flex-col gap-4 min-h-0">
                <div className="flex-1 min-h-0">
                  <LiveEventsPanel />
                </div>
                <div className="grid grid-cols-1 gap-4 flex-shrink-0">
                  <RegimeIndicator />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Pipeline Tab */}
          <TabsContent value="pipeline" className="flex-1 min-h-0 mt-0">
            <div className="h-full flex flex-col gap-4">
              <PipelineVisualization stages={pipelineStages} className="flex-shrink-0" />
              <div className="flex-1 min-h-0 flex gap-4">
                <div className="flex-[2] min-h-0">
                  <InteractiveFlowDiagram className="h-full" />
                </div>
                <div className="flex-1 min-h-0">
                  <LiveEventsPanel />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Swarm Tab */}
          <TabsContent value="swarm" className="flex-1 min-h-0 mt-0">
            <div className="h-full flex gap-4">
              <div className="flex-[2] min-h-0">
                <SwarmActivityMonitor swarms={swarmState} className="h-full" />
              </div>
              <div className="flex-1 flex flex-col gap-4 min-h-0">
                <Card className="bg-card/50 backdrop-blur">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Cpu className="h-5 w-5 text-primary" />
                      Agent Types
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { icon: Search, name: 'Scout', desc: 'Feature selection', color: 'text-blue-400' },
                        { icon: Calculator, name: 'Math', desc: 'Equation discovery', color: 'text-purple-400' },
                        { icon: Scale, name: 'Jury', desc: 'Regime classification', color: 'text-amber-400' },
                        { icon: Brain, name: 'Observer', desc: 'AI synthesis', color: 'text-cyan-400' },
                      ].map((agent) => (
                        <div key={agent.name} className="p-3 rounded-lg bg-muted/30 border">
                          <div className="flex items-center gap-2 mb-1">
                            <agent.icon className={cn("h-4 w-4", agent.color)} />
                            <span className="font-medium text-sm">{agent.name}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">{agent.desc}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                <LiveEventsPanel />
              </div>
            </div>
          </TabsContent>

          {/* P&L Tab */}
          <TabsContent value="pnl" className="flex-1 min-h-0 mt-0">
            <div className="h-full flex gap-4">
              <div className="flex-[2] min-h-0">
                <PnLHeatmap data={pnlData} className="h-full" />
              </div>
              <div className="flex-1 flex flex-col gap-4 min-h-0">
                <Card className="bg-card/50 backdrop-blur">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-green-500" />
                      Performance Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Total P&L</span>
                        <span className="font-mono font-bold text-green-500 text-xl">
                          +${stats.monthPnL.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Win Rate</span>
                        <span className="font-mono font-bold">{stats.winRate}%</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Sharpe Ratio</span>
                        <span className="font-mono font-bold text-blue-500">{stats.sharpe}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Best Day</span>
                        <span className="font-mono text-green-500">+$2,340</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Worst Day</span>
                        <span className="font-mono text-red-500">-$890</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <AchievementsPanel achievements={stats.achievements} />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer - Account Strip */}
      <footer className="border-t bg-card/50 backdrop-blur px-6 py-2 flex items-center justify-between flex-shrink-0">
        <AccountStrip stats={stats} />
        <div className="text-xs text-muted-foreground flex items-center gap-4">
          <span>Market Physics Engine v2.0</span>
          <span>{new Date().toLocaleTimeString()}</span>
        </div>
      </footer>

      {/* Keyboard Shortcuts Overlay */}
      <KeyboardShortcuts open={showShortcuts} onOpenChange={setShowShortcuts} />
    </div>
  );
}
