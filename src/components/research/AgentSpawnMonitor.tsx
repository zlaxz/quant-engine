/**
 * AgentSpawnMonitor - Shows active DeepSeek agents with task details
 * 
 * Features:
 * - Real-time agent status (spawning, working, completed)
 * - Elapsed time tracking
 * - Tool usage display
 * - Color-coded status indicators
 */

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Loader2, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface AgentSpawn {
  id: string;
  role: string;
  status: 'spawning' | 'working' | 'completed' | 'failed';
  task: string;
  tools: string[];
  startTime: number;
  endTime?: number;
}

interface AgentSpawnMonitorProps {
  agents: AgentSpawn[];
  className?: string;
}

export function AgentSpawnMonitor({ agents, className }: AgentSpawnMonitorProps) {
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update elapsed time every second
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (agents.length === 0) return null;

  const activeAgents = agents.filter(a => a.status === 'spawning' || a.status === 'working');

  return (
    <Card className={cn('p-4 space-y-3 border-l-4 border-l-yellow-500', className)}>
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
        <h3 className="text-sm font-semibold">DeepSeek Agents Active</h3>
        <Badge variant="secondary" className="ml-auto">
          {activeAgents.length} running
        </Badge>
      </div>

      <div className="space-y-2">
        {agents.map((agent) => {
          const elapsed = agent.endTime 
            ? agent.endTime - agent.startTime 
            : currentTime - agent.startTime;
          const elapsedSeconds = Math.floor(elapsed / 1000);

          return (
            <div
              key={agent.id}
              className={cn(
                'p-3 rounded-lg border transition-colors',
                agent.status === 'completed' && 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800',
                agent.status === 'failed' && 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800',
                (agent.status === 'spawning' || agent.status === 'working') && 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800'
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {agent.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                    {agent.status === 'failed' && <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />}
                    {(agent.status === 'spawning' || agent.status === 'working') && (
                      <Loader2 className="h-4 w-4 animate-spin text-yellow-500 shrink-0" />
                    )}
                    <span className="text-sm font-medium truncate">{agent.role}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-1">{agent.task}</p>
                </div>

                <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <Clock className="h-3 w-3" />
                  <span>{elapsedSeconds}s</span>
                </div>
              </div>

              {agent.tools.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {agent.tools.map((tool, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs h-5">
                      {tool}
                    </Badge>
                  ))}
                </div>
              )}

              {agent.status === 'working' && (
                <Progress value={undefined} className="h-1 mt-2 animate-pulse" />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
