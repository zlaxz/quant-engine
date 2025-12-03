/**
 * ContextWindowIndicator - Shows how much of the context window is being used
 */

import { cn } from '@/lib/utils';
import { AlertTriangle, Database, MessageSquare, Brain } from 'lucide-react';

interface ContextUsage {
  systemPrompt: number;
  conversationHistory: number;
  memoryContext: number;
  currentMessage: number;
}

interface ContextWindowIndicatorProps {
  usage: ContextUsage;
  maxTokens?: number;
  className?: string;
}

export function ContextWindowIndicator({
  usage,
  maxTokens = 128000,
  className,
}: ContextWindowIndicatorProps) {
  const totalUsed = usage.systemPrompt + usage.conversationHistory + usage.memoryContext + usage.currentMessage;
  const percentUsed = (totalUsed / maxTokens) * 100;
  const isWarning = percentUsed > 70;
  const isCritical = percentUsed > 90;

  const segments = [
    { label: 'System', value: usage.systemPrompt, color: 'bg-blue-500', icon: Database },
    { label: 'History', value: usage.conversationHistory, color: 'bg-purple-500', icon: MessageSquare },
    { label: 'Memory', value: usage.memoryContext, color: 'bg-cyan-500', icon: Brain },
    { label: 'Current', value: usage.currentMessage, color: 'bg-green-500', icon: MessageSquare },
  ];

  return (
    <div className={cn('rounded-lg border bg-card p-3 space-y-3', className)}>
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <Database className="h-3 w-3" />
          Context Window
        </h4>
        <div className="flex items-center gap-1.5">
          {(isWarning || isCritical) && (
            <AlertTriangle className={cn(
              'h-3 w-3',
              isCritical ? 'text-destructive' : 'text-yellow-500'
            )} />
          )}
          <span className={cn(
            'text-xs font-mono',
            isCritical ? 'text-destructive' : isWarning ? 'text-yellow-500' : 'text-muted-foreground'
          )}>
            {totalUsed.toLocaleString()} / {(maxTokens / 1000).toFixed(0)}K
          </span>
        </div>
      </div>

      {/* Stacked progress bar */}
      <div className="h-2 bg-muted rounded-full overflow-hidden flex">
        {segments.map((seg) => (
          <div
            key={seg.label}
            className={cn(seg.color, 'transition-all duration-300')}
            style={{ width: `${(seg.value / maxTokens) * 100}%` }}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-2">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5 text-xs">
            <div className={cn('w-2 h-2 rounded-full', seg.color)} />
            <seg.icon className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">{seg.label}:</span>
            <span className="font-mono">{(seg.value / 1000).toFixed(1)}K</span>
          </div>
        ))}
      </div>

      {isCritical && (
        <p className="text-xs text-destructive">
          Context nearly full. History will be truncated.
        </p>
      )}
    </div>
  );
}
