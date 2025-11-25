/**
 * Live Activity Feed - Real-time daemon event stream
 *
 * Shows what the Night Shift is doing:
 * - Mutations harvested
 * - Backtests running/completed
 * - Strategy graduations
 * - Errors and warnings
 *
 * Created: 2025-11-24
 */

import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Activity,
  Dna,
  GraduationCap,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type EventType =
  | 'mutation_harvested'
  | 'backtest_started'
  | 'backtest_completed'
  | 'backtest_failed'
  | 'graduation'
  | 'error'
  | 'info'
  | 'daemon_started'
  | 'daemon_stopped';

interface ActivityEvent {
  id: string;
  type: EventType;
  message: string;
  timestamp: Date;
  metadata?: {
    strategyName?: string;
    fitness?: number;
    sharpe?: number;
    tradeCount?: number;
    error?: string;
  };
}

const eventConfig: Record<EventType, { icon: React.ReactNode; color: string; label: string }> = {
  mutation_harvested: {
    icon: <Dna className="h-4 w-4" />,
    color: 'text-purple-500',
    label: 'Mutation',
  },
  backtest_started: {
    icon: <Play className="h-4 w-4" />,
    color: 'text-blue-500',
    label: 'Backtest',
  },
  backtest_completed: {
    icon: <CheckCircle2 className="h-4 w-4" />,
    color: 'text-green-500',
    label: 'Complete',
  },
  backtest_failed: {
    icon: <XCircle className="h-4 w-4" />,
    color: 'text-red-500',
    label: 'Failed',
  },
  graduation: {
    icon: <GraduationCap className="h-4 w-4" />,
    color: 'text-yellow-500',
    label: 'Graduation',
  },
  error: {
    icon: <AlertTriangle className="h-4 w-4" />,
    color: 'text-red-500',
    label: 'Error',
  },
  info: {
    icon: <Activity className="h-4 w-4" />,
    color: 'text-muted-foreground',
    label: 'Info',
  },
  daemon_started: {
    icon: <Play className="h-4 w-4" />,
    color: 'text-green-500',
    label: 'Started',
  },
  daemon_stopped: {
    icon: <XCircle className="h-4 w-4" />,
    color: 'text-orange-500',
    label: 'Stopped',
  },
};

function parseLogToEvent(log: string, index: number): ActivityEvent | null {
  const timestamp = new Date();

  // Parse daemon logs into structured events
  if (log.includes('Harvested mutation') || log.includes('mutation')) {
    const match = log.match(/mutation[:\s]+(\w+)/i);
    return {
      id: `${timestamp.getTime()}-${index}`,
      type: 'mutation_harvested',
      message: match ? `Harvested: ${match[1]}` : 'Mutation harvested',
      timestamp,
      metadata: { strategyName: match?.[1] },
    };
  }

  if (log.includes('Backtest started') || log.includes('backtest') && log.includes('start')) {
    return {
      id: `${timestamp.getTime()}-${index}`,
      type: 'backtest_started',
      message: 'Backtest started',
      timestamp,
    };
  }

  if (log.includes('Backtest complete') || log.includes('fitness')) {
    const sharpeMatch = log.match(/[Ss]harpe[:\s]+([\d.]+)/);
    const fitnessMatch = log.match(/[Ff]itness[:\s]+([\d.]+)/);
    return {
      id: `${timestamp.getTime()}-${index}`,
      type: 'backtest_completed',
      message: `Backtest complete${sharpeMatch ? ` - Sharpe: ${sharpeMatch[1]}` : ''}`,
      timestamp,
      metadata: {
        sharpe: sharpeMatch ? parseFloat(sharpeMatch[1]) : undefined,
        fitness: fitnessMatch ? parseFloat(fitnessMatch[1]) : undefined,
      },
    };
  }

  if (log.includes('graduation') || log.includes('GRADUATION') || log.includes('graduate')) {
    const match = log.match(/(\w+)\s+(?:ready|graduated)/i);
    return {
      id: `${timestamp.getTime()}-${index}`,
      type: 'graduation',
      message: match ? `🎓 ${match[1]} ready for production!` : 'Strategy graduated!',
      timestamp,
      metadata: { strategyName: match?.[1] },
    };
  }

  if (log.includes('[ERR]') || log.includes('error') || log.includes('Error')) {
    return {
      id: `${timestamp.getTime()}-${index}`,
      type: 'error',
      message: log.replace(/\[.*?\]/g, '').trim(),
      timestamp,
    };
  }

  if (log.includes('started') && log.includes('Night Shift')) {
    return {
      id: `${timestamp.getTime()}-${index}`,
      type: 'daemon_started',
      message: 'Night Shift daemon started',
      timestamp,
    };
  }

  if (log.includes('stopped') || log.includes('exit')) {
    return {
      id: `${timestamp.getTime()}-${index}`,
      type: 'daemon_stopped',
      message: 'Night Shift daemon stopped',
      timestamp,
    };
  }

  // Default info event
  return {
    id: `${timestamp.getTime()}-${index}`,
    type: 'info',
    message: log.replace(/\[.*?\]/g, '').trim().slice(0, 100),
    timestamp,
  };
}

