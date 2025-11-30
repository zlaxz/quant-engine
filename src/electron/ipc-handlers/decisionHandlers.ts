/**
 * IPC handlers for decision logging and override
 */

import { ipcMain } from 'electron';
import { getDecisionLogger } from '../utils/decisionLogger';

export function registerDecisionHandlers(): void {
  // Get recent decisions
  ipcMain.handle('decision:get-recent', async (_event, limit?: number) => {
    const logger = getDecisionLogger();
    return logger.getRecentDecisions(limit);
  });

  // Get session decisions
  ipcMain.handle('decision:get-session', async (_event, sessionId: string) => {
    const logger = getDecisionLogger();
    return logger.getSessionDecisions(sessionId);
  });

  // Log override
  ipcMain.handle('decision:override', async (_event, decisionId: string, overriddenTo: string) => {
    const logger = getDecisionLogger();
    logger.logOverride(decisionId, overriddenTo);
    return { success: true };
  });

  // Get override rate
  ipcMain.handle('decision:get-override-rate', async () => {
    const logger = getDecisionLogger();
    return logger.getOverrideRate();
  });

  // Get success rate by choice
  ipcMain.handle('decision:get-success-rate', async (_event, choice: string) => {
    const logger = getDecisionLogger();
    return logger.getSuccessRate(choice as any);
  });

  // Get stats
  ipcMain.handle('decision:get-stats', async () => {
    const logger = getDecisionLogger();
    return {
      overrideRate: logger.getOverrideRate(),
      claudeCodeSuccess: logger.getSuccessRate('claude-code'),
      geminiDirectSuccess: logger.getSuccessRate('gemini-direct'),
      deepseekSwarmSuccess: logger.getSuccessRate('deepseek-swarm'),
      claudeCodeConfidence: logger.getAverageConfidence('claude-code'),
      geminiDirectConfidence: logger.getAverageConfidence('gemini-direct'),
      deepseekSwarmConfidence: logger.getAverageConfidence('deepseek-swarm'),
    };
  });
}
