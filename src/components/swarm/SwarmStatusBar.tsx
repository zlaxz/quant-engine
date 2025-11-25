/**
 * SwarmStatusBar - Compact inline status bar for active swarm jobs
 *
 * Shows in the chat area when a swarm job is active, replacing the loading spinner.
 * Expands to full SwarmMonitor on click.
 */

import React, { useState } from 'react';
import { Loader2, ChevronDown, ChevronUp, CheckCircle, AlertCircle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SwarmMonitor } from './SwarmMonitor';
import type { SwarmProgress, SwarmStatus } from '@/lib/swarmClient';

interface SwarmStatusBarProps {
  jobId: string;
  objective: string;
  progress: SwarmProgress;
  onComplete?: (synthesis: string | null) => void;
  className?: string;
}

const STATUS_ICONS: Record<SwarmStatus, React.ReactNode> = {
  pending: <Loader2 className="w-4 h-4 animate-spin text-gray-500" />,
  processing: <Loader2 className="w-4 h-4 animate-spin text-yellow-500" />,
  completed: <CheckCircle className="w-4 h-4 text-green-500" />,
  failed: <AlertCircle className="w-4 h-4 text-red-500" />,
  cancelled: <AlertCircle className="w-4 h-4 text-gray-500" />,
};

export function SwarmStatusBar({
  jobId,
  objective,
  progress,
  onComplete,
  className,
}: SwarmStatusBarProps) {
  const [expanded, setExpanded] = useState(false);

  // Compact bar
  if (!expanded) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 p-3 rounded-lg border bg-card',
          'cursor-pointer hover:bg-muted/50 transition-colors',
          className
        )}
        onClick={() => setExpanded(true)}
      >
        {STATUS_ICONS[progress.status]}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              Swarm: {progress.totalTasks} agents
            </span>
            <Badge variant="outline" className="text-xs">
              {progress.progressPct}%
            </Badge>
          </div>
          <div className="flex items-center gap-1 mt-1">
            <Progress value={progress.progressPct} className="h-1 flex-1" />
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="text-green-500">{progress.completedTasks}</span>
          <span>/</span>
          <span>{progress.totalTasks}</span>
          <ChevronDown className="w-4 h-4" />
        </div>
      </div>
    );
  }

  // Expanded view
  return (
    <div className={cn('space-y-2', className)}>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-between"
        onClick={() => setExpanded(false)}
      >
        <span className="text-sm">Swarm Monitor</span>
        <ChevronUp className="w-4 h-4" />
      </Button>

      <SwarmMonitor
        jobId={jobId}
        objective={objective}
        onComplete={onComplete}
        onClose={() => setExpanded(false)}
      />
    </div>
  );
}

export default SwarmStatusBar;
