/**
 * Evolution Prompts - Genetic Algorithm Strategy Mutation
 *
 * Defines prompts for the /evolve_strategy command which uses
 * massive swarm to spawn 20+ mutation agents.
 *
 * Each mutation agent receives a different mutation directive
 * to explore the strategy's parameter space and structure.
 */

import { buildFrameworkWithGreeks, REGIME_FRAMEWORK, CONVEXITY_PROFILES } from './sharedContext';

// ============================================================================
// Mutation Types
// ============================================================================

export type MutationType =
  | 'parameter_tweak'      // Small changes to existing parameters
  | 'hedging_ratio'        // Adjust delta hedging frequency/threshold
  | 'entry_filter'         // Modify entry conditions
  | 'exit_rule'           // Change exit/stop rules
  | 'position_sizing'     // Alter position sizing logic
  | 'regime_filter'       // Change regime detection/filtering
  | 'time_decay'          // Adjust theta/time-based rules
  | 'vol_filter'          // Modify volatility conditions
  | 'strike_selection'    // Change strike/moneyness selection
  | 'dte_adjustment'      // Modify days-to-expiration rules
  | 'roll_rules'          // Change rolling logic
  | 'correlation_filter'  // Add/modify correlation-based filters
  | 'invert_logic'        // Try opposite of current logic
  | 'combine_profiles'    // Blend multiple convexity profiles
  | 'simplify'            // Remove complexity, keep core
  | 'add_hedge'           // Add additional hedging mechanism
  | 'regime_specific'     // Make rules regime-specific
  | 'convexity_boost'     // Enhance convexity in extreme moves
  | 'tail_protection'     // Add tail risk protection
  | 'gamma_scaling';       // Scale gamma exposure dynamically

export const MUTATION_DESCRIPTIONS: Record<MutationType, string> = {
  parameter_tweak: 'Make small adjustments to existing parameters (±10-25%)',
  hedging_ratio: 'Modify delta hedging frequency or threshold',
  entry_filter: 'Add, remove, or modify entry condition filters',
  exit_rule: 'Change exit triggers, stop losses, or profit targets',
  position_sizing: 'Alter how position sizes are calculated',
  regime_filter: 'Change how regimes are detected or filtered',
  time_decay: 'Adjust theta decay handling or time-based rules',
  vol_filter: 'Modify volatility-based conditions',
  strike_selection: 'Change how strikes or moneyness are selected',
  dte_adjustment: 'Modify days-to-expiration targeting rules',
  roll_rules: 'Change when/how positions are rolled',
  correlation_filter: 'Add or modify correlation-based filtering',
  invert_logic: 'Try the opposite of current logic (contrarian)',
  combine_profiles: 'Blend multiple convexity profiles together',
  simplify: 'Remove complexity while preserving core edge',
  add_hedge: 'Add additional hedging or protection mechanism',
  regime_specific: 'Make existing rules regime-specific',
  convexity_boost: 'Enhance convexity in extreme market moves',
  tail_protection: 'Add specific tail risk protection',
  gamma_scaling: 'Scale gamma exposure based on conditions',
};

// ============================================================================
// Agent Assignment - Distribute mutations across swarm
// ============================================================================

/**
 * Get mutation types for a swarm of N agents
 * Ensures diverse coverage of mutation space
 */
export function getMutationAssignments(agentCount: number): MutationType[] {
  const allMutations = Object.keys(MUTATION_DESCRIPTIONS) as MutationType[];

  const assignments: MutationType[] = [];

  // First pass: assign each mutation type at least once
  for (let i = 0; i < Math.min(agentCount, allMutations.length); i++) {
    assignments.push(allMutations[i]);
  }

  // Second pass: cycle through again if we have more agents
  for (let i = allMutations.length; i < agentCount; i++) {
    assignments.push(allMutations[i % allMutations.length]);
  }

  return assignments;
}

// ============================================================================
// Prompt Templates
// ============================================================================

// ============================================================================
// UNIVERSAL PHYSICS - Core Principles
// ============================================================================

