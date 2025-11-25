/**
 * BriefingDeck - Morning Briefing Card Feed
 *
 * Displays AI-generated narratives from the Night Shift daemon.
 * Each card represents a "Morning Briefing" with:
 * - Strategy performance summary
 * - Plain-English narrative
 * - Action verdict (PROMOTE, WATCH, FAIL)
 * - Key metrics visualization
 */

import React, { useState } from 'react';
import {
  Sun,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Eye,
  ChevronRight,
  Calendar,
  BarChart2,
  Activity,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { RegimeType } from './RegimeDisplay';

// ============================================================================
// Types
// ============================================================================

export type BriefingVerdict = 'PROMOTE' | 'WATCH' | 'FAIL' | 'PENDING';

export interface BriefingCard {
  id: string;
  strategyId: string;
  strategyName: string;
  targetRegime: RegimeType;
  verdict: BriefingVerdict;
  narrative: string; // AI-generated plain-English summary
  metrics: {
    sharpe: number;
    sortino: number;
    maxDrawdown: number;
    winRate: number;
    convexity: number;
    fitness: number;
  };
  performanceSummary: string; // One-line performance tagline
  riskWarnings?: string[];
  generatedAt: string;
  backtestPeriod: {
    start: string;
    end: string;
  };
}

export interface BriefingDeckProps {
  briefings: BriefingCard[];
  className?: string;
  onBriefingClick?: (briefing: BriefingCard) => void;
  onPromote?: (briefing: BriefingCard) => void;
  maxVisible?: number;
}

// ============================================================================
// Verdict Configuration
// ============================================================================

const VERDICT_CONFIG: Record<
  BriefingVerdict,
  {
    label: string;
    icon: React.ReactNode;
    bgClass: string;
    borderClass: string;
    textClass: string;
    badgeClass: string;
  }
> = {
  PROMOTE: {
    label: 'Promote',
    icon: <CheckCircle className="w-4 h-4" />,
    bgClass: 'bg-green-500/10',
    borderClass: 'border-green-500/30',
    textClass: 'text-green-400',
    badgeClass: 'bg-green-500/20 text-green-400 border-green-500/30',
  },
  WATCH: {
    label: 'Watch',
    icon: <Eye className="w-4 h-4" />,
    bgClass: 'bg-yellow-500/10',
    borderClass: 'border-yellow-500/30',
    textClass: 'text-yellow-400',
    badgeClass: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  },
  FAIL: {
    label: 'Fail',
    icon: <XCircle className="w-4 h-4" />,
    bgClass: 'bg-red-500/10',
    borderClass: 'border-red-500/30',
    textClass: 'text-red-400',
    badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
  },
  PENDING: {
    label: 'Pending',
    icon: <Activity className="w-4 h-4 animate-pulse" />,
    bgClass: 'bg-gray-500/10',
    borderClass: 'border-gray-500/30',
    textClass: 'text-gray-400',
    badgeClass: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  },
};

const REGIME_COLORS: Record<RegimeType, string> = {
  LOW_VOL_GRIND: 'text-green-400',
  HIGH_VOL_OSCILLATION: 'text-yellow-400',
  CRASH_ACCELERATION: 'text-red-400',
  MELT_UP: 'text-amber-400',
  UNKNOWN: 'text-gray-400',
};

// ============================================================================
// Helper Components
// ============================================================================

function MetricPill({
  label,
  value,
  good,
  format = 'decimal',
}: {
  label: string;
  value: number;
  good?: boolean;
  format?: 'decimal' | 'percent' | 'ratio';
}) {
  const formatted =
    format === 'percent'
      ? `${(value * 100).toFixed(1)}%`
      : format === 'ratio'
        ? `${value.toFixed(2)}x`
        : value.toFixed(2);

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-background/50">
      <span className="text-[10px] text-muted-foreground uppercase">{label}</span>
      <span
        className={cn(
          'text-xs font-mono font-semibold',
          good === undefined
            ? 'text-foreground'
            : good
              ? 'text-green-400'
              : 'text-red-400'
        )}
      >
        {formatted}
      </span>
    </div>
  );
}

