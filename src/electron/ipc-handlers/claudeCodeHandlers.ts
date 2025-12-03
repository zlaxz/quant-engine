/**
 * IPC handlers for Claude Code execution with lifecycle tracking
 * Includes approval flow for command review before execution
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getClaudeCodeExecutor, ClaudeCodeExecutionConfig } from '../utils/claudeCodeExecutor';

// Pending commands awaiting user approval
interface PendingCommand {
  id: string;
  config: ClaudeCodeExecutionConfig;
  parallelHint?: string;
  timestamp: number;
  resolve: (approved: boolean) => void;
}

const pendingCommands = new Map<string, PendingCommand>();

/**
 * Queue a command for user approval before execution
 */
export function queueCommandForApproval(
  config: ClaudeCodeExecutionConfig,
  parallelHint?: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const commandId = `cc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const pending: PendingCommand = {
      id: commandId,
      config,
      parallelHint,
      timestamp: Date.now(),
      resolve,
    };
    
    pendingCommands.set(commandId, pending);
    
    // Emit to renderer for UI display
    const windows = BrowserWindow.getAllWindows();
    const mainWindow = windows.find(w => !w.isDestroyed());
    if (mainWindow?.webContents) {
      mainWindow.webContents.send('claude-code-pending', {
        id: commandId,
        task: config.task,
        context: config.context,
        files: config.files,
        parallelHint,
        timestamp: Date.now(),
      });
    }
    
    // Timeout: auto-reject after 5 minutes
    setTimeout(() => {
      if (pendingCommands.has(commandId)) {
        pendingCommands.delete(commandId);
        resolve(false);
      }
    }, 5 * 60 * 1000);
  });
}

export function registerClaudeCodeHandlers(): void {
  // Execute task via Claude Code (direct execution, no approval)
  ipcMain.handle('claude-code:execute', async (_event, config: ClaudeCodeExecutionConfig) => {
    const executor = getClaudeCodeExecutor();
    return await executor.execute(config);
  });

  // Approve a pending command
  ipcMain.handle('claude-code:approve', async (_event, commandId: string) => {
    const pending = pendingCommands.get(commandId);
    if (!pending) {
      return { success: false, error: 'Command not found or expired' };
    }
    
    pendingCommands.delete(commandId);
    pending.resolve(true);
    
    return { success: true, message: 'Command approved' };
  });

  // Reject a pending command
  ipcMain.handle('claude-code:reject', async (_event, commandId: string) => {
    const pending = pendingCommands.get(commandId);
    if (!pending) {
      return { success: false, error: 'Command not found or expired' };
    }
    
    pendingCommands.delete(commandId);
    pending.resolve(false);
    
    return { success: true, message: 'Command rejected' };
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
