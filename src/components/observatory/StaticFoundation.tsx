/**
 * StaticFoundation - Always-visible panels
 *
 * These panels form the "static layer" that's always present:
 * - Current regime indicator
 * - Key metrics (Sharpe, Drawdown, etc.)
 * - System health
 * - Active connections
 */

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Gauge,
  Zap,
  Cloud,
  Sun,
  CloudRain,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ExtendedJarvisState } from '@/hooks/useJarvisEvents';

// ============================================================================
// Types
// ============================================================================

interface StaticFoundationProps {
  jarvisState: ExtendedJarvisState;
}

// ============================================================================
// Regime Display
// ============================================================================

function RegimeIndicator() {
  // Mock data - would come from jarvisState in production
  const regime = {
    current: 'TRENDING',
    confidence: 78,
    entropy: 0.32,
    shape: 'B' as const,
  };

  const regimeColors = {
    TRENDING: 'bg-green-500/20 border-green-500/50 text-green-400',
    RANGING: 'bg-blue-500/20 border-blue-500/50 text-blue-400',
    VOLATILE: 'bg-red-500/20 border-red-500/50 text-red-400',
    LOW_VOL: 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400',
  };

  const shapeLabels = {
    P: { label: 'Fear', icon: TrendingDown, color: 'text-red-400' },
    b: { label: 'Neutral', icon: Activity, color: 'text-yellow-400' },
    B: { label: 'Greed', icon: TrendingUp, color: 'text-green-400' },
  };

  const shapeInfo = shapeLabels[regime.shape];
  const ShapeIcon = shapeInfo.icon;

  // Weather based on entropy
  const getWeather = (entropy: number) => {
    if (entropy < 0.3) return { icon: Sun, label: 'Clear', color: 'text-yellow-400' };
    if (entropy < 0.6) return { icon: Cloud, label: 'Cloudy', color: 'text-gray-400' };
    return { icon: CloudRain, label: 'Stormy', color: 'text-blue-400' };
  };

  const weather = getWeather(regime.entropy);
  const WeatherIcon = weather.icon;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Gauge className="h-4 w-4" />
          Current Regime
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Regime Badge */}
        <div className={cn(
          'p-4 rounded-lg border text-center',
          regimeColors[regime.current as keyof typeof regimeColors]
        )}>
          <div className="text-2xl font-bold">{regime.current}</div>
          <div className="text-sm opacity-80">{regime.confidence}% confidence</div>
        </div>

        {/* Shape and Weather */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
            <ShapeIcon className={cn('h-5 w-5', shapeInfo.color)} />
            <div>
              <div className="text-xs text-muted-foreground">Shape</div>
              <div className="text-sm font-medium">{regime.shape}-{shapeInfo.label}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
            <WeatherIcon className={cn('h-5 w-5', weather.color)} />
            <div>
              <div className="text-xs text-muted-foreground">Clarity</div>
              <div className="text-sm font-medium">{weather.label}</div>
            </div>
          </div>
        </div>

        {/* Entropy bar */}
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Predictable</span>
            <span>Chaotic</span>
          </div>
          <Progress value={(1 - regime.entropy) * 100} className="h-2" />
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Key Metrics
// ============================================================================

function KeyMetrics() {
  // Mock data
  const metrics = [
    { label: 'Sharpe', value: 2.14, target: 2.0, good: true },
    { label: 'Max DD', value: -11.8, target: -15, good: true, suffix: '%' },
    { label: 'Win Rate', value: 68.2, target: 60, good: true, suffix: '%' },
    { label: 'Profit Factor', value: 1.85, target: 1.5, good: true },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Key Metrics
        </CardTitle>
        <CardDescription className="text-xs">Strategy Performance</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {metrics.map((metric) => (
            <div key={metric.label} className="p-3 rounded-lg bg-muted/50">
              <div className="text-xs text-muted-foreground">{metric.label}</div>
              <div className="flex items-center gap-2">
                <span className={cn(
                  'text-xl font-bold',
                  metric.good ? 'text-green-400' : 'text-red-400'
                )}>
                  {metric.value}{metric.suffix || ''}
                </span>
                {metric.good ? (
                  <CheckCircle className="h-4 w-4 text-green-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                )}
              </div>
              <div className="text-[10px] text-muted-foreground">
                Target: {metric.target}{metric.suffix || ''}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// System Health
// ============================================================================

function SystemHealth({ jarvisState }: { jarvisState: ExtendedJarvisState }) {
  const systems = [
    {
      name: 'JARVIS Bridge',
      status: jarvisState.isConnected ? 'online' : 'offline',
      lastSeen: jarvisState.lastEventTime,
    },
    {
      name: 'Python Engine',
      status: jarvisState.isActive ? 'active' : 'idle',
      activity: jarvisState.activityLabel,
    },
    {
      name: 'Supabase',
      status: 'online',
    },
    {
      name: 'ThetaData',
      status: 'offline',
    },
  ];

  const statusIcons = {
    online: { icon: CheckCircle, color: 'text-green-400' },
    active: { icon: Zap, color: 'text-cyan-400' },
    idle: { icon: Activity, color: 'text-yellow-400' },
    offline: { icon: XCircle, color: 'text-red-400' },
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Zap className="h-4 w-4" />
          System Health
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {systems.map((system) => {
            const statusInfo = statusIcons[system.status as keyof typeof statusIcons];
            const StatusIcon = statusInfo.icon;

            return (
              <div key={system.name} className="flex items-center justify-between p-2 rounded bg-muted/50">
                <span className="text-sm">{system.name}</span>
                <div className="flex items-center gap-2">
                  {'activity' in system && system.activity && (
                    <span className="text-xs text-muted-foreground">{system.activity}</span>
                  )}
                  <StatusIcon className={cn('h-4 w-4', statusInfo.color)} />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Force Summary
// ============================================================================

function ForceSummary() {
  const forces = [
    { name: 'Dealer Gamma', value: 2.34, direction: 'up' as const },
    { name: 'Customer Flow', value: 1.12, direction: 'up' as const },
    { name: 'Vol Pressure', value: -0.45, direction: 'down' as const },
    { name: 'Correlation', value: 0.89, direction: 'up' as const },
  ];

  const netForce = forces.reduce((sum, f) => sum + f.value, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Force Summary
        </CardTitle>
        <CardDescription className="text-xs">What's pushing price</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {forces.map((force) => (
            <div key={force.name} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-24">{force.name}</span>
              <div className="flex-1">
                <div
                  className={cn(
                    'h-4 rounded',
                    force.value >= 0 ? 'bg-green-500/30' : 'bg-red-500/30'
                  )}
                  style={{ width: `${Math.min(Math.abs(force.value) * 30, 100)}%` }}
                />
              </div>
              <span className={cn(
                'text-xs font-mono w-12 text-right',
                force.value >= 0 ? 'text-green-400' : 'text-red-400'
              )}>
                {force.value >= 0 ? '+' : ''}{force.value.toFixed(2)}
              </span>
            </div>
          ))}

          {/* Net Force */}
          <div className="pt-2 mt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Net Force</span>
              <Badge variant={netForce >= 0 ? 'default' : 'destructive'}>
                {netForce >= 0 ? 'BULLISH' : 'BEARISH'} ({netForce.toFixed(2)})
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function StaticFoundation({ jarvisState }: StaticFoundationProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <RegimeIndicator />
      <KeyMetrics />
      <ForceSummary />
      <SystemHealth jarvisState={jarvisState} />
    </div>
  );
}

export default StaticFoundation;
