/**
 * Routing Decision Engine - Determines which execution path to use
 * Analyzes task characteristics and decides: Claude Code vs Direct Handling vs Swarm
 */

export interface TaskAnalysis {
  complexity: 'low' | 'medium' | 'high';
  requiresCodeExecution: boolean;
  requiresFileIO: boolean;
  requiresMultiAgent: boolean;
  estimatedDuration: 'short' | 'medium' | 'long';
  taskType: 'analysis' | 'generation' | 'execution' | 'search' | 'chat';
}

export interface RoutingRecommendation {
  chosen: 'claude-code' | 'gemini-direct' | 'deepseek-swarm';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  alternativeConsidered?: string;
  reasoning: string;
}

/**
 * Analyze task characteristics from user message
 */
export function analyzeTask(message: string): TaskAnalysis {
  const lowerMsg = message.toLowerCase();

  // Detect task type
  let taskType: TaskAnalysis['taskType'] = 'chat';
  if (lowerMsg.includes('/backtest') || lowerMsg.includes('/audit') || lowerMsg.includes('/compare')) {
    taskType = 'analysis';
  } else if (lowerMsg.includes('write') || lowerMsg.includes('create') || lowerMsg.includes('generate')) {
    taskType = 'generation';
  } else if (lowerMsg.includes('run') || lowerMsg.includes('execute') || lowerMsg.includes('test')) {
    taskType = 'execution';
  } else if (lowerMsg.includes('search') || lowerMsg.includes('find') || lowerMsg.includes('look for')) {
    taskType = 'search';
  }

  // Detect complexity
  const hasMultipleSteps = (lowerMsg.match(/and|then|also|additionally/g) || []).length >= 2;
  const hasCodeKeywords = /python|code|script|function|class|def |import /i.test(message);
  const hasFileKeywords = /file|directory|folder|path|src\/|\.py|\.ts/i.test(message);
  
  let complexity: TaskAnalysis['complexity'] = 'low';
  if (hasMultipleSteps || (hasCodeKeywords && hasFileKeywords)) {
    complexity = 'high';
  } else if (hasCodeKeywords || hasFileKeywords) {
    complexity = 'medium';
  }

  // Detect requirements
  const requiresCodeExecution = /run|execute|backtest|test|benchmark/i.test(message);
  const requiresFileIO = /write|create file|read file|modify|edit|delete/i.test(message);
  const requiresMultiAgent = /compare|analyze multiple|all strategies|pattern/i.test(message);

  // Estimate duration
  let estimatedDuration: TaskAnalysis['estimatedDuration'] = 'short';
  if (complexity === 'high' || requiresMultiAgent) {
    estimatedDuration = 'long';
  } else if (complexity === 'medium' || requiresCodeExecution) {
    estimatedDuration = 'medium';
  }

  return {
    complexity,
    requiresCodeExecution,
    requiresFileIO,
    requiresMultiAgent,
    estimatedDuration,
    taskType,
  };
}

/**
 * Make routing decision based on task analysis
 */
export function makeRoutingDecision(analysis: TaskAnalysis, message: string): RoutingRecommendation {
  // Rule 1: Multi-agent tasks → DeepSeek Swarm
  if (analysis.requiresMultiAgent && analysis.complexity === 'high') {
    return {
      chosen: 'deepseek-swarm',
      confidence: 'HIGH',
      alternativeConsidered: 'Direct Handling',
      reasoning: 'Complex multi-agent task benefits from parallel swarm execution for comprehensive analysis',
    };
  }

  // Rule 2: Code execution + file I/O → Claude Code (would be, but not implemented yet)
  // For now, route to direct handling
  if (analysis.requiresCodeExecution && analysis.requiresFileIO && analysis.complexity === 'high') {
    return {
      chosen: 'gemini-direct',
      confidence: 'MEDIUM',
      alternativeConsidered: 'Claude Code',
      reasoning: 'Task requires code execution + file I/O. Would use Claude Code but routing to direct handling (Claude Code not yet integrated)',
    };
  }

  // Rule 3: Simple file operations → Direct Handling
  if (analysis.requiresFileIO && analysis.complexity === 'low') {
    return {
      chosen: 'gemini-direct',
      confidence: 'HIGH',
      reasoning: 'Simple file operation can be handled directly with existing tools',
    };
  }

  // Rule 4: Analysis without code changes → Direct Handling
  if (analysis.taskType === 'analysis' && !analysis.requiresFileIO) {
    return {
      chosen: 'gemini-direct',
      confidence: 'HIGH',
      reasoning: 'Read-only analysis task - direct handling is fastest and most cost-effective',
    };
  }

  // Rule 5: Pattern mining across runs → Swarm
  if (message.toLowerCase().includes('pattern') || message.toLowerCase().includes('/mine')) {
    return {
      chosen: 'deepseek-swarm',
      confidence: 'HIGH',
      alternativeConsidered: 'Direct Handling',
      reasoning: 'Pattern detection benefits from multiple agent perspectives for comprehensive coverage',
    };
  }

  // Default: Direct Handling
  return {
    chosen: 'gemini-direct',
    confidence: 'MEDIUM',
    reasoning: 'Standard task suitable for direct handling with primary model',
  };
}

/**
 * Convenience function: analyze + decide in one call
 */
export function routeTask(message: string): RoutingRecommendation {
  const analysis = analyzeTask(message);
  return makeRoutingDecision(analysis, message);
}
