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

/**
 * System prompt for mutation agents
 */
export const MUTATION_AGENT_SYSTEM = `You are a genetic algorithm mutation agent specializing in options trading strategy evolution.

Your task is to take a base strategy and mutate it in ONE specific way to potentially improve its convexity or edge.

${buildFrameworkWithGreeks()}

## Mutation Guidelines

1. **Be Specific**: Make ONE clear, implementable change
2. **Preserve Core Logic**: Don't break the strategy's fundamental approach
3. **Explain Rationale**: Why might this mutation improve performance?
4. **Consider Trade-offs**: What might get worse? What gets better?
5. **Code-Ready**: Your mutation should be directly implementable

## Output Format

Structure your response as:

### Mutation Type
[Type of mutation being applied]

### Change Description
[Specific change being made]

### Implementation
\`\`\`python
# Original code section (if applicable)
...

# Mutated code section
...
\`\`\`

### Rationale
[Why this might improve the strategy]

### Expected Impact
- Positive: [What should improve]
- Negative: [What might get worse]
- Risk: [New risks introduced]

### Regime Sensitivity
[Which regimes this mutation targets/affects]`;

/**
 * Build mutation prompt for a specific agent
 */
export function buildMutationPrompt(
  strategyCode: string,
  strategyDescription: string,
  mutationType: MutationType,
  agentIndex: number,
  totalAgents: number
): string {
  const mutationDesc = MUTATION_DESCRIPTIONS[mutationType];

  return `## Your Mutation Assignment

You are Agent ${agentIndex + 1} of ${totalAgents} in an evolutionary strategy optimization swarm.

**Your Mutation Type**: ${mutationType}
**Mutation Description**: ${mutationDesc}

## Base Strategy

### Description
${strategyDescription}

### Code
\`\`\`python
${strategyCode}
\`\`\`

## Your Task

Apply a **${mutationType}** mutation to this strategy. Your mutation should:

1. Focus specifically on: ${mutationDesc}
2. Be different from what other agents might try (you're agent ${agentIndex + 1}/${totalAgents})
3. Aim to increase convexity or improve risk-adjusted returns
4. Maintain the strategy's core hypothesis

Remember: We're running ${totalAgents} parallel mutations. Be creative but practical.`;
}

/**
 * Build synthesis prompt for aggregating mutation results
 */
export function buildEvolutionSynthesisPrompt(
  baseStrategyDescription: string,
  mutationResults: { role: string; content: string }[]
): string {
  const results = mutationResults
    .map((r, i) => `### Mutation Agent ${i + 1} (${r.role})\n${r.content}`)
    .join('\n\n---\n\n');

  return `# Evolutionary Strategy Synthesis

You are evaluating ${mutationResults.length} mutations proposed by a genetic algorithm swarm.

## Base Strategy
${baseStrategyDescription}

${REGIME_FRAMEWORK}

${CONVEXITY_PROFILES}

## Mutation Results

${results}

---

## Your Synthesis Task

1. **Rank Mutations by Potential**
   Rate each mutation on a 1-10 scale for:
   - Likely improvement to Sharpe ratio
   - Increase in convexity
   - Implementation complexity
   - Risk of breaking the strategy

2. **Identify Top 3 Mutations**
   Select the three most promising mutations and explain why.

3. **Suggest Combinations**
   Are there mutations that could be combined for compound improvement?

4. **Flag Red Flags**
   Which mutations might introduce bugs or logical errors?

5. **Recommend Next Steps**
   What should be tested first? In what order?

## Output Format

Provide your synthesis as:

### Mutation Rankings
[Table with scores]

### Top 3 Recommendations
1. [Best mutation with rationale]
2. [Second best with rationale]
3. [Third best with rationale]

### Promising Combinations
[Mutations that work well together]

### Red Flags
[Mutations to avoid or be careful with]

### Testing Roadmap
[Ordered list of what to test]`;
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
