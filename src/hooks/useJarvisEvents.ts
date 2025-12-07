/**
 * useJarvisEvents - Listen for engine events and control UI panels
 *
 * This hook receives JARVIS events from the Python engine via IPC
 * and routes them to the appropriate UI systems:
 * - View switching via VisualizationContext
 * - Charts/tables/metrics via ResearchDisplayContext
 * - Notifications via toast
 * - Progress via ResearchDisplayContext
 * - Pipeline stages for visualization
 * - Swarm states for monitoring
 * - P&L data for heatmap
 *
 * Event flow:
 * Python emit_ui_event() → JSON file → Watcher → IPC → this hook → UI updates
 */

import { useEffect, useCallback, useState, useMemo } from 'react';
import { useVisualizationContext, directiveToView } from '@/contexts/VisualizationContext';
import { useResearchDisplay } from '@/contexts/ResearchDisplayContext';
import { toast } from 'sonner';
import {
  JarvisEvent,
  JarvisActivityType,
  ACTIVITY_VIEW_MAP,
  ACTIVITY_LABELS,
} from '@/types/jarvis';
import { PipelineStage } from '@/components/trading/PipelineVisualization';
import { SwarmState, SwarmAgent } from '@/components/trading/SwarmActivityMonitor';
import { DailyPnL } from '@/components/trading/PnLHeatmap';
import {
  Database,
  Cpu,
  Search,
  Calculator,
  Scale,
  Brain,
  FileText,
} from 'lucide-react';

// Re-export types for backwards compatibility
export type { JarvisEvent } from '@/types/jarvis';

// Enhanced event with additional fields for the new components
export interface EnhancedJarvisEvent {
  id: string;
  timestamp: string;
  activity_type?: string;
  message?: string;
  progress?: number;
  data?: Record<string, unknown>;
}

// Extended state for all new components
export interface ExtendedJarvisState {
  // Original state
  lastEvent: JarvisEvent | null;
  progress: number | null;
  currentActivity: JarvisActivityType | null;
  activityLabel: string;
  message: string;
  isActive: boolean;

  // Extended state for new components
  events: EnhancedJarvisEvent[];
  pipelineStages: PipelineStage[];
  swarmState: SwarmState[];
  pnlData: DailyPnL[];
  isConnected: boolean;
  lastEventTime: Date | null;
}

// Generate default pipeline stages
function generateDefaultPipelineStages(): PipelineStage[] {
  return [
    {
      id: 'raw_data',
      name: 'Raw Data',
      description: 'Options chain & OHLCV',
      icon: Database,
      status: 'complete',
      progress: 100,
      output: '394M rows',
      metrics: { rows: '394M', symbols: 16 }
    },
    {
      id: 'features',
      name: 'Features',
      description: 'Physics feature extraction',
      icon: Cpu,
      status: 'complete',
      progress: 100,
      output: '496 features',
      metrics: { morphology: 45, dynamics: 38, flow: 32, entropy: 28 }
    },
    {
      id: 'scout',
      name: 'Scout Swarm',
      description: 'Genetic feature selection',
      icon: Search,
      status: 'complete',
      progress: 100,
      output: '50 selected',
      metrics: { population: 100, generations: 20 }
    },
    {
      id: 'math',
      name: 'Math Swarm',
      description: 'Equation discovery (PySR)',
      icon: Calculator,
      status: 'idle',
      progress: 0,
      metrics: { equations: 0 }
    },
    {
      id: 'jury',
      name: 'Jury Swarm',
      description: 'Regime classification',
      icon: Scale,
      status: 'idle',
      progress: 0,
      metrics: { regimes: 4 }
    },
    {
      id: 'ai_native',
      name: 'AI-Native',
      description: 'Observer synthesis',
      icon: Brain,
      status: 'idle',
      progress: 0,
      metrics: { observers: 20 }
    },
    {
      id: 'playbook',
      name: 'Playbook',
      description: 'Trading rules',
      icon: FileText,
      status: 'idle',
      progress: 0,
      metrics: { strategies: 0 }
    }
  ];
}

