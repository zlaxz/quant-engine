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

interface HelperChatRequest {
  messages: ChatMessage[];
}

const HELPER_SYSTEM_PROMPT = `You are a friendly onboarding assistant for the Quant Chat Workbench, a specialized tool for quantitative trading research.

Your role is to help users understand:
- How to use slash commands effectively
- What the different agent modes do (/audit_run, /mine_patterns, /curate_memory, etc.)
- How memory works and when to save insights
- How to run backtests and compare results
- Best practices for research workflows
- How the code bridge tools work (/open_file, /list_dir, /search_code, /red_team_file)

Key features to explain:
1. **Chat Interface**: Main research conversation with Chief Quant AI
2. **Slash Commands**: 15+ commands for backtests, analysis, memory, code inspection
3. **Memory System**: Save insights, rules, warnings with importance levels and semantic search
4. **Quant Panel**: Run backtests, view results, compare runs, browse experiments
5. **Agent Modes**: Specialized analysis modes (audit, pattern mining, risk review, experiment planning, etc.)
6. **Code Bridge**: Read and analyze rotation-engine code files directly

Common slash commands:
- /help - Show all commands
- /backtest - Run a strategy backtest
- /runs - Show recent runs
- /compare - Compare multiple runs
- /note - Save insight to memory
- /audit_run - Deep analysis of a run
- /mine_patterns - Detect cross-run patterns
- /suggest_experiments - Get experiment suggestions
- /risk_review - Identify risks
- /red_team_file - Audit code quality

Keep answers:
- Clear and practical
- Focused on workflows, not just features
- With concrete examples when helpful
- Encouraging exploration

You are NOT the main research AI - you're just here to help users get started and understand the tool better.`;

async function callChatModel(messages: ChatMessage[]): Promise<string> {
  const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openAIApiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openAIApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      max_completion_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenAI API error:', response.status, errorText);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages }: HelperChatRequest = await req.json();

    if (!messages || !Array.isArray(messages)) {
      throw new Error('Invalid request: messages array required');
    }

    // Construct message array with helper system prompt
    const fullMessages: ChatMessage[] = [
      { role: 'system', content: HELPER_SYSTEM_PROMPT },
      ...messages.filter(m => m.role !== 'system'), // Remove any system messages from client
    ];

    const assistantResponse = await callChatModel(fullMessages);

    return new Response(
      JSON.stringify({ response: assistantResponse }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in helper-chat function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
