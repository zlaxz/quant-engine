import { ipcMain } from 'electron';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

// LLM routing config
const PRIMARY_MODEL = 'gemini-2.5-pro-preview-06-05';
const PRIMARY_PROVIDER = 'gemini';
const SWARM_MODEL = 'deepseek-reasoner';
const SWARM_PROVIDER = 'deepseek';
const HELPER_MODEL = 'gpt-4o-mini';

// Lazy client getters - read API keys at call time, not module load time
// This allows keys set via Settings to take effect without app restart
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

export function registerLlmHandlers() {
  // Primary tier (Gemini) - local call, no edge function
  ipcMain.handle('chat-primary', async (_event, messages: any[]) => {
    try {
      const geminiClient = getGeminiClient();
      if (!geminiClient) {
        throw new Error('GEMINI_API_KEY not configured. Go to Settings to add your API key.');
      }

      const model = geminiClient.getGenerativeModel({ model: PRIMARY_MODEL });

      // Convert messages to Gemini format
      const history = messages.slice(0, -1).map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));

      const lastMessage = messages[messages.length - 1];

      const chat = model.startChat({ history });
      const result = await chat.sendMessage(lastMessage.content);
      const response = result.response.text();

      return {
        content: response,
        provider: PRIMARY_PROVIDER,
        model: PRIMARY_MODEL,
      };
    } catch (error) {
      console.error('Error in chat-primary:', error);
      throw error;
    }
  });

  // Swarm tier (DeepSeek)
  ipcMain.handle('chat-swarm', async (_event, messages: any[]) => {
    try {
      const deepseekClient = getDeepSeekClient();
      if (!deepseekClient) {
        throw new Error('DEEPSEEK_API_KEY not configured. Go to Settings to add your API key.');
      }

      const completion = await deepseekClient.chat.completions.create({
        model: SWARM_MODEL,
        messages,
      });

      return {
        content: completion.choices[0].message.content || '',
        provider: SWARM_PROVIDER,
        model: SWARM_MODEL,
      };
    } catch (error) {
      console.error('Error in chat-swarm:', error);
      throw error;
    }
  });

  // Swarm parallel (DeepSeek)
  ipcMain.handle('chat-swarm-parallel', async (_event, prompts: any[]) => {
    try {
      const deepseekClient = getDeepSeekClient();
      if (!deepseekClient) {
        throw new Error('DEEPSEEK_API_KEY not configured. Go to Settings to add your API key.');
      }

      const promises = prompts.map(async (prompt) => {
        const completion = await deepseekClient.chat.completions.create({
          model: SWARM_MODEL,
          messages: prompt.messages,
        });

        return {
          agentId: prompt.agentId,
          content: completion.choices[0].message.content || '',
        };
      });

      return await Promise.all(promises);
    } catch (error) {
      console.error('Error in chat-swarm-parallel:', error);
      throw error;
    }
  });

  // Helper chat (OpenAI mini)
  ipcMain.handle('helper-chat', async (_event, messages: any[]) => {
    try {
      const openaiClient = getOpenAIClient();
      if (!openaiClient) {
        throw new Error('OPENAI_API_KEY not configured. Go to Settings to add your API key.');
      }

      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-5-mini',
        messages,
      });

      return {
        content: completion.choices[0].message.content || '',
      };
    } catch (error) {
      console.error('Error in helper-chat:', error);
      throw error;
    }
  });
}
