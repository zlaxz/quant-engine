/**
 * StrategyDetail - Deep dive view for a single strategy
 *
 * PHASE 4: Strategy Management
 *
 * Features:
 * - Full equity curve
 * - Trade-by-trade log
 * - Plain English explanation
 * - Regime performance breakdown
 * - Correlation with other strategies
 * - Health indicators
 *
 * ADHD Design:
 * - Tabs for organized information
 * - Key metrics prominent
 * - Plain English always visible
 */

import { useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  BarChart3,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Target,
  Zap,
  FileText,
  History,
  Layers,
  Edit,
  Pause,
  Play,
  ArrowUpRight,
  ChevronLeft,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatRelativeTime, formatAbsoluteTime } from '@/lib/timeAnchor';
import { Strategy } from './StrategyCard';

// =========================================================================
// Types
// =========================================================================

interface Trade {
  id: string;
  timestamp: string;
  symbol: string;
  direction: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  regime: string;
}

interface RegimePerformance {
  regime: string;
  trades: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
  sharpe: number;
}

interface CorrelatedStrategy {
  id: string;
  name: string;
  correlation: number;
  recommendation: string;
}

interface StrategyDetailProps {
  strategy: Strategy;
  trades?: Trade[];
  regimePerformance?: RegimePerformance[];
  correlatedStrategies?: CorrelatedStrategy[];
  equityData?: number[];
  onBack?: () => void;
  onPause?: (strategy: Strategy, reason: string) => void;
  onResume?: (strategy: Strategy) => void;
  onPromote?: (strategy: Strategy, reason: string) => void;
  onRetire?: (strategy: Strategy, reason: string) => void;
  onUpdateDescription?: (strategy: Strategy, description: string) => void;
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
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
  },
  validation: {
    label: 'Validation',
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
  },
  paper: {
    label: 'Paper Trading',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
  },
  live: {
    label: 'LIVE',
    color: 'text-green-600',
    bgColor: 'bg-green-100',
  },
  paused: {
    label: 'Paused',
    color: 'text-orange-600',
    bgColor: 'bg-orange-100',
  },
  retired: {
    label: 'Retired',
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
  },
};

const REGIME_CONFIG: Record<string, { label: string; color: string }> = {
  trending: { label: 'Trending', color: 'text-green-500' },
  meanReverting: { label: 'Mean Reverting', color: 'text-blue-500' },
  volatile: { label: 'Volatile', color: 'text-yellow-500' },
  uncertain: { label: 'Uncertain', color: 'text-gray-500' },
  any: { label: 'All Regimes', color: 'text-purple-500' },
};

// =========================================================================
// Component
// =========================================================================

