/**
 * SymphonyOrchestra - 2x2 Regime Grid Visualizer
 *
 * Shows all strategies grouped by their target regime.
 * Active strategies (matching current regime) are highlighted.
 * Dormant strategies (wrong regime) are grayed out.
 *
 * Layout:
 * ┌─────────────────┬─────────────────┐
 * │  LOW_VOL_GRIND  │    MELT_UP      │
 * │   (Calm)        │   (Momentum)    │
 * ├─────────────────┼─────────────────┤
 * │  HIGH_VOL_OSC   │ CRASH_ACCEL     │
 * │   (Choppy)      │   (Panic)       │
 * └─────────────────┴─────────────────┘
 */

import React from 'react';
import {
  Sun,
  Activity,
  Zap,
  TrendingUp,
  Play,
  Pause,
  DollarSign,
  Percent,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { RegimeType } from './RegimeDisplay';

// ============================================================================
// Types
// ============================================================================

export interface StrategySlot {
  id: string;
  name: string;
  targetRegime: RegimeType;
  status: 'active' | 'dormant' | 'pending' | 'failed';
  fitness: number;
  portfolioContribution: number;
  currentPnl?: number;
  allocation?: number; // percentage of portfolio
}

export interface SymphonyOrchestraProps {
  strategies: StrategySlot[];
  currentRegime: RegimeType;
  className?: string;
  onStrategyClick?: (strategy: StrategySlot) => void;
}

// ============================================================================
// Regime Grid Configuration
// ============================================================================

const REGIME_GRID: {
  regime: RegimeType;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  icon: React.ReactNode;
  label: string;
  bgActive: string;
  bgDormant: string;
  borderActive: string;
  textActive: string;
}[] = [
  {
    regime: 'LOW_VOL_GRIND',
    position: 'top-left',
    icon: <Sun className="w-4 h-4" />,
    label: 'Low Vol',
    bgActive: 'bg-green-500/20',
    bgDormant: 'bg-green-500/5',
    borderActive: 'border-green-500/50',
    textActive: 'text-green-400',
  },
  {
    regime: 'MELT_UP',
    position: 'top-right',
    icon: <TrendingUp className="w-4 h-4" />,
    label: 'Melt Up',
    bgActive: 'bg-amber-500/20',
    bgDormant: 'bg-amber-500/5',
    borderActive: 'border-amber-500/50',
    textActive: 'text-amber-400',
  },
  {
    regime: 'HIGH_VOL_OSCILLATION',
    position: 'bottom-left',
    icon: <Activity className="w-4 h-4" />,
    label: 'High Vol',
    bgActive: 'bg-yellow-500/20',
    bgDormant: 'bg-yellow-500/5',
    borderActive: 'border-yellow-500/50',
    textActive: 'text-yellow-400',
  },
  {
    regime: 'CRASH_ACCELERATION',
    position: 'bottom-right',
    icon: <Zap className="w-4 h-4" />,
    label: 'Crash',
    bgActive: 'bg-red-500/20',
    bgDormant: 'bg-red-500/5',
    borderActive: 'border-red-500/50',
    textActive: 'text-red-400',
  },
];

// ============================================================================
// Helper Components
// ============================================================================

function StrategyChip({
  strategy,
  isActive,
  onClick,
}: {
  strategy: StrategySlot;
  isActive: boolean;
  onClick?: () => void;
}) {
  const statusConfig = {
    active: {
      icon: <Play className="w-3 h-3" />,
      class: 'bg-green-500/20 border-green-500/30 text-green-400',
    },
    dormant: {
      icon: <Pause className="w-3 h-3" />,
      class: 'bg-gray-500/10 border-gray-500/20 text-gray-500',
    },
    pending: {
      icon: <Activity className="w-3 h-3 animate-pulse" />,
      class: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400',
    },
    failed: {
      icon: <Zap className="w-3 h-3" />,
      class: 'bg-red-500/20 border-red-500/30 text-red-400',
    },
  };

  const config = statusConfig[strategy.status];

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs',
        'transition-all duration-200 hover:scale-105',
        isActive ? config.class : 'bg-gray-800/50 border-gray-700 text-gray-500',
        onClick && 'cursor-pointer hover:brightness-110'
      )}
    >
      {config.icon}
      <span className="font-medium truncate max-w-[80px]">{strategy.name}</span>
      {strategy.currentPnl !== undefined && (
        <span
          className={cn(
            'font-mono text-[10px]',
            strategy.currentPnl >= 0 ? 'text-green-400' : 'text-red-400'
          )}
        >
          {strategy.currentPnl >= 0 ? '+' : ''}
          {strategy.currentPnl.toFixed(1)}%
        </span>
      )}
    </button>
  );
}

