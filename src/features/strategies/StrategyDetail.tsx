/**
 * StrategyDetail - Full detail view for a single strategy
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  Play,
  Edit,
  Copy,
  Download,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Target,
  Shield,
  Clock,
  Calendar,
  User,
  FileText,
  ExternalLink,
} from 'lucide-react';
import type { Strategy, StrategyLeg } from './types';

interface StrategyDetailProps {
  strategy: Strategy;
  onBack: () => void;
  onRun: () => void;
  onEdit?: () => void;
  onClone?: () => void;
  onExport?: () => void;
  className?: string;
}

const statusColors = {
  research: 'bg-amber-500/20 text-amber-400',
  paper: 'bg-blue-500/20 text-blue-400',
  live: 'bg-green-500/20 text-green-400',
  retired: 'bg-gray-500/20 text-gray-400',
};

function LegDisplay({ leg, index }: { leg: StrategyLeg; index: number }) {
  const sideColor = leg.side === 'long' ? 'text-green-400' : 'text-red-400';
  const strikeLabel = leg.strikeType === 'delta'
    ? `${leg.strike}Δ`
    : leg.strikeType === 'atm-offset'
      ? leg.strike === 0 ? 'ATM' : `ATM${leg.strike > 0 ? '+' : ''}${leg.strike}`
      : `$${leg.strike}`;

  return (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
      <span className="text-xs text-muted-foreground w-4">{index + 1}</span>
      <Badge variant="outline" className={cn('text-xs', sideColor)}>
        {leg.side === 'long' ? '+' : '-'}{leg.quantity}
      </Badge>
      <span className="text-sm font-medium capitalize">{leg.type}</span>
      <span className="text-sm text-muted-foreground">{strikeLabel}</span>
      <span className="text-xs text-muted-foreground ml-auto">{leg.expiry}</span>
    </div>
  );
}

export function StrategyDetail({
  strategy,
  onBack,
  onRun,
  onEdit,
  onClone,
  onExport,
  className,
}: StrategyDetailProps) {
  const { metrics } = strategy;

  return (
    <Card className={cn('bg-card/50 backdrop-blur flex flex-col h-full', className)}>
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">{strategy.name}</CardTitle>
              <Badge className={cn('text-xs', statusColors[strategy.status])}>
                {strategy.status.toUpperCase()}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {strategy.description}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 mt-3">
          <Button onClick={onRun} className="flex-1">
            <Play className="h-4 w-4 mr-2" />
            Run Backtest
          </Button>
          <Button variant="outline" onClick={onEdit}>
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button variant="outline" size="icon" onClick={onClone}>
            <Copy className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={onExport}>
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto px-4 pb-4 space-y-4">
        {/* Strategy Structure */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Target className="h-4 w-4" />
            Structure
          </h3>
          <div className="space-y-1">
            {strategy.legs.map((leg, i) => (
              <LegDisplay key={i} leg={leg} index={i} />
            ))}
          </div>
        </div>

        <Separator />

        {/* Performance Metrics */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Performance
          </h3>
          <div className="grid grid-cols-4 gap-3">
            <MetricCard label="Sharpe" value={metrics.sharpe.toFixed(2)} good={metrics.sharpe >= 1.5} />
            <MetricCard label="Sortino" value={metrics.sortino.toFixed(2)} good={metrics.sortino >= 2} />
            <MetricCard label="Calmar" value={metrics.calmar.toFixed(2)} good={metrics.calmar >= 1} />
            <MetricCard label="Max DD" value={`${(metrics.maxDrawdown * 100).toFixed(1)}%`} bad />
            <MetricCard label="Win Rate" value={`${(metrics.winRate * 100).toFixed(0)}%`} good={metrics.winRate >= 0.6} />
            <MetricCard label="Profit Factor" value={metrics.profitFactor.toFixed(2)} good={metrics.profitFactor >= 1.5} />
            <MetricCard label="Avg Win" value={`${(metrics.avgWin * 100).toFixed(1)}%`} good />
            <MetricCard label="Avg Loss" value={`${(metrics.avgLoss * 100).toFixed(1)}%`} bad />
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {metrics.totalTrades} trades
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Avg {metrics.avgDuration}
            </span>
          </div>
        </div>

        <Separator />

        {/* Regime Alignment */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-green-400">
              <Target className="h-4 w-4" />
              Optimal Regimes
            </h3>
            <div className="flex flex-wrap gap-1">
              {strategy.optimalRegimes.map(regime => (
                <Badge key={regime} variant="secondary" className="text-xs bg-green-500/20 text-green-400">
                  {regime.replace('_', ' ')}
                </Badge>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-4 w-4" />
              Avoid Regimes
            </h3>
            <div className="flex flex-wrap gap-1">
              {strategy.avoidRegimes.map(regime => (
                <Badge key={regime} variant="secondary" className="text-xs bg-red-500/20 text-red-400">
                  {regime.replace('_', ' ')}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <Separator />

        {/* Risk Parameters */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Risk Parameters
          </h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between p-2 rounded bg-muted/30">
              <span className="text-muted-foreground">Max Position Size</span>
              <span className="font-mono">{(strategy.riskConfig.maxPositionSize * 100).toFixed(0)}%</span>
            </div>
            <div className="flex justify-between p-2 rounded bg-muted/30">
              <span className="text-muted-foreground">Max Loss Per Trade</span>
              <span className="font-mono">{(strategy.riskConfig.maxLoss * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between p-2 rounded bg-muted/30">
              <span className="text-muted-foreground">Daily Loss Limit</span>
              <span className="font-mono">{(strategy.riskConfig.dailyLossLimit * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between p-2 rounded bg-muted/30">
              <span className="text-muted-foreground">Max Open Positions</span>
              <span className="font-mono">{strategy.riskConfig.maxOpenPositions}</span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Metadata */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {strategy.author}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Created {strategy.createdAt.toLocaleDateString()}
            </span>
          </div>
          <span>Updated {strategy.updatedAt.toLocaleDateString()}</span>
        </div>

        {/* Notes */}
        {strategy.notes && (
          <div className="p-3 rounded-lg bg-muted/30 text-sm">
            <p className="text-muted-foreground">{strategy.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricCard({
  label,
  value,
  good,
  bad,
}: {
  label: string;
  value: string;
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <div className="text-center p-2 rounded-lg bg-muted/30">
      <div className={cn(
        'text-lg font-bold font-mono',
        good && 'text-green-500',
        bad && 'text-red-400',
        !good && !bad && 'text-foreground'
      )}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

export default StrategyDetail;
