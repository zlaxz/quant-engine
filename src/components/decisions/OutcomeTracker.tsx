/**
 * OutcomeTracker - Links decisions to their outcomes
 *
 * PHASE 6: Future Enhancements
 *
 * Features:
 * - Track P&L impact of decisions
 * - Retrospective rating (was it a good decision?)
 * - Learning from past decisions
 * - Visual timeline of decision → outcome
 *
 * ADHD Design:
 * - Simple thumbs up/down rating
 * - Clear P&L attribution
 * - "This pause resulted in missing +$2,000"
 */

import { useState, useEffect, useMemo } from 'react';
import {
  ThumbsUp,
  ThumbsDown,
  TrendingUp,
  TrendingDown,
  Clock,
  Link2,
  AlertCircle,
  CheckCircle,
  Calendar,
  DollarSign,
  ArrowRight,
  Filter,
  RefreshCw,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/timeAnchor';

// =========================================================================
// Types
// =========================================================================

interface DecisionContext {
  pnlAtTime: number;
  positionsAtTime: number;
  regimeAtTime: string;
  triggeredBy: string;
}

interface Decision {
  id: string;
  timestamp: Date | string;
  decisionType: string;
  description: string;
  reason: string;
  context: DecisionContext;
  outcome?: string;
  outcomeAt?: Date | string;
  outcomePnl?: number;
  wasGoodDecision?: boolean;
  actor: 'human' | 'system';
}

interface OutcomeTrackerProps {
  decisions: Decision[];
  onRateDecision?: (
    decisionId: string,
    rating: boolean,
    notes?: string
  ) => Promise<void>;
  onLinkOutcome?: (
    decisionId: string,
    outcome: string,
    pnlImpact: number
  ) => Promise<void>;
  className?: string;
}

// =========================================================================
// Decision Type Config
// =========================================================================

const DECISION_TYPE_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; color: string }
> = {
  kill_switch: {
    label: 'Kill Switch',
    icon: <AlertCircle className="h-4 w-4" />,
    color: 'text-red-500',
  },
  strategy_promotion: {
    label: 'Strategy Promotion',
    icon: <TrendingUp className="h-4 w-4" />,
    color: 'text-green-500',
  },
  strategy_retirement: {
    label: 'Strategy Retirement',
    icon: <CheckCircle className="h-4 w-4" />,
    color: 'text-gray-500',
  },
  strategy_pause: {
    label: 'Strategy Pause',
    icon: <Clock className="h-4 w-4" />,
    color: 'text-yellow-500',
  },
  strategy_resume: {
    label: 'Strategy Resume',
    icon: <RefreshCw className="h-4 w-4" />,
    color: 'text-blue-500',
  },
  parameter_change: {
    label: 'Parameter Change',
    icon: <Filter className="h-4 w-4" />,
    color: 'text-purple-500',
  },
  risk_adjustment: {
    label: 'Risk Adjustment',
    icon: <AlertCircle className="h-4 w-4" />,
    color: 'text-orange-500',
  },
  manual_trade: {
    label: 'Manual Trade',
    icon: <DollarSign className="h-4 w-4" />,
    color: 'text-cyan-500',
  },
  override: {
    label: 'Override',
    icon: <AlertCircle className="h-4 w-4" />,
    color: 'text-red-400',
  },
};

// =========================================================================
// Decision Card Component
// =========================================================================

