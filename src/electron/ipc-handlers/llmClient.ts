import { ipcMain, BrowserWindow } from 'electron';
import { GoogleGenAI, FunctionCallingConfigMode, ThinkingLevel } from '@google/genai';
import OpenAI from 'openai';
import { ALL_TOOLS } from '../tools/toolDefinitions';
import { executeTool } from '../tools/toolHandlers';
import { detectTaskContext, selectTools } from '../tools/toolSelector';
import {
  validateIPC,
  ChatMessagesSchema,
  SwarmPromptsSchema,
} from '../validation/schemas';
import { MODELS } from '../../config/models';
import { getDecisionLogger } from '../utils/decisionLogger';
import { routeTask } from '../utils/routingDecision';
// 10X CIO System
import {
  assembleCIOPromptSync,
  getCurrentMode
} from '../../prompts/cioPromptAssembler';

// LLM routing config - centralized
const PRIMARY_MODEL = MODELS.PRIMARY.model;
const PRIMARY_PROVIDER = MODELS.PRIMARY.provider;
const SWARM_MODEL = MODELS.SWARM.model;
const SWARM_PROVIDER = MODELS.SWARM.provider;
const HELPER_MODEL = MODELS.HELPER.model;

// Max tool call iterations to prevent infinite loops
const MAX_TOOL_ITERATIONS = 50;

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
// NOTE: Currently unused - kept for future reference if needed
/*
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
*/

/**
 * Parse hallucinated tool calls from text response
 * Gemini sometimes generates text that looks like tool calls instead of actual functionCall parts
 * This parser extracts those and converts them to executable tool calls
 * 
 * NOTE: Currently unused - kept for future reference if needed
 */
/*
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
*/

/**
 * Parse argument string like: type="analyst", task="do something"
 * or: agentType="analyst", task="do something"
 * 
 * NOTE: Currently unused - kept for future reference if needed
 */
/*
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
*/

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

// Helper to emit tool execution events to renderer
function emitToolEvent(event: {
  type: 'tool-start' | 'tool-complete' | 'tool-error';
  tool: string;
  args: Record<string, any>;
  result?: any;
  error?: string;
  timestamp: number;
  duration?: number;
  whyThis?: string;      // Explanation of why this tool was needed
  whatFound?: string;    // Summary of what was discovered
}) {
  try {
    const windows = BrowserWindow.getAllWindows();
    const mainWindow = windows.find(w => !w.isDestroyed());
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('tool-execution-event', event);
    }
  } catch (e) {
    // Silently fail if window not available
  }
}

/**
 * Parse WHY_THIS and WHAT_FOUND markers from LLM response
 * Returns { whyThis: string | undefined, whatFound: string | undefined }
 */
