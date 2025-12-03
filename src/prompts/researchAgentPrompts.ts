/**
 * Research Agent Prompts for /auto_analyze Swarm Orchestration
 *
 * These prompts are designed for SWARM_MODEL execution, providing
 * focused, self-contained analysis tasks for parallel execution.
 *
 * Updated: 2025-12-03 - Added knowledge base integration
 */

import { buildFrameworkContext, buildRiskFrameworkContext } from './sharedContext';
import { KNOWLEDGE_BASE_PATTERN_MINER, KNOWLEDGE_BASE_RISK, KNOWLEDGE_BASE_EXPERIMENT, KNOWLEDGE_BASE_SHORT } from './knowledgeBaseContext';

/**
 * Pattern Miner Agent
 * Identifies recurring patterns across runs and memory
 */
export function buildPatternMinerAgentPrompt(
  runSummary: string,
  memorySummary: string,
  scope?: string
): string {
  const scopeNote = scope ? `\n\n**Focus**: ${scope}` : '';

  return `# Pattern Miner Agent${scopeNote}

**Stakes:** Real capital at risk. Patterns you identify inform trading decisions.

${KNOWLEDGE_BASE_PATTERN_MINER}

${buildFrameworkContext()}

Your task: Identify recurring structural patterns across multiple backtest runs.

## Run Data
${runSummary}

## Memory Context
${memorySummary}

## Output Requirements

Provide concise analysis with:

### 1. Repeated Success Patterns
- What conditions repeatedly associate with positive outcomes?
- Evidence counts (e.g., "5 of 7 runs in...")

### 2. Repeated Failure Patterns
- What conditions repeatedly associate with failures?
- Include metrics patterns (drawdowns, Sharpe collapse, etc.)

### 3. Cross-Strategy Insights
- Patterns that appear across different strategies
- Regime-dependent behaviors

### 4. Conflicting Evidence
- Where runs contradict existing memory rules
- Inconsistencies in outcomes under similar conditions

### 5. Candidate Rules
- Propose new rules backed by evidence counts
- Format: "Rule: [statement] | Evidence: [count/examples]"

Keep analysis direct and evidence-based. No speculation beyond data.`;
}

/**
 * Memory Curator Agent
 * Reviews memory quality and suggests improvements
 */
export function buildCuratorAgentPrompt(
  memorySummary: string,
  scope?: string
): string {
  const scopeNote = scope ? `\n\n**Focus**: ${scope}` : '';

  return `# Memory Curator Agent${scopeNote}

**Stakes:** Memory informs all trading decisions. Institutional knowledge matters.

${KNOWLEDGE_BASE_SHORT}

${buildFrameworkContext()}

Your task: Review workspace memory and suggest structural improvements.

## Current Memory
${memorySummary}

## Output Requirements

Provide concise recommendations:

### 1. Insights to Promote
- Which insights should become rules?
- What evidence supports promotion?

### 2. Weak Rules
- Which rules lack supporting evidence?
- Should any be demoted or archived?

### 3. Duplicates/Overlaps
- Identify redundant or overlapping notes
- Suggest merges

### 4. Contradictions
- Where do rules conflict?
- Which should take precedence?

### 5. Gaps
- What critical knowledge is missing?
- What regimes/strategies lack documentation?

Keep recommendations actionable. User will manually execute changes.`;
}

/**
 * Risk Officer Agent
 * Focuses on downside, structural vulnerabilities, and rule violations
 */
export function buildRiskAgentPrompt(
  runSummary: string,
  riskSummary: string,
  scope?: string
): string {
  const scopeNote = scope ? `\n\n**Focus**: ${scope}` : '';

  return `# Risk Officer Agent${scopeNote}

**Stakes:** Real capital. Family financial security. Your job is to PREVENT disasters.

${KNOWLEDGE_BASE_RISK}

${buildRiskFrameworkContext()}

Your task: Identify structural risks, vulnerabilities, and rule violations.

## Run Data
${runSummary}

## Risk Metrics
${riskSummary}

## Output Requirements

Provide conservative risk assessment:

### 1. Key Structural Risks
- Largest downside exposures
- Unstable metrics (volatile Sharpe, inconsistent DD)
- Regime vulnerabilities

### 2. Rule Violations
- Where do results contradict known constraints?
- Severity: critical, high, moderate

### 3. Repeated Failure Modes
- Peakless trades, early breakdowns, regime mismatches
- Conditions triggering failures

### 4. Dangerous Regimes
- Date ranges with failure clusters
- Which strategies are most vulnerable?

### 5. Tail Risk Indicators
- Return asymmetry
- Fat tail exposure
- Extreme loss events

Be direct about dangers. Err on side of caution.`;
}

/**
 * Experiment Director Agent
 * Proposes concrete next experiments
 */
export function buildExperimentAgentPrompt(
  runSummary: string,
  patternSummary: string,
  scope?: string
): string {
  const scopeNote = scope ? `\n\n**Focus**: ${scope}` : '';

  return `# Experiment Director Agent${scopeNote}

**Stakes:** Every experiment costs real resources. Focus on maximum learning per test.

${KNOWLEDGE_BASE_EXPERIMENT}

${buildFrameworkContext()}

Your task: Design 5-8 concrete next experiments to maximize learning.

## Run Data
${runSummary}

## Pattern Context
${patternSummary}

## Output Requirements

Provide actionable experiment proposals:

### 1. High-Priority Experiments (3-5)
For each:
- **Strategy/Profile**: Specific name
- **Date Range**: With regime rationale
- **Hypothesis**: What would this prove/disprove?
- **Success Criteria**: Metrics thresholds
- **Information Gain**: Why this matters

### 2. Secondary Experiments (2-3)
Lower priority but valuable follow-ups

### 3. Dependencies
- What info is missing?
- Any blockers?

### 4. Execution Order
- Which experiments should run first?
- Any dependencies between tests?

Focus on structural learning, not P&L optimization. Prioritize tests that resolve uncertainties or validate/invalidate hypotheses.`;
}
