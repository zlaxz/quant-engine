/**
 * Mission Control - Command center showing operation queue and pre-execution previews
 * Can be displayed inline or as a popout window
 */

import { useState } from 'react';
import { 
  ListOrdered, 
  Clock, 
  Play, 
  X, 
  ChevronUp, 
  ChevronDown,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Rocket,
  FileCode,
  Database,
  Brain,
  Terminal,
  Trash2,
  ExternalLink
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useMissionControl, ScheduledOperation } from '@/contexts/MissionControlContext';
import { ClaudeCodePendingPreview } from './ClaudeCodePendingPreview';

const operationTypeIcons: Record<ScheduledOperation['type'], typeof Rocket> = {
  backtest: Rocket,
  analysis: Brain,
  scan: Database,
  python: Terminal,
  file_op: FileCode,
  llm_call: Brain,
};


const statusColors: Record<ScheduledOperation['status'], string> = {
  queued: 'bg-muted text-muted-foreground',
  pending_approval: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
  running: 'bg-primary/20 text-primary',
  completed: 'bg-green-500/20 text-green-600 dark:text-green-400',
  failed: 'bg-destructive/20 text-destructive',
  cancelled: 'bg-muted text-muted-foreground line-through',
};

interface OperationCardProps {
  operation: ScheduledOperation;
  index?: number;
  canReorder?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onCancel?: () => void;
}

