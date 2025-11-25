/**
 * System Status (Heartbeat Widget) - Zero-Friction Interface
 *
 * ADHD-optimized status display showing:
 * - Daemon: Online/Offline (click to restart)
 * - Data Drive: Connected/Missing
 * - API: Connected/Missing
 * - Bridge: Connected/Disconnected
 *
 * Created: 2025-11-24
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Moon,
  HardDrive,
  Wifi,
  Server,
  RefreshCw,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type DaemonStatus = 'online' | 'offline' | 'starting' | 'crashed';

interface SystemHealth {
  daemon: boolean;
  dataDrive: boolean;
  api: boolean;
  bridge: boolean;
}

interface StatusIndicatorProps {
  label: string;
  status: boolean | DaemonStatus;
  icon: React.ReactNode;
  onClick?: () => void;
  loading?: boolean;
  tooltip?: string;
}

function StatusIndicator({ label, status, icon, onClick, loading, tooltip }: StatusIndicatorProps) {
  const isOnline = status === true || status === 'online';
  const isStarting = status === 'starting';
  const isCrashed = status === 'crashed';

  const statusColor = loading || isStarting
    ? 'text-yellow-500'
    : isOnline
    ? 'text-green-500'
    : isCrashed
    ? 'text-orange-500'
    : 'text-red-500';

  const bgColor = loading || isStarting
    ? 'bg-yellow-500/10'
    : isOnline
    ? 'bg-green-500/10'
    : isCrashed
    ? 'bg-orange-500/10'
    : 'bg-red-500/10';

  const content = (
    <div
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors',
        bgColor,
        onClick && 'cursor-pointer hover:opacity-80'
      )}
      onClick={onClick}
    >
      <div className={cn('relative', statusColor)}>
        {loading || isStarting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          icon
        )}
        {/* Pulse indicator for online status */}
        {isOnline && !loading && (
          <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
        )}
      </div>
      <span className={cn('text-xs font-medium', statusColor)}>{label}</span>
    </div>
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

