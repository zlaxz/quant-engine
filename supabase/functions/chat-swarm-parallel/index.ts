import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SwarmPrompt {
  label: string;
  content: string;
}

interface SwarmRequest {
  sessionId: string;
  workspaceId: string;
  prompts: SwarmPrompt[];
  model?: string;
}

interface SwarmResult {
  label: string;
  content: string;
  error?: string;
}

/**
 * Parallel Swarm Orchestrator
 * Fans out multiple prompts to chat-swarm in parallel, returns all results
 */
serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sessionId, workspaceId, prompts, model }: SwarmRequest = await req.json();
    
    console.log('[Swarm Parallel] Request received:', { 
      sessionId, 
      workspaceId, 
      promptCount: prompts.length,
      model 
    });

    // Validation
    if (!sessionId || !workspaceId || !prompts || !Array.isArray(prompts)) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: sessionId, workspaceId, or prompts array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (prompts.length === 0) {
      return new Response(
        JSON.stringify({ error: 'prompts array cannot be empty' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client for calling chat-swarm
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[Swarm Parallel] Fanning out ${prompts.length} prompts in parallel...`);

    // Fan out all prompts in parallel to chat-swarm
    const swarmCalls = prompts.map(async (prompt): Promise<SwarmResult> => {
      try {
        console.log(`[Swarm Parallel] Calling chat-swarm for: ${prompt.label}`);
        
        const { data, error } = await supabase.functions.invoke('chat-swarm', {
          body: {
            sessionId,
            workspaceId,
            content: prompt.content,
            model,
          },
        });

        if (error) {
          console.error(`[Swarm Parallel] Error for ${prompt.label}:`, error);
          return {
            label: prompt.label,
            content: '',
            error: error.message || 'Unknown error',
          };
        }

        // Extract content from response
        let responseContent = '';
        if (data && typeof data === 'object') {
          responseContent = data.content || data.message || '';
        } else if (typeof data === 'string') {
          responseContent = data;
        }

        console.log(`[Swarm Parallel] Completed ${prompt.label}, length: ${responseContent.length}`);

        return {
          label: prompt.label,
          content: responseContent,
        };
      } catch (err: any) {
        console.error(`[Swarm Parallel] Exception for ${prompt.label}:`, err);
        return {
          label: prompt.label,
          content: '',
          error: err.message || 'Exception occurred',
        };
      }
    });

    // Wait for all parallel calls to complete
    const results = await Promise.all(swarmCalls);

    console.log(`[Swarm Parallel] All ${results.length} calls completed`);

    // Return all results
    return new Response(
      JSON.stringify({ results }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('[Swarm Parallel] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
