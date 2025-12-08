/**
 * PopoutContainer - Renders components inside pop-out windows
 *
 * PHASE 5: Operational Excellence
 *
 * This component is mounted in pop-out windows and renders the appropriate
 * visualization based on the visualizationType received from the main window.
 *
 * ADHD Design:
 * - Clean, focused view without navigation
 * - Real-time data updates
 * - Minimal chrome for maximum content
 */

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

// Import components that can be rendered in popouts
import { PnLDashboard } from '@/components/money/PnLDashboard';
import { EquityCurve } from '@/components/money/EquityCurve';
import { TradeLog } from '@/components/money/TradeLog';
import { RiskMonitor } from '@/components/risk/RiskMonitor';
import { StrategyLibrary } from '@/components/strategy/StrategyLibrary';
import { StrategyDetail } from '@/components/strategy/StrategyDetail';
import { PipelineMonitor } from '@/components/operations/PipelineMonitor';
import { SwarmMonitor } from '@/components/operations/SwarmMonitor';
import { BacktestMonitor } from '@/components/operations/BacktestMonitor';
import { AlertCenter } from '@/components/safety/AlertCenter';
import { MissionControl } from '@/components/observatory/MissionControl';

// =========================================================================
// Types
// =========================================================================

interface PopoutData {
  id: string;
  visualizationType: string;
  data: unknown;
  title: string;
}

// =========================================================================
// Component Registry
// =========================================================================

const COMPONENT_REGISTRY: Record<string, React.ComponentType<{ data?: unknown }>> = {
  'pnl-dashboard': PnLDashboard as React.ComponentType<{ data?: unknown }>,
  'equity-curve': EquityCurve as React.ComponentType<{ data?: unknown }>,
  'trade-log': TradeLog as React.ComponentType<{ data?: unknown }>,
  'risk-monitor': RiskMonitor as React.ComponentType<{ data?: unknown }>,
  'strategy-library': StrategyLibrary as React.ComponentType<{ data?: unknown }>,
  'strategy-detail': StrategyDetail as React.ComponentType<{ data?: unknown }>,
  'pipeline-monitor': PipelineMonitor as React.ComponentType<{ data?: unknown }>,
  'swarm-monitor': SwarmMonitor as React.ComponentType<{ data?: unknown }>,
  'backtest-monitor': BacktestMonitor as React.ComponentType<{ data?: unknown }>,
  'alert-center': AlertCenter as React.ComponentType<{ data?: unknown }>,
  'mission-control': MissionControl as React.ComponentType<{ data?: unknown }>,
};

// =========================================================================
// Component
// =========================================================================

export function PopoutContainer() {
  const [popoutData, setPopoutData] = useState<PopoutData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Listen for initial data from main window
    const cleanupData = window.electron?.onPopoutData((data) => {
      console.log('[PopoutContainer] Received initial data:', data);
      setPopoutData(data);
      setIsLoading(false);
    });

    // Listen for data updates
    const cleanupUpdate = window.electron?.onPopoutDataUpdate((update) => {
      console.log('[PopoutContainer] Received data update:', update);
      setPopoutData((prev) => (prev ? { ...prev, data: update.data } : null));
    });

    // Listen for broadcasts
    const cleanupBroadcast = window.electron?.onPopoutBroadcast((broadcast) => {
      console.log('[PopoutContainer] Received broadcast:', broadcast);
      // Handle broadcast updates if needed
    });

    return () => {
      cleanupData?.();
      cleanupUpdate?.();
      cleanupBroadcast?.();
    };
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading visualization...</p>
        </div>
      </div>
    );
  }

  // No data received
  if (!popoutData) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <p className="text-lg font-medium text-foreground mb-2">No Data</p>
          <p className="text-muted-foreground">
            This window did not receive visualization data.
          </p>
        </div>
      </div>
    );
  }

  // Get the component to render
  const Component = COMPONENT_REGISTRY[popoutData.visualizationType];

  // Unknown visualization type
  if (!Component) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <p className="text-lg font-medium text-foreground mb-2">
            Unknown Visualization
          </p>
          <p className="text-muted-foreground">
            Type: {popoutData.visualizationType}
          </p>
        </div>
      </div>
    );
  }

  // Render the component
  return (
    <div className="h-screen overflow-auto bg-background p-4">
      <Component data={popoutData.data} />
    </div>
  );
}

export default PopoutContainer;
