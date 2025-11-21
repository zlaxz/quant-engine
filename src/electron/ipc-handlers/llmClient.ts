import { ipcMain } from 'electron';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

// API keys from environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

// Initialize clients
const geminiClient = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const openaiClient = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const deepseekClient = DEEPSEEK_API_KEY
  ? new OpenAI({ apiKey: DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' })
  : null;

// LLM routing config
const PRIMARY_MODEL = 'gemini-3-pro-preview';
const PRIMARY_PROVIDER = 'gemini';
const SWARM_MODEL = 'deepseek-reasoner';
const SWARM_PROVIDER = 'deepseek';

export function registerLlmHandlers() {
  // Primary tier (Gemini)
  ipcMain.handle('chat-primary', async (_event, messages: any[]) => {
    try {
      if (!geminiClient) {
        throw new Error('GEMINI_API_KEY not configured');
      }

      const model = geminiClient.getGenerativeModel({ model: PRIMARY_MODEL });
      
      // Convert messages to Gemini format
      const contents = messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));

      const result = await model.generateContent({ contents });
      const response = result.response;
      const text = response.text();

      return {
        content: text,
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
      if (!deepseekClient) {
        throw new Error('DEEPSEEK_API_KEY not configured');
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
      if (!deepseekClient) {
        throw new Error('DEEPSEEK_API_KEY not configured');
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
      if (!openaiClient) {
        throw new Error('OPENAI_API_KEY not configured');
      }

      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-5-mini-2025-08-07',
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
