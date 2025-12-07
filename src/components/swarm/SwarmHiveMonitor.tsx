/**
 * SwarmHiveMonitor.tsx - The Hive View
 *
 * Real-time visualization of ALL active swarm agents across ALL jobs.
 * Shows a grid of 50 dots representing agent states + scrolling log of findings.
 *
 * NO MOCK DATA - Real Supabase connection to swarm_jobs and swarm_tasks.
 *
 * Created: 2025-12-03
 */

import { useState, useEffect, useCallback, memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Bug,
  AlertTriangle,
  Activity,
  Cpu,
  Zap,
  MessageSquare,
  PlusCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase, isSupabaseConfigured } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

// Types
interface SwarmTask {
  id: string;
  job_id: string;
  agent_role: string;
  agent_index: number;
  input_context: string | null;
  output_content: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  error_message: string | null;
  latency_ms: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  created_at: string;
  updated_at: string | null;
}

interface SwarmJob {
  id: string;
  objective: string;
  mode: string;
  agent_count: number;
  status: string;
  progress_pct: number;
  created_at: string;
}

interface AgentFinding {
  id: string;
  agentIndex: number;
  role: string;
  finding: string;
  timestamp: string;
  status: 'success' | 'warning' | 'error';
}

// Agent states with colors matching your spec
type AgentState = 'idle' | 'thinking' | 'writing' | 'error';

const STATE_COLORS: Record<AgentState, string> = {
  idle: 'bg-gray-500',
  thinking: 'bg-green-500 animate-pulse',
  writing: 'bg-blue-500 animate-pulse',
  error: 'bg-red-500',
};

const STATE_LABELS: Record<AgentState, string> = {
  idle: 'Idle',
  thinking: 'Thinking (DeepSeek)',
  writing: 'Writing Code',
  error: 'Error',
};

// Map task status to agent state
function getAgentState(task: SwarmTask | null): AgentState {
  if (!task) return 'idle';

  switch (task.status) {
    case 'processing':
      // Check if output started → writing, otherwise thinking
      return task.output_content ? 'writing' : 'thinking';
    case 'failed':
      return 'error';
    case 'completed':
    case 'pending':
    case 'cancelled':
    default:
      return 'idle';
  }
}