function parseToolMarkers(text: string, toolName: string): { whyThis?: string; whatFound?: string } {
  const markers: { whyThis?: string; whatFound?: string } = {};
  
  // Parse WHY_THIS marker
  const whyPattern = new RegExp(`\\[WHY_THIS:\\s*${toolName}\\]\\s*([^\n]+)`, 'i');
  const whyMatch = text.match(whyPattern);
  if (whyMatch) {
    markers.whyThis = whyMatch[1].trim();
  }
  
  // Parse WHAT_FOUND marker
  const whatPattern = new RegExp(`\\[WHAT_FOUND:\\s*${toolName}\\]\\s*([^\n]+)`, 'i');
  const whatMatch = text.match(whatPattern);
  if (whatMatch) {
    markers.whatFound = whatMatch[1].trim();
  }
  
  return markers;
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
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
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
  return ALL_TOOLS
    .filter(tool => tool.name !== undefined)
    .map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name!,
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

  // Handle routing decision override
  ipcMain.handle('override-routing-decision', async (_event, { decisionId, overrideTo }) => {
    try {
      const decisionLogger = getDecisionLogger();
      
      // Log the override
      decisionLogger.logOverride(decisionId, overrideTo);
      
      console.log(`[Override] Decision ${decisionId} overridden to: ${overrideTo}`);
      
      return {
        success: true,
        message: `Routing overridden to ${overrideTo}`,
        decisionId,
        overrideTo
      };
    } catch (error) {
      console.error('[Override] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Primary tier (Gemini) with tool calling - DIRECT API CALL
  ipcMain.handle('chat-primary', async (_event, messagesRaw: unknown) => {
    // Reset cancellation state at start of new request
    resetCancellation();

    const startTime = Date.now();
    let routingDecisionId: string | null = null;

    try {
      // Validate messages at IPC boundary
      const messages = validateIPC(ChatMessagesSchema, messagesRaw, 'chat messages');

      // Make routing decision for transparency
      const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
      const recommendation = await routeTask(lastUserMessage);
      
      // Log decision with task summary
      const decisionLogger = getDecisionLogger();
      const taskSummary = lastUserMessage.length > 100 
        ? lastUserMessage.substring(0, 100) + '...' 
        : lastUserMessage;
      
      const loggedDecision = decisionLogger.logDecision({
        task: taskSummary,
        chosen: recommendation.chosen,
        confidence: recommendation.confidence,
        alternativeConsidered: recommendation.alternativeConsidered,
        reasoning: recommendation.reasoning
      });
      
      routingDecisionId = loggedDecision.id;
      
      // Emit decision event to renderer for DecisionCard display
      const windows = BrowserWindow.getAllWindows();
      const mainWindow = windows.find(w => !w.isDestroyed());
      if (mainWindow?.webContents) {
        mainWindow.webContents.send('claude-code-event', {
          type: 'decision',
          data: {
            id: routingDecisionId,
            task: taskSummary,
            chosen: recommendation.chosen,
            confidence: recommendation.confidence,
            alternative: recommendation.alternativeConsidered || 'None',
            reasoning: recommendation.reasoning
          }
        });
      }

      const geminiClient = getGeminiClient();
      if (!geminiClient) {
        throw new Error('GEMINI_API_KEY not configured. Go to Settings to add your API key.');
      }

      // Extract system message for Gemini's systemInstruction (not used directly, but part of fullSystemInstruction)
      const nonSystemMessages = messages.filter(m => m.role !== 'system');

      // Build system instruction using 10X CIO System
      // This replaces the old verbose toolDirective with a focused, personality-driven prompt
      // Note: lastUserMessage is already declared above at line ~351

      // Detect mode from user message
      const currentMode = getCurrentMode();

      // Assemble CIO prompt with current mode
      // PERFORMANCE: This is synchronous and fast (~1ms)
      const cioPrompt = assembleCIOPromptSync(currentMode);

      // Essential tool enforcement (condensed from verbose version)
      const toolEnforcement = `

## TOOL MANDATE (CRITICAL)

You are running in an Electron app with FULL tool access. Tools execute IMMEDIATELY.

**NEVER SAY:**
- "I cannot run Python scripts" - USE run_python_script
- "I don't have access" - USE the tools below
- "You'll need to run this" - YOU run it

**TOOL CATEGORIES:**
- Files: read_file, write_file, list_directory, search_code
- Backtest: batch_backtest, sweep_params, run_python_script
- Git: git_status, git_diff, git_commit
- Agents: spawn_agent, execute_via_claude_code

**THE RULE:** Use tools FIRST, explain after.
`;

      // MISSION CONTEXT: Inject capital preservation awareness into every request
      // This ensures the model never forgets the stakes
      const missionContext = `
## MISSION STATUS: ACTIVE
CAPITAL PRESERVATION: PRIORITY ALPHA
TARGET: ASYMMETRIC UPSIDE
RISK OF RUIN: VETO ANY TRADE WHERE P(RUIN) > 0
`;

      const fullSystemInstruction = cioPrompt + missionContext + toolEnforcement;

      // Detect task context from user message (reuse lastUserMessage from routing)
      const taskContext = detectTaskContext(lastUserMessage);
      const contextualTools = selectTools(taskContext);

      safeLog(`[LLM] Task context: ${taskContext}, providing ${contextualTools.length} tools`);

      // NEW SDK (@google/genai) uses direct generateContentStream calls
      // AUTO mode lets model decide when to use tools
      // See: https://ai.google.dev/gemini-api/docs/function-calling#function-calling-modes
      const lastMessage = nonSystemMessages[nonSystemMessages.length - 1];

      // SYSTEM NUDGE: Inject a "Voice of God" reminder at the end of user messages
      // This forces the model to snap out of "chat mode" and into "work mode"
      if (lastMessage && lastMessage.role === 'user' && typeof lastMessage.content === 'string') {
        lastMessage.content += `\n\n(SYSTEM: Do not lecture. If you need data, use 'spawn_agent' or 'obsidian_search_notes' IMMEDIATELY. Do not explain what you will do. Just do it.)`;
      }

      // Build config for new SDK - all options go in config object
      const geminiConfig = {
        tools: [{ functionDeclarations: contextualTools }],
        toolConfig: {
          functionCallingConfig: {
            // AUTO mode lets model decide whether to use tools based on context
            // ANY mode was FORCING tool-first behavior, causing exploration/scaffolding
            // See: https://ai.google.dev/gemini-api/docs/function-calling#function-calling-modes
            mode: FunctionCallingConfigMode.AUTO,
          }
        },
        systemInstruction: fullSystemInstruction,
        temperature: 1.0, // Gemini 3 Pro default - DO NOT CHANGE
        // Gemini 3 Pro thinking configuration
        // thinkingLevel: ThinkingLevel.LOW (fast) or ThinkingLevel.HIGH (deep reasoning, default)
        // includeThoughts: true to stream thought summaries (the visible reasoning)
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.HIGH,  // Max reasoning depth for complex quant analysis
          includeThoughts: true,  // Stream thought summaries to UI
        },
      };

      // Track conversation history for multi-turn tool calling
      // NEW SDK requires Content[] format: [{ role, parts }, ...]
      // Wrap the user message properly
      const userContent = typeof lastMessage.content === 'string'
        ? { role: 'user', parts: [{ text: lastMessage.content }] }
        : lastMessage.content;
      let conversationContents: any[] = [userContent];

      // Emit initial thinking event
      _event.sender.send('tool-progress', {
        type: 'thinking',
        message: 'Processing your request...',
        timestamp: Date.now()
      });

      // Tool execution loop - use streaming for all responses

      // Helper to stream a message and return response using NEW SDK
      // Uses generateContentStream directly instead of chat.sendMessageStream
      const streamMessage = async (contents: any): Promise<{ response: any, fullText: string, functionCalls: any[] }> => {
        try {
          // NEW SDK: generateContentStream returns async iterator directly
          const streamResult = await geminiClient.models.generateContentStream({
            model: PRIMARY_MODEL,
            contents: contents,
            config: geminiConfig
          });

          let accumulatedText = '';
          let functionCalls: any[] = [];
          let chunkCount = 0;

          // NEW SDK: iterate directly over the stream result
          for await (const chunk of streamResult) {
            chunkCount++;
            // LOG EVERY CHUNK for debugging
            safeLog(`\n[STREAM CHUNK ${chunkCount}] Raw chunk:`, JSON.stringify(chunk, null, 2).slice(0, 500));

            // NEW SDK structure: chunk has candidates array
            const candidate = (chunk as any).candidates?.[0];
            if (candidate?.content?.parts) {
              safeLog(`[STREAM] Found ${candidate.content.parts.length} parts in chunk`);
              for (const part of candidate.content.parts) {
                // DEBUG: Log ALL part properties
                safeLog('[STREAM PART]', JSON.stringify(part).slice(0, 300));

                // Check for function calls
                if (part.functionCall) {
                  safeLog('[FUNCTION CALL DETECTED!]', part.functionCall.name);
                  functionCalls.push(part);
                }
                // Gemini 3 returns thinking in parts with thought: true
                else if (part.thought && part.text) {
                  safeLog('[THOUGHT DETECTED!]', part.text.slice(0, 100));
                  _event.sender.send('llm-stream', {
                    type: 'thinking',
                    content: part.text,
                    timestamp: Date.now()
                  });
                } else if (part.text && !part.thought) {
                  // Regular text content
                  accumulatedText += part.text;
                  _event.sender.send('llm-stream', {
                    type: 'chunk',
                    content: part.text,
                    timestamp: Date.now()
                  });
                }
              }
            } else {
              // NEW SDK: try chunk.text property (getter)
              const text = typeof (chunk as any).text === 'string' ? (chunk as any).text : null;
              if (text) {
                safeLog('[STREAM] Using text property/method:', text.slice(0, 100));
                accumulatedText += text;
                _event.sender.send('llm-stream', {
                  type: 'chunk',
                  content: text,
                  timestamp: Date.now()
                });
              }
            }
          }

          // Return the last chunk as "response" for compatibility
          return { response: { candidates: [{ content: { parts: functionCalls.length > 0 ? functionCalls : [{ text: accumulatedText }] } }] }, fullText: accumulatedText, functionCalls };
        } catch (error) {
          // Fallback to non-streaming if streaming fails
          console.warn('[LLM] Streaming failed, falling back to non-streaming:', error);
          const response = await geminiClient.models.generateContent({
            model: PRIMARY_MODEL,
            contents: contents,
            config: geminiConfig
          });
          const text = response.text || '';
          return { response, fullText: text, functionCalls: [] };
        }
      };

      // Initial response with streaming - use properly formatted conversation
      let streamResult = await streamMessage(conversationContents);
      let accumulatedText = streamResult.fullText;
      let pendingFunctionCalls = streamResult.functionCalls;

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

        // NEW SDK: Use function calls collected during streaming
        const functionCalls = pendingFunctionCalls;

        safeLog('\n' + '='.repeat(60));
        safeLog('[DEBUG] GEMINI RESPONSE ANALYSIS (NEW SDK)');
        safeLog('  Function calls from stream:', functionCalls.length);
        safeLog('  Accumulated text length:', accumulatedText.length);
        safeLog('='.repeat(60) + '\n');

        // No function calls? We're done.
        if (!functionCalls || functionCalls.length === 0) {
          safeLog('[DEBUG] No function calls detected - response complete');
          break;
        }

        safeLog(`[LLM] ✅ Gemini used PROPER function calling - ${functionCalls.length} tool calls (iteration ${iterations + 1})`);

        // Log each tool call for debugging
        functionCalls.forEach((fc: any) => {
          const call = fc.functionCall;
          safeLog(`  → ${call.name}(${JSON.stringify(call.args || {}).slice(0, 100)})`);
        });

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
          // BUG FIX: Don't return immediately if there are other tools to execute!
          // The model might call respond_directly + scan_data in the same turn
          if (toolName === 'respond_directly') {
            const directResponse = toolArgs.response || '';

            // Check if there are OTHER tools in this batch (not just respond_directly)
            const hasOtherTools = functionCalls.some(
              (p: any) => p.functionCall?.name && p.functionCall.name !== 'respond_directly'
            );

            if (hasOtherTools) {
              // Stream the response but CONTINUE processing other tools
              safeLog('[LLM] Model chose respond_directly WITH other tools - streaming but continuing');

              _event.sender.send('llm-stream', {
                type: 'chunk',
                content: directResponse,
                timestamp: Date.now()
              });

              // Add to accumulated text for context
              accumulatedText += directResponse;

              // Push a success result so the model knows we displayed it
              toolResults.push({
                functionResponse: {
                  name: toolName,
                  response: { content: "Response displayed to user." }
                }
              });

              continue; // Process the other tools!
            }

            // Only respond_directly in batch - this is the final response
            safeLog('[LLM] Model chose respond_directly only - returning text response');

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

          const startTime = Date.now();

          // Parse markers from accumulated text
          const markers = parseToolMarkers(accumulatedText, toolName);

          // Emit tool start event with full details + markers
          emitToolEvent({
            type: 'tool-start',
            tool: toolName,
            args: toolArgs,
            timestamp: startTime,
            whyThis: markers.whyThis
          });

          // Emit BEFORE executing tool (legacy event)
          _event.sender.send('tool-progress', {
            type: 'executing',
            tool: toolName,
            args: toolArgs,
            iteration: iterations + 1,
            timestamp: startTime
          });

          // Add to visible log
          const argsStr = Object.entries(toolArgs).map(([k, v]) => `${k}="${v}"`).join(', ');
          toolCallLog.push(`🔧 ${toolName}(${argsStr})`);

          try {
            const result = await executeTool(toolName, toolArgs);
            const output = result.success ? result.content : `Error: ${result.error}`;
            const endTime = Date.now();
            const duration = endTime - startTime;

            // Re-parse markers after tool execution (may have WHAT_FOUND now)
            const updatedMarkers = parseToolMarkers(accumulatedText, toolName);

            // Emit tool completion event with full details + markers
            emitToolEvent({
              type: 'tool-complete',
              tool: toolName,
              args: toolArgs,
              result: output,
              timestamp: endTime,
              duration,
              whyThis: updatedMarkers.whyThis,
              whatFound: updatedMarkers.whatFound
            });

            // Emit AFTER executing tool (legacy event)
            _event.sender.send('tool-progress', {
              type: 'completed',
              tool: toolName,
              success: result.success,
              preview: output.slice(0, 300),
              iteration: iterations + 1,
              timestamp: endTime
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
            const endTime = Date.now();
            const duration = endTime - startTime;

            // Emit tool error event with full details
            emitToolEvent({
              type: 'tool-error',
              tool: toolName,
              args: toolArgs,
              error: errorMsg,
              timestamp: endTime,
              duration
            });

            // Emit error completion event (legacy)
            _event.sender.send('tool-progress', {
              type: 'completed',
              tool: toolName,
              success: false,
              preview: `Error: ${errorMsg}`,
              iteration: iterations + 1,
              timestamp: endTime
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

        // Send tool results back to the model using NEW SDK
        // NEW SDK requires FULL conversation history on each call:
        // 1. Original user message
        // 2. Model's function calls
        // 3. Function responses (as user role)

        // Add model's function calls to conversation
        conversationContents.push({ role: 'model', parts: functionCalls });

        // Add function responses
        conversationContents.push({
          role: 'user',
          parts: toolResults.map(tr => ({ functionResponse: tr.functionResponse }))
        });

        // Stream the next response with FULL conversation history
        streamResult = await streamMessage(conversationContents);
        accumulatedText += streamResult.fullText;
        pendingFunctionCalls = streamResult.functionCalls;
        iterations++;
      }

      // Check if we hit max iterations
      if (iterations >= MAX_TOOL_ITERATIONS) {
        safeLog(`⚠️ Reached maximum tool call iterations (${MAX_TOOL_ITERATIONS})`);
        safeLog(`   This may indicate an infinite loop or task that's too complex`);

        // Warn user
        _event.sender.send('llm-stream', {
          type: 'chunk',
          content: `\n\n⚠️ *Reached maximum tool iterations (${MAX_TOOL_ITERATIONS}). The task may be too complex for single execution. Consider breaking it into smaller steps.*\n`,
          timestamp: Date.now()
        });
      }

      // Get final text response - use accumulated text from streaming
      let finalText = accumulatedText || '';

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
        const synthesisResult = await streamMessage(synthesisPrompt);
        // If synthesis fails, show tool outputs instead of apologetic fallback
        finalText = synthesisResult.fullText || `I executed tools but couldn't synthesize a response. Here are the results:\n\n${allToolOutputs.slice(-3).join('\n\n')}`;
      }

      // Build visible tool call log (only show if user wants verbose output)
      const toolSummary = '';  // Removed verbose tool log - tools are shown in real-time now

      // Signal streaming complete
      _event.sender.send('llm-stream', {
        type: 'done',
        timestamp: Date.now()
      });

      // Track successful outcome
      if (routingDecisionId) {
        const duration = Date.now() - startTime;
        const decisionLogger = getDecisionLogger();
        decisionLogger.logOutcome(routingDecisionId, {
          success: true,
          duration
        });
      }

      return {
        content: finalText + toolSummary,
        provider: PRIMARY_PROVIDER,
        model: PRIMARY_MODEL,
        toolsUsed: iterations
      };
    } catch (error) {
      console.error('Error in chat-primary:', error);
      
      // Track failed outcome
      if (routingDecisionId) {
        const duration = Date.now() - startTime;
        const decisionLogger = getDecisionLogger();
        decisionLogger.logOutcome(routingDecisionId, {
          success: false,
          duration,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      
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
    // Reset cancellation state at start of new request
    resetCancellation();

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
    // Reset cancellation state at start of new request
    resetCancellation();

    try {
      // Validate swarm prompts at IPC boundary
      const prompts = validateIPC(SwarmPromptsSchema, promptsRaw, 'swarm prompts');

      const deepseekClient = getDeepSeekClient();
      if (!deepseekClient) {
        throw new Error('DEEPSEEK_API_KEY not configured. Go to Settings to add your API key.');
      }

      const promises = prompts.map(async (prompt) => {
        try {
          const completion = await withRetry(() => deepseekClient.chat.completions.create({
            model: SWARM_MODEL,
            messages: prompt.messages.map(m => ({
              role: m.role as 'user' | 'assistant' | 'system',
              content: m.content
            }))
          }));

          return {
            agentId: prompt.agentId,
            content: completion.choices[0].message.content || '',
            success: true
          };
        } catch (error: any) {
          // Return error as result instead of failing entire Promise.all
          return {
            agentId: prompt.agentId,
            content: `Agent failed: ${error.message}`,
            success: false
          };
        }
      });

      // All promises handle their own errors, so Promise.all won't throw
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
