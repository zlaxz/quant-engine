/**
 * JARVIS Event Types - Shared between Electron and React
 *
 * Used by:
 * - src/electron/preload.ts (IPC type)
 * - src/hooks/useJarvisEvents.ts (React hook)
 * - src/components/JarvisEventHandler.tsx (status bar)
 */

// Display directive types that control the UI
export type JarvisDirectiveType = 'view' | 'progress' | 'chart' | 'table' | 'metrics' | 'notification';

export interface JarvisDisplayDirective {
  type: JarvisDirectiveType;
  value: unknown;
  message?: string;
}

// Event from Python engine
export interface JarvisEvent {
  sessionId: string;
  activityType: JarvisActivityType;
  content: string;
  timestamp: string;
  displayDirectives: JarvisDisplayDirective[];
  data: Record<string, unknown>;
}

// Activity types (matches Python ActivityType enum)
export type JarvisActivityType =
  | 'swarm_work'
  | 'gamma_analysis'
  | 'backtest'
  | 'discovery'
  | 'code_writing'
  | 'regime_detection'
  | 'data_loading'
  | 'idle';

// View types (matches VisualizationView)
export type JarvisView =
  | 'swarm'
  | 'mission'
  | 'backtest'
  | 'graduation'
  | 'integrity'
  | 'insight'
  | 'default';

// State tracked by useJarvisEvents hook
export interface JarvisState {
  lastEvent: JarvisEvent | null;
  progress: number | null;
  currentActivity: JarvisActivityType | null;
  activityLabel: string;
  message: string;
  isActive: boolean;
}

// Map activity types to default views
export const ACTIVITY_VIEW_MAP: Record<JarvisActivityType, JarvisView> = {
  'swarm_work': 'swarm',
  'gamma_analysis': 'insight',
  'backtest': 'backtest',
  'discovery': 'default',
  'code_writing': 'default',
  'regime_detection': 'insight',
  'data_loading': 'default',
  'idle': 'default',
};

// Map activity types to display names
export const ACTIVITY_LABELS: Record<JarvisActivityType, string> = {
  'swarm_work': 'Swarm Analysis',
  'gamma_analysis': 'Gamma Analysis',
  'backtest': 'Backtesting',
  'discovery': 'Discovery',
  'code_writing': 'Writing Code',
  'regime_detection': 'Regime Detection',
  'data_loading': 'Loading Data',
  'idle': 'Idle',
};
