/**
 * Status Strip - Always visible top bar showing current research stage and progress
 */

import { useResearchDisplay } from '@/contexts/ResearchDisplayContext';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Clock, Activity } from 'lucide-react';
import { useEffect, useState } from 'react';

const stageLabels: Record<string, string> = {
  idle: 'Ready',
  regime_mapping: 'Mapping Market Regimes',
  strategy_discovery: 'Discovering Strategies',
  backtesting: 'Running Backtests',
  tuning: 'Optimizing Parameters',
  analysis: 'Analyzing Results',
  portfolio: 'Building Portfolio',
  conclusion: 'Synthesizing Findings',
};

export const StatusStrip = () => {
  const { state } = useResearchDisplay();
  const [elapsedTime, setElapsedTime] = useState<string>('');

  useEffect(() => {
    if (!state.operationStartTime || !state.currentOperation) {
      setElapsedTime('');
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Date.now() - state.operationStartTime!;
      const seconds = Math.floor(elapsed / 1000);
      const minutes = Math.floor(seconds / 60);
      
      if (minutes > 0) {
        setElapsedTime(`${minutes}m ${seconds % 60}s`);
      } else {
        setElapsedTime(`${seconds}s`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [state.operationStartTime, state.currentOperation]);

  const stageLabel = stageLabels[state.currentStage] || state.currentStage;
  const isActive = state.currentStage !== 'idle' || state.currentOperation;

  // Hide status strip when idle with no operation
  if (state.currentStage === 'idle' && !state.currentOperation) {
    return null;
  }

  return (
    <div className="h-10 border-b border-border bg-muted/30 px-4 flex items-center gap-4">
      {/* Current Stage */}
      <div className="flex items-center gap-2">
        <Activity className={`h-4 w-4 ${isActive ? 'animate-pulse text-primary' : 'text-muted-foreground'}`} />
        <span className="text-sm font-medium">{stageLabel}</span>
      </div>

      {/* Current Operation */}
      {state.currentOperation && (
        <>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm text-muted-foreground truncate">
              {state.currentOperation}
            </span>
            {elapsedTime && (
              <Badge variant="outline" className="gap-1 whitespace-nowrap">
                <Clock className="h-3 w-3" />
                {elapsedTime}
              </Badge>
            )}
          </div>
        </>
      )}

      {/* Progress Bar */}
      {state.progress.percent > 0 && (
        <div className="flex items-center gap-2 w-48">
          <Progress value={state.progress.percent} className="h-2" />
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {Math.round(state.progress.percent)}%
          </span>
        </div>
      )}

      {/* Progress Message */}
      {state.progress.message && (
        <span className="text-xs text-muted-foreground italic">
          {state.progress.message}
        </span>
      )}
    </div>
  );
};
