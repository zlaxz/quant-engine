/**
 * Dynamic Tool Selection for Context-Aware Tool Loading
 *
 * CRITICAL: Google recommends 10-20 tools max for optimal function calling.
 * We had 52 tools, causing Gemini to enter "exploration mode" instead of
 * following system prompt instructions.
 *
 * This selector reduces tools to ~15 per context, drastically improving
 * instruction-following behavior.
 */

import { FunctionDeclaration } from '@google/genai';
import {
  FILE_TOOLS,
  PYTHON_TOOLS,
  GIT_TOOLS,
  CLAUDE_TOOLS,
  AGENT_TOOLS,
  QUANT_TOOLS,
  DATA_TOOLS,
  OBSIDIAN_TOOLS,
  MEMORY_TOOLS,
  BACKTEST_TOOLS,
  // RESPONSE_TOOLS removed - with AUTO mode, model can respond naturally without a tool
} from './toolDefinitions';

// Core tools that are ALWAYS available (essential CIO capabilities)
// NOTE: respond_directly REMOVED - with AUTO mode, model can just respond naturally
const CORE_TOOLS: FunctionDeclaration[] = [
  CLAUDE_TOOLS[0],    // execute_via_claude_code - delegate to CTO
  AGENT_TOOLS[0],     // spawn_agent - data queries and analysis
  ...MEMORY_TOOLS,    // save_memory, recall_memory - context
];

// Obsidian tools for knowledge base access
const KNOWLEDGE_TOOLS: FunctionDeclaration[] = [
  OBSIDIAN_TOOLS[0],  // obsidian_read_note
  OBSIDIAN_TOOLS[2],  // obsidian_search_notes
];

// Minimal quant tools
const MINIMAL_QUANT: FunctionDeclaration[] = [
  QUANT_TOOLS[0],     // get_regime_heatmap
  QUANT_TOOLS[1],     // list_strategies
];

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
  if (lower.match(/\b(create|write|implement|code|function|class|module|build|fix|refactor)\b/)) {
    return 'code';
  }

  // Data/backtest operations
  if (lower.match(/\b(backtest|regime|strategy|analyze|data|performance|sharpe|drawdown)\b/)) {
    return 'data';
  }

  // Options/quantitative analysis
  if (lower.match(/\b(volatility|greeks|options|vix|iv|delta|gamma|theta|vega)\b/)) {
    return 'analysis';
  }

  return 'general';
}

/**
 * Select appropriate tools based on detected context
 *
 * IMPORTANT: Each context should return 10-20 tools MAX (Google recommendation)
 * More tools = worse instruction following = exploration behavior
 */
export function selectTools(context: TaskContext): FunctionDeclaration[] {
  switch (context) {
    case 'code':
      // Code creation/modification (~12 tools)
      // CIO delegates code work to Claude Code (CTO)
      return [
        ...CORE_TOOLS,          // 4 tools
        ...KNOWLEDGE_TOOLS,     // 2 tools
        ...FILE_TOOLS,          // 3 tools (read_file, list_directory, search_code)
        GIT_TOOLS[0],           // git_status only
      ];

    case 'git':
      // Git operations (~12 tools)
      return [
        ...CORE_TOOLS,          // 4 tools
        ...FILE_TOOLS,          // 3 tools
        ...GIT_TOOLS.slice(0, 5), // git_status, git_diff, git_log, git_add, git_commit
      ];

    case 'data':
      // Data & backtesting (~14 tools)
      return [
        ...CORE_TOOLS,          // 4 tools
        ...KNOWLEDGE_TOOLS,     // 2 tools
        ...QUANT_TOOLS,         // 6 tools
        ...DATA_TOOLS.slice(0, 2), // inspect_market_data, data_quality_check
      ];

    case 'analysis':
      // Quantitative analysis (~14 tools)
      return [
        ...CORE_TOOLS,          // 4 tools
        ...KNOWLEDGE_TOOLS,     // 2 tools
        ...QUANT_TOOLS,         // 6 tools
        BACKTEST_TOOLS[0],      // batch_backtest
        BACKTEST_TOOLS[2],      // cross_validate
      ];

    case 'general':
    default:
      // Default: CIO essentials only (~12 tools)
      // NO exploration tools, NO scaffolding tools
      // CIO knows the project structure - doesn't need to explore
      return [
        ...CORE_TOOLS,          // 4 tools (respond, claude_code, agent, memory x2)
        ...KNOWLEDGE_TOOLS,     // 2 tools (obsidian read/search)
        ...MINIMAL_QUANT,       // 2 tools (regime, strategies)
        FILE_TOOLS[0],          // read_file only (NO list_directory!)
        FILE_TOOLS[2],          // search_code
        PYTHON_TOOLS[0],        // run_python_script
      ];
  }
}
