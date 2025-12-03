/**
 * Knowledge Base Context - Shared across all agent prompts
 *
 * Provides consistent instructions for using Obsidian and Knowledge Graph
 * tools across all agent modes.
 *
 * Updated: 2025-12-03 - Created for comprehensive memory integration
 */

/**
 * Core knowledge base instructions for all agents
 * Use this in every prompt that should interact with the knowledge base
 */
export const KNOWLEDGE_BASE_CORE = `
## Knowledge Base Integration (REQUIRED)

You have access to the quant-engine Obsidian knowledge base and knowledge graph.
**USE THESE TOOLS - they contain critical prior work and learnings.**

### Before Starting ANY Analysis

\`\`\`
obsidian_search_notes(query="[topic you're analyzing]")  // Check what we already know
obsidian_read_note(path="08-Learnings/what-failed/")     // Check what NOT to do
\`\`\`

### Knowledge Base Structure

| Folder | Contains | When to Check |
|--------|----------|---------------|
| 06-Strategies/ | Exact strategy specs | Before analyzing any strategy |
| 07-Backtest-Results/ | Validated backtest results | Before running new backtests |
| 08-Learnings/what-worked/ | Successful approaches | Before proposing solutions |
| 08-Learnings/what-failed/ | Failed approaches | ALWAYS check first |
| 08-Learnings/overfitting-warnings/ | Known traps | Before trusting any result |
| DECISIONS.md | Architectural decisions | Before suggesting changes |

### After Completing Analysis

**Document significant findings:**
- Successful pattern found → \`obsidian_document_learning(category="what-worked", ...)\`
- Failure mode identified → \`obsidian_document_learning(category="what-failed", ...)\`
- Overfitting trap found → \`obsidian_document_learning(category="overfitting-warning", ...)\`
- Backtest completed → \`obsidian_document_backtest(...)\`

**Philosophy:** The knowledge base is institutional memory. Query before guessing. Document after learning.
`;

/**
 * Short version for prompts with token constraints
 */
export const KNOWLEDGE_BASE_SHORT = `
## Knowledge Base (USE IT)

**Before analysis:** \`obsidian_search_notes("[topic]")\` to check prior work
**After analysis:** Document findings with \`obsidian_document_learning(...)\`

Key folders:
- 06-Strategies/ - Strategy specs
- 07-Backtest-Results/ - Validated results
- 08-Learnings/ - What worked/failed/overfitting warnings
`;

/**
 * Pattern miner specific - emphasizes saving discovered patterns
 */
export const KNOWLEDGE_BASE_PATTERN_MINER = `
## Knowledge Base Integration

**BEFORE mining patterns:**
\`\`\`
obsidian_search_notes(query="patterns [strategy/regime]")
obsidian_read_note(path="08-Learnings/")
\`\`\`

**AFTER discovering patterns:**
For each significant pattern found:
\`\`\`
obsidian_document_learning(
  category="what-worked" or "what-failed",
  title="[Pattern name]",
  context="Pattern mining across [N] runs",
  details="[Pattern description]",
  why="[Root cause analysis]",
  next_steps="[How to exploit or avoid]"
)
\`\`\`

**Patterns worth documenting:**
- Repeated success conditions (what-worked)
- Repeated failure conditions (what-failed)
- Cross-strategy insights
- Regime-dependent behaviors
`;

/**
 * Risk officer specific - emphasizes documenting risk discoveries
 */
export const KNOWLEDGE_BASE_RISK = `
## Knowledge Base Integration

**BEFORE risk analysis:**
\`\`\`
obsidian_search_notes(query="risk [strategy/regime]")
obsidian_read_note(path="08-Learnings/overfitting-warnings/")
\`\`\`

**AFTER identifying risks:**
For critical risks discovered:
\`\`\`
obsidian_document_learning(
  category="what-failed",
  title="[Risk name]",
  context="Risk analysis of [strategies/period]",
  details="[Risk description and severity]",
  why="[Structural cause]",
  next_steps="[Mitigation strategies]"
)
\`\`\`

For overfitting traps found:
\`\`\`
obsidian_document_learning(
  category="overfitting-warning",
  title="[Trap name]",
  context="[How discovered]",
  details="[What looks good but isn't]",
  why="[Why it's overfit]",
  next_steps="[How to detect/avoid]"
)
\`\`\`
`;

/**
 * Experiment director specific - emphasizes checking prior experiments
 */
