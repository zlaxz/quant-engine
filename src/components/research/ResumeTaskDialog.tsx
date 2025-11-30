/**
 * Resume Task Dialog - Phase 6: Working Memory Checkpoints
 * Shows unfinished tasks detected on app restart
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import {
  Check,
  Clock,
  FileEdit,
  Save,
  ChevronDown,
  ChevronUp,
  PlayCircle,
  XCircle,
  Eye,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export interface UnfinishedTask {
  id: string;
  task: string;
  progress: number;
  completedSteps: string[];
  nextSteps: string[];
  filesModified: Array<{
    path: string;
    linesAdded: number;
    linesRemoved: number;
    status: 'created' | 'modified' | 'deleted';
  }>;
  lastCheckpointAt: number;
  estimatedTimeRemaining?: number;
}

interface ResumeTaskDialogProps {
  tasks: UnfinishedTask[];
  onResume: (taskId: string) => void;
  onAbandon: (taskId: string) => void;
  onViewDetails: (taskId: string) => void;
}

export const ResumeTaskDialog = ({
  tasks,
  onResume,
  onAbandon,
  onViewDetails,
}: ResumeTaskDialogProps) => {
  const [open, setOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  // Show dialog if there are unfinished tasks
  useEffect(() => {
    if (tasks.length > 0) {
      setOpen(true);
      setSelectedTask(tasks[0].id); // Select first task by default
    }
  }, [tasks]);

  if (tasks.length === 0) return null;

  const task = tasks.find(t => t.id === selectedTask) || tasks[0];

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const getStatusIcon = (status: 'created' | 'modified' | 'deleted') => {
    switch (status) {
      case 'created':
        return <Badge variant="default" className="text-xs">New</Badge>;
      case 'modified':
        return <Badge variant="secondary" className="text-xs">Modified</Badge>;
      case 'deleted':
        return <Badge variant="destructive" className="text-xs">Deleted</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Save className="h-5 w-5 text-primary" />
            <DialogTitle>💾 UNFINISHED TASK DETECTED</DialogTitle>
          </div>
          <DialogDescription>
            You were working on a task when the app closed. Would you like to resume where you left off?
          </DialogDescription>
        </DialogHeader>

        {/* Main Content */}
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-[500px] pr-4">
            {/* Task Selection (if multiple) */}
            {tasks.length > 1 && (
              <div className="mb-4 space-y-2">
                <p className="text-sm font-semibold text-muted-foreground">
                  {tasks.length} unfinished tasks found:
                </p>
                <div className="flex gap-2 flex-wrap">
                  {tasks.map((t) => (
                    <Button
                      key={t.id}
                      variant={selectedTask === t.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedTask(t.id)}
                    >
                      {t.task.slice(0, 30)}... ({t.progress}%)
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Task Details */}
            <Card className="p-4 mb-4">
              <div className="space-y-4">
                {/* Task Description */}
                <div>
                  <h3 className="font-semibold mb-1">{task.task}</h3>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>Last saved {formatTimestamp(task.lastCheckpointAt)}</span>
                    {task.estimatedTimeRemaining && (
                      <>
                        <span>•</span>
                        <span>~{Math.ceil(task.estimatedTimeRemaining / 60000)}m remaining</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Progress</span>
                    <span className="text-muted-foreground">{task.progress}% complete</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                </div>

                {/* Completed Steps */}
                <Collapsible
                  open={expandedTask === 'completed'}
                  onOpenChange={(open) => setExpandedTask(open ? 'completed' : null)}
                >
                  <CollapsibleTrigger className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-semibold">
                        Completed Steps ({task.completedSteps.length})
                      </span>
                    </div>
                    {expandedTask === 'completed' ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-1">
                    {task.completedSteps.map((step, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm pl-6">
                        <Check className="h-3 w-3 text-green-600 mt-0.5 flex-shrink-0" />
                        <span>{step}</span>
                      </div>
                    ))}
                  </CollapsibleContent>
                </Collapsible>

                {/* Next Steps */}
                {task.nextSteps.length > 0 && (
                  <Collapsible
                    open={expandedTask === 'next'}
                    onOpenChange={(open) => setExpandedTask(open ? 'next' : null)}
                  >
                    <CollapsibleTrigger className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-orange-600" />
                        <span className="text-sm font-semibold">
                          Next Steps ({task.nextSteps.length})
                        </span>
                      </div>
                      {expandedTask === 'next' ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 space-y-1">
                      {task.nextSteps.map((step, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm pl-6">
                          <Clock className="h-3 w-3 text-orange-600 mt-0.5 flex-shrink-0" />
                          <span>{step}</span>
                        </div>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {/* Files Modified */}
                {task.filesModified.length > 0 && (
                  <Collapsible
                    open={expandedTask === 'files'}
                    onOpenChange={(open) => setExpandedTask(open ? 'files' : null)}
                  >
                    <CollapsibleTrigger className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <FileEdit className="h-4 w-4 text-blue-600" />
                        <span className="text-sm font-semibold">
                          Files Modified ({task.filesModified.length})
                        </span>
                      </div>
                      {expandedTask === 'files' ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 space-y-2">
                      {task.filesModified.map((file, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between text-xs font-mono bg-muted p-2 rounded"
                        >
                          <div className="flex items-center gap-2 flex-1">
                            {getStatusIcon(file.status)}
                            <span className="truncate">{file.path}</span>
                          </div>
                          <span className="text-muted-foreground ml-2">
                            {file.status !== 'deleted' && (
                              <>
                                {file.linesAdded > 0 && (
                                  <span className="text-green-600">+{file.linesAdded}</span>
                                )}
                                {file.linesAdded > 0 && file.linesRemoved > 0 && ' '}
                                {file.linesRemoved > 0 && (
                                  <span className="text-red-600">-{file.linesRemoved}</span>
                                )}
                              </>
                            )}
                          </span>
                        </div>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            </Card>
          </ScrollArea>
        </div>

        {/* Action Buttons */}
        <DialogFooter className="flex-row gap-2 sm:justify-start">
          <Button
            onClick={() => {
              onResume(task.id);
              setOpen(false);
            }}
            className="flex-1"
          >
            <PlayCircle className="h-4 w-4 mr-2" />
            Resume Task
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onViewDetails(task.id);
            }}
          >
            <Eye className="h-4 w-4 mr-2" />
            View Details
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              onAbandon(task.id);
              setOpen(false);
            }}
          >
            <XCircle className="h-4 w-4 mr-2" />
            Abandon
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
