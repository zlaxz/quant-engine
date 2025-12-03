/**
 * PopoutVisualization - Standalone page for pop-out visualization windows
 * 
 * Receives data via IPC and renders the appropriate visualization.
 * Supports real-time updates.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { GenericChart, GenericTable, MetricsDashboard, CodeDisplay } from '@/components/charts';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Maximize2, Minimize2, RefreshCw, Pin, PinOff } from 'lucide-react';
import { cn } from '@/lib/utils';

// Dashboard components for popout
import { MissionControl } from '@/components/dashboard/MissionControl';
import { SwarmHiveMonitor } from '@/components/swarm/SwarmHiveMonitor';
import { GraduationTracker } from '@/components/dashboard/GraduationTracker';
import { BacktestRunner } from '@/components/dashboard/BacktestRunner';
import { SystemIntegrity } from '@/components/dashboard/SystemIntegrity';
import { FindingsPanel } from '@/components/research/FindingsPanel';

interface PopoutData {
  id: string;
  visualizationType: string;
  data: any;
  title?: string;
}

export default function PopoutVisualization() {
  const { id } = useParams<{ id: string }>();
  const [popoutData, setPopoutData] = useState<PopoutData | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [updateCount, setUpdateCount] = useState(0);

  useEffect(() => {
    if (!window.electron) return undefined;

    // Listen for initial data via IPC
    const handleData = (_event: any, data: PopoutData) => {
      console.log('[PopoutVisualization] Received data:', data.id);
      setPopoutData(data);
      setLastUpdate(new Date());
    };

    // Listen for real-time updates
    const handleUpdate = (_event: any, update: { id: string; data: any }) => {
      if (update.id === id) {
        console.log('[PopoutVisualization] Received update');
        setPopoutData(prev => prev ? { ...prev, data: update.data } : null);
        setLastUpdate(new Date());
        setUpdateCount(c => c + 1);
      }
    };

    // Listen for broadcasts (global updates)
    const handleBroadcast = (_event: any, broadcast: { type: string; payload: any }) => {
      console.log('[PopoutVisualization] Broadcast:', broadcast.type);
    };

    // Use ipcRenderer directly for popout-specific events
    const { ipcRenderer } = window.require?.('electron') || {};
    if (ipcRenderer) {
      ipcRenderer.on('popout:data', handleData);
      ipcRenderer.on('popout:data-update', handleUpdate);
      ipcRenderer.on('popout:broadcast', handleBroadcast);

      return () => {
        ipcRenderer.removeListener('popout:data', handleData);
        ipcRenderer.removeListener('popout:data-update', handleUpdate);
        ipcRenderer.removeListener('popout:broadcast', handleBroadcast);
      };
    }
    
    return undefined;
  }, [id]);

  // Render the appropriate visualization based on type
  const renderVisualization = () => {
    if (!popoutData) return null;

    const { visualizationType, data } = popoutData;

    // Dashboard component types
    switch (visualizationType) {
      case 'default':
        return <FindingsPanel />;
      case 'mission':
        return <MissionControl />;
      case 'swarm':
        return <SwarmHiveMonitor />;
      case 'graduation':
        return <GraduationTracker />;
      case 'backtest':
        return <BacktestRunner />;
      case 'integrity':
        return <SystemIntegrity />;
      case 'chart':
        return <GenericChart data={data} />;
      case 'table':
        return <GenericTable data={data} />;
      case 'metrics':
        return <MetricsDashboard data={data} />;
      case 'code':
        return <CodeDisplay data={data} />;
      default:
        // Try to auto-detect from data
        if (data?.type && data?.data) {
          return <GenericChart data={data} />;
        }
        if (data?.columns && data?.rows) {
          return <GenericTable data={data} />;
        }
        if (data?.metrics) {
          return <MetricsDashboard data={data} />;
        }
        return (
          <pre className="p-4 bg-muted rounded text-xs overflow-auto">
            {JSON.stringify(data, null, 2)}
          </pre>
        );
    }
  };

  if (!popoutData) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading visualization...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'h-screen flex flex-col bg-background',
      isMaximized && 'p-0',
      !isMaximized && 'p-4'
    )}>
      {/* Header bar */}
      <div className="flex items-center justify-between mb-2 px-2">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold truncate max-w-[200px]">
            {popoutData.title || 'Visualization'}
          </h1>
          <Badge variant="outline" className="text-[10px]">
            {popoutData.visualizationType}
          </Badge>
          {updateCount > 0 && (
            <Badge variant="secondary" className="text-[10px] bg-green-500/20 text-green-600">
              {updateCount} update{updateCount > 1 ? 's' : ''}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsPinned(!isPinned)}
            title={isPinned ? 'Unpin' : 'Pin on top'}
          >
            {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsMaximized(!isMaximized)}
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Visualization container */}
      <Card className="flex-1 overflow-auto">
        <div className="p-4 h-full">
          {renderVisualization()}
        </div>
      </Card>

      {/* Footer with last update time */}
      {lastUpdate && (
        <div className="text-[10px] text-muted-foreground text-center mt-2">
          Last updated: {lastUpdate.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
