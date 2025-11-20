/**
 * Autonomous Research Loop Prompt Template
 * 
 * Used when the Chief Quant synthesizes all agent mode outputs
 * into a comprehensive research report.
 */

export function buildAutoAnalyzePrompt(scope: string, analysisInput: string): string {
  const scopeNote = scope ? `\n\n**Analysis Focus**: ${scope}` : '';

  return `
You are now operating in **Autonomous Research Loop mode**.

Your task: Integrate evidence from runs, memory, patterns, risks, and experiments into a comprehensive Research Report that advances understanding of structural edge and performance drivers.${scopeNote}

---

## Analysis Input

${analysisInput}

---

## Required Output

Produce a structured Research Report with the following sections:

### 1. Executive Summary
Brief overview of key findings (2-3 sentences). What's the most important thing to know?

### 2. Key Observations (Data-Backed)
List 3-7 concrete observations supported by run data, metrics, or patterns.
- Each observation must reference specific evidence (run IDs, metrics, date ranges)
- Focus on structural characteristics, not just P&L
- Highlight what worked, what failed, and under what conditions

### 3. Structural Conclusions
Deeper analysis of:
- **Convexity**: Where is payoff asymmetry? Which strategies have positive/negative convexity?
- **Regime Dependencies**: Which market conditions favor/destroy performance?
- **Failure Modes**: What structural weaknesses exist? What triggers breakdowns?

### 4. Conflicts or Rule Violations
Identify:
- Contradictions between runs and existing rules/warnings
- Rule violations (strategies behaving contrary to documented constraints)
- Conflicts between different memory notes or agent findings
- Evidence that invalidates prior beliefs

### 5. Recommended Experiments
List 3-8 concrete next experiments prioritized by information gain:
- Strategy/profile to test
- Date range with regime rationale
- Hypothesis and what it would prove/disprove
- Success criteria

### 6. Updated Understanding
How should the mental model shift based on this analysis?
- What new patterns emerged?
- What old assumptions were challenged?
- What structural insights changed?

### 7. Suggested Memory Updates
Recommend specific memory changes (user must manually confirm):
- Rules to add/promote/demote
- Insights to preserve
- Notes to archive or merge
- New warnings to document

### 8. Long-Term Risk Flags
Identify systemic risks that could undermine performance:
- Structural vulnerabilities that persist across runs
- Regime exposures that remain untested
- Rule violations that suggest fundamental issues
- Tail risks or failure mode concentrations

---

## Style Guidelines

- **Concise and Technical**: No fluff, every sentence must add value
- **Evidence-Driven**: Reference specific runs, metrics, dates
- **Clear About Uncertainty**: Distinguish confident conclusions from hypotheses
- **Actionable**: Recommendations must be concrete and testable
- **Conservative on Risk**: Highlight downside more than upside

Focus on structural edge, not curve-fitting. Prioritize learning over P&L optimization.
`.trim();
}
