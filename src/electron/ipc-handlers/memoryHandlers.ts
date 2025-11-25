/**
 * Memory IPC Handlers
 * Connects renderer process to memory daemon and recall engine
 */

import { ipcMain, BrowserWindow } from 'electron';
import { MemoryDaemon } from '../memory/MemoryDaemon';
import { RecallEngine } from '../memory/RecallEngine';
import {
  validateIPC,
  MemoryQuerySchema,
  MemoryOptionsSchema,
  WorkspaceIdSchema,
  MemoryIdsSchema,
  RunIdSchema,
  StrategyKeySchema,
  RegimeIdSchema,
  DateStringSchema,
} from '../validation/schemas';

let memoryDaemon: MemoryDaemon | null = null;
let recallEngine: RecallEngine | null = null;
let extractionListener: ((data: { count: number; sessionId: string }) => void) | null = null;
let errorListener: ((error: Error) => void) | null = null;

export function setMemoryServices(daemon: MemoryDaemon, recall: RecallEngine): void {
  memoryDaemon = daemon;
  recallEngine = recall;
}

export function registerMemoryHandlers(): void {
  // Memory recall - the KEY handler for automatic injection
  ipcMain.handle(
    'memory:recall',
    async (
      _event,
      queryRaw: unknown,
      workspaceIdRaw: unknown,
      optionsRaw?: unknown
    ) => {
      if (!recallEngine) {
        console.error('[MemoryHandlers] RecallEngine not initialized');
        return { memories: [], totalFound: 0, searchTimeMs: 0, usedCache: false, query: '' };
      }

      let query = '';
      try {
        // Validate at IPC boundary
        query = validateIPC(MemoryQuerySchema, queryRaw, 'memory query');
        const workspaceId = validateIPC(WorkspaceIdSchema, workspaceIdRaw, 'workspace ID');
        const options = optionsRaw !== undefined
          ? validateIPC(MemoryOptionsSchema, optionsRaw, 'memory options')
          : undefined;

        return await recallEngine.recall(query, workspaceId, options);
      } catch (error: any) {
        console.error('[MemoryHandlers] Recall error:', error);
        return { memories: [], totalFound: 0, searchTimeMs: 0, usedCache: false, query, error: error.message };
      }
    }
  );

  // Format memories for prompt injection
  ipcMain.handle('memory:formatForPrompt', async (_event, memories: any[]) => {
    if (!recallEngine) return '';
    return recallEngine.formatForPrompt(memories);
  });

  // Warm cache on session start
  ipcMain.handle('memory:warmCache', async (_event, workspaceIdRaw: unknown) => {
    if (!recallEngine) return { success: false, error: 'RecallEngine not initialized' };

    try {
      // Validate at IPC boundary
      const workspaceId = validateIPC(WorkspaceIdSchema, workspaceIdRaw, 'workspace ID');
      await recallEngine.warmCache(workspaceId);
      return { success: true };
    } catch (error: any) {
      console.error('[MemoryHandlers] Cache warming error:', error);
      return { success: false, error: error.message };
    }
  });

  // Daemon control
  ipcMain.handle('memory:daemon:start', async () => {
    if (!memoryDaemon) {
      return { success: false, error: 'MemoryDaemon not initialized' };
    }

    try {
      await memoryDaemon.start();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('memory:daemon:stop', async () => {
    if (!memoryDaemon) {
      return { success: false, error: 'MemoryDaemon not initialized' };
    }

    try {
      await memoryDaemon.stop();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Daemon status
  ipcMain.handle('memory:daemon:status', async () => {
    if (!memoryDaemon || !recallEngine) {
      return {
        daemonRunning: false,
        cacheSize: 0,
        totalMemories: 0,
      };
    }

    return {
      daemonRunning: true,
      cacheSize: recallEngine.getCacheSize(),
      totalMemories: memoryDaemon.getMemoryCount(),
    };
  });

  // Setup event forwarding to renderer with cleanup
  if (memoryDaemon) {
    // Remove old listeners before registering new ones to prevent leaks
    if (extractionListener) {
      memoryDaemon.off('memories-extracted', extractionListener);
    }
    if (errorListener) {
      memoryDaemon.off('error', errorListener);
    }

    // Register new listeners
    extractionListener = (data: { count: number; sessionId: string }) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        // Safe null check for BrowserWindow
        if (win && win.webContents) {
          win.webContents.send('memory:extracted', data);
        }
      });
    };

    errorListener = (error: Error) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        // Safe null check for BrowserWindow
        if (win && win.webContents) {
          win.webContents.send('memory:error', { message: error.message });
        }
      });
    };

    memoryDaemon.on('memories-extracted', extractionListener);
    memoryDaemon.on('error', errorListener);
  }

  // Analysis and warning handlers (require separate initialization)
  // These will be registered after analysis modules are initialized in main.ts
}

