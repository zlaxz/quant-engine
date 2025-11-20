/**
 * Red Team Auditor Prompt Templates
 * Each auditor focuses on a specific aspect of code quality and robustness
 */

/**
 * Strategy Logic Auditor
 * Analyzes whether implementation logic matches expected strategy behavior
 */
export function buildStrategyLogicAuditPrompt(
  code: string,
  path: string,
  context: string
): string {
  return `You are one member of a multi-agent red team conducting a code audit.
Your role: **Strategy Logic Auditor**

You are reviewing rotation-engine code at: ${path}

${context ? `Context: ${context}\n` : ''}

Code to audit:
\`\`\`
${code}
\`\`\`

Your task:
1. Summarize what this strategy is doing (entry criteria, exit criteria, signal flow)
2. Identify logical inconsistencies or missing checks
3. Analyze behavior across different market regimes (high vol, low vol, gaps, quiet periods)
4. Check edge conditions: no trades, missing data, invalid signals, extreme values
5. Suggest specific code-level fixes for any issues found

Output format:
### Strategy Logic Audit

**Summary:**
<brief description of strategy logic>

**Findings:**
- <bullet point 1>
- <bullet point 2>
...

**Concrete Suggestions:**
- <specific fix 1>
- <specific fix 2>
...

**Suggested Tests:**
- <test scenario 1>
- <test scenario 2>
...`;
}

/**
 * Overfit Auditor
 * Looks for signs of overfitting in implementation
 */
export function buildOverfitAuditPrompt(
  code: string,
  path: string,
  context: string
): string {
  return `You are one member of a multi-agent red team conducting a code audit.
Your role: **Overfit Auditor**

You are reviewing rotation-engine code at: ${path}

${context ? `Context: ${context}\n` : ''}

Code to audit:
\`\`\`
${code}
\`\`\`

Your task:
1. Identify signs of overfitting:
   - Too many special-case branches
   - Hardcoded date ranges or known events
   - Overly complex conditionals tuned to specific values
   - Magic numbers without clear justification
2. Where does this implementation encode brittle assumptions?
3. Which parameters or branches look "fit" to historical quirks?
4. How might we simplify or parameterize for robustness?

Output format:
### Overfit Audit

**Summary:**
<brief assessment of overfitting risk>

**Findings:**
- <overfitting indicator 1>
- <overfitting indicator 2>
...

**Brittle Assumptions:**
- <assumption 1>
- <assumption 2>
...

**Concrete Suggestions:**
- <simplification 1>
- <parameterization 2>
...`;
}

/**
 * Lookahead Bias Auditor
 * Detects lookahead bias and data leakage
 */
export function buildLookaheadBiasAuditPrompt(
  code: string,
  path: string,
  context: string
): string {
  return `You are one member of a multi-agent red team conducting a code audit.
Your role: **Lookahead Bias / Data Leakage Auditor**

You are reviewing rotation-engine code at: ${path}

${context ? `Context: ${context}\n` : ''}

Code to audit:
\`\`\`
${code}
\`\`\`

Your task:
1. Detect lookahead bias and data leakage:
   - Future data used in current decisions
   - Post-trade information used to decide entries/exits
   - Misaligned indexing of arrays / time series
   - Using "close" instead of "open" for same-day entries
   - Calculating indicators that peek ahead
2. Identify any use of future timestamps, bars, or labels
3. Call out suspicious indexing or data access patterns
4. Suggest how to restructure to avoid lookahead

Output format:
### Lookahead Bias Audit

**Summary:**
<brief assessment of lookahead risk>

**Findings:**
- <potential lookahead issue 1>
- <potential lookahead issue 2>
...

**Suspicious Patterns:**
- <pattern 1 with line reference>
- <pattern 2 with line reference>
...

**Concrete Suggestions:**
- <restructuring suggestion 1>
- <restructuring suggestion 2>
...`;
}

/**
 * Robustness Auditor
 * Checks for robustness and edge case handling
 */
export function buildRobustnessAuditPrompt(
  code: string,
  path: string,
  context: string
): string {
  return `You are one member of a multi-agent red team conducting a code audit.
Your role: **Robustness / Edge-Case Auditor**

You are reviewing rotation-engine code at: ${path}

${context ? `Context: ${context}\n` : ''}

Code to audit:
\`\`\`
${code}
\`\`\`

Your task:
1. Audit for robustness and edge cases:
   - Handling of NaNs, None, null, empty datasets
   - Behavior at start/end of data (insufficient history)
   - Division by zero or near-zero values
   - Performance in extreme conditions (crashes, gaps, halts)
   - Missing data handling
2. Where can this code throw exceptions or silently misbehave?
3. How does it behave when inputs are missing, malformed, or weird?
4. Suggest guardrails, defensive checks, and tests

Output format:
### Robustness Audit

**Summary:**
<brief assessment of robustness>

**Findings:**
- <edge case vulnerability 1>
- <edge case vulnerability 2>
...

**Failure Modes:**
- <failure mode 1>
- <failure mode 2>
...

**Concrete Suggestions:**
- <guardrail 1>
- <defensive check 2>
...

**Suggested Tests:**
- <edge case test 1>
- <edge case test 2>
...`;
}

/**
 * Implementation Consistency Auditor
 * Checks for consistency with rotation-engine patterns
 */
export function buildConsistencyAuditPrompt(
  code: string,
  path: string,
  context: string
): string {
  return `You are one member of a multi-agent red team conducting a code audit.
Your role: **Implementation Consistency Auditor**

You are reviewing rotation-engine code at: ${path}

${context ? `Context: ${context}\n` : ''}

Code to audit:
\`\`\`
${code}
\`\`\`

Your task:
1. Check for consistency with typical rotation-engine patterns:
   - Naming conventions (clear variable names)
   - Parameter defaults (sensible, documented)
   - Code structure (entry/exit logic separation)
   - Alignment with documented rules or memory notes (if context provided)
2. Are there places where this deviates from expected design?
3. Are parameters clearly defined and consistently used?
4. Which parts need refactoring for clarity/consistency?

Output format:
### Implementation Consistency Audit

**Summary:**
<brief assessment of consistency>

**Findings:**
- <consistency issue 1>
- <consistency issue 2>
...

**Deviations from Expected Design:**
- <deviation 1>
- <deviation 2>
...

**Concrete Suggestions:**
- <refactoring suggestion 1>
- <clarification suggestion 2>
...`;
}
