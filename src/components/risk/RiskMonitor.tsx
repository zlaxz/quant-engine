/**
 * RiskMonitor - Live risk exposure visualization
 *
 * PHASE 2: Money Visibility - Know your risk at all times
 *
 * Features:
 * - Position count gauge (8/10 positions)
 * - Daily loss gauge (60% of limit)
 * - Exposure gauge (40% of max)
 * - Correlation warnings
 * - Circuit breaker distance
 * - Directional exposure balance
 * - Concentration warnings
 *
 * Color Coding:
 * - 0-60%: Green (safe)
 * - 60-80%: Yellow (caution)
 * - 80-100%: Red + pulse (danger)
 *
 * ADHD Design:
 * - Visual gauges for instant read
 * - Color-coded danger levels
 * - Pulsing indicators for critical states
 * - Plain English warnings
 */

import { useState, useMemo } from 'react';
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Shield,
  ShieldAlert,
  ShieldOff,
  Activity,
  BarChart3,
  Layers,
  AlertCircle,
  CheckCircle,
  XCircle,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
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
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { cn } from '@/lib/utils';

// =========================================================================
// Types
// =========================================================================

interface CorrelationWarning {
  strategy1: string;
  strategy2: string;
  correlation: number;
  combinedExposure: number;
  recommendation: string;
}

interface ConcentrationWarning {
  symbol: string;
  exposure: number;
  percent: number;
  recommendation: string;
}

interface RiskState {
  // Position limits
  currentPositions: number;
  maxPositions: number;
  positionUsagePercent: number;

  // Exposure limits
  currentExposure: number;
  maxExposure: number;
  exposureUsagePercent: number;

  // Loss limits
  dailyLoss: number;
  dailyLossLimit: number;
  dailyLossPercent: number;
  weeklyLoss: number;
  weeklyLossLimit: number;
  weeklyLossPercent: number;

  // Circuit breakers
  circuitBreakerTriggered: boolean;
  drawdownToCircuitBreaker: number; // How much more loss before trigger

  // Concentration
  largestPosition: {
    symbol: string;
    exposure: number;
    percent: number;
  } | null;
  concentrationWarnings: ConcentrationWarning[];

  // Correlation risk
  correlationWarnings: CorrelationWarning[];
  maxCorrelation: number;

  // Directional exposure
  directionalExposure: {
    long: number;
    short: number;
    netPercent: number;
  };
}

interface RiskMonitorProps {
  data: RiskState;
  onCircuitBreakerReset?: () => void;
  compact?: boolean;
  className?: string;
}

// =========================================================================
// Helper Components
// =========================================================================

interface RiskGaugeProps {
  label: string;
  value: number;
  max: number;
  percent: number;
  unit?: string;
  showValue?: boolean;
  compact?: boolean;
}

function getGaugeColor(percent: number): {
  bg: string;
  text: string;
  pulse: boolean;
} {
  if (percent >= 80) {
    return {
      bg: 'bg-red-500',
      text: 'text-red-500',
      pulse: true,
    };
  }
  if (percent >= 60) {
    return {
      bg: 'bg-yellow-500',
      text: 'text-yellow-500',
      pulse: false,
    };
  }
  return {
    bg: 'bg-green-500',
    text: 'text-green-500',
    pulse: false,
  };
}

function RiskGauge({
  label,
  value,
  max,
  percent,
  unit = '',
  showValue = true,
  compact = false,
}: RiskGaugeProps) {
  const colors = getGaugeColor(percent);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-mono font-medium', colors.text)}>
          {showValue ? (
            <>
              {value}
              {unit}/{max}
              {unit}
            </>
          ) : (
            `${percent.toFixed(0)}%`
          )}
        </span>
      </div>
      <div className="relative">
        <Progress
          value={Math.min(percent, 100)}
          className={cn('h-2', colors.pulse && 'animate-pulse')}
          indicatorClassName={colors.bg}
        />
        {/* Threshold markers */}
        <div className="absolute top-0 left-[60%] w-px h-2 bg-yellow-500/50" />
        <div className="absolute top-0 left-[80%] w-px h-2 bg-red-500/50" />
      </div>
    </div>
  );
}

