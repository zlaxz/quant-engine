/**
 * AlertCenter - Central alert management component
 *
 * PHASE 1 SAFETY: Critical alerts cannot be dismissed without acknowledgment
 *
 * Alert Types:
 * - Critical: Full-screen overlay, audio, cannot dismiss without action
 * - Warning: Badge pulses, can snooze for 1hr/4hr/24hr
 * - Info: Quiet badge increment, auto-dismiss after 24hr
 *
 * ADHD Design:
 * - Grouped similar alerts
 * - Clear severity hierarchy
 * - Audio for critical (can't miss)
 * - History searchable
 */

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  X,
  Clock,
  Check,
  Bell,
  BellOff,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

// =========================================================================
// Types
// =========================================================================

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertCategory = 'risk' | 'performance' | 'system' | 'opportunity' | 'lifecycle' | 'regime';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  description?: string;
  created_at: string;
  read_at?: string;
  acknowledged_at?: string;
  resolved_at?: string;
  resolution?: string;
  snoozed_until?: string;
  action_required?: boolean;
  actions?: AlertAction[];
  source?: string;
  group_key?: string;
}

export interface AlertAction {
  label: string;
  variant?: 'default' | 'destructive' | 'outline';
  onClick: () => Promise<void>;
}

interface AlertCenterProps {
  /** Whether the sheet is open */
  open?: boolean;
  /** Called when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Current alerts */
  alerts?: Alert[];
  /** Called when alert is acknowledged */
  onAcknowledge?: (alertId: string) => void;
  /** Called when alert is resolved */
  onResolve?: (alertId: string, resolution: string) => void;
  /** Called when alert is snoozed */
  onSnooze?: (alertId: string, until: Date) => void;
}

// =========================================================================
// Helper Components
// =========================================================================

const SEVERITY_CONFIG = {
  critical: {
    icon: AlertTriangle,
    color: 'text-red-500',
    bg: 'bg-red-500/10 border-red-500/30',
    badge: 'bg-red-500 text-white',
  },
  warning: {
    icon: AlertCircle,
    color: 'text-yellow-500',
    bg: 'bg-yellow-500/10 border-yellow-500/30',
    badge: 'bg-yellow-500 text-black',
  },
  info: {
    icon: Info,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10 border-blue-500/30',
    badge: 'bg-blue-500 text-white',
  },
};