export const KNOWLEDGE_BASE_EXPERIMENT = `
## Knowledge Base Integration

**BEFORE proposing experiments:**
\`\`\`
obsidian_search_notes(query="experiment [strategy/hypothesis]")
obsidian_search_notes(query="backtest [strategy]")
obsidian_read_note(path="07-Backtest-Results/")  // See what's been tested
obsidian_read_note(path="08-Learnings/what-failed/")  // Don't repeat failures
\`\`\`

**Check existing coverage:**
- What regimes have been tested?
- What parameters have been explored?
- What experiments failed and why?

**AFTER experiments run:**
Ensure results are documented:
\`\`\`
obsidian_document_backtest(
  strategy_name="...",
  start_date="...",
  end_date="...",
  sharpe_ratio=X.XX,
  max_drawdown=X.X,
  validated=true/false,
  notes="..."
)
\`\`\`
`;

/**
 * Auditor specific - emphasizes checking rules alignment
 */
export const KNOWLEDGE_BASE_AUDITOR = `
## Knowledge Base Integration

**BEFORE auditing:**
\`\`\`
obsidian_search_notes(query="[strategy name]")
obsidian_read_note(path="06-Strategies/[strategy]/SPEC.md")  // Get exact spec
obsidian_read_note(path="DECISIONS.md")  // Check architectural decisions
\`\`\`

**Verify alignment with:**
- Documented strategy specification
- Existing rules and constraints
- Known failure modes

**AFTER audit:**
Document significant findings:
\`\`\`
obsidian_document_learning(
  category="what-worked" or "what-failed",
  title="[Audit finding]",
  context="Audit of [strategy] on [date range]",
  details="[Finding details]",
  why="[Root cause]",
  next_steps="[Recommendations]"
)
\`\`\`
`;

/**
 * Red team specific - check existing code issues
 */
export const KNOWLEDGE_BASE_RED_TEAM = `
## Knowledge Base Integration

**BEFORE code audit:**
\`\`\`
obsidian_search_notes(query="code [module name]")
obsidian_search_notes(query="bug [component]")
obsidian_read_note(path="08-Learnings/what-failed/")  // Known code issues
\`\`\`

**AFTER finding issues:**
For significant code issues:
\`\`\`
obsidian_document_learning(
  category="what-failed",
  title="[Issue name] in [file]",
  context="Red team audit of [file path]",
  details="[Issue description]",
  why="[Root cause - why this is a problem]",
  next_steps="[How to fix]"
)
\`\`\`
`;

/**
 * Evolution/mutation specific - check what mutations failed before
 */
export const KNOWLEDGE_BASE_EVOLUTION = `
## Knowledge Base Integration

**BEFORE generating mutations:**
\`\`\`
obsidian_search_notes(query="mutation [strategy]")
obsidian_search_notes(query="evolution [strategy]")
obsidian_read_note(path="08-Learnings/what-failed/")  // Failed mutation approaches
obsidian_read_note(path="08-Learnings/overfitting-warnings/")  // Overfitting traps
\`\`\`

**Avoid:**
- Mutation types that have failed before
- Parameter ranges that lead to overfitting
- Approaches that contradict structural principles

**AFTER successful mutations:**
Document winning mutations:
\`\`\`
obsidian_document_learning(
  category="what-worked",
  title="[Mutation type] on [strategy]",
  context="Evolution run [date]",
  details="[Mutation description and results]",
  why="[Why this mutation worked]",
  next_steps="[How to apply to other strategies]"
)
\`\`\`
`;

/**
 * Helper to build the appropriate knowledge base section
 */
export function buildKnowledgeBaseContext(agentType:
  'general' | 'pattern_miner' | 'risk' | 'experiment' | 'auditor' | 'red_team' | 'evolution' | 'short'
): string {
  switch (agentType) {
    case 'pattern_miner':
      return KNOWLEDGE_BASE_PATTERN_MINER;
    case 'risk':
      return KNOWLEDGE_BASE_RISK;
    case 'experiment':
      return KNOWLEDGE_BASE_EXPERIMENT;
    case 'auditor':
      return KNOWLEDGE_BASE_AUDITOR;
    case 'red_team':
      return KNOWLEDGE_BASE_RED_TEAM;
    case 'evolution':
      return KNOWLEDGE_BASE_EVOLUTION;
    case 'short':
      return KNOWLEDGE_BASE_SHORT;
    default:
      return KNOWLEDGE_BASE_CORE;
  }
}
