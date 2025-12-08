/**
 * PnLDashboard - Full P&L visibility dashboard
 *
 * PHASE 2: Money Visibility - User always knows if making/losing money
 *
 * Features:
 * - Hero number: Today's P&L prominently displayed
 * - Time periods: Today, week, month, year, all-time
 * - Strategy attribution: Which strategies contributed what
 * - Regime attribution: P&L by market regime
 * - Drawdown context: "Current: -5%, Historical max: -12%"
 * - Equity curve sparkline
 *
 * ADHD Design:
 * - Big numbers, color coded
 * - Context on hover
 * - Expand for details
 */

import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  ChevronDown,
  ChevronUp,
  Info,
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

// =========================================================================
// Types
// =========================================================================

interface PnLData {
  // Time periods
  realtime: number;
  today: number;
  todayPercent: number;
  week: number;
  weekPercent: number;
  month: number;
  monthPercent: number;
  year: number;
  yearPercent: number;
  allTime: number;
  allTimePercent: number;

  // Drawdown
  currentDrawdown: number;
  currentDrawdownPercent: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  historicalMaxDrawdown: number;
  historicalMaxDrawdownPercent: number;

  // Attribution
  byStrategy: StrategyPnL[];
  byRegime: RegimePnL[];

  // Analysis
  winRate: number;
  averageWin: number;
  averageLoss: number;
  expectancy: number;
  tradeCount: number;
}

interface StrategyPnL {
  id: string;
  name: string;
  pnl: number;
  pnlPercent: number;
  trades: number;
  regimeAligned: boolean;
}

interface RegimePnL {
  regime: string;
  pnl: number;
  pnlPercent: number;
  duration: string;
}

interface PnLDashboardProps {
  /** Current P&L data */
  data?: Partial<PnLData>;
  /** Show expanded view */
  expanded?: boolean;
  /** Callback when expand toggled */
  onExpandChange?: (expanded: boolean) => void;
  /** Show compact header-friendly view */
  compact?: boolean;
  /** Custom class name */
  className?: string;
}

// =========================================================================
// Helper Components
// =========================================================================

