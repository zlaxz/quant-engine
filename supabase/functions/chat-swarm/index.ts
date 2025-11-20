import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { generateEmbedding } from '../_shared/embeddings.ts';
import { buildChiefQuantPrompt } from '../_shared/chiefQuantPrompt.ts';
import { callLlm, type ChatMessage as LlmChatMessage } from '../_shared/llmClient.ts';

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

// Removed: callChatModel - now using shared llmClient.callLlm

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sessionId, workspaceId, content, model }: ChatRequest = await req.json();
    
    console.log('[Chat API - SWARM] Request received:', { sessionId, workspaceId, contentLength: content.length, model });

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
    console.log('[Chat API - SWARM] Fetching workspace:', workspaceId);
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .select('default_system_prompt')
      .eq('id', workspaceId)
      .single();

    if (workspaceError) {
      console.error('[Chat API - SWARM] Workspace fetch error:', workspaceError);
      throw new Error(`Failed to fetch workspace: ${workspaceError.message}`);
    }

    // 2. Load previous messages for this session
    console.log('[Chat API - SWARM] Loading previous messages for session:', sessionId);
    const { data: previousMessages, error: messagesError } = await supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (messagesError) {
      console.error('[Chat API - SWARM] Messages fetch error:', messagesError);
      throw new Error(`Failed to fetch messages: ${messagesError.message}`);
    }

    console.log('[Chat API - SWARM] Loaded', previousMessages?.length || 0, 'previous messages');

    // 2.5. Use semantic memory retrieval for chat context with prioritization
    console.log('[Chat API - SWARM] Loading memory notes for workspace:', workspaceId);
    let memoryNotes = [];
    
    // Build query from recent conversation context (last 2 messages + new message)
    const recentMessages = (previousMessages || []).slice(-2).map(m => m.content).join(' ');
    const searchQuery = `${recentMessages} ${content}`.slice(0, 500); // Limit query length
    
    console.log('[Chat API - SWARM] Generating embedding for semantic memory search...');
    const queryEmbedding = await generateEmbedding(searchQuery);
    
    if (queryEmbedding) {
      // Use semantic search via the database function (fetch more than needed for re-ranking)
      // Only active (non-archived) notes with embeddings are returned
      const { data: semanticResults, error: memoryError } = await supabase.rpc('search_memory_notes', {
        query_embedding: queryEmbedding,
        match_workspace_id: workspaceId,
        match_threshold: 0.5, // Lower threshold to get more candidates
        match_count: 15, // Get more for re-ranking
      });

      if (memoryError) {
        console.error('[Chat API - SWARM] Error in semantic memory search:', memoryError);
      } else {
        // Filter archived notes (additional safety check)
        const results = (semanticResults || []).filter((n: any) => n.archived !== true);
        console.log(`[Chat API - SWARM] Found ${results.length} relevant memory notes via semantic search`);
        
        // Prioritize rules and warnings, especially critical/high importance
        const criticalRules = results.filter((n: any) => 
          (n.memory_type === 'rule' || n.memory_type === 'warning') && n.importance === 'critical'
        ).slice(0, 2);
        
        const highPriority = results.filter((n: any) => 
          ((n.memory_type === 'rule' || n.memory_type === 'warning') && n.importance === 'high') ||
          (n.memory_type !== 'rule' && n.memory_type !== 'warning' && n.importance === 'critical')
        ).slice(0, 2);
        
        const remaining = results.filter((n: any) => 
          !criticalRules.includes(n) && !highPriority.includes(n)
        ).slice(0, 3);
        
        memoryNotes = [...criticalRules, ...highPriority, ...remaining].slice(0, 5);
        console.log(`[Chat API - SWARM] Prioritized to ${memoryNotes.length} notes (${criticalRules.length} critical rules/warnings)`);
      }
    } else {
      console.warn('[Chat API - SWARM] Failed to generate query embedding, falling back to recent notes');
      
      // Fallback to time-based retrieval if embedding fails, prioritize rules/warnings
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { data: recentNotes, error: memoryError } = await supabase
        .from('memory_notes')
        .select('content, source, tags, created_at, memory_type, importance, similarity')
        .eq('workspace_id', workspaceId)
        .eq('archived', false) // Only active notes
        .not('embedding', 'is', null) // Only notes with embeddings
        .gte('created_at', thirtyDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(10);

      if (memoryError) {
        console.error('[Chat API - SWARM] Error fetching memory notes:', memoryError);
      } else {
        const results = recentNotes || [];
        // Prioritize even in fallback mode
        const rules = results.filter((n: any) => n.memory_type === 'rule' || n.memory_type === 'warning').slice(0, 2);
        const others = results.filter((n: any) => !rules.includes(n)).slice(0, 3);
        memoryNotes = [...rules, ...others];
      }
    }

    // 3. Build message array for OpenAI
    const messages: ChatMessage[] = [];
    
    // Add system prompt with prioritized memory context if available
    // Use Chief Quant prompt as fallback if workspace doesn't have a custom prompt
    let systemPrompt = workspace.default_system_prompt || buildChiefQuantPrompt();
    console.log('[Chat API - SWARM] Using', workspace.default_system_prompt ? 'workspace' : 'Chief Quant fallback', 'system prompt');
    
    if (memoryNotes && memoryNotes.length > 0) {
      // Separate rules/warnings from other notes
      const rulesAndWarnings = memoryNotes.filter((note: any) => 
        note.memory_type === 'rule' || note.memory_type === 'warning'
      );
      const otherNotes = memoryNotes.filter((note: any) => 
        note.memory_type !== 'rule' && note.memory_type !== 'warning'
      );
      
      let memoryContext = '';
      
      if (rulesAndWarnings.length > 0) {
        const rulesText = rulesAndWarnings
          .map((note: any, idx: number) => {
            const date = new Date(note.created_at).toISOString().split('T')[0];
            const similarity = note.similarity ? ` (${Math.round(note.similarity * 100)}% relevant)` : '';
            return `${idx + 1}) [${note.importance} ${note.memory_type}, ${date}${similarity}] ${note.content}`;
          })
          .join('\n');
        memoryContext += `\nRelevant Rules and Warnings:\n${rulesText}\n`;
      }
      
      if (otherNotes.length > 0) {
        const notesText = otherNotes
          .map((note: any, idx: number) => {
            const date = new Date(note.created_at).toISOString().split('T')[0];
            const similarity = note.similarity ? ` (${Math.round(note.similarity * 100)}% relevant)` : '';
            return `${idx + 1}) [${note.memory_type}, ${date}${similarity}] ${note.content}`;
          })
          .join('\n');
        memoryContext += `\nOther Relevant Insights:\n${notesText}\n`;
      }
      
      systemPrompt += memoryContext;
      console.log('[Chat API - SWARM] Injecting prioritized memory context into system prompt');
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
    console.log('[Chat API - SWARM] Saving user message to database');
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
      console.error('[Chat API - SWARM] User message save error:', userMessageError);
      throw new Error(`Failed to save user message: ${userMessageError.message}`);
    }

    // 5. Call SWARM tier LLM (DeepSeek-Reasoner)
    console.log('[Chat API - SWARM] Calling SWARM tier LLM with', messages.length, 'messages');
    const llmMessages: LlmChatMessage[] = messages.map(m => ({ role: m.role, content: m.content }));
    const assistantResponse = await callLlm('swarm', llmMessages);

    // 6. Save assistant message to database
    console.log('[Chat API - SWARM] Saving assistant response to database');
    const { error: assistantMessageError } = await supabase
      .from('messages')
      .insert({
        session_id: sessionId,
        role: 'assistant',
        content: assistantResponse,
        provider: 'deepseek',
        model: 'deepseek-reasoner'
      });

    if (assistantMessageError) {
      console.error('[Chat API - SWARM] Assistant message save error:', assistantMessageError);
      throw new Error(`Failed to save assistant message: ${assistantMessageError.message}`);
    }

    // 7. Return response
    console.log('[Chat API - SWARM] Request completed successfully');
    return new Response(
      JSON.stringify({ content: assistantResponse, message: assistantResponse }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('[Chat API - SWARM] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
