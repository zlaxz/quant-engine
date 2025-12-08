/**
 * BacktestMonitor - Backtest queue and results visibility
 *
 * PHASE 5: Operational Excellence
 *
 * Features:
 * - Active backtest with progress
 * - Queue of pending backtests
 * - Recent results with quick metrics
 * - Parameter comparison view
 * - Error handling and retry
 *
 * ADHD Design:
 * - Progress visible at a glance
 * - Queue depth obvious
 * - Results color-coded by quality
 * - Quick actions available
 */

import { useState, useMemo } from 'react';
import {
  FlaskConical,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Play,
  Pause,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Trash2,
  Eye,
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
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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

interface BacktestParameters {
  strategy: string;
  symbol: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  [key: string]: any;
}

interface BacktestResult {
  sharpe: number;
  returns: number;
  maxDrawdown: number;
  winRate: number;
  tradeCount: number;
  profitFactor: number;
}

interface Backtest {
  id: string;
  name: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  parameters: BacktestParameters;
  result?: BacktestResult;
  progress: number;
  startedAt?: Date | string;
  completedAt?: Date | string;
  duration?: string;
  error?: string;
  priority: 'high' | 'medium' | 'low';
}

interface BacktestMonitorProps {
  backtests: Backtest[];
  onViewResult?: (backtest: Backtest) => void;
  onRetry?: (backtestId: string) => void;
  onCancel?: (backtestId: string) => void;
  onRemoveFromQueue?: (backtestId: string) => void;
  onPauseQueue?: () => void;
  onResumeQueue?: () => void;
  queuePaused?: boolean;
  compact?: boolean;
  className?: string;
}

// =========================================================================
// Result Quality Assessment
// =========================================================================

function getResultQuality(result: BacktestResult): {
  label: string;
  color: string;
  score: number;
} {
  let score = 0;

  // Sharpe contribution
  if (result.sharpe >= 2) score += 3;
  else if (result.sharpe >= 1.5) score += 2;
  else if (result.sharpe >= 1) score += 1;

  // Win rate contribution
  if (result.winRate >= 0.6) score += 2;
  else if (result.winRate >= 0.5) score += 1;

  // Max drawdown contribution (lower is better)
  if (result.maxDrawdown <= 10) score += 2;
  else if (result.maxDrawdown <= 15) score += 1;

  // Profit factor contribution
  if (result.profitFactor >= 2) score += 2;
  else if (result.profitFactor >= 1.5) score += 1;

  if (score >= 7) return { label: 'Excellent', color: 'text-green-500', score };
  if (score >= 5) return { label: 'Good', color: 'text-blue-500', score };
  if (score >= 3) return { label: 'Fair', color: 'text-yellow-500', score };
  return { label: 'Poor', color: 'text-red-500', score };
}

// =========================================================================
// Backtest Item Component
// =========================================================================

function BacktestItem({
  backtest,
  onView,
  onRetry,
  onCancel,
  onRemove,
  compact = false,
}: {
  backtest: Backtest;
  onView?: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const quality = backtest.result ? getResultQuality(backtest.result) : null;

  return (
    <div
      className={cn(
        'p-3 rounded-lg border',
        backtest.status === 'running' && 'border-blue-500/50 bg-blue-500/5',
        backtest.status === 'failed' && 'border-red-500/50',
        backtest.status === 'complete' && quality?.score && quality.score >= 7 && 'border-green-500/50'
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="font-medium text-sm flex items-center gap-2">
            {backtest.name}
            <Badge
              variant={
                backtest.status === 'running'
                  ? 'default'
                  : backtest.status === 'complete'
                    ? 'secondary'
                    : backtest.status === 'failed'
                      ? 'destructive'
                      : 'outline'
              }
              className="text-xs"
            >
              {backtest.status === 'running' && (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              )}
              {backtest.status === 'complete' && (
                <CheckCircle className="h-3 w-3 mr-1" />
              )}
              {backtest.status === 'failed' && <XCircle className="h-3 w-3 mr-1" />}
              {backtest.status === 'queued' && <Clock className="h-3 w-3 mr-1" />}
              {backtest.status.charAt(0).toUpperCase() + backtest.status.slice(1)}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {backtest.parameters.strategy} • {backtest.parameters.symbol}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {backtest.status === 'complete' && onView && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onView}>
              <Eye className="h-3 w-3" />
            </Button>
          )}
          {backtest.status === 'failed' && onRetry && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onRetry}>
              <RotateCcw className="h-3 w-3" />
            </Button>
          )}
          {backtest.status === 'running' && onCancel && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-red-500"
              onClick={onCancel}
            >
              <XCircle className="h-3 w-3" />
            </Button>
          )}
          {backtest.status === 'queued' && onRemove && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground"
              onClick={onRemove}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar for running */}
      {backtest.status === 'running' && (
        <div className="mb-2">
          <Progress value={backtest.progress} className="h-1.5" />
          <div className="text-xs text-muted-foreground mt-1 text-right">
            {backtest.progress}%
          </div>
        </div>
      )}

      {/* Results for completed */}
      {backtest.status === 'complete' && backtest.result && !compact && (
        <div className="grid grid-cols-3 gap-2 text-xs mt-2 pt-2 border-t">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <div className="text-left">
                  <span className="text-muted-foreground">Sharpe</span>
                  <div
                    className={cn(
                      'font-mono font-medium',
                      backtest.result.sharpe >= 2
                        ? 'text-green-500'
                        : backtest.result.sharpe >= 1
                          ? 'text-yellow-500'
                          : 'text-red-500'
                    )}
                  >
                    {backtest.result.sharpe.toFixed(2)}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>Risk-adjusted returns</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger>
                <div className="text-left">
                  <span className="text-muted-foreground">Return</span>
                  <div
                    className={cn(
                      'font-mono font-medium',
                      backtest.result.returns >= 0 ? 'text-green-500' : 'text-red-500'
                    )}
                  >
                    {backtest.result.returns >= 0 ? '+' : ''}
                    {backtest.result.returns.toFixed(1)}%
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>Total return</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger>
                <div className="text-left">
                  <span className="text-muted-foreground">Max DD</span>
                  <div className="font-mono font-medium text-red-500">
                    {backtest.result.maxDrawdown.toFixed(1)}%
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>Maximum drawdown</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {quality && (
            <div className="col-span-3 mt-1">
              <Badge variant="outline" className={quality.color}>
                {quality.label} ({quality.score}/9)
              </Badge>
            </div>
          )}
        </div>
      )}

      {/* Error for failed */}
      {backtest.status === 'failed' && backtest.error && (
        <div className="mt-2 p-2 bg-red-500/10 rounded text-xs text-red-500">
          {backtest.error}
        </div>
      )}

      {/* Duration */}
      {backtest.duration && (
        <div className="text-xs text-muted-foreground mt-2">
          Duration: {backtest.duration}
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Main Component
// =========================================================================

export function BacktestMonitor({
  backtests,
  onViewResult,
  onRetry,
  onCancel,
  onRemoveFromQueue,
  onPauseQueue,
  onResumeQueue,
  queuePaused = false,
  compact = false,
  className,
}: BacktestMonitorProps) {
  const [showQueue, setShowQueue] = useState(true);
  const [showCompleted, setShowCompleted] = useState(true);

  // Categorize backtests
  const { running, queued, completed, failed } = useMemo(() => {
    return {
      running: backtests.filter((b) => b.status === 'running'),
      queued: backtests.filter((b) => b.status === 'queued'),
      completed: backtests.filter((b) => b.status === 'complete'),
      failed: backtests.filter((b) => b.status === 'failed'),
    };
  }, [backtests]);

  // Stats
  const stats = useMemo(() => {
    const completedResults = completed.filter((b) => b.result);
    const avgSharpe =
      completedResults.length > 0
        ? completedResults.reduce((sum, b) => sum + (b.result?.sharpe || 0), 0) /
          completedResults.length
        : 0;

    return {
      total: backtests.length,
      running: running.length,
      queued: queued.length,
      completed: completed.length,
      failed: failed.length,
      avgSharpe,
    };
  }, [backtests, running, queued, completed, failed]);

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className={compact ? 'pb-2' : undefined}>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              Backtest Monitor
            </CardTitle>
            {!compact && (
              <CardDescription>
                {stats.running > 0
                  ? `${stats.running} running, ${stats.queued} queued`
                  : stats.queued > 0
                    ? `${stats.queued} queued`
                    : 'No active backtests'}
              </CardDescription>
            )}
          </div>

          {/* Queue controls */}
          <div className="flex items-center gap-2">
            {stats.queued > 0 && (
              <>
                {queuePaused ? (
                  <Button variant="outline" size="sm" onClick={onResumeQueue}>
                    <Play className="h-4 w-4 mr-1" />
                    Resume
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={onPauseQueue}>
                    <Pause className="h-4 w-4 mr-1" />
                    Pause
                  </Button>
                )}
              </>
            )}
            <Badge variant="secondary">
              {stats.completed} / {stats.total}
            </Badge>
          </div>
        </div>

        {/* Summary stats */}
        {!compact && (
          <div className="grid grid-cols-5 gap-4 mt-4 text-sm">
            <div>
              <div className="text-muted-foreground">Running</div>
              <div className="font-medium text-blue-500">{stats.running}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Queued</div>
              <div className="font-medium">{stats.queued}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Completed</div>
              <div className="font-medium text-green-500">{stats.completed}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Failed</div>
              <div className="font-medium text-red-500">{stats.failed}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Avg Sharpe</div>
              <div
                className={cn(
                  'font-medium font-mono',
                  stats.avgSharpe >= 1.5
                    ? 'text-green-500'
                    : stats.avgSharpe >= 1
                      ? 'text-yellow-500'
                      : 'text-muted-foreground'
                )}
              >
                {stats.avgSharpe.toFixed(2)}
              </div>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Currently Running */}
        {running.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              Running Now
            </h4>
            {running.map((backtest) => (
              <BacktestItem
                key={backtest.id}
                backtest={backtest}
                onView={onViewResult ? () => onViewResult(backtest) : undefined}
                onCancel={onCancel ? () => onCancel(backtest.id) : undefined}
                compact={compact}
              />
            ))}
          </div>
        )}

        {/* Queue */}
        {queued.length > 0 && (
          <Collapsible open={showQueue} onOpenChange={setShowQueue}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Queue ({queued.length})
                  {queuePaused && (
                    <Badge variant="secondary" className="text-xs">
                      Paused
                    </Badge>
                  )}
                </span>
                {showQueue ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea className="h-[200px] mt-2">
                <div className="space-y-2">
                  {queued.map((backtest, index) => (
                    <div key={backtest.id} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-6">
                        #{index + 1}
                      </span>
                      <div className="flex-1">
                        <BacktestItem
                          backtest={backtest}
                          onRemove={
                            onRemoveFromQueue
                              ? () => onRemoveFromQueue(backtest.id)
                              : undefined
                          }
                          compact
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Completed */}
        {completed.length > 0 && (
          <Collapsible open={showCompleted} onOpenChange={setShowCompleted}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  Completed ({completed.length})
                </span>
                {showCompleted ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea className="h-[300px] mt-2">
                <div className="space-y-2">
                  {completed.map((backtest) => (
                    <BacktestItem
                      key={backtest.id}
                      backtest={backtest}
                      onView={onViewResult ? () => onViewResult(backtest) : undefined}
                      compact={compact}
                    />
                  ))}
                </div>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Failed */}
        {failed.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2 text-red-500">
              <XCircle className="h-4 w-4" />
              Failed ({failed.length})
            </h4>
            <ScrollArea className="h-[150px]">
              <div className="space-y-2">
                {failed.map((backtest) => (
                  <BacktestItem
                    key={backtest.id}
                    backtest={backtest}
                    onRetry={onRetry ? () => onRetry(backtest.id) : undefined}
                    compact={compact}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Empty state */}
        {backtests.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <FlaskConical className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No backtests in progress</p>
            <p className="text-sm">Start a backtest from the strategy detail view</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default BacktestMonitor;
