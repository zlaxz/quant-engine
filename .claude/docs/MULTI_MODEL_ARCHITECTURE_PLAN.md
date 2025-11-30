# Multi-Model Quant Engine Architecture Plan

**Created:** 2025-11-30
**Status:** Implementation In Progress
**Purpose:** 10X Quant Research System - Gemini thinks, Claude executes, DeepSeek parallelizes

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      GEMINI 3 PRO                            │
│                   "The Mathematician"                        │
│              (API - pay for reasoning only)                  │
│                                                              │
│  • Alpha hypothesis, complex math, strategy formulation      │
│  • Hands off execution via: execute_via_claude_code()        │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  CLAUDE CODE CLI                             │
│                  "The Orchestrator"                          │
│              (Max subscription - fixed cost)                 │
│                                                              │
│  SINGLE/MINOR TASKS:                                         │
│  └──► Handle directly or spawn Claude native agents (free)  │
│       • File operations, code gen, tests                     │
│       • Simple analysis, code review                         │
│       • 1-5 parallel tasks                                   │
│                                                              │
│  MASSIVE PARALLEL COMPUTE:                                   │
│  └──► Spawn DeepSeek agents via curl (cost-efficient)       │
│       • Analyze all 6 regimes simultaneously                │
│       • 50+ parameter sweeps                                 │
│       • Bulk data processing                                 │
│       • 5+ parallel independent tasks                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ (Only for MASSIVE parallel)
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
   │ DeepSeek    │  │ DeepSeek    │  │ DeepSeek    │
   │ Regime      │  │ Profile     │  │ Risk        │
   │ Agent       │  │ Agent       │  │ Agent       │
   │ (curl API)  │  │ (curl API)  │  │ (curl API)  │
   └─────────────┘  └─────────────┘  └─────────────┘
         $0.14/1M input, $0.42/1M output (95% cheaper)
```

### Agent Decision Matrix

| Parallelization | Agent Type | Cost | Use When |
|-----------------|------------|------|----------|
| None | Claude direct | Free (Max) | Single tasks, simple operations |
| Minor (2-5) | Claude native agents | Free (Max) | Small parallel work |
| Massive (5+) | DeepSeek via curl | ~$0.56/1M | Bulk processing, sweeps |

---

## Dual Supabase Memory Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CLAUDE CODE SUPABASE                     │
│                  (cbohxvsvjbtxzxpyepso)                      │
│                                                              │
│  • General lessons ("always verify API data")                │
│  • Cross-project patterns                                    │
│  • Identity/behavioral rules                                 │
│  • Non-quant project memories                                │
│                                                              │
│  LOW VOLUME, HIGH SIGNAL, GENERAL PURPOSE                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     QUANT ENGINE SUPABASE                    │
│                  (ynaqtawyynqikfyranda)                      │
│                                                              │
│  • Alpha hypotheses & strategies                             │
│  • Backtest results & analysis                               │
│  • Regime classifications                                    │
│  • Greeks, vol surfaces, options data                        │
│  • Session contexts (Gemini ↔ Claude ↔ DeepSeek)            │
│                                                              │
│  HIGH VOLUME, DOMAIN SPECIFIC, QUANT ONLY                    │
└─────────────────────────────────────────────────────────────┘
```

### Session Bridge Behavior

When in quant-engine directory:
1. **Load from BOTH** Supabases at session start
2. **Write quant-specific** → Quant Supabase
3. **Write general lessons** → Claude Supabase
4. **Session context** shared via `session_contexts` table

---

## Cost Model

| Tier | Model           | Purpose                 | Cost            |
|------|-----------------|-------------------------|-----------------|
| 1    | Gemini 3 Pro    | Complex reasoning       | API tokens      |
| 2    | Claude Code CLI | Orchestration, code gen | Fixed (Max sub) |
| 3    | DeepSeek        | Bulk parallel agents    | $0.56/1M avg    |

**Estimated monthly:** $175-360 (60-70% savings vs all-API)

---

## Implementation Phases

### Phase 0: Foundation ✅
- [x] 0.1 Fix spawn_agent issue (works in CLI, needs app testing)
- [x] 0.2 Create session_contexts table in Quant Supabase

### Phase 1: Gemini → Claude Code Handoff ✅
- [x] 1.1 Create `execute_via_claude_code` tool definition
- [x] 1.2 Implement handler in toolHandlers.ts
- [x] 1.3 Update Gemini system prompt with routing guidance

### Phase 2: Claude Code → DeepSeek Agents ⏳
- [ ] 2.1 Create DeepSeek agent spawning prompt for Claude
- [ ] 2.2 Enhance deepseek_agent.py for structured output

### Phase 3: Unified Memory Integration ✅
- [x] 3.1 Add Quant Supabase credentials to Claude Code .env
- [x] 3.2 Project-aware memory retrieval (--supabase flag)
- [ ] 3.3 Dual-write classification (general vs domain)

### Phase 4: UI Integration 🔜
- [ ] 4.1 Model indicator in chat (🧠 Gemini / ⚡ Claude / 🔀 DeepSeek)
- [ ] 4.2 Execution progress panel for Claude Code
- [ ] 4.3 Memory/context viewer

### Phase 5: Session End Consolidation 🔜
- [ ] 5.1 Auto-consolidate to LTM
- [ ] 5.2 Cross-model learning tracking

---

## Key Files Modified

### Infrastructure
- `supabase/migrations/20251130000000_add_session_contexts.sql` - Multi-model coordination
- `~/.claude/.env` - Added Quant Supabase credentials
- `~/.claude/scripts/memory-retriever` - Dual-Supabase support
- `~/.claude/hooks/session-start-memory-recall.sh` - Project-aware loading

### Quant Engine
- `src/electron/tools/toolDefinitions.ts` - Added CLAUDE_TOOLS
- `src/electron/tools/toolHandlers.ts` - executeViaClaudeCode handler
- `src/prompts/chiefQuantPrompt.ts` - Multi-model routing guidance

---

## Tool: execute_via_claude_code

```typescript
{
  name: 'execute_via_claude_code',
  description: 'Hand off execution task to Claude Code CLI...',
  parameters: {
    task: string,      // What to execute
    context: string,   // Gemini's reasoning (optional)
    spawn_agents: bool // Allow DeepSeek parallel work
  }
}
```

**When Gemini should use this:**
- Writing new code files or modules
- Running and debugging Python scripts
- Git operations (commits, branches)
- Multi-step file modifications
- Running test suites
- Complex refactoring tasks

**When Gemini should NOT use this:**
- Simple file reads (use read_file directly)
- Quick data inspection (use run_python_script)
- Pure reasoning/analysis

---

## Testing Checklist

- [ ] Test execute_via_claude_code from Quant Engine app
- [ ] Verify session_contexts logs written to Quant Supabase
- [ ] Test full Gemini → Claude Code → DeepSeek flow
- [ ] Verify dual-Supabase memory recall at session start
- [ ] Test production build with packaged scripts

---

## Session Notes

### 2025-11-30 - Initial Implementation
- Created comprehensive plan document
- Implemented Phase 0, 1, 3 (partial)
- Memory bridge working
- execute_via_claude_code tool implemented
- Routing guidance added to Gemini prompt

**Next:** Test full flow in app, then Phase 2 (DeepSeek spawning)
