/**
 * Swarm Worker Edge Function
 *
 * Processes batches of pending swarm tasks.
 * Designed to be called repeatedly (by cron, webhook, or manual trigger).
 *
 * Flow:
 * 1. Atomically claim a batch of pending tasks (prevents race conditions)
 * 2. Process each task by calling DeepSeek API
 * 3. Update task with results
 * 4. Trigger job progress update
 *
 * Request body (optional):
 * {
 *   batchSize?: number,     // How many tasks to claim (default: 5, max: 10)
 *   workerId?: string,      // Identifier for this worker instance
 *   dryRun?: boolean,       // If true, claim but don't process
 * }
 *
 * Response:
 * {
 *   success: true,
 *   tasksProcessed: number,
 *   results: TaskResult[],
 *   nextBatchAvailable: boolean
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limiting configuration
const RATE_LIMIT_DELAY_MS = 200; // Delay between API calls to avoid rate limits
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

interface TaskResult {
  taskId: string;
  status: 'completed' | 'failed';
  latencyMs: number;
  tokensInput?: number;
  tokensOutput?: number;
  error?: string;
}

// Evolution mode mutation system prompt
const EVOLUTION_SYSTEM_PROMPT = `You are a Genetic Mutation Agent. Your goal is to modify the provided Python trading strategy to improve its Sharpe Ratio and convexity characteristics.

## CRITICAL CONSTRAINTS:
1. You MUST output VALID Python code only
2. Preserve imports and class structure
3. Do not break existing functionality
4. Add comments explaining your changes

## MUTATION TYPES (select ONE based on your agent role):
- **Parameter Shift**: Adjust numeric constants by ±10-50%
- **Logic Inversion**: Try the opposite of a boolean condition
- **Indicator Swap**: Replace one technical indicator with another
- **Lookback Change**: Modify rolling window periods
- **Exit Rule Modification**: Change stop-loss or take-profit logic
- **Position Sizing**: Alter how position sizes are calculated
- **Regime Filter**: Add or modify regime-based conditions

## OUTPUT FORMAT:
Your response must follow this exact format:

### Mutation Type
[Which mutation type you applied]

### Reasoning
[Why this change might improve performance]

### Code Changes
\`\`\`python
# FULL modified strategy code here
# Include the entire file, not just changed parts
\`\`\`

### Expected Impact
- Positive: [What should improve]
- Negative: [What might get worse]
- Risk: [New risks introduced]`;

/**
 * Build prompt based on job mode
 */
function buildTaskPrompt(task: any, jobMode: string, jobConfig: any): string {
  if (jobMode === 'evolution') {
    // Evolution mode: wrap with mutation system prompt
    return `${EVOLUTION_SYSTEM_PROMPT}

---

## Your Agent Assignment
**Agent Role**: ${task.agent_role}
**Agent Index**: ${task.agent_index + 1}

## Strategy to Mutate

${task.input_context}

---

Now apply your mutation. Remember to output the FULL modified code.`;
  }

  // Default: use input_context as-is
  return task.input_context;
}

/**
 * Call DeepSeek API for a single task
 */
async function callDeepSeek(
  prompt: string,
  config: { temperature?: number; maxTokens?: number }
): Promise<{ content: string; tokensInput: number; tokensOutput: number }> {
  const apiKey = Deno.env.get('DEEPSEEK_API_KEY');
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not set');
  }

  const model = Deno.env.get('SWARM_MODEL') ?? 'deepseek-reasoner';

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];

  if (!choice) {
    throw new Error('No response from DeepSeek API');
  }

  return {
    content: choice.message?.content ?? '',
    tokensInput: data.usage?.prompt_tokens ?? 0,
    tokensOutput: data.usage?.completion_tokens ?? 0,
  };
}

/**
 * Process a single task with retries
 */
