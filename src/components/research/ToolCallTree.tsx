/**
 * ToolCallTree - Hierarchical display of nested tool calls
 * 
 * Shows tool call chains like: spawn_agent → read_file → analyze
 */

import { ChevronRight, FolderOpen, FileCode, Code2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface ToolCall {
  id: string;
  tool: string;
  args: Record<string, any>;
  result?: any;
  children?: ToolCall[];
  timestamp: number;
  duration?: number;
  success?: boolean;
}

interface ToolCallTreeProps {
  calls: ToolCall[];
  className?: string;
}

function getToolIcon(tool: string) {
  if (tool.includes('file') || tool.includes('read') || tool.includes('write')) {
    return <FileCode className="h-3 w-3" />;
  }
  if (tool.includes('dir') || tool.includes('list')) {
    return <FolderOpen className="h-3 w-3" />;
  }
  return <Code2 className="h-3 w-3" />;
}

function ToolCallNode({ call, depth = 0 }: { call: ToolCall; depth?: number }) {
  const [isExpanded, setIsExpanded] = useState(depth < 2); // Auto-expand first 2 levels

  const hasChildren = call.children && call.children.length > 0;
  const paddingLeft = depth * 20;

  return (
    <div className="space-y-1">
      <div
        className={cn(
          'flex items-start gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer',
          call.success === false && 'bg-red-50 dark:bg-red-950/20'
        )}
        style={{ paddingLeft }}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
      >
        {hasChildren && (
          <ChevronRight
            className={cn(
              'h-4 w-4 mt-0.5 shrink-0 transition-transform',
              isExpanded && 'rotate-90'
            )}
          />
        )}
        {!hasChildren && <div className="w-4" />}

        {getToolIcon(call.tool)}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono font-medium">{call.tool}</code>
            {call.duration && (
              <span className="text-xs text-muted-foreground">
                {call.duration}ms
              </span>
            )}
            {call.success === false && (
              <Badge variant="destructive" className="text-xs h-4">
                Failed
              </Badge>
            )}
          </div>
          
          {Object.keys(call.args).length > 0 && (
            <div className="text-xs text-muted-foreground mt-1">
              {Object.entries(call.args).map(([key, value]) => (
                <span key={key} className="mr-2">
                  <span className="text-foreground/60">{key}:</span>{' '}
                  <span className="font-mono">
                    {typeof value === 'string' && value.length > 30
                      ? value.substring(0, 30) + '...'
                      : JSON.stringify(value)}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

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

export function ToolCallTree({ calls, className }: ToolCallTreeProps) {
  if (calls.length === 0) return null;

  return (
    <div className={cn('rounded-lg border bg-card p-3', className)}>
      <h4 className="text-xs font-semibold text-muted-foreground mb-2">Tool Call Chain</h4>
      <div className="space-y-1">
        {calls.map((call) => (
          <ToolCallNode key={call.id} call={call} />
        ))}
      </div>
    </div>
  );
}