function DecisionOutcomeCard({
  decision,
  onRate,
  onLinkOutcome,
}: {
  decision: Decision;
  onRate?: (rating: boolean, notes?: string) => void;
  onLinkOutcome?: () => void;
}) {
  const config = DECISION_TYPE_CONFIG[decision.decisionType] || {
    label: decision.decisionType,
    icon: <Clock className="h-4 w-4" />,
    color: 'text-gray-500',
  };

  const hasOutcome = decision.outcome !== undefined && decision.outcome !== null;
  const hasRating = decision.wasGoodDecision !== undefined && decision.wasGoodDecision !== null;

  return (
    <div className="p-4 border rounded-lg space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className={config.color}>{config.icon}</span>
          <div>
            <h4 className="font-medium text-sm">{config.label}</h4>
            <p className="text-xs text-muted-foreground">
              {formatRelativeTime(decision.timestamp)}
            </p>
          </div>
        </div>
        <Badge variant={decision.actor === 'human' ? 'default' : 'secondary'}>
          {decision.actor === 'human' ? 'Manual' : 'System'}
        </Badge>
      </div>

      {/* Description */}
      <div className="text-sm">
        <p>{decision.description}</p>
        {decision.reason && (
          <p className="text-muted-foreground mt-1 italic">
            Reason: "{decision.reason}"
          </p>
        )}
      </div>

      {/* Context at time of decision */}
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>P&L: ${decision.context.pnlAtTime?.toLocaleString() || '0'}</span>
        <span>Positions: {decision.context.positionsAtTime || 0}</span>
        <span>Regime: {decision.context.regimeAtTime || 'Unknown'}</span>
      </div>

      {/* Outcome section */}
      {hasOutcome ? (
        <div
          className={cn(
            'p-3 rounded-lg',
            (decision.outcomePnl || 0) >= 0
              ? 'bg-green-500/10 border border-green-500/20'
              : 'bg-red-500/10 border border-red-500/20'
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{decision.outcome}</p>
              {decision.outcomeAt && (
                <p className="text-xs text-muted-foreground">
                  {formatRelativeTime(decision.outcomeAt)}
                </p>
              )}
            </div>
            <div
              className={cn(
                'text-lg font-bold',
                (decision.outcomePnl || 0) >= 0 ? 'text-green-500' : 'text-red-500'
              )}
            >
              {(decision.outcomePnl || 0) >= 0 ? '+' : ''}$
              {decision.outcomePnl?.toLocaleString() || '0'}
            </div>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onLinkOutcome}
        >
          <Link2 className="h-4 w-4 mr-2" />
          Link Outcome
        </Button>
      )}

      {/* Rating section */}
      {hasOutcome && (
        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-sm text-muted-foreground">
            Was this a good decision?
          </span>
          {hasRating ? (
            <div className="flex items-center gap-2">
              {decision.wasGoodDecision ? (
                <Badge className="bg-green-500">
                  <ThumbsUp className="h-3 w-3 mr-1" />
                  Good
                </Badge>
              ) : (
                <Badge className="bg-red-500">
                  <ThumbsDown className="h-3 w-3 mr-1" />
                  Bad
                </Badge>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-green-500 hover:text-green-600 hover:bg-green-500/10"
                onClick={() => onRate?.(true)}
              >
                <ThumbsUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                onClick={() => onRate?.(false)}
              >
                <ThumbsDown className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Main Component
// =========================================================================

export function OutcomeTracker({
  decisions,
  onRateDecision,
  onLinkOutcome,
  className,
}: OutcomeTrackerProps) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'rated'>('all');
  const [linkingDecision, setLinkingDecision] = useState<Decision | null>(null);
  const [outcomeText, setOutcomeText] = useState('');
  const [outcomePnl, setOutcomePnl] = useState<string>('');

  // Filter decisions
  const filteredDecisions = useMemo(() => {
    return decisions.filter((d) => {
      switch (filter) {
        case 'pending':
          return !d.outcome || d.wasGoodDecision === undefined;
        case 'rated':
          return d.wasGoodDecision !== undefined;
        default:
          return true;
      }
    });
  }, [decisions, filter]);

  // Stats
  const stats = useMemo(() => {
    const withOutcome = decisions.filter((d) => d.outcome);
    const rated = decisions.filter((d) => d.wasGoodDecision !== undefined);
    const good = rated.filter((d) => d.wasGoodDecision === true);
    const totalPnlImpact = withOutcome.reduce(
      (sum, d) => sum + (d.outcomePnl || 0),
      0
    );

    return {
      total: decisions.length,
      pending: decisions.length - withOutcome.length,
      rated: rated.length,
      goodRate: rated.length > 0 ? (good.length / rated.length) * 100 : 0,
      totalPnlImpact,
    };
  }, [decisions]);

  // Handle linking outcome
  const handleLinkOutcome = async () => {
    if (!linkingDecision || !outcomeText) return;

    const pnl = parseFloat(outcomePnl) || 0;
    await onLinkOutcome?.(linkingDecision.id, outcomeText, pnl);

    setLinkingDecision(null);
    setOutcomeText('');
    setOutcomePnl('');
  };

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Decision Outcomes
            </CardTitle>
            <CardDescription>
              Track and learn from your decisions
            </CardDescription>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-sm">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4 text-yellow-500" />
                    <span>{stats.pending}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Pending outcomes</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <div className="flex items-center gap-1">
                    <ThumbsUp className="h-4 w-4 text-green-500" />
                    <span>{stats.goodRate.toFixed(0)}%</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Good decision rate</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <div
                    className={cn(
                      'flex items-center gap-1 font-medium',
                      stats.totalPnlImpact >= 0 ? 'text-green-500' : 'text-red-500'
                    )}
                  >
                    <DollarSign className="h-4 w-4" />
                    <span>
                      {stats.totalPnlImpact >= 0 ? '+' : ''}
                      {stats.totalPnlImpact.toLocaleString()}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Total P&L impact from decisions</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2 mt-4">
          <Select
            value={filter}
            onValueChange={(v) => setFilter(v as typeof filter)}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Decisions</SelectItem>
              <SelectItem value="pending">Pending Review</SelectItem>
              <SelectItem value="rated">Rated</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        <ScrollArea className="h-[500px]">
          <div className="space-y-4">
            {filteredDecisions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Link2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No decisions to display</p>
              </div>
            ) : (
              filteredDecisions.map((decision) => (
                <DecisionOutcomeCard
                  key={decision.id}
                  decision={decision}
                  onRate={(rating, notes) =>
                    onRateDecision?.(decision.id, rating, notes)
                  }
                  onLinkOutcome={() => setLinkingDecision(decision)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>

      {/* Link Outcome Dialog */}
      <Dialog
        open={!!linkingDecision}
        onOpenChange={(open) => {
          if (!open) {
            setLinkingDecision(null);
            setOutcomeText('');
            setOutcomePnl('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Outcome to Decision</DialogTitle>
            <DialogDescription>
              {linkingDecision && (
                <>
                  Decision: "{linkingDecision.description}"
                  <br />
                  Made {formatRelativeTime(linkingDecision.timestamp)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">What was the outcome?</label>
              <Textarea
                placeholder="e.g., Strategy recovered after 3 days and went on to gain $1,500"
                value={outcomeText}
                onChange={(e) => setOutcomeText(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <label className="text-sm font-medium">P&L Impact ($)</label>
              <div className="relative mt-1">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="number"
                  placeholder="0"
                  value={outcomePnl}
                  onChange={(e) => setOutcomePnl(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border rounded-md"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Positive = this decision made money. Negative = lost money.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setLinkingDecision(null);
                setOutcomeText('');
                setOutcomePnl('');
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleLinkOutcome} disabled={!outcomeText}>
              Save Outcome
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default OutcomeTracker;
