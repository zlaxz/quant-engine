import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.83.0';
import { generateEmbedding } from '../_shared/embeddings.ts';

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
    const { workspaceId, content, source, tags, runId, metadata } = await req.json();

    if (!workspaceId || !content) {
      return new Response(
        JSON.stringify({ error: 'workspaceId and content are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Creating memory note for workspace ${workspaceId}, source: ${source || 'manual'}`);

    // Generate embedding for the content
    const embedding = await generateEmbedding(content);
    
    if (!embedding) {
      console.warn('Failed to generate embedding, saving note without embedding');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Insert memory note with embedding
    const { data, error } = await supabase
      .from('memory_notes')
      .insert({
        workspace_id: workspaceId,
        content: content.trim(),
        source: source || 'manual',
        tags: tags || [],
        run_id: runId || null,
        metadata: metadata || {},
        embedding: embedding,
      })
      .select()
      .single();

    if (error) {
      console.error('Error inserting memory note:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to create memory note' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Memory note created: ${data.id}`);

    return new Response(
      JSON.stringify({ success: true, note: data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in memory-create function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
