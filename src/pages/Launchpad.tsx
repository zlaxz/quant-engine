/**
 * Launchpad - Mission Control Home Screen
 *
 * The stunning entry point to the Market Physics Engine featuring:
 * - System status at a glance
 * - Navigation to all major sections
 * - Live JARVIS event stream
 * - Gamification (level, XP, achievements)
 * - Force vector summary
 * - Quick actions
 *
 * Designed to impress and provide instant situational awareness.
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Cpu,
  Activity,
  GitBranch,
  Users,
  Calendar,
  Settings,
  Zap,
  Brain,
  TrendingUp,
  Database,
  Search,
  Calculator,
  Scale,
  FileText,
  Play,
  Pause,
  RefreshCw,
  Wifi,
  WifiOff,
  ChevronRight,
  Sparkles,
  Flame,
  Trophy,
  Target,
  Award,
  Rocket,
  BarChart3,
  LineChart,
  MessageSquare,
  Terminal,
  Layers,
  Eye,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  Command
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';

// ============================================================================
// Types
// ============================================================================

interface SystemModule {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  route: string;
  status: 'online' | 'offline' | 'busy';
  gradient: string;
  stats?: { label: string; value: string }[];
}

interface QuickAction {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
  variant: 'default' | 'primary' | 'success' | 'warning';
}

// ============================================================================
// System Modules Configuration - Split by App
// ============================================================================

// TRADING APP - Execution, positions, real-time monitoring
const TRADING_MODULES: SystemModule[] = [
  {
    id: 'terminal',
    name: 'Trading Terminal',
    description: 'Positions, orders, real-time market data',
    icon: Activity,
    route: '/terminal',
    status: 'online',
    gradient: 'from-blue-500 to-cyan-500',
    stats: [
      { label: 'Positions', value: '3 open' },
      { label: 'P&L', value: '+$1,240' }
    ]
  },
  {
    id: 'strategies',
    name: 'Live Strategies',
    description: 'Active strategies and performance',
    icon: Layers,
    route: '/strategies',
    status: 'online',
    gradient: 'from-green-500 to-emerald-500',
    stats: [
      { label: 'Active', value: '2' },
      { label: 'Win Rate', value: '68%' }
    ]
  },
];

// DISCOVERY APP - Research, backtesting, experimentation
const DISCOVERY_MODULES: SystemModule[] = [
  {
    id: 'observatory',
    name: 'Observatory',
    description: 'Pipeline monitoring, results, journal',
    icon: Eye,
    route: '/observatory',
    status: 'online',
    gradient: 'from-cyan-500 to-teal-500',
    stats: [
      { label: 'Runs', value: '47' },
      { label: 'Starred', value: '12' }
    ]
  },
  {
    id: 'swarm',
    name: 'Swarm Monitor',
    description: 'DeepSeek agent orchestration',
    icon: Users,
    route: '/observatory?tab=orchestrated',
    status: 'online',
    gradient: 'from-amber-500 to-orange-500',
    stats: [
      { label: 'Last Run', value: '2h ago' },
      { label: 'Agents', value: '100' }
    ]
  },
  {
    id: 'dashboard',
    name: 'System Config',
    description: 'Settings, connections, health',
    icon: BarChart3,
    route: '/dashboard',
    status: 'online',
    gradient: 'from-slate-500 to-gray-600',
    stats: [
      { label: 'Status', value: 'Healthy' },
      { label: 'Uptime', value: '99.9%' }
    ]
  },
];

// Combined for backwards compatibility
const SYSTEM_MODULES: SystemModule[] = [...TRADING_MODULES, ...DISCOVERY_MODULES];

// ============================================================================
// Sub-Components
// ============================================================================

function SystemStatusBar({ isConnected }: { isConnected: boolean }) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center justify-between px-6 py-3 bg-card/50 backdrop-blur border-b">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Cpu className="h-6 w-6 text-primary" />
            <div className={cn(
              "absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full",
              isConnected ? "bg-green-500" : "bg-red-500"
            )} />
          </div>
          <div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">
              Market Physics Engine
            </h1>
            <p className="text-[10px] text-muted-foreground">JARVIS Observatory v2.0</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Badge className="bg-green-500/20 text-green-400 gap-1">
              <Wifi className="w-3 h-3" />
              Connected
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <WifiOff className="w-3 h-3" />
              Offline
            </Badge>
          )}
        </div>
        <div className="font-mono text-muted-foreground">
          {time.toLocaleTimeString()}
        </div>
        <kbd className="hidden md:flex items-center gap-1 px-2 py-1 text-xs font-mono text-muted-foreground bg-muted rounded border">
          <Command className="h-3 w-3" />K
        </kbd>
      </div>
    </div>
  );
}

function GamificationHeader() {
  const level = 12;
  const xp = 7850;
  const xpToNext = 10000;
  const streak = 5;
  const xpPercent = (xp / xpToNext) * 100;

  return (
    <div className="flex items-center justify-between px-6 py-4">
      <div className="flex items-center gap-6">
        {/* Level Badge */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-orange-500/30">
              {level}
            </div>
            <Sparkles className="absolute -top-1 -right-1 w-5 h-5 text-amber-400" />
          </div>
          <div>
            <div className="text-sm font-medium text-muted-foreground">Quant Level</div>
            <div className="text-2xl font-bold">{level}</div>
          </div>
        </div>

        {/* XP Progress */}
        <div className="w-48">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">Experience</span>
            <span className="font-mono">{xp.toLocaleString()} / {xpToNext.toLocaleString()}</span>
          </div>
          <Progress value={xpPercent} className="h-2" />
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {xpToNext - xp} XP to Level {level + 1}
          </div>
        </div>

        {/* Streak */}
        {streak > 0 && (
          <Badge className="bg-gradient-to-r from-orange-500 to-red-500 text-white gap-1 px-3 py-1.5 text-sm">
            <Flame className="w-4 h-4" />
            {streak} Day Streak!
          </Badge>
        )}
      </div>

      {/* Quick Stats */}
      <div className="flex items-center gap-6">
        <div className="text-center">
          <div className="text-2xl font-bold text-green-500">+$12.3k</div>
          <div className="text-xs text-muted-foreground">MTD P&L</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold">68.5%</div>
          <div className="text-xs text-muted-foreground">Win Rate</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-500">2.34</div>
          <div className="text-xs text-muted-foreground">Sharpe</div>
        </div>
      </div>
    </div>
  );
}