function AlertItem({
  alert,
  onAcknowledge,
  onResolve,
  onSnooze,
}: {
  alert: Alert;
  onAcknowledge?: (id: string) => void;
  onResolve?: (id: string, resolution: string) => void;
  onSnooze?: (id: string, until: Date) => void;
}) {
  const config = SEVERITY_CONFIG[alert.severity];
  const Icon = config.icon;

  const isResolved = !!alert.resolved_at;
  const isSnoozed = alert.snoozed_until && new Date(alert.snoozed_until) > new Date();

  // Format relative time
  const timeAgo = formatTimeAgo(new Date(alert.created_at));

  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-all',
        config.bg,
        isResolved && 'opacity-60',
        isSnoozed && 'border-dashed'
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className={cn('h-5 w-5 mt-0.5', config.color)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{alert.title}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {alert.category}
            </Badge>
          </div>
          {alert.description && (
            <p className="text-sm text-muted-foreground mt-1">{alert.description}</p>
          )}
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{timeAgo}</span>
            {alert.source && (
              <>
                <span>•</span>
                <span>{alert.source}</span>
              </>
            )}
            {isSnoozed && (
              <>
                <span>•</span>
                <BellOff className="h-3 w-3" />
                <span>Snoozed</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!isResolved && (
            <>
              {alert.severity !== 'critical' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => onSnooze?.(alert.id, new Date(Date.now() + 60 * 60 * 1000))}
                >
                  <Clock className="h-3 w-3" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => onResolve?.(alert.id, 'Resolved by user')}
              >
                <Check className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// Critical Alert Overlay
// =========================================================================

function CriticalAlertOverlay({
  alert,
  onAcknowledge,
  onResolve,
}: {
  alert: Alert;
  onAcknowledge?: (id: string) => void;
  onResolve?: (id: string, resolution: string) => void;
}) {
  const [resolution, setResolution] = useState('');

  useEffect(() => {
    // Play audio for critical alerts
    try {
      const audio = new Audio('/sounds/critical.mp3');
      audio.play().catch(() => { /* Audio failure is non-critical */ });
    } catch {
      // Audio unavailable - non-critical, continue silently
    }
  }, []);

  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-lg border-red-500 border-2"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600 text-xl">
            <AlertTriangle className="h-6 w-6 animate-pulse" />
            CRITICAL ALERT
          </DialogTitle>
          <DialogDescription className="text-base">
            {alert.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {alert.description && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p className="text-sm">{alert.description}</p>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Resolution / Notes</label>
            <Input
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="What action did you take?"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              onAcknowledge?.(alert.id);
              onResolve?.(alert.id, resolution || 'Acknowledged');
            }}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            <Check className="h-4 w-4 mr-2" />
            Acknowledge & Resolve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =========================================================================
// Main Component
// =========================================================================

export function AlertCenter({
  open,
  onOpenChange,
  alerts = [],
  onAcknowledge,
  onResolve,
  onSnooze,
}: AlertCenterProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'all'>('all');

  // Find critical unresolved alerts
  const criticalAlerts = alerts.filter(
    a => a.severity === 'critical' && !a.resolved_at && !a.acknowledged_at
  );

  // Filter alerts
  const filteredAlerts = alerts.filter(a => {
    if (severityFilter !== 'all' && a.severity !== severityFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        a.title.toLowerCase().includes(query) ||
        a.description?.toLowerCase().includes(query) ||
        a.category.toLowerCase().includes(query)
      );
    }
    return true;
  });

  // Group by severity
  const groupedAlerts = {
    critical: filteredAlerts.filter(a => a.severity === 'critical'),
    warning: filteredAlerts.filter(a => a.severity === 'warning'),
    info: filteredAlerts.filter(a => a.severity === 'info'),
  };

  // Count unresolved
  const unresolvedCount = alerts.filter(a => !a.resolved_at).length;

  return (
    <>
      {/* Critical Alert Overlay - Always on top */}
      {criticalAlerts.length > 0 && (
        <CriticalAlertOverlay
          alert={criticalAlerts[0]}
          onAcknowledge={onAcknowledge}
          onResolve={onResolve}
        />
      )}

      {/* Alert Center Sheet */}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Alert Center
              {unresolvedCount > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {unresolvedCount}
                </Badge>
              )}
            </SheetTitle>
            <SheetDescription>
              Manage system alerts and notifications
            </SheetDescription>
          </SheetHeader>

          {/* Filters */}
          <div className="flex items-center gap-2 mt-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search alerts..."
                className="pl-8"
              />
            </div>
            <Select
              value={severityFilter}
              onValueChange={(v) => setSeverityFilter(v as AlertSeverity | 'all')}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Alert List */}
          <ScrollArea className="h-[calc(100vh-200px)]">
            <div className="space-y-4 pr-4">
              {/* Critical */}
              {groupedAlerts.critical.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-red-500 mb-2">
                    Critical ({groupedAlerts.critical.length})
                  </h3>
                  <div className="space-y-2">
                    {groupedAlerts.critical.map(alert => (
                      <AlertItem
                        key={alert.id}
                        alert={alert}
                        onAcknowledge={onAcknowledge}
                        onResolve={onResolve}
                        onSnooze={onSnooze}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Warning */}
              {groupedAlerts.warning.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-yellow-500 mb-2">
                    Warnings ({groupedAlerts.warning.length})
                  </h3>
                  <div className="space-y-2">
                    {groupedAlerts.warning.map(alert => (
                      <AlertItem
                        key={alert.id}
                        alert={alert}
                        onAcknowledge={onAcknowledge}
                        onResolve={onResolve}
                        onSnooze={onSnooze}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Info */}
              {groupedAlerts.info.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-blue-500 mb-2">
                    Info ({groupedAlerts.info.length})
                  </h3>
                  <div className="space-y-2">
                    {groupedAlerts.info.map(alert => (
                      <AlertItem
                        key={alert.id}
                        alert={alert}
                        onAcknowledge={onAcknowledge}
                        onResolve={onResolve}
                        onSnooze={onSnooze}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Empty State */}
              {filteredAlerts.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No alerts to display</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}

// =========================================================================
// Utility Functions
// =========================================================================

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

export default AlertCenter;
