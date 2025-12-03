/**
 * ToolCallTreeLive - Real-time hierarchical display of tool calls
 * Shows what CIO is doing right now
 */

import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, FileCode, FolderOpen, Code2, Database, Search, Wrench, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export interface LiveToolCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'running' | 'success' | 'error';
  children?: LiveToolCall[];
  timestamp: number;
  duration?: number;
  error?: string;
}

interface ToolCallTreeLiveProps {
  calls: LiveToolCall[];
  className?: string;
}

function getToolIcon(tool: string, status: string) {
  const iconClass = cn(
    'h-3 w-3',
    status === 'running' && 'animate-pulse',
    status === 'error' && 'text-destructive',
    status === 'success' && 'text-green-500'
  );

  if (tool.includes('file') || tool.includes('read') || tool.includes('write')) {
    return <FileCode className={iconClass} />;
  }
  if (tool.includes('dir') || tool.includes('list')) {
    return <FolderOpen className={iconClass} />;
  }
  if (tool.includes('search') || tool.includes('query')) {
    return <Search className={iconClass} />;
  }
  if (tool.includes('database') || tool.includes('sql')) {
    return <Database className={iconClass} />;
  }
  return <Wrench className={iconClass} />;
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3 w-3 animate-spin text-primary" />;
    case 'success':
      return <CheckCircle2 className="h-3 w-3 text-green-500" />;
    case 'error':
      return <XCircle className="h-3 w-3 text-destructive" />;
    default:
      return <div className="h-3 w-3 rounded-full bg-muted" />;
  }
}

function ToolCallNode({ call, depth = 0 }: { call: LiveToolCall; depth?: number }) {
  const [isExpanded, setIsExpanded] = useState(depth < 2 || call.status === 'running');
  const hasChildren = call.children && call.children.length > 0;

  // Auto-expand running calls
  useEffect(() => {
    if (call.status === 'running') {
      setIsExpanded(true);
    }
  }, [call.status]);

  const formatArg = (_key: string, value: unknown): string => {
    if (typeof value === 'string') {
      return value.length > 40 ? value.substring(0, 40) + '...' : value;
    }
    const str = JSON.stringify(value);
    return str.length > 40 ? str.substring(0, 40) + '...' : str;
  };

  return (
    <div className="space-y-1">
      <div
        className={cn(
          'flex items-start gap-2 p-2 rounded-md transition-colors cursor-pointer',
          'hover:bg-muted/50',
          call.status === 'running' && 'bg-primary/5 border-l-2 border-l-primary',
          call.status === 'error' && 'bg-destructive/5 border-l-2 border-l-destructive',
          call.status === 'success' && 'bg-green-500/5'
        )}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
      >
        {/* Expand/collapse */}
        {hasChildren ? (
          <button className="mt-0.5">
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        ) : (
          <div className="w-3" />
        )}

        {/* Status icon */}
        {getStatusIcon(call.status)}

        {/* Tool icon */}
        {getToolIcon(call.tool, call.status)}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs font-mono font-medium">{call.tool}</code>
            {call.duration && (
              <span className="text-xs text-muted-foreground">
                {call.duration}ms
              </span>
            )}
            {call.status === 'error' && (
              <Badge variant="destructive" className="text-xs h-4">
                Failed
              </Badge>
            )}
          </div>

          {/* Arguments preview */}
          {Object.keys(call.args).length > 0 && (
            <div className="text-xs text-muted-foreground mt-1 space-x-2">
              {Object.entries(call.args).slice(0, 3).map(([key, value]) => (
                <span key={key}>
                  <span className="text-foreground/60">{key}:</span>{' '}
                  <span className="font-mono">{formatArg(key, value)}</span>
                </span>
              ))}
              {Object.keys(call.args).length > 3 && (
                <span className="text-foreground/40">+{Object.keys(call.args).length - 3} more</span>
              )}
            </div>
          )}

          {/* Error message */}
          {call.error && (
            <p className="text-xs text-destructive mt-1 line-clamp-2">
              {call.error}
            </p>
          )}
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="space-y-1">
          {call.children!.map((child) => (
            <ToolCallNode key={child.id} call={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ToolCallTreeLive({ calls, className }: ToolCallTreeLiveProps) {
  const runningCount = calls.filter(c => c.status === 'running').length;
  const completedCount = calls.filter(c => c.status === 'success').length;
  const errorCount = calls.filter(c => c.status === 'error').length;

  return (
    <div className={cn('rounded-lg border bg-card p-3 flex flex-col', className)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold">Tool Calls</h4>
        </div>
        <div className="flex items-center gap-2">
          {runningCount > 0 && (
            <Badge variant="secondary" className="text-xs gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {runningCount}
            </Badge>
          )}
          {completedCount > 0 && (
            <Badge variant="secondary" className="text-xs gap-1 bg-green-500/10 text-green-600">
              <CheckCircle2 className="h-3 w-3" />
              {completedCount}
            </Badge>
          )}
          {errorCount > 0 && (
            <Badge variant="destructive" className="text-xs gap-1">
              <XCircle className="h-3 w-3" />
              {errorCount}
            </Badge>
          )}
        </div>
      </div>

      {calls.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-8">
          <p>No tool calls in progress</p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-1 pr-2">
            {calls.map((call) => (
              <ToolCallNode key={call.id} call={call} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
