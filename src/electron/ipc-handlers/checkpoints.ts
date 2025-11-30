/**
 * IPC Handlers for Checkpoint Management - Phase 6
 */

import { ipcMain, app } from 'electron';
import { getCheckpointManager, CheckpointState } from '../checkpointManager';

export function setupCheckpointHandlers() {
  const checkpointManager = getCheckpointManager();

  // Start a new checkpoint
  ipcMain.handle('checkpoint:start', async (_event, checkpoint: Omit<CheckpointState, 'id' | 'executionContext'>) => {
    try {
      const id = checkpointManager.startCheckpoint(checkpoint);
      return { success: true, checkpointId: id };
    } catch (error) {
      console.error('[IPC] checkpoint:start error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Update a checkpoint
  ipcMain.handle('checkpoint:update', async (_event, { id, updates }: { 
    id: string; 
    updates: Partial<Omit<CheckpointState, 'id' | 'sessionId' | 'workspaceId'>>
  }) => {
    try {
      checkpointManager.updateCheckpoint(id, updates);
      return { success: true };
    } catch (error) {
      console.error('[IPC] checkpoint:update error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Complete a checkpoint
  ipcMain.handle('checkpoint:complete', async (_event, id: string) => {
    try {
      checkpointManager.completeCheckpoint(id);
      return { success: true };
    } catch (error) {
      console.error('[IPC] checkpoint:complete error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Abandon a checkpoint
  ipcMain.handle('checkpoint:abandon', async (_event, id: string) => {
    try {
      checkpointManager.abandonCheckpoint(id);
      return { success: true };
    } catch (error) {
      console.error('[IPC] checkpoint:abandon error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get active checkpoints (for resume dialog)
  ipcMain.handle('checkpoint:get-active', async () => {
    try {
      const checkpoints = checkpointManager.getActiveCheckpoints();
      return { success: true, checkpoints };
    } catch (error) {
      console.error('[IPC] checkpoint:get-active error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error', checkpoints: [] };
    }
  });

  // Get a specific checkpoint
  ipcMain.handle('checkpoint:get', async (_event, id: string) => {
    try {
      const checkpoint = checkpointManager.getCheckpoint(id);
      return { success: true, checkpoint };
    } catch (error) {
      console.error('[IPC] checkpoint:get error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get recent checkpoints
  ipcMain.handle('checkpoint:get-recent', async () => {
    try {
      const checkpoints = checkpointManager.getRecentCheckpoints();
      return { success: true, checkpoints };
    } catch (error) {
      console.error('[IPC] checkpoint:get-recent error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error', checkpoints: [] };
    }
  });

  // Delete a checkpoint
  ipcMain.handle('checkpoint:delete', async (_event, id: string) => {
    try {
      checkpointManager.deleteCheckpoint(id);
      return { success: true };
    } catch (error) {
      console.error('[IPC] checkpoint:delete error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Clear all checkpoints
  ipcMain.handle('checkpoint:clear-all', async () => {
    try {
      checkpointManager.clearAll();
      return { success: true };
    } catch (error) {
      console.error('[IPC] checkpoint:clear-all error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // App shutdown handler - mark all active checkpoints as interrupted
  app.on('before-quit', () => {
    checkpointManager.markAllInterrupted();
  });

  console.log('[IPC] Checkpoint handlers registered');
}
