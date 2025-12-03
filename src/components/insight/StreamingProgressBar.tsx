/**
 * StreamingProgressBar - Shows real-time streaming progress
 */

import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface StreamingProgressBarProps {
  isStreaming: boolean;
  tokensReceived?: number;
  estimatedTotal?: number;
  thinkingActive?: boolean;
  className?: string;
}

export function StreamingProgressBar({
  isStreaming,
  tokensReceived = 0,
  estimatedTotal = 4096,
  thinkingActive = false,
  className,
}: StreamingProgressBarProps) {
  if (!isStreaming) return null;

  const progress = estimatedTotal > 0 
    ? Math.min((tokensReceived / estimatedTotal) * 100, 100) 
    : 0;

  return (
    <div className={cn('rounded-lg border bg-card p-3 space-y-2', className)}>
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
          <span className="text-muted-foreground">
            {thinkingActive ? 'Thinking...' : 'Streaming response...'}
          </span>
        </div>
        <span className="font-mono text-muted-foreground">
          ~{tokensReceived.toLocaleString()} tokens
        </span>
      </div>
      
      <Progress value={progress} className="h-1.5" />
      
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{thinkingActive ? 'Reasoning' : 'Generating'}</span>
        <span>{Math.round(progress)}%</span>
      </div>
    </div>
  );
}
