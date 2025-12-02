/**
 * Code-Aware Prompt Template
 *
 * Used when the CIO needs to analyze rotation-engine source code
 * to understand strategy behavior, identify structural implications,
 * and link code to observed performance patterns.
 */

export function buildCodeAwarePrompt(code: string, context: string): string {
  return `
You are now analyzing rotation-engine source code.

CONTEXT:
${context}

CODE:
\`\`\`
${code}
\`\`\`

ANALYSIS TASK:
1. **Code Summary**:
   - What does this code do?
   - Entry logic, exit logic, filters, parameters.

2. **Structural Implications**:
   - How does this affect convexity (payoff asymmetry)?
   - What regime dependencies exist?
   - What are the risk characteristics?

3. **Link to Known Patterns**:
   - Which failure patterns might be explained by this code?
   - Which rules/warnings in memory are relevant?
   - Are there obvious structural weaknesses?

4. **Experiment Suggestions**:
   - Which parameters should be tested?
   - Which conditions/regimes should be explored?
   - What would confirm or refute hypotheses about this code?

Be concrete and evidence-based. Focus on structural edge, not just P&L optimization.
`.trim();
}
