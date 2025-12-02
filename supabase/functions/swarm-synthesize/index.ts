/**
 * Swarm Synthesize Edge Function
 *
 * Aggregates completed task outputs and synthesizes via Primary model (Gemini 3 Pro).
 * Called when a job reaches 100% completion.
 *
 * Request body:
 * {
 *   jobId: string,          // The swarm job to synthesize
 *   forceResynthesize?: boolean  // Re-run synthesis even if already done
 * }
 *
 * Response:
 * {
 *   success: true,
 *   jobId: string,
 *   synthesis: string,
 *   tasksSynthesized: number,
 *   tokensUsed: number
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Extract code blocks from agent output
 */
function extractCodeBlock(content: string): string | null {
  // Look for ```python ... ``` blocks
  const pythonMatch = content.match(/```python\n([\s\S]*?)```/);
  if (pythonMatch) {
    return pythonMatch[1].trim();
  }

  // Fallback: look for any ``` block
  const codeMatch = content.match(/```\n?([\s\S]*?)```/);
  if (codeMatch) {
    return codeMatch[1].trim();
  }

  return null;
}

/**
 * Extract mutation type and reasoning from agent output
 */
function extractMutationInfo(content: string): { type: string; reasoning: string; impact: string } {
  const typeMatch = content.match(/### Mutation Type\n([\s\S]*?)(?=###|$)/);
  const reasoningMatch = content.match(/### Reasoning\n([\s\S]*?)(?=###|$)/);
  const impactMatch = content.match(/### Expected Impact\n([\s\S]*?)(?=###|$)/);

  return {
    type: typeMatch ? typeMatch[1].trim() : 'Unknown',
    reasoning: reasoningMatch ? reasoningMatch[1].trim() : '',
    impact: impactMatch ? impactMatch[1].trim() : '',
  };
}

/**
 * Build synthesis prompt based on mode
 */
function buildSynthesisPrompt(
  mode: string,
  objective: string,
  taskOutputs: { role: string; content: string; index: number }[]
): string {
  const outputsList = taskOutputs
    .sort((a, b) => a.index - b.index)
    .map((t, i) => `### Agent ${i + 1} (${t.role})\n${t.content}`)
    .join('\n\n---\n\n');

  const modeInstructions: Record<string, string> = {
    research: `You are synthesizing research from ${taskOutputs.length} parallel research agents.
Your task is to:
1. Identify the key insights that appear across multiple agents (consensus)
2. Highlight unique findings that only some agents discovered
3. Resolve any contradictions with evidence-based reasoning
4. Provide a comprehensive summary with actionable recommendations
5. Note any gaps in the research that need further investigation`,

    evolution: `You are The Architect - the judge evaluating ${taskOutputs.length} strategy mutations from a genetic algorithm swarm.

## YOUR CRITICAL TASK:
You must select the TOP 3 MOST PROMISING mutations to present to the user.

## EVALUATION CRITERIA:
- **Code Quality**: Is the mutation valid Python? Will it run?
- **Convexity Potential**: Does it increase positive convexity (gains in big moves)?
- **Risk Management**: Does it improve drawdown or risk-adjusted returns?
- **Originality**: Is this a novel approach vs incremental tweak?
- **Backtest Feasibility**: Can this be tested in the existing framework?

## REQUIRED OUTPUT FORMAT:

### Summary
[2-3 sentences: What mutation patterns emerged? Any consensus themes?]

### Top 3 Candidates

#### Candidate 1: [Mutation Name]
**Agent**: [Which agent proposed this]
**Mutation Type**: [Type]
**Why Selected**: [1-2 sentences on why this is promising]
**Risk Assessment**: [What could go wrong]

\`\`\`python
[FULL CODE BLOCK - Copy the complete code from the agent's output]
\`\`\`

#### Candidate 2: [Mutation Name]
**Agent**: [Which agent proposed this]
**Mutation Type**: [Type]
**Why Selected**: [1-2 sentences]
**Risk Assessment**: [What could go wrong]

\`\`\`python
[FULL CODE BLOCK]
\`\`\`

#### Candidate 3: [Mutation Name]
**Agent**: [Which agent proposed this]
**Mutation Type**: [Type]
**Why Selected**: [1-2 sentences]
**Risk Assessment**: [What could go wrong]

\`\`\`python
[FULL CODE BLOCK]
\`\`\`

### Rejected Mutations
[Brief list of mutations that were rejected and why - syntax errors, logical bugs, etc.]

### Next Steps
[What should the user do with these candidates?]`,

    audit: `You are consolidating audit findings from ${taskOutputs.length} parallel auditors.
Your task is to:
1. Categorize findings by severity (Critical, High, Medium, Low)
2. Identify any findings that multiple auditors flagged (consensus bugs)
3. Eliminate duplicate findings
4. Provide a prioritized action list
5. Estimate effort to fix each category of issues`,

    analysis: `You are synthesizing analysis from ${taskOutputs.length} parallel analysts.
Your task is to:
1. Aggregate quantitative findings into a unified view
2. Identify patterns that appear across multiple analyses
3. Highlight any anomalies or outliers
4. Provide statistical confidence levels where applicable
5. Recommend next steps based on the aggregate analysis`,
  };

  const instruction = modeInstructions[mode] || modeInstructions.research;

  return `# Swarm Synthesis Task

## Original Objective
${objective}

## Your Role
${instruction}

## Agent Outputs (${taskOutputs.length} agents)

${outputsList}

---

## Your Synthesis

Please provide a comprehensive synthesis following the instructions above. Structure your response clearly with headers and bullet points where appropriate.`;
}

/**
 * Call Gemini 3 Pro for synthesis
 */
async function callGeminiForSynthesis(prompt: string): Promise<{ content: string; tokens: number }> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const model = Deno.env.get('PRIMARY_MODEL') ?? 'gemini-3-pro-preview';

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3, // Lower temperature for synthesis (more focused)
          maxOutputTokens: 8192,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const tokens = data.usageMetadata?.totalTokenCount ?? 0;

  return { content, tokens };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { jobId, forceResynthesize = false } = body;

    if (!jobId) {
      return new Response(
        JSON.stringify({ success: false, error: 'jobId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[Synthesize] Processing job ${jobId}`);

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('swarm_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ success: false, error: `Job not found: ${jobError?.message}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if already synthesized
    if (job.synthesis_result && !forceResynthesize) {
      return new Response(
        JSON.stringify({
          success: true,
          jobId,
          synthesis: job.synthesis_result,
          cached: true,
          message: 'Using cached synthesis. Set forceResynthesize=true to regenerate.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all completed tasks
    const { data: tasks, error: tasksError } = await supabase
      .from('swarm_tasks')
      .select('agent_role, agent_index, output_content, status')
      .eq('job_id', jobId)
      .order('agent_index', { ascending: true });

    if (tasksError) {
      return new Response(
        JSON.stringify({ success: false, error: `Failed to fetch tasks: ${tasksError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter to completed tasks with output
    const completedTasks = (tasks || []).filter(
      (t: any) => t.status === 'completed' && t.output_content
    );

    if (completedTasks.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No completed tasks with output to synthesize',
          taskCount: tasks?.length ?? 0,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Synthesize] Synthesizing ${completedTasks.length} task outputs`);

    // Build synthesis prompt
    const taskOutputs = completedTasks.map((t: any) => ({
      role: t.agent_role,
      content: t.output_content,
      index: t.agent_index,
    }));

    const synthesisPrompt = buildSynthesisPrompt(job.mode, job.objective, taskOutputs);

    // Call Gemini for synthesis
    const startTime = Date.now();
    let { content: synthesis, tokens } = await callGeminiForSynthesis(synthesisPrompt);
    const latencyMs = Date.now() - startTime;

    console.log(`[Synthesize] Synthesis complete: ${synthesis.length} chars, ${tokens} tokens, ${latencyMs}ms`);

    // For evolution mode, add security banner
    if (job.mode === 'evolution') {
      const securityBanner = `> **SECURITY NOTE**: The code mutations below are TEXT SUGGESTIONS only.
> They have NOT been automatically applied to your codebase.
> Review each candidate carefully before applying.
> Use \`/write_file\` or click "Apply" to write to disk.

---

`;
      synthesis = securityBanner + synthesis;
    }

    // Update job with synthesis
    const { error: updateError } = await supabase
      .from('swarm_jobs')
      .update({
        synthesis_result: synthesis,
        synthesis_metadata: {
          tokens,
          latencyMs,
          tasksSynthesized: completedTasks.length,
          model: Deno.env.get('PRIMARY_MODEL') ?? 'gemini-3-pro-preview',
          synthesizedAt: new Date().toISOString(),
        },
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    if (updateError) {
      console.error('[Synthesize] Failed to update job:', updateError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        jobId,
        synthesis,
        tasksSynthesized: completedTasks.length,
        tokensUsed: tokens,
        latencyMs,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[Synthesize] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