// Directional balance bar
function DirectionalBalance({
  long,
  short,
  netPercent,
}: {
  long: number;
  short: number;
  netPercent: number;
}) {
  const total = long + short;
  const longPercent = total > 0 ? (long / total) * 100 : 50;
  const shortPercent = total > 0 ? (short / total) * 100 : 50;

  // Warning if too directional
  const isWarning = Math.abs(netPercent) > 60;
  const isCritical = Math.abs(netPercent) > 80;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Directional Exposure</span>
        <span
          className={cn(
            'font-mono font-medium',
            isCritical ? 'text-red-500' : isWarning ? 'text-yellow-500' : 'text-muted-foreground'
          )}
        >
          {netPercent >= 0 ? '+' : ''}
          {netPercent.toFixed(0)}% net
        </span>
      </div>

      {/* Balance bar */}
      <div className="flex h-4 rounded overflow-hidden">
        <div
          className="bg-green-500 flex items-center justify-end pr-1"
          style={{ width: `${longPercent}%` }}
        >
          {longPercent > 20 && (
            <span className="text-xs text-white font-medium">
              ${(long / 1000).toFixed(0)}k
            </span>
          )}
        </div>
        <div
          className="bg-red-500 flex items-center justify-start pl-1"
          style={{ width: `${shortPercent}%` }}
        >
          {shortPercent > 20 && (
            <span className="text-xs text-white font-medium">
              ${(short / 1000).toFixed(0)}k
            </span>
          )}
        </div>
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <TrendingUp className="h-3 w-3 text-green-500" />
          Long
        </span>
        <span className="flex items-center gap-1">
          Short
          <TrendingDown className="h-3 w-3 text-red-500" />
        </span>
      </div>
    </div>
  );
}

// =========================================================================
// Main Component
// =========================================================================

