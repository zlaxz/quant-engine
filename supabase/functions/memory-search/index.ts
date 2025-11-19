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
    const { workspaceId, query, limit = 10 } = await req.json();

    if (!workspaceId) {
      return new Response(
        JSON.stringify({ error: 'workspaceId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'query is required and must be a non-empty string' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Semantic search for workspace ${workspaceId}: "${query}"`);

    // Generate embedding for the search query
    const queryEmbedding = await generateEmbedding(query);

    if (!queryEmbedding) {
      console.error('Failed to generate query embedding');
      return new Response(
        JSON.stringify({ error: 'Failed to generate embedding for query', results: [] }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Use the search_memory_notes database function for semantic search
    const { data, error } = await supabase.rpc('search_memory_notes', {
      query_embedding: queryEmbedding,
      match_workspace_id: workspaceId,
      match_threshold: 0.5, // Adjust threshold as needed (0.5 = 50% similarity minimum)
      match_count: Math.min(limit, 50), // Cap at 50 for safety
    });

    if (error) {
      console.error('Error searching memory notes:', error);
      return new Response(
        JSON.stringify({ error: 'Database search failed', results: [] }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${data?.length || 0} matching memory notes`);

    return new Response(
      JSON.stringify({ results: data || [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in memory-search function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error', results: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
