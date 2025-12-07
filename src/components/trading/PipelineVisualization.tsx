/**
 * PipelineVisualization - Interactive Discovery Pipeline Flow
 *
 * Shows the complete physics engine pipeline with animated progress:
 * Raw Data → Features → Scout → Math → Jury → AI-Native → Playbook
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  Database,
  Cpu,
  Search,
  Calculator,
  Scale,
  Brain,
  FileText,
  ArrowRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2
} from 'lucide-react';

export interface PipelineStage {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  status: 'idle' | 'running' | 'complete' | 'error';
  progress: number;
  output?: string;
  duration?: number;
  metrics?: Record<string, number | string>;
}

interface PipelineVisualizationProps {
  stages?: PipelineStage[];
  onStageClick?: (stageId: string) => void;
  className?: string;
}

const DEFAULT_STAGES: PipelineStage[] = [
  {
    id: 'raw_data',
    name: 'Raw Data',
    description: 'Options chain & OHLCV',
    icon: Database,
    status: 'complete',
    progress: 100,
    output: '394M rows',
    metrics: { rows: '394M', symbols: 16 }
  },
  {
    id: 'features',
    name: 'Features',
    description: 'Physics feature extraction',
    icon: Cpu,
    status: 'complete',
    progress: 100,
    output: '496 features',
    metrics: { morphology: 45, dynamics: 38, flow: 32, entropy: 28 }
  },
  {
    id: 'scout',
    name: 'Scout Swarm',
    description: 'Genetic feature selection',
    icon: Search,
    status: 'complete',
    progress: 100,
    output: '50 selected',
    metrics: { population: 100, generations: 20 }
  },
  {
    id: 'math',
    name: 'Math Swarm',
    description: 'Equation discovery (PySR)',
    icon: Calculator,
    status: 'idle',
    progress: 0,
    metrics: { equations: 0 }
  },
  {
    id: 'jury',
    name: 'Jury Swarm',
    description: 'Regime classification',
    icon: Scale,
    status: 'idle',
    progress: 0,
    metrics: { regimes: 4 }
  },
  {
    id: 'ai_native',
    name: 'AI-Native',
    description: 'Observer synthesis',
    icon: Brain,
    status: 'idle',
    progress: 0,
    metrics: { observers: 20 }
  },
  {
    id: 'playbook',
    name: 'Playbook',
    description: 'Trading rules',
    icon: FileText,
    status: 'idle',
    progress: 0,
    metrics: { strategies: 0 }
  }
];

const statusColors = {
  idle: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  running: 'bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse',
  complete: 'bg-green-500/20 text-green-400 border-green-500/30',
  error: 'bg-red-500/20 text-red-400 border-red-500/30'
};

const statusIcons = {
  idle: Clock,
  running: Loader2,
  complete: CheckCircle2,
  error: AlertCircle
};

export function PipelineVisualization({
  stages = DEFAULT_STAGES,
  onStageClick,
  className
}: PipelineVisualizationProps) {
  const [hoveredStage, setHoveredStage] = useState<string | null>(null);
  const [animatedProgress, setAnimatedProgress] = useState<Record<string, number>>({});

  // Animate progress bars
  useEffect(() => {
    const newProgress: Record<string, number> = {};
    stages.forEach(stage => {
      newProgress[stage.id] = stage.progress;
    });
    setAnimatedProgress(newProgress);
  }, [stages]);

  const completedCount = stages.filter(s => s.status === 'complete').length;
  const runningCount = stages.filter(s => s.status === 'running').length;
  const overallProgress = stages.length > 0 ? (completedCount / stages.length) * 100 : 0;

  return (
    <Card className={cn("bg-card/50 backdrop-blur", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            Discovery Pipeline
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {completedCount}/{stages.length} Complete
            </Badge>
            {runningCount > 0 && (
              <Badge className="bg-blue-500/20 text-blue-400 text-xs animate-pulse">
                {runningCount} Running
              </Badge>
            )}
          </div>
        </div>
        <Progress value={overallProgress} className="h-1 mt-2" />
      </CardHeader>

      <CardContent className="pt-4">
        {/* Pipeline Flow */}
        <div className="flex items-center justify-between gap-1 overflow-x-auto pb-2">
          {stages.map((stage, index) => {
            const StatusIcon = statusIcons[stage.status];
            const StageIcon = stage.icon;
            const isHovered = hoveredStage === stage.id;

            return (
              <div key={stage.id} className="flex items-center">
                {/* Stage Node */}
                <div
                  className={cn(
                    "relative flex flex-col items-center cursor-pointer transition-all duration-300",
                    "min-w-[80px] p-2 rounded-lg border",
                    statusColors[stage.status],
                    isHovered && "scale-110 shadow-lg z-10"
                  )}
                  onClick={() => onStageClick?.(stage.id)}
                  onMouseEnter={() => setHoveredStage(stage.id)}
                  onMouseLeave={() => setHoveredStage(null)}
                >
                  {/* Icon with status indicator */}
                  <div className="relative">
                    <StageIcon className={cn(
                      "h-6 w-6 mb-1",
                      stage.status === 'running' && "animate-pulse"
                    )} />
                    <StatusIcon className={cn(
                      "absolute -bottom-1 -right-1 h-3 w-3",
                      stage.status === 'running' && "animate-spin"
                    )} />
                  </div>

                  {/* Stage name */}
                  <span className="text-xs font-medium text-center whitespace-nowrap">
                    {stage.name}
                  </span>

                  {/* Progress bar */}
                  {stage.status !== 'idle' && (
                    <div className="w-full mt-1">
                      <Progress
                        value={animatedProgress[stage.id] || 0}
                        className="h-0.5"
                      />
                    </div>
                  )}

                  {/* Output badge */}
                  {stage.output && (
                    <Badge variant="secondary" className="text-[10px] mt-1 px-1 py-0">
                      {stage.output}
                    </Badge>
                  )}

                  {/* Hover tooltip */}
                  {isHovered && (
                    <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-20 w-48 p-2 rounded-lg bg-popover border shadow-xl">
                      <p className="text-xs text-muted-foreground mb-2">
                        {stage.description}
                      </p>
                      {stage.metrics && (
                        <div className="grid grid-cols-2 gap-1 text-[10px]">
                          {Object.entries(stage.metrics).map(([key, value]) => (
                            <div key={key} className="flex justify-between">
                              <span className="text-muted-foreground">{key}:</span>
                              <span className="font-mono">{value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {stage.duration && (
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          Duration: {stage.duration}s
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Arrow connector */}
                {index < stages.length - 1 && (
                  <ArrowRight className={cn(
                    "h-4 w-4 mx-1 flex-shrink-0 transition-colors",
                    stage.status === 'complete' ? "text-green-500" : "text-muted-foreground/30"
                  )} />
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-4 pt-2 border-t text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-gray-500" />
            <span>Idle</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span>Running</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span>Complete</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <span>Error</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default PipelineVisualization;