// Export function to register analysis handlers (called after modules initialized)
export function registerAnalysisHandlers(
  overfittingDetector: any,
  regimeTagger: any,
  warningSystem: any,
  patternDetector: any,
  staleInjector: any,
  triggerRecall: any
): void {
  // Overfitting detection
  ipcMain.handle('analysis:check-overfitting', async (_event, runIdRaw: unknown) => {
    if (!overfittingDetector) return { warnings: [] };

    try {
      // Validate at IPC boundary
      const runId = validateIPC(RunIdSchema, runIdRaw, 'run ID');
      // Fetch run data from Supabase (requires supabase instance passed to handler)
      // For now, return empty warnings - will be enhanced when we have run data
      const warnings = await overfittingDetector.analyzeRun({
        id: runId,
        workspace_id: '',
        strategy_key: '',
        params: {},
        metrics: {
          sharpe: 0,
          cagr: 0,
          max_drawdown: 0,
          total_trades: 0,
          win_rate: 0,
        },
      });
      return { warnings };
    } catch (error: any) {
      console.error('[MemoryHandlers] Overfitting check error:', error);
      return { warnings: [], error: error.message };
    }
  });

  // Get pre-backtest warnings
  ipcMain.handle(
    'analysis:get-warnings',
    async (_event, strategyRaw: unknown, regimeIdRaw: unknown, workspaceIdRaw: unknown) => {
      if (!warningSystem) return null;

      // Validate at IPC boundary
      const strategy = validateIPC(StrategyKeySchema, strategyRaw, 'strategy key');
      const regimeId = validateIPC(RegimeIdSchema, regimeIdRaw, 'regime ID');
      const workspaceId = validateIPC(WorkspaceIdSchema, workspaceIdRaw, 'workspace ID');

      return await warningSystem.getRelevantWarnings(strategy, regimeId, workspaceId);
    }
  );

  // Get stale memories for injection
  ipcMain.handle('memory:get-stale', async (_event, workspaceIdRaw: unknown) => {
    if (!staleInjector) return [];

    // Validate at IPC boundary
    const workspaceId = validateIPC(WorkspaceIdSchema, workspaceIdRaw, 'workspace ID');
    return await staleInjector.getStaleMemories(workspaceId);
  });

  // Trigger-based recall
  ipcMain.handle('memory:check-triggers', async (_event, messageRaw: unknown, workspaceIdRaw: unknown) => {
    if (!triggerRecall) return [];

    // Validate at IPC boundary
    const message = validateIPC(MemoryQuerySchema, messageRaw, 'message');
    const workspaceId = validateIPC(WorkspaceIdSchema, workspaceIdRaw, 'workspace ID');
    return await triggerRecall.checkTriggers(message, workspaceId);
  });

  // Pattern detection
  ipcMain.handle('analysis:detect-patterns', async (_event, workspaceIdRaw: unknown) => {
    if (!patternDetector) return { repeated_lessons: [], regime_patterns: [] };

    // Validate at IPC boundary
    const workspaceId = validateIPC(WorkspaceIdSchema, workspaceIdRaw, 'workspace ID');
    const [repeated, regimePatterns] = await Promise.all([
      patternDetector.detectRepeatedLessons(workspaceId),
      patternDetector.detectRegimeProfilePatterns(workspaceId),
    ]);
    return { repeated_lessons: repeated, regime_patterns: regimePatterns };
  });

  // Regime tagging for backtest runs
  ipcMain.handle(
    'analysis:tag-regime',
    async (_event, runIdRaw: unknown, startDateRaw: unknown, endDateRaw: unknown) => {
      if (!regimeTagger) return { success: false, error: 'RegimeTagger not initialized' };

      try {
        // Validate at IPC boundary
        const runId = validateIPC(RunIdSchema, runIdRaw, 'run ID');
        const startDate = validateIPC(DateStringSchema, startDateRaw, 'start date');
        const endDate = validateIPC(DateStringSchema, endDateRaw, 'end date');

        const regime = await regimeTagger.tagRun(runId, startDate, endDate);
        return { success: true, regime };
      } catch (error: any) {
        console.error('[MemoryHandlers] Regime tagging error:', error);
        return { success: false, error: error.message };
      }
    }
  );

  // Mark memories as recalled for stale injection tracking
  ipcMain.handle('memory:mark-recalled', async (_event, memoryIdsRaw: unknown) => {
    if (!staleInjector) return { success: false, error: 'StaleInjector not initialized' };

    try {
      // Validate at IPC boundary
      const memoryIds = validateIPC(MemoryIdsSchema, memoryIdsRaw, 'memory IDs');
      await staleInjector.markAsRecalled(memoryIds);
      return { success: true };
    } catch (error: any) {
      console.error('[MemoryHandlers] Mark recalled error:', error);
      return { success: false, error: error.message };
    }
  });
}