// Generate default swarm states
function generateDefaultSwarmState(): SwarmState[] {
  const createAgents = (count: number, type: SwarmAgent['type']): SwarmAgent[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `${type}-${i}`,
      type,
      status: i < count * 0.7 ? 'complete' : i < count * 0.9 ? 'working' : 'idle',
      progress: i < count * 0.7 ? 100 : i < count * 0.9 ? Math.floor(Math.random() * 80) : 0,
      task: `Analyzing ${['gamma', 'flow', 'entropy', 'regime', 'correlation'][i % 5]}`
    })) as SwarmAgent[];
  };

  return [
    {
      id: 'swarm-1',
      name: 'Factor Discovery',
      type: 'factor_discovery',
      status: 'running',
      agents: createAgents(100, 'analyst'),
      startTime: new Date(Date.now() - 120000),
      completedCount: 72,
      totalCount: 100,
      successRate: 100,
      avgDuration: 1.8
    },
    {
      id: 'swarm-2',
      name: 'Multi-Asset',
      type: 'multi_asset',
      status: 'running',
      agents: createAgents(100, 'observer'),
      startTime: new Date(Date.now() - 180000),
      completedCount: 85,
      totalCount: 100,
      successRate: 98,
      avgDuration: 2.1
    },
    {
      id: 'swarm-3',
      name: 'Structure Discovery',
      type: 'structure_discovery',
      status: 'complete',
      agents: createAgents(96, 'math'),
      startTime: new Date(Date.now() - 300000),
      completedCount: 96,
      totalCount: 96,
      successRate: 100,
      avgDuration: 2.8
    }
  ];
}

// Generate demo P&L data
function generateDemoPnLData(): DailyPnL[] {
  const data: DailyPnL[] = [];
  const today = new Date();
  const regimes = ['LOW_VOL', 'HIGH_VOL', 'TRENDING', 'RANGING'];

  for (let i = 365; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    // Generate realistic-looking P&L
    const baseReturn = (Math.random() - 0.48) * 0.03; // Slight positive bias
    const volatility = Math.random() > 0.9 ? 3 : 1; // Occasional big moves
    const returnPct = baseReturn * volatility;
    const pnl = returnPct * 100000; // Assuming $100k portfolio

    data.push({
      date: date.toISOString().split('T')[0],
      pnl,
      returnPct,
      trades: Math.floor(Math.random() * 5) + 1,
      regime: regimes[Math.floor(Math.random() * regimes.length)]
    });
  }

  return data;
}

