/**
 * Dynamic Tool Selection for Context-Aware Tool Loading
 * Reduces token count by providing only relevant tools based on user message
 */

import { FunctionDeclaration } from '@google/generative-ai';
import {
  FILE_TOOLS,
  PYTHON_TOOLS,
  GIT_TOOLS,
  CLAUDE_TOOLS,
  AGENT_TOOLS,
  QUANT_TOOLS,
  DATA_TOOLS,
  RESPONSE_TOOLS,
  VALIDATION_TOOLS,
  ANALYSIS_TOOLS,
  BACKTEST_TOOLS,
  MAINTENANCE_TOOLS
} from './toolDefinitions';

const respond_directly = RESPONSE_TOOLS[0]; // Always include respond_directly

export type TaskContext = 'code' | 'data' | 'git' | 'analysis' | 'general';

/**
 * Detect task context from user message
 * Uses pattern matching to identify the type of work needed
 */
export function detectTaskContext(userMessage: string): TaskContext {
  const lower = userMessage.toLowerCase();

  // Git operations
  if (lower.match(/\b(commit|push|pull|branch|merge|git)\b/)) {
    return 'git';
  }

  // Code operations
  if (lower.match(/\b(create|write|implement|code|function|class|module)\b/)) {
    return 'code';
  }

  // Data analysis
  if (lower.match(/\b(backtest|regime|strategy|analyze|data|performance)\b/)) {
    return 'data';
  }

  // Quantitative analysis
  if (lower.match(/\b(sharpe|drawdown|correlation|volatility|greeks|options)\b/)) {
    return 'analysis';
  }

  return 'general';
}

/**
 * Select appropriate tools based on detected context
 * Returns a subset of tools (10-20) instead of all 44
 */
export function selectTools(context: TaskContext): FunctionDeclaration[] {
  const core = [respond_directly];

  switch (context) {
    case 'code':
      // Code creation/modification (19 tools)
      return [...core, ...FILE_TOOLS, ...PYTHON_TOOLS, ...GIT_TOOLS, ...CLAUDE_TOOLS];

    case 'git':
      // Git operations (15 tools)
      return [...core, ...FILE_TOOLS, ...GIT_TOOLS, ...CLAUDE_TOOLS];

    case 'data':
      // Data & backtesting (18 tools)
      return [...core, ...FILE_TOOLS, ...PYTHON_TOOLS, ...QUANT_TOOLS];

    case 'analysis':
      // Analysis & metrics (16 tools)
      return [...core, ...FILE_TOOLS, ...QUANT_TOOLS, ...DATA_TOOLS];

    case 'general':
    default:
      // All tools for ambiguous cases (44 tools)
      return [
        ...core,
        ...FILE_TOOLS,
        ...PYTHON_TOOLS,
        ...GIT_TOOLS,
        ...CLAUDE_TOOLS,
        ...AGENT_TOOLS,
        ...QUANT_TOOLS,
        ...DATA_TOOLS,
        ...VALIDATION_TOOLS,
        ...ANALYSIS_TOOLS,
        ...BACKTEST_TOOLS,
        ...MAINTENANCE_TOOLS
      ];
  }
}
