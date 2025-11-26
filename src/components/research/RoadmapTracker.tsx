/**
 * Roadmap Tracker - Bottom panel showing research lifecycle progress
 * Functions as save state and context recovery system
 * Phase 3: Enhanced with sub-steps, interactivity, and completion tracking
 */

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useResearchDisplay } from '@/contexts/ResearchDisplayContext';
import { 
  Map, 
  Search, 
  FlaskConical, 
  Settings, 
  PieChart, 
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SubStep {
  label: string;
  completed: boolean;
  timestamp?: string;
}

interface JourneyStage {
  key: string;
  label: string;
  icon: typeof Map;
  description: string;
  subSteps: SubStep[];
}

const journeyStages: JourneyStage[] = [
  {
    key: 'regime_mapping',
    label: 'Regime Mapping',
    icon: Map,
    description: 'Classify market conditions and identify regimes',
    subSteps: [
      { label: 'Load historical data', completed: true, timestamp: '2:34 PM' },
      { label: 'Classify market regimes', completed: false },
      { label: 'Analyze regime distribution', completed: false },
    ]
  },
  {
    key: 'strategy_discovery',
    label: 'Strategy Discovery',
    icon: Search,
    description: 'Find strategies that work in each regime',
    subSteps: [
      { label: 'Generate strategy candidates', completed: false },
      { label: 'Initial screening', completed: false },
      { label: 'Regime-specific testing', completed: false },
    ]
  },
  {
    key: 'backtesting',
    label: 'Backtesting',
    icon: FlaskConical,
    description: 'Test strategies with historical data',
    subSteps: [
      { label: 'Full historical backtests', completed: false },
      { label: 'Walk-forward analysis', completed: false },
      { label: 'Out-of-sample testing', completed: false },
    ]
  },
  {
    key: 'tuning',
    label: 'Tuning',
    icon: Settings,
    description: 'Optimize parameters and refine strategies',
    subSteps: [
      { label: 'Parameter optimization', completed: false },
      { label: 'Robustness testing', completed: false },
      { label: 'Overfitting checks', completed: false },
    ]
  },
  {
    key: 'portfolio',
    label: 'Portfolio',
    icon: PieChart,
    description: 'Combine strategies into balanced portfolio',
    subSteps: [
      { label: 'Strategy selection', completed: false },
      { label: 'Allocation optimization', completed: false },
      { label: 'Risk balancing', completed: false },
    ]
  },
  {
    key: 'conclusion',
    label: 'Conclusion',
    icon: CheckCircle2,
    description: 'Final synthesis and recommendations',
    subSteps: [
      { label: 'Performance summary', completed: false },
      { label: 'Risk assessment', completed: false },
      { label: 'Next steps', completed: false },
    ]
  },
];

export const RoadmapTracker = () => {
  const { state } = useResearchDisplay();
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  
  const currentStageIndex = journeyStages.findIndex(s => s.key === state.currentStage);

  const toggleStage = (stageKey: string) => {
    setExpandedStage(expandedStage === stageKey ? null : stageKey);
  };

  return (
    <Card className="h-full bg-card/50 backdrop-blur overflow-hidden flex flex-col">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Research Journey</h3>
            <p className="text-xs text-muted-foreground">Track your discovery progress</p>
          </div>
          <Badge variant="outline" className="text-xs">
            {currentStageIndex >= 0 ? `Step ${currentStageIndex + 1} / ${journeyStages.length}` : 'Ready'}
          </Badge>
        </div>
      </div>

      {/* Scrollable stages list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {journeyStages.map((stage, index) => {
          const Icon = stage.icon;
          const isCompleted = index < currentStageIndex;
          const isCurrent = index === currentStageIndex;
          const isPending = index > currentStageIndex;
          const isExpanded = expandedStage === stage.key;

          return (
            <div key={stage.key} className="space-y-1">
              <Button
                variant="ghost"
                onClick={() => toggleStage(stage.key)}
                className={cn(
                  "w-full justify-start gap-3 p-3 h-auto",
                  isCurrent && "bg-primary/10 hover:bg-primary/15",
                  isCompleted && "opacity-70"
                )}
              >
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                    "border-2 transition-all duration-300",
                    isCompleted && "bg-primary border-primary text-primary-foreground",
                    isCurrent && "bg-primary/20 border-primary text-primary",
                    isPending && "bg-muted border-muted-foreground/20 text-muted-foreground"
                  )}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </div>

                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-sm font-medium",
                      isCurrent && "text-primary"
                    )}>
                      {stage.label}
                    </span>
                    {isCurrent && state.progress && state.progress.percent > 0 && (
                      <Badge variant="secondary" className="text-[10px] h-4 px-1">
                        {state.progress.percent}%
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{stage.description}</p>
                </div>

                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                )}
              </Button>

              {/* Sub-steps */}
              {isExpanded && (
                <div className="ml-14 space-y-1 animate-in slide-in-from-top-2">
                  {stage.subSteps.map((subStep, subIndex) => (
                    <div
                      key={subIndex}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-md text-xs",
                        subStep.completed ? "bg-primary/5" : "bg-muted/50"
                      )}
                    >
                      {subStep.completed ? (
                        <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                      ) : (
                        <div className="h-3 w-3 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                      )}
                      <span className={cn(
                        subStep.completed ? "text-foreground" : "text-muted-foreground"
                      )}>
                        {subStep.label}
                      </span>
                      {subStep.timestamp && (
                        <div className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>{subStep.timestamp}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Key Data Points Footer */}
      <div className="border-t border-border p-4">
        <div className="grid grid-cols-3 gap-4">
          <DataPoint label="Regimes" value="6" status="classified" />
          <DataPoint label="Strategies" value="12" status="testing" />
          <DataPoint label="Best Sharpe" value="2.1" status="validated" />
        </div>
      </div>
    </Card>
  );
};

function DataPoint({ label, value, status }: { label: string; value: string; status: 'classified' | 'testing' | 'validated' }) {
  const statusColors = {
    classified: 'text-primary',
    testing: 'text-yellow-500',
    validated: 'text-green-500'
  };

  return (
    <div className="text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-bold", statusColors[status])}>{value}</p>
    </div>
  );
}
