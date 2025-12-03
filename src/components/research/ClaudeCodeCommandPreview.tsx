/**
 * ClaudeCodeCommandPreview - Shows the exact command being sent to Claude Code
 * Provides transparency into prompts, context, and files included
 */

import { Terminal, FileCode, Copy, Check, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export interface ClaudeCodeCommand {
  id: string;
  task: string;
  context?: string;
  files?: string[];
  timestamp: number;
  model?: string;
  timeout?: number;
}

interface ClaudeCodeCommandPreviewProps {
  command: ClaudeCodeCommand;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  className?: string;
}

export function ClaudeCodeCommandPreview({ command, status = 'pending', className }: ClaudeCodeCommandPreviewProps) {
  const [copied, setCopied] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [showContext, setShowContext] = useState(false);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(command.task);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusColors = {
    pending: 'border-l-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20',
    running: 'border-l-purple-500 bg-purple-50/50 dark:bg-purple-950/20',
    completed: 'border-l-green-500 bg-green-50/50 dark:bg-green-950/20',
    failed: 'border-l-red-500 bg-red-50/50 dark:bg-red-950/20'
  };

  const statusLabels = {
    pending: 'Queued',
    running: 'Executing',
    completed: 'Complete',
    failed: 'Failed'
  };

  // Truncate task for preview
  const taskPreview = command.task.length > 150 
    ? command.task.substring(0, 150) + '...' 
    : command.task;

  return (
    <Card className={cn('border-l-4 shadow-sm', statusColors[status], className)}>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded bg-muted">
              <Terminal className="h-4 w-4 text-muted-foreground" />
            </div>
            <span className="text-xs font-semibold">Claude Code Command</span>
            <Badge 
              variant="secondary" 
              className={cn(
                'text-[10px] px-1.5 h-5',
                status === 'running' && 'animate-pulse'
              )}
            >
              {statusLabels[status]}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setShowFull(!showFull)}
              title={showFull ? 'Collapse' : 'Expand'}
            >
              {showFull ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={copyToClipboard}
              title="Copy command"
            >
              {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
        </div>

        {/* Task/Prompt */}
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            Task Prompt
          </div>
          <div className="bg-background border rounded p-2 font-mono text-xs">
            {showFull ? (
              <pre className="whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
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
              <FileCode className="h-3 w-3" />
              <span>{command.files.length} context file{command.files.length > 1 ? 's' : ''}</span>
              <ChevronDown className="h-3 w-3 ml-auto" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="bg-muted/50 rounded p-2 space-y-1">
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
              <span>Additional context included</span>
              <ChevronDown className={cn('h-3 w-3 ml-auto transition-transform', showContext && 'rotate-180')} />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="bg-muted/50 rounded p-2 max-h-32 overflow-y-auto">
                <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                  {command.context}
                </pre>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Metadata Footer */}
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1 border-t">
          <span className="font-mono">
            {new Date(command.timestamp).toLocaleTimeString()}
          </span>
          {command.model && (
            <Badge variant="outline" className="text-[10px] h-4 px-1">
              {command.model}
            </Badge>
          )}
          {command.timeout && (
            <span>timeout: {command.timeout / 1000}s</span>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * History of Claude Code commands for review
 */
interface ClaudeCodeHistoryProps {
  commands: ClaudeCodeCommand[];
  className?: string;
}

export function ClaudeCodeHistory({ commands, className }: ClaudeCodeHistoryProps) {
  if (commands.length === 0) {
    return (
      <div className={cn('text-xs text-muted-foreground text-center py-4', className)}>
        No Claude Code commands yet this session
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="text-xs font-semibold text-muted-foreground mb-2">
        Claude Code Command History ({commands.length})
      </div>
      {commands.map((cmd) => (
        <ClaudeCodeCommandPreview 
          key={cmd.id} 
          command={cmd} 
          status="completed"
        />
      ))}
    </div>
  );
}
