/**
 * ThetaTerminalIndicator - Shows ThetaData Terminal status with restart button
 */

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Database, Play, Loader2, RefreshCw } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface ThetaStatus {
  status: 'NOT_INSTALLED' | 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR';
  httpPort: number;
  wsPort: number;
  v3Port: number;
  jarExists: boolean;
  credentialsConfigured: boolean;
  responding: boolean;
}

// Type helper for electron API methods that may not be recognized by TS cache
type ElectronWithTheta = {
  getThetaTerminalStatus?: () => Promise<ThetaStatus>;
  startThetaTerminal?: () => Promise<boolean>;
  stopThetaTerminal?: () => Promise<void>;
};

export function ThetaTerminalIndicator() {
  const [status, setStatus] = useState<ThetaStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    const electron = window.electron as ElectronWithTheta | undefined;
    if (!electron?.getThetaTerminalStatus) return;
    try {
      const result = await electron.getThetaTerminalStatus();
      setStatus(result);
    } catch (err) {
      console.error('Error fetching Theta status:', err);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleStart = async () => {
    const electron = window.electron as ElectronWithTheta | undefined;
    if (!electron?.startThetaTerminal) {
      console.error('startThetaTerminal not available');
      return;
    }

    setLoading(true);
    try {
      await electron.startThetaTerminal();
      // Wait a bit then refresh status
      setTimeout(fetchStatus, 2000);
    } catch (err) {
      console.error('Error starting Theta Terminal:', err);
    } finally {
      setTimeout(() => setLoading(false), 5000);
    }
  };

  const handleRestart = async () => {
    const electron = window.electron as ElectronWithTheta | undefined;
    if (!electron?.stopThetaTerminal || !electron?.startThetaTerminal) {
      console.error('Theta Terminal controls not available');
      return;
    }

    setLoading(true);
    try {
      await electron.stopThetaTerminal();
      await new Promise(resolve => setTimeout(resolve, 2000));
      await electron.startThetaTerminal();
      setTimeout(fetchStatus, 2000);
    } catch (err) {
      console.error('Error restarting Theta Terminal:', err);
    } finally {
      setTimeout(() => setLoading(false), 5000);
    }
  };

  const isOnline = status?.status === 'RUNNING' && status?.responding;
  const isStarting = status?.status === 'STARTING' || loading;
  const hasError = status?.status === 'ERROR';
  const notInstalled = status?.status === 'NOT_INSTALLED';

  const getStatusColor = () => {
    if (isOnline) return 'bg-cyan-500';
    if (isStarting) return 'bg-yellow-500 animate-pulse';
    if (hasError) return 'bg-red-500 animate-pulse';
    if (notInstalled) return 'bg-gray-500';
    return 'bg-red-500 animate-pulse';
  };

  const getStatusText = () => {
    if (loading) return 'Starting...';
    if (isOnline) return `v3:${status?.v3Port}`;
    if (isStarting) return 'Starting...';
    if (hasError) return 'Error';
    if (notInstalled) return 'Not Installed';
    return 'Offline';
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5">
            {/* Status indicator */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50 border border-border">
              <div className={cn('w-2 h-2 rounded-full', getStatusColor())} />
              <Database className="h-3.5 w-3.5 text-cyan-500" />
              <span className="text-xs font-mono text-muted-foreground">
                {getStatusText()}
              </span>
            </div>

            {/* Start button - only show when offline and not starting */}
            {!isOnline && !isStarting && !notInstalled && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleStart}
                title="Start Theta Terminal"
              >
                <Play className="h-3.5 w-3.5 text-cyan-500" />
              </Button>
            )}

            {/* Restart button - show when online or has error */}
            {(isOnline || hasError) && !isStarting && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleRestart}
                title="Restart Theta Terminal"
              >
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground hover:text-cyan-500" />
              </Button>
            )}

            {/* Loading spinner when starting */}
            {isStarting && (
              <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="text-xs space-y-1">
            <p className="font-semibold">ThetaData Terminal</p>
            {isOnline ? (
              <>
                <p className="text-cyan-500">Online - Responding</p>
                <p className="text-muted-foreground">v3 Port: {status?.v3Port}</p>
              </>
            ) : isStarting ? (
              <p className="text-yellow-500">Starting terminal...</p>
            ) : notInstalled ? (
              <p className="text-gray-500">JAR not found at configured path</p>
            ) : hasError ? (
              <p className="text-red-500">Error - Click restart to retry</p>
            ) : (
              <p className="text-red-500">Offline - Click play to start</p>
            )}
            {!status?.credentialsConfigured && (
              <p className="text-orange-500">⚠ Credentials not configured</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
