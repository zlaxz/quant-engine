/**
 * Swarm Dispatch Edge Function
 *
 * Creates a new swarm job and spawns N agent tasks.
 * Returns immediately with jobId - does NOT wait for completion.
 *
 * Request body:
 * {
 *   objective: string,       // What the swarm should accomplish
 *   agentCount: number,      // How many agents to spawn (default: 10, max: 100)
 *   mode: string,            // 'research' | 'evolution' | 'audit' | 'analysis'
 *   workspaceId?: string,    // Optional workspace context
 *   config?: {               // Optional configuration
 *     temperature?: number,
 *     maxTokens?: number,
 *     systemPrompt?: string,
 *     agentRoles?: string[], // Custom roles for each agent
 *     inputContexts?: string[], // Custom prompts for each agent
 *   }
 * }
 *
 * Response:
 * {
 *   success: true,
 *   jobId: string,
 *   taskCount: number,
 *   estimatedDuration: string
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// CORS headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Agent role templates for different modes
const AGENT_ROLE_TEMPLATES: Record<string, (index: number, total: number) => string> = {
  research: (i, total) => `researcher_${i + 1}_of_${total}`,
  evolution: (i, _) => `mutator_${i + 1}`,
  audit: (i, _) => `auditor_${i + 1}`,
  analysis: (i, _) => `analyst_${i + 1}`,
};

// Default system prompts for different modes
const MODE_SYSTEM_PROMPTS: Record<string, string> = {
  research: `You are a research agent in a parallel swarm. Your task is to explore one specific angle of the research objective. Be thorough, cite sources when possible, and provide actionable insights. Your output will be synthesized with other agents' findings.`,

  evolution: `You are a mutation agent in a genetic algorithm swarm. Your task is to take the provided strategy code and mutate it in ONE specific way to potentially improve its convexity or edge. Be creative but maintain code correctness. Explain your mutation rationale.`,

  audit: `You are an audit agent in a parallel review swarm. Your task is to examine one specific aspect of the provided code or strategy for bugs, logical errors, or improvements. Be rigorous and precise in your findings.`,

  analysis: `You are an analysis agent in a parallel investigation swarm. Your task is to analyze one specific aspect of the provided data or situation. Provide quantitative insights where possible.`,
};

// Generate input context for each agent based on mode
function generateAgentContext(
  objective: string,
  mode: string,
  index: number,
  total: number,
  customContext?: string
): string {
  if (customContext) return customContext;

  const systemPrompt = MODE_SYSTEM_PROMPTS[mode] || MODE_SYSTEM_PROMPTS.research;

  return `${systemPrompt}

## Your Assignment (Agent ${index + 1} of ${total})

**Objective:** ${objective}

**Your Focus Area:** Based on your position in the swarm (${index + 1}/${total}), explore a unique angle that differs from other agents. Consider:
- If early in sequence (1-${Math.floor(total/3)}): Focus on foundational/core aspects
- If middle (${Math.floor(total/3)+1}-${Math.floor(2*total/3)}): Explore edge cases and variations
- If late (${Math.floor(2*total/3)+1}-${total}): Challenge assumptions and find counterexamples

Provide your analysis in a structured format that can be synthesized with other agents' outputs.`;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      objective,
      agentCount = 10,
      mode = 'research',
      workspaceId,
      config = {},
    } = body;

    // Validate inputs
    if (!objective || typeof objective !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'objective is required and must be a string' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const validModes = ['research', 'evolution', 'audit', 'analysis'];
    if (!validModes.includes(mode)) {
      return new Response(
        JSON.stringify({ success: false, error: `mode must be one of: ${validModes.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Cap agent count at 100 to prevent abuse
    const safeAgentCount = Math.min(Math.max(1, agentCount), 100);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[Swarm Dispatch] Creating job: ${mode} mode, ${safeAgentCount} agents`);

    // Step 1: Create the job record
    const { data: job, error: jobError } = await supabase
      .from('swarm_jobs')
      .insert({
        workspace_id: workspaceId || null,
        objective,
        mode,
        agent_count: safeAgentCount,
        config: {
          temperature: config.temperature ?? 0.7,
          maxTokens: config.maxTokens ?? 4096,
          systemPrompt: config.systemPrompt,
        },
        status: 'pending',
        progress_pct: 0,
        created_by: 'swarm-dispatch',
      })
      .select('id')
      .single();

    if (jobError || !job) {
      console.error('[Swarm Dispatch] Failed to create job:', jobError);
      return new Response(
        JSON.stringify({ success: false, error: `Failed to create job: ${jobError?.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const jobId = job.id;
    console.log(`[Swarm Dispatch] Job created: ${jobId}`);

    // Step 2: Generate task records
    const tasks = [];
    const agentRoles = config.agentRoles || [];
    const inputContexts = config.inputContexts || [];

    for (let i = 0; i < safeAgentCount; i++) {
      const roleGenerator = AGENT_ROLE_TEMPLATES[mode] || AGENT_ROLE_TEMPLATES.research;

      tasks.push({
        job_id: jobId,
        agent_role: agentRoles[i] || roleGenerator(i, safeAgentCount),
        agent_index: i,
        input_context: generateAgentContext(
          objective,
          mode,
          i,
          safeAgentCount,
          inputContexts[i]
        ),
        input_metadata: {
          temperature: config.temperature ?? 0.7,
          maxTokens: config.maxTokens ?? 4096,
        },
        status: 'pending',
      });
    }

    // Step 3: Batch insert all tasks
    const { error: tasksError } = await supabase
      .from('swarm_tasks')
      .insert(tasks);

    if (tasksError) {
      console.error('[Swarm Dispatch] Failed to create tasks:', tasksError);
      // Rollback: delete the job
      await supabase.from('swarm_jobs').delete().eq('id', jobId);
      return new Response(
        JSON.stringify({ success: false, error: `Failed to create tasks: ${tasksError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 4: Update job status to pending (ready for workers)
    await supabase
      .from('swarm_jobs')
      .update({ status: 'pending', started_at: new Date().toISOString() })
      .eq('id', jobId);

    console.log(`[Swarm Dispatch] ${safeAgentCount} tasks created for job ${jobId}`);

    // Estimate duration (rough: 5-10 seconds per task, parallelized by workers)
    const estimatedSeconds = Math.ceil(safeAgentCount / 5) * 8; // Assume 5 parallel workers, 8s per task
    const estimatedDuration = estimatedSeconds < 60
      ? `~${estimatedSeconds} seconds`
      : `~${Math.ceil(estimatedSeconds / 60)} minutes`;

    return new Response(
      JSON.stringify({
        success: true,
        jobId,
        taskCount: safeAgentCount,
        mode,
        estimatedDuration,
        message: `Swarm job dispatched. ${safeAgentCount} agents will process the objective.`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[Swarm Dispatch] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
