/**
 * PythonServerIndicator - Shows Python server status with start button
 */

import { usePythonHealth } from '@/hooks/usePythonHealth';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Server, Play, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export function PythonServerIndicator() {
  const { isOnline, latencyMs, error } = usePythonHealth();
  const [starting, setStarting] = useState(false);

  const handleStart = async () => {
    if (!window.electron?.startPythonServer) {
      console.error('startPythonServer not available');
      return;
    }

    setStarting(true);
    try {
      const result = await window.electron.startPythonServer();
      if (!result.success) {
        console.error('Failed to start Python server:', result.error);
      }
    } catch (err) {
      console.error('Error starting Python server:', err);
    } finally {
      // Keep loading state for a bit to allow health check to catch up
      setTimeout(() => setStarting(false), 3000);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5">
            {/* Status indicator */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50 border border-border">
              <div
                className={cn(
                  'w-2 h-2 rounded-full',
                  isOnline && 'bg-green-500',
                  !isOnline && !starting && 'bg-red-500 animate-pulse',
                  starting && 'bg-yellow-500 animate-pulse'
                )}
              />
              <Server className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-mono text-muted-foreground">
                {starting ? 'Starting...' : isOnline ? `${latencyMs}ms` : 'Offline'}
              </span>
            </div>

            {/* Start button - only show when offline and not starting */}
            {!isOnline && !starting && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleStart}
                title="Start Python Server"
              >
                <Play className="h-3.5 w-3.5 text-green-500" />
              </Button>
            )}

            {/* Loading spinner when starting */}
            {starting && (
              <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="text-xs">
            <p className="font-semibold">Python Server (localhost:5001)</p>
            {isOnline ? (
              <p className="text-green-500">Online - {latencyMs}ms latency</p>
            ) : starting ? (
              <p className="text-yellow-500">Starting server...</p>
            ) : (
              <p className="text-red-500">{error || 'Offline'}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