export function StrategyDetail({
  strategy,
  trades = [],
  regimePerformance = [],
  correlatedStrategies = [],
  equityData = [],
  onBack,
  onPause,
  onResume,
  onPromote,
  onRetire,
  onUpdateDescription,
  className,
}: StrategyDetailProps) {
  const [editingDescription, setEditingDescription] = useState(false);
  const [newDescription, setNewDescription] = useState(strategy.description);
  const [actionReason, setActionReason] = useState('');

  const statusConfig = STATUS_CONFIG[strategy.status];
  const regimeConfig = REGIME_CONFIG[strategy.bestRegime];

  const canPromote =
    strategy.status === 'discovery' ||
    strategy.status === 'validation' ||
    strategy.status === 'paper';
  const canPause = strategy.status === 'live' || strategy.status === 'paper';
  const canResume = strategy.status === 'paused';

  // Calculate trade stats
  const tradeStats = {
    total: trades.length,
    winners: trades.filter((t) => t.pnl > 0).length,
    losers: trades.filter((t) => t.pnl < 0).length,
    avgWin:
      trades.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0) /
        trades.filter((t) => t.pnl > 0).length || 0,
    avgLoss:
      trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0) /
        trades.filter((t) => t.pnl < 0).length || 0,
    totalPnl: trades.reduce((sum, t) => sum + t.pnl, 0),
  };

  const handleSaveDescription = () => {
    onUpdateDescription?.(strategy, newDescription);
    setEditingDescription(false);
  };

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack} className="mb-2">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back to Library
            </Button>
          )}
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{strategy.name}</h1>
            <Badge
              variant="secondary"
              className={cn('text-sm', statusConfig.color, statusConfig.bgColor)}
            >
              {statusConfig.label}
            </Badge>
            {strategy.performanceTrend === 'degrading' && (
              <Badge variant="destructive">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Degrading
              </Badge>
            )}
            {strategy.currentRegimeAligned && (
              <Badge variant="outline" className="text-green-600 border-green-500">
                <CheckCircle className="h-3 w-3 mr-1" />
                Regime Aligned
              </Badge>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {canPromote && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="default">
                  <ArrowUpRight className="h-4 w-4 mr-1" />
                  Promote
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Promote Strategy</DialogTitle>
                  <DialogDescription>
                    Promoting "{strategy.name}" from {strategy.status} to{' '}
                    {strategy.status === 'discovery'
                      ? 'validation'
                      : strategy.status === 'validation'
                        ? 'paper trading'
                        : 'live trading'}
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  placeholder="Reason for promotion..."
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                />
                <DialogFooter>
                  <Button
                    onClick={() => {
                      onPromote?.(strategy, actionReason);
                      setActionReason('');
                    }}
                    disabled={!actionReason}
                  >
                    Confirm Promotion
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {canPause && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Pause className="h-4 w-4 mr-1" />
                  Pause
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Pause Strategy</DialogTitle>
                  <DialogDescription>
                    Why are you pausing "{strategy.name}"?
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  placeholder="Reason for pausing..."
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                />
                <DialogFooter>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      onPause?.(strategy, actionReason);
                      setActionReason('');
                    }}
                    disabled={!actionReason}
                  >
                    Confirm Pause
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {canResume && (
            <Button variant="default" onClick={() => onResume?.(strategy)}>
              <Play className="h-4 w-4 mr-1" />
              Resume
            </Button>
          )}
        </div>
      </div>

      {/* Description Section */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Strategy Description
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditingDescription(!editingDescription)}
            >
              <Edit className="h-4 w-4 mr-1" />
              Edit
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {editingDescription ? (
            <div className="space-y-2">
              <Textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="[Action] when [condition] because [hypothesis]"
                className="min-h-[100px]"
              />
              <p className="text-xs text-muted-foreground">
                Format: "[Action] when [condition] because [hypothesis]"
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveDescription}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setNewDescription(strategy.description);
                    setEditingDescription(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm">
              {strategy.description || (
                <span className="italic text-orange-500">
                  No description yet. Click Edit to add one.
                </span>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Sharpe Ratio</div>
            <div
              className={cn(
                'text-2xl font-bold font-mono',
                strategy.sharpe >= 2
                  ? 'text-green-500'
                  : strategy.sharpe >= 1
                    ? 'text-yellow-500'
                    : 'text-red-500'
              )}
            >
              {strategy.sharpe.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Win Rate</div>
            <div className="text-2xl font-bold font-mono">
              {(strategy.winRate * 100).toFixed(0)}%
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Max Drawdown</div>
            <div className="text-2xl font-bold font-mono text-red-500">
              {strategy.maxDrawdown.toFixed(1)}%
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">30d Returns</div>
            <div
              className={cn(
                'text-2xl font-bold font-mono',
                strategy.returns30d >= 0 ? 'text-green-500' : 'text-red-500'
              )}
            >
              {strategy.returns30d >= 0 ? '+' : ''}
              {strategy.returns30d.toFixed(1)}%
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Expectancy</div>
            <div
              className={cn(
                'text-2xl font-bold font-mono',
                strategy.expectancy >= 0 ? 'text-green-500' : 'text-red-500'
              )}
            >
              ${strategy.expectancy.toFixed(0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Confidence</div>
            <div className="text-2xl font-bold font-mono">
              {strategy.confidence}%
            </div>
            <Progress
              value={strategy.confidence}
              className="h-1 mt-2"
              indicatorClassName={cn(
                strategy.confidence >= 70
                  ? 'bg-green-500'
                  : strategy.confidence >= 40
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
              )}
            />
          </CardContent>
        </Card>
      </div>

      {/* Tabs for detailed info */}
      <Tabs defaultValue="trades" className="w-full">
        <TabsList>
          <TabsTrigger value="trades">
            <History className="h-4 w-4 mr-2" />
            Trade History ({trades.length})
          </TabsTrigger>
          <TabsTrigger value="regimes">
            <Layers className="h-4 w-4 mr-2" />
            Regime Performance
          </TabsTrigger>
          <TabsTrigger value="correlations">
            <BarChart3 className="h-4 w-4 mr-2" />
            Correlations
          </TabsTrigger>
          <TabsTrigger value="health">
            <Activity className="h-4 w-4 mr-2" />
            Health
          </TabsTrigger>
        </TabsList>

        {/* Trade History Tab */}
        <TabsContent value="trades" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Recent Trades</CardTitle>
                <div className="flex gap-4 text-sm">
                  <span className="text-green-500">
                    {tradeStats.winners} wins (avg ${tradeStats.avgWin.toFixed(0)})
                  </span>
                  <span className="text-red-500">
                    {tradeStats.losers} losses (avg ${Math.abs(tradeStats.avgLoss).toFixed(0)})
                  </span>
                  <span
                    className={cn(
                      'font-medium',
                      tradeStats.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'
                    )}
                  >
                    Total: {tradeStats.totalPnl >= 0 ? '+' : ''}$
                    {tradeStats.totalPnl.toFixed(0)}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {trades.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No trades recorded yet
                </p>
              ) : (
                <div className="space-y-2">
                  {trades.slice(0, 20).map((trade) => (
                    <div
                      key={trade.id}
                      className="flex items-center justify-between p-2 bg-muted rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <Badge
                          variant="outline"
                          className={cn(
                            trade.direction === 'long'
                              ? 'border-green-500 text-green-600'
                              : 'border-red-500 text-red-600'
                          )}
                        >
                          {trade.direction.toUpperCase()}
                        </Badge>
                        <span className="font-medium">{trade.symbol}</span>
                        <span className="text-sm text-muted-foreground">
                          {formatRelativeTime(trade.timestamp)}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge variant="secondary" className="text-xs">
                          {REGIME_CONFIG[trade.regime]?.label || trade.regime}
                        </Badge>
                        <span
                          className={cn(
                            'font-mono font-medium',
                            trade.pnl >= 0 ? 'text-green-500' : 'text-red-500'
                          )}
                        >
                          {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Regime Performance Tab */}
        <TabsContent value="regimes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Performance by Regime</CardTitle>
              <CardDescription>
                Best regime:{' '}
                <span className={regimeConfig.color}>{regimeConfig.label}</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {regimePerformance.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  Not enough data for regime analysis
                </p>
              ) : (
                <div className="space-y-4">
                  {regimePerformance.map((rp) => (
                    <div key={rp.regime} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className={REGIME_CONFIG[rp.regime]?.color}>
                          {REGIME_CONFIG[rp.regime]?.label || rp.regime}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {rp.trades} trades
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Win Rate: </span>
                          <span className="font-medium">
                            {(rp.winRate * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Avg P&L: </span>
                          <span
                            className={cn(
                              'font-medium',
                              rp.avgPnl >= 0 ? 'text-green-500' : 'text-red-500'
                            )}
                          >
                            ${rp.avgPnl.toFixed(0)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Total: </span>
                          <span
                            className={cn(
                              'font-medium',
                              rp.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'
                            )}
                          >
                            ${rp.totalPnl.toFixed(0)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Sharpe: </span>
                          <span className="font-medium">{rp.sharpe.toFixed(2)}</span>
                        </div>
                      </div>
                      <Separator />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Correlations Tab */}
        <TabsContent value="correlations" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Correlated Strategies</CardTitle>
              <CardDescription>
                High correlation can indicate redundant risk exposure
              </CardDescription>
            </CardHeader>
            <CardContent>
              {correlatedStrategies.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No significant correlations detected
                </p>
              ) : (
                <div className="space-y-3">
                  {correlatedStrategies.map((cs) => (
                    <div
                      key={cs.id}
                      className={cn(
                        'p-3 rounded-lg border',
                        cs.correlation > 0.85
                          ? 'border-red-500 bg-red-500/10'
                          : cs.correlation > 0.7
                            ? 'border-yellow-500 bg-yellow-500/10'
                            : 'border-muted'
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">{cs.name}</span>
                        <Badge
                          variant={cs.correlation > 0.85 ? 'destructive' : 'secondary'}
                        >
                          {(cs.correlation * 100).toFixed(0)}% correlation
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {cs.recommendation}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Health Tab */}
        <TabsContent value="health" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Strategy Health</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Performance Trend */}
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <span>Performance Trend</span>
                <Badge
                  variant={
                    strategy.performanceTrend === 'improving'
                      ? 'default'
                      : strategy.performanceTrend === 'stable'
                        ? 'secondary'
                        : 'destructive'
                  }
                >
                  {strategy.performanceTrend === 'improving' && (
                    <TrendingUp className="h-3 w-3 mr-1" />
                  )}
                  {strategy.performanceTrend === 'degrading' && (
                    <TrendingDown className="h-3 w-3 mr-1" />
                  )}
                  {strategy.performanceTrend.charAt(0).toUpperCase() +
                    strategy.performanceTrend.slice(1)}
                </Badge>
              </div>

              {/* Consecutive Losses */}
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <span>Consecutive Losses</span>
                <Badge
                  variant={
                    strategy.consecutiveLosses >= 5
                      ? 'destructive'
                      : strategy.consecutiveLosses >= 3
                        ? 'secondary'
                        : 'outline'
                  }
                >
                  {strategy.consecutiveLosses}
                </Badge>
              </div>

              {/* Last Trade */}
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <span>Last Trade</span>
                <span className="text-muted-foreground">
                  {strategy.lastTradeAt
                    ? formatRelativeTime(strategy.lastTradeAt)
                    : 'No trades yet'}
                </span>
              </div>

              {/* Exposure */}
              <div className="space-y-2 p-3 bg-muted rounded-lg">
                <div className="flex items-center justify-between">
                  <span>Current Exposure</span>
                  <span className="font-mono">
                    ${strategy.currentExposure.toLocaleString()} /{' '}
                    ${strategy.maxExposure.toLocaleString()}
                  </span>
                </div>
                <Progress
                  value={(strategy.currentExposure / strategy.maxExposure) * 100}
                  className="h-2"
                />
              </div>

              {/* Pause Reason (if paused) */}
              {strategy.status === 'paused' && strategy.pauseReason && (
                <div className="p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                  <div className="font-medium text-orange-600 mb-1">Pause Reason</div>
                  <p className="text-sm">{strategy.pauseReason}</p>
                  {strategy.pausedAt && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Paused {formatRelativeTime(strategy.pausedAt)}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default StrategyDetail;
