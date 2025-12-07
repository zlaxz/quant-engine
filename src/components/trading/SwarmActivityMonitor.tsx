/**
 * SwarmActivityMonitor - Real-time Swarm Agent Visualization
 *
 * Shows active DeepSeek agent swarms with:
 * - Animated agent nodes
 * - Real-time progress
 * - Agent type distribution
 * - Performance metrics
 */

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  Users,
  Zap,
  Brain,
  Search,
  Calculator,
  Scale,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  TrendingUp
} from 'lucide-react';

export interface SwarmAgent {
  id: string;
  type: 'scout' | 'math' | 'jury' | 'observer' | 'fixer' | 'analyst';
  status: 'idle' | 'working' | 'complete' | 'error';
  task?: string;
  progress?: number;
  result?: string;
}

export interface SwarmState {
  id: string;
  name: string;
  type: 'factor_discovery' | 'multi_asset' | 'structure_discovery' | 'audit_fix';
  status: 'running' | 'complete' | 'error';
  agents: SwarmAgent[];
  startTime: Date;
  completedCount: number;
  totalCount: number;
  successRate: number;
  avgDuration?: number;
}

interface SwarmActivityMonitorProps {
  swarms?: SwarmState[];
  onSwarmClick?: (swarmId: string) => void;
  className?: string;
}

// Generate demo swarm data
function generateDemoSwarms(): SwarmState[] {
  const agentTypes: SwarmAgent['type'][] = ['scout', 'math', 'jury', 'observer', 'fixer', 'analyst'];

  const createAgents = (count: number, type: SwarmAgent['type']): SwarmAgent[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `${type}-${i}`,
      type,
      status: i < count * 0.7 ? 'complete' : i < count * 0.9 ? 'working' : 'idle',
      progress: i < count * 0.7 ? 100 : i < count * 0.9 ? Math.floor(Math.random() * 80) : 0,
      task: `Analyzing ${['gamma', 'flow', 'entropy', 'regime', 'correlation'][i % 5]}`
    }));
  };

  return [
    {
      id: 'swarm-1',
      name: 'Factor Discovery',
      type: 'factor_discovery',
      status: 'running',
      agents: createAgents(100, 'analyst'),
      startTime: new Date(Date.now() - 120000),
      completedCount: 72,
      totalCount: 100,
      successRate: 100,
      avgDuration: 1.8
    },
    {
      id: 'swarm-2',
      name: 'Multi-Asset',
      type: 'multi_asset',
      status: 'running',
      agents: createAgents(100, 'observer'),
      startTime: new Date(Date.now() - 180000),
      completedCount: 85,
      totalCount: 100,
      successRate: 98,
      avgDuration: 2.1
    },
    {
      id: 'swarm-3',
      name: 'Structure Discovery',
      type: 'structure_discovery',
      status: 'complete',
      agents: createAgents(96, 'math'),
      startTime: new Date(Date.now() - 300000),
      completedCount: 96,
      totalCount: 96,
      successRate: 100,
      avgDuration: 2.8
    }
  ];
}

const DEMO_SWARMS = generateDemoSwarms();

const typeIcons = {
  scout: Search,
  math: Calculator,
  jury: Scale,
  observer: Brain,
  fixer: Zap,
  analyst: Activity
};

const typeColors = {
  scout: 'text-blue-400',
  math: 'text-purple-400',
  jury: 'text-amber-400',
  observer: 'text-cyan-400',
  fixer: 'text-green-400',
  analyst: 'text-pink-400'
};

const statusColors = {
  idle: 'bg-gray-500/50',
  working: 'bg-blue-500 animate-pulse',
  complete: 'bg-green-500',
  error: 'bg-red-500'
};