export const UNIVERSAL_PHYSICS = `
## 🎯 UNIVERSAL PHYSICS - The Laws of Convexity

Your mutations MUST follow these Universal Laws. Parameter optimization is FORBIDDEN.

### LAW 1: Structure Over Parameters
❌ WRONG: "Change RSI threshold from 30 to 25"
❌ WRONG: "Adjust lookback from 20 to 14"
❌ WRONG: "Set stop loss at 2% instead of 3%"

✅ RIGHT: "Short delta when gamma exposure turns negative"
✅ RIGHT: "Scale position size inversely to VIX term structure slope"
✅ RIGHT: "Enter when skew exceeds 2 standard deviations from 20-day mean"

### LAW 2: Regime Declaration Required
Every strategy MUST declare which regime(s) it hunts:
- **LOW_VOL_GRIND**: VIX < 15, contango, steady drift
- **HIGH_VOL_OSCILLATION**: VIX 20-30, choppy, mean reversion
- **CRASH_ACCELERATION**: VIX > 30, inverted term structure, panic
- **MELT_UP**: VIX declining, strong momentum, FOMO

Your mutation MUST specify: "This strategy hunts [REGIME]"

### LAW 3: Exit Velocity Requirement
NO trade should stagnate. Every strategy MUST have an Exit Velocity clause:
"If position P&L < X% after T hours, EXIT. We want velocity, not waiting."

Recommended default: If |P&L| < 0.5% after 2 hours, exit and re-evaluate.

### LAW 4: Structural Pressure Points
Focus on these Greek relationships, not parameter values:
- **Gamma-Vega Interplay**: Long gamma when vega is cheap (low VIX)
- **Theta-Gamma Tradeoff**: Accept theta decay only when gamma can overwhelm it
- **Skew Exploitation**: Trade the term structure, not the level
- **Delta Neutralization**: When to hedge vs when to let delta run

### LAW 5: Portfolio Contribution
Your mutation will be scored on SYMPHONY FITNESS:
- 5x bonus if negatively correlated with existing strategies
- 0.1x penalty if duplicating existing exposure
- Design for the PORTFOLIO, not standalone performance
`;

/**
 * System prompt for mutation agents - Universal Physics Edition
 */
export const MUTATION_AGENT_SYSTEM = `You are a genetic algorithm mutation agent for the Universal Symphony - a coordinated portfolio of convexity strategies.

Your task is to mutate a base strategy following UNIVERSAL PHYSICS principles. We seek 1% daily returns via high-velocity regime rotation.

${buildFrameworkWithGreeks()}

${UNIVERSAL_PHYSICS}

## Mutation Guidelines

1. **STRUCTURAL MUTATIONS ONLY**: Do NOT optimize parameters. Optimize for structural pressure.
2. **Declare Target Regime**: Your mutation MUST specify which regime it hunts
3. **Exit Velocity Required**: Include a time-based exit if trade stagnates
4. **Portfolio Thinking**: Consider how this fits with OTHER strategies (negative correlation = bonus)
5. **Code-Ready**: Output complete, runnable Python

## Output Format

Structure your response as:

### Mutation Type
[Type of mutation being applied]

### Target Regime
[LOW_VOL_GRIND | HIGH_VOL_OSCILLATION | CRASH_ACCELERATION | MELT_UP]

### Change Description
[Specific STRUCTURAL change being made - NOT a parameter tweak]

### Implementation
\`\`\`python
class Strategy:
    """
    Target Regime: [REGIME]
    Exit Velocity: [X% in Y hours]
    Structural Edge: [Description of the structural pressure exploited]
    """

    def __init__(self, config):
        # Configuration
        self.target_regime = "[REGIME]"
        self.exit_velocity_hours = 2  # Exit if stagnant
        self.exit_velocity_threshold = 0.005  # 0.5% minimum movement

        # ... rest of initialization

    def check_exit_velocity(self, position_pnl, hours_held):
        """Exit if trade stagnates - we want velocity, not waiting."""
        if hours_held >= self.exit_velocity_hours:
            if abs(position_pnl) < self.exit_velocity_threshold:
                return True  # EXIT - stagnant trade
        return False

    def run(self, market_data, initial_capital):
        # ... implementation with regime awareness
        pass
\`\`\`

### Structural Rationale
[Why this STRUCTURAL pressure creates edge - reference Greeks, term structure, or regime dynamics]

### Expected Impact
- Positive: [What should improve]
- Negative: [What might get worse]
- Risk: [New risks introduced]

### Regime Sensitivity
- **Primary Regime**: [Which regime this hunts]
- **Secondary Benefit**: [Other regimes where it might work]
- **Danger Zone**: [Regimes where this strategy will lose]

### Portfolio Role
[How does this strategy complement others? Does it hedge existing exposure or add correlation?]`;

// Legacy export for backwards compatibility
export const MUTATION_AGENT_SYSTEM_LEGACY = MUTATION_AGENT_SYSTEM;

/**
 * Build mutation prompt for a specific agent - Universal Physics Edition
 */