function OperationCard({ operation, index, canReorder, onMoveUp, onMoveDown, onCancel }: OperationCardProps) {
  const Icon = operationTypeIcons[operation.type];
  const isRunning = operation.status === 'running';
  const isPending = operation.status === 'queued' || operation.status === 'pending_approval';
  
  return (
    <div className={cn(
      'rounded-lg border p-3 space-y-2 transition-colors',
      isRunning && 'border-primary bg-primary/5',
      operation.status === 'pending_approval' && 'border-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20'
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn(
            'p-1.5 rounded',
            isRunning ? 'bg-primary/20' : 'bg-muted'
          )}>
            <Icon className={cn('h-4 w-4', isRunning && 'animate-pulse')} />
          </div>
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{operation.title}</div>
            <div className="text-xs text-muted-foreground truncate">{operation.description}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Badge variant="outline" className={cn('text-[10px] whitespace-nowrap', statusColors[operation.status])}>
            {operation.status === 'running' ? 'Running' : 
             operation.status === 'pending_approval' ? 'Needs OK' :
             operation.status === 'queued' ? `#${(index ?? 0) + 1}` :
             operation.status}
          </Badge>
        </div>
      </div>

      {/* Details */}
      {operation.details && (
        <div className="flex flex-wrap gap-2 text-[10px]">
          {operation.details.strategy && (
            <span className="px-1.5 py-0.5 bg-muted rounded">📊 {operation.details.strategy}</span>
          )}
          {operation.details.dataRange && (
            <span className="px-1.5 py-0.5 bg-muted rounded">📅 {operation.details.dataRange}</span>
          )}
          {operation.details.model && (
            <span className="px-1.5 py-0.5 bg-muted rounded">🤖 {operation.details.model}</span>
          )}
          {operation.details.files && operation.details.files.length > 0 && (
            <span className="px-1.5 py-0.5 bg-muted rounded">📁 {operation.details.files.length} files</span>
          )}
        </div>
      )}

      {/* Progress bar for running operations */}
      {isRunning && operation.progress !== undefined && (
        <div className="space-y-1">
          <Progress value={operation.progress} className="h-1.5" />
          <div className="text-[10px] text-muted-foreground text-right">{operation.progress}%</div>
        </div>
      )}

      {/* Estimated duration */}
      {operation.estimatedDuration && isPending && (
        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Est. {operation.estimatedDuration}
        </div>
      )}

      {/* Actions for queued items */}
      {canReorder && isPending && (
        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onMoveUp} disabled={index === 0}>
              <ChevronUp className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onMoveDown}>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive" onClick={onCancel}>
            <X className="h-3 w-3 mr-1" />
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

interface MissionControlProps {
  className?: string;
  isPopout?: boolean;
}

export function MissionControl({ className, isPopout = false }: MissionControlProps) {
  const { state, removePendingApproval, removeFromQueue, reorderQueue, clearCompleted } = useMissionControl();
  const [showCompleted, setShowCompleted] = useState(false);

  const handleApprove = async (id: string) => {
    await window.electron?.approveClaudeCodeCommand?.(id);
    removePendingApproval(id);
  };

  const handleReject = async (id: string) => {
    await window.electron?.rejectClaudeCodeCommand?.(id);
    removePendingApproval(id);
  };

  const handlePopout = async () => {
    await window.electron?.popoutCreate?.({
      id: 'mission-control',
      title: 'Mission Control',
      visualizationType: 'mission-control',
      data: state,
      width: 450,
      height: 700,
    });
  };

  const totalPending = state.pendingApprovals.length + state.operationQueue.length;
  const hasActivity = totalPending > 0 || state.currentOperation;

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ListOrdered className="h-4 w-4" />
            Mission Control
            {totalPending > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {totalPending} pending
              </Badge>
            )}
          </CardTitle>
          {!isPopout && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePopout}>
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-4">
            {/* Pending Approvals */}
            {state.pendingApprovals.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Waiting for your approval ({state.pendingApprovals.length})
                </div>
                {state.pendingApprovals.map(command => (
                  <ClaudeCodePendingPreview
                    key={command.id}
                    command={command}
                    onApprove={handleApprove}
                    onReject={handleReject}
                  />
                ))}
              </div>
            )}

            {/* Current Operation */}
            {state.currentOperation && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-primary flex items-center gap-1">
                  <Play className="h-3 w-3 animate-pulse" />
                  Currently Running
                </div>
                <OperationCard operation={state.currentOperation} />
              </div>
            )}

            {/* Queue */}
            {state.operationQueue.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Up Next ({state.operationQueue.length})
                </div>
                {state.operationQueue.map((operation, index) => (
                  <OperationCard
                    key={operation.id}
                    operation={operation}
                    index={index}
                    canReorder={true}
                    onMoveUp={() => index > 0 && reorderQueue(index, index - 1)}
                    onMoveDown={() => index < state.operationQueue.length - 1 && reorderQueue(index, index + 1)}
                    onCancel={() => removeFromQueue(operation.id)}
                  />
                ))}
              </div>
            )}

            {/* Empty State */}
            {!hasActivity && state.completedOperations.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <ListOrdered className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <div className="text-sm">No operations scheduled</div>
                <div className="text-xs">Operations will appear here before they run</div>
              </div>
            )}

            {/* Completed Operations */}
            {state.completedOperations.length > 0 && (
              <div className="space-y-2">
                <Separator />
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between text-xs h-8"
                  onClick={() => setShowCompleted(!showCompleted)}
                >
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Completed ({state.completedOperations.length})
                  </span>
                  {showCompleted ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </Button>
                
                {showCompleted && (
                  <div className="space-y-2">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full text-xs h-7 text-muted-foreground"
                      onClick={clearCompleted}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Clear history
                    </Button>
                    {state.completedOperations.slice(0, 10).map(operation => (
                      <div
                        key={operation.id}
                        className={cn(
                          'rounded border p-2 text-xs flex items-center gap-2 opacity-60',
                          operation.status === 'completed' && 'border-green-500/30',
                          operation.status === 'failed' && 'border-destructive/30'
                        )}
                      >
                        {operation.status === 'completed' ? (
                          <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
                        ) : (
                          <XCircle className="h-3 w-3 text-destructive flex-shrink-0" />
                        )}
                        <span className="truncate">{operation.title}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
                          {operation.completedAt && new Date(operation.completedAt).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