export function SystemStatus() {
  const [health, setHealth] = useState<SystemHealth>({
    daemon: false,
    dataDrive: false,
    api: false,
    bridge: false,
  });
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus>('offline');
  const [loading, setLoading] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);

  // Fetch health on mount and periodically
  const fetchHealth = useCallback(async () => {
    if (!window.electron?.getSystemHealth) return;

    try {
      const newHealth = await window.electron.getSystemHealth();
      setHealth(newHealth);

      // Update daemon status based on health
      if (newHealth.daemon) {
        setDaemonStatus('online');
      } else if (daemonStatus === 'starting') {
        // Keep starting status
      } else {
        setDaemonStatus('offline');
      }
    } catch (error) {
      console.error('Failed to fetch health:', error);
    }
  }, [daemonStatus]);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000); // Every 10s
    return () => clearInterval(interval);
  }, [fetchHealth]);

  // Listen to daemon status updates
  useEffect(() => {
    if (!window.electron?.onDaemonStatus) return;

    const unsubscribe = window.electron.onDaemonStatus((data) => {
      setDaemonStatus(data.status);
      if (data.status === 'online') {
        setHealth((prev) => ({ ...prev, daemon: true }));
      } else if (data.status === 'offline' || data.status === 'crashed') {
        setHealth((prev) => ({ ...prev, daemon: false }));
      }
    });

    return unsubscribe;
  }, []);

  // Listen to daemon logs
  useEffect(() => {
    if (!window.electron?.onDaemonLog) return;

    const unsubscribe = window.electron.onDaemonLog((log) => {
      setLogs((prev) => [...prev.slice(-99), log]); // Keep last 100 logs
    });

    return unsubscribe;
  }, []);

  const handleDaemonClick = async () => {
    if (!window.electron) return;

    setLoading('daemon');

    try {
      if (daemonStatus === 'online') {
        // Show logs popover instead of stopping
        setLogsOpen(true);
        setLoading(null);
        return;
      }

      // Start daemon
      setDaemonStatus('starting');
      const result = await window.electron.startDaemon();

      if (result.success) {
        toast.success('Night Shift started', {
          description: `PID: ${result.pid}`,
        });
      } else {
        setDaemonStatus('offline');
        toast.error('Failed to start', {
          description: result.error,
        });
      }
    } catch (error) {
      setDaemonStatus('offline');
      toast.error('Error', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setLoading(null);
    }
  };

  const handleRestartDaemon = async () => {
    if (!window.electron?.restartDaemon) return;

    setLoading('daemon');
    setDaemonStatus('starting');

    try {
      const result = await window.electron.restartDaemon();
      if (result.success) {
        toast.success('Night Shift restarted', {
          description: `PID: ${result.pid}`,
        });
      } else {
        toast.error('Restart failed', { description: result.error });
      }
    } catch (error) {
      toast.error('Error restarting daemon');
    } finally {
      setLoading(null);
    }
  };

  const handleStopDaemon = async () => {
    if (!window.electron?.stopDaemon) return;

    setLoading('daemon');

    try {
      const result = await window.electron.stopDaemon();
      if (result.success) {
        setDaemonStatus('offline');
        toast.success('Night Shift stopped');
        setLogsOpen(false);
      } else {
        toast.error('Stop failed', { description: result.error });
      }
    } catch (error) {
      toast.error('Error stopping daemon');
    } finally {
      setLoading(null);
    }
  };

  // Count issues
  const issueCount = [
    !health.daemon,
    !health.dataDrive,
    !health.api,
    !health.bridge,
  ].filter(Boolean).length;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1">
        {/* Overall health indicator */}
        {issueCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-red-500/10 text-red-500">
                <AlertCircle className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">{issueCount}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">{issueCount} system issue{issueCount > 1 ? 's' : ''} detected</p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Daemon Status with Logs Popover */}
        <Popover open={logsOpen} onOpenChange={setLogsOpen}>
          <PopoverTrigger asChild>
            <div>
              <StatusIndicator
                label="Night Shift"
                status={daemonStatus}
                icon={<Moon className="h-3.5 w-3.5" />}
                onClick={handleDaemonClick}
                loading={loading === 'daemon'}
                tooltip={
                  daemonStatus === 'online'
                    ? 'Click to view logs'
                    : daemonStatus === 'starting'
                    ? 'Starting...'
                    : 'Click to start daemon'
                }
              />
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-96 p-0" align="end">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-medium">Night Shift Logs</span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRestartDaemon}
                  disabled={loading === 'daemon'}
                >
                  <RefreshCw className={cn('h-4 w-4', loading === 'daemon' && 'animate-spin')} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleStopDaemon}
                  disabled={loading === 'daemon' || daemonStatus !== 'online'}
                  className="text-red-500 hover:text-red-600"
                >
                  Stop
                </Button>
              </div>
            </div>
            <ScrollArea className="h-64">
              <div className="p-2 font-mono text-xs">
                {logs.length === 0 ? (
                  <div className="text-muted-foreground text-center py-4">
                    No logs yet. Start the daemon to see output.
                  </div>
                ) : (
                  logs.map((log, i) => (
                    <div
                      key={i}
                      className={cn(
                        'py-0.5',
                        log.includes('[ERR]') && 'text-red-400',
                        log.includes('PANIC') && 'text-red-500 font-bold'
                      )}
                    >
                      {log}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>

        {/* Data Drive */}
        <StatusIndicator
          label="Drive"
          status={health.dataDrive}
          icon={<HardDrive className="h-3.5 w-3.5" />}
          tooltip={
            health.dataDrive
              ? 'VelocityData connected'
              : 'VelocityData not mounted'
          }
        />

        {/* API */}
        <StatusIndicator
          label="API"
          status={health.api}
          icon={<Wifi className="h-3.5 w-3.5" />}
          tooltip={health.api ? 'API keys configured' : 'API keys missing'}
        />

        {/* Bridge */}
        <StatusIndicator
          label="Bridge"
          status={health.bridge}
          icon={<Server className="h-3.5 w-3.5" />}
          tooltip={
            health.bridge
              ? 'Bridge server running on :8080'
              : 'Bridge offline - start bridge_server.py'
          }
        />
      </div>
    </TooltipProvider>
  );
}
