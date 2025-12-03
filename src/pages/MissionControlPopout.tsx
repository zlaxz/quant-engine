/**
 * Mission Control Popout Window
 * Standalone window for multi-monitor command center setup
 * Syncs state from main window via IPC broadcasts
 */

import { useEffect, useState } from 'react';
import { MissionControlProvider, MissionControlState } from '@/contexts/MissionControlContext';
import { MissionControl } from '@/components/research/MissionControl';

export default function MissionControlPopout() {
  const [isReady, setIsReady] = useState(false);
  const [initialState, setInitialState] = useState<MissionControlState | null>(null);

  useEffect(() => {
    // Wait for IPC to be ready
    const checkReady = () => {
      if (window.electron) {
        setIsReady(true);
      } else {
        setTimeout(checkReady, 100);
      }
    };
    checkReady();
  }, []);

  // Listen for initial data from main window
  useEffect(() => {
    if (!window.electron?.onPopoutData) return;

    const cleanup = window.electron.onPopoutData((data) => {
      if (data.visualizationType === 'mission-control' && data.data) {
        setInitialState(data.data as MissionControlState);
      }
    });

    return cleanup;
  }, []);

  // Listen for state broadcasts from main window
  useEffect(() => {
    if (!window.electron?.onPopoutBroadcast) return;

    const cleanup = window.electron.onPopoutBroadcast((data) => {
      if (data.type === 'mission-control-update' && data.payload) {
        setInitialState(data.payload as MissionControlState);
      }
    });

    return cleanup;
  }, []);

  if (!isReady) {
    return (
      <div className="h-screen flex items-center justify-center bg-background text-foreground">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <div className="text-sm text-muted-foreground">Loading Mission Control...</div>
        </div>
      </div>
    );
  }

  return (
    <MissionControlProvider initialState={initialState}>
      <div className="h-screen bg-background text-foreground p-4">
        <MissionControl isPopout={true} className="h-full" />
      </div>
    </MissionControlProvider>
  );
}