function RegimeQuadrant({
  regime,
  strategies,
  isCurrentRegime,
  config,
  onStrategyClick,
}: {
  regime: RegimeType;
  strategies: StrategySlot[];
  isCurrentRegime: boolean;
  config: (typeof REGIME_GRID)[0];
  onStrategyClick?: (strategy: StrategySlot) => void;
}) {
  const regimeStrategies = strategies.filter((s) => s.targetRegime === regime);
  const activeCount = regimeStrategies.filter((s) => s.status === 'active').length;
  const totalAllocation = regimeStrategies.reduce(
    (sum, s) => sum + (s.allocation ?? 0),
    0
  );

  return (
    <div
      className={cn(
        'p-3 rounded-lg border transition-all duration-300',
        isCurrentRegime ? config.bgActive : config.bgDormant,
        isCurrentRegime ? config.borderActive : 'border-border/30',
        isCurrentRegime && 'ring-2 ring-offset-2 ring-offset-background',
        isCurrentRegime && config.borderActive.replace('border-', 'ring-')
      )}
    >
      {/* Quadrant Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={cn(isCurrentRegime ? config.textActive : 'text-gray-500')}>
            {config.icon}
          </span>
          <span
            className={cn(
              'text-sm font-semibold',
              isCurrentRegime ? config.textActive : 'text-gray-500'
            )}
          >
            {config.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isCurrentRegime && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-background/50">
              LIVE
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground">
            {activeCount}/{regimeStrategies.length}
          </span>
        </div>
      </div>

      {/* Strategy Chips */}
      <div className="flex flex-wrap gap-1.5 min-h-[40px]">
        {regimeStrategies.length > 0 ? (
          regimeStrategies.map((strategy) => (
            <StrategyChip
              key={strategy.id}
              strategy={strategy}
              isActive={isCurrentRegime}
              onClick={onStrategyClick ? () => onStrategyClick(strategy) : undefined}
            />
          ))
        ) : (
          <span className="text-xs text-muted-foreground italic">
            No strategies
          </span>
        )}
      </div>

      {/* Allocation Footer */}
      {totalAllocation > 0 && (
        <div className="flex items-center justify-end gap-1 mt-2 text-[10px] text-muted-foreground">
          <Percent className="w-3 h-3" />
          <span>{totalAllocation.toFixed(1)}% allocated</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function SymphonyOrchestra({
  strategies,
  currentRegime,
  className,
  onStrategyClick,
}: SymphonyOrchestraProps) {
  // Calculate portfolio summary
  const activeStrategies = strategies.filter(
    (s) => s.status === 'active' && s.targetRegime === currentRegime
  );
  const totalPnl = strategies.reduce((sum, s) => sum + (s.currentPnl ?? 0), 0);
  const avgFitness =
    strategies.length > 0
      ? strategies.reduce((sum, s) => sum + s.fitness, 0) / strategies.length
      : 0;

  return (
    <Card className={cn('', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Symphony Orchestra
          </CardTitle>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-xs">
              <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
              <span
                className={cn(
                  'font-mono font-semibold',
                  totalPnl >= 0 ? 'text-green-400' : 'text-red-400'
                )}
              >
                {totalPnl >= 0 ? '+' : ''}
                {totalPnl.toFixed(2)}%
              </span>
            </div>
            <Badge variant="outline" className="text-xs">
              {activeStrategies.length} active
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* 2x2 Grid */}
        <div className="grid grid-cols-2 gap-2">
          {REGIME_GRID.map((config) => (
            <RegimeQuadrant
              key={config.regime}
              regime={config.regime}
              strategies={strategies}
              isCurrentRegime={currentRegime === config.regime}
              config={config}
              onStrategyClick={onStrategyClick}
            />
          ))}
        </div>

        {/* Portfolio Health Bar */}
        <div className="mt-3 pt-3 border-t border-border/50">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Symphony Health</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Avg Fitness:</span>
              <span
                className={cn(
                  'font-mono font-semibold',
                  avgFitness >= 1.5
                    ? 'text-green-400'
                    : avgFitness >= 1.0
                      ? 'text-yellow-400'
                      : 'text-red-400'
                )}
              >
                {avgFitness.toFixed(2)}
              </span>
            </div>
          </div>
          <div className="mt-1.5 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                avgFitness >= 1.5
                  ? 'bg-gradient-to-r from-green-500 to-emerald-400'
                  : avgFitness >= 1.0
                    ? 'bg-gradient-to-r from-yellow-500 to-amber-400'
                    : 'bg-gradient-to-r from-red-500 to-orange-400'
              )}
              style={{ width: `${Math.min(avgFitness * 40, 100)}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default SymphonyOrchestra;