function PnLNumber({
  value,
  percent,
  label,
  size = 'md',
  showTrend = false,
}: {
  value: number;
  percent?: number;
  label: string;
  size?: 'sm' | 'md' | 'lg' | 'hero';
  showTrend?: boolean;
}) {
  const isPositive = value >= 0;
  const formatted = `${isPositive ? '+' : '-'}$${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;

  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-lg',
    lg: 'text-2xl',
    hero: 'text-4xl font-bold',
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{label}</span>
            <div className="flex items-center gap-2">
              {showTrend && (
                isPositive ? (
                  <TrendingUp className={cn('h-4 w-4 text-green-500', size === 'hero' && 'h-6 w-6')} />
                ) : (
                  <TrendingDown className={cn('h-4 w-4 text-red-500', size === 'hero' && 'h-6 w-6')} />
                )
              )}
              <span className={cn(
                sizeClasses[size],
                'font-mono',
                isPositive ? 'text-green-500' : 'text-red-500'
              )}>
                {formatted}
              </span>
              {percent !== undefined && (
                <span className={cn(
                  'text-xs font-mono',
                  isPositive ? 'text-green-500/70' : 'text-red-500/70'
                )}>
                  ({isPositive ? '+' : ''}{percent.toFixed(2)}%)
                </span>
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">{label}: {formatted}</p>
          {percent !== undefined && (
            <p className="text-xs text-muted-foreground">
              {percent.toFixed(2)}% of portfolio
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function DrawdownIndicator({
  current,
  currentPercent,
  historical,
  historicalPercent,
}: {
  current: number;
  currentPercent: number;
  historical: number;
  historicalPercent: number;
}) {
  const severity = currentPercent < -10 ? 'critical' : currentPercent < -5 ? 'warning' : 'normal';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Drawdown</span>
              <span className={cn(
                'font-mono font-medium',
                severity === 'critical' && 'text-red-500',
                severity === 'warning' && 'text-yellow-500',
                severity === 'normal' && 'text-muted-foreground'
              )}>
                {currentPercent.toFixed(1)}%
              </span>
            </div>
            <Progress
              value={Math.min(100, Math.abs(currentPercent / historicalPercent) * 100)}
              className={cn(
                'h-2',
                severity === 'critical' && '[&>div]:bg-red-500',
                severity === 'warning' && '[&>div]:bg-yellow-500'
              )}
            />
            <p className="text-[10px] text-muted-foreground">
              Historical max: {historicalPercent.toFixed(1)}%
            </p>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">Current Drawdown: {currentPercent.toFixed(2)}%</p>
          <p className="text-xs text-muted-foreground">
            Historical max: {historicalPercent.toFixed(2)}%
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {severity === 'normal' && 'Within normal range'}
            {severity === 'warning' && 'Approaching historical max'}
            {severity === 'critical' && 'Exceeding normal parameters'}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function StrategyAttribution({ strategies }: { strategies: StrategyPnL[] }) {
  // Sort by absolute contribution
  const sorted = [...strategies].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  const maxPnL = Math.max(...strategies.map(s => Math.abs(s.pnl)), 1);

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium flex items-center gap-2">
        <BarChart3 className="h-4 w-4" />
        Strategy Attribution
      </h4>
      <div className="space-y-1.5">
        {sorted.slice(0, 5).map(strategy => (
          <div key={strategy.id} className="flex items-center gap-2">
            <span className="text-xs w-24 truncate">{strategy.name}</span>
            <div className="flex-1 h-4 bg-muted/30 rounded overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all',
                  strategy.pnl >= 0 ? 'bg-green-500/60' : 'bg-red-500/60'
                )}
                style={{ width: `${(Math.abs(strategy.pnl) / maxPnL) * 100}%` }}
              />
            </div>
            <span className={cn(
              'text-xs font-mono w-16 text-right',
              strategy.pnl >= 0 ? 'text-green-500' : 'text-red-500'
            )}>
              {strategy.pnl >= 0 ? '+' : '-'}${Math.abs(strategy.pnl).toLocaleString()}
            </span>
            {strategy.regimeAligned && (
              <Badge variant="outline" className="text-[8px] px-1 py-0">
                aligned
              </Badge>
            )}
          </div>
        ))}
        {strategies.length > 5 && (
          <p className="text-xs text-muted-foreground text-center">
            +{strategies.length - 5} more strategies
          </p>
        )}
      </div>
    </div>
  );
}

function RegimeAttribution({ regimes }: { regimes: RegimePnL[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium flex items-center gap-2">
        <Activity className="h-4 w-4" />
        Regime Attribution
      </h4>
      <div className="grid grid-cols-2 gap-2">
        {regimes.map(regime => (
          <div
            key={regime.regime}
            className={cn(
              'p-2 rounded border',
              regime.pnl >= 0
                ? 'bg-green-500/5 border-green-500/20'
                : 'bg-red-500/5 border-red-500/20'
            )}
          >
            <div className="text-xs text-muted-foreground">{regime.regime}</div>
            <div className={cn(
              'font-mono font-medium',
              regime.pnl >= 0 ? 'text-green-500' : 'text-red-500'
            )}>
              {regime.pnl >= 0 ? '+' : '-'}${Math.abs(regime.pnl).toLocaleString()}
            </div>
            <div className="text-[10px] text-muted-foreground">{regime.duration}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// =========================================================================
// Main Component
// =========================================================================

export function PnLDashboard({
  data,
  expanded = false,
  onExpandChange,
  compact = false,
  className,
}: PnLDashboardProps) {
  const [isExpanded, setIsExpanded] = useState(expanded);
  const [pnlData, setPnlData] = useState<PnLData | null>(null);

  // Default/demo data
  const displayData: PnLData = pnlData || {
    realtime: data?.realtime ?? 0,
    today: data?.today ?? 1234,
    todayPercent: data?.todayPercent ?? 0.12,
    week: data?.week ?? 5670,
    weekPercent: data?.weekPercent ?? 0.57,
    month: data?.month ?? 12340,
    monthPercent: data?.monthPercent ?? 1.23,
    year: data?.year ?? 89000,
    yearPercent: data?.yearPercent ?? 8.9,
    allTime: data?.allTime ?? 156000,
    allTimePercent: data?.allTimePercent ?? 15.6,
    currentDrawdown: data?.currentDrawdown ?? -5200,
    currentDrawdownPercent: data?.currentDrawdownPercent ?? -5.2,
    maxDrawdown: data?.maxDrawdown ?? -8900,
    maxDrawdownPercent: data?.maxDrawdownPercent ?? -8.9,
    historicalMaxDrawdown: data?.historicalMaxDrawdown ?? -12000,
    historicalMaxDrawdownPercent: data?.historicalMaxDrawdownPercent ?? -12,
    byStrategy: data?.byStrategy ?? [
      { id: '1', name: 'ES Momentum', pnl: 890, pnlPercent: 0.09, trades: 5, regimeAligned: true },
      { id: '2', name: 'NQ Mean Rev', pnl: -230, pnlPercent: -0.02, trades: 3, regimeAligned: false },
      { id: '3', name: 'ES Breakout', pnl: 574, pnlPercent: 0.06, trades: 2, regimeAligned: true },
    ],
    byRegime: data?.byRegime ?? [
      { regime: 'Trending', pnl: 1200, pnlPercent: 0.12, duration: '14h' },
      { regime: 'Mean Rev', pnl: 34, pnlPercent: 0.003, duration: '4h' },
    ],
    winRate: data?.winRate ?? 0.62,
    averageWin: data?.averageWin ?? 450,
    averageLoss: data?.averageLoss ?? -280,
    expectancy: data?.expectancy ?? 125,
    tradeCount: data?.tradeCount ?? 10,
  };

  const handleExpandToggle = () => {
    const newState = !isExpanded;
    setIsExpanded(newState);
    onExpandChange?.(newState);
  };

  // Compact view for header
  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              onClick={handleExpandToggle}
              className={cn(
                'h-full px-3 gap-2 font-mono',
                displayData.today >= 0
                  ? 'text-green-500 hover:text-green-600 hover:bg-green-500/10'
                  : 'text-red-500 hover:text-red-600 hover:bg-red-500/10',
                className
              )}
            >
              {displayData.today >= 0 ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              <span className="font-semibold">
                {displayData.today >= 0 ? '+' : '-'}$
                {Math.abs(displayData.today).toLocaleString()}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">Today's P&L</p>
            <p className="text-xs text-muted-foreground">
              {displayData.todayPercent.toFixed(2)}% of portfolio
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Click to expand full dashboard
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Card className={cn('overflow-hidden', className)}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-lg flex items-center gap-2">
                P&L Dashboard
                <Info className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
              <CardDescription>Portfolio performance overview</CardDescription>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 px-2">
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Hero P&L */}
          <div className="flex items-center justify-between">
            <PnLNumber
              value={displayData.today}
              percent={displayData.todayPercent}
              label="Today"
              size="hero"
              showTrend
            />
            <DrawdownIndicator
              current={displayData.currentDrawdown}
              currentPercent={displayData.currentDrawdownPercent}
              historical={displayData.historicalMaxDrawdown}
              historicalPercent={displayData.historicalMaxDrawdownPercent}
            />
          </div>

          {/* Time Period Summary */}
          <div className="grid grid-cols-4 gap-4 pt-2 border-t">
            <PnLNumber value={displayData.week} percent={displayData.weekPercent} label="Week" size="sm" />
            <PnLNumber value={displayData.month} percent={displayData.monthPercent} label="Month" size="sm" />
            <PnLNumber value={displayData.year} percent={displayData.yearPercent} label="Year" size="sm" />
            <PnLNumber value={displayData.allTime} percent={displayData.allTimePercent} label="All Time" size="sm" />
          </div>

          {/* Expanded Content */}
          <CollapsibleContent className="space-y-4 pt-4 border-t">
            {/* Strategy Attribution */}
            <StrategyAttribution strategies={displayData.byStrategy} />

            {/* Regime Attribution */}
            <RegimeAttribution regimes={displayData.byRegime} />

            {/* Trade Statistics */}
            <div className="grid grid-cols-4 gap-4 pt-4 border-t">
              <div className="text-center">
                <div className="text-2xl font-bold">{(displayData.winRate * 100).toFixed(0)}%</div>
                <div className="text-xs text-muted-foreground">Win Rate</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-500">
                  ${displayData.averageWin.toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">Avg Win</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-500">
                  ${Math.abs(displayData.averageLoss).toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">Avg Loss</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">${displayData.expectancy.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Expectancy</div>
              </div>
            </div>
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}

export default PnLDashboard;
