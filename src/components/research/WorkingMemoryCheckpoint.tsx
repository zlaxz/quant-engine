/**
 * WorkingMemoryCheckpoint - Shows session state with DIFFS (what changed)
 * Enables ADHD-friendly context recovery after interruptions
 */

import { Save, FileEdit, Brain, Clock, CheckCircle2, Circle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export interface WorkingMemoryState {
  task: string;
  progress: number;
  completedSteps: string[];
  currentStep: string;
  nextSteps: string[];
  filesModified?: Array<{
    path: string;
    linesAdded: number;
    linesRemoved?: number;
  }>;
  mentalModelEvolution?: {
    before: string;
    after: string;
  };
  validatedInsights?: string[];
  timestamp: number;
}

interface WorkingMemoryCheckpointProps {
  state: WorkingMemoryState;
  onContinue?: () => void;
  onSaveAndExit?: () => void;
  onAbandon?: () => void;
  className?: string;
}

export function WorkingMemoryCheckpoint({ 
  state, 
  onContinue, 
  onSaveAndExit, 
  onAbandon, 
  className 
}: WorkingMemoryCheckpointProps) {
  return (
    <Card className={cn('border-l-4 border-l-purple-500 shadow-md', className)}>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="p-2 rounded bg-purple-100 dark:bg-purple-900/30">
            <Save className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-sm">Session Checkpoint</h4>
              <Badge variant="secondary" className="text-xs font-mono">
                {Math.round(state.progress)}%
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {state.task}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1">
          <Progress value={state.progress} className="h-2" />
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Last saved: {new Date(state.timestamp).toLocaleTimeString()}</span>
          </div>
        </div>

        {/* Files Modified (DIFFS) */}
        {state.filesModified && state.filesModified.length > 0 && (
          <div className="bg-green-50 dark:bg-green-950/30 border-l-2 border-green-500 p-3 rounded">
            <div className="flex items-center gap-2 mb-2">
              <FileEdit className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
              <div className="text-xs font-semibold text-green-700 dark:text-green-300">
                Files Modified:
              </div>
            </div>
            <div className="space-y-1">
              {state.filesModified.map((file, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs">
                  <code className="font-mono text-green-900 dark:text-green-100">
                    {file.path}
                  </code>
                  <Badge variant="outline" className="text-xs bg-green-100 dark:bg-green-900/30">
                    +{file.linesAdded}
                    {file.linesRemoved !== undefined && ` -${file.linesRemoved}`}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mental Model Evolution */}
        {state.mentalModelEvolution && (
          <div className="bg-blue-50 dark:bg-blue-950/30 border-l-2 border-blue-500 p-3 rounded">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              <div className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                Mental Model Evolution:
              </div>
            </div>
            <div className="space-y-2 text-xs">
              <div>
                <span className="text-blue-600 dark:text-blue-400 font-medium">Before:</span>
                <p className="text-blue-900 dark:text-blue-100 mt-0.5 italic">
                  "{state.mentalModelEvolution.before}"
                </p>
              </div>
              <div className="flex justify-center text-blue-500">↓</div>
              <div>
                <span className="text-blue-600 dark:text-blue-400 font-medium">After:</span>
                <p className="text-blue-900 dark:text-blue-100 mt-0.5 italic">
                  "{state.mentalModelEvolution.after}"
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Completed Steps */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2">
            Completed:
          </div>
          <div className="space-y-1">
            {state.completedSteps.map((step, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400 flex-shrink-0" />
                <span>{step}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Current Step */}
        <div className="bg-amber-50 dark:bg-amber-950/30 border-l-2 border-amber-500 p-2 rounded">
          <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1">
            Current Step:
          </div>
          <div className="flex items-center gap-2 text-xs text-amber-900 dark:text-amber-100">
            <Circle className="h-3 w-3 animate-pulse" />
            {state.currentStep}
          </div>
        </div>

        {/* Next Steps */}
        {state.nextSteps.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2">
              Next:
            </div>
            <div className="space-y-1">
              {state.nextSteps.map((step, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Circle className="h-3 w-3 flex-shrink-0" />
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Validated Insights */}
        {state.validatedInsights && state.validatedInsights.length > 0 && (
          <div className="bg-indigo-50 dark:bg-indigo-950/30 border-l-2 border-indigo-500 p-2 rounded">
            <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 mb-1">
              Validated Insights:
            </div>
            <div className="space-y-0.5">
              {state.validatedInsights.map((insight, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs text-indigo-900 dark:text-indigo-100">
                  <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                  <span>{insight}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {(onContinue || onSaveAndExit || onAbandon) && (
          <div className="flex gap-2 pt-3 border-t">
            {onContinue && (
              <Button onClick={onContinue} size="sm" className="flex-1">
                Continue
              </Button>
            )}
            {onSaveAndExit && (
              <Button onClick={onSaveAndExit} size="sm" variant="outline" className="flex-1">
                Save & Exit
              </Button>
            )}
            {onAbandon && (
              <Button onClick={onAbandon} size="sm" variant="ghost">
                Abandon
              </Button>
            )}
          </div>
        )}

        {/* Context Recovery Note */}
        <div className="text-xs text-muted-foreground text-center italic border-t pt-2">
          You can close the app. On return: "Resume {state.task.toLowerCase()}?"
        </div>
      </div>
    </Card>
  );
}
