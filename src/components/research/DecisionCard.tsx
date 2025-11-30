/**
 * DecisionCard - Shows routing decision reasoning before Claude Code execution
 * Includes alternatives considered, confidence level, and override capability
 */

import { Brain, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export interface DecisionReasoning {
  id?: string; // Decision ID for override tracking
  task: string;
  chosen: 'claude-code' | 'gemini-direct' | 'deepseek-swarm';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  alternativeConsidered?: string;
  reasoning: string;
}

interface DecisionCardProps {
  decision: DecisionReasoning;
  onProceed?: () => void;
  onOverride?: (alternative: string) => void;
  className?: string;
}

function getConfidenceColor(confidence: DecisionReasoning['confidence']): string {
  switch (confidence) {
    case 'HIGH': return 'green';
    case 'MEDIUM': return 'yellow';
    case 'LOW': return 'orange';
  }
}

function getChosenLabel(chosen: DecisionReasoning['chosen']): string {
  switch (chosen) {
    case 'claude-code': return 'Claude Code';
    case 'gemini-direct': return 'Direct Handling';
    case 'deepseek-swarm': return 'DeepSeek Swarm';
  }
}

export function DecisionCard({ decision, onProceed, onOverride, className }: DecisionCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const confidenceColor = getConfidenceColor(decision.confidence);

  return (
    <Card className={cn('border-l-4 border-l-blue-500 shadow-sm', className)}>
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="p-2 rounded bg-blue-100 dark:bg-blue-900/30">
            <Brain className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h4 className="font-semibold text-sm">Routing Decision</h4>
              <Badge 
                variant="secondary" 
                className={cn(
                  'text-xs',
                  `bg-${confidenceColor}-100 dark:bg-${confidenceColor}-900/30`,
                  `text-${confidenceColor}-700 dark:text-${confidenceColor}-300`
                )}
              >
                {decision.confidence} Confidence
              </Badge>
            </div>
            <p className="text-sm">
              <span className="font-medium text-primary">→ {getChosenLabel(decision.chosen)}</span>
              {decision.alternativeConsidered && (
                <span className="text-muted-foreground">
                  {' '}(vs {decision.alternativeConsidered})
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Reasoning */}
        <div className="bg-muted/50 rounded p-3">
          <div className="text-xs font-semibold text-muted-foreground mb-1">
            Why:
          </div>
          <p className="text-xs">
            {decision.reasoning}
          </p>
        </div>

        {/* Task Description (Collapsible) */}
        <Collapsible open={showDetails} onOpenChange={setShowDetails}>
          <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {showDetails ? '▼' : '▶'} Task Details
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <div className="text-xs bg-muted/30 rounded p-2 max-h-32 overflow-y-auto">
              {decision.task}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Actions */}
        {(onProceed || onOverride) && (
          <div className="flex gap-2 pt-2 border-t">
            {onProceed && (
              <Button
                onClick={onProceed}
                size="sm"
                className="flex items-center gap-2"
              >
                <CheckCircle2 className="h-3 w-3" />
                Proceed
              </Button>
            )}
            {onOverride && decision.alternativeConsidered && (
              <Button
                onClick={() => onOverride(decision.alternativeConsidered!)}
                size="sm"
                variant="outline"
                className="flex items-center gap-2"
              >
                <AlertCircle className="h-3 w-3" />
                Try {decision.alternativeConsidered}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
