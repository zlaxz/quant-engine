/**
 * CIO State Machine & Ritual System
 *
 * Tracks the CIO's operational mode and triggers rituals at key moments.
 *
 * Modes:
 * - INTAKE: Receiving new goals/visions → Bold, roadmap-oriented
 * - EXECUTION: Actively researching → Tool-heavy, results-focused
 * - SYNTHESIS: Presenting findings → Strategic, dashboard-oriented
 * - VALIDATION: Stress-testing → Skeptical, adversarial
 *
 * Rituals:
 * - Opening: Session start checks (market, memory, prior work)
 * - Checkpoint: Phase transition summaries
 * - Closing: Documentation and queuing
 */

export type CIOMode = 'INTAKE' | 'EXECUTION' | 'SYNTHESIS' | 'VALIDATION';

export interface ModeTransition {
  from: CIOMode;
  to: CIOMode;
  trigger: string;
  timestamp: string;
}

export interface RitualEvent {
  type: 'OPENING' | 'CHECKPOINT' | 'CLOSING';
  triggered: boolean;
  timestamp: string | null;
  outputs: string[];
}

/**
 * State Machine for CIO Mode Tracking
 */
class CIOStateMachine {
  private currentMode: CIOMode = 'INTAKE';
  private modeHistory: ModeTransition[] = [];
  private ritualState: Record<RitualEvent['type'], RitualEvent> = {
    OPENING: { type: 'OPENING', triggered: false, timestamp: null, outputs: [] },
    CHECKPOINT: { type: 'CHECKPOINT', triggered: false, timestamp: null, outputs: [] },
    CLOSING: { type: 'CLOSING', triggered: false, timestamp: null, outputs: [] }
  };
  private sessionStartTime: string = new Date().toISOString();

  /**
   * Get current mode
   */
  getMode(): CIOMode {
    return this.currentMode;
  }

  /**
   * Transition to a new mode
   */
  transitionTo(newMode: CIOMode, trigger: string): void {
    if (newMode === this.currentMode) return;

    const transition: ModeTransition = {
      from: this.currentMode,
      to: newMode,
      trigger,
      timestamp: new Date().toISOString()
    };

    this.modeHistory.push(transition);
    this.currentMode = newMode;

    // Trigger checkpoint ritual on mode transition
    this.triggerCheckpointRitual();
  }

  /**
   * Get mode-specific behavior directives
   */
  getModeDirectives(): string {
    switch (this.currentMode) {
      case 'INTAKE':
        return INTAKE_DIRECTIVES;
      case 'EXECUTION':
        return EXECUTION_DIRECTIVES;
      case 'SYNTHESIS':
        return SYNTHESIS_DIRECTIVES;
      case 'VALIDATION':
        return VALIDATION_DIRECTIVES;
    }
  }

  /**
   * Check if opening ritual should trigger
   */
  shouldTriggerOpeningRitual(): boolean {
    return !this.ritualState.OPENING.triggered;
  }

  /**
   * Mark opening ritual as triggered
   */
  triggerOpeningRitual(): void {
    this.ritualState.OPENING = {
      type: 'OPENING',
      triggered: true,
      timestamp: new Date().toISOString(),
      outputs: []
    };
  }

  /**
   * Trigger checkpoint ritual
   */
  private triggerCheckpointRitual(): void {
    this.ritualState.CHECKPOINT = {
      type: 'CHECKPOINT',
      triggered: true,
      timestamp: new Date().toISOString(),
      outputs: []
    };
  }

  /**
   * Get ritual outputs to inject
   */
  getRitualInjection(): string {
    const injections: string[] = [];

    if (this.shouldTriggerOpeningRitual()) {
      injections.push(OPENING_RITUAL);
    }

    return injections.join('\n\n');
  }

  /**
   * Reset for new session
   */
  reset(): void {
    this.currentMode = 'INTAKE';
    this.modeHistory = [];
    this.ritualState = {
      OPENING: { type: 'OPENING', triggered: false, timestamp: null, outputs: [] },
      CHECKPOINT: { type: 'CHECKPOINT', triggered: false, timestamp: null, outputs: [] },
      CLOSING: { type: 'CLOSING', triggered: false, timestamp: null, outputs: [] }
    };
    this.sessionStartTime = new Date().toISOString();
  }

  /**
   * Get session summary
   */
  getSessionSummary(): string {
    return `
Session started: ${this.sessionStartTime}
Current mode: ${this.currentMode}
Mode transitions: ${this.modeHistory.length}
${this.modeHistory.map(t => `  ${t.from} → ${t.to} (${t.trigger})`).join('\n')}
`;
  }
}

// Mode-specific directives
const INTAKE_DIRECTIVES = `
## MODE: INTAKE (Receiving New Goals)

**My Behavior in This Mode:**
- Be BOLD and visionary - match the user's ambition
- Propose a CONCRETE roadmap with 3-5 phases
- START the first action IMMEDIATELY (don't just describe it)
- Show ENTHUSIASM for ambitious goals
- Use [STAGE: ...] to set the research phase
- Use [DISPLAY_CHART: ...] or [DISPLAY_METRICS: ...] to visualize the opportunity

**Response Pattern:**
1. Acknowledge the magnitude (1 line)
2. Frame the real challenge (2-3 lines)
3. Present my roadmap (bullet points)
4. Start Phase 1 NOW (use a tool)
5. Show something visual

**DO NOT:** Ask "where should we focus?" - I DECIDE. That's my job.
`;

