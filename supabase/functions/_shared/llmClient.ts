/**
 * Multi-Provider LLM Client
 * 
 * Supports tiered routing to different LLM providers:
 * - PRIMARY: Gemini 3 Deep Think (Google API)
 * - SECONDARY: GPT-5.1 (OpenAI API)
 * - SWARM: DeepSeek-Reasoner (DeepSeek API)
 */

export type LlmTier = 'primary' | 'secondary' | 'swarm';
export type ProviderName = 'openai' | 'google' | 'anthropic' | 'deepseek' | 'custom';

export interface LlmConfig {
  model: string;
  provider: ProviderName;
}

export interface ChatMessage {
  role: string;
  content: string;
}

/**
 * Get model configuration for a specific tier
 */
export function getConfigForTier(tier: LlmTier): LlmConfig {
  const primaryModel = Deno.env.get('PRIMARY_MODEL') ?? 'gemini-2.0-flash-thinking-exp-1219';
  const primaryProvider = (Deno.env.get('PRIMARY_PROVIDER') ?? 'google') as ProviderName;

  const secondaryModel = Deno.env.get('SECONDARY_MODEL') ?? 'gpt-4o';
  const secondaryProvider = (Deno.env.get('SECONDARY_PROVIDER') ?? 'openai') as ProviderName;

  const swarmModel = Deno.env.get('SWARM_MODEL') ?? 'deepseek-reasoner';
  const swarmProvider = (Deno.env.get('SWARM_PROVIDER') ?? 'deepseek') as ProviderName;

  if (tier === 'primary') {
    return { model: primaryModel, provider: primaryProvider };
  } else if (tier === 'secondary') {
    return { model: secondaryModel, provider: secondaryProvider };
  } else {
    return { model: swarmModel, provider: swarmProvider };
  }
}

/**
 * Main LLM client - routes to appropriate provider based on tier
 */
export async function callLlm(tier: LlmTier, messages: ChatMessage[]): Promise<string> {
  const { model, provider } = getConfigForTier(tier);
  
  console.log(`[LLM Client] Tier: ${tier.toUpperCase()}, Provider: ${provider}, Model: ${model}`);

  switch (provider) {
    case 'google':
      return await callGemini(model, messages);
    case 'openai':
      return await callOpenAI(model, messages);
    case 'deepseek':
      return await callDeepSeek(model, messages);
    case 'anthropic':
      throw new Error('Anthropic provider not yet implemented');
    case 'custom':
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Google Gemini API client (Gemini 2.0 Flash with thinking mode)
 */
async function callGemini(model: string, messages: ChatMessage[]): Promise<string> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  console.log(`[Gemini Client] Calling ${model} with ${messages.length} messages`);

  // Convert messages to Gemini format
  // Gemini expects: contents array with role/parts structure
  const contents = messages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : msg.role === 'system' ? 'user' : msg.role,
    parts: [{ text: msg.content }]
  }));

  // Merge system messages into user messages (Gemini doesn't have system role)
  const mergedContents = [];
  for (let i = 0; i < contents.length; i++) {
    if (contents[i].role === 'user' && i > 0 && mergedContents[mergedContents.length - 1]?.role === 'user') {
      // Merge consecutive user messages
      mergedContents[mergedContents.length - 1].parts[0].text += '\n\n' + contents[i].parts[0].text;
    } else {
      mergedContents.push(contents[i]);
    }
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  
  const response = await fetch(`${endpoint}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: mergedContents,
      generationConfig: {
        temperature: 1.0,
        maxOutputTokens: 8192,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Gemini Client] API error:', response.status, errorText);
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  
  // Extract text from response
  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error('No candidate in Gemini response');
  }

  const text = candidate.content?.parts?.map((p: any) => p.text).join('') ?? '';
  
  console.log(`[Gemini Client] Response received, length: ${text.length}`);
  
  return text;
}

/**
 * OpenAI API client (GPT-5.1 and other OpenAI models)
 */
async function callOpenAI(model: string, messages: ChatMessage[]): Promise<string> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  console.log(`[OpenAI Client] Calling ${model} with ${messages.length} messages`);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: 8192,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OpenAI Client] API error:', response.status, errorText);
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  
  console.log(`[OpenAI Client] Response received, length: ${text.length}`);
  
  return text;
}

/**
 * DeepSeek API client (DeepSeek-Reasoner for swarm tasks)
 */
async function callDeepSeek(model: string, messages: ChatMessage[]): Promise<string> {
  const apiKey = Deno.env.get('DEEPSEEK_API_KEY');
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not set');
  }

  console.log(`[DeepSeek Client] Calling ${model} with ${messages.length} messages`);

  // DeepSeek uses OpenAI-compatible API
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 8192,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[DeepSeek Client] API error:', response.status, errorText);
    throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  
  console.log(`[DeepSeek Client] Response received, length: ${text.length}`);
  
  return text;
}
