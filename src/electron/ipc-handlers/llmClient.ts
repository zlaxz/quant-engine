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
  // Primary tier (Gemini) with tool calling
  ipcMain.handle('chat-primary', async (_event, messages: Array<{ role: string; content: string }>) => {
    try {
      const geminiClient = getGeminiClient();
      if (!geminiClient) {
        throw new Error('GEMINI_API_KEY not configured. Go to Settings to add your API key.');
      }

      // Get model with tools enabled
      const model = geminiClient.getGenerativeModel({
        model: PRIMARY_MODEL,
        tools: [{ functionDeclarations: ALL_TOOLS }],
      });

      // Convert messages to Gemini format
      const history = messages.slice(0, -1).map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));

      const lastMessage = messages[messages.length - 1];
      const chat = model.startChat({ history });

      // Tool execution loop
      let response = await chat.sendMessage(lastMessage.content);
      let iterations = 0;
      let allToolOutputs: string[] = [];

      while (iterations < MAX_TOOL_ITERATIONS) {
        const candidate = response.response.candidates?.[0];
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

          try {
            const result = await executeTool(toolName, toolArgs);
            const output = result.success ? result.content : `Error: ${result.error}`;

            toolResults.push({
              functionResponse: {
                name: toolName,
                response: { content: output }
              }
            });

            allToolOutputs.push(`[${toolName}]: ${output.slice(0, 500)}${output.length > 500 ? '...' : ''}`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            toolResults.push({
              functionResponse: {
                name: toolName,
                response: { content: `Tool execution error: ${errorMsg}` }
              }
            });
          }
        }

        // Send tool results back to the model
        response = await chat.sendMessage(toolResults);
        iterations++;
      }

      // Get final text response
      const finalText = response.response.text();

      // Include tool outputs in metadata for debugging
      const toolSummary = allToolOutputs.length > 0
        ? `\n\n---\n*Tools used: ${iterations} iterations*`
        : '';

      return {
        content: finalText + toolSummary,
        provider: PRIMARY_PROVIDER,
        model: PRIMARY_MODEL,
        toolsUsed: iterations
      };
    } catch (error) {
      console.error('Error in chat-primary:', error);
      throw error;
    }
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

      while (iterations < MAX_TOOL_ITERATIONS) {
        const completion = await deepseekClient.chat.completions.create({
          model: SWARM_MODEL,
          messages: currentMessages,
          tools: tools,
          tool_choice: 'auto'
        });

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
          const toolName = toolCall.function.name;
          let toolArgs: Record<string, any> = {};

          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            toolArgs = {};
          }

          console.log(`[Tool] Calling: ${toolName}`, toolArgs);

          try {
            const result = await executeTool(toolName, toolArgs);
            const output = result.success ? result.content : `Error: ${result.error}`;

            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: output
            });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Tool execution error: ${errorMsg}`
            });
          }
        }

        iterations++;
      }

      return {
        content: finalContent,
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
        const completion = await deepseekClient.chat.completions.create({
          model: SWARM_MODEL,
          messages: prompt.messages.map(m => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content
          }))
        });

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

      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content
        }))
      });

      return {
        content: completion.choices[0].message.content || ''
      };
    } catch (error) {
      console.error('Error in helper-chat:', error);
      throw error;
    }
  });
}