export function buildMutationPrompt(
  strategyCode: string,
  strategyDescription: string,
  mutationType: MutationType,
  agentIndex: number,
  totalAgents: number
): string {
  const mutationDesc = MUTATION_DESCRIPTIONS[mutationType];

  // Assign regime focus based on agent index (distribute across regimes)
  const regimes = ['LOW_VOL_GRIND', 'HIGH_VOL_OSCILLATION', 'CRASH_ACCELERATION', 'MELT_UP'];
  const assignedRegime = regimes[agentIndex % regimes.length];

  return `## Your Mutation Assignment - Universal Symphony

You are Agent ${agentIndex + 1} of ${totalAgents} in the Universal Symphony evolution swarm.

**Your Mutation Type**: ${mutationType}
**Mutation Description**: ${mutationDesc}
**Assigned Regime Focus**: ${assignedRegime}

## 🎯 CRITICAL: Universal Physics Rules

You MUST follow these laws:

1. **NO PARAMETER OPTIMIZATION** - Do not change RSI from 14 to 20, or thresholds from 2% to 3%
2. **STRUCTURAL CHANGES ONLY** - Change HOW Greeks interact, not what values trigger
3. **DECLARE YOUR REGIME** - Your mutation must specify: "This hunts ${assignedRegime}"
4. **EXIT VELOCITY REQUIRED** - Include: "Exit if |P&L| < 0.5% after 2 hours"
5. **PORTFOLIO THINKING** - Design for negative correlation with existing strategies

## Base Strategy

### Description
${strategyDescription}

### Code
\`\`\`python
${strategyCode}
\`\`\`

## Your Task

Apply a **${mutationType}** mutation targeting **${assignedRegime}** regime. Your mutation should:

1. Make a STRUCTURAL change (Greek relationships, regime logic, position scaling)
2. Include Exit Velocity clause (kill stagnant trades after 2 hours)
3. Explain which structural pressure creates the edge
4. Consider how this complements OTHER strategies in the Symphony
5. Output COMPLETE runnable Python code

### Structural Mutation Ideas for ${mutationType}:
${getStructuralMutationIdeas(mutationType)}

Remember: You're Agent ${agentIndex + 1}/${totalAgents}. Your unique angle is ${assignedRegime} regime focus.
Be creative with STRUCTURE, not with PARAMETERS.`;
}

/**
 * Get structural mutation ideas based on mutation type
 */
function getStructuralMutationIdeas(mutationType: MutationType): string {
  const ideas: Record<MutationType, string> = {
    parameter_tweak: '- Change HOW a parameter is calculated, not its value (e.g., dynamic based on VIX)',
    hedging_ratio: '- Hedge based on gamma sign, not delta magnitude\\n- Scale hedge with term structure slope',
    entry_filter: '- Enter on skew divergence, not price level\\n- Use Greek ratio triggers (gamma/theta)',
    exit_rule: '- Exit on regime transition, not P&L target\\n- Exit Velocity: time-based exit for stagnant trades',
    position_sizing: '- Size inversely to VIX term structure slope\\n- Scale with portfolio correlation',
    regime_filter: '- Add hard stops when regime transitions\\n- Only trade in declared regime',
    time_decay: '- Accept theta only when gamma can overwhelm it\\n- Time-based regime transitions',
    vol_filter: '- Trade vol term structure, not vol level\\n- Use VIX9D/VIX ratio as filter',
    strike_selection: '- Select strikes based on skew curve, not moneyness\\n- Dynamic based on gamma exposure',
    dte_adjustment: '- Choose DTE based on regime, not fixed days\\n- Scale DTE with VIX level',
    roll_rules: '- Roll based on gamma decay, not calendar time\\n- Regime-triggered rolls',
    correlation_filter: '- Add portfolio correlation check\\n- Only enter if adds diversification',
    invert_logic: '- Invert during regime transitions\\n- Contrarian in target regime only',
    combine_profiles: '- Blend gamma-focused and vega-focused profiles\\n- Regime-conditional profile switching',
    simplify: '- Remove parameters, use structural triggers\\n- Pure Greek-based logic',
    add_hedge: '- Add tail hedge that activates on term structure inversion\\n- Correlation-based hedge',
    regime_specific: '- Hard-code regime-specific behavior\\n- Different Greeks focus per regime',
    convexity_boost: '- Long gamma when vega is cheap\\n- Accelerate exposure as vol rises',
    tail_protection: '- Add protection on term structure inversion\\n- Correlation spike detection',
    gamma_scaling: '- Scale gamma with distance from strikes\\n- Dynamic based on realized vol',
  };

  return ideas[mutationType] || '- Focus on structural Greek relationships';
}

/**
 * Build synthesis prompt for aggregating mutation results - Universal Symphony Edition
 */
