import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Get API Keys for Electron App Sync
 * 
 * Returns actual API key values for syncing to local Electron store.
 * This is safe for single-user desktop apps where the user owns the keys.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const geminiKey = Deno.env.get('GEMINI_API_KEY') || '';
    const openaiKey = Deno.env.get('OPENAI_API_KEY') || '';
    const deepseekKey = Deno.env.get('DEEPSEEK_API_KEY') || '';

    console.log('[get-api-keys] Returning key status:', {
      gemini: geminiKey ? 'present' : 'missing',
      openai: openaiKey ? 'present' : 'missing', 
      deepseek: deepseekKey ? 'present' : 'missing',
    });

    return new Response(
      JSON.stringify({
        gemini: geminiKey,
        openai: openaiKey,
        deepseek: deepseekKey,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[get-api-keys] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to retrieve API keys' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