function ModuleCard({ module, onClick }: { module: SystemModule; onClick: () => void }) {
  return (
    <Card
      className={cn(
        "group relative overflow-hidden cursor-pointer transition-all duration-300",
        "hover:scale-[1.02] hover:shadow-xl hover:shadow-primary/10",
        "bg-card/50 backdrop-blur border-2",
        module.status === 'busy' && "border-amber-500/50",
        module.status === 'offline' && "border-red-500/50 opacity-60"
      )}
      onClick={onClick}
    >
      {/* Gradient overlay on hover */}
      <div className={cn(
        "absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-300",
        `bg-gradient-to-br ${module.gradient}`
      )} />

      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className={cn(
            "p-2.5 rounded-xl bg-gradient-to-br shadow-lg",
            module.gradient
          )}>
            <module.icon className="h-6 w-6 text-white" />
          </div>
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-2 h-2 rounded-full",
              module.status === 'online' && "bg-green-500",
              module.status === 'busy' && "bg-amber-500 animate-pulse",
              module.status === 'offline' && "bg-red-500"
            )} />
            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
          </div>
        </div>
        <CardTitle className="text-lg mt-3">{module.name}</CardTitle>
        <CardDescription className="text-xs">{module.description}</CardDescription>
      </CardHeader>

      <CardContent>
        {module.stats && (
          <div className="flex items-center gap-4">
            {module.stats.map((stat, i) => (
              <div key={i} className="flex-1">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  {stat.label}
                </div>
                <div className="text-sm font-semibold font-mono">{stat.value}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LiveActivityFeed() {
  const { events, isConnected } = useJarvisEvents();

  return (
    <Card className="bg-card/50 backdrop-blur h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Live Activity
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">
            {events.length} events
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-[280px] px-4">
          <div className="space-y-2 py-2">
            {events.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Waiting for events...</p>
                <p className="text-[10px] mt-1">Run Python scripts to see activity</p>
              </div>
            ) : (
              events.slice(0, 20).map((event, i) => (
                <div
                  key={event.id || i}
                  className={cn(
                    "p-2 rounded-lg border-l-2 text-xs",
                    event.activity_type === 'discovery' && "border-l-blue-500 bg-blue-500/5",
                    event.activity_type === 'backtest' && "border-l-green-500 bg-green-500/5",
                    event.activity_type === 'swarm_work' && "border-l-amber-500 bg-amber-500/5",
                    event.activity_type === 'error' && "border-l-red-500 bg-red-500/5",
                    !['discovery', 'backtest', 'swarm_work', 'error'].includes(event.activity_type || '') && "border-l-muted-foreground bg-muted/30"
                  )}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      {event.activity_type}
                    </Badge>
                    <span className="text-[9px] text-muted-foreground font-mono">
                      {new Date(event.timestamp || Date.now()).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-xs truncate">{event.message}</div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function PipelineStatus() {
  const { pipelineStages } = useJarvisEvents();
  const completedCount = pipelineStages.filter(s => s.status === 'complete').length;
  const totalCount = pipelineStages.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <Card className="bg-card/50 backdrop-blur">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" />
            Pipeline Status
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">
            {completedCount}/{totalCount}
          </Badge>
        </div>
        <Progress value={progress} className="h-1.5 mt-2" />
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-1">
          {pipelineStages.map((stage, i) => (
            <div
              key={stage.id}
              className={cn(
                "flex-1 h-8 rounded flex items-center justify-center text-[9px] font-medium transition-all",
                stage.status === 'complete' && "bg-green-500/20 text-green-400",
                stage.status === 'running' && "bg-blue-500/20 text-blue-400 animate-pulse",
                stage.status === 'idle' && "bg-muted/50 text-muted-foreground",
                stage.status === 'error' && "bg-red-500/20 text-red-400"
              )}
              title={stage.name}
            >
              {stage.name.split(' ')[0]}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SwarmStatus() {
  const { swarmState } = useJarvisEvents();
  const totalAgents = swarmState.reduce((sum, s) => sum + s.totalCount, 0);
  const completedAgents = swarmState.reduce((sum, s) => sum + s.completedCount, 0);
  const runningSwarms = swarmState.filter(s => s.status === 'running').length;

  return (
    <Card className="bg-card/50 backdrop-blur">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Swarm Status
          </CardTitle>
          <Badge className={cn(
            "text-[10px]",
            runningSwarms > 0 ? "bg-amber-500/20 text-amber-400" : "bg-green-500/20 text-green-400"
          )}>
            {runningSwarms > 0 ? `${runningSwarms} Active` : 'Idle'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-lg bg-muted/30">
            <div className="text-lg font-bold font-mono">{totalAgents}</div>
            <div className="text-[10px] text-muted-foreground">Total</div>
          </div>
          <div className="p-2 rounded-lg bg-muted/30">
            <div className="text-lg font-bold font-mono text-green-500">{completedAgents}</div>
            <div className="text-[10px] text-muted-foreground">Complete</div>
          </div>
          <div className="p-2 rounded-lg bg-muted/30">
            <div className="text-lg font-bold font-mono text-blue-500">
              {totalAgents > 0 ? Math.round((completedAgents / totalAgents) * 100) : 0}%
            </div>
            <div className="text-[10px] text-muted-foreground">Progress</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QuickActions({ navigate }: { navigate: (path: string) => void }) {
  const actions: QuickAction[] = [
    {
      id: 'run-pipeline',
      label: 'Run Full Pipeline',
      icon: Play,
      action: () => navigate('/terminal?tab=pipeline'),
      variant: 'primary'
    },
    {
      id: 'launch-swarm',
      label: 'Launch Swarm',
      icon: Rocket,
      action: () => navigate('/terminal?tab=swarm'),
      variant: 'warning'
    },
    {
      id: 'view-pnl',
      label: 'View P&L',
      icon: TrendingUp,
      action: () => navigate('/terminal?tab=pnl'),
      variant: 'success'
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      action: () => navigate('/settings'),
      variant: 'default'
    }
  ];

  const variantClasses = {
    default: 'bg-muted hover:bg-muted/80',
    primary: 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-400',
    success: 'bg-green-500/20 hover:bg-green-500/30 text-green-400',
    warning: 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-400'
  };

  return (
    <Card className="bg-card/50 backdrop-blur">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          Quick Actions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {actions.map(action => (
            <Button
              key={action.id}
              variant="ghost"
              className={cn(
                "h-auto py-3 flex flex-col items-center gap-1.5 transition-all",
                variantClasses[action.variant]
              )}
              onClick={action.action}
            >
              <action.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{action.label}</span>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AchievementShowcase() {
  const achievements = [
    { id: '1', name: 'First Trade', icon: Target, unlocked: true },
    { id: '2', name: '5 Win Streak', icon: Flame, unlocked: true },
    { id: '3', name: 'Sharpe Master', icon: Award, unlocked: true },
    { id: '4', name: 'Century Club', icon: Trophy, unlocked: false, progress: 78 },
  ];

  return (
    <Card className="bg-card/50 backdrop-blur">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          Achievements
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          {achievements.map(achievement => (
            <div
              key={achievement.id}
              className={cn(
                "relative p-2 rounded-lg border transition-all",
                achievement.unlocked
                  ? "border-amber-500/50 bg-amber-500/10"
                  : "border-muted bg-muted/30 opacity-50"
              )}
              title={achievement.name}
            >
              <achievement.icon className={cn(
                "h-5 w-5",
                achievement.unlocked ? "text-amber-500" : "text-muted-foreground"
              )} />
              {!achievement.unlocked && achievement.progress && (
                <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500"
                    style={{ width: `${achievement.progress}%` }}
                  />
                </div>
              )}
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

export default function Launchpad() {
  const navigate = useNavigate();
  const { isConnected } = useJarvisEvents();

  // Keyboard shortcut for Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        // Could open a command palette here
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* System Status Bar */}
      <SystemStatusBar isConnected={isConnected} />

      {/* Gamification Header */}
      <GamificationHeader />

      {/* Main Content */}
      <main className="flex-1 px-6 pb-6 overflow-auto">
        <div className="grid grid-cols-12 gap-4">
          {/* Module Cards - 2x3 Grid */}
          <div className="col-span-8 space-y-6">
            {/* TRADING APP */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Trading
                </h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {TRADING_MODULES.map(module => (
                  <ModuleCard
                    key={module.id}
                    module={module}
                    onClick={() => navigate(module.route)}
                  />
                ))}
              </div>
            </div>

            {/* DISCOVERY APP */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-cyan-500" />
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Discovery & Research
                </h2>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {DISCOVERY_MODULES.map(module => (
                  <ModuleCard
                    key={module.id}
                    module={module}
                    onClick={() => navigate(module.route)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="col-span-4 space-y-4">
            <LiveActivityFeed />
            <QuickActions navigate={navigate} />
            <AchievementShowcase />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t bg-card/50 backdrop-blur px-6 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>Market Physics Engine v2.0</span>
          <span>•</span>
          <span>JARVIS Observatory</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Press</span>
          <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">?</kbd>
          <span>for shortcuts</span>
        </div>
      </footer>
    </div>
  );
}