export function useJarvisEvents(): ExtendedJarvisState {
  const { setView } = useVisualizationContext();
  const { showChart, showTable, showMetrics, updateProgress } = useResearchDisplay();

  // Core state
  const [lastEvent, setLastEvent] = useState<JarvisEvent | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [currentActivity, setCurrentActivity] = useState<JarvisActivityType | null>(null);
  const [message, setMessage] = useState('');
  const [isActive, setIsActive] = useState(false);

  // Extended state for new components
  const [events, setEvents] = useState<EnhancedJarvisEvent[]>([]);
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>(() => generateDefaultPipelineStages());
  const [swarmState, setSwarmState] = useState<SwarmState[]>(() => generateDefaultSwarmState());
  const [pnlData] = useState<DailyPnL[]>(() => generateDemoPnLData());
  const [isConnected, setIsConnected] = useState(false);
  const [lastEventTime, setLastEventTime] = useState<Date | null>(null);

  const activityLabel = useMemo(() => {
    return currentActivity ? ACTIVITY_LABELS[currentActivity] || currentActivity : ACTIVITY_LABELS['idle'];
  }, [currentActivity]);

  const handleEvent = useCallback((event: JarvisEvent) => {
    console.log('[JARVIS] Received event:', event.activityType, event.content);

    const activityType = event.activityType as JarvisActivityType;
    const timestamp = new Date().toISOString();

    // Update core state
    setLastEvent(event);
    setCurrentActivity(activityType);
    setMessage(event.content);
    setIsActive(activityType !== 'idle');
    setLastEventTime(new Date());
    setIsConnected(true);

    // Add to events list
    const enhancedEvent: EnhancedJarvisEvent = {
      id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp,
      activity_type: activityType,
      message: event.content,
      progress: undefined,
      data: event.data,
    };
    setEvents(prev => [enhancedEvent, ...prev].slice(0, 100)); // Keep last 100 events

    // Process display directives
    for (const directive of event.displayDirectives) {
      switch (directive.type) {
        case 'view':
          const view = directiveToView(String(directive.value));
          if (view) {
            console.log('[JARVIS] Switching view to:', view);
            setView(view);
          }
          break;

        case 'progress':
          const progressValue = directive.value as number;
          setProgress(progressValue);
          setMessage(directive.message || event.content);
          updateProgress(progressValue, directive.message);

          // Update enhanced event with progress
          setEvents(prev => {
            const updated = [...prev];
            if (updated[0]) {
              updated[0] = { ...updated[0], progress: progressValue };
            }
            return updated;
          });
          break;

        case 'chart':
          if (directive.value && typeof directive.value === 'object') {
            const chartValue = directive.value as Record<string, unknown>;
            console.log('[JARVIS] Showing chart:', chartValue.id || 'unnamed');
            showChart({
              id: (chartValue.id as string) || `chart_${Date.now()}`,
              type: (chartValue.type as string) || 'bar',
              title: (chartValue.title as string) || 'Chart',
              data: chartValue.data || chartValue,
            });
          }
          break;

        case 'table':
          if (directive.value && typeof directive.value === 'object') {
            const tableValue = directive.value as Record<string, unknown>;
            console.log('[JARVIS] Showing table:', tableValue.id || 'unnamed');
            showTable({
              id: (tableValue.id as string) || `table_${Date.now()}`,
              title: (tableValue.title as string) || 'Table',
              columns: (tableValue.columns as Array<{ key: string; label: string }>) || [],
              rows: (tableValue.rows as Array<Record<string, unknown>>) || [],
            });
          }
          break;

        case 'metrics':
          if (directive.value && typeof directive.value === 'object') {
            const metricsValue = directive.value as Record<string, unknown>;
            console.log('[JARVIS] Showing metrics:', metricsValue.id || 'unnamed');
            showMetrics({
              id: (metricsValue.id as string) || `metrics_${Date.now()}`,
              title: (metricsValue.title as string) || 'Metrics',
              metrics: (metricsValue.metrics as Array<{ label: string; value: string | number }>) || [],
            });
          }
          break;

        case 'notification':
          const notif = directive.value as { type?: string; title?: string; message?: string };
          const notifType = notif?.type || 'info';
          const notifTitle = notif?.title || 'Engine Update';
          const notifMessage = notif?.message || event.content;

          console.log('[JARVIS] Notification:', notifType, notifTitle);

          switch (notifType) {
            case 'success':
              toast.success(notifTitle, { description: notifMessage });
              break;
            case 'error':
              toast.error(notifTitle, { description: notifMessage });
              break;
            case 'warning':
              toast.warning(notifTitle, { description: notifMessage });
              break;
            default:
              toast.info(notifTitle, { description: notifMessage });
          }
          break;

        default:
          console.log('[JARVIS] Unknown directive type:', directive.type);
          break;
      }
    }

    // Update pipeline stages based on activity type
    if (activityType === 'discovery' || activityType === 'swarm_work') {
      const stageId = event.data?.stage as string;
      const stageProgress = event.data?.progress as number;

      if (stageId) {
        setPipelineStages(prev =>
          prev.map(stage =>
            stage.id === stageId
              ? {
                  ...stage,
                  status: stageProgress === 100 ? 'complete' : 'running',
                  progress: stageProgress || stage.progress,
                }
              : stage
          )
        );
      }
    }

    // Update swarm state based on swarm events
    if (activityType === 'swarm_work' && event.data?.swarm) {
      const swarmData = event.data.swarm as Partial<SwarmState>;
      setSwarmState(prev =>
        prev.map(swarm =>
          swarm.id === swarmData.id
            ? { ...swarm, ...swarmData }
            : swarm
        )
      );
    }

    // If no view directive, use activity type to determine view
    if (!event.displayDirectives.some(d => d.type === 'view')) {
      const defaultView = ACTIVITY_VIEW_MAP[activityType];
      if (defaultView) {
        console.log('[JARVIS] Activity-based view switch:', defaultView);
        setView(defaultView);
      }
    }
  }, [setView, showChart, showTable, showMetrics, updateProgress]);

  useEffect(() => {
    // Check if we're in Electron environment
    if (typeof window === 'undefined' || !window.electron?.onJarvisEvent) {
      console.log('[JARVIS] Not in Electron environment, events disabled');
      // Still mark as connected with demo data
      setIsConnected(true);
      return;
    }

    console.log('[JARVIS] Subscribing to engine events');
    setIsConnected(true);

    const cleanup = window.electron.onJarvisEvent(handleEvent);

    return () => {
      console.log('[JARVIS] Unsubscribing from engine events');
      cleanup();
    };
  }, [handleEvent]);

  // Simulate swarm progress updates (for demo purposes)
  useEffect(() => {
    const interval = setInterval(() => {
      setSwarmState(prev =>
        prev.map(swarm => {
          if (swarm.status !== 'running') return swarm;

          const newCompleted = Math.min(swarm.completedCount + 1, swarm.totalCount);
          const newStatus = newCompleted >= swarm.totalCount ? 'complete' : 'running';

          return {
            ...swarm,
            completedCount: newCompleted,
            status: newStatus,
            agents: swarm.agents.map((agent, i) =>
              i < newCompleted
                ? { ...agent, status: 'complete' as const, progress: 100 }
                : agent
            ),
          };
        })
      );
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return {
    // Original state
    lastEvent,
    progress,
    currentActivity,
    activityLabel,
    message,
    isActive,

    // Extended state for new components
    events,
    pipelineStages,
    swarmState,
    pnlData,
    isConnected,
    lastEventTime,
  };
}
