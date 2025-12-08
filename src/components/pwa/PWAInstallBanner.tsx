/**
 * PWAInstallBanner - Prompts users to install the PWA
 *
 * ADHD Design:
 * - Non-intrusive banner (doesn't interrupt workflow)
 * - Single action button (no decision paralysis)
 * - Can be dismissed easily
 * - Remembers dismissal for session
 */

import { useState, useEffect } from 'react';
import { Download, X, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePWA } from '@/lib/pwaRegistration';

interface PWAInstallBannerProps {
  className?: string;
}

export function PWAInstallBanner({ className }: PWAInstallBannerProps) {
  const { state, promptInstall, applyUpdate } = usePWA();
  const [dismissed, setDismissed] = useState(false);

  // Check if dismissed this session
  useEffect(() => {
    const wasDismissed = sessionStorage.getItem('pwa-banner-dismissed');
    if (wasDismissed) {
      setDismissed(true);
    }
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('pwa-banner-dismissed', 'true');
  };

  const handleInstall = async () => {
    const accepted = await promptInstall();
    if (accepted) {
      handleDismiss();
    }
  };

  // Show update banner
  if (state.hasUpdate) {
    return (
      <div
        className={cn(
          'fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80',
          'bg-blue-500 text-white rounded-lg shadow-lg p-4',
          'flex items-center gap-3 z-50',
          className
        )}
      >
        <RefreshCw className="h-5 w-5 flex-shrink-0" />
        <div className="flex-1">
          <p className="font-medium text-sm">Update Available</p>
          <p className="text-xs opacity-90">Restart to get the latest version</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={applyUpdate}
          className="flex-shrink-0"
        >
          Update
        </Button>
      </div>
    );
  }

  // Show offline indicator
  if (!state.isOnline) {
    return (
      <div
        className={cn(
          'fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80',
          'bg-yellow-500 text-black rounded-lg shadow-lg p-4',
          'flex items-center gap-3 z-50',
          className
        )}
      >
        <WifiOff className="h-5 w-5 flex-shrink-0" />
        <div className="flex-1">
          <p className="font-medium text-sm">You're Offline</p>
          <p className="text-xs opacity-75">Some features may be unavailable</p>
        </div>
      </div>
    );
  }

  // Show install prompt (only on mobile/tablet, not dismissed, and installable)
  if (state.isInstallable && !dismissed && !state.isInstalled) {
    return (
      <div
        className={cn(
          'fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80',
          'bg-card border rounded-lg shadow-lg p-4',
          'flex items-center gap-3 z-50',
          className
        )}
      >
        <Download className="h-5 w-5 text-green-500 flex-shrink-0" />
        <div className="flex-1">
          <p className="font-medium text-sm">Install Observatory</p>
          <p className="text-xs text-muted-foreground">
            Quick access from your home screen
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDismiss}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={handleInstall}>
            Install
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

/**
 * Online status indicator for the header
 */
export function OnlineStatus({ className }: { className?: string }) {
  const { state } = usePWA();

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-xs',
        state.isOnline ? 'text-green-500' : 'text-yellow-500',
        className
      )}
    >
      {state.isOnline ? (
        <>
          <Wifi className="h-3 w-3" />
          <span>Online</span>
        </>
      ) : (
        <>
          <WifiOff className="h-3 w-3" />
          <span>Offline</span>
        </>
      )}
    </div>
  );
}

export default PWAInstallBanner;
