/**
 * Context Management IPC Handlers
 *
 * Exposes context management functions to the renderer process.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { SupabaseClient } from '@supabase/supabase-js';
import { getContextManager, getProtectedCanonLoader } from '../context';

/**
 * Register all context management IPC handlers
 * @param supabase - Supabase client instance from main.ts
 */
export function registerContextHandlers(supabase: SupabaseClient): void {
  // Get protected canon (LESSONS_LEARNED, critical rules)
  ipcMain.handle(
    'context-get-protected-canon',
    async (_event: IpcMainInvokeEvent, workspaceId: string) => {
      try {
        const loader = getProtectedCanonLoader(supabase);
        const canon = await loader.loadProtectedCanon(workspaceId);
        return {
          success: true,
          canon: {
            formattedContent: canon.formattedContent,
            tokenEstimate: canon.tokenEstimate,
            lessonCount: canon.lessons.length,
            ruleCount: canon.rules.length,
          },
        };
      } catch (error) {
        console.error('[contextHandlers] Failed to load protected canon:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Get context budget status
  ipcMain.handle(
    'context-get-budget-status',
    async (
      _event: IpcMainInvokeEvent,
      tier0Content: string,
      tier1Content: string,
      tier2Content: string,
      messages: Array<{ role: string; content: string }>
    ) => {
      try {
        const manager = getContextManager();
        const status = manager.calculateBudgetStatus(
          tier0Content,
          tier1Content,
          tier2Content,
          messages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }))
        );
        return { success: true, status };
      } catch (error) {
        console.error('[contextHandlers] Failed to calculate budget:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Build LLM messages with context management
  ipcMain.handle(
    'context-build-llm-messages',
    async (
      _event: IpcMainInvokeEvent,
      params: {
        baseSystemPrompt: string;
        workspaceId: string;
        workingMemory: string;
        retrievedMemories: string;
        conversationHistory: Array<{ role: string; content: string }>;
        newUserMessage: string;
      }
    ) => {
      try {
        const manager = getContextManager();
        const canonLoader = getProtectedCanonLoader(supabase);

        // Load protected canon
        const canon = await canonLoader.loadProtectedCanon(params.workspaceId);

        // Build messages with context management
        const result = await manager.buildLLMMessages(
          params.baseSystemPrompt,
          canon.formattedContent,
          params.workingMemory,
          params.retrievedMemories,
          params.conversationHistory.map(m => ({
            role: m.role as 'system' | 'user' | 'assistant',
            content: m.content,
          })),
          params.newUserMessage
        );

        return {
          success: true,
          messages: result.messages,
          status: result.status,
          canonIncluded: canon.lessons.length + canon.rules.length > 0,
        };
      } catch (error) {
        console.error('[contextHandlers] Failed to build LLM messages:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Clear canon cache (call after adding new lessons)
  ipcMain.handle(
    'context-clear-canon-cache',
    async (_event: IpcMainInvokeEvent, workspaceId?: string) => {
      try {
        const loader = getProtectedCanonLoader(supabase);
        loader.clearCache(workspaceId);
        return { success: true };
      } catch (error) {
        console.error('[contextHandlers] Failed to clear cache:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  console.log('[contextHandlers] Context management handlers registered');
}