// Agent dot component
function AgentDot({
  task,
  index,
  onClick,
}: {
  task: SwarmTask | null;
  index: number;
  onClick?: () => void;
}) {
  const state = getAgentState(task);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={cn(
              'w-4 h-4 rounded-full transition-all hover:scale-125 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500',
              STATE_COLORS[state]
            )}
            aria-label={`Agent ${index + 1}: ${STATE_LABELS[state]}`}
          />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="text-xs space-y-1">
            <p className="font-semibold">Agent #{index + 1}</p>
            <p className="text-muted-foreground">{task?.agent_role || 'Idle'}</p>
            <p className="text-muted-foreground">{STATE_LABELS[state]}</p>
            {task?.latency_ms && (
              <p className="text-muted-foreground">
                {(task.latency_ms / 1000).toFixed(1)}s
              </p>
            )}
            {task?.error_message && (
              <p className="text-red-500 truncate">{task.error_message}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Finding log item
function FindingItem({ finding }: { finding: AgentFinding }) {
  return (
    <div
      className={cn(
        'p-2 rounded text-xs border-l-2',
        finding.status === 'success'
          ? 'border-green-500 bg-green-500/5'
          : finding.status === 'warning'
          ? 'border-yellow-500 bg-yellow-500/5'
          : 'border-red-500 bg-red-500/5'
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <Badge variant="outline" className="text-xs py-0 px-1">
          Agent {finding.agentIndex + 1}
        </Badge>
        <span className="text-muted-foreground">{finding.role}</span>
        <span className="text-muted-foreground ml-auto">
          {new Date(finding.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <p className="text-foreground">{finding.finding}</p>
    </div>
  );
}

function SwarmHiveMonitorComponent() {
  // Connection state
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Data
  const [activeJobs, setActiveJobs] = useState<SwarmJob[]>([]);
  const [activeTasks, setActiveTasks] = useState<SwarmTask[]>([]);
  const [findings, setFindings] = useState<AgentFinding[]>([]);

  const [swarmObjectiveInput, setSwarmObjectiveInput] = useState('');
  const [launchingSwarm, setLaunchingSwarm] = useState(false);

  const launchSwarm = useCallback(async () => {
    if (!connected || !swarmObjectiveInput.trim()) return;

    setLaunchingSwarm(true);
    const toastId = toast.loading('Launching swarm...');

    try {
      const { error: insertError } = await supabase
        .from('swarm_jobs')
        .insert({
          objective: swarmObjectiveInput,
          mode: 'research', // Default mode for now
          agent_count: 50, // Default to 50 agents
          status: 'pending',
          created_by: 'Gemini CLI', // Or dynamic user ID
        });

      if (insertError) throw insertError;

      toast.success('Swarm launched successfully!', { id: toastId });
      setSwarmObjectiveInput('');
      fetchSwarmData(); // Refresh swarm monitor
    } catch (err) {
      console.error('[SwarmHive] Launch swarm failed:', err);
      toast.error('Failed to launch swarm', {
        id: toastId,
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setLaunchingSwarm(false);
    }
  }, [connected, swarmObjectiveInput]);

  // Stats
  const [stats, setStats] = useState({
    totalAgents: 50,
    idle: 50,
    thinking: 0,
    writing: 0,
    errors: 0,
  });

  // Fetch all active swarm data
  const fetchSwarmData = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setConnected(false);
      setError('Supabase not configured');
      setLoading(false);
      return;
    }

    try {
      // Fetch active jobs
      const { data: jobs, error: jobsError } = await supabase
        .from('swarm_jobs')
        .select('*')
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false })
        .limit(10);

      if (jobsError && jobsError.code !== '42P01') {
        throw jobsError;
      }

      if (jobsError?.code === '42P01') {
        setError('swarm_jobs table not found - run migrations');
        setConnected(true);
        setLoading(false);
        return;
      }

      setActiveJobs(jobs || []);

      // If we have active jobs, fetch their tasks
      if (jobs && jobs.length > 0) {
        const jobIds = jobs.map((j) => j.id);

        const { data: tasks, error: tasksError } = await supabase
          .from('swarm_tasks')
          .select('*')
          .in('job_id', jobIds)
          .order('updated_at', { ascending: false });

        if (tasksError) {
          console.error('[SwarmHive] Tasks error:', tasksError);
        }

        setActiveTasks(tasks || []);

        // Extract findings from completed tasks
        const newFindings: AgentFinding[] = (tasks || [])
          .filter((t) => t.status === 'completed' && t.output_content)
          .slice(0, 20)
          .map((t) => ({
            id: t.id,
            agentIndex: t.agent_index,
            role: t.agent_role,
            finding: t.output_content?.substring(0, 150) + '...' || '',
            timestamp: t.updated_at || t.created_at,
            status: 'success' as const,
          }));

        // Add error findings
        const errorFindings: AgentFinding[] = (tasks || [])
          .filter((t) => t.status === 'failed')
          .slice(0, 10)
          .map((t) => ({
            id: t.id,
            agentIndex: t.agent_index,
            role: t.agent_role,
            finding: t.error_message || 'Unknown error',
            timestamp: t.updated_at || t.created_at,
            status: 'error' as const,
          }));

        setFindings([...newFindings, ...errorFindings].slice(0, 20));

        // Calculate stats
        const thinking = tasks?.filter((t) => t.status === 'processing' && !t.output_content).length || 0;
        const writing = tasks?.filter((t) => t.status === 'processing' && t.output_content).length || 0;
        const errors = tasks?.filter((t) => t.status === 'failed').length || 0;

        setStats({
          totalAgents: 50,
          idle: 50 - thinking - writing - errors,
          thinking,
          writing,
          errors,
        });
      } else {
        // No active jobs
        setActiveTasks([]);
        setFindings([]);
        setStats({
          totalAgents: 50,
          idle: 50,
          thinking: 0,
          writing: 0,
          errors: 0,
        });
      }

      setConnected(true);
      setError(null);
    } catch (err) {
      console.error('[SwarmHive] Error:', err);
      setConnected(false);
      setError(err instanceof Error ? err.message : 'Failed to fetch swarm data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch and subscription
  useEffect(() => {
    fetchSwarmData();

    // Real-time subscription
    const channel = supabase
      .channel('swarm-hive')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'swarm_jobs' },
        () => fetchSwarmData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'swarm_tasks' },
        () => fetchSwarmData()
      )
      .subscribe();

    // Poll every 2 seconds for real-time feel
    const interval = setInterval(fetchSwarmData, 2000);

    return () => {
      channel.unsubscribe();
      clearInterval(interval);
    };
  }, [fetchSwarmData]);

  // Build agent grid (50 agents)
  const agentGrid = Array.from({ length: 50 }, (_, i) => {
    // Find active task for this agent index
    const task = activeTasks.find((t) => t.agent_index === i);
    return { index: i, task };
  });

  // Loading state
  if (loading) {
    return (
      <Card className="h-full bg-black/90 border-cyan-500/30">
        <CardContent className="flex items-center justify-center h-full">
          <Activity className="h-8 w-8 text-cyan-500 animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  // Connection error
  if (!connected) {
    return (
      <Card className="h-full bg-black/90 border-red-500/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-red-500">
            <AlertTriangle className="h-4 w-4" />
            HIVE OFFLINE
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>{error || 'Unable to connect'}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-black/90 border-cyan-500/30 overflow-hidden flex flex-col">
      <CardHeader className="pb-2 border-b border-cyan-500/20 flex-shrink-0">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <div className="flex items-center gap-2 text-cyan-400">
            <Bug className="h-4 w-4" />
            SWARM HIVE
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-gray-500" />
              <span className="text-gray-400">{stats.idle}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-green-400">{stats.thinking}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-blue-400">{stats.writing}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-red-400">{stats.errors}</span>
            </div>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0 flex-1 flex flex-col min-h-0">
        {error && (
          <Alert variant="destructive" className="m-2 py-2 flex-shrink-0">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        {/* Swarm Launch Input */}
        <div className="p-4 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <PlusCircle className="h-4 w-4 text-cyan-400" />
            <span className="text-sm font-medium text-cyan-400">Launch New Swarm</span>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Objective: e.g., 'Audit code for security vulnerabilities'"
              value={swarmObjectiveInput}
              onChange={(e) => setSwarmObjectiveInput(e.target.value)}
              className="flex-1 bg-gray-800/50 border-gray-700 text-cyan-300 placeholder:text-gray-500"
              onKeyPress={(e) => {
                if (e.key === 'Enter') launchSwarm();
              }}
            />
            <Button
              onClick={launchSwarm}
              disabled={!swarmObjectiveInput.trim() || launchingSwarm}
              className="bg-cyan-600 hover:bg-cyan-700 text-white"
            >
              {launchingSwarm ? (
                <Activity className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              <span className="ml-2 hidden sm:inline">Launch</span>
            </Button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Agent Grid */}
          <div className="flex-1 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Cpu className="h-3 w-3" />
              <span>AGENT GRID ({activeJobs.length} active jobs)</span>
            </div>

            {/* 10x5 Grid of agents */}
            <div className="grid grid-cols-10 gap-2 p-3 rounded-lg bg-gray-900/50 border border-gray-800">
              {agentGrid.map(({ index, task }) => (
                <AgentDot key={index} task={task || null} index={index} />
              ))}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-gray-500" />
                <span>Idle</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span>Thinking</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span>Writing</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span>Error</span>
              </div>
            </div>

            {/* Active Job Info */}
            {activeJobs.length > 0 && (
              <div className="mt-4 space-y-2">
                {activeJobs.slice(0, 2).map((job) => (
                  <div
                    key={job.id}
                    className="p-2 rounded bg-cyan-500/10 border border-cyan-500/30 text-xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-cyan-400">{job.mode}</span>
                      <Badge variant="outline" className="text-xs">
                        {job.progress_pct}%
                      </Badge>
                    </div>
                    <p className="text-muted-foreground truncate">{job.objective}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Findings Log */}
          <div className="w-64 border-l border-gray-800 flex flex-col">
            <div className="p-2 border-b border-gray-800 flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0">
              <MessageSquare className="h-3 w-3" />
              <span>FINDINGS FEED</span>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-2 space-y-2">
                {findings.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-8">
                    <Zap className="h-6 w-6 mx-auto mb-2 opacity-50" />
                    <p>No active findings</p>
                    <p>Agents are idle</p>
                  </div>
                ) : (
                  findings.map((finding) => (
                    <FindingItem key={finding.id} finding={finding} />
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export const SwarmHiveMonitor = memo(SwarmHiveMonitorComponent);
