/**
 * ClaudeCodePendingPreview - Shows command preview BEFORE execution with approval flow
 */

import { Terminal, FileCode, ChevronDown, Check, X, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export interface PendingClaudeCodeCommand {
  id: string;
  task: string;
  context?: string;
  files?: string[];
  parallelHint?: 'none' | 'minor' | 'massive';
  timestamp: number;
}

interface ClaudeCodePendingPreviewProps {
  command: PendingClaudeCodeCommand;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  className?: string;
}

export function ClaudeCodePendingPreview({ 
  command, 
  onApprove, 
  onReject,
  className 
}: ClaudeCodePendingPreviewProps) {
  const [showFullTask, setShowFullTask] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  const handleApprove = () => {
    setIsApproving(true);
    onApprove(command.id);
  };

  // Truncate task for preview
  const taskPreview = command.task.length > 200 
    ? command.task.substring(0, 200) + '...' 
    : command.task;

  const parallelLabels = {
    none: null,
    minor: { label: 'Minor Parallel', color: 'bg-blue-500/20 text-blue-400' },
    massive: { label: 'MASSIVE Parallel', color: 'bg-orange-500/20 text-orange-400' }
  };

  const parallelInfo = command.parallelHint ? parallelLabels[command.parallelHint] : null;

  return (
    <Card className={cn(
      'border-l-4 border-l-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20 shadow-md animate-pulse-subtle',
      className
    )}>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-yellow-500/20">
              <Terminal className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">Claude Code Command</span>
                <Badge variant="outline" className="text-[10px] px-1.5 h-5 bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 border-yellow-500/30">
                  Awaiting Approval
                </Badge>
              </div>
              <span className="text-[10px] text-muted-foreground">
                Review before execution
              </span>
            </div>
          </div>
          {parallelInfo && (
            <Badge className={cn('text-[10px] px-2', parallelInfo.color)}>
              {parallelInfo.label}
            </Badge>
          )}
        </div>

        {/* Warning Banner */}
        <div className="flex items-start gap-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-yellow-700 dark:text-yellow-300">
            <strong>Gemini wants to execute via Claude Code.</strong> This will spawn terminal sessions and may run Python scripts.
            {command.parallelHint === 'massive' && (
              <span className="block mt-1 text-orange-600 dark:text-orange-400">
                ⚠️ MASSIVE parallelization requested - multiple DeepSeek agents will be spawned.
              </span>
            )}
          </div>
        </div>

        {/* Task/Prompt */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Task to Execute
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[10px] px-2"
              onClick={() => setShowFullTask(!showFullTask)}
            >
              {showFullTask ? 'Collapse' : 'Expand'}
            </Button>
          </div>
          <div className="bg-background border rounded-lg p-3 font-mono text-xs">
            {showFullTask ? (
              <pre className="whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                {command.task}
              </pre>
            ) : (
              <span className="text-muted-foreground">{taskPreview}</span>
            )}
          </div>
        </div>

        {/* Context Files */}
        {command.files && command.files.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground w-full">
              <FileCode className="h-3.5 w-3.5" />
              <span>{command.files.length} context file{command.files.length > 1 ? 's' : ''} will be accessed</span>
              <ChevronDown className="h-3 w-3 ml-auto" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="bg-muted/50 rounded-lg p-2 space-y-1">
                {command.files.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    <FileCode className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    <code className="font-mono truncate">{file}</code>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Additional Context */}
        {command.context && (
          <Collapsible open={showContext} onOpenChange={setShowContext}>
            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground w-full">
              <span>Gemini's analysis context included</span>
              <ChevronDown className={cn('h-3 w-3 ml-auto transition-transform', showContext && 'rotate-180')} />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="bg-muted/50 rounded-lg p-2 max-h-32 overflow-y-auto">
                <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                  {command.context}
                </pre>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onReject(command.id)}
            className="gap-1.5"
            disabled={isApproving}
          >
            <X className="h-3.5 w-3.5" />
            Reject
          </Button>
          <Button
            size="sm"
            onClick={handleApprove}
            className="gap-1.5 bg-green-600 hover:bg-green-700"
            disabled={isApproving}
          >
            {isApproving ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Executing...
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                Approve & Execute
              </>
            )}
          </Button>
        </div>

        {/* Timestamp */}
        <div className="text-[10px] text-muted-foreground text-center">
          Queued at {new Date(command.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </Card>
  );
}
