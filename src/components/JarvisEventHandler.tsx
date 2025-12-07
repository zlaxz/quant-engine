/**
 * JarvisEventHandler - Bridge between Python engine events and UI
 *
 * This component subscribes to JARVIS events and handles:
 * - View switching
 * - Progress updates
 * - Chart/table/metrics rendering
 * - Toast notifications
 *
 * It also renders a status bar showing current engine activity.
 */

import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import type { JarvisState } from '@/types/jarvis';
import { Activity, Cpu, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';

// Activity status bar component
function JarvisStatusBar({ state }: { state: JarvisState }) {
  if (!state.isActive && !state.message) {
    return null;
  }

  return (
    <div className={cn(
      "fixed bottom-0 left-0 right-0 z-50 px-4 py-2",
      "bg-gradient-to-r from-cyan-900/90 via-cyan-800/90 to-cyan-900/90",
      "border-t border-cyan-500/30 backdrop-blur-sm",
      "transition-all duration-300",
      state.isActive ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"
    )}>
      <div className="max-w-screen-xl mx-auto flex items-center gap-4">
        {/* Activity indicator */}
        <div className="flex items-center gap-2">
          {state.isActive ? (
            <Zap className="h-4 w-4 text-cyan-400 animate-pulse" />
          ) : (
            <Cpu className="h-4 w-4 text-gray-400" />
          )}
          <span className="text-sm font-medium text-cyan-300">
            {state.activityLabel}
          </span>
        </div>

        {/* Separator */}
        <div className="w-px h-4 bg-cyan-500/30" />

        {/* Message */}
        <div className="flex-1 text-sm text-cyan-100/80 truncate">
          {state.message}
        </div>

        {/* Progress bar (if progress is set) */}
        {state.progress !== null && (
          <div className="flex items-center gap-2 min-w-[150px]">
            <Progress value={state.progress} className="h-2 flex-1" />
            <span className="text-xs text-cyan-300 w-10 text-right">
              {state.progress}%
            </span>
          </div>
        )}

        {/* Activity pulse */}
        {state.isActive && (
          <div className="flex items-center gap-1">
            <Activity className="h-3 w-3 text-green-400 animate-pulse" />
            <span className="text-xs text-green-400">LIVE</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function JarvisEventHandler() {
  // This hook sets up the IPC listener and handles all event routing
  const state = useJarvisEvents();

  // Debug log for development
  if (state.currentActivity && state.currentActivity !== 'idle') {
    console.log('[JarvisEventHandler] Activity:', state.currentActivity, '| Message:', state.message);
  }

  // Render status bar when there's activity
  return <JarvisStatusBar state={state} />;
}
