/**
 * OperationProgress - Enhanced streaming progress bar for long operations
 * 
 * Features:
 * - Percentage complete
 * - Elapsed time
 * - ETA calculation
 * - Sub-task breakdown
 * - Color-coded phases
 */

import { Clock, TrendingUp, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface OperationPhase {
  name: string;
  progress: number; // 0-100
  status: 'pending' | 'active' | 'completed';
  eta?: number; // seconds
}

interface OperationProgressProps {
  title: string;
  phases: OperationPhase[];
  startTime: number;
  className?: string;
}

export function OperationProgress({ title, phases, startTime, className }: OperationProgressProps) {
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsed = Math.floor((currentTime - startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  const totalProgress = phases.reduce((sum, p) => sum + p.progress, 0) / phases.length;
  const activePhase = phases.find(p => p.status === 'active');
  const completedCount = phases.filter(p => p.status === 'completed').length;

  return (
    <Card className={cn('p-4 border-l-4 border-l-blue-500', className)}>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h4 className="text-sm font-semibold">{title}</h4>
            {activePhase && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {activePhase.name}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{minutes}:{seconds.toString().padStart(2, '0')}</span>
          </div>
        </div>

        {/* Overall Progress */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Overall Progress</span>
            <span>{Math.round(totalProgress)}%</span>
          </div>
          <Progress value={totalProgress} className="h-2" />
        </div>

        {/* Phase Breakdown */}
        <div className="space-y-2">
          {phases.map((phase, idx) => (
            <div
              key={idx}
              className={cn(
                'flex items-center gap-2 p-2 rounded-md transition-colors',
                phase.status === 'active' && 'bg-blue-50 dark:bg-blue-950/20',
                phase.status === 'completed' && 'bg-green-50 dark:bg-green-950/20'
              )}
            >
              {phase.status === 'completed' && (
                <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                  <span className="text-white text-xs">✓</span>
                </div>
              )}
              {phase.status === 'active' && (
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin shrink-0" />
              )}
              {phase.status === 'pending' && (
                <div className="w-5 h-5 rounded-full border-2 border-muted shrink-0" />
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{phase.name}</span>
                  {phase.status === 'active' && (
                    <Badge variant="secondary" className="text-xs h-4">
                      {phase.progress}%
                    </Badge>
                  )}
                </div>
                {phase.status === 'active' && (
                  <Progress value={phase.progress} className="h-1 mt-1" />
                )}
              </div>

              {phase.eta && phase.status === 'active' && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <TrendingUp className="h-3 w-3" />
                  <span>{phase.eta}s</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
          <span>{completedCount}/{phases.length} phases complete</span>
          {activePhase?.eta && (
            <span>~{activePhase.eta}s remaining</span>
          )}
        </div>
      </div>
    </Card>
  );
}
