/**
 * CIO Prompt Assembler
 *
 * The main orchestrator that assembles the complete CIO prompt at runtime.
 * This is the entry point used by llmClient.ts.
 *
 * Assembly Order:
 * 1. Identity Core (fixed personality, beliefs, voice)
 * 2. Mode Directives (behavior for current mode)
 * 3. Ritual Injection (if applicable)
 * 4. Context Injection (market, memory, session state)
 * 5. Tool Reference (condensed tool docs)
 *
 * The result is a focused, contextual prompt that makes the CIO
 * feel alive, aware, and decisive.
 */

import { CIO_IDENTITY_CORE } from './cioIdentityCore';
import {
  buildContextInjection,
  extractTopicFromMessage,
  cioSessionManager,
  type CIOContext,
  type MemoryContext,
  type MarketState,
  type UserPreferences
} from './cioContextInjector';
import {
  cioStateMachine,
  detectModeFromMessage,
  type CIOMode
} from './cioStateMachine';
import { OPS_MANUAL } from './opsManual';
import { DATA_ARCHITECTURE_CONTEXT } from './dataArchitectureContext';

/**
 * Condensed tool reference (not the full verbose docs)
 */
const TOOL_REFERENCE = `
---

## TOOLS QUICK REFERENCE

### Direct Powers (Use Immediately)
| Tool | Purpose |
|------|---------|
| \`read_file\` | Read any file |
| \`search_code\` | Find code patterns |
| \`list_directory\` | See file structure |
| \`spawn_agent\` | Query DuckDB data |
| \`run_python_script\` | Execute existing scripts |
| \`obsidian_search_notes\` | Search knowledge base |
| \`obsidian_read_note\` | Read specific note |
| \`recall_memory\` | Search past learnings |
| \`save_memory\` | Store new learnings |

### Delegate to CTO (Claude Code)
| Task | Why Delegate |
|------|--------------|
| Write/modify code | Code creation requires CTO |
| Run backtests | Execution complexity |
| Git operations | Safety boundary |
| Package management | Environment changes |

**Delegation syntax:**
\`\`\`
execute_via_claude_code(
  task: "What needs to be done",
  context: "My analysis and reasoning",
  parallel_hint: 'none' | 'minor' | 'massive'
)
\`\`\`

### Visualization Directives
\`[DISPLAY_CHART: {"type": "line|bar|heatmap", "title": "...", "data": {...}}]\`
\`[DISPLAY_METRICS: {"title": "...", "metrics": [...]}]\`
\`[DISPLAY_TABLE: {"title": "...", "columns": [...], "rows": [...]}]\`
\`[STAGE: phase_name]\` - Set research phase
\`[PROGRESS: 0-100 message="..."]\` - Update progress

---
`;

/**
 * Assemble the complete CIO prompt
 *
 * LATENCY NOTE: This is synchronous and fast (~1ms).
 * Memory/market queries should be done BEFORE calling this,
 * passed in via options, and cached where possible.
 */
