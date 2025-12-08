/**
 * StrategyCard - Individual strategy display card
 *
 * PHASE 4: Strategy Management
 *
 * Features:
 * - Color-coded status badge
 * - Mini sparkline of last 30 days
 * - Plain English description (REQUIRED)
 * - Regime affinity with alignment indicator
 * - Confidence meter
 * - Quick actions: View, Pause, Promote, Retire
 *
 * ADHD Design:
 * - Visual status at a glance (colors, badges)
 * - Plain English over jargon
 * - Quick actions without navigation
 */

import { useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Pause,
  Play,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Target,
  Zap,
  BarChart3,
  Clock,
  ArrowUpRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/timeAnchor';

// =========================================================================
// Types
// =========================================================================

export interface Strategy {
  id: string;
  name: string;
  description: string;
  type: 'momentum' | 'meanReversion' | 'arbitrage' | 'factor' | 'ml';

  // Lifecycle
  status: 'discovery' | 'validation' | 'paper' | 'live' | 'paused' | 'retired';
  confidence: number;
  discoveredAt: Date | string;
  promotedAt: Date | string | null;
  pausedAt: Date | string | null;
  pauseReason: string | null;

  // Regime affinity
  bestRegime: 'trending' | 'meanReverting' | 'volatile' | 'any';
  currentRegimeAligned: boolean;

  // Performance
  sharpe: number;
  returns30d: number;
  maxDrawdown: number;
  winRate: number;
  expectancy: number;
  tradeCount: number;

  // Health
  performanceTrend: 'improving' | 'stable' | 'degrading';
  lastTradeAt: Date | string | null;
  consecutiveLosses: number;

  // Risk
  currentExposure: number;
  maxExposure: number;
  correlationWarnings: string[];

  // Sparkline data (last 30 days equity)
  sparklineData?: number[];
}

interface StrategyCardProps {
  strategy: Strategy;
  onView?: (strategy: Strategy) => void;
  onPause?: (strategy: Strategy) => void;
  onResume?: (strategy: Strategy) => void;
  onPromote?: (strategy: Strategy) => void;
  onRetire?: (strategy: Strategy) => void;
  compact?: boolean;
  className?: string;
}

// =========================================================================
// Status Configuration
// =========================================================================

const STATUS_CONFIG: Record<
  Strategy['status'],
  { label: string; color: string; bgColor: string }
> = {
  discovery: {
    label: 'Discovery',
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
  },
  validation: {
    label: 'Validation',
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
  },
  paper: {
    label: 'Paper',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
  },
  live: {
    label: 'LIVE',
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
  },
  paused: {
    label: 'Paused',
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
  },
  retired: {
    label: 'Retired',
    color: 'text-gray-500',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
  },
};

const REGIME_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  trending: { label: 'Trending', icon: <TrendingUp className="h-3 w-3" /> },
  meanReverting: { label: 'Mean Rev', icon: <Activity className="h-3 w-3" /> },
  volatile: { label: 'Volatile', icon: <Zap className="h-3 w-3" /> },
  any: { label: 'All Regimes', icon: <Target className="h-3 w-3" /> },
};

const TYPE_LABELS: Record<Strategy['type'], string> = {
  momentum: 'Momentum',
  meanReversion: 'Mean Reversion',
  arbitrage: 'Arbitrage',
  factor: 'Factor',
  ml: 'ML/AI',
};

// =========================================================================
// Mini Sparkline Component
// =========================================================================

