import { ipcMain } from 'electron';
import { GoogleGenerativeAI, FunctionCallingMode } from '@google/generative-ai';
import OpenAI from 'openai';
import { ALL_TOOLS } from '../tools/toolDefinitions';
import { executeTool } from '../tools/toolHandlers';

// LLM routing config
const PRIMARY_MODEL = 'gemini-2.5-pro-preview-06-05';
const PRIMARY_PROVIDER = 'gemini';
const SWARM_MODEL = 'deepseek-reasoner';
const SWARM_PROVIDER = 'deepseek';

// Max tool call iterations to prevent infinite loops
const MAX_TOOL_ITERATIONS = 10;

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Retry helper with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = MAX_RETRIES,
  delayMs = RETRY_DELAY_MS
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if this is a retryable error
      const isRetryable =
        error.status === 429 || // Rate limit
        error.status === 503 || // Service unavailable
        error.status === 500 || // Server error
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.message?.includes('network') ||
        error.message?.includes('timeout');

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff
      const delay = delayMs * Math.pow(2, attempt - 1);
      console.log(`[Retry] Attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// Lazy client getters - read API keys at call time, not module load time
function getGeminiClient(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey);
}

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function getDeepSeekClient(): OpenAI | null {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' });
}

// Convert OpenAI-style tool definitions to DeepSeek format
function toolsToOpenAIFormat(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return ALL_TOOLS.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: {
        type: 'object',
        properties: tool.parameters?.properties || {},
        required: tool.parameters?.required || []
      }
    }
  }));
}

export function registerLlmHandlers() {
  // Primary tier - delegates to Supabase edge function which handles workspace/memory/message loading
  ipcMain.handle('chat-primary', async (_event, sessionId: string, workspaceId: string, content: string) => {
    // Get Supabase credentials from environment
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials not configured');
    }

    // Call the Supabase edge function
    const response = await fetch(`${supabaseUrl}/functions/v1/chat-primary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ sessionId, workspaceId, content })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Chat request failed');
    }

    return await response.json();
  });

  // Swarm tier (DeepSeek) with tool calling
  ipcMain.handle('chat-swarm', async (_event, messages: Array<{ role: string; content: string }>) => {
    try {
      const deepseekClient = getDeepSeekClient();
      if (!deepseekClient) {
        throw new Error('DEEPSEEK_API_KEY not configured. Go to Settings to add your API key.');
      }

      const tools = toolsToOpenAIFormat();
      let currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content
      }));

      let iterations = 0;
      let finalContent = '';
      let toolCallLog: string[] = []; // Visible log for user

      while (iterations < MAX_TOOL_ITERATIONS) {
        const completion = await withRetry(() => deepseekClient.chat.completions.create({
          model: SWARM_MODEL,
          messages: currentMessages,
          tools: tools,
          tool_choice: 'auto'
        }));

        const choice = completion.choices[0];
        const message = choice.message;

        // Check if model wants to call tools
        if (!message.tool_calls || message.tool_calls.length === 0) {
          // No more tool calls
          finalContent = message.content || '';
          break;
        }

        console.log(`[Swarm] Executing ${message.tool_calls.length} tool calls (iteration ${iterations + 1})`);

        // Add assistant message with tool calls
        currentMessages.push({
          role: 'assistant',
          content: message.content,
          tool_calls: message.tool_calls
        });

        // Execute tools and add results
        for (const toolCall of message.tool_calls) {
          if (toolCall.type !== 'function') continue;
          
          const toolName = toolCall.function.name;
          let toolArgs: Record<string, any> = {};

          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            toolArgs = {};
          }

          console.log(`[Tool] Calling: ${toolName}`, toolArgs);

          // Add to visible log
          const argsStr = Object.entries(toolArgs).map(([k, v]) => `${k}="${v}"`).join(', ');
          toolCallLog.push(`🔧 ${toolName}(${argsStr})`);

          try {
            const result = await executeTool(toolName, toolArgs);
            const output = result.success ? result.content : `Error: ${result.error}`;

            // Add result preview to log
            const preview = output.slice(0, 200).replace(/\n/g, ' ');
            toolCallLog.push(`   → ${result.success ? '✓' : '✗'} ${preview}${output.length > 200 ? '...' : ''}`);

            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: output
            });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            toolCallLog.push(`   → ✗ Error: ${errorMsg}`);
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Tool execution error: ${errorMsg}`
            });
          }
        }

        iterations++;
      }

      // Build visible tool call log
      const toolSummary = toolCallLog.length > 0
        ? `\n\n---\n**🔧 Tool Calls (${iterations} iteration${iterations !== 1 ? 's' : ''}):**\n\`\`\`\n${toolCallLog.join('\n')}\n\`\`\``
        : '';

      return {
        content: finalContent + toolSummary,
        provider: SWARM_PROVIDER,
        model: SWARM_MODEL,
        toolsUsed: iterations
      };
    } catch (error) {
      console.error('Error in chat-swarm:', error);
      throw error;
    }
  });

  // Swarm parallel (DeepSeek) - multiple agents without tools for speed
  ipcMain.handle('chat-swarm-parallel', async (_event, prompts: Array<{ agentId: string; messages: Array<{ role: string; content: string }> }>) => {
    try {
      const deepseekClient = getDeepSeekClient();
      if (!deepseekClient) {
        throw new Error('DEEPSEEK_API_KEY not configured. Go to Settings to add your API key.');
      }

      const promises = prompts.map(async (prompt) => {
        const completion = await withRetry(() => deepseekClient.chat.completions.create({
          model: SWARM_MODEL,
          messages: prompt.messages.map(m => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content
          }))
        }));

        return {
          agentId: prompt.agentId,
          content: completion.choices[0].message.content || ''
        };
      });

      return await Promise.all(promises);
    } catch (error) {
      console.error('Error in chat-swarm-parallel:', error);
      throw error;
    }
  });

  // Helper chat (OpenAI mini) - no tools, fast responses
  ipcMain.handle('helper-chat', async (_event, messages: Array<{ role: string; content: string }>) => {
    try {
      const openaiClient = getOpenAIClient();
      if (!openaiClient) {
        throw new Error('OPENAI_API_KEY not configured. Go to Settings to add your API key.');
      }

      const completion = await withRetry(() => openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content
        }))
      }));

      return {
        content: completion.choices[0].message.content || ''
      };
    } catch (error) {
      console.error('Error in helper-chat:', error);
      throw error;
    }
  });
}