export function buildEvolutionSynthesisPrompt(
  baseStrategyDescription: string,
  mutationResults: { role: string; content: string }[]
): string {
  const results = mutationResults
    .map((r, i) => `### Mutation Agent ${i + 1} (${r.role})\n${r.content}`)
    .join('\n\n---\n\n');

  return `# Universal Symphony Synthesis - The Architect's Judgment

You are The Architect - evaluating ${mutationResults.length} mutations for the Universal Symphony portfolio.
Your goal: Select strategies that work TOGETHER as a coordinated orchestra, not individual winners.

## Target: 1% Daily Returns via Regime Rotation

${UNIVERSAL_PHYSICS}

## Base Strategy
${baseStrategyDescription}

${REGIME_FRAMEWORK}

${CONVEXITY_PROFILES}

## Mutation Results

${results}

---

## Your Synthesis Task - Symphony Selection

### Evaluation Criteria (STRICT)

**1. Universal Physics Compliance** (Pass/Fail)
- ❌ REJECT if mutation is just parameter optimization (RSI 14→20, threshold 2%→3%)
- ❌ REJECT if no regime declaration
- ❌ REJECT if no Exit Velocity clause
- ✅ ACCEPT only structural mutations with regime awareness

**2. Symphony Contribution** (Score 1-10)
- Does this COMPLEMENT existing strategies?
- Would it make money when others LOSE? (negative correlation = 10)
- Is it a duplicate of existing exposure? (correlation > 0.7 = 0)

**3. Structural Quality** (Score 1-10)
- Is the Greek relationship logic sound?
- Does the regime trigger make sense?
- Is Exit Velocity properly implemented?

**4. Regime Coverage** (Which regime does it hunt?)
- LOW_VOL_GRIND: For calm uptrends
- HIGH_VOL_OSCILLATION: For choppy markets
- CRASH_ACCELERATION: For panic selling
- MELT_UP: For FOMO rallies

## Output Format

### Universal Physics Audit
| Agent | Mutation | Structural? | Regime Declared? | Exit Velocity? | PASS/FAIL |
|-------|----------|-------------|------------------|----------------|-----------|
[Fill table for each mutation]

### Symphony Fit Analysis
| Agent | Target Regime | Correlation Risk | Symphony Score |
|-------|---------------|------------------|----------------|
[Analyze how each fits the portfolio]

### Top 3 Symphony Candidates
Select the 3 best mutations that TOGETHER create a diversified regime-rotation portfolio:

#### Candidate 1: [Name] - Hunts [REGIME]
**Why Selected**: [Structural edge explanation]
**Symphony Role**: [How it complements others]
**Exit Velocity**: [Time/threshold used]
\`\`\`python
[Full code block]
\`\`\`

#### Candidate 2: [Name] - Hunts [REGIME]
[Same format]

#### Candidate 3: [Name] - Hunts [REGIME]
[Same format]

### Rejected Mutations
| Agent | Reason for Rejection |
|-------|---------------------|
[List rejections with specific Universal Physics violations]

### Regime Coverage Assessment
- LOW_VOL_GRIND: [Covered by Candidate X / NOT COVERED]
- HIGH_VOL_OSCILLATION: [Covered by Candidate X / NOT COVERED]
- CRASH_ACCELERATION: [Covered by Candidate X / NOT COVERED]
- MELT_UP: [Covered by Candidate X / NOT COVERED]

### Next Evolution Focus
Based on regime coverage gaps, the next swarm should focus on: [MISSING_REGIME]`;
}

// ============================================================================
// Slash Command Configuration
// ============================================================================

/**
 * Configuration for the /evolve_strategy command
 */
export const EVOLVE_STRATEGY_CONFIG = {
  name: 'evolve_strategy',
  description: 'Run genetic algorithm evolution on a trading strategy using 20+ mutation agents',
  usage: '/evolve_strategy [strategy_name or description]',
  defaultAgentCount: 20,
  maxAgentCount: 50,
  mode: 'evolution' as const,
  tier: 'swarm' as const,
};

/**
 * Parse /evolve_strategy command arguments
 */
export function parseEvolveCommand(args: string): {
  strategyRef: string;
  agentCount: number;
} {
  // Check for agent count flag: /evolve_strategy my_strategy --agents=30
  const agentMatch = args.match(/--agents?=(\d+)/i);
  const agentCount = agentMatch
    ? Math.min(parseInt(agentMatch[1], 10), EVOLVE_STRATEGY_CONFIG.maxAgentCount)
    : EVOLVE_STRATEGY_CONFIG.defaultAgentCount;

  // Remove the flag from args to get strategy reference
  const strategyRef = args.replace(/--agents?=\d+/gi, '').trim();

  return { strategyRef, agentCount };
}