export function RiskMonitor({
  data,
  onCircuitBreakerReset,
  compact = false,
  className,
}: RiskMonitorProps) {
  // Overall risk level
  const overallRisk = useMemo(() => {
    const maxPercent = Math.max(
      data.positionUsagePercent,
      data.exposureUsagePercent,
      data.dailyLossPercent,
      data.weeklyLossPercent
    );

    if (data.circuitBreakerTriggered || maxPercent >= 100) {
      return { level: 'critical', label: 'CRITICAL', color: 'text-red-500' };
    }
    if (maxPercent >= 80 || data.correlationWarnings.length > 0) {
      return { level: 'high', label: 'HIGH', color: 'text-red-500' };
    }
    if (maxPercent >= 60) {
      return { level: 'elevated', label: 'ELEVATED', color: 'text-yellow-500' };
    }
    return { level: 'normal', label: 'NORMAL', color: 'text-green-500' };
  }, [data]);

  // Active warnings count
  const warningCount =
    data.correlationWarnings.length +
    data.concentrationWarnings.length +
    (data.circuitBreakerTriggered ? 1 : 0);

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className={compact ? 'pb-2' : undefined}>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {data.circuitBreakerTriggered ? (
                <ShieldOff className="h-5 w-5 text-red-500" />
              ) : overallRisk.level === 'normal' ? (
                <Shield className="h-5 w-5 text-green-500" />
              ) : (
                <ShieldAlert className="h-5 w-5 text-yellow-500" />
              )}
              Risk Monitor
            </CardTitle>
            {!compact && (
              <CardDescription>
                Real-time risk exposure and limits
              </CardDescription>
            )}
          </div>

          {/* Overall status badge */}
          <div className="flex items-center gap-2">
            <Badge
              variant={overallRisk.level === 'normal' ? 'outline' : 'destructive'}
              className={cn(
                overallRisk.level === 'critical' && 'animate-pulse'
              )}
            >
              <Activity className="h-3 w-3 mr-1" />
              {overallRisk.label}
            </Badge>
            {warningCount > 0 && (
              <Badge variant="secondary">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {warningCount} Warning{warningCount !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Circuit Breaker Alert */}
        {data.circuitBreakerTriggered && (
          <Alert variant="destructive" className="animate-pulse">
            <Zap className="h-4 w-4" />
            <AlertTitle>Circuit Breaker Triggered</AlertTitle>
            <AlertDescription>
              Trading has been automatically halted. All new orders are blocked.
              {onCircuitBreakerReset && (
                <button
                  onClick={onCircuitBreakerReset}
                  className="ml-2 underline hover:no-underline"
                >
                  Reset (requires confirmation)
                </button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Main Gauges */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TooltipProvider>
            {/* Position Count */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <RiskGauge
                    label="Positions"
                    value={data.currentPositions}
                    max={data.maxPositions}
                    percent={data.positionUsagePercent}
                    compact={compact}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {data.maxPositions - data.currentPositions} position slots remaining
                </p>
              </TooltipContent>
            </Tooltip>

            {/* Exposure */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <RiskGauge
                    label="Exposure"
                    value={Math.round(data.currentExposure / 1000)}
                    max={Math.round(data.maxExposure / 1000)}
                    percent={data.exposureUsagePercent}
                    unit="k"
                    compact={compact}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  ${(data.maxExposure - data.currentExposure).toLocaleString()} exposure remaining
                </p>
              </TooltipContent>
            </Tooltip>

            {/* Daily Loss */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <RiskGauge
                    label="Daily Loss"
                    value={Math.abs(Math.round(data.dailyLoss))}
                    max={Math.round(data.dailyLossLimit)}
                    percent={data.dailyLossPercent}
                    unit=""
                    compact={compact}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  ${(data.dailyLossLimit - Math.abs(data.dailyLoss)).toLocaleString()} remaining before daily limit hit
                </p>
              </TooltipContent>
            </Tooltip>

            {/* Weekly Loss */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <RiskGauge
                    label="Weekly Loss"
                    value={Math.abs(Math.round(data.weeklyLoss))}
                    max={Math.round(data.weeklyLossLimit)}
                    percent={data.weeklyLossPercent}
                    unit=""
                    compact={compact}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  ${(data.weeklyLossLimit - Math.abs(data.weeklyLoss)).toLocaleString()} remaining before weekly limit hit
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Circuit Breaker Distance */}
        {!compact && data.drawdownToCircuitBreaker > 0 && (
          <div className="p-3 bg-muted rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Distance to Circuit Breaker
              </span>
              <span
                className={cn(
                  'font-mono font-medium',
                  data.drawdownToCircuitBreaker < 1000
                    ? 'text-red-500'
                    : data.drawdownToCircuitBreaker < 2500
                      ? 'text-yellow-500'
                      : 'text-green-500'
                )}
              >
                ${data.drawdownToCircuitBreaker.toLocaleString()}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Trading will halt automatically if this amount is lost
            </p>
          </div>
        )}

        {/* Directional Exposure */}
        {!compact && data.directionalExposure && (
          <DirectionalBalance
            long={data.directionalExposure.long}
            short={data.directionalExposure.short}
            netPercent={data.directionalExposure.netPercent}
          />
        )}

        {/* Largest Position */}
        {!compact && data.largestPosition && (
          <div className="p-3 bg-muted rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Largest Position
              </span>
              <Badge variant="outline">
                {data.largestPosition.symbol}
              </Badge>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="font-mono">
                ${data.largestPosition.exposure.toLocaleString()}
              </span>
              <span
                className={cn(
                  'font-mono text-sm',
                  data.largestPosition.percent > 20
                    ? 'text-red-500'
                    : data.largestPosition.percent > 10
                      ? 'text-yellow-500'
                      : 'text-muted-foreground'
                )}
              >
                {data.largestPosition.percent.toFixed(1)}% of portfolio
              </span>
            </div>
          </div>
        )}

        {/* Correlation Warnings */}
        {data.correlationWarnings.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Correlation Warnings
            </h4>
            {data.correlationWarnings.map((warning, index) => (
              <Alert
                key={index}
                variant={warning.correlation > 0.85 ? 'destructive' : 'default'}
              >
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  <strong>{warning.strategy1}</strong> and{' '}
                  <strong>{warning.strategy2}</strong> have{' '}
                  {(warning.correlation * 100).toFixed(0)}% correlation (
                  ${warning.combinedExposure.toLocaleString()} combined exposure).
                  <br />
                  <span className="text-muted-foreground">
                    {warning.recommendation}
                  </span>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {/* Concentration Warnings */}
        {data.concentrationWarnings.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Concentration Warnings
            </h4>
            {data.concentrationWarnings.map((warning, index) => (
              <Alert key={index}>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  <strong>{warning.symbol}</strong> is{' '}
                  {warning.percent.toFixed(1)}% of portfolio (
                  ${warning.exposure.toLocaleString()}).
                  <br />
                  <span className="text-muted-foreground">
                    {warning.recommendation}
                  </span>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {/* All Clear indicator */}
        {overallRisk.level === 'normal' && !compact && warningCount === 0 && (
          <div className="flex items-center justify-center gap-2 p-3 bg-green-500/10 rounded-lg text-green-600">
            <CheckCircle className="h-5 w-5" />
            <span className="font-medium">All risk metrics within limits</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default RiskMonitor;
