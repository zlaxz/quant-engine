/**
 * CIO Context Injector
 *
 * Assembles dynamic context BEFORE every LLM call.
 * This is what makes the CIO feel like it "knows" the situation.
 *
 * Injected Context:
 * 1. Current market state (regime, VIX, etc.)
 * 2. Relevant memories from prior sessions
 * 3. Current research phase and roadmap
 * 4. Session history summary
 * 5. User preferences (learned over time)
 */

export interface MarketState {
  regime: string;
  regimeConfidence: number;
  vix: number;
  spyPrice: number;
  lastUpdate: string;
}

export interface SessionState {
  sessionId: string;
  startTime: string;
  currentPhase: string;
  phasesCompleted: string[];
  roadmap: string[];
  lastAction: string;
  keyFindings: string[];
}

export interface MemoryContext {
  relevantMemories: Array<{
    content: string;
    timestamp: string;
    importance: number;
  }>;
  priorWorkSummary: string;
}

export interface UserPreferences {
  prefersBold: boolean;
  prefersVisualsFirst: boolean;
  riskTolerance: 'aggressive' | 'moderate' | 'conservative';
  focusAreas: string[];
}

export interface CIOContext {
  market: MarketState | null;
  session: SessionState;
  memory: MemoryContext;
  user: UserPreferences;
  mode: 'INTAKE' | 'EXECUTION' | 'SYNTHESIS' | 'VALIDATION';
}

/**
 * Default context when nothing is loaded
 */
const DEFAULT_CONTEXT: CIOContext = {
  market: null,
  session: {
    sessionId: '',
    startTime: new Date().toISOString(),
    currentPhase: 'intake',
    phasesCompleted: [],
    roadmap: [],
    lastAction: 'Session started',
    keyFindings: []
  },
  memory: {
    relevantMemories: [],
    priorWorkSummary: 'No prior work found on this topic.'
  },
  user: {
    prefersBold: true, // Zach's default
    prefersVisualsFirst: true,
    riskTolerance: 'aggressive',
    focusAreas: ['SPY options', 'volatility', 'regime detection']
  },
  mode: 'INTAKE'
};

/**
 * Build the dynamic context injection string
 */
export function buildContextInjection(context: Partial<CIOContext> = {}): string {
  const ctx = { ...DEFAULT_CONTEXT, ...context };

  return `
---

## CURRENT CONTEXT (Injected at Runtime)

### Market State
${ctx.market ? `
- **Regime**: ${ctx.market.regime} (${(ctx.market.regimeConfidence * 100).toFixed(0)}% confidence)
- **VIX**: ${ctx.market.vix.toFixed(2)}
- **SPY**: $${ctx.market.spyPrice.toFixed(2)}
- **Last Update**: ${ctx.market.lastUpdate}
` : `
- Market state not loaded. Consider running regime detection first.
`}

### Session State
- **Session ID**: ${ctx.session.sessionId || 'New session'}
- **Current Phase**: ${ctx.session.currentPhase}
- **Phases Completed**: ${ctx.session.phasesCompleted.length > 0 ? ctx.session.phasesCompleted.join(' → ') : 'None yet'}
- **Last Action**: ${ctx.session.lastAction}
${ctx.session.keyFindings.length > 0 ? `
- **Key Findings So Far**:
${ctx.session.keyFindings.map(f => `  - ${f}`).join('\n')}
` : ''}

### Roadmap
${ctx.session.roadmap.length > 0 ? `
${ctx.session.roadmap.map((phase, i) => {
  const completed = ctx.session.phasesCompleted.includes(phase);
  const current = ctx.session.currentPhase === phase;
  return `${completed ? '✓' : current ? '→' : '○'} Phase ${i + 1}: ${phase}`;
}).join('\n')}
` : 'No roadmap defined yet. Consider proposing one.'}

### Relevant Prior Work
${ctx.memory.priorWorkSummary}
${ctx.memory.relevantMemories.length > 0 ? `

**Specific Memories:**
${ctx.memory.relevantMemories.slice(0, 3).map(m =>
  `- [${m.timestamp}] ${m.content.slice(0, 200)}...`
).join('\n')}
` : ''}

### About This User
- **Style**: ${ctx.user.prefersBold ? 'Prefers bold, decisive responses' : 'Prefers measured, cautious responses'}
- **Visuals**: ${ctx.user.prefersVisualsFirst ? 'Loves visualizations - show charts first' : 'Prefers text explanations'}
- **Risk**: ${ctx.user.riskTolerance}
- **Focus Areas**: ${ctx.user.focusAreas.join(', ')}

### Current Mode
**MODE: ${ctx.mode}**

${getModeDirective(ctx.mode)}

---
`;
}

/**
 * Get mode-specific behavioral directives
 */
