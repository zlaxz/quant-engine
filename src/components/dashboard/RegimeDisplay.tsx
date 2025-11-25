/**
 * RegimeDisplay - Market Weather Status Widget
 *
 * Shows real-time market regime classification from the Night Shift daemon.
 * Visual states match regime characteristics:
 * - LOW_VOL_GRIND: Green/Calm
 * - HIGH_VOL_OSCILLATION: Yellow/Choppy
 * - CRASH_ACCELERATION: Red/Pulse Animation
 * - MELT_UP: Gold/Momentum
 */

import React, { useEffect, useState } from 'react';
import {
  Sun,
  CloudRain,
  Zap,
  TrendingUp,
  Activity,
  BarChart3,
  ArrowUpDown,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export type RegimeType =
  | 'LOW_VOL_GRIND'
  | 'HIGH_VOL_OSCILLATION'
  | 'CRASH_ACCELERATION'
  | 'MELT_UP'
  | 'UNKNOWN';

export interface RegimeState {
  regime: RegimeType;
  vix: number;
  vix9d: number;
  termStructure: 'contango' | 'backwardation' | 'flat';
  realizedVol: number;
  putCallSkew: number;
  confidence: number; // 0-1
  timestamp: string;
}

export interface ConvexityBias {
  delta: 'long' | 'short' | 'neutral';
  gamma: 'long' | 'short' | 'neutral';
  vega: 'long' | 'short' | 'neutral';
  theta: 'positive' | 'negative' | 'neutral';
}

export interface RegimeDisplayProps {
  regimeState?: RegimeState;
  convexityBias?: ConvexityBias;
  className?: string;
  onRefresh?: () => void;
}

// ============================================================================
// Regime Visual Configuration
// ============================================================================

const REGIME_CONFIG: Record<
  RegimeType,
  {
    label: string;
    description: string;
    icon: React.ReactNode;
    bgClass: string;
    borderClass: string;
    textClass: string;
    badgeClass: string;
    pulseClass?: string;
  }
> = {
  LOW_VOL_GRIND: {
    label: 'Low Vol Grind',
    description: 'Calm seas, steady drift',
    icon: <Sun className="w-5 h-5" />,
    bgClass: 'bg-green-500/10',
    borderClass: 'border-green-500/30',
    textClass: 'text-green-400',
    badgeClass: 'bg-green-500/20 text-green-400 border-green-500/30',
  },
  HIGH_VOL_OSCILLATION: {
    label: 'High Vol Oscillation',
    description: 'Choppy waters, mean reversion',
    icon: <Activity className="w-5 h-5" />,
    bgClass: 'bg-yellow-500/10',
    borderClass: 'border-yellow-500/30',
    textClass: 'text-yellow-400',
    badgeClass: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  },
  CRASH_ACCELERATION: {
    label: 'Crash Acceleration',
    description: 'DANGER: Panic selling active',
    icon: <Zap className="w-5 h-5" />,
    bgClass: 'bg-red-500/10',
    borderClass: 'border-red-500/50',
    textClass: 'text-red-400',
    badgeClass: 'bg-red-500/20 text-red-400 border-red-500/50',
    pulseClass: 'animate-pulse',
  },
  MELT_UP: {
    label: 'Melt Up',
    description: 'FOMO rally, momentum surge',
    icon: <TrendingUp className="w-5 h-5" />,
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/30',
    textClass: 'text-amber-400',
    badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  },
  UNKNOWN: {
    label: 'Unknown',
    description: 'Regime not classified',
    icon: <CloudRain className="w-5 h-5" />,
    bgClass: 'bg-gray-500/10',
    borderClass: 'border-gray-500/30',
    textClass: 'text-gray-400',
    badgeClass: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  },
};

// ============================================================================
// Helper Components
// ============================================================================

function MetricBadge({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: number | string;
  unit?: string;
  highlight?: 'positive' | 'negative' | 'neutral';
}) {
  const colorClass =
    highlight === 'positive'
      ? 'text-green-400'
      : highlight === 'negative'
        ? 'text-red-400'
        : 'text-muted-foreground';

  return (
    <div className="flex flex-col items-center">
      <span className="text-xs text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span className={cn('text-lg font-mono font-semibold', colorClass)}>
        {typeof value === 'number' ? value.toFixed(2) : value}
        {unit && <span className="text-xs ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

function BiasIndicator({
  label,
  value,
}: {
  label: string;
  value: 'long' | 'short' | 'neutral' | 'positive' | 'negative';
}) {
  const config = {
    long: { text: 'LONG', class: 'text-green-400' },
    short: { text: 'SHORT', class: 'text-red-400' },
    positive: { text: '+', class: 'text-green-400' },
    negative: { text: '−', class: 'text-red-400' },
    neutral: { text: '○', class: 'text-gray-400' },
  };

  const { text, class: colorClass } = config[value];

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground w-8">{label}</span>
      <span className={cn('text-xs font-mono font-semibold', colorClass)}>
        {text}
      </span>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function RegimeDisplay({
  regimeState,
  convexityBias,
  className,
}: RegimeDisplayProps) {
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  // Update timestamp on regime change
  useEffect(() => {
    if (regimeState?.timestamp) {
      setLastUpdate(new Date(regimeState.timestamp));
    }
  }, [regimeState?.timestamp]);

  // Default state if no data
  const state: RegimeState = regimeState ?? {
    regime: 'UNKNOWN',
    vix: 0,
    vix9d: 0,
    termStructure: 'flat',
    realizedVol: 0,
    putCallSkew: 0,
    confidence: 0,
    timestamp: new Date().toISOString(),
  };

  const config = REGIME_CONFIG[state.regime];

  // Calculate term structure display
  const termStructureRatio = state.vix9d > 0 ? state.vix / state.vix9d : 1;
  const termStructureHighlight: 'positive' | 'negative' | 'neutral' =
    termStructureRatio < 0.95
      ? 'positive' // Contango (normal)
      : termStructureRatio > 1.05
        ? 'negative' // Backwardation (stress)
        : 'neutral';

  return (
    <Card
      className={cn(
        'transition-all duration-300',
        config.bgClass,
        config.borderClass,
        config.pulseClass,
        className
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn('p-2 rounded-lg', config.bgClass)}>
              <span className={config.textClass}>{config.icon}</span>
            </div>
            <div>
              <CardTitle className={cn('text-lg', config.textClass)}>
                {config.label}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {config.description}
              </p>
            </div>
          </div>
          <Badge className={cn('font-mono', config.badgeClass)}>
            {(state.confidence * 100).toFixed(0)}% conf
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* VIX Metrics Row */}
        <div className="flex justify-around py-2 border-y border-border/50">
          <MetricBadge label="VIX" value={state.vix} highlight={state.vix > 25 ? 'negative' : state.vix < 15 ? 'positive' : 'neutral'} />
          <MetricBadge label="VIX9D" value={state.vix9d} />
          <MetricBadge
            label="Term"
            value={termStructureRatio}
            highlight={termStructureHighlight}
          />
          <MetricBadge
            label="RVol"
            value={state.realizedVol}
            unit="%"
          />
        </div>

        {/* Convexity Bias Section */}
        {convexityBias && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <BarChart3 className="w-3.5 h-3.5" />
              <span className="uppercase tracking-wider">Portfolio Bias</span>
            </div>
            <div className="grid grid-cols-4 gap-2 p-2 rounded-lg bg-background/50">
              <BiasIndicator label="Δ" value={convexityBias.delta} />
              <BiasIndicator label="Γ" value={convexityBias.gamma} />
              <BiasIndicator label="V" value={convexityBias.vega} />
              <BiasIndicator label="Θ" value={convexityBias.theta} />
            </div>
          </div>
        )}

        {/* Skew & Timestamp */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <ArrowUpDown className="w-3 h-3" />
            <span>
              Skew: {state.putCallSkew > 0 ? '+' : ''}
              {state.putCallSkew.toFixed(2)}
            </span>
          </div>
          <span>
            {lastUpdate.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default RegimeDisplay;