export async function assembleCIOPrompt(
  userMessage: string,
  options: {
    sessionId?: string;
    marketState?: MarketState | null;
    memoryContext?: MemoryContext;
    userPreferences?: Partial<UserPreferences>;
    forceMode?: CIOMode;
    includeOpsManual?: boolean;
    /** Skip context injection for fast mode */
    fastMode?: boolean;
  } = {}
): Promise<string> {
  // Get current session state
  const sessionState = cioSessionManager.getState();
  if (options.sessionId) {
    cioSessionManager.setSessionId(options.sessionId);
  }

  // Detect or use forced mode
  const mode = options.forceMode ||
    detectModeFromMessage(
      userMessage,
      sessionState.phasesCompleted.length,
      sessionState.roadmap.length || 1
    );

  // Transition state machine if needed
  cioStateMachine.transitionTo(mode, `Message: "${userMessage.slice(0, 50)}..."`);

  // Build context
  const context: Partial<CIOContext> = {
    mode,
    market: options.marketState || null,
    session: sessionState,
    memory: options.memoryContext || {
      relevantMemories: [],
      priorWorkSummary: 'No prior work context loaded.'
    },
    user: {
      prefersBold: true,
      prefersVisualsFirst: true,
      riskTolerance: 'aggressive',
      focusAreas: ['SPY options', 'volatility', 'regime detection'],
      ...options.userPreferences
    }
  };

  // FAST MODE: Minimal prompt for quick responses
  if (options.fastMode) {
    return `${CIO_IDENTITY_CORE}\n\n${cioStateMachine.getModeDirectives()}\n\n${TOOL_REFERENCE}`;
  }

  // Assemble the full prompt
  const parts: string[] = [
    // 1. Identity Core (~200 lines, ~800 tokens)
    CIO_IDENTITY_CORE,

    // 2. Data Architecture - WHERE EVERYTHING IS (~50 lines)
    // This prevents unnecessary exploration/Claude Code calls
    DATA_ARCHITECTURE_CONTEXT,

    // 3. Mode-specific directives (~30 lines)
    cioStateMachine.getModeDirectives(),

    // 4. Ritual injection (only on first message)
    cioStateMachine.getRitualInjection(),

    // 5. Dynamic context (only if provided)
    context.market || context.memory?.relevantMemories.length
      ? buildContextInjection(context)
      : '',

    // 6. Tool reference (~50 lines)
    TOOL_REFERENCE
  ].filter(Boolean); // Remove empty strings

  // 6. Ops manual only when explicitly requested (adds ~200 lines)
  if (options.includeOpsManual) {
    parts.push(OPS_MANUAL);
  }

  return parts.join('\n');
}

/**
 * Quick prompt assembly for simple cases
 * INCLUDES DATA_ARCHITECTURE_CONTEXT - critical for environment awareness
 */
export function assembleCIOPromptSync(
  _mode: CIOMode = 'INTAKE',
  sessionContext?: string
): string {
  return `${CIO_IDENTITY_CORE}

${DATA_ARCHITECTURE_CONTEXT}

${cioStateMachine.getModeDirectives()}

${sessionContext ? `
---
## SESSION CONTEXT
${sessionContext}
---
` : ''}

${TOOL_REFERENCE}
`;
}

/**
 * Get just the identity core (for testing or simple cases)
 */
export function getIdentityCore(): string {
  return CIO_IDENTITY_CORE;
}

/**
 * Reset all state (for new sessions)
 */
export function resetCIOState(): void {
  cioSessionManager.reset();
  cioStateMachine.reset();
}

/**
 * Update roadmap (called when CIO proposes a plan)
 */
export function setRoadmap(phases: string[]): void {
  cioSessionManager.setRoadmap(phases);
}

/**
 * Advance to next phase
 */
export function advancePhase(): void {
  cioSessionManager.advancePhase();
}

/**
 * Record a key finding
 */
export function recordFinding(finding: string): void {
  cioSessionManager.addFinding(finding);
}

/**
 * Record an action
 */
export function recordAction(action: string): void {
  cioSessionManager.setLastAction(action);
}

/**
 * Get current mode
 */
export function getCurrentMode(): CIOMode {
  return cioStateMachine.getMode();
}

/**
 * Force a mode transition
 */
export function forceMode(mode: CIOMode, reason: string): void {
  cioStateMachine.transitionTo(mode, reason);
}

// Export everything needed
export {
  CIO_IDENTITY_CORE,
  cioSessionManager,
  cioStateMachine,
  extractTopicFromMessage,
  TOOL_REFERENCE
};

export default {
  assembleCIOPrompt,
  assembleCIOPromptSync,
  getIdentityCore,
  resetCIOState,
  setRoadmap,
  advancePhase,
  recordFinding,
  recordAction,
  getCurrentMode,
  forceMode
};