export function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isLive, setIsLive] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const processedLogs = useRef<Set<string>>(new Set());

  // Listen to daemon logs
  useEffect(() => {
    if (!window.electron?.onDaemonLog) return;

    const unsubscribe = window.electron.onDaemonLog((log) => {
      // Deduplicate logs
      if (processedLogs.current.has(log)) return;
      processedLogs.current.add(log);

      const event = parseLogToEvent(log, processedLogs.current.size);
      if (event) {
        setEvents((prev) => [...prev.slice(-99), event]); // Keep last 100 events
      }
    });

    return unsubscribe;
  }, []);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (isLive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, isLive]);

  // Load initial events from daemon status
  useEffect(() => {
    const loadInitialLogs = async () => {
      if (!window.electron?.getDaemonLogs) return;

      try {
        const logs = await window.electron.getDaemonLogs();
        const initialEvents = logs
          .slice(-20) // Last 20 logs
          .map((log, i) => parseLogToEvent(log, i))
          .filter((e): e is ActivityEvent => e !== null);

        setEvents(initialEvents);
        logs.forEach(log => processedLogs.current.add(log));
      } catch (error) {
        console.error('Failed to load daemon logs:', error);
      }
    };

    loadInitialLogs();
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Activity Feed
          </CardTitle>
          <div className="flex items-center gap-2">
            {isLive && (
              <Badge variant="outline" className="text-xs">
                <span className="relative flex h-2 w-2 mr-1">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                Live
              </Badge>
            )}
            <button
              onClick={() => setIsLive(!isLive)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {isLive ? 'Pause' : 'Resume'}
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full" ref={scrollRef}>
          <div className="px-4 pb-4 space-y-1">
            {events.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 opacity-50" />
                Waiting for daemon activity...
                <p className="text-xs mt-1">Start Night Shift to see events</p>
              </div>
            ) : (
              events.map((event) => {
                const config = eventConfig[event.type];
                return (
                  <div
                    key={event.id}
                    className={cn(
                      'flex items-start gap-2 py-1.5 text-sm',
                      event.type === 'graduation' && 'bg-yellow-500/10 -mx-2 px-2 rounded',
                      event.type === 'error' && 'bg-red-500/10 -mx-2 px-2 rounded'
                    )}
                  >
                    <span className="text-xs text-muted-foreground font-mono shrink-0">
                      {formatTime(event.timestamp)}
                    </span>
                    <span className={cn('shrink-0', config.color)}>
                      {config.icon}
                    </span>
                    <span className="flex-1 truncate">
                      {event.message}
                    </span>
                    {event.metadata?.sharpe && (
                      <Badge variant="secondary" className="text-xs shrink-0">
                        Sharpe: {event.metadata.sharpe.toFixed(2)}
                      </Badge>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
