/**
 * ClaudeCodeProgressPanel - Shows real-time execution progress for Claude Code
 * Displays phases, live timer, and progress indication
 */

import { Loader2, Clock, CheckCircle2, Circle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

export type ClaudeCodePhase = 'analyzing' | 'generating' | 'testing' | 'finalizing';

export interface ClaudeCodeProgressData {
  task: string;
  phase: ClaudeCodePhase;
  progress: number;
  startTime: number;
  estimatedRemaining?: number;
}

interface ClaudeCodeProgressPanelProps {
  data: ClaudeCodeProgressData;
  onCancel?: () => void;
  className?: string;
}

const PHASE_LABELS: Record<ClaudeCodePhase, string> = {
  analyzing: 'Analyzing Requirements',
  generating: 'Generating Code',
  testing: 'Running Tests',
  finalizing: 'Finalizing & Validating'
};

const PHASE_ORDER: ClaudeCodePhase[] = ['analyzing', 'generating', 'testing', 'finalizing'];

function PhaseIndicator({ 
  phase, 
  currentPhase, 
  label 
}: { 
  phase: ClaudeCodePhase; 
  currentPhase: ClaudeCodePhase; 
  label: string;
}) {
  const currentIndex = PHASE_ORDER.indexOf(currentPhase);
  const phaseIndex = PHASE_ORDER.indexOf(phase);
  
  const isComplete = phaseIndex < currentIndex;
  const isCurrent = phase === currentPhase;
  const isPending = phaseIndex > currentIndex;

  return (
    <div className={cn(
      'flex items-center gap-2 text-xs transition-all',
      isCurrent && 'font-medium',
      isComplete && 'text-green-600 dark:text-green-400',
      isPending && 'text-muted-foreground'
    )}>
      {isComplete && <CheckCircle2 className="h-3.5 w-3.5" />}
      {isCurrent && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {isPending && <Circle className="h-3.5 w-3.5" />}
      <span>{label}</span>
      {isComplete && <span className="text-xs">✓</span>}
    </div>
  );
}

export function ClaudeCodeProgressPanel({ data, onCancel, className }: ClaudeCodeProgressPanelProps) {
  const [elapsed, setElapsed] = useState(0);

  // Update elapsed time every 100ms
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - data.startTime);
    }, 100);

    return () => clearInterval(interval);
  }, [data.startTime]);

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    return `${seconds}s`;
  };

  return (
    <Card className={cn('border-l-4 border-l-purple-500 shadow-md', className)}>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="p-2 rounded bg-purple-100 dark:bg-purple-900/30">
              <Loader2 className="h-5 w-5 text-purple-600 dark:text-purple-400 animate-spin" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-semibold text-sm">Delegating to Claude Code</h4>
                <Badge variant="secondary" className="text-xs">
                  {PHASE_LABELS[data.phase]}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground truncate" title={data.task}>
                {data.task}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0">
            <Clock className="h-3 w-3" />
            <span className="font-mono">{formatTime(elapsed)}</span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <Progress value={data.progress} className="h-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{Math.round(data.progress)}% Complete</span>
            {data.estimatedRemaining && (
              <span>~{formatTime(data.estimatedRemaining)} remaining</span>
            )}
          </div>
        </div>

        {/* Phase Breakdown */}
        <div className="space-y-2 bg-muted/30 rounded p-3">
          <div className="text-xs font-semibold text-muted-foreground mb-2">
            Execution Phases:
          </div>
          {PHASE_ORDER.map((phase) => (
            <PhaseIndicator
              key={phase}
              phase={phase}
              currentPhase={data.phase}
              label={PHASE_LABELS[phase]}
            />
          ))}
        </div>

        {/* Cancel Button */}
        {onCancel && (
          <Button
            onClick={onCancel}
            variant="ghost"
            size="sm"
            className="w-full"
          >
            Cancel Execution
          </Button>
        )}
      </div>
    </Card>
  );
}
