/**
 * SwarmMonitor - Per-agent status and swarm visibility
 *
 * PHASE 5: Operational Excellence
 *
 * Features:
 * - Per-agent status display
 * - Agent type breakdown (Scout, Math, Jury - Layer 2, 3, 4)
 * - Task assignments per agent
 * - Resource usage per swarm
 * - Agent lifecycle (spawning, working, complete, failed)
 *
 * ADHD Design:
 * - Visual agent cards
 * - Color-coded by type/layer
 * - Real-time status updates
 * - Collapsible detail views
 */

import { useState, useMemo } from 'react';
import {
  Users,
  User,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
  Brain,
  Scale,
  Search,
  Calculator,
  ChevronDown,
  ChevronRight,
  Activity,
  Cpu,
  Timer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/timeAnchor';

// =========================================================================
// Types
// =========================================================================

type AgentStatus = 'idle' | 'spawning' | 'working' | 'complete' | 'failed';
type AgentType = 'scout' | 'math' | 'jury' | 'researcher' | 'validator' | 'coordinator';
type SwarmLayer = 2 | 3 | 4;

interface Agent {
  id: string;
  type: AgentType;
  layer: SwarmLayer;
  status: AgentStatus;
  currentTask: string | null;
  progress: number;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  tokensUsed: number;
  cost: number;
  findings?: number;
  errors?: string[];
}

interface SwarmStats {
  totalAgents: number;
  activeAgents: number;
  completedTasks: number;
  failedTasks: number;
  totalTokens: number;
  totalCost: number;
  averageTaskDuration: string;
}

interface SwarmMonitorProps {
  agents: Agent[];
  stats?: SwarmStats;
  onKillAgent?: (agentId: string) => void;
  onRetryAgent?: (agentId: string) => void;
  compact?: boolean;
  className?: string;
}

// =========================================================================
// Configuration
// =========================================================================

const AGENT_TYPE_CONFIG: Record<
  AgentType,
  { label: string; icon: React.ReactNode; color: string; bgColor: string }
> = {
  scout: {
    label: 'Scout',
    icon: <Search className="h-4 w-4" />,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/20',
  },
  math: {
    label: 'Math',
    icon: <Calculator className="h-4 w-4" />,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/20',
  },
  jury: {
    label: 'Jury',
    icon: <Scale className="h-4 w-4" />,
    color: 'text-green-500',
    bgColor: 'bg-green-500/20',
  },
  researcher: {
    label: 'Researcher',
    icon: <Brain className="h-4 w-4" />,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/20',
  },
  validator: {
    label: 'Validator',
    icon: <CheckCircle className="h-4 w-4" />,
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/20',
  },
  coordinator: {
    label: 'Coordinator',
    icon: <Users className="h-4 w-4" />,
    color: 'text-cyan-500',
    bgColor: 'bg-cyan-500/20',
  },
};

const STATUS_CONFIG: Record<
  AgentStatus,
  { label: string; icon: React.ReactNode; color: string }
> = {
  idle: {
    label: 'Idle',
    icon: <Clock className="h-3 w-3" />,
    color: 'text-gray-500',
  },
  spawning: {
    label: 'Spawning',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    color: 'text-yellow-500',
  },
  working: {
    label: 'Working',
    icon: <Activity className="h-3 w-3 animate-pulse" />,
    color: 'text-blue-500',
  },
  complete: {
    label: 'Complete',
    icon: <CheckCircle className="h-3 w-3" />,
    color: 'text-green-500',
  },
  failed: {
    label: 'Failed',
    icon: <XCircle className="h-3 w-3" />,
    color: 'text-red-500',
  },
};

const LAYER_LABELS: Record<SwarmLayer, string> = {
  2: 'Scout Swarm',
  3: 'Math Swarm',
  4: 'Jury Swarm',
};

// =========================================================================
// Agent Card Component
// =========================================================================

function AgentCard({
  agent,
  onKill,
  onRetry,
}: {
  agent: Agent;
  onKill?: () => void;
  onRetry?: () => void;
}) {
  const typeConfig = AGENT_TYPE_CONFIG[agent.type];
  const statusConfig = STATUS_CONFIG[agent.status];

  return (
    <div
      className={cn(
        'p-3 rounded-lg border',
        agent.status === 'working' && 'border-blue-500/50',
        agent.status === 'failed' && 'border-red-500/50'
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={cn('p-1.5 rounded', typeConfig.bgColor)}>
            <span className={typeConfig.color}>{typeConfig.icon}</span>
          </div>
          <div>
            <div className="font-medium text-sm flex items-center gap-1">
              {typeConfig.label}
              <Badge variant="outline" className="text-xs ml-1">
                L{agent.layer}
              </Badge>
            </div>
            <div className={cn('text-xs flex items-center gap-1', statusConfig.color)}>
              {statusConfig.icon}
              {statusConfig.label}
            </div>
          </div>
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          #{agent.id.slice(-6)}
        </span>
      </div>

      {/* Current task */}
      {agent.currentTask && (
        <div className="mb-2">
          <p className="text-xs text-muted-foreground line-clamp-1">
            {agent.currentTask}
          </p>
          {agent.status === 'working' && (
            <Progress value={agent.progress} className="h-1 mt-1" />
          )}
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-1">
                <Zap className="h-3 w-3" />
                {(agent.tokensUsed / 1000).toFixed(1)}k
              </TooltipTrigger>
              <TooltipContent>Tokens used</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span>${agent.cost.toFixed(3)}</span>
          {agent.findings !== undefined && agent.findings > 0 && (
            <Badge variant="secondary" className="text-xs">
              {agent.findings} findings
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {agent.status === 'failed' && onRetry && (
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={onRetry}>
              Retry
            </Button>
          )}
          {(agent.status === 'working' || agent.status === 'spawning') && onKill && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-red-500"
              onClick={onKill}
            >
              Kill
            </Button>
          )}
        </div>
      </div>

      {/* Errors */}
      {agent.errors && agent.errors.length > 0 && (
        <div className="mt-2 p-2 bg-red-500/10 rounded text-xs text-red-500">
          {agent.errors[0]}
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Main Component
// =========================================================================

export function SwarmMonitor({
  agents,
  stats,
  onKillAgent,
  onRetryAgent,
  compact = false,
  className,
}: SwarmMonitorProps) {
  const [expandedLayers, setExpandedLayers] = useState<SwarmLayer[]>([2, 3, 4]);

  // Group agents by layer
  const agentsByLayer = useMemo(() => {
    const groups: Record<SwarmLayer, Agent[]> = { 2: [], 3: [], 4: [] };
    agents.forEach((agent) => {
      if (groups[agent.layer]) {
        groups[agent.layer].push(agent);
      }
    });
    return groups;
  }, [agents]);

  // Count by status
  const statusCounts = useMemo(() => {
    const counts: Record<AgentStatus, number> = {
      idle: 0,
      spawning: 0,
      working: 0,
      complete: 0,
      failed: 0,
    };
    agents.forEach((agent) => {
      counts[agent.status]++;
    });
    return counts;
  }, [agents]);

  const toggleLayer = (layer: SwarmLayer) => {
    setExpandedLayers((prev) =>
      prev.includes(layer) ? prev.filter((l) => l !== layer) : [...prev, layer]
    );
  };

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className={compact ? 'pb-2' : undefined}>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Swarm Monitor
            </CardTitle>
            {!compact && (
              <CardDescription>
                {agents.length} agents across 3 layers
              </CardDescription>
            )}
          </div>

          {/* Status summary */}
          <div className="flex items-center gap-2">
            {statusCounts.working > 0 && (
              <Badge className="bg-blue-500">
                <Activity className="h-3 w-3 mr-1 animate-pulse" />
                {statusCounts.working} working
              </Badge>
            )}
            {statusCounts.spawning > 0 && (
              <Badge variant="secondary">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                {statusCounts.spawning} spawning
              </Badge>
            )}
            {statusCounts.failed > 0 && (
              <Badge variant="destructive">{statusCounts.failed} failed</Badge>
            )}
          </div>
        </div>

        {/* Overall stats */}
        {stats && !compact && (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4 mt-4 text-sm">
            <div>
              <div className="text-muted-foreground">Total Agents</div>
              <div className="font-medium">{stats.totalAgents}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Active</div>
              <div className="font-medium text-blue-500">{stats.activeAgents}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Completed</div>
              <div className="font-medium text-green-500">{stats.completedTasks}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Failed</div>
              <div className="font-medium text-red-500">{stats.failedTasks}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Tokens</div>
              <div className="font-medium font-mono">
                {(stats.totalTokens / 1000).toFixed(1)}k
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Cost</div>
              <div className="font-medium font-mono">${stats.totalCost.toFixed(2)}</div>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {agents.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No active agents</p>
            <p className="text-sm">Agents will appear here when swarms are running</p>
          </div>
        ) : (
          <>
            {/* Layer sections */}
            {([2, 3, 4] as SwarmLayer[]).map((layer) => {
              const layerAgents = agentsByLayer[layer];
              if (layerAgents.length === 0 && compact) return null;

              return (
                <Collapsible
                  key={layer}
                  open={expandedLayers.includes(layer)}
                  onOpenChange={() => toggleLayer(layer)}
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full justify-between hover:bg-muted"
                    >
                      <span className="flex items-center gap-2">
                        <Badge variant="outline">Layer {layer}</Badge>
                        <span className="font-medium">{LAYER_LABELS[layer]}</span>
                        <Badge variant="secondary">{layerAgents.length}</Badge>
                      </span>
                      {expandedLayers.includes(layer) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {layerAgents.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground text-sm">
                        No agents in this layer
                      </div>
                    ) : (
                      <ScrollArea className={compact ? 'h-[200px]' : 'h-[300px]'}>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-2">
                          {layerAgents.map((agent) => (
                            <AgentCard
                              key={agent.id}
                              agent={agent}
                              onKill={
                                onKillAgent ? () => onKillAgent(agent.id) : undefined
                              }
                              onRetry={
                                onRetryAgent ? () => onRetryAgent(agent.id) : undefined
                              }
                            />
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default SwarmMonitor;
