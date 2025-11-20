import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.83.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspaceId, sessionId, scope, title, summary, content, tags } = await req.json();

    // Validate required fields
    if (!workspaceId) {
      return new Response(
        JSON.stringify({ error: "workspaceId is required" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!content || content.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "content is required" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Build default title if not provided
    let finalTitle = title;
    if (!finalTitle || finalTitle.trim().length === 0) {
      const date = new Date().toISOString().split('T')[0];
      if (scope) {
        const cleanScope = scope
          .replace(/^strategy:/i, '')
          .replace(/_/g, ' ')
          .split(' ')
          .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        finalTitle = `${cleanScope} Research – ${date}`;
      } else {
        finalTitle = `Workspace Research Report – ${date}`;
      }
    }

    // Build default summary if not provided
    let finalSummary = summary;
    if (!finalSummary || finalSummary.trim().length === 0) {
      // Extract first few lines as summary
      const lines = content
        .split('\n')
        .filter((line: string) => line.trim().length > 0)
        .slice(0, 3)
        .join(' ');
      finalSummary = lines.length > 500 ? lines.substring(0, 497) + '...' : lines;
    }

    // Insert report into database
    const { data, error } = await supabase
      .from('research_reports')
      .insert({
        workspace_id: workspaceId,
        session_id: sessionId || null,
        scope: scope || null,
        title: finalTitle,
        summary: finalSummary,
        content: content,
        tags: tags || [],
      })
      .select('id, title, created_at')
      .single();

    if (error) {
      console.error('Database error:', error);
      throw error;
    }

    console.log('Report saved:', data.id, data.title);

    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in report-save:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
