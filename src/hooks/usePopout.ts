/**
 * usePopout - React hook for multi-window pop-out support
 *
 * PHASE 5: Operational Excellence
 *
 * Features:
 * - Pop any component to its own window
 * - Automatic data sync between windows
 * - Multi-monitor placement (auto-detects second monitor)
 * - Tracks open popouts to prevent duplicates
 *
 * ADHD Design:
 * - Spatial separation for focus
 * - Keep critical info visible while working
 * - Reduce tab-switching cognitive load
 */

import { useState, useEffect, useCallback } from 'react';

// =========================================================================
// Types
// =========================================================================

interface PopoutConfig {
  id: string;
  title: string;
  visualizationType: string;
  data?: unknown;
  width?: number;
  height?: number;
}

interface PopoutState {
  openPopouts: string[];
  isCreating: boolean;
  error: string | null;
}

// =========================================================================
// Hook
// =========================================================================

export function usePopout() {
  const [state, setState] = useState<PopoutState>({
    openPopouts: [],
    isCreating: false,
    error: null,
  });

  // Fetch initial list of open popouts
  useEffect(() => {
    const fetchPopouts = async () => {
      try {
        const list = await window.electron?.popoutList();
        if (list) {
          setState((prev) => ({ ...prev, openPopouts: list }));
        }
      } catch (err) {
        console.error('[usePopout] Failed to list popouts:', err);
      }
    };

    fetchPopouts();

    // Listen for popout closed events
    const cleanup = window.electron?.onPopoutClosed(({ id }) => {
      setState((prev) => ({
        ...prev,
        openPopouts: prev.openPopouts.filter((p) => p !== id),
      }));
    });

    return () => {
      cleanup?.();
    };
  }, []);

  // Create a pop-out window
  const createPopout = useCallback(async (config: PopoutConfig) => {
    setState((prev) => ({ ...prev, isCreating: true, error: null }));

    try {
      const result = await window.electron?.popoutCreate({
        id: config.id,
        title: config.title,
        visualizationType: config.visualizationType,
        data: config.data,
        width: config.width || 700,
        height: config.height || 600,
      });

      if (result?.success) {
        setState((prev) => ({
          ...prev,
          isCreating: false,
          openPopouts: [...prev.openPopouts, config.id],
        }));
        return true;
      } else {
        throw new Error('Failed to create popout');
      }
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        isCreating: false,
        error: err.message || 'Failed to create popout',
      }));
      return false;
    }
  }, []);

  // Update data in a pop-out window
  const updatePopout = useCallback(async (id: string, data: unknown) => {
    try {
      await window.electron?.popoutUpdate(id, data);
    } catch (err) {
      console.error('[usePopout] Failed to update popout:', err);
    }
  }, []);

  // Close a pop-out window
  const closePopout = useCallback(async (id: string) => {
    try {
      await window.electron?.popoutClose(id);
      setState((prev) => ({
        ...prev,
        openPopouts: prev.openPopouts.filter((p) => p !== id),
      }));
    } catch (err) {
      console.error('[usePopout] Failed to close popout:', err);
    }
  }, []);

  // Focus a pop-out window
  const focusPopout = useCallback(async (id: string) => {
    try {
      await window.electron?.popoutFocus(id);
    } catch (err) {
      console.error('[usePopout] Failed to focus popout:', err);
    }
  }, []);

  // Toggle a pop-out window (create if closed, focus if open)
  const togglePopout = useCallback(
    async (config: PopoutConfig) => {
      if (state.openPopouts.includes(config.id)) {
        await focusPopout(config.id);
      } else {
        await createPopout(config);
      }
    },
    [state.openPopouts, createPopout, focusPopout]
  );

  // Broadcast data to all pop-out windows
  const broadcast = useCallback(async (type: string, payload: unknown) => {
    try {
      await window.electron?.popoutBroadcast(type, payload);
    } catch (err) {
      console.error('[usePopout] Failed to broadcast:', err);
    }
  }, []);

  // Check if a specific popout is open
  const isPopoutOpen = useCallback(
    (id: string) => state.openPopouts.includes(id),
    [state.openPopouts]
  );

  return {
    // State
    openPopouts: state.openPopouts,
    isCreating: state.isCreating,
    error: state.error,

    // Actions
    createPopout,
    updatePopout,
    closePopout,
    focusPopout,
    togglePopout,
    broadcast,

    // Utilities
    isPopoutOpen,
  };
}

// =========================================================================
// Preset popout configurations for common components
// =========================================================================

export const POPOUT_PRESETS = {
  missionControl: {
    id: 'mission-control',
    title: 'Mission Control',
    visualizationType: 'mission-control',
    width: 400,
    height: 600,
  },
  pnlDashboard: {
    id: 'pnl-dashboard',
    title: 'P&L Dashboard',
    visualizationType: 'pnl-dashboard',
    width: 800,
    height: 600,
  },
  equityCurve: {
    id: 'equity-curve',
    title: 'Equity Curve',
    visualizationType: 'equity-curve',
    width: 900,
    height: 500,
  },
  riskMonitor: {
    id: 'risk-monitor',
    title: 'Risk Monitor',
    visualizationType: 'risk-monitor',
    width: 700,
    height: 500,
  },
  pipelineMonitor: {
    id: 'pipeline-monitor',
    title: 'Pipeline Monitor',
    visualizationType: 'pipeline-monitor',
    width: 800,
    height: 600,
  },
  swarmMonitor: {
    id: 'swarm-monitor',
    title: 'Swarm Monitor',
    visualizationType: 'swarm-monitor',
    width: 900,
    height: 700,
  },
  backtestMonitor: {
    id: 'backtest-monitor',
    title: 'Backtest Queue',
    visualizationType: 'backtest-monitor',
    width: 800,
    height: 600,
  },
  strategyLibrary: {
    id: 'strategy-library',
    title: 'Strategy Library',
    visualizationType: 'strategy-library',
    width: 1000,
    height: 700,
  },
  tradeLog: {
    id: 'trade-log',
    title: 'Trade Log',
    visualizationType: 'trade-log',
    width: 900,
    height: 600,
  },
  alertCenter: {
    id: 'alert-center',
    title: 'Alert Center',
    visualizationType: 'alert-center',
    width: 500,
    height: 600,
  },
};

export default usePopout;