function getModeDirective(mode: CIOContext['mode']): string {
  switch (mode) {
    case 'INTAKE':
      return `
In INTAKE mode, I am receiving new goals or visions.
- Be bold and visionary
- Propose a concrete roadmap
- Start the first action immediately
- Show enthusiasm for ambitious goals
`;
    case 'EXECUTION':
      return `
In EXECUTION mode, I am actively researching.
- Be tool-heavy, minimal chat
- Show results as they come
- Focus on data and findings
- Keep explanations concise
`;
    case 'SYNTHESIS':
      return `
In SYNTHESIS mode, I am presenting findings.
- Be strategic and high-level
- Emphasize insights over data
- Show summary dashboards
- Make clear recommendations
`;
    case 'VALIDATION':
      return `
In VALIDATION mode, I am stress-testing hypotheses.
- Be skeptical and rigorous
- Look for what could go wrong
- Run adversarial tests
- Question assumptions actively
`;
    default:
      return '';
  }
}

/**
 * Extract topic from the current message for memory search
 */
export function extractTopicFromMessage(message: string): string[] {
  const topics: string[] = [];

  // Key financial terms
  const financialTerms = [
    'backtest', 'strategy', 'regime', 'volatility', 'options', 'SPY',
    'momentum', 'mean reversion', 'alpha', 'sharpe', 'drawdown',
    'convexity', 'skew', 'VIX', 'Greeks', 'delta', 'gamma',
    'premium', 'expiration', 'strike', 'put', 'call'
  ];

  for (const term of financialTerms) {
    if (message.toLowerCase().includes(term.toLowerCase())) {
      topics.push(term);
    }
  }

  // Also extract percentage mentions (like "1000%")
  const percentMatch = message.match(/\d+%/g);
  if (percentMatch) {
    topics.push('returns', 'performance');
  }

  // Dollar amounts
  const dollarMatch = message.match(/\$[\d,]+[KMB]?/gi);
  if (dollarMatch) {
    topics.push('portfolio', 'sizing');
  }

  return [...new Set(topics)]; // Deduplicate
}

/**
 * Determine the appropriate mode based on message content
 */
export function detectMode(
  message: string,
  sessionState: SessionState
): CIOContext['mode'] {
  const lower = message.toLowerCase();

  // Validation triggers
  if (lower.includes('validate') ||
      lower.includes('stress test') ||
      lower.includes('what could go wrong') ||
      lower.includes('audit') ||
      lower.includes('check')) {
    return 'VALIDATION';
  }

  // Synthesis triggers
  if (lower.includes('summarize') ||
      lower.includes('what did we learn') ||
      lower.includes('conclusion') ||
      lower.includes('findings') ||
      lower.includes('recommend')) {
    return 'SYNTHESIS';
  }

  // If we have a roadmap and are in the middle of it, we're executing
  if (sessionState.roadmap.length > 0 &&
      sessionState.phasesCompleted.length > 0 &&
      sessionState.phasesCompleted.length < sessionState.roadmap.length) {
    return 'EXECUTION';
  }

  // New goals/visions are INTAKE
  if (lower.includes('i want') ||
      lower.includes('goal') ||
      lower.includes('build') ||
      lower.includes('create') ||
      lower.includes('help me') ||
      lower.includes('let\'s') ||
      sessionState.phasesCompleted.length === 0) {
    return 'INTAKE';
  }

  // Default to execution if unsure
  return 'EXECUTION';
}

/**
 * Session state manager - tracks state across the session
 */
class CIOSessionManager {
  private state: SessionState;

  constructor() {
    this.state = { ...DEFAULT_CONTEXT.session };
  }

  setSessionId(id: string): void {
    this.state.sessionId = id;
  }

  setRoadmap(phases: string[]): void {
    this.state.roadmap = phases;
    this.state.currentPhase = phases[0] || 'intake';
  }

  advancePhase(): void {
    const currentIndex = this.state.roadmap.indexOf(this.state.currentPhase);
    if (currentIndex >= 0 && currentIndex < this.state.roadmap.length - 1) {
      this.state.phasesCompleted.push(this.state.currentPhase);
      this.state.currentPhase = this.state.roadmap[currentIndex + 1];
    }
  }

  addFinding(finding: string): void {
    this.state.keyFindings.push(finding);
  }

  setLastAction(action: string): void {
    this.state.lastAction = action;
  }

  getState(): SessionState {
    return { ...this.state };
  }

  reset(): void {
    this.state = {
      sessionId: '',
      startTime: new Date().toISOString(),
      currentPhase: 'intake',
      phasesCompleted: [],
      roadmap: [],
      lastAction: 'Session started',
      keyFindings: []
    };
  }
}

// Singleton instance
export const cioSessionManager = new CIOSessionManager();

export default {
  buildContextInjection,
  extractTopicFromMessage,
  detectMode,
  cioSessionManager
};
