/**
 * SystemIntegrityDashboard - The Fortress Guardian Status Panel
 *
 * Real-time status of all trading safety systems:
 * - Double-Entry Accounting (audit trail integrity)
 * - Circuit Breaker (daily loss limits)
 * - Event Horizon (macro event risk)
 * - Execution Lag Enforcer (T+1 execution)
 * - Position Integrity (tracking accuracy)
 *
 * Visual states:
 * - HEALTHY: All systems green
 * - WARNING: Some systems flagged
 * - CRITICAL: Safety systems triggered/breached
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Calendar,
  Wallet,
  Activity,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Pause,
  Timer,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export type SystemStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'OFFLINE';

export interface SystemInfo {
  status: SystemStatus;
  message: string;
  value?: number | string;
  lastCheck?: string;
}

export interface IntegrityState {
  success: boolean;
  timestamp: string;
  overall_status: SystemStatus;
  systems: {
    double_entry_accounting: {
      enabled: boolean;
      verified: boolean;
      last_check: string;
      discrepancies: number;
    };
    circuit_breaker: {
      enabled: boolean;
      triggered: boolean;
      daily_pnl: number;
      daily_limit_pct: number;
      remaining_capacity_pct: number;
    };
    event_horizon: {
      in_risk_window: boolean;
      risk_reason: string;
      upcoming_events: Array<{
        event_name: string;
        hours_until: number;
        impact_level: string;
      }>;
    };
    execution_lag: {
      enabled: boolean;
      pending_orders: number;
      orders_delayed: number;
    };
    positions: {
      open_positions: number;
      total_exposure: number;
      max_position_size: number;
    };
  };
}

export interface SystemIntegrityDashboardProps {
  className?: string;
  onRefresh?: () => void;
  autoRefreshMs?: number;
}

// ============================================================================
// Status Configuration
// ============================================================================

const STATUS_CONFIG: Record<
  SystemStatus,
  {
    icon: React.ReactNode;
    bgClass: string;
    borderClass: string;
    textClass: string;
    badgeClass: string;
    pulseClass?: string;
  }
> = {
  HEALTHY: {
    icon: <ShieldCheck className="w-5 h-5" />,
    bgClass: 'bg-green-500/10',
    borderClass: 'border-green-500/30',
    textClass: 'text-green-400',
    badgeClass: 'bg-green-500/20 text-green-400 border-green-500/30',
  },
  WARNING: {
    icon: <ShieldAlert className="w-5 h-5" />,
    bgClass: 'bg-yellow-500/10',
    borderClass: 'border-yellow-500/30',
    textClass: 'text-yellow-400',
    badgeClass: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  },
  CRITICAL: {
    icon: <Shield className="w-5 h-5" />,
    bgClass: 'bg-red-500/10',
    borderClass: 'border-red-500/50',
    textClass: 'text-red-400',
    badgeClass: 'bg-red-500/20 text-red-400 border-red-500/50',
    pulseClass: 'animate-pulse',
  },
  OFFLINE: {
    icon: <Shield className="w-5 h-5" />,
    bgClass: 'bg-gray-500/10',
    borderClass: 'border-gray-500/30',
    textClass: 'text-gray-400',
    badgeClass: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  },
};

// ============================================================================
// Helper Components
// ============================================================================

function SystemStatusIndicator({
  name,
  status,
  message,
  icon,
  details,
}: {
  name: string;
  status: SystemStatus;
  message: string;
  icon: React.ReactNode;
  details?: React.ReactNode;
}) {
  const statusIcon =
    status === 'HEALTHY' ? (
      <CheckCircle2 className="w-4 h-4 text-green-400" />
    ) : status === 'WARNING' ? (
      <AlertCircle className="w-4 h-4 text-yellow-400" />
    ) : status === 'CRITICAL' ? (
      <XCircle className="w-4 h-4 text-red-400 animate-pulse" />
    ) : (
      <Pause className="w-4 h-4 text-gray-400" />
    );

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-background/50 border border-border/50">
      <div className="p-2 rounded-lg bg-background/80">
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{name}</span>
          {statusIcon}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {message}
        </p>
        {details && <div className="mt-2">{details}</div>}
      </div>
    </div>
  );
}

function EventBadge({
  event,
}: {
  event: { event_name: string; hours_until: number; impact_level: string };
}) {
  const isImminent = event.hours_until <= 2;
  const colorClass = isImminent
    ? 'bg-red-500/20 text-red-400 border-red-500/30'
    : event.impact_level === 'RED'
      ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
      : 'bg-gray-500/20 text-gray-400 border-gray-500/30';

  return (
    <Badge className={cn('font-mono text-xs', colorClass)}>
      {event.event_name} T-{event.hours_until.toFixed(1)}h
    </Badge>
  );
}

function MetricDisplay({
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
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-mono', colorClass)}>
        {typeof value === 'number' ? value.toFixed(2) : value}
        {unit && <span className="ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function SystemIntegrityDashboard({
  className,
  onRefresh,
  autoRefreshMs = 30000,
}: SystemIntegrityDashboardProps) {
  const [integrityState, setIntegrityState] = useState<IntegrityState | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const fetchIntegrity = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:5000/integrity');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setIntegrityState(data);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
      setIntegrityState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrity();
    const interval = setInterval(fetchIntegrity, autoRefreshMs);
    return () => clearInterval(interval);
  }, [fetchIntegrity, autoRefreshMs]);

  const handleRefresh = () => {
    fetchIntegrity();
    onRefresh?.();
  };

  // Determine overall status
  const overallStatus: SystemStatus = integrityState?.overall_status ?? 'OFFLINE';
  const config = STATUS_CONFIG[overallStatus];

  // Extract system states
  const systems = integrityState?.systems;

  // Calculate individual system statuses
  const getAccountingStatus = (): SystemStatus => {
    if (!systems?.double_entry_accounting?.enabled) return 'OFFLINE';
    if (systems.double_entry_accounting.discrepancies > 0) return 'CRITICAL';
    if (!systems.double_entry_accounting.verified) return 'WARNING';
    return 'HEALTHY';
  };

  const getCircuitBreakerStatus = (): SystemStatus => {
    if (!systems?.circuit_breaker?.enabled) return 'OFFLINE';
    if (systems.circuit_breaker.triggered) return 'CRITICAL';
    if (systems.circuit_breaker.remaining_capacity_pct < 25) return 'WARNING';
    return 'HEALTHY';
  };

  const getEventHorizonStatus = (): SystemStatus => {
    if (!systems?.event_horizon) return 'OFFLINE';
    if (systems.event_horizon.in_risk_window) return 'CRITICAL';
    const imminentEvents =
      systems.event_horizon.upcoming_events?.filter(
        (e) => e.hours_until <= 2
      ) ?? [];
    if (imminentEvents.length > 0) return 'WARNING';
    return 'HEALTHY';
  };

  const getExecutionLagStatus = (): SystemStatus => {
    if (!systems?.execution_lag?.enabled) return 'OFFLINE';
    if (systems.execution_lag.pending_orders > 10) return 'WARNING';
    return 'HEALTHY';
  };

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
                System Integrity
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Trading safety systems status
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={cn('font-mono', config.badgeClass)}>
              {overallStatus}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={loading}
              className="h-8 w-8"
            >
              <RefreshCw
                className={cn('w-4 h-4', loading && 'animate-spin')}
              />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {error ? (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm text-red-400">
              Connection error: {error}
            </span>
          </div>
        ) : (
          <>
            {/* Double Entry Accounting */}
            <SystemStatusIndicator
              name="Double-Entry Accounting"
              status={getAccountingStatus()}
              message={
                systems?.double_entry_accounting?.verified
                  ? 'Ledger verified, no discrepancies'
                  : systems?.double_entry_accounting?.discrepancies
                    ? `${systems.double_entry_accounting.discrepancies} discrepancies found`
                    : 'Not verified'
              }
              icon={<Wallet className="w-4 h-4" />}
            />

            {/* Circuit Breaker */}
            <SystemStatusIndicator
              name="Circuit Breaker"
              status={getCircuitBreakerStatus()}
              message={
                systems?.circuit_breaker?.triggered
                  ? 'TRADING HALTED - Daily limit breached'
                  : `${systems?.circuit_breaker?.remaining_capacity_pct?.toFixed(0) ?? 0}% capacity remaining`
              }
              icon={<Activity className="w-4 h-4" />}
              details={
                systems?.circuit_breaker && (
                  <div className="space-y-1">
                    <MetricDisplay
                      label="Daily P&L"
                      value={systems.circuit_breaker.daily_pnl}
                      unit="%"
                      highlight={
                        systems.circuit_breaker.daily_pnl < 0
                          ? 'negative'
                          : 'positive'
                      }
                    />
                    <MetricDisplay
                      label="Daily Limit"
                      value={systems.circuit_breaker.daily_limit_pct}
                      unit="%"
                    />
                  </div>
                )
              }
            />

            {/* Event Horizon */}
            <SystemStatusIndicator
              name="Event Horizon"
              status={getEventHorizonStatus()}
              message={
                systems?.event_horizon?.in_risk_window
                  ? systems.event_horizon.risk_reason
                  : 'No imminent macro events'
              }
              icon={<Calendar className="w-4 h-4" />}
              details={
                systems?.event_horizon?.upcoming_events &&
                systems.event_horizon.upcoming_events.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {systems.event_horizon.upcoming_events
                      .slice(0, 3)
                      .map((event, i) => (
                        <EventBadge key={i} event={event} />
                      ))}
                  </div>
                )
              }
            />

            {/* Execution Lag Enforcer */}
            <SystemStatusIndicator
              name="Execution Lag (T+1)"
              status={getExecutionLagStatus()}
              message={
                systems?.execution_lag?.enabled
                  ? `${systems.execution_lag.pending_orders} orders pending, ${systems.execution_lag.orders_delayed} delayed`
                  : 'Disabled - CAUTION'
              }
              icon={<Timer className="w-4 h-4" />}
            />

            {/* Position Integrity */}
            {systems?.positions && (
              <div className="p-3 rounded-lg bg-background/50 border border-border/50">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Position Tracking</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-lg font-mono font-semibold">
                      {systems.positions.open_positions}
                    </div>
                    <div className="text-xs text-muted-foreground">Open</div>
                  </div>
                  <div>
                    <div className="text-lg font-mono font-semibold">
                      ${(systems.positions.total_exposure / 1000).toFixed(1)}k
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Exposure
                    </div>
                  </div>
                  <div>
                    <div className="text-lg font-mono font-semibold">
                      ${(systems.positions.max_position_size / 1000).toFixed(1)}
                      k
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Max Size
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Timestamp */}
        <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground pt-2 border-t border-border/50">
          <Clock className="w-3 h-3" />
          <span>
            Last update:{' '}
            {lastUpdate.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default SystemIntegrityDashboard;
