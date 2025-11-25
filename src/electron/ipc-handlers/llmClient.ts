import { ipcMain } from 'electron';
import { GoogleGenerativeAI, FunctionCallingMode } from '@google/generative-ai';
import OpenAI from 'openai';
import { ALL_TOOLS } from '../tools/toolDefinitions';
import { executeTool } from '../tools/toolHandlers';
import {
  validateIPC,
  ChatMessagesSchema,
  SwarmPromptsSchema,
} from '../validation/schemas';
import { MODELS } from '../../config/models';

// LLM routing config - centralized
const PRIMARY_MODEL = MODELS.PRIMARY.model;
const PRIMARY_PROVIDER = MODELS.PRIMARY.provider;
const SWARM_MODEL = MODELS.SWARM.model;
const SWARM_PROVIDER = MODELS.SWARM.provider;
const HELPER_MODEL = MODELS.HELPER.model;

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
  // Primary tier (Gemini) with tool calling - DIRECT API CALL
  ipcMain.handle('chat-primary', async (_event, messagesRaw: unknown) => {
    try {
      // Validate messages at IPC boundary
      const messages = validateIPC(ChatMessagesSchema, messagesRaw, 'chat messages');

      const geminiClient = getGeminiClient();
      if (!geminiClient) {
        throw new Error('GEMINI_API_KEY not configured. Go to Settings to add your API key.');
      }

      // Extract system message for Gemini's systemInstruction
      const systemMessage = messages.find(m => m.role === 'system');
      const nonSystemMessages = messages.filter(m => m.role !== 'system');

      // Build system instruction with EXPLICIT tool usage directive
      const toolDirective = `

CRITICAL INSTRUCTION: You have access to tools that let you ACTUALLY read and modify the codebase.
DO NOT make up file contents or guess at code structure.
DO NOT describe what you would do - USE THE TOOLS to actually do it.
ALWAYS use list_directory and read_file to examine code BEFORE answering questions about it.
When asked about the codebase, your FIRST action should be to use tools to explore it.

Available tools: read_file, list_directory, search_code, write_file, git_status, git_diff, run_tests, etc.
`;

      const fullSystemInstruction = (systemMessage?.content || '') + toolDirective;

      // Get model with tools enabled and system instruction
      const model = geminiClient.getGenerativeModel({
        model: PRIMARY_MODEL,
        tools: [{ functionDeclarations: ALL_TOOLS }],
        systemInstruction: fullSystemInstruction,
      });

      // Convert messages to Gemini format (excluding system messages)
      const history = nonSystemMessages.slice(0, -1).map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));

      const lastMessage = nonSystemMessages[nonSystemMessages.length - 1];
      const chat = model.startChat({ history });

      // Emit initial thinking event
      _event.sender.send('tool-progress', {
        type: 'thinking',
        message: 'Processing your request...',
        timestamp: Date.now()
      });

      // Tool execution loop - use streaming for all responses
      let response;

      // Helper to stream a message and return response
      const streamMessage = async (content: string | Array<any>) => {
        try {
          const streamResult = await chat.sendMessageStream(content);
          for await (const chunk of streamResult.stream) {
            const text = chunk.text();
            if (text) {
              _event.sender.send('llm-stream', {
                type: 'chunk',
                content: text,
                timestamp: Date.now()
              });
            }
          }
          return await streamResult.response;
        } catch (error) {
          // Fallback to non-streaming if streaming fails
          console.warn('[LLM] Streaming failed, falling back to non-streaming:', error);
          return await withRetry(() => chat.sendMessage(content));
        }
      };

      // Initial response with streaming
      response = await streamMessage(lastMessage.content);

      let iterations = 0;
      let allToolOutputs: string[] = [];
      let toolCallLog: string[] = []; // Visible log for user

      while (iterations < MAX_TOOL_ITERATIONS) {
        const candidate = (response as any).candidates?.[0];
        if (!candidate) break;

        // Check if model wants to call tools
        const functionCalls = candidate.content?.parts?.filter(
          (part: any) => part.functionCall
        );

        if (!functionCalls || functionCalls.length === 0) {
          // No more tool calls, we have the final response
          break;
        }

        console.log(`[LLM] Executing ${functionCalls.length} tool calls (iteration ${iterations + 1})`);

        // Emit event when entering tool loop
        _event.sender.send('tool-progress', {
          type: 'tools-starting',
          count: functionCalls.length,
          iteration: iterations + 1,
          timestamp: Date.now()
        });

        // Execute all tool calls
        const toolResults: Array<{
          functionResponse: {
            name: string;
            response: { content: string };
          };
        }> = [];

        for (const part of functionCalls) {
          const call = (part as any).functionCall;
          const toolName = call.name;
          const toolArgs = call.args || {};

          console.log(`[Tool] Calling: ${toolName}`, toolArgs);

          // Emit BEFORE executing tool
          _event.sender.send('tool-progress', {
            type: 'executing',
            tool: toolName,
            args: toolArgs,
            iteration: iterations + 1,
            timestamp: Date.now()
          });

          // Add to visible log
          const argsStr = Object.entries(toolArgs).map(([k, v]) => `${k}="${v}"`).join(', ');
          toolCallLog.push(`🔧 ${toolName}(${argsStr})`);

          try {
            const result = await executeTool(toolName, toolArgs);
            const output = result.success ? result.content : `Error: ${result.error}`;

            // Emit AFTER executing tool
            _event.sender.send('tool-progress', {
              type: 'completed',
              tool: toolName,
              success: result.success,
              preview: output.slice(0, 300),
              iteration: iterations + 1,
              timestamp: Date.now()
            });

            toolResults.push({
              functionResponse: {
                name: toolName,
                response: { content: output }
              }
            });

            // Add result preview to log
            const preview = output.slice(0, 200).replace(/\n/g, ' ');
            toolCallLog.push(`   → ${result.success ? '✓' : '✗'} ${preview}${output.length > 200 ? '...' : ''}`);

            allToolOutputs.push(`[${toolName}]: ${output.slice(0, 500)}${output.length > 500 ? '...' : ''}`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);

            // Emit error completion event
            _event.sender.send('tool-progress', {
              type: 'completed',
              tool: toolName,
              success: false,
              preview: `Error: ${errorMsg}`,
              iteration: iterations + 1,
              timestamp: Date.now()
            });

            toolCallLog.push(`   → ✗ Error: ${errorMsg}`);
            toolResults.push({
              functionResponse: {
                name: toolName,
                response: { content: `Tool execution error: ${errorMsg}` }
              }
            });
          }
        }

        // Send tool results back to the model with streaming
        _event.sender.send('llm-stream', {
          type: 'thinking',
          content: `\n\n*Analyzing tool results (iteration ${iterations + 1})...*\n\n`,
          timestamp: Date.now()
        });
        response = await streamMessage(toolResults);
        iterations++;
      }

      // Get final text response
      const finalText = (response as any).text();

      // Build visible tool call log
      const toolSummary = toolCallLog.length > 0
        ? `\n\n---\n**🔧 Tool Calls (${iterations} iteration${iterations !== 1 ? 's' : ''}):**\n\`\`\`\n${toolCallLog.join('\n')}\n\`\`\``
        : '';

      // Signal streaming complete
      _event.sender.send('llm-stream', {
        type: 'done',
        timestamp: Date.now()
      });

      return {
        content: finalText + toolSummary,
        provider: PRIMARY_PROVIDER,
        model: PRIMARY_MODEL,
        toolsUsed: iterations
      };
    } catch (error) {
      console.error('Error in chat-primary:', error);
      // Signal error
      _event.sender.send('llm-stream', {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      });
      throw error;
    }
  });

  // Swarm tier (DeepSeek) with tool calling
  ipcMain.handle('chat-swarm', async (_event, messagesRaw: unknown) => {
    try {
      // Validate messages at IPC boundary
      const messages = validateIPC(ChatMessagesSchema, messagesRaw, 'chat messages');

      const deepseekClient = getDeepSeekClient();
      if (!deepseekClient) {
        throw new Error('DEEPSEEK_API_KEY not configured. Go to Settings to add your API key.');
      }

      const tools = toolsToOpenAIFormat();
      let currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content
      }));

      // Emit initial thinking event
      _event.sender.send('tool-progress', {
        type: 'thinking',
        message: 'Processing your request...',
        timestamp: Date.now()
      });

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

        // Emit event when entering tool loop
        _event.sender.send('tool-progress', {
          type: 'tools-starting',
          count: message.tool_calls.length,
          iteration: iterations + 1,
          timestamp: Date.now()
        });

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

          // Emit BEFORE executing tool
          _event.sender.send('tool-progress', {
            type: 'executing',
            tool: toolName,
            args: toolArgs,
            iteration: iterations + 1,
            timestamp: Date.now()
          });

          // Add to visible log
          const argsStr = Object.entries(toolArgs).map(([k, v]) => `${k}="${v}"`).join(', ');
          toolCallLog.push(`🔧 ${toolName}(${argsStr})`);

          try {
            const result = await executeTool(toolName, toolArgs);
            const output = result.success ? result.content : `Error: ${result.error}`;

            // Emit AFTER executing tool
            _event.sender.send('tool-progress', {
              type: 'completed',
              tool: toolName,
              success: result.success,
              preview: output.slice(0, 300),
              iteration: iterations + 1,
              timestamp: Date.now()
            });

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

            // Emit error completion event
            _event.sender.send('tool-progress', {
              type: 'completed',
              tool: toolName,
              success: false,
              preview: `Error: ${errorMsg}`,
              iteration: iterations + 1,
              timestamp: Date.now()
            });

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
  ipcMain.handle('chat-swarm-parallel', async (_event, promptsRaw: unknown) => {
    try {
      // Validate swarm prompts at IPC boundary
      const prompts = validateIPC(SwarmPromptsSchema, promptsRaw, 'swarm prompts');

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
  ipcMain.handle('helper-chat', async (_event, messagesRaw: unknown) => {
    try {
      // Validate messages at IPC boundary
      const messages = validateIPC(ChatMessagesSchema, messagesRaw, 'chat messages');

      const openaiClient = getOpenAIClient();
      if (!openaiClient) {
        throw new Error('OPENAI_API_KEY not configured. Go to Settings to add your API key.');
      }

      const completion = await withRetry(() => openaiClient.chat.completions.create({
        model: HELPER_MODEL,
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
