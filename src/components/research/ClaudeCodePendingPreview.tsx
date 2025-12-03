/**
 * ClaudeCodePendingPreview - Shows command preview BEFORE execution with approval flow
 * Displays in plain English for non-technical users
 */

import { Terminal, ChevronDown, Check, X, AlertCircle, Brain, Zap, Users } from 'lucide-react';
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

/**
 * Parse a technical task into plain English summary
 */
function parseTaskToPlainEnglish(task: string): { summary: string; actions: string[]; risks: string[] } {
  const actions: string[] = [];
  const risks: string[] = [];
  let summary = "Gemini wants Claude Code to help with a task";

  // Detect common task patterns
  const taskLower = task.toLowerCase();

  // Detect spawning agents
  if (taskLower.includes('spawn') || taskLower.includes('agent') || taskLower.includes('deepseek')) {
    actions.push("🤖 Spawn AI agents (like DeepSeek) to work on subtasks");
    risks.push("Multiple terminal windows may open");
  }

  // Detect backtesting
  if (taskLower.includes('backtest') || taskLower.includes('strategy')) {
    actions.push("📊 Run backtesting or strategy analysis");
    summary = "Gemini wants to run a backtest or analyze a trading strategy";
  }

  // Detect file operations
  if (taskLower.includes('read') || taskLower.includes('file') || taskLower.includes('open')) {
    actions.push("📁 Read and analyze code files");
  }
  if (taskLower.includes('write') || taskLower.includes('create') || taskLower.includes('modify')) {
    actions.push("✏️ Create or modify files");
    risks.push("Files on your computer may be changed");
  }

  // Detect Python execution
  if (taskLower.includes('python') || taskLower.includes('.py') || taskLower.includes('script')) {
    actions.push("🐍 Run Python scripts");
    risks.push("Python code will execute on your computer");
  }

  // Detect parallel/swarm operations
  if (taskLower.includes('parallel') || taskLower.includes('swarm') || taskLower.includes('concurrent')) {
    actions.push("⚡ Run multiple operations at the same time");
    risks.push("Several processes may run simultaneously");
  }

  // Detect analysis tasks
  if (taskLower.includes('analyze') || taskLower.includes('audit') || taskLower.includes('review')) {
    actions.push("🔍 Analyze and review code or data");
    summary = "Gemini wants to analyze something in detail";
  }

  // Detect code generation
  if (taskLower.includes('generate') || taskLower.includes('implement') || taskLower.includes('build')) {
    actions.push("🔨 Generate or build new code");
    summary = "Gemini wants to create or build something";
  }

  // Detect testing
  if (taskLower.includes('test') || taskLower.includes('validate') || taskLower.includes('verify')) {
    actions.push("✅ Run tests or validation checks");
  }

  // If no specific patterns detected, give generic summary
  if (actions.length === 0) {
    actions.push("💻 Execute a complex task that requires terminal access");
    summary = "Gemini needs Claude Code to help with a technical task";
  }

  return { summary, actions, risks };
}

export function ClaudeCodePendingPreview({ 
  command, 
  onApprove, 
  onReject,
  className 
}: ClaudeCodePendingPreviewProps) {
  const [showRawTask, setShowRawTask] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  const handleApprove = () => {
    setIsApproving(true);
    onApprove(command.id);
  };

  const parsed = parseTaskToPlainEnglish(command.task);
  const { summary, actions, risks } = parsed;

  const parallelDescriptions = {
    none: null,
    minor: { 
      label: 'Small Team', 
      description: 'A few AI helpers will work together',
      icon: Users,
      color: 'bg-blue-500/20 text-blue-400' 
    },
    massive: { 
      label: 'Large Team', 
      description: 'Many AI agents will be spawned (expect multiple terminal windows)',
      icon: Zap,
      color: 'bg-orange-500/20 text-orange-400' 
    }
  };

  const parallelInfo = command.parallelHint ? parallelDescriptions[command.parallelHint] : null;

  return (
    <Card className={cn(
      'border-l-4 border-l-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20 shadow-md',
      className
    )}>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-yellow-500/20">
              <Brain className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">Permission Request</span>
                <Badge variant="outline" className="text-[10px] px-1.5 h-5 bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 border-yellow-500/30">
                  Needs Your OK
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                Review what Gemini wants to do
              </span>
            </div>
          </div>
          {parallelInfo && (
            <Badge className={cn('text-[10px] px-2 gap-1', parallelInfo.color)}>
              <parallelInfo.icon className="h-3 w-3" />
              {parallelInfo.label}
            </Badge>
          )}
        </div>

        {/* Plain English Summary */}
        <div className="bg-background border rounded-lg p-3 space-y-3">
          <div className="text-sm font-medium">{summary}</div>
          
          {/* What will happen */}
          {actions.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">What will happen:</div>
              <ul className="space-y-1">
                {actions.map((action, idx) => (
                  <li key={idx} className="text-xs text-foreground/80 flex items-start gap-2">
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risks/Warnings */}
          {risks.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-orange-600 dark:text-orange-400">Heads up:</div>
              <ul className="space-y-1">
                {risks.map((risk, idx) => (
                  <li key={idx} className="text-xs text-orange-600/80 dark:text-orange-400/80 flex items-start gap-2">
                    <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Parallel team info */}
          {parallelInfo && (
            <div className="flex items-start gap-2 p-2 rounded bg-muted/50 text-xs">
              <parallelInfo.icon className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              <span>{parallelInfo.description}</span>
            </div>
          )}
        </div>

        {/* Files that will be accessed */}
        {command.files && command.files.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              📁 Files that will be accessed ({command.files.length}):
            </div>
            <div className="bg-muted/50 rounded-lg p-2 space-y-1 max-h-24 overflow-y-auto">
              {command.files.map((file, idx) => (
                <div key={idx} className="text-xs text-muted-foreground truncate">
                  {file.split('/').pop() || file}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Show raw task toggle */}
        <Collapsible open={showRawTask} onOpenChange={setShowRawTask}>
          <CollapsibleTrigger className="flex items-center gap-2 text-[10px] text-muted-foreground hover:text-foreground w-full">
            <Terminal className="h-3 w-3" />
            <span>Show technical details</span>
            <ChevronDown className={cn('h-3 w-3 ml-auto transition-transform', showRawTask && 'rotate-180')} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <div className="bg-muted/50 rounded-lg p-2 max-h-32 overflow-y-auto">
              <pre className="text-[10px] font-mono whitespace-pre-wrap break-words text-muted-foreground">
                {command.task}
              </pre>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t">
          <span className="text-[10px] text-muted-foreground">
            Requested at {new Date(command.timestamp).toLocaleTimeString()}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onReject(command.id)}
              className="gap-1.5"
              disabled={isApproving}
            >
              <X className="h-3.5 w-3.5" />
              No, Cancel
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
                  Running...
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Yes, Do It
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
