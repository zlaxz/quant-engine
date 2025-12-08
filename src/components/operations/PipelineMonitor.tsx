/**
 * PipelineMonitor - AI activity visibility
 *
 * PHASE 5: Operational Excellence
 *
 * Features:
 * - Current task with progress bar
 * - Queue depth and ETA
 * - Recent completions log
 * - Error log with details
 * - Swarm agent status (Scout, Math, Jury counts)
 * - Resource usage (CPU, memory, API calls)
 *
 * ADHD Design:
 * - Status at a glance (idle/running/error)
 * - Progress bar for current task
 * - Color-coded agent counts
 * - Expandable details
 */

import { useState, useMemo } from 'react';
import {
  Activity,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Cpu,
  HardDrive,
  Zap,
  Users,
  ListTodo,
  History,
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

interface Task {
  id: string;
  name: string;
  phase: 'discovery' | 'backtesting' | 'validation' | 'optimization';
  priority: 'high' | 'medium' | 'low';
  queuedAt: Date | string;
  estimatedDuration?: string;
}

interface Completion {
  id: string;
  name: string;
  phase: string;
  completedAt: Date | string;
  duration: string;
  success: boolean;
  result?: string;
}

interface PipelineError {
  id: string;
  message: string;
  phase: string;
  task: string;
  timestamp: Date | string;
  stackTrace?: string;
  recoverable: boolean;
}

interface PipelineState {
  status: 'idle' | 'running' | 'error' | 'paused';
  currentPhase: 'discovery' | 'backtesting' | 'validation' | 'optimization' | null;
  currentTask: string | null;
  progress: number;
  estimatedCompletion: Date | string | null;
  queuedTasks: Task[];
  recentCompletions: Completion[];
  activeAgents: number;
  agentTypes: Record<string, number>;
  recentErrors: PipelineError[];
  cpuUsage: number;
  memoryUsage: number;
  apiCallsRemaining: number;
  apiCallsPerSecond: number;
}

interface PipelineMonitorProps {
  state: PipelineState;
  onPause?: () => void;
  onResume?: () => void;
  onRetry?: (errorId: string) => void;
  onClearQueue?: () => void;
  compact?: boolean;
  className?: string;
}

// =========================================================================
// Configuration
// =========================================================================

const PHASE_CONFIG: Record<string, { label: string; color: string }> = {
  discovery: { label: 'Discovery', color: 'text-purple-500' },
  backtesting: { label: 'Backtesting', color: 'text-blue-500' },
  validation: { label: 'Validation', color: 'text-yellow-500' },
  optimization: { label: 'Optimization', color: 'text-green-500' },
};

const STATUS_CONFIG: Record<
  PipelineState['status'],
  { label: string; color: string; icon: React.ReactNode }
> = {
  idle: {
    label: 'Idle',
    color: 'text-gray-500',
    icon: <Clock className="h-4 w-4" />,
  },
  running: {
    label: 'Running',
    color: 'text-green-500',
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
  },
  paused: {
    label: 'Paused',
    color: 'text-yellow-500',
    icon: <Pause className="h-4 w-4" />,
  },
  error: {
    label: 'Error',
    color: 'text-red-500',
    icon: <XCircle className="h-4 w-4" />,
  },
};

const AGENT_COLORS: Record<string, string> = {
  scout: 'bg-purple-500',
  math: 'bg-blue-500',
  jury: 'bg-green-500',
  researcher: 'bg-yellow-500',
  validator: 'bg-orange-500',
};

// =========================================================================
// Component
// =========================================================================

export function PipelineMonitor({
  state,
  onPause,
  onResume,
  onRetry,
  onClearQueue,
  compact = false,
  className,
}: PipelineMonitorProps) {
  const [showErrors, setShowErrors] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showCompletions, setShowCompletions] = useState(false);

  const statusConfig = STATUS_CONFIG[state.status];
  const phaseConfig = state.currentPhase ? PHASE_CONFIG[state.currentPhase] : null;

  // Calculate ETA string
  const etaString = useMemo(() => {
    if (!state.estimatedCompletion) return null;
    const eta = new Date(state.estimatedCompletion);
    const now = new Date();
    const diffMs = eta.getTime() - now.getTime();
    if (diffMs < 0) return 'Overdue';
    const diffMin = Math.floor(diffMs / 1000 / 60);
    if (diffMin < 60) return `~${diffMin}m remaining`;
    const diffHour = Math.floor(diffMin / 60);
    return `~${diffHour}h ${diffMin % 60}m remaining`;
  }, [state.estimatedCompletion]);

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className={compact ? 'pb-2' : undefined}>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Pipeline Monitor
            </CardTitle>
            {!compact && (
              <CardDescription>AI research and discovery activity</CardDescription>
            )}
          </div>

          {/* Status badge and controls */}
          <div className="flex items-center gap-2">
            <Badge
              variant={state.status === 'error' ? 'destructive' : 'secondary'}
              className={cn(
                'flex items-center gap-1',
                state.status === 'running' && 'animate-pulse'
              )}
            >
              {statusConfig.icon}
              {statusConfig.label}
            </Badge>

            {state.status === 'running' && onPause && (
              <Button variant="outline" size="sm" onClick={onPause}>
                <Pause className="h-4 w-4" />
              </Button>
            )}

            {state.status === 'paused' && onResume && (
              <Button variant="outline" size="sm" onClick={onResume}>
                <Play className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Current Task */}
        {state.currentTask && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                {phaseConfig && (
                  <Badge variant="outline" className={phaseConfig.color}>
                    {phaseConfig.label}
                  </Badge>
                )}
                <span className="font-medium">{state.currentTask}</span>
              </div>
              <span className="text-muted-foreground">{state.progress}%</span>
            </div>
            <Progress value={state.progress} className="h-2" />
            {etaString && (
              <div className="text-xs text-muted-foreground text-right">
                {etaString}
              </div>
            )}
          </div>
        )}

        {/* Idle state */}
        {state.status === 'idle' && !state.currentTask && (
          <div className="text-center py-4 text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Pipeline idle - no active tasks</p>
          </div>
        )}

        {/* Swarm Status */}
        {state.activeAgents > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-4 w-4" />
                Active Agents
              </span>
              <Badge variant="secondary">{state.activeAgents}</Badge>
            </div>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(state.agentTypes).map(([type, count]) => (
                <TooltipProvider key={type}>
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge
                        variant="outline"
                        className="flex items-center gap-1"
                      >
                        <div
                          className={cn(
                            'w-2 h-2 rounded-full',
                            AGENT_COLORS[type] || 'bg-gray-500'
                          )}
                        />
                        {type}: {count}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      {count} {type} agent{count !== 1 ? 's' : ''} active
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
          </div>
        )}

        {/* Resource Usage */}
        {!compact && (
          <div className="grid grid-cols-4 gap-4 text-sm">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Cpu className="h-3 w-3" />
                      CPU
                    </div>
                    <Progress
                      value={state.cpuUsage}
                      className="h-1.5"
                      indicatorClassName={cn(
                        state.cpuUsage > 80
                          ? 'bg-red-500'
                          : state.cpuUsage > 60
                            ? 'bg-yellow-500'
                            : 'bg-green-500'
                      )}
                    />
                    <div className="text-xs font-mono">{state.cpuUsage}%</div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>CPU Usage</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <HardDrive className="h-3 w-3" />
                      Memory
                    </div>
                    <Progress
                      value={state.memoryUsage}
                      className="h-1.5"
                      indicatorClassName={cn(
                        state.memoryUsage > 80
                          ? 'bg-red-500'
                          : state.memoryUsage > 60
                            ? 'bg-yellow-500'
                            : 'bg-green-500'
                      )}
                    />
                    <div className="text-xs font-mono">{state.memoryUsage}%</div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Memory Usage</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Zap className="h-3 w-3" />
                      API
                    </div>
                    <div className="text-xs font-mono">
                      {state.apiCallsRemaining.toLocaleString()} left
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {state.apiCallsPerSecond}/sec
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>API calls remaining today</TooltipContent>
              </Tooltip>

              <div className="space-y-1">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <ListTodo className="h-3 w-3" />
                  Queue
                </div>
                <div className="text-xs font-mono">
                  {state.queuedTasks.length} tasks
                </div>
              </div>
            </TooltipProvider>
          </div>
        )}

        {/* Errors Section */}
        {state.recentErrors.length > 0 && (
          <Collapsible open={showErrors} onOpenChange={setShowErrors}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-between text-red-500"
              >
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  {state.recentErrors.length} Error
                  {state.recentErrors.length !== 1 ? 's' : ''}
                </span>
                {showErrors ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea className="h-[150px] mt-2">
                <div className="space-y-2">
                  {state.recentErrors.map((error) => (
                    <div
                      key={error.id}
                      className="p-2 bg-red-500/10 rounded-lg text-sm"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="font-medium">{error.task}</span>
                          <span className="text-muted-foreground"> in </span>
                          <span>{error.phase}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(error.timestamp)}
                        </span>
                      </div>
                      <p className="text-red-600 mt-1">{error.message}</p>
                      {error.recoverable && onRetry && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={() => onRetry(error.id)}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Retry
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Queue Section */}
        {state.queuedTasks.length > 0 && !compact && (
          <Collapsible open={showQueue} onOpenChange={setShowQueue}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <ListTodo className="h-4 w-4" />
                  Queued Tasks ({state.queuedTasks.length})
                </span>
                {showQueue ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea className="h-[150px] mt-2">
                <div className="space-y-2">
                  {state.queuedTasks.map((task, index) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between p-2 bg-muted rounded-lg text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">#{index + 1}</span>
                        <Badge
                          variant="outline"
                          className={PHASE_CONFIG[task.phase]?.color}
                        >
                          {PHASE_CONFIG[task.phase]?.label}
                        </Badge>
                        <span>{task.name}</span>
                      </div>
                      <Badge
                        variant={
                          task.priority === 'high'
                            ? 'destructive'
                            : task.priority === 'medium'
                              ? 'default'
                              : 'secondary'
                        }
                        className="text-xs"
                      >
                        {task.priority}
                      </Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              {onClearQueue && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={onClearQueue}
                >
                  Clear Queue
                </Button>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Recent Completions */}
        {state.recentCompletions.length > 0 && !compact && (
          <Collapsible open={showCompletions} onOpenChange={setShowCompletions}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <History className="h-4 w-4" />
                  Recent Completions ({state.recentCompletions.length})
                </span>
                {showCompletions ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea className="h-[150px] mt-2">
                <div className="space-y-2">
                  {state.recentCompletions.map((completion) => (
                    <div
                      key={completion.id}
                      className="flex items-center justify-between p-2 bg-muted rounded-lg text-sm"
                    >
                      <div className="flex items-center gap-2">
                        {completion.success ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                        <span>{completion.name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{completion.duration}</span>
                        <span>{formatRelativeTime(completion.completedAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

export default PipelineMonitor;
