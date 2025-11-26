/**
 * Roadmap Tracker - Bottom panel showing research lifecycle progress
 * Functions as save state and context recovery system
 */

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useResearchDisplay } from '@/contexts/ResearchDisplayContext';
import { 
  Map, 
  Search, 
  FlaskConical, 
  Settings, 
  PieChart, 
  CheckCircle2
} from 'lucide-react';
import { cn } from '@/lib/utils';

const stages = [
  { key: 'regime_mapping', label: 'Regime Mapping', icon: Map },
  { key: 'strategy_discovery', label: 'Strategy Discovery', icon: Search },
  { key: 'backtesting', label: 'Backtesting', icon: FlaskConical },
  { key: 'tuning', label: 'Tuning', icon: Settings },
  { key: 'portfolio', label: 'Portfolio', icon: PieChart },
  { key: 'conclusion', label: 'Conclusion', icon: CheckCircle2 },
];

export const RoadmapTracker = () => {
  const { state } = useResearchDisplay();
  
  const currentStageIndex = stages.findIndex(s => s.key === state.currentStage);

  return (
    <Card className="h-full bg-card/50 backdrop-blur p-4">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Research Journey</h3>
          <Badge variant="outline" className="text-xs">
            {currentStageIndex >= 0 ? `${currentStageIndex + 1} / ${stages.length}` : 'Not Started'}
          </Badge>
        </div>

        {/* Timeline */}
        <div className="flex items-center gap-2">
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            const isCompleted = index < currentStageIndex;
            const isCurrent = index === currentStageIndex;
            const isPending = index > currentStageIndex;

            return (
              <div key={stage.key} className="flex items-center flex-1">
                <div
                  className={cn(
                    "flex flex-col items-center gap-1 flex-1",
                    "transition-all duration-300"
                  )}
                >
                  <div
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center",
                      "border-2 transition-all duration-300",
                      isCompleted && "bg-primary border-primary text-primary-foreground",
                      isCurrent && "bg-primary/20 border-primary text-primary animate-pulse",
                      isPending && "bg-muted border-muted-foreground/20 text-muted-foreground"
                    )}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-[10px] text-center font-medium leading-tight",
                      isCurrent && "text-primary",
                      isPending && "text-muted-foreground"
                    )}
                  >
                    {stage.label}
                  </span>
                </div>

                {/* Connector line */}
                {index < stages.length - 1 && (
                  <div
                    className={cn(
                      "h-0.5 flex-1 transition-all duration-300",
                      isCompleted ? "bg-primary" : "bg-muted-foreground/20"
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Key Data Points */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
          <DataPoint label="Regimes" value="6" />
          <DataPoint label="Strategies" value="12" />
          <DataPoint label="Best Sharpe" value="2.1" />
        </div>
      </div>
    </Card>
  );
};

function DataPoint({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