const EXECUTION_DIRECTIVES = `
## MODE: EXECUTION (Actively Researching)

**My Behavior in This Mode:**
- Be TOOL-HEAVY - actions speak louder than words
- Show RESULTS as they come in
- Keep explanations CONCISE
- Use visualizations for every significant finding
- Update [PROGRESS: X message="..."] as work progresses
- Queue next steps as I discover them

**Response Pattern:**
1. State what I'm doing (1 line)
2. Execute the tool/analysis
3. Show the result (chart, table, metrics)
4. Brief interpretation (2-3 lines)
5. Next action or finding

**DO NOT:** Write long explanations before showing results.
`;

const SYNTHESIS_DIRECTIVES = `
## MODE: SYNTHESIS (Presenting Findings)

**My Behavior in This Mode:**
- Be STRATEGIC and high-level
- Emphasize INSIGHTS over raw data
- Create SUMMARY dashboards
- Make CLEAR recommendations
- Connect findings to the original goal
- Document learnings to memory/obsidian

**Response Pattern:**
1. Summary dashboard [DISPLAY_METRICS: ...]
2. Key insight (the "so what")
3. Supporting evidence (reference earlier findings)
4. My recommendation
5. Next steps or implications

**DO NOT:** Dump raw data without interpretation.
`;

const VALIDATION_DIRECTIVES = `
## MODE: VALIDATION (Stress-Testing)

**My Behavior in This Mode:**
- Be SKEPTICAL and rigorous
- Actively look for what could go WRONG
- Run ADVERSARIAL tests
- Question ASSUMPTIONS
- Check for overfitting, bias, edge cases
- Use the backtest-bias-auditor methodology

**Response Pattern:**
1. State what I'm testing (1 line)
2. Run the stress test / audit
3. Show failure modes or confirmations
4. Honest assessment of robustness
5. Recommendation: proceed / iterate / abandon

**DO NOT:** Rubber-stamp anything. My job is to break it before the market does.
`;

// Ritual content
const OPENING_RITUAL = `
## OPENING RITUAL (Session Start)

**Before responding to any request, I check three things:**

1. **Market State** - What's the current regime?
   → I will query current VIX, regime state, and relevant market conditions

2. **Prior Work** - What have we learned about this topic before?
   → I will search memory and Obsidian for relevant context

3. **Where We Left Off** - Is this a continuation?
   → I will check if there's an existing roadmap or prior session state

**After checking, I state:** "Context loaded. Here's my read on the situation..."

Then I proceed with my response.

**IMPORTANT:** Do NOT skip this ritual. It ensures I'm grounded in reality, not making assumptions.
`;

const CHECKPOINT_RITUAL = `
## CHECKPOINT RITUAL (Phase Transition)

I just transitioned modes. Before continuing:

1. **Summarize** - What did we learn in the previous phase?
2. **Validate** - Any red flags or concerns?
3. **Queue** - What's next on the roadmap?
4. **Document** - Save key findings to memory

Output: "Phase complete. Key finding: [X]. Moving to [next phase]..."
`;

const CLOSING_RITUAL = `
## CLOSING RITUAL (Session End)

Before wrapping up this session:

1. **Document** - Save learnings to memory and Obsidian
   → Use save_memory for quick recalls
   → Use obsidian_document_learning for detailed findings

2. **Queue** - What's ready for next session?
   → Update the roadmap state
   → Note unfinished business

3. **Summarize** - What did we accomplish?
   → Key findings
   → Decisions made
   → Open questions

Output: "Session wrap. Documented [X], queued [Y] for next time."
`;

// Singleton instance
export const cioStateMachine = new CIOStateMachine();

/**
 * Detect the appropriate mode from message content and context
 */
export function detectModeFromMessage(
  message: string,
  currentPhaseIndex: number,
  totalPhases: number
): CIOMode {
  const lower = message.toLowerCase();

  // Explicit mode triggers
  if (lower.includes('validate') ||
      lower.includes('stress test') ||
      lower.includes('audit') ||
      lower.includes('what could go wrong') ||
      lower.includes('check for bias')) {
    return 'VALIDATION';
  }

  if (lower.includes('summarize') ||
      lower.includes('what did we learn') ||
      lower.includes('findings') ||
      lower.includes('conclusion') ||
      lower.includes('recommend')) {
    return 'SYNTHESIS';
  }

  // New vision/goal = INTAKE
  if (lower.includes('i want') ||
      lower.includes('let\'s') ||
      lower.includes('new strategy') ||
      lower.includes('build') ||
      lower.includes('create') ||
      currentPhaseIndex === 0) {
    return 'INTAKE';
  }

  // In the middle of work = EXECUTION
  if (currentPhaseIndex > 0 && currentPhaseIndex < totalPhases) {
    return 'EXECUTION';
  }

  // Near the end = SYNTHESIS
  if (currentPhaseIndex === totalPhases - 1) {
    return 'SYNTHESIS';
  }

  return 'EXECUTION';
}

export default {
  cioStateMachine,
  detectModeFromMessage,
  OPENING_RITUAL,
  CHECKPOINT_RITUAL,
  CLOSING_RITUAL
};
