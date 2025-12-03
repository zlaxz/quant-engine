/**
 * VisualizationContext - Manages which view is shown in the right panel
 * Responds to [DISPLAY: VIEW_NAME] directives from chat
 */

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export type VisualizationView = 
  | 'default'
  | 'mission'
  | 'swarm'
  | 'graduation'
  | 'backtest'
  | 'integrity'
  | 'insight';

interface VisualizationContextType {
  currentView: VisualizationView;
  setView: (view: VisualizationView) => void;
  resetToDefault: () => void;
}

const VisualizationContext = createContext<VisualizationContextType | null>(null);

export function VisualizationProvider({ children }: { children: ReactNode }) {
  const [currentView, setCurrentView] = useState<VisualizationView>('default');

  const setView = useCallback((view: VisualizationView) => {
    setCurrentView(view);
  }, []);

  const resetToDefault = useCallback(() => {
    setCurrentView('default');
  }, []);

  return (
    <VisualizationContext.Provider value={{ currentView, setView, resetToDefault }}>
      {children}
    </VisualizationContext.Provider>
  );
}

export function useVisualizationContext(): VisualizationContextType {
  const context = useContext(VisualizationContext);
  if (!context) {
    throw new Error('useVisualizationContext must be used within VisualizationProvider');
  }
  return context;
}

// Map directive strings to view types
export function directiveToView(directive: string): VisualizationView | null {
  const normalized = directive.toUpperCase().trim();
  
  switch (normalized) {
    case 'MISSION':
    case 'MISSION_CONTROL':
      return 'mission';
    case 'SWARM':
    case 'SWARM_MONITOR':
    case 'HIVE':
      return 'swarm';
    case 'GRADUATION':
    case 'GRADUATION_TRACKER':
    case 'PIPELINE':
      return 'graduation';
    case 'BACKTEST':
    case 'BACKTEST_RUNNER':
      return 'backtest';
    case 'INTEGRITY':
    case 'SYSTEM_INTEGRITY':
      return 'integrity';
    case 'INSIGHT':
    case 'CIO_INSIGHT':
    case 'TOOLS':
      return 'insight';
    case 'DEFAULT':
    case 'FINDINGS':
      return 'default';
    default:
      return null;
  }
}
