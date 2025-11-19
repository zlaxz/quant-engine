import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

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

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch workspace to get default_system_prompt
    console.log('[Chat API] Fetching workspace:', workspaceId);
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .select('default_system_prompt')
      .eq('id', workspaceId)
      .single();

    if (workspaceError) {
      console.error('[Chat API] Workspace fetch error:', workspaceError);
      throw new Error(`Failed to fetch workspace: ${workspaceError.message}`);
    }

    // 2. Load previous messages for this session
    console.log('[Chat API] Loading previous messages for session:', sessionId);
    const { data: previousMessages, error: messagesError } = await supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (messagesError) {
      console.error('[Chat API] Messages fetch error:', messagesError);
      throw new Error(`Failed to fetch messages: ${messagesError.message}`);
    }

    console.log('[Chat API] Loaded', previousMessages?.length || 0, 'previous messages');

    // 2.5. Load recent memory notes for context
    console.log('[Chat API] Loading memory notes for workspace:', workspaceId);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: memoryNotes, error: memoryError } = await supabase
      .from('memory_notes')
      .select('content, source, tags, created_at')
      .eq('workspace_id', workspaceId)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(5);

    if (memoryError) {
      console.error('[Chat API] Memory notes fetch error:', memoryError);
      // Non-critical - continue without memory context
    }

    console.log('[Chat API] Loaded', memoryNotes?.length || 0, 'memory notes');

    // 3. Build message array for OpenAI
    const messages: ChatMessage[] = [];
    
    // Add system prompt with memory context if available
    let systemPrompt = workspace.default_system_prompt || '';
    
    if (memoryNotes && memoryNotes.length > 0) {
      const memoryContext = memoryNotes
        .map((note, idx) => `${idx + 1}. [${note.source}] ${note.content}`)
        .join('\n');
      
      systemPrompt += `\n\nRelevant Memory from this workspace:\n${memoryContext}`;
    }
    
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt
      });
    }

    // Add previous conversation history
    if (previousMessages) {
      for (const msg of previousMessages) {
        messages.push({
          role: msg.role as 'system' | 'user' | 'assistant',
          content: msg.content
        });
      }
    }

    // Add new user message
    messages.push({
      role: 'user',
      content
    });

    // 4. Save user message to database BEFORE calling OpenAI
    console.log('[Chat API] Saving user message to database');
    const { error: userMessageError } = await supabase
      .from('messages')
      .insert({
        session_id: sessionId,
        role: 'user',
        content,
        provider: 'openai',
        model: model || 'gpt-5-2025-08-07'
      });

    if (userMessageError) {
      console.error('[Chat API] User message save error:', userMessageError);
      throw new Error(`Failed to save user message: ${userMessageError.message}`);
    }

    // 5. Call OpenAI
    console.log('[Chat API] Calling OpenAI with', messages.length, 'messages');
    const assistantResponse = await callChatModel(messages, model || 'gpt-5-2025-08-07');

    // 6. Save assistant message to database
    console.log('[Chat API] Saving assistant response to database');
    const { error: assistantMessageError } = await supabase
      .from('messages')
      .insert({
        session_id: sessionId,
        role: 'assistant',
        content: assistantResponse,
        provider: 'openai',
        model: model || 'gpt-5-2025-08-07'
      });

    if (assistantMessageError) {
      console.error('[Chat API] Assistant message save error:', assistantMessageError);
      throw new Error(`Failed to save assistant message: ${assistantMessageError.message}`);
    }

    // 7. Return response
    console.log('[Chat API] Request completed successfully');
    return new Response(
      JSON.stringify({ content: assistantResponse }),
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
