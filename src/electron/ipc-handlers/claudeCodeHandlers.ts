/**
 * IPC handlers for Claude Code execution with lifecycle tracking
 */

import { ipcMain } from 'electron';
import { getClaudeCodeExecutor, ClaudeCodeExecutionConfig } from '../utils/claudeCodeExecutor';

export function registerClaudeCodeHandlers(): void {
  // Execute task via Claude Code
  ipcMain.handle('claude-code:execute', async (_event, config: ClaudeCodeExecutionConfig) => {
    const executor = getClaudeCodeExecutor();
    return await executor.execute(config);
  });

  // Cancel current execution
  ipcMain.handle('claude-code:cancel', async () => {
    const executor = getClaudeCodeExecutor();
    executor.cancel();
    return { success: true, message: 'Execution cancelled' };
  });

  // Check if Claude Code is available
  ipcMain.handle('claude-code:check-availability', async () => {
    // In production, check if Claude Code CLI is installed
    // For now, return mock availability
    return { 
      available: false, // Set to false since not yet integrated
      version: null,
      message: 'Claude Code integration not yet implemented. Routing will use Gemini direct handling.'
    };
  });
}
