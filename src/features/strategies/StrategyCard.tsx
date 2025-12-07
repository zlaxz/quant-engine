/**
 * StrategyCard - Compact card for strategy library grid
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Play, Eye, Beaker, Zap, Activity } from 'lucide-react';
import type { Strategy, StrategyCategory, StrategyStatus } from './types';

interface StrategyCardProps {
  strategy: Strategy;
  onView: (id: string) => void;
  onRun: (id: string) => void;
}

const categoryIcons: Record<StrategyCategory, typeof TrendingUp> = {
  gamma: Zap,
  theta: TrendingDown,
  vega: Activity,
  momentum: TrendingUp,
  'mean-reversion': TrendingDown,
  custom: Beaker,
};

const categoryColors: Record<StrategyCategory, string> = {
  gamma: 'text-purple-400 bg-purple-500/20',
  theta: 'text-green-400 bg-green-500/20',
  vega: 'text-blue-400 bg-blue-500/20',
  momentum: 'text-orange-400 bg-orange-500/20',
  'mean-reversion': 'text-cyan-400 bg-cyan-500/20',
  custom: 'text-gray-400 bg-gray-500/20',
};

const statusColors: Record<StrategyStatus, string> = {
  research: 'bg-amber-500/20 text-amber-400 border-amber-500/50',
  paper: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
  live: 'bg-green-500/20 text-green-400 border-green-500/50',
  retired: 'bg-gray-500/20 text-gray-400 border-gray-500/50',
};

export function StrategyCard({ strategy, onView, onRun }: StrategyCardProps) {
  const CategoryIcon = categoryIcons[strategy.category];
  const isPositiveSharpe = strategy.metrics.sharpe >= 1.5;
  const isHighWinRate = strategy.metrics.winRate >= 0.6;

  return (
    <Card className="bg-card/50 backdrop-blur hover:bg-card/70 transition-all cursor-pointer group">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className={cn('p-1.5 rounded-lg', categoryColors[strategy.category])}>
              <CategoryIcon className="h-4 w-4" />
            </div>
            <CardTitle className="text-sm font-semibold">{strategy.name}</CardTitle>
          </div>
          <Badge variant="outline" className={cn('text-[10px]', statusColors[strategy.status])}>
            {strategy.status.toUpperCase()}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-3 space-y-3">
        {/* Metrics */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className={cn(
              'text-lg font-bold font-mono',
              isPositiveSharpe ? 'text-green-500' : 'text-muted-foreground'
            )}>
              {strategy.metrics.sharpe.toFixed(2)}
            </div>
            <div className="text-[10px] text-muted-foreground">Sharpe</div>
          </div>
          <div className="text-center">
            <div className={cn(
              'text-lg font-bold font-mono',
              isHighWinRate ? 'text-green-500' : 'text-muted-foreground'
            )}>
              {(strategy.metrics.winRate * 100).toFixed(0)}%
            </div>
            <div className="text-[10px] text-muted-foreground">Win Rate</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold font-mono text-red-400">
              {(strategy.metrics.maxDrawdown * 100).toFixed(1)}%
            </div>
            <div className="text-[10px] text-muted-foreground">Max DD</div>
          </div>
        </div>

        {/* Regime Tags */}
        <div className="flex flex-wrap gap-1">
          {strategy.optimalRegimes.slice(0, 2).map(regime => (
            <Badge key={regime} variant="secondary" className="text-[9px] px-1.5 py-0">
              {regime.replace('_', ' ')}
            </Badge>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={(e) => { e.stopPropagation(); onView(strategy.id); }}
          >
            <Eye className="h-3 w-3 mr-1" />
            View
          </Button>
          <Button
            variant="default"
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={(e) => { e.stopPropagation(); onRun(strategy.id); }}
          >
            <Play className="h-3 w-3 mr-1" />
            Run
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default StrategyCard;
