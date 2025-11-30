/**
 * Type definitions for Claude Code integration
 */

import { ClaudeCodePhase, ClaudeCodeProgressData } from '../components/research/ClaudeCodeProgressPanel';
import { ClaudeCodeError } from '../components/research/ClaudeCodeErrorCard';

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

export interface ClaudeCodeLifecycleEvent {
  type: 'start' | 'progress' | 'complete' | 'error' | 'cancelled';
  data: ClaudeCodeProgressData | ClaudeCodeResult | ClaudeCodeError | { message: string };
}

export type { ClaudeCodePhase, ClaudeCodeProgressData, ClaudeCodeError };
