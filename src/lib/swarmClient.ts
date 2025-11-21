/**
 * Swarm Client - Frontend utilities for parallel LLM orchestration
 * Now routes through hybrid electron/edge function client
 */

import { chatSwarmParallel, isRunningInElectron } from './electronClient';
import { supabase } from '@/integrations/supabase/client';

export interface SwarmPrompt {
  label: string;
  content: string;
}

export interface SwarmResult {
  label: string;
  content: string;
  error?: string;
}

export interface RunSwarmParams {
  sessionId: string;
  workspaceId: string;
  prompts: SwarmPrompt[];
  model?: string;
}

/**
 * Run multiple prompts in parallel via chat-swarm-parallel
 * Routes through Electron IPC if available, otherwise edge function
 * Returns array of results in the same order as prompts
 */
export async function runSwarm(params: RunSwarmParams): Promise<SwarmResult[]> {
  const { sessionId, workspaceId, prompts, model } = params;

  console.log(`[Swarm Client] Running ${prompts.length} prompts in parallel...`);
  console.log(`[Swarm Client] Using ${isRunningInElectron() ? 'Electron IPC' : 'edge function'}`);

  if (isRunningInElectron()) {
    // Use Electron direct API calls
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

  // Use edge function
  const { data, error } = await supabase.functions.invoke('chat-swarm-parallel', {
    body: {
      sessionId,
      workspaceId,
      prompts,
      model,
    },
  });

  if (error) {
    console.error('[Swarm Client] Error:', error);
    throw new Error(`Swarm execution failed: ${error.message}`);
  }

  if (!data || !data.results) {
    throw new Error('Invalid response from swarm: missing results');
  }

  console.log(`[Swarm Client] Received ${data.results.length} results`);

  return data.results as SwarmResult[];
}
