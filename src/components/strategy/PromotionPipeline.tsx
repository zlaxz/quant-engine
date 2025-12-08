/**
 * PromotionPipeline - Visual funnel for strategy lifecycle
 *
 * PHASE 4: Strategy Management
 *
 * Features:
 * - Visual funnel: Discovery → Validation → Paper → Live
 * - Drag to promote (with confirmation + reason)
 * - Shows requirements for each stage
 * - Status counts per stage
 *
 * ADHD Design:
 * - Visual pipeline is intuitive
 * - Color-coded stages
 * - Drag and drop is natural
 * - Clear requirements before promotion
 */

import { useState, useMemo } from 'react';
import {
  ChevronRight,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowRight,
  Zap,
  FlaskConical,
  FileText,
  Target,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Strategy } from './StrategyCard';

// =========================================================================
// Types
// =========================================================================

type PipelineStage = 'discovery' | 'validation' | 'paper' | 'live';

interface StageConfig {
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
  requirements: string[];
}

interface PromotionPipelineProps {
  strategies: Strategy[];
  onPromote?: (strategy: Strategy, toStage: PipelineStage, reason: string) => void;
  onViewStrategy?: (strategy: Strategy) => void;
  className?: string;
}

// =========================================================================
// Stage Configuration
// =========================================================================

const STAGE_CONFIG: Record<PipelineStage, StageConfig> = {
  discovery: {
    label: 'Discovery',
    icon: <FlaskConical className="h-5 w-5" />,
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    borderColor: 'border-gray-300 dark:border-gray-600',
    requirements: [
      'Initial backtest completed',
      'Basic performance metrics available',
    ],
  },
  validation: {
    label: 'Validation',
    icon: <Target className="h-5 w-5" />,
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
    borderColor: 'border-yellow-400 dark:border-yellow-600',
    requirements: [
      'Walk-forward validation passed',
      'Out-of-sample testing positive',
      'Sharpe ratio > 1.0',
      'Max drawdown < 15%',
    ],
  },
  paper: {
    label: 'Paper Trading',
    icon: <FileText className="h-5 w-5" />,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    borderColor: 'border-blue-400 dark:border-blue-600',
    requirements: [
      'Plain English description written',
      '30+ paper trades executed',
      'Live fills match expected',
      'No infrastructure issues',
      'Sharpe ratio maintained',
    ],
  },
  live: {
    label: 'Live Trading',
    icon: <TrendingUp className="h-5 w-5" />,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    borderColor: 'border-green-400 dark:border-green-600',
    requirements: [
      'Paper trading period complete',
      'Risk limits configured',
      'Kill switch tested',
      'Operator approval',
    ],
  },
};

const STAGE_ORDER: PipelineStage[] = ['discovery', 'validation', 'paper', 'live'];

// =========================================================================
// Mini Strategy Card for Pipeline
// =========================================================================