function BriefingCardComponent({
  briefing,
  onClick,
  onPromote,
}: {
  briefing: BriefingCard;
  onClick?: () => void;
  onPromote?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const verdict = VERDICT_CONFIG[briefing.verdict];
  const regimeColor = REGIME_COLORS[briefing.targetRegime];

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <Card
      className={cn(
        'transition-all duration-200 cursor-pointer',
        'hover:shadow-md hover:border-primary/30',
        verdict.bgClass,
        verdict.borderClass
      )}
      onClick={() => {
        setExpanded(!expanded);
        onClick?.();
      }}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={verdict.textClass}>{verdict.icon}</span>
              <CardTitle className="text-base">{briefing.strategyName}</CardTitle>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="outline" className={cn('text-[10px]', regimeColor)}>
                {briefing.targetRegime.replace('_', ' ')}
              </Badge>
              <span className="text-muted-foreground">
                <Calendar className="w-3 h-3 inline mr-1" />
                {formatDate(briefing.backtestPeriod.start)} -{' '}
                {formatDate(briefing.backtestPeriod.end)}
              </span>
            </div>
          </div>
          <Badge className={cn('font-semibold', verdict.badgeClass)}>
            {verdict.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Performance Tagline */}
        <p className="text-sm font-medium text-foreground">
          {briefing.performanceSummary}
        </p>

        {/* Key Metrics Row */}
        <div className="flex flex-wrap gap-1.5">
          <MetricPill
            label="Sharpe"
            value={briefing.metrics.sharpe}
            good={briefing.metrics.sharpe >= 1.5}
          />
          <MetricPill
            label="Sortino"
            value={briefing.metrics.sortino}
            good={briefing.metrics.sortino >= 2.0}
          />
          <MetricPill
            label="DD"
            value={briefing.metrics.maxDrawdown}
            format="percent"
            good={briefing.metrics.maxDrawdown > -0.15}
          />
          <MetricPill
            label="Win"
            value={briefing.metrics.winRate}
            format="percent"
            good={briefing.metrics.winRate >= 0.55}
          />
          <MetricPill
            label="Fitness"
            value={briefing.metrics.fitness}
            format="ratio"
            good={briefing.metrics.fitness >= 1.0}
          />
        </div>

        {/* Expanded: Full Narrative */}
        {expanded && (
          <div className="pt-2 border-t border-border/50 space-y-3">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {briefing.narrative}
            </p>

            {/* Risk Warnings */}
            {briefing.riskWarnings && briefing.riskWarnings.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-xs text-yellow-400">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Risk Warnings</span>
                </div>
                <ul className="text-xs text-muted-foreground space-y-0.5 pl-4">
                  {briefing.riskWarnings.map((warning, i) => (
                    <li key={i} className="list-disc">
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Actions */}
            {briefing.verdict === 'PROMOTE' && onPromote && (
              <Button
                size="sm"
                className="w-full"
                onClick={(e) => {
                  e.stopPropagation();
                  onPromote();
                }}
              >
                <TrendingUp className="w-4 h-4 mr-2" />
                Promote to Live
              </Button>
            )}
          </div>
        )}

        {/* Expand indicator */}
        {!expanded && (
          <div className="flex items-center justify-center text-xs text-muted-foreground">
            <ChevronRight
              className={cn('w-4 h-4 transition-transform', expanded && 'rotate-90')}
            />
            <span>Click to expand</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function BriefingDeck({
  briefings,
  className,
  onBriefingClick,
  onPromote,
  maxVisible = 10,
}: BriefingDeckProps) {
  // Sort by verdict priority: PROMOTE > WATCH > PENDING > FAIL
  const sortedBriefings = [...briefings].sort((a, b) => {
    const priority: Record<BriefingVerdict, number> = {
      PROMOTE: 0,
      WATCH: 1,
      PENDING: 2,
      FAIL: 3,
    };
    return priority[a.verdict] - priority[b.verdict];
  });

  const visibleBriefings = sortedBriefings.slice(0, maxVisible);

  // Summary stats
  const promoteCount = briefings.filter((b) => b.verdict === 'PROMOTE').length;
  const watchCount = briefings.filter((b) => b.verdict === 'WATCH').length;
  const failCount = briefings.filter((b) => b.verdict === 'FAIL').length;

  return (
    <Card className={cn('', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sun className="w-5 h-5 text-amber-400" />
            Morning Briefing
          </CardTitle>
          <div className="flex items-center gap-2">
            {promoteCount > 0 && (
              <Badge className={VERDICT_CONFIG.PROMOTE.badgeClass}>
                {promoteCount} promote
              </Badge>
            )}
            {watchCount > 0 && (
              <Badge className={VERDICT_CONFIG.WATCH.badgeClass}>
                {watchCount} watch
              </Badge>
            )}
            {failCount > 0 && (
              <Badge className={VERDICT_CONFIG.FAIL.badgeClass}>
                {failCount} fail
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {briefings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <BarChart2 className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No briefings yet</p>
            <p className="text-xs">Night Shift daemon generates briefings at 6 AM</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {visibleBriefings.map((briefing) => (
                <BriefingCardComponent
                  key={briefing.id}
                  briefing={briefing}
                  onClick={() => onBriefingClick?.(briefing)}
                  onPromote={() => onPromote?.(briefing)}
                />
              ))}
              {briefings.length > maxVisible && (
                <div className="text-center py-2">
                  <span className="text-xs text-muted-foreground">
                    +{briefings.length - maxVisible} more briefings
                  </span>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export default BriefingDeck;