async function processTask(
  supabase: ReturnType<typeof createClient>,
  task: any,
  jobMode: string,
  jobConfig: any
): Promise<TaskResult> {
  const startTime = Date.now();
  const taskId = task.id;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Worker] Processing task ${taskId} (attempt ${attempt}), mode: ${jobMode}`);

      // Extract config from task metadata
      const config = task.input_metadata || {};

      // Build prompt based on job mode
      const prompt = buildTaskPrompt(task, jobMode, jobConfig);

      // Call DeepSeek
      const result = await callDeepSeek(prompt, config);

      const latencyMs = Date.now() - startTime;

      // Update task with success
      const { error: updateError } = await supabase
        .from('swarm_tasks')
        .update({
          status: 'completed',
          output_content: result.content,
          output_metadata: {
            reasoning_complete: true,
            attempt,
          },
          tokens_input: result.tokensInput,
          tokens_output: result.tokensOutput,
          latency_ms: latencyMs,
          completed_at: new Date().toISOString(),
          model_used: Deno.env.get('SWARM_MODEL') ?? 'deepseek-reasoner',
        })
        .eq('id', taskId);

      if (updateError) {
        console.error(`[Worker] Failed to update task ${taskId}:`, updateError);
      }

      return {
        taskId,
        status: 'completed',
        latencyMs,
        tokensInput: result.tokensInput,
        tokensOutput: result.tokensOutput,
      };

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;
      console.error(`[Worker] Task ${taskId} attempt ${attempt} failed:`, error.message);

      // Check if this is a rate limit error
      if (error.message?.includes('429') || error.message?.includes('rate')) {
        // Exponential backoff for rate limits
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        console.log(`[Worker] Rate limited, waiting ${delay}ms before retry`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else if (attempt < MAX_RETRIES) {
        // Standard retry delay
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  // All retries failed
  const latencyMs = Date.now() - startTime;
  const errorMessage = lastError?.message ?? 'Unknown error';

  // Update task with failure
  const { error: updateError } = await supabase
    .from('swarm_tasks')
    .update({
      status: 'failed',
      error_message: errorMessage,
      retry_count: MAX_RETRIES,
      latency_ms: latencyMs,
      completed_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (updateError) {
    console.error(`[Worker] Failed to update failed task ${taskId}:`, updateError);
  }

  return {
    taskId,
    status: 'failed',
    latencyMs,
    error: errorMessage,
  };
}

/**
 * Check if there are more pending tasks after this batch
 */
async function checkPendingTasks(supabase: ReturnType<typeof createClient>): Promise<boolean> {
  const { count, error } = await supabase
    .from('swarm_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  if (error) {
    console.error('[Worker] Failed to check pending tasks:', error);
    return false;
  }

  return (count ?? 0) > 0;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse request body (optional)
    let body: { batchSize?: number; workerId?: string; dryRun?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // No body or invalid JSON - use defaults
    }

    const batchSize = Math.min(Math.max(1, body.batchSize ?? 5), 10);
    const workerId = body.workerId ?? `worker_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const dryRun = body.dryRun ?? false;

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[Worker ${workerId}] Claiming up to ${batchSize} tasks`);

    // Atomically claim a batch of pending tasks
    const { data: claimedTasks, error: claimError } = await supabase
      .rpc('claim_swarm_tasks', {
        p_worker_id: workerId,
        p_batch_size: batchSize,
      });

    if (claimError) {
      console.error('[Worker] Failed to claim tasks:', claimError);
      return new Response(
        JSON.stringify({ success: false, error: `Failed to claim tasks: ${claimError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tasks = claimedTasks || [];
    console.log(`[Worker ${workerId}] Claimed ${tasks.length} tasks`);

    if (tasks.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          tasksProcessed: 0,
          results: [],
          nextBatchAvailable: false,
          message: 'No pending tasks available',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If dry run, just return claimed tasks without processing
    if (dryRun) {
      // Release the tasks back to pending
      for (const task of tasks) {
        await supabase
          .from('swarm_tasks')
          .update({ status: 'pending', worker_id: null, claimed_at: null, started_at: null })
          .eq('id', task.id);
      }

      return new Response(
        JSON.stringify({
          success: true,
          dryRun: true,
          tasksWouldProcess: tasks.length,
          taskIds: tasks.map((t: any) => t.id),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch job details for each unique job_id in the tasks
    // (usually all tasks belong to same job, but be safe)
    const jobIds: string[] = Array.from(new Set(tasks.map((t: any) => String(t.job_id)))) as string[];
    const jobCache: Record<string, { mode: string; config: any }> = {};

    for (const jobId of jobIds) {
      const { data: job } = await supabase
        .from('swarm_jobs')
        .select('mode, config, shared_context')
        .eq('id', jobId)
        .single();

      if (job) {
        jobCache[jobId as string] = {
          mode: job.mode || 'research',
          config: { ...(job.config || {}), sharedContext: job.shared_context },
        };
      } else {
        jobCache[jobId as string] = { mode: 'research', config: {} };
      }
    }

    // Process each task
    const results: TaskResult[] = [];
    for (const task of tasks) {
      const jobInfo = jobCache[task.job_id] || { mode: 'research', config: {} };
      const result = await processTask(supabase as any, task, jobInfo.mode, jobInfo.config);
      results.push(result);

      // Rate limit delay between tasks
      if (tasks.indexOf(task) < tasks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
      }
    }

    // Check if there are more pending tasks
    const nextBatchAvailable = await checkPendingTasks(supabase as any);

    // Summary stats
    const completed = results.filter(r => r.status === 'completed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const avgLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length;
    const totalTokens = results.reduce((sum, r) => (r.tokensInput ?? 0) + (r.tokensOutput ?? 0), 0);

    console.log(`[Worker ${workerId}] Processed ${results.length} tasks: ${completed} completed, ${failed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        workerId,
        tasksProcessed: results.length,
        completed,
        failed,
        avgLatencyMs: Math.round(avgLatency),
        totalTokens,
        results,
        nextBatchAvailable,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[Worker] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