function MiniSparkline({
  data,
  className,
}: {
  data: number[];
  className?: string;
}) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const width = 60;
  const height = 24;
  const padding = 2;

  const points = data
    .map((value, index) => {
      const x = padding + (index / (data.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((value - min) / range) * (height - 2 * padding);
      return `${x},${y}`;
    })
    .join(' ');

  const isPositive = data[data.length - 1] >= data[0];

  return (
    <svg width={width} height={height} className={className}>
      <polyline
        points={points}
        fill="none"
        stroke={isPositive ? '#22c55e' : '#ef4444'}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// =========================================================================
// Component
// =========================================================================

export function StrategyCard({
  strategy,
  onView,
  onPause,
  onResume,
  onPromote,
  onRetire,
  compact = false,
  className,
}: StrategyCardProps) {
  const statusConfig = STATUS_CONFIG[strategy.status];
  const regimeConfig = REGIME_CONFIG[strategy.bestRegime];

  // Health indicators
  const hasWarnings =
    strategy.consecutiveLosses >= 3 ||
    strategy.performanceTrend === 'degrading' ||
    strategy.correlationWarnings.length > 0;

  const canPromote =
    strategy.status === 'discovery' ||
    strategy.status === 'validation' ||
    strategy.status === 'paper';

  const canPause = strategy.status === 'live' || strategy.status === 'paper';
  const canResume = strategy.status === 'paused';

  return (
    <Card
      className={cn(
        'relative overflow-hidden transition-all hover:shadow-md',
        strategy.status === 'live' && 'border-green-500/50',
        hasWarnings && strategy.status !== 'retired' && 'border-orange-500/50',
        className
      )}
    >
      {/* Status indicator strip */}
      <div
        className={cn('absolute top-0 left-0 right-0 h-1', statusConfig.bgColor)}
      />

      <CardHeader className={cn('pb-2', compact && 'py-3')}>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {strategy.name}
              {hasWarnings && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <AlertTriangle className="h-4 w-4 text-orange-500" />
                    </TooltipTrigger>
                    <TooltipContent>
                      {strategy.consecutiveLosses >= 3 && (
                        <p>{strategy.consecutiveLosses} consecutive losses</p>
                      )}
                      {strategy.performanceTrend === 'degrading' && (
                        <p>Performance degrading</p>
                      )}
                      {strategy.correlationWarnings.length > 0 && (
                        <p>High correlation warnings</p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className={cn('text-xs', statusConfig.color, statusConfig.bgColor)}
              >
                {statusConfig.label}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {TYPE_LABELS[strategy.type]}
              </Badge>
            </div>
          </div>

          {/* Sparkline */}
          {strategy.sparklineData && (
            <MiniSparkline data={strategy.sparklineData} />
          )}
        </div>
      </CardHeader>

      <CardContent className={cn('space-y-3', compact && 'py-2')}>
        {/* Description */}
        <p className="text-sm text-muted-foreground line-clamp-2">
          {strategy.description || (
            <span className="italic text-orange-500">
              Description required before promotion
            </span>
          )}
        </p>

        {/* Key Metrics */}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="space-y-1">
                  <div className="text-muted-foreground text-xs">Sharpe</div>
                  <div
                    className={cn(
                      'font-mono font-medium',
                      strategy.sharpe >= 2
                        ? 'text-green-500'
                        : strategy.sharpe >= 1
                          ? 'text-yellow-500'
                          : 'text-red-500'
                    )}
                  >
                    {strategy.sharpe.toFixed(2)}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Risk-adjusted returns</p>
                <p className="text-muted-foreground">
                  {'<'}1: Poor, 1-2: Good, {'>'}2: Excellent
                </p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="space-y-1">
                  <div className="text-muted-foreground text-xs">Win Rate</div>
                  <div className="font-mono font-medium">
                    {(strategy.winRate * 100).toFixed(0)}%
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Percentage of winning trades</p>
                <p className="text-muted-foreground">
                  {strategy.tradeCount} total trades
                </p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="space-y-1">
                  <div className="text-muted-foreground text-xs">Max DD</div>
                  <div className="font-mono font-medium text-red-500">
                    {strategy.maxDrawdown.toFixed(1)}%
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Maximum drawdown from peak</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Regime Affinity */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Best in:</span>
            <Badge variant="outline" className="text-xs">
              {regimeConfig.icon}
              <span className="ml-1">{regimeConfig.label}</span>
            </Badge>
          </div>
          {strategy.currentRegimeAligned ? (
            <Badge variant="secondary" className="text-xs text-green-600 bg-green-100">
              <CheckCircle className="h-3 w-3 mr-1" />
              Aligned
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs text-orange-600 bg-orange-100">
              <XCircle className="h-3 w-3 mr-1" />
              Not Aligned
            </Badge>
          )}
        </div>

        {/* Confidence Meter */}
        {!compact && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Confidence</span>
              <span className="font-mono">{strategy.confidence}%</span>
            </div>
            <Progress
              value={strategy.confidence}
              className="h-1.5"
              indicatorClassName={cn(
                strategy.confidence >= 70
                  ? 'bg-green-500'
                  : strategy.confidence >= 40
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
              )}
            />
          </div>
        )}

        {/* Last Trade */}
        {strategy.lastTradeAt && !compact && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Last trade: {formatRelativeTime(strategy.lastTradeAt)}
          </div>
        )}
      </CardContent>

      <CardFooter className={cn('pt-2 gap-2', compact && 'py-2')}>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => onView?.(strategy)}
        >
          View Details
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              Actions
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canPromote && (
              <DropdownMenuItem onClick={() => onPromote?.(strategy)}>
                <ArrowUpRight className="h-4 w-4 mr-2" />
                Promote
              </DropdownMenuItem>
            )}
            {canPause && (
              <DropdownMenuItem onClick={() => onPause?.(strategy)}>
                <Pause className="h-4 w-4 mr-2" />
                Pause
              </DropdownMenuItem>
            )}
            {canResume && (
              <DropdownMenuItem onClick={() => onResume?.(strategy)}>
                <Play className="h-4 w-4 mr-2" />
                Resume
              </DropdownMenuItem>
            )}
            {strategy.status !== 'retired' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onRetire?.(strategy)}
                  className="text-red-600"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Retire
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  );
}

export default StrategyCard;
