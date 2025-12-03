/**
 * ClaudeCodeCommandPreview - Shows what Claude Code did in plain English
 * Provides transparency into prompts, context, and files included
 */

import { Terminal, FileCode, Copy, Check, ChevronDown, Eye, EyeOff, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
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

/**
 * Parse a technical task into plain English summary
 */
function parseTaskToPlainEnglish(task: string): string {
  const taskLower = task.toLowerCase();

  // Detect common task patterns and return friendly summary
  if (taskLower.includes('spawn') && taskLower.includes('agent')) {
    return "Spawned AI agents to work on subtasks";
  }
  if (taskLower.includes('backtest')) {
    return "Ran a backtest on a trading strategy";
  }
  if (taskLower.includes('analyze') || taskLower.includes('audit')) {
    return "Analyzed code or data";
  }
  if (taskLower.includes('read') && taskLower.includes('file')) {
    return "Read and examined files";
  }
  if (taskLower.includes('write') || taskLower.includes('create')) {
    return "Created or modified files";
  }
  if (taskLower.includes('python') || taskLower.includes('script')) {
    return "Ran Python scripts";
  }
  if (taskLower.includes('test') || taskLower.includes('validate')) {
    return "Ran tests or validation";
  }
  if (taskLower.includes('generate') || taskLower.includes('implement')) {
    return "Generated new code";
  }
  if (taskLower.includes('search') || taskLower.includes('find')) {
    return "Searched through codebase";
  }
  
  // Default summary
  return "Executed a technical task";
}

export function ClaudeCodeCommandPreview({ command, status = 'pending', className }: ClaudeCodeCommandPreviewProps) {
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(command.task);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusConfig = {
    pending: { 
      color: 'border-l-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20',
      label: 'Waiting',
      icon: Clock,
      iconColor: 'text-yellow-500'
    },
    running: { 
      color: 'border-l-purple-500 bg-purple-50/50 dark:bg-purple-950/20',
      label: 'Running',
      icon: Loader2,
      iconColor: 'text-purple-500'
    },
    completed: { 
      color: 'border-l-green-500 bg-green-50/50 dark:bg-green-950/20',
      label: 'Done',
      icon: CheckCircle,
      iconColor: 'text-green-500'
    },
    failed: { 
      color: 'border-l-red-500 bg-red-50/50 dark:bg-red-950/20',
      label: 'Failed',
      icon: XCircle,
      iconColor: 'text-red-500'
    }
  };

  const config = statusConfig[status];
  const plainEnglishSummary = parseTaskToPlainEnglish(command.task);
  const StatusIcon = config.icon;

  return (
    <Card className={cn('border-l-4 shadow-sm', config.color, className)}>
      <div className="p-3 space-y-2">
        {/* Header with plain English */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <StatusIcon className={cn(
              'h-4 w-4 mt-0.5 flex-shrink-0',
              config.iconColor,
              status === 'running' && 'animate-spin'
            )} />
            <div className="space-y-0.5">
              <div className="text-sm font-medium">{plainEnglishSummary}</div>
              <div className="text-[10px] text-muted-foreground">
                {new Date(command.timestamp).toLocaleTimeString()} • {config.label}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setShowRaw(!showRaw)}
              title={showRaw ? 'Hide details' : 'Show details'}
            >
              {showRaw ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={copyToClipboard}
              title="Copy raw command"
            >
              {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
        </div>

        {/* Files accessed (simplified) */}
        {command.files && command.files.length > 0 && (
          <div className="text-[10px] text-muted-foreground">
            📁 Accessed {command.files.length} file{command.files.length > 1 ? 's' : ''}
            {command.files.length <= 3 && (
              <span className="ml-1">
                ({command.files.map(f => f.split('/').pop()).join(', ')})
              </span>
            )}
          </div>
        )}

        {/* Raw task (hidden by default) */}
        {showRaw && (
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="flex items-center gap-2 text-[10px] text-muted-foreground hover:text-foreground w-full">
              <Terminal className="h-3 w-3" />
              <span>Technical details</span>
              <ChevronDown className="h-3 w-3 ml-auto" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="bg-muted/50 rounded p-2 max-h-32 overflow-y-auto">
                <pre className="text-[10px] font-mono whitespace-pre-wrap break-words text-muted-foreground">
                  {command.task}
                </pre>
              </div>
              {command.files && command.files.length > 0 && (
                <div className="mt-2 bg-muted/50 rounded p-2 space-y-1">
                  <div className="text-[10px] font-medium text-muted-foreground">Files:</div>
                  {command.files.map((file, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-[10px]">
                      <FileCode className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <code className="font-mono truncate text-muted-foreground">{file}</code>
                    </div>
                  ))}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
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
        No Claude Code activity yet
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="text-xs font-semibold text-muted-foreground mb-2">
        What Claude Code Did ({commands.length} task{commands.length > 1 ? 's' : ''})
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
