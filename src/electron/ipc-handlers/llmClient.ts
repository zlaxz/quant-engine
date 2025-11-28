import { ipcMain } from 'electron';
import { GoogleGenerativeAI } from '@google/generative-ai';
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

// Safe logging that won't crash on EPIPE (broken pipe)
function safeLog(...args: any[]): void {
  try {
    console.log(...args);
  } catch (e: any) {
    // Silently ignore EPIPE errors - happens when stdout closed
    if (e.code !== 'EPIPE' && e.message !== 'write EPIPE') {
      throw e;
    }
  }
}

// List of tool names we can parse from hallucinated text
const PARSEABLE_TOOLS = [
  'spawn_agent',
  'read_file',
  'list_directory',
  'search_code',
  'write_file',
  'git_status',
  'git_diff',
  'run_tests',
  'run_command'
];

/**
 * Parse hallucinated tool calls from text response
 * Gemini sometimes generates text that looks like tool calls instead of actual functionCall parts
 * This parser extracts those and converts them to executable tool calls
 */
function parseHallucinatedToolCalls(text: string): Array<{ name: string; args: Record<string, any> }> {
  const calls: Array<{ name: string; args: Record<string, any> }> = [];

  for (const toolName of PARSEABLE_TOOLS) {
    // Pattern 1: 🔧 tool_name(arg="value", arg2="value2")
    const emojiPattern = new RegExp(`🔧\\s*${toolName}\\s*\\(([^)]+)\\)`, 'g');
    let match;
    while ((match = emojiPattern.exec(text)) !== null) {
      const argsStr = match[1];
      const args = parseArgsString(argsStr);
      if (Object.keys(args).length > 0) {
        safeLog(`[PARSER] Found emoji-style call: ${toolName}`, args);
        calls.push({ name: toolName, args });
      }
    }

    // Pattern 2: tool_name({ "key": "value" }) - JSON style
    const jsonPattern = new RegExp(`${toolName}\\s*\\(\\s*(\\{[^}]+\\})\\s*\\)`, 'g');
    while ((match = jsonPattern.exec(text)) !== null) {
      try {
        const args = JSON.parse(match[1]);
        safeLog(`[PARSER] Found JSON-style call: ${toolName}`, args);
        calls.push({ name: toolName, args });
      } catch {
        // Invalid JSON, skip
      }
    }

    // Pattern 3: **tool_name**(arg="value") - markdown bold style
    const boldPattern = new RegExp(`\\*\\*${toolName}\\*\\*\\s*\\(([^)]+)\\)`, 'g');
    while ((match = boldPattern.exec(text)) !== null) {
      const argsStr = match[1];
      const args = parseArgsString(argsStr);
      if (Object.keys(args).length > 0) {
        safeLog(`[PARSER] Found bold-style call: ${toolName}`, args);
        calls.push({ name: toolName, args });
      }
    }

    // Pattern 4: `tool_name(arg="value")` - code block style
    const codePattern = new RegExp(`\`${toolName}\\s*\\(([^)]+)\\)\``, 'g');
    while ((match = codePattern.exec(text)) !== null) {
      const argsStr = match[1];
      const args = parseArgsString(argsStr);
      if (Object.keys(args).length > 0) {
        safeLog(`[PARSER] Found code-style call: ${toolName}`, args);
        calls.push({ name: toolName, args });
      }
    }
  }

  // Deduplicate calls (same tool + same args)
  const seen = new Set<string>();
  return calls.filter(call => {
    const key = `${call.name}:${JSON.stringify(call.args)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Parse argument string like: type="analyst", task="do something"
 * or: agentType="analyst", task="do something"
 */
function parseArgsString(argsStr: string): Record<string, any> {
  const args: Record<string, any> = {};

  // Match key="value" or key='value' patterns
  const pattern = /(\w+)\s*=\s*["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(argsStr)) !== null) {
    const key = match[1];
    const value = match[2];

    // Map common variations to expected arg names
    if (key === 'type' || key === 'agentType' || key === 'agent_type') {
      args['agentType'] = value;
    } else {
      args[key] = value;
    }
  }

  return args;
}

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Cancellation state for request interruption
let currentRequestCancelled = false;

// Export cancellation function for use in handlers
export function cancelCurrentRequest() {
  currentRequestCancelled = true;
  safeLog('[LLM] Request cancellation requested');
}

// Check if request is cancelled (resets the flag after checking)
function checkCancelled(): boolean {
  if (currentRequestCancelled) {
    return true;
  }
  return false;
}

// Reset cancellation state at start of new request
function resetCancellation() {
  currentRequestCancelled = false;
}

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
      safeLog(`[Retry] Attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`, error.message);
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
  // Cancel request handler
  ipcMain.handle('cancel-request', async () => {
    cancelCurrentRequest();
    return { success: true };
  });

  // Primary tier (Gemini) with tool calling - DIRECT API CALL
  ipcMain.handle('chat-primary', async (_event, messagesRaw: unknown) => {
    // Reset cancellation state at start of new request
    resetCancellation();

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

      // Build system instruction with architecture context and tool usage directive
      const toolDirective = `

## SYSTEM ARCHITECTURE (READ THIS FIRST)

You are running inside an Electron desktop app. All tools are handled automatically by TypeScript handlers.
- When you call a tool, it executes immediately via IPC handlers
- spawn_agent/spawn_agents_parallel AUTOMATICALLY delegate to DeepSeek - you don't build anything
- All file operations use paths relative to the rotation-engine directory
- Tool results are returned to you automatically - just wait for them

DO NOT:
- Try to "build" or "implement" tools - they already exist
- Create Python handlers - everything is TypeScript
- Bypass Electron - you're inside it
- Overthink the architecture - just call tools and they work

## RESPONSE PRIORITY (Follow this order):

1. **RESPOND DIRECTLY** for:
   - Conversations, greetings, questions about yourself
   - Explanations, concepts, advice, opinions
   - Simple questions you can answer from knowledge
   - Follow-up questions in ongoing discussion
   - ANY request that doesn't require reading/writing files

2. **USE SIMPLE TOOLS** (read_file, list_directory, search_code) for:
   - Reading a specific file the user mentions
   - Exploring the codebase structure
   - Finding code patterns or implementations
   - Making small edits to files

3. **SPAWN AGENTS** ONLY for complex multi-part tasks:
   - Reviewing multiple files simultaneously
   - Deep analysis requiring extensive exploration
   - Tasks explicitly requesting agent help

## TOOL USAGE RULES:

When you DO need to interact with code:
- Use read_file, list_directory, search_code DIRECTLY - don't spawn an agent for simple reads
- Only spawn agents for genuinely complex, multi-file tasks

## AGENT SPAWNING (Automatic - just call the tool):

- **spawn_agents_parallel**: Multiple INDEPENDENT tasks run in parallel via DeepSeek
- **spawn_agent**: Single task delegated to DeepSeek

The system handles EVERYTHING - you just provide task descriptions.
`;

      const fullSystemInstruction = (systemMessage?.content || '') + toolDirective;

      // Get model with tools enabled, explicit toolConfig, and system instruction
      // AUTO mode lets Gemini output text naturally - we parse and execute tool calls from text
      // This works WITH Gemini's behavior instead of fighting it
      // See: https://ai.google.dev/gemini-api/docs/function-calling#function-calling-modes
      const model = geminiClient.getGenerativeModel({
        model: PRIMARY_MODEL,
        tools: [{ functionDeclarations: ALL_TOOLS }],
        toolConfig: {
          functionCallingConfig: {
            mode: 'AUTO' as any, // AUTO lets Gemini choose - we parse text tool calls
          }
        },
        systemInstruction: fullSystemInstruction,
        generationConfig: {
          temperature: 1.0, // Gemini 3 Pro setting
        },
      });

      // Convert messages to Gemini format (excluding system messages)
      // Gemini requires first message to be 'user' role
      let historyMessages = nonSystemMessages.slice(0, -1).map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));

      // Ensure first message is 'user' - Gemini API requirement
      while (historyMessages.length > 0 && historyMessages[0].role !== 'user') {
        historyMessages.shift();
      }

      const lastMessage = nonSystemMessages[nonSystemMessages.length - 1];
      const chat = model.startChat({ history: historyMessages });

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
        // Check for cancellation at start of each iteration
        if (checkCancelled()) {
          safeLog('[LLM] Request cancelled by user');
          _event.sender.send('llm-stream', {
            type: 'cancelled',
            content: '\n\n*Request cancelled by user.*',
            timestamp: Date.now()
          });
          return {
            content: '*Request cancelled by user.*',
            provider: PRIMARY_PROVIDER,
            model: PRIMARY_MODEL,
            toolsUsed: iterations,
            cancelled: true
          };
        }

        const candidate = (response as any).candidates?.[0];
        if (!candidate) break;

        // DEBUG: Log exactly what Gemini returned
        const allParts = candidate.content?.parts || [];
        safeLog('\n' + '='.repeat(60));
        safeLog('[DEBUG] GEMINI RESPONSE ANALYSIS');
        safeLog('  Total parts:', allParts.length);
        allParts.forEach((part: any, i: number) => {
          const hasText = !!part.text;
          const hasFunctionCall = !!part.functionCall;
          safeLog(`  Part ${i}: text=${hasText}, functionCall=${hasFunctionCall}`);
          if (hasFunctionCall) {
            safeLog(`    → REAL TOOL CALL: ${part.functionCall.name}`);
            safeLog(`    → Args: ${JSON.stringify(part.functionCall.args)}`);
          }
          if (hasText && part.text.includes('spawn_agent')) {
            safeLog('    ⚠️  TEXT CONTAINS "spawn_agent" - HALLUCINATION DETECTED');
            safeLog(`    → Text preview: ${part.text.slice(0, 200)}...`);
          }
        });
        safeLog('='.repeat(60) + '\n');

        // Check if model wants to call tools
        const functionCalls = candidate.content?.parts?.filter(
          (part: any) => part.functionCall
        );

        if (!functionCalls || functionCalls.length === 0) {
          // RE-ENABLED: Parse text-based tool calls that Gemini outputs naturally
          // Gemini prefers outputting tool calls as text - work with it, not against it
          const textParts = allParts.filter((p: any) => p.text);
          const fullText = textParts.map((p: any) => p.text).join('');
          const hallucinatedCalls = parseHallucinatedToolCalls(fullText);

          if (hallucinatedCalls.length > 0) {
            safeLog(`[FALLBACK] Detected ${hallucinatedCalls.length} hallucinated tool calls in text - EXECUTING THEM`);

            // Instead of clearing and confusing users, just start executing tools silently
            // The UI will show tool progress naturally without the jarring "clear" event
            _event.sender.send('tool-progress', {
              type: 'tools-starting',
              count: hallucinatedCalls.length,
              iteration: iterations + 1,
              message: `Executing ${hallucinatedCalls.length} tool call${hallucinatedCalls.length > 1 ? 's' : ''}`,
              timestamp: Date.now()
            });

            const toolResults: Array<{
              functionResponse: {
                name: string;
                response: { content: string };
              };
            }> = [];

            for (const hCall of hallucinatedCalls) {
              safeLog(`[FALLBACK] Executing hallucinated: ${hCall.name}`, hCall.args);

              _event.sender.send('tool-progress', {
                type: 'executing',
                tool: hCall.name,
                args: hCall.args,
                iteration: iterations + 1,
                timestamp: Date.now()
              });

              try {
                const result = await executeTool(hCall.name, hCall.args);
                const output = result.success ? result.content : `Error: ${result.error}`;

                _event.sender.send('tool-progress', {
                  type: 'completed',
                  tool: hCall.name,
                  success: result.success,
                  preview: output.slice(0, 300),
                  iteration: iterations + 1,
                  timestamp: Date.now()
                });

                toolResults.push({
                  functionResponse: {
                    name: hCall.name,
                    response: { content: output }
                  }
                });

                allToolOutputs.push(`[${hCall.name}]: ${output.slice(0, 500)}${output.length > 500 ? '...' : ''}`);
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                safeLog(`[FALLBACK] Tool error: ${errorMsg}`);
                toolResults.push({
                  functionResponse: {
                    name: hCall.name,
                    response: { content: `Tool execution error: ${errorMsg}` }
                  }
                });
              }
            }

            // Send results back to model with clearer status
            _event.sender.send('llm-stream', {
              type: 'thinking',
              content: `\n\n*Processing results...*\n\n`,
              timestamp: Date.now()
            });
            response = await streamMessage(toolResults);
            iterations++;
            continue; // Continue the loop to process new response
          }

          // No more tool calls (real or hallucinated), we have the final response
          safeLog('[DEBUG] No functionCall parts found - Gemini returned text only');
          break;
        }

        safeLog(`[LLM] Executing ${functionCalls.length} tool calls (iteration ${iterations + 1})`);

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
          // Check for cancellation before each tool
          if (checkCancelled()) {
            safeLog('[LLM] Request cancelled during tool execution');
            _event.sender.send('llm-stream', {
              type: 'cancelled',
              content: '\n\n*Request cancelled by user during tool execution.*',
              timestamp: Date.now()
            });
            return {
              content: '*Request cancelled by user.*',
              provider: PRIMARY_PROVIDER,
              model: PRIMARY_MODEL,
              toolsUsed: iterations,
              cancelled: true
            };
          }

          const call = (part as any).functionCall;
          const toolName = call.name;
          const toolArgs = call.args || {};

          safeLog(`[Tool] Calling: ${toolName}`, toolArgs);

          // SPECIAL CASE: respond_directly is the model's way of giving a text response
          // Return immediately without going through tool loop
          if (toolName === 'respond_directly') {
            const directResponse = toolArgs.response || '';
            safeLog('[LLM] Model chose respond_directly - returning text response');

            // Stream the response (use 'chunk' type to match ChatArea handler)
            _event.sender.send('llm-stream', {
              type: 'chunk',
              content: directResponse,
              timestamp: Date.now()
            });

            // Signal streaming complete
            _event.sender.send('llm-stream', {
              type: 'done',
              timestamp: Date.now()
            });

            return {
              content: directResponse,
              provider: PRIMARY_PROVIDER,
              model: PRIMARY_MODEL,
              toolsUsed: 0,
              toolLog: []
            };
          }

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

        // Send tool results back to the model with clearer status  
        _event.sender.send('llm-stream', {
          type: 'thinking',
          content: `\n\n*Processing results...*\n\n`,
          timestamp: Date.now()
        });
        response = await streamMessage(toolResults);
        iterations++;
      }

      // Get final text response
      let finalText = (response as any).text() || '';

      // If we did tool calls but got no final text, ask model to synthesize
      if (!finalText.trim() && iterations > 0 && allToolOutputs.length > 0) {
        safeLog('[LLM] No final text after tool calls, requesting synthesis...');
        _event.sender.send('llm-stream', {
          type: 'thinking',
          content: '\n\n*Summarizing...*\n\n',
          timestamp: Date.now()
        });

        // Ask model to synthesize a response from tool outputs
        const synthesisPrompt = `Based on the tool results above, provide a clear, helpful response to the user's original question.`;
        const synthesisResponse = await streamMessage(synthesisPrompt);
        finalText = (synthesisResponse as any).text() || 'I explored the codebase. Please try a more specific question.';
      }

      // Build visible tool call log (only show if user wants verbose output)
      const toolSummary = '';  // Removed verbose tool log - tools are shown in real-time now

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

        safeLog(`[Swarm] Executing ${message.tool_calls.length} tool calls (iteration ${iterations + 1})`);

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

          safeLog(`[Tool] Calling: ${toolName}`, toolArgs);

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
