/**
 * Swarm Client - Frontend utilities for massive parallel LLM orchestration
 *
 * Architecture: Database-backed job queue pattern
 * - Dispatch: Creates job + N tasks, returns immediately
 * - Workers: Process tasks asynchronously (edge function or cron)
 * - Monitor: Real-time updates via Supabase Realtime
 * - Synthesize: Aggregates results via primary model
 *
 * This pattern supports 50+ parallel agents without timeout issues.
 */

import { chatSwarmParallel, isRunningInElectron } from './electronClient';
import { supabase } from '@/integrations/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

export interface SwarmPrompt {
  label: string;
  content: string;
}

export interface SwarmResult {
  label: string;
  content: string;
  error?: string;
}

export type SwarmMode = 'research' | 'evolution' | 'audit' | 'analysis';
export type SwarmStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface SwarmJobConfig {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  agentRoles?: string[];
  inputContexts?: string[];
}

export interface SwarmTask {
  id: string;
  job_id: string;
  agent_role: string;
  agent_index: number;
  input_context: string;
  output_content: string | null;
  status: SwarmStatus;
  error_message: string | null;
  latency_ms: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
}

export interface SwarmJob {
  id: string;
  workspace_id: string | null;
  objective: string;
  mode: SwarmMode;
  agent_count: number;
  status: SwarmStatus;
  progress_pct: number;
  synthesis_result: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface SwarmProgress {
  jobId: string;
  status: SwarmStatus;
  progressPct: number;
  totalTasks: number;
  pendingTasks: number;
  processingTasks: number;
  completedTasks: number;
  failedTasks: number;
  tasks: SwarmTask[];
  synthesis: string | null;
}

export interface SwarmProgressCallback {
  (progress: SwarmProgress): void;
}

export interface RunSwarmParams {
  sessionId: string;
  workspaceId: string;
  prompts: SwarmPrompt[];
  model?: string;
}

export interface RunMassiveSwarmParams {
  workspaceId?: string;
  objective: string;
  agentCount: number;
  mode: SwarmMode;
  config?: SwarmJobConfig;
  onProgress?: SwarmProgressCallback;
  pollIntervalMs?: number;
  triggerWorkers?: boolean; // Whether to trigger worker execution
}

export interface MassiveSwarmResult {
  jobId: string;
  status: SwarmStatus;
  tasks: SwarmTask[];
  synthesis: string | null;
  totalTokens: number;
  totalLatencyMs: number;
}

// ============================================================================
// Legacy Synchronous API (for backwards compatibility)
// ============================================================================

/**
 * Run multiple prompts in parallel via chat-swarm-parallel
 * @deprecated Use runMassiveSwarm for 10+ agents to avoid timeouts
 */
export async function runSwarm(params: RunSwarmParams): Promise<SwarmResult[]> {
  const { sessionId, workspaceId, prompts, model } = params;

  // For small swarms (<10), use the synchronous path
  if (prompts.length < 10) {
    if (isRunningInElectron()) {
      const electronPrompts = prompts.map((p, idx) => ({
        agentId: p.label || `agent_${idx}`,
        messages: [{ role: 'user' as const, content: p.content }],
      }));

      const results = await chatSwarmParallel(electronPrompts);
      return results.map(r => ({
        label: r.agentId,
        content: r.content,
      }));
    }

    const { data, error } = await supabase.functions.invoke('chat-swarm-parallel', {
      body: { sessionId, workspaceId, prompts, model },
    });

    if (error) throw new Error(`Swarm execution failed: ${error.message}`);
    if (!data?.results) throw new Error('Invalid response from swarm: missing results');

    return data.results as SwarmResult[];
  }

  // For larger swarms, use the job queue pattern
  const result = await runMassiveSwarm({
    workspaceId,
    objective: prompts.map(p => p.content).join('\n\n---\n\n'),
    agentCount: prompts.length,
    mode: 'research',
    config: {
      inputContexts: prompts.map(p => p.content),
      agentRoles: prompts.map(p => p.label),
    },
    triggerWorkers: true,
  });

  return result.tasks.map(t => ({
    label: t.agent_role,
    content: t.output_content || '',
    error: t.error_message || undefined,
  }));
}

// ============================================================================
// Massive Swarm API (Job Queue Pattern)
// ============================================================================

/**
 * Dispatch a massive swarm job (50+ agents)
 * Returns immediately with jobId - use subscribeToJob or pollJobProgress to track
 */
export async function dispatchMassiveSwarm(params: {
  workspaceId?: string;
  objective: string;
  agentCount: number;
  mode: SwarmMode;
  config?: SwarmJobConfig;
}): Promise<{ jobId: string; taskCount: number; estimatedDuration: string }> {
  const { data, error } = await supabase.functions.invoke('swarm-dispatch', {
    body: {
      objective: params.objective,
      agentCount: params.agentCount,
      mode: params.mode,
      workspaceId: params.workspaceId,
      config: params.config,
    },
  });

  if (error) throw new Error(`Failed to dispatch swarm: ${error.message}`);
  if (!data?.success) throw new Error(data?.error || 'Unknown dispatch error');

  return {
    jobId: data.jobId,
    taskCount: data.taskCount,
    estimatedDuration: data.estimatedDuration,
  };
}

/**
 * Trigger worker execution for pending tasks
 * Call this repeatedly to process all tasks (or set up a cron job)
 */
export async function triggerSwarmWorker(options?: {
  batchSize?: number;
  workerId?: string;
}): Promise<{
  tasksProcessed: number;
  completed: number;
  failed: number;
  nextBatchAvailable: boolean;
}> {
  const { data, error } = await supabase.functions.invoke('swarm-worker', {
    body: {
      batchSize: options?.batchSize ?? 5,
      workerId: options?.workerId,
    },
  });

  if (error) throw new Error(`Worker execution failed: ${error.message}`);

  return {
    tasksProcessed: data.tasksProcessed,
    completed: data.completed,
    failed: data.failed,
    nextBatchAvailable: data.nextBatchAvailable,
  };
}

/**
 * Trigger synthesis for a completed job
 */
export async function synthesizeSwarmResults(jobId: string, forceResynthesize = false): Promise<string> {
  const { data, error } = await supabase.functions.invoke('swarm-synthesize', {
    body: { jobId, forceResynthesize },
  });

  if (error) throw new Error(`Synthesis failed: ${error.message}`);
  if (!data?.success) throw new Error(data?.error || 'Unknown synthesis error');

  return data.synthesis;
}

/**
 * Get current job status and all tasks
 */
export async function getJobProgress(jobId: string): Promise<SwarmProgress> {
  // Get job
  const { data: job, error: jobError } = await supabase
    .from('swarm_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (jobError) throw new Error(`Failed to get job: ${jobError.message}`);

  // Get tasks
  const { data: tasks, error: tasksError } = await supabase
    .from('swarm_tasks')
    .select('*')
    .eq('job_id', jobId)
    .order('agent_index', { ascending: true });

  if (tasksError) throw new Error(`Failed to get tasks: ${tasksError.message}`);

  const taskList = tasks || [];

  return {
    jobId: job.id,
    status: job.status,
    progressPct: job.progress_pct,
    totalTasks: taskList.length,
    pendingTasks: taskList.filter(t => t.status === 'pending').length,
    processingTasks: taskList.filter(t => t.status === 'processing').length,
    completedTasks: taskList.filter(t => t.status === 'completed').length,
    failedTasks: taskList.filter(t => t.status === 'failed').length,
    tasks: taskList as SwarmTask[],
    synthesis: job.synthesis_result,
  };
}

/**
 * Subscribe to real-time job updates via Supabase Realtime
 * Returns an unsubscribe function
 */
export function subscribeToJob(
  jobId: string,
  onProgress: SwarmProgressCallback
): () => void {
  let currentProgress: SwarmProgress | null = null;

  // Fetch initial state
  getJobProgress(jobId).then(progress => {
    currentProgress = progress;
    onProgress(progress);
  });

  // Subscribe to job changes
  const jobChannel = supabase
    .channel(`swarm_job_${jobId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'swarm_jobs',
        filter: `id=eq.${jobId}`,
      },
      async () => {
        // Refetch full progress on any job change
        const progress = await getJobProgress(jobId);
        currentProgress = progress;
        onProgress(progress);
      }
    )
    .subscribe();

  // Subscribe to task changes
  const taskChannel = supabase
    .channel(`swarm_tasks_${jobId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'swarm_tasks',
        filter: `job_id=eq.${jobId}`,
      },
      async () => {
        // Refetch full progress on any task change
        const progress = await getJobProgress(jobId);
        currentProgress = progress;
        onProgress(progress);
      }
    )
    .subscribe();

  // Return unsubscribe function
  return () => {
    supabase.removeChannel(jobChannel);
    supabase.removeChannel(taskChannel);
  };
}

/**
 * Poll job progress at regular intervals
 * Returns a stop function
 */
export function pollJobProgress(
  jobId: string,
  onProgress: SwarmProgressCallback,
  intervalMs = 2000
): () => void {
  let stopped = false;

  const poll = async () => {
    if (stopped) return;

    try {
      const progress = await getJobProgress(jobId);
      onProgress(progress);

      // Stop polling if job is complete
      if (progress.status === 'completed' || progress.status === 'failed') {
        stopped = true;
        return;
      }

      // Schedule next poll
      setTimeout(poll, intervalMs);
    } catch (error) {
      console.error('[SwarmClient] Poll error:', error);
      if (!stopped) {
        setTimeout(poll, intervalMs * 2); // Back off on error
      }
    }
  };

  // Start polling
  poll();

  // Return stop function
  return () => {
    stopped = true;
  };
}

/**
 * Run a massive swarm job and wait for completion
 * Combines dispatch, worker triggering, polling, and synthesis
 */
export async function runMassiveSwarm(params: RunMassiveSwarmParams): Promise<MassiveSwarmResult> {
  const {
    workspaceId,
    objective,
    agentCount,
    mode,
    config,
    onProgress,
    pollIntervalMs = 2000,
    triggerWorkers = true,
  } = params;

  // Step 1: Dispatch the job
  const { jobId } = await dispatchMassiveSwarm({
    workspaceId,
    objective,
    agentCount,
    mode,
    config,
  });

  console.log(`[SwarmClient] Job dispatched: ${jobId}`);

  // Step 2: Set up progress tracking
  let latestProgress: SwarmProgress | null = null;

  const updateProgress = (progress: SwarmProgress) => {
    latestProgress = progress;
    if (onProgress) {
      onProgress(progress);
    }
  };

  // Use realtime if available, otherwise fall back to polling
  let unsubscribe: (() => void) | null = null;

  try {
    unsubscribe = subscribeToJob(jobId, updateProgress);
  } catch (error) {
    console.warn('[SwarmClient] Realtime subscription failed, using polling:', error);
  }

  // Step 3: Trigger workers to process tasks (if requested)
  if (triggerWorkers) {
    // Start worker loop in background
    const runWorkers = async () => {
      let hasMoreTasks = true;
      let workerRound = 0;

      while (hasMoreTasks) {
        workerRound++;
        console.log(`[SwarmClient] Worker round ${workerRound}`);

        try {
          const result = await triggerSwarmWorker({
            batchSize: 5,
            workerId: `client_worker_${jobId}_${workerRound}`,
          });

          hasMoreTasks = result.nextBatchAvailable;

          // Small delay between worker calls to avoid overwhelming the system
          if (hasMoreTasks) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.error('[SwarmClient] Worker error:', error);
          // Wait longer before retrying on error
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Check if job is complete
        if (latestProgress?.status === 'completed' || latestProgress?.status === 'failed') {
          break;
        }
      }
    };

    // Run workers in background (don't await)
    runWorkers().catch(console.error);
  }

  // Step 4: Wait for completion
  return new Promise((resolve, reject) => {
    const checkCompletion = async () => {
      const progress = await getJobProgress(jobId);
      updateProgress(progress);

      if (progress.status === 'completed') {
        // Clean up subscription
        if (unsubscribe) unsubscribe();

        // Step 5: Synthesize if not already done
        let synthesis = progress.synthesis;
        if (!synthesis && progress.completedTasks > 0) {
          try {
            synthesis = await synthesizeSwarmResults(jobId);
          } catch (error) {
            console.warn('[SwarmClient] Synthesis failed:', error);
          }
        }

        // Calculate totals
        const totalTokens = progress.tasks.reduce(
          (sum, t) => sum + (t.tokens_input || 0) + (t.tokens_output || 0),
          0
        );
        const totalLatencyMs = progress.tasks.reduce(
          (sum, t) => sum + (t.latency_ms || 0),
          0
        );

        resolve({
          jobId,
          status: progress.status,
          tasks: progress.tasks,
          synthesis,
          totalTokens,
          totalLatencyMs,
        });
      } else if (progress.status === 'failed') {
        if (unsubscribe) unsubscribe();
        reject(new Error(`Swarm job failed: ${progress.tasks.find(t => t.error_message)?.error_message || 'Unknown error'}`));
      } else {
        // Keep polling
        setTimeout(checkCompletion, pollIntervalMs);
      }
    };

    // Start checking
    checkCompletion();

    // Timeout after 10 minutes
    setTimeout(() => {
      if (unsubscribe) unsubscribe();
      reject(new Error('Swarm job timed out after 10 minutes'));
    }, 10 * 60 * 1000);
  });
}

/**
 * Cancel a running swarm job
 */
export async function cancelSwarmJob(jobId: string): Promise<void> {
  const { error } = await supabase
    .from('swarm_jobs')
    .update({ status: 'cancelled' })
    .eq('id', jobId);

  if (error) throw new Error(`Failed to cancel job: ${error.message}`);

  // Cancel all pending tasks
  await supabase
    .from('swarm_tasks')
    .update({ status: 'cancelled' })
    .eq('job_id', jobId)
    .in('status', ['pending', 'processing']);
}

/**
 * Get recent swarm jobs for a workspace
 */
export async function getRecentSwarmJobs(
  workspaceId: string,
  limit = 10
): Promise<SwarmJob[]> {
  const { data, error } = await supabase
    .from('swarm_jobs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to get jobs: ${error.message}`);

  return data as SwarmJob[];
}
