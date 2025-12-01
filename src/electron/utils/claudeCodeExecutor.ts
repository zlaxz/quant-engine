/**
 * Claude Code Executor - Manages execution lifecycle with phase tracking
 * Emits IPC events for progress visibility in UI
 */

import { BrowserWindow } from 'electron';
import { ClaudeCodePhase } from '../../components/research/ClaudeCodeProgressPanel';

// Note: ChildProcess and spawn imports commented out - will be needed for production Claude Code CLI integration
// import { spawn, ChildProcess } from 'child_process';

export interface ClaudeCodeExecutionConfig {
  task: string;
  context?: string;
  files?: string[];
  timeout?: number;
}

export interface ClaudeCodeResult {
  success: boolean;
  output?: string;
  files?: Array<{ path: string; content: string }>;
  tests?: { passed: number; failed: number; output?: string };
  error?: string;
  duration: number;
}

class ClaudeCodeExecutor {
  // Note: currentProcess will be used when Claude Code CLI integration is implemented
  // private currentProcess: ChildProcess | null = null;
  private startTime: number = 0;
  private cancelled: boolean = false;

  /**
   * Execute task with Claude Code, emitting lifecycle events
   */
  async execute(config: ClaudeCodeExecutionConfig): Promise<ClaudeCodeResult> {
    this.startTime = Date.now();
    this.cancelled = false;

    try {
      // Phase 1: Analyzing
      this.emitProgress('analyzing', 10, config.task);
      await this.delay(500); // Simulate analysis phase
      
      if (this.cancelled) throw new Error('Execution cancelled by user');

      // Phase 2: Generating
      this.emitProgress('generating', 40, config.task);
      const result = await this.executeClaudeCode(config);
      
      if (this.cancelled) throw new Error('Execution cancelled by user');

      // Phase 3: Testing
      this.emitProgress('testing', 70, config.task);
      await this.delay(500); // Simulate test phase
      
      if (this.cancelled) throw new Error('Execution cancelled by user');

      // Phase 4: Finalizing
      this.emitProgress('finalizing', 100, config.task); // Fix: Show 100% before complete
      await this.delay(100); // Brief pause to show 100%

      // Complete
      this.emitComplete(config.task, result);

      return {
        ...result,
        duration: Date.now() - this.startTime
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.emitError(config.task, errorMsg);
      
      return {
        success: false,
        error: errorMsg,
        duration: Date.now() - this.startTime
      };
    }
    // Note: finally block removed - currentProcess cleanup will be needed when CLI is integrated
  }

  /**
   * Cancel current execution
   */
  cancel(): void {
    this.cancelled = true;
    // Note: When Claude Code CLI is integrated, this will kill the process:
    // if (this.currentProcess) {
    //   this.currentProcess.kill('SIGTERM');
    //   this.currentProcess = null;
    // }
  }

  /**
   * Execute Claude Code CLI (REAL implementation using toolHandlers)
   * Delegates to the actual executeViaClaudeCode from toolHandlers.ts
   */
  private async executeClaudeCode(config: ClaudeCodeExecutionConfig): Promise<Omit<ClaudeCodeResult, 'duration'>> {
    // Import the real implementation
    const { executeViaClaudeCode } = await import('../tools/toolHandlers');

    // Call REAL Claude Code CLI execution
    const result = await executeViaClaudeCode(
      config.task,
      config.context,
      'none' // Default to no parallelization unless specified
    );

    if (!result.success) {
      throw new Error(result.error || 'Claude Code execution failed');
    }

    // Parse structured JSON response
    try {
      const parsed = JSON.parse(result.content);
      return {
        success: true,
        output: parsed.stdout || result.content,
        files: [], // TODO: Extract file information from output
        tests: undefined // TODO: Parse test results if present
      };
    } catch {
      // If not JSON, return raw output
      return {
        success: true,
        output: result.content,
        files: [],
        tests: undefined
      };
    }
  }

  /**
   * Spawn Claude Code process (production implementation - currently unused)
   * This will be used when Claude Code CLI integration is implemented
   * @unused - Keeping for future production integration
   */
  /*
  private async spawnClaudeCode(config: ClaudeCodeExecutionConfig): Promise<Omit<ClaudeCodeResult, 'duration'>> {
    return new Promise((resolve, reject) => {
      const args = ['code', config.task];
      if (config.context) args.push('--context', config.context);
      if (config.files?.length) args.push('--files', ...config.files);

      this.currentProcess = spawn('claude', args, {
        timeout: config.timeout || 300000, // 5 min default
      });

      let stdout = '';
      let stderr = '';

      this.currentProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      this.currentProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      this.currentProcess.on('error', (error) => {
        reject(new Error(`Failed to spawn Claude Code: ${error.message}`));
      });

      this.currentProcess.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            output: stdout,
            files: this.parseOutputFiles(stdout)
          });
        } else {
          reject(new Error(`Claude Code exited with code ${code}: ${stderr}`));
        }
      });
    });
  }
  */

  /**
   * Parse generated files from Claude Code output (currently unused - for future integration)
   * @unused - Will be used when spawnClaudeCode is implemented
   */
  /*
  private parseOutputFiles(output: string): Array<{ path: string; content: string }> {
    // Parse Claude Code output format
    // This is a placeholder - actual parsing depends on Claude Code output format
    const files: Array<{ path: string; content: string }> = [];
    
    // Example parsing logic (adjust based on actual format)
    const filePattern = /FILE: (.+?)\n([\s\S]+?)(?=FILE:|$)/g;
    let match;
    while ((match = filePattern.exec(output)) !== null) {
      files.push({
        path: match[1].trim(),
        content: match[2].trim()
      });
    }
    
    return files;
  }
  */

  /**
   * Emit progress event to renderer
   */
  private emitProgress(phase: ClaudeCodePhase, progress: number, task: string): void {
    const windows = BrowserWindow.getAllWindows();
    const mainWindow = windows.find(w => !w.isDestroyed());
    if (mainWindow?.webContents) {
      try {
        mainWindow.webContents.send('claude-code-event', {
          type: 'progress',
          data: {
            task,
            phase,
            progress,
            startTime: this.startTime,
            estimatedRemaining: this.estimateRemaining(progress)
          }
        });
      } catch (error) {
        console.error('Failed to send progress event:', error);
      }
    }
  }

  /**
   * Emit completion event
   */
  private emitComplete(_task: string, result: Omit<ClaudeCodeResult, 'duration'>): void {
    const windows = BrowserWindow.getAllWindows();
    const mainWindow = windows.find(w => !w.isDestroyed());
    if (mainWindow?.webContents) {
      try {
        mainWindow.webContents.send('claude-code-event', {
          type: 'complete',
          data: {
            task: _task,
            result,
            duration: Date.now() - this.startTime
          }
        });
      } catch (error) {
        console.error('Failed to send complete event:', error);
      }
    }
  }

  /**
   * Emit error event
   */
  private emitError(_task: string, error: string): void {
    const windows = BrowserWindow.getAllWindows();
    const mainWindow = windows.find(w => !w.isDestroyed());
    if (mainWindow?.webContents) {
      try {
        mainWindow.webContents.send('claude-code-event', {
          type: 'error',
          data: {
            type: 'runtime' as const,
            message: error,
            suggestion: 'Review error details and retry with adjusted parameters'
          }
        });
      } catch (error) {
        console.error('Failed to send error event:', error);
      }
    }
  }

  /**
   * Estimate remaining time based on current progress
   */
  private estimateRemaining(progress: number): number {
    if (progress <= 0) return 0;
    if (progress >= 100) return 0;

    const elapsed = Date.now() - this.startTime;
    // Fix: Convert progress to decimal (0-1) not percentage (0-100)
    const progressDecimal = progress / 100;
    const estimatedTotal = elapsed / progressDecimal;
    const remaining = estimatedTotal - elapsed;

    return Math.max(0, remaining);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
let executorInstance: ClaudeCodeExecutor | null = null;

export function getClaudeCodeExecutor(): ClaudeCodeExecutor {
  if (!executorInstance) {
    executorInstance = new ClaudeCodeExecutor();
  }
  return executorInstance;
}
