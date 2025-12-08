/**
 * SafetyLayout - Wraps all pages with safety components
 *
 * PHASE 1 SAFETY: This layout ensures:
 * - SystemHealthBar always visible at top (48px)
 * - LivePortWarning shows for LIVE connections
 * - AlertCenter available from any page
 * - Decision logging always active
 *
 * Structure:
 * ┌─────────────────────────────────────────────┐
 * │ SystemHealthBar (48px fixed)                 │
 * ├─────────────────────────────────────────────┤
 * │                                              │
 * │              Page Content                    │
 * │                                              │
 * └─────────────────────────────────────────────┘
 * + LivePortWarning (modal, when needed)
 * + AlertCenter (sheet, when open)
 */

import { useState, useEffect, useCallback } from 'react';
import { SystemHealthBar } from '@/components/header/SystemHealthBar';
import { LivePortWarning } from '@/components/safety/LivePortWarning';
import { AlertCenter, type Alert } from '@/components/alerts/AlertCenter';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface SafetyLayoutProps {
  children: React.ReactNode;
  className?: string;
}

export function SafetyLayout({ children, className }: SafetyLayoutProps) {
  // Connection state - would come from useBroker in production
  const [connectionPort, setConnectionPort] = useState<number | undefined>();
  const [accountId, setAccountId] = useState<string | undefined>();
  const [positions, setPositions] = useState<Array<{ symbol: string; quantity: number }>>([]);

  // Alert state
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertCenterOpen, setAlertCenterOpen] = useState(false);

  // Fetch alerts from Supabase
  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const { data, error } = await supabase
          .from('alerts')
          .select('*')
          .is('resolved_at', null)
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;
        setAlerts(data || []);
      } catch (err) {
        console.error('[SafetyLayout] Failed to fetch alerts:', err);
      }
    };

    fetchAlerts();

    // Subscribe to new alerts
    const subscription = supabase
      .channel('alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => {
        fetchAlerts();
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Listen for connection changes from Electron
  useEffect(() => {
    if (!window.electron?.broker) return;

    const handleConnectionChange = (data: { port?: number; accountId?: string }) => {
      setConnectionPort(data.port);
      setAccountId(data.accountId);
    };

    // Get initial connection state
    window.electron.broker.getConnectionStatus?.().then((status: any) => {
      if (status) {
        setConnectionPort(status.port);
        setAccountId(status.accountId);
        setPositions(status.positions || []);
      }
    });

    // Listen for changes
    window.electron.broker.onConnectionChange?.(handleConnectionChange);

    return () => {
      // Cleanup listener if available
    };
  }, []);

  // Alert handlers
  const handleAcknowledge = useCallback(async (alertId: string) => {
    try {
      await supabase
        .from('alerts')
        .update({ acknowledged_at: new Date().toISOString() })
        .eq('id', alertId);

      setAlerts(prev =>
        prev.map(a => (a.id === alertId ? { ...a, acknowledged_at: new Date().toISOString() } : a))
      );
    } catch (err) {
      console.error('[SafetyLayout] Failed to acknowledge alert:', err);
    }
  }, []);

  const handleResolve = useCallback(async (alertId: string, resolution: string) => {
    try {
      await supabase
        .from('alerts')
        .update({
          resolved_at: new Date().toISOString(),
          resolution,
        })
        .eq('id', alertId);

      setAlerts(prev =>
        prev.map(a =>
          a.id === alertId
            ? { ...a, resolved_at: new Date().toISOString(), resolution }
            : a
        )
      );
    } catch (err) {
      console.error('[SafetyLayout] Failed to resolve alert:', err);
    }
  }, []);

  const handleSnooze = useCallback(async (alertId: string, until: Date) => {
    try {
      await supabase
        .from('alerts')
        .update({ snoozed_until: until.toISOString() })
        .eq('id', alertId);

      setAlerts(prev =>
        prev.map(a =>
          a.id === alertId ? { ...a, snoozed_until: until.toISOString() } : a
        )
      );
    } catch (err) {
      console.error('[SafetyLayout] Failed to snooze alert:', err);
    }
  }, []);

  // Live port handlers
  const handleLiveAcknowledge = useCallback(() => {
    // User acknowledged live trading, continue
    console.log('[SafetyLayout] Live trading acknowledged');
  }, []);

  const handleLiveDisconnect = useCallback(() => {
    // User chose to disconnect from live
    window.electron?.broker?.disconnect?.();
    setConnectionPort(undefined);
  }, []);

  // Command palette handler
  const handleCommandPalette = useCallback(() => {
    // Trigger command palette (already handled globally)
    const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
    window.dispatchEvent(event);
  }, []);

  // Count unresolved, unacknowledged alerts
  const unresolvedAlerts = alerts.filter(a => !a.resolved_at);
  const alertCount = unresolvedAlerts.length;

  return (
    <div className={cn('flex flex-col h-screen', className)}>
      {/* Fixed header with all safety info */}
      <SystemHealthBar
        onCommandPalette={handleCommandPalette}
        onAlertClick={() => setAlertCenterOpen(true)}
        alertCount={alertCount}
      />

      {/* Page content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>

      {/* Live port warning - shows when connected to LIVE */}
      <LivePortWarning
        port={connectionPort}
        accountId={accountId}
        positions={positions}
        onAcknowledge={handleLiveAcknowledge}
        onDisconnect={handleLiveDisconnect}
      />

      {/* Alert center sheet */}
      <AlertCenter
        open={alertCenterOpen}
        onOpenChange={setAlertCenterOpen}
        alerts={alerts}
        onAcknowledge={handleAcknowledge}
        onResolve={handleResolve}
        onSnooze={handleSnooze}
      />
    </div>
  );
}

export default SafetyLayout;
