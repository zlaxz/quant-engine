import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  sessionId: string;
  workspaceId: string;
  content: string;
  model?: string;
}

/**
 * Call OpenAI Chat Completions API
 * This is the server-side LLM client - secrets are NEVER exposed to the browser
 */
async function callChatModel(messages: ChatMessage[], model: string = 'gpt-5-2025-08-07'): Promise<string> {
  const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
  
  if (!openAIApiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  console.log(`[LLM Client] Calling OpenAI with model: ${model}, messages: ${messages.length}`);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openAIApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: 2000,
      // Note: temperature not supported for gpt-5 models
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[LLM Client] OpenAI API error:', response.status, errorText);
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const assistantMessage = data.choices[0].message.content;
  
  console.log('[LLM Client] Response received, length:', assistantMessage.length);
  
  return assistantMessage;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sessionId, workspaceId, content, model }: ChatRequest = await req.json();
    
    console.log('[Chat API] Request received:', { sessionId, workspaceId, contentLength: content.length, model });

    // Validation
    if (!sessionId || !workspaceId || !content) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: sessionId, workspaceId, or content' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // STEP 2 will implement:
    // - Fetch workspace's default_system_prompt
    // - Load previous messages from Supabase
    // - Save user message
    // - Call callChatModel()
    // - Save assistant message
    // - Return response

    // For now, basic echo response to verify setup
    const testMessages: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content }
    ];

    const response = await callChatModel(testMessages, model || 'gpt-5-2025-08-07');

    return new Response(
      JSON.stringify({ content: response }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('[Chat API] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
