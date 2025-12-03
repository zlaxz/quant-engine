/**
 * Enhanced Status Strip - Shows current operation, queue status, and Mission Control access
 */

import { useResearchDisplay } from '@/contexts/ResearchDisplayContext';
import { useMissionControl } from '@/contexts/MissionControlContext';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, Activity, ListOrdered, AlertCircle, ChevronRight, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

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

export const StatusStripEnhanced = () => {
  const { state: researchState } = useResearchDisplay();
  const { state: missionState, toggleExpanded } = useMissionControl();
  const [elapsedTime, setElapsedTime] = useState<string>('');

  useEffect(() => {
    if (!researchState.operationStartTime || !researchState.currentOperation) {
      setElapsedTime('');
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Date.now() - researchState.operationStartTime!;
      const seconds = Math.floor(elapsed / 1000);
      const minutes = Math.floor(seconds / 60);
      
      if (minutes > 0) {
        setElapsedTime(`${minutes}m ${seconds % 60}s`);
      } else {
        setElapsedTime(`${seconds}s`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [researchState.operationStartTime, researchState.currentOperation]);

  const stageLabel = stageLabels[researchState.currentStage] || researchState.currentStage;
  const isActive = researchState.currentStage !== 'idle' || researchState.currentOperation;
  
  const pendingCount = missionState.pendingApprovals.length;
  const queueCount = missionState.operationQueue.length;
  const hasQueue = pendingCount > 0 || queueCount > 0 || missionState.currentOperation;

  const handleOpenMissionControl = async () => {
    await window.electron?.popoutCreate?.({
      id: 'mission-control',
      title: 'Mission Control',
      visualizationType: 'mission-control',
      data: missionState,
      width: 450,
      height: 700,
    });
  };

  // Always show when there's activity or queue items
  if (researchState.currentStage === 'idle' && !researchState.currentOperation && !hasQueue) {
    return null;
  }

  return (
    <div className="h-12 border-b border-border bg-muted/30 px-4 flex items-center gap-4">
      {/* Current Stage */}
      <div className="flex items-center gap-2">
        <Activity className={cn('h-4 w-4', isActive ? 'animate-pulse text-primary' : 'text-muted-foreground')} />
        <span className="text-sm font-medium">{stageLabel}</span>
      </div>

      {/* Current Operation */}
      {researchState.currentOperation && (
        <>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm text-muted-foreground truncate">
              {researchState.currentOperation}
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
      {researchState.progress.percent > 0 && (
        <div className="flex items-center gap-2 w-48">
          <Progress value={researchState.progress.percent} className="h-2" />
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {Math.round(researchState.progress.percent)}%
          </span>
        </div>
      )}

      {/* Pending Approvals Alert */}
      {pendingCount > 0 && (
        <Badge 
          variant="outline" 
          className="gap-1.5 bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30 animate-pulse cursor-pointer"
          onClick={toggleExpanded}
        >
          <AlertCircle className="h-3 w-3" />
          {pendingCount} needs approval
        </Badge>
      )}

      {/* Queue Status */}
      {queueCount > 0 && (
        <Badge variant="outline" className="gap-1.5">
          <ListOrdered className="h-3 w-3" />
          {queueCount} queued
        </Badge>
      )}

      {/* Up Next Preview */}
      {missionState.operationQueue[0] && !pendingCount && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ChevronRight className="h-3 w-3" />
          <span className="truncate max-w-32">Next: {missionState.operationQueue[0].title}</span>
        </div>
      )}

      {/* Mission Control Button */}
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto gap-1.5 h-8"
        onClick={handleOpenMissionControl}
      >
        <ListOrdered className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Mission Control</span>
        <ExternalLink className="h-3 w-3" />
      </Button>
    </div>
  );
};
