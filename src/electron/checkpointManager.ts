/**
 * Checkpoint Manager - Phase 6: Working Memory Checkpoints
 * Auto-saves execution state every 30s to prevent context loss
 */

import Store from 'electron-store';

export interface CheckpointState {
  id: string;
  sessionId: string;
  workspaceId: string;
  task: string;
  progress: number; // 0-100
  status: 'active' | 'completed' | 'abandoned' | 'interrupted';
  completedSteps: string[];
  nextSteps: string[];
  filesModified: Array<{
    path: string;
    linesAdded: number;
    linesRemoved: number;
    status: 'created' | 'modified' | 'deleted';
  }>;
  executionContext: {
    mode: 'claude-code' | 'gemini-direct' | 'deepseek-swarm';
    startedAt: number;
    lastCheckpointAt: number;
    estimatedTimeRemaining?: number;
  };
  metadata?: {
    confidence?: number;
    riskLevel?: 'low' | 'medium' | 'high';
    tags?: string[];
  };
}

interface CheckpointStore {
  activeCheckpoints: Record<string, CheckpointState>;
  recentCheckpoints: CheckpointState[];
}

class CheckpointManager {
  private store: Store<CheckpointStore>;
  private checkpointInterval: NodeJS.Timeout | null = null;
  private activeCheckpointId: string | null = null;

  constructor() {
    this.store = new Store<CheckpointStore>({
      name: 'checkpoints',
      defaults: {
        activeCheckpoints: {},
        recentCheckpoints: [],
      },
    });
  }

  /**
   * Start a new checkpoint session
   */
  startCheckpoint(checkpoint: Omit<CheckpointState, 'id' | 'executionContext'>): string {
    const id = `checkpoint-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    const newCheckpoint: CheckpointState = {
      ...checkpoint,
      id,
      status: 'active',
      executionContext: {
        mode: 'claude-code',
        startedAt: now,
        lastCheckpointAt: now,
      },
    };

    const checkpoints = this.store.get('activeCheckpoints', {});
    checkpoints[id] = newCheckpoint;
    this.store.set('activeCheckpoints', checkpoints);

    this.activeCheckpointId = id;
    this.startAutoCheckpoint();

    console.log(`[Checkpoint] Started: ${id} for task: ${checkpoint.task.slice(0, 50)}...`);
    return id;
  }

  /**
   * Update checkpoint state (called automatically every 30s and on demand)
   */
  updateCheckpoint(
    id: string,
    updates: Partial<Omit<CheckpointState, 'id' | 'sessionId' | 'workspaceId'>>
  ): void {
    const checkpoints = this.store.get('activeCheckpoints', {});
    const existing = checkpoints[id];

    if (!existing) {
      console.warn(`[Checkpoint] Cannot update non-existent checkpoint: ${id}`);
      return;
    }

    const updated: CheckpointState = {
      ...existing,
      ...updates,
      executionContext: {
        ...existing.executionContext,
        lastCheckpointAt: Date.now(),
      },
    };

    checkpoints[id] = updated;
    this.store.set('activeCheckpoints', checkpoints);

    console.log(`[Checkpoint] Updated: ${id} (${updated.progress}% complete)`);
  }

  /**
   * Complete a checkpoint (success)
   */
  completeCheckpoint(id: string): void {
    this.updateCheckpoint(id, { status: 'completed', progress: 100 });
    this.moveToRecent(id);
    this.stopAutoCheckpoint();
  }

  /**
   * Abandon a checkpoint (user choice)
   */
  abandonCheckpoint(id: string): void {
    this.updateCheckpoint(id, { status: 'abandoned' });
    this.moveToRecent(id);
    this.stopAutoCheckpoint();
  }

  /**
   * Mark checkpoint as interrupted (app closed unexpectedly)
   */
  markInterrupted(id: string): void {
    this.updateCheckpoint(id, { status: 'interrupted' });
    // Don't move to recent yet - keep in active for resume on restart
  }

  /**
   * Get all active checkpoints (for resume dialog)
   */
  getActiveCheckpoints(): CheckpointState[] {
    const checkpoints = this.store.get('activeCheckpoints', {});
    return Object.values(checkpoints).filter(cp => cp.status === 'active' || cp.status === 'interrupted');
  }

  /**
   * Get a specific checkpoint
   */
  getCheckpoint(id: string): CheckpointState | null {
    const checkpoints = this.store.get('activeCheckpoints', {});
    return checkpoints[id] || null;
  }

  /**
   * Get recent checkpoints (last 10)
   */
  getRecentCheckpoints(): CheckpointState[] {
    return this.store.get('recentCheckpoints', []).slice(0, 10);
  }

  /**
   * Delete a checkpoint
   */
  deleteCheckpoint(id: string): void {
    const checkpoints = this.store.get('activeCheckpoints', {});
    delete checkpoints[id];
    this.store.set('activeCheckpoints', checkpoints);
    console.log(`[Checkpoint] Deleted: ${id}`);
  }

  /**
   * Clear all checkpoints (use with caution)
   */
  clearAll(): void {
    this.store.set('activeCheckpoints', {});
    this.store.set('recentCheckpoints', []);
    this.stopAutoCheckpoint();
    console.log('[Checkpoint] All checkpoints cleared');
  }

  /**
   * Start auto-checkpoint timer (every 30s)
   */
  private startAutoCheckpoint(): void {
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
    }

    this.checkpointInterval = setInterval(() => {
      if (this.activeCheckpointId) {
        const checkpoint = this.getCheckpoint(this.activeCheckpointId);
        if (checkpoint && checkpoint.status === 'active') {
          this.updateCheckpoint(this.activeCheckpointId, {
            executionContext: {
              ...checkpoint.executionContext,
              lastCheckpointAt: Date.now(),
            },
          });
        }
      }
    }, 30000); // 30 seconds

    console.log('[Checkpoint] Auto-checkpoint started (30s interval)');
  }

  /**
   * Stop auto-checkpoint timer
   */
  private stopAutoCheckpoint(): void {
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
      this.checkpointInterval = null;
      this.activeCheckpointId = null;
      console.log('[Checkpoint] Auto-checkpoint stopped');
    }
  }

  /**
   * Move checkpoint from active to recent
   */
  private moveToRecent(id: string): void {
    const checkpoints = this.store.get('activeCheckpoints', {});
    const checkpoint = checkpoints[id];

    if (checkpoint) {
      delete checkpoints[id];
      this.store.set('activeCheckpoints', checkpoints);

      const recent = this.store.get('recentCheckpoints', []);
      recent.unshift(checkpoint);
      
      // Keep only last 50 recent checkpoints
      if (recent.length > 50) {
        recent.length = 50;
      }

      this.store.set('recentCheckpoints', recent);
    }
  }

  /**
   * Mark all active checkpoints as interrupted (called on app shutdown)
   */
  markAllInterrupted(): void {
    const checkpoints = this.store.get('activeCheckpoints', {});
    Object.keys(checkpoints).forEach(id => {
      if (checkpoints[id].status === 'active') {
        checkpoints[id].status = 'interrupted';
      }
    });
    this.store.set('activeCheckpoints', checkpoints);
    this.stopAutoCheckpoint();
    console.log('[Checkpoint] All active checkpoints marked as interrupted');
  }
}

// Singleton instance
let checkpointManager: CheckpointManager | null = null;

export function getCheckpointManager(): CheckpointManager {
  if (!checkpointManager) {
    checkpointManager = new CheckpointManager();
  }
  return checkpointManager;
}