export function SwarmActivityMonitor({
  swarms = DEMO_SWARMS,
  onSwarmClick,
  className
}: SwarmActivityMonitorProps) {
  const [selectedSwarm, setSelectedSwarm] = useState<string | null>(null);
  const [animationFrame, setAnimationFrame] = useState(0);

  // Animate the agent visualization
  useEffect(() => {
    const interval = setInterval(() => {
      setAnimationFrame(f => (f + 1) % 360);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // Calculate totals
  const totals = useMemo(() => {
    const totalAgents = swarms.reduce((sum, s) => sum + s.totalCount, 0);
    const completedAgents = swarms.reduce((sum, s) => sum + s.completedCount, 0);
    const runningSwarms = swarms.filter(s => s.status === 'running').length;
    const overallProgress = totalAgents > 0 ? (completedAgents / totalAgents) * 100 : 0;

    return { totalAgents, completedAgents, runningSwarms, overallProgress };
  }, [swarms]);

  const selectedSwarmData = swarms.find(s => s.id === selectedSwarm);

  return (
    <Card className={cn("bg-card/50 backdrop-blur flex flex-col", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Swarm Activity
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge className="bg-blue-500/20 text-blue-400 text-xs">
              {totals.runningSwarms} Active
            </Badge>
            <Badge variant="outline" className="text-xs font-mono">
              {totals.completedAgents}/{totals.totalAgents} Agents
            </Badge>
          </div>
        </div>
        <Progress value={totals.overallProgress} className="h-1 mt-2" />
      </CardHeader>

      <CardContent className="pt-2 flex-1 flex flex-col min-h-0">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
          {/* Swarm List */}
          <div className="space-y-2">
            {swarms.map(swarm => {
              const progress = swarm.totalCount > 0 ? (swarm.completedCount / swarm.totalCount) * 100 : 0;
              const isSelected = selectedSwarm === swarm.id;
              const elapsed = Math.floor((Date.now() - swarm.startTime.getTime()) / 1000);

              return (
                <div
                  key={swarm.id}
                  className={cn(
                    "p-3 rounded-lg border cursor-pointer transition-all",
                    isSelected
                      ? "bg-primary/10 border-primary"
                      : "bg-muted/30 border-transparent hover:bg-muted/50"
                  )}
                  onClick={() => {
                    setSelectedSwarm(isSelected ? null : swarm.id);
                    onSwarmClick?.(swarm.id);
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        swarm.status === 'running' ? "bg-blue-500 animate-pulse" :
                        swarm.status === 'complete' ? "bg-green-500" : "bg-red-500"
                      )} />
                      <span className="font-medium text-sm">{swarm.name}</span>
                    </div>
                    <Badge
                      variant={swarm.status === 'complete' ? 'default' : 'secondary'}
                      className="text-[10px]"
                    >
                      {swarm.status === 'running' ? `${elapsed}s` : 'Done'}
                    </Badge>
                  </div>

                  <Progress value={progress} className="h-1.5 mb-2" />

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{swarm.completedCount}/{swarm.totalCount} agents</span>
                    <span className="flex items-center gap-1">
                      <TrendingUp className="h-3 w-3 text-green-500" />
                      {swarm.successRate}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Agent Visualization */}
          <div className="relative flex-1 min-h-[150px] bg-muted/20 rounded-lg overflow-hidden">
            {selectedSwarmData ? (
              <>
                {/* Agent particles */}
                <svg className="absolute inset-0 w-full h-full">
                  {selectedSwarmData.agents.slice(0, 50).map((agent, i) => {
                    const angle = (i / 50) * Math.PI * 2 + (animationFrame * 0.01);
                    const radius = 40 + (agent.status === 'working' ? Math.sin(animationFrame * 0.1 + i) * 10 : 0);
                    const cx = 50 + Math.cos(angle) * radius;
                    const cy = 50 + Math.sin(angle) * radius;

                    return (
                      <circle
                        key={agent.id}
                        cx={`${cx}%`}
                        cy={`${cy}%`}
                        r={agent.status === 'working' ? 4 : 3}
                        className={cn(
                          "transition-all duration-300",
                          statusColors[agent.status]
                        )}
                        opacity={agent.status === 'idle' ? 0.3 : 1}
                      />
                    );
                  })}

                  {/* Center hub */}
                  <circle
                    cx="50%"
                    cy="50%"
                    r="15"
                    className="fill-primary/30 stroke-primary stroke-2"
                  />
                </svg>

                {/* Center label */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-2xl font-bold font-mono">
                      {selectedSwarmData.completedCount}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      complete
                    </div>
                  </div>
                </div>

                {/* Legend */}
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-center gap-4 text-[10px]">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-gray-500/50" />
                    <span className="text-muted-foreground">Idle</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <span className="text-muted-foreground">Working</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-muted-foreground">Complete</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                Select a swarm to visualize agents
              </div>
            )}
          </div>
        </div>

        {/* Agent Type Distribution */}
        {selectedSwarmData && (
          <div className="mt-4 pt-4 border-t">
            <div className="text-xs text-muted-foreground mb-2">Agent Distribution</div>
            <div className="flex items-center gap-2">
              {Object.entries(
                selectedSwarmData.agents.reduce((acc, a) => {
                  acc[a.type] = (acc[a.type] || 0) + 1;
                  return acc;
                }, {} as Record<string, number>)
              ).map(([type, count]) => {
                const Icon = typeIcons[type as keyof typeof typeIcons] || Activity;
                return (
                  <Badge
                    key={type}
                    variant="outline"
                    className={cn("text-[10px]", typeColors[type as keyof typeof typeColors])}
                  >
                    <Icon className="h-3 w-3 mr-1" />
                    {type}: {count}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SwarmActivityMonitor;
