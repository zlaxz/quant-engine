/**
 * SwarmMonitor - Visual monitoring component for massive swarm jobs
 *
 * Features:
 * - Grid of status dots representing individual agent tasks
 * - Real-time updates via Supabase Realtime or polling
 * - Click to view agent output (chain of thought)
 * - Progress bar and statistics
 * - Cancel/retry controls
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { X, CheckCircle, AlertCircle, Clock, Loader2 } from 'lucide-react';
import {
  type SwarmProgress,
  type SwarmTask,
  type SwarmStatus,
  subscribeToJob,
  pollJobProgress,
  cancelSwarmJob,
  getJobProgress,
} from '@/lib/swarmClient';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface SwarmMonitorProps {
  jobId: string;
  objective: string;
  onClose?: () => void;
  onComplete?: (synthesis: string | null) => void;
  className?: string;
}

interface TaskDotProps {
  task: SwarmTask;
  onClick: () => void;
  size?: 'sm' | 'md' | 'lg';
}

// ============================================================================
// Status Colors
// ============================================================================

const STATUS_COLORS: Record<SwarmStatus, string> = {
  pending: 'bg-gray-400 dark:bg-gray-600',
  processing: 'bg-yellow-400 dark:bg-yellow-500 animate-pulse',
  completed: 'bg-green-500 dark:bg-green-400',
  failed: 'bg-red-500 dark:bg-red-400',
  cancelled: 'bg-gray-300 dark:bg-gray-700',
};

const STATUS_LABELS: Record<SwarmStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

// ============================================================================
// TaskDot Component
// ============================================================================

function TaskDot({ task, onClick, size = 'md' }: TaskDotProps) {
  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4',
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={cn(
              sizeClasses[size],
              'rounded-full transition-transform hover:scale-150 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500',
              STATUS_COLORS[task.status]
            )}
            aria-label={`${task.agent_role}: ${STATUS_LABELS[task.status]}`}
          />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="text-xs">
            <p className="font-semibold">{task.agent_role}</p>
            <p className="text-muted-foreground">{STATUS_LABELS[task.status]}</p>
            {task.latency_ms && (
              <p className="text-muted-foreground">{(task.latency_ms / 1000).toFixed(1)}s</p>
            )}
            {task.error_message && (
              <p className="text-red-500 truncate">{task.error_message}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ============================================================================
// TaskDetailDialog Component
// ============================================================================

interface TaskDetailDialogProps {
  task: SwarmTask | null;
  onClose: () => void;
}

function TaskDetailDialog({ task, onClose }: TaskDetailDialogProps) {
  if (!task) return null;

  return (
    <Dialog open={!!task} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className={cn(
                'w-3 h-3 rounded-full',
                STATUS_COLORS[task.status]
              )}
            />
            {task.agent_role}
          </DialogTitle>
          <DialogDescription>
            Agent #{task.agent_index + 1} - {STATUS_LABELS[task.status]}
            {task.latency_ms && ` (${(task.latency_ms / 1000).toFixed(1)}s)`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Input Context */}
          <div>
            <h4 className="text-sm font-medium mb-1 text-muted-foreground">Input Prompt</h4>
            <ScrollArea className="h-32 rounded-md border p-3 bg-muted/50">
              <pre className="text-xs whitespace-pre-wrap font-mono">
                {task.input_context}
              </pre>
            </ScrollArea>
          </div>

          {/* Output Content */}
          {task.output_content && (
            <div>
              <h4 className="text-sm font-medium mb-1 text-muted-foreground">Agent Output</h4>
              <ScrollArea className="h-64 rounded-md border p-3">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <pre className="text-xs whitespace-pre-wrap font-mono">
                    {task.output_content}
                  </pre>
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Error Message */}
          {task.error_message && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-3 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-800 dark:text-red-200">
                <strong>Error:</strong> {task.error_message}
              </p>
            </div>
          )}

          {/* Metadata */}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {task.tokens_input && (
              <Badge variant="outline">Input: {task.tokens_input} tokens</Badge>
            )}
            {task.tokens_output && (
              <Badge variant="outline">Output: {task.tokens_output} tokens</Badge>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// SwarmMonitor Component
// ============================================================================

export function SwarmMonitor({
  jobId,
  objective,
  onClose,
  onComplete,
  className,
}: SwarmMonitorProps) {
  const [progress, setProgress] = useState<SwarmProgress | null>(null);
  const [selectedTask, setSelectedTask] = useState<SwarmTask | null>(null);
  const [_isSubscribed, setIsSubscribed] = useState(false);

  // Subscribe to job updates
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const handleProgress = (newProgress: SwarmProgress) => {
      setProgress(newProgress);

      // Call onComplete when job finishes
      if (
        newProgress.status === 'completed' &&
        onComplete &&
        newProgress.synthesis
      ) {
        onComplete(newProgress.synthesis);
      }
    };

    // Try realtime first, fall back to polling
    try {
      unsubscribe = subscribeToJob(jobId, handleProgress);
      setIsSubscribed(true);
    } catch (error) {
      console.warn('[SwarmMonitor] Realtime failed, using polling:', error);
      unsubscribe = pollJobProgress(jobId, handleProgress, 1500);
    }

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [jobId, onComplete]);

  // Handle cancel
  const handleCancel = useCallback(async () => {
    try {
      await cancelSwarmJob(jobId);
      // Refresh progress
      const newProgress = await getJobProgress(jobId);
      setProgress(newProgress);
    } catch (error) {
      console.error('[SwarmMonitor] Cancel failed:', error);
    }
  }, [jobId]);

  // Calculate grid dimensions based on task count
  const getGridCols = (count: number): string => {
    if (count <= 10) return 'grid-cols-5';
    if (count <= 25) return 'grid-cols-5';
    if (count <= 50) return 'grid-cols-10';
    return 'grid-cols-10 sm:grid-cols-15';
  };

  if (!progress) {
    return (
      <div className={cn('flex items-center justify-center p-8', className)}>
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading swarm status...</span>
      </div>
    );
  }

  const isActive = progress.status === 'pending' || progress.status === 'processing';

  return (
    <div className={cn('rounded-lg border bg-card p-4 space-y-4', className)}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1 flex-1 mr-4">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">Swarm Execution</h3>
            <Badge
              variant={
                progress.status === 'completed'
                  ? 'default'
                  : progress.status === 'failed'
                  ? 'destructive'
                  : 'secondary'
              }
            >
              {STATUS_LABELS[progress.status]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{objective}</p>
        </div>

        <div className="flex items-center gap-1">
          {isActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              className="h-7 px-2"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-7 px-2"
            >
              Close
            </Button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Progress</span>
          <span>{progress.progressPct}%</span>
        </div>
        <Progress value={progress.progressPct} className="h-2" />
      </div>

      {/* Statistics */}
      <div className="flex flex-wrap gap-3 text-xs">
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3 text-gray-500" />
          <span>{progress.pendingTasks} pending</span>
        </div>
        <div className="flex items-center gap-1">
          <Loader2 className="w-3 h-3 text-yellow-500" />
          <span>{progress.processingTasks} processing</span>
        </div>
        <div className="flex items-center gap-1">
          <CheckCircle className="w-3 h-3 text-green-500" />
          <span>{progress.completedTasks} completed</span>
        </div>
        {progress.failedTasks > 0 && (
          <div className="flex items-center gap-1">
            <AlertCircle className="w-3 h-3 text-red-500" />
            <span>{progress.failedTasks} failed</span>
          </div>
        )}
      </div>

      {/* Task Grid */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground">
          Agent Tasks ({progress.totalTasks})
        </h4>
        <div
          className={cn(
            'grid gap-1.5 p-2 rounded-md bg-muted/30',
            getGridCols(progress.totalTasks)
          )}
        >
          {progress.tasks.map((task) => (
            <TaskDot
              key={task.id}
              task={task}
              onClick={() => setSelectedTask(task)}
              size={progress.totalTasks > 50 ? 'sm' : 'md'}
            />
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-gray-400" />
          <span>Pending</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
          <span>Processing</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span>Completed</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          <span>Failed</span>
        </div>
      </div>

      {/* Synthesis Result */}
      {progress.synthesis && (
        <div className="pt-2 border-t">
          <h4 className="text-xs font-medium text-muted-foreground mb-2">
            Synthesis Result
          </h4>
          <ScrollArea className="h-40 rounded-md border p-3 bg-muted/30">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <pre className="text-xs whitespace-pre-wrap font-mono">
                {progress.synthesis}
              </pre>
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Task Detail Dialog */}
      <TaskDetailDialog
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  );
}

export default SwarmMonitor;