function PipelineStrategyCard({
  strategy,
  onClick,
  onPromote,
  canPromote,
  nextStage,
}: {
  strategy: Strategy;
  onClick?: () => void;
  onPromote?: () => void;
  canPromote: boolean;
  nextStage?: PipelineStage;
}) {
  const hasWarnings =
    strategy.consecutiveLosses >= 3 ||
    strategy.performanceTrend === 'degrading';

  return (
    <div
      className={cn(
        'p-3 bg-background rounded-lg border cursor-pointer hover:shadow-md transition-all',
        hasWarnings && 'border-orange-400'
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="font-medium text-sm flex items-center gap-1">
            {strategy.name}
            {hasWarnings && (
              <AlertTriangle className="h-3 w-3 text-orange-500" />
            )}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1">
            {strategy.description || 'No description'}
          </p>
        </div>
        {strategy.currentRegimeAligned && (
          <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-2 text-xs">
          <span
            className={cn(
              'font-mono',
              strategy.sharpe >= 1.5 ? 'text-green-500' : 'text-muted-foreground'
            )}
          >
            SR: {strategy.sharpe.toFixed(1)}
          </span>
          <span className="text-muted-foreground">
            WR: {(strategy.winRate * 100).toFixed(0)}%
          </span>
        </div>

        {canPromote && nextStage && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onPromote?.();
            }}
          >
            <ArrowRight className="h-3 w-3 mr-1" />
            Promote
          </Button>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// Stage Column Component
// =========================================================================

function StageColumn({
  stage,
  strategies,
  nextStage,
  onViewStrategy,
  onPromoteStrategy,
}: {
  stage: PipelineStage;
  strategies: Strategy[];
  nextStage?: PipelineStage;
  onViewStrategy?: (strategy: Strategy) => void;
  onPromoteStrategy?: (strategy: Strategy) => void;
}) {
  const config = STAGE_CONFIG[stage];

  return (
    <div className="flex-1 min-w-[250px]">
      {/* Stage Header */}
      <div
        className={cn(
          'p-3 rounded-t-lg border-b-2',
          config.bgColor,
          config.borderColor
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={config.color}>{config.icon}</span>
            <span className={cn('font-medium', config.color)}>{config.label}</span>
          </div>
          <Badge variant="secondary">{strategies.length}</Badge>
        </div>
      </div>

      {/* Requirements */}
      <div className="p-2 bg-muted/50 border-x text-xs space-y-1">
        {config.requirements.slice(0, 2).map((req, i) => (
          <div key={i} className="flex items-start gap-1 text-muted-foreground">
            <CheckCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <span>{req}</span>
          </div>
        ))}
        {config.requirements.length > 2 && (
          <span className="text-muted-foreground">
            +{config.requirements.length - 2} more requirements
          </span>
        )}
      </div>

      {/* Strategy List */}
      <ScrollArea className="h-[400px] border rounded-b-lg">
        <div className="p-2 space-y-2">
          {strategies.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No strategies in {config.label.toLowerCase()}
            </div>
          ) : (
            strategies.map((strategy) => (
              <PipelineStrategyCard
                key={strategy.id}
                strategy={strategy}
                onClick={() => onViewStrategy?.(strategy)}
                onPromote={() => onPromoteStrategy?.(strategy)}
                canPromote={!!nextStage}
                nextStage={nextStage}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// =========================================================================
// Main Component
// =========================================================================

export function PromotionPipeline({
  strategies,
  onPromote,
  onViewStrategy,
  className,
}: PromotionPipelineProps) {
  const [promotingStrategy, setPromotingStrategy] = useState<Strategy | null>(null);
  const [promotionReason, setPromotionReason] = useState('');

  // Group strategies by stage
  const strategiesByStage = useMemo(() => {
    const groups: Record<PipelineStage, Strategy[]> = {
      discovery: [],
      validation: [],
      paper: [],
      live: [],
    };

    strategies.forEach((s) => {
      if (s.status === 'discovery') groups.discovery.push(s);
      else if (s.status === 'validation') groups.validation.push(s);
      else if (s.status === 'paper') groups.paper.push(s);
      else if (s.status === 'live') groups.live.push(s);
      // paused and retired strategies are not shown in pipeline
    });

    return groups;
  }, [strategies]);

  // Summary stats
  const stats = {
    total: STAGE_ORDER.reduce((sum, stage) => sum + strategiesByStage[stage].length, 0),
    discovery: strategiesByStage.discovery.length,
    validation: strategiesByStage.validation.length,
    paper: strategiesByStage.paper.length,
    live: strategiesByStage.live.length,
  };

  // Get next stage for a strategy
  const getNextStage = (currentStage: PipelineStage): PipelineStage | undefined => {
    const currentIndex = STAGE_ORDER.indexOf(currentStage);
    if (currentIndex < STAGE_ORDER.length - 1) {
      return STAGE_ORDER[currentIndex + 1];
    }
    return undefined;
  };

  // Check if strategy meets requirements for next stage
  const meetsRequirements = (strategy: Strategy, toStage: PipelineStage): boolean => {
    switch (toStage) {
      case 'validation':
        return strategy.sharpe > 0 && strategy.tradeCount > 0;
      case 'paper':
        return (
          strategy.sharpe >= 1.0 &&
          strategy.maxDrawdown <= 15 &&
          strategy.tradeCount >= 10
        );
      case 'live':
        return (
          !!strategy.description &&
          strategy.sharpe >= 1.0 &&
          strategy.tradeCount >= 30
        );
      default:
        return false;
    }
  };

  // Handle promotion
  const handlePromote = (strategy: Strategy) => {
    const nextStage = getNextStage(strategy.status as PipelineStage);
    if (!nextStage) return;

    if (!meetsRequirements(strategy, nextStage)) {
      // Show requirements dialog instead
      setPromotingStrategy(strategy);
      return;
    }

    setPromotingStrategy(strategy);
  };

  const confirmPromotion = () => {
    if (!promotingStrategy || !promotionReason) return;

    const nextStage = getNextStage(promotingStrategy.status as PipelineStage);
    if (nextStage) {
      onPromote?.(promotingStrategy, nextStage, promotionReason);
    }

    setPromotingStrategy(null);
    setPromotionReason('');
  };

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Promotion Pipeline
            </CardTitle>
            <CardDescription>
              {stats.total} strategies in pipeline
            </CardDescription>
          </div>

          {/* Summary badges */}
          <div className="flex items-center gap-1">
            {STAGE_ORDER.map((stage, index) => (
              <div key={stage} className="flex items-center">
                <Badge
                  variant="secondary"
                  className={cn('text-xs', STAGE_CONFIG[stage].bgColor, STAGE_CONFIG[stage].color)}
                >
                  {strategiesByStage[stage].length}
                </Badge>
                {index < STAGE_ORDER.length - 1 && (
                  <ChevronRight className="h-4 w-4 text-muted-foreground mx-1" />
                )}
              </div>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Pipeline Stages */}
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGE_ORDER.map((stage, index) => (
            <div key={stage} className="flex items-start">
              <StageColumn
                stage={stage}
                strategies={strategiesByStage[stage]}
                nextStage={getNextStage(stage)}
                onViewStrategy={onViewStrategy}
                onPromoteStrategy={handlePromote}
              />

              {/* Arrow between stages */}
              {index < STAGE_ORDER.length - 1 && (
                <div className="flex items-center justify-center w-8 pt-20">
                  <ChevronRight className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>

      {/* Promotion Confirmation Dialog */}
      <Dialog
        open={!!promotingStrategy}
        onOpenChange={(open) => {
          if (!open) {
            setPromotingStrategy(null);
            setPromotionReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promote Strategy</DialogTitle>
            <DialogDescription>
              {promotingStrategy && (
                <>
                  Promoting "{promotingStrategy.name}" from{' '}
                  {STAGE_CONFIG[promotingStrategy.status as PipelineStage]?.label} to{' '}
                  {STAGE_CONFIG[getNextStage(promotingStrategy.status as PipelineStage)!]?.label}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Requirements Check */}
          {promotingStrategy && (
            <div className="space-y-3">
              <h4 className="font-medium text-sm">Requirements Check</h4>
              {STAGE_CONFIG[
                getNextStage(promotingStrategy.status as PipelineStage)!
              ]?.requirements.map((req, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                  <span>{req}</span>
                </div>
              ))}

              {/* Missing description warning */}
              {!promotingStrategy.description &&
                getNextStage(promotingStrategy.status as PipelineStage) === 'paper' && (
                  <div className="flex items-start gap-2 text-sm text-orange-600">
                    <AlertTriangle className="h-4 w-4 mt-0.5" />
                    <span>
                      Plain English description is required before paper trading
                    </span>
                  </div>
                )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Reason for Promotion</label>
            <Textarea
              placeholder="Why are you promoting this strategy?"
              value={promotionReason}
              onChange={(e) => setPromotionReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              This will be logged in the decision trail
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPromotingStrategy(null);
                setPromotionReason('');
              }}
            >
              Cancel
            </Button>
            <Button onClick={confirmPromotion} disabled={!promotionReason}>
              Confirm Promotion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default PromotionPipeline;
