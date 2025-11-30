import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Get API Key Status
 *
 * SECURITY: This endpoint returns only whether keys are configured,
 * NOT the actual key values. Keys are only used server-side.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check if API keys are configured (return status only, never actual keys)
    const geminiConfigured = !!Deno.env.get('GEMINI_API_KEY');
    const openaiConfigured = !!Deno.env.get('OPENAI_API_KEY');
    const deepseekConfigured = !!Deno.env.get('DEEPSEEK_API_KEY');

    return new Response(
      JSON.stringify({
        configured: {
          gemini: geminiConfigured,
          openai: openaiConfigured,
          deepseek: deepseekConfigured,
        },
        message: 'API key status retrieved. Actual keys are never exposed.',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error checking API key status:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to check API key status' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
