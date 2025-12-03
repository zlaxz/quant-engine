/**
 * Mission Control Popout Window
 * Standalone window for multi-monitor command center setup
 */

import { useEffect, useState } from 'react';
import { MissionControlProvider } from '@/contexts/MissionControlContext';
import { MissionControl } from '@/components/research/MissionControl';

export default function MissionControlPopout() {
  const [isReady, setIsReady] = useState(false);

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
    <MissionControlProvider>
      <div className="h-screen bg-background text-foreground p-4">
        <MissionControl isPopout={true} className="h-full" />
      </div>
    </MissionControlProvider>
  );
}
