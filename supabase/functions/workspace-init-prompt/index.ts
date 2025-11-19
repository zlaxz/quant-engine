import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.83.0';
import { buildChiefQuantPrompt } from '../_shared/chiefQuantPrompt.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspaceId, reset } = await req.json();

    if (!workspaceId) {
      return new Response(
        JSON.stringify({ error: 'workspaceId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${reset ? 'Resetting' : 'Initializing'} Chief Quant prompt for workspace ${workspaceId}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch current workspace
    const { data: workspace, error: fetchError } = await supabase
      .from('workspaces')
      .select('default_system_prompt')
      .eq('id', workspaceId)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching workspace:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch workspace' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!workspace) {
      return new Response(
        JSON.stringify({ error: 'Workspace not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only update if empty or reset requested
    if (!workspace.default_system_prompt || reset) {
      const chiefQuantPrompt = buildChiefQuantPrompt();

      const { error: updateError } = await supabase
        .from('workspaces')
        .update({ default_system_prompt: chiefQuantPrompt })
        .eq('id', workspaceId);

      if (updateError) {
        console.error('Error updating workspace prompt:', updateError);
        return new Response(
          JSON.stringify({ error: 'Failed to update workspace prompt' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Chief Quant prompt ${reset ? 'reset' : 'initialized'} for workspace ${workspaceId}`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          action: reset ? 'reset' : 'initialized',
          message: `Chief Quant prompt ${reset ? 'reset' : 'initialized'} successfully`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      return new Response(
        JSON.stringify({ 
          success: true, 
          action: 'skipped',
          message: 'Workspace already has a system prompt. Use reset=true to override.'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Error in workspace-init-prompt function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
