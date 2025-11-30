# 10X Claude Code Bridge Transparency Plan
## Consolidated Revision Integrating Claude Code's Feedback

---

## Core Vision

Transform Claude Code from a "black box execution" into a **transparent cognitive orchestrator** that:
- Shows WHY decisions are made (before execution)
- Shows WHAT is happening (during execution)  
- Shows WHAT CHANGED (after execution)
- Enables VERIFICATION of claims
- Surfaces FAILURES with actionable guidance

---

## Phase 1: Foundation (3-4 days)

### 1.1 Wire Existing Infrastructure
**Goal:** Make `OperationCard` actually useful

**Changes:**
- Update `chiefQuantPrompt.ts` with required markers:
  ```
  For EVERY tool execution:
  [WHY_THIS: tool_name] One sentence explaining why
  [WHAT_FOUND: tool_name] One sentence summarizing result
  ```
- Parse markers in `llmClient.ts`
- Populate `whyThis` and `whatFound` fields in `OperationCard`

**Success:** Every tool card shows "Why This?" and "What I Found"

---

### 1.2 Claude Code Error Visibility ⭐ NEW
**Goal:** When Claude Code fails, show WHY with actionable guidance

**Create:** `ClaudeCodeErrorCard.tsx`
```tsx
interface ClaudeCodeErrorCardProps {
  error: {
    type: 'syntax' | 'runtime' | 'timeout' | 'unknown';
    message: string;
    stderr?: string;
    suggestion: string;
    similarFailures?: Array<{date: string; resolution: string}>;
  };
}
```

**Displays:**
- ❌ Error type and message
- 💡 Suggested fix based on error pattern
- 📊 Similar past failures (if any)
- 🔄 Retry button with pre-filled fix

**Error Pattern Recognition:**
- Parse stderr for common patterns
- `ImportError` → "Missing dependency, add to requirements.txt"
- `SyntaxError` → "Check Python version compatibility"
- `Timeout` → "Task too complex, try breaking into steps"

**Success:** User understands WHY failure happened and HOW to fix

---

### 1.3 Working Memory with DIFFS ⭐ NEW
**Goal:** Show WHAT CHANGED, not just current state

**Update:** `WorkingMemoryCheckpoint` component

**Before:**
```
Task: Analyzing vol-of-vol
Progress: 85%
Current step: Testing on out-of-sample data
```

**After:**
```
Task: Analyzing vol-of-vol regime impact
Progress: [████████████░░] 85% Complete

FILES MODIFIED:
✏️ python/engine/plugins/vol_analyzer.py (+145 lines)
✏️ tests/test_vol_analyzer.py (+67 lines)

MENTAL MODEL EVOLUTION:
Before: "Regime transitions fail for unknown reasons"
After: "Vol-of-vol >0.25 → spread widening → failures"

VALIDATED INSIGHTS:
✓ r²=0.78 correlation confirmed
✓ Tests passed: 12/12
```

**Success:** User sees PROGRESS (what changed), not just status

---

## Phase 2: Decision Transparency (2-3 days)

### 2.1 Decision Card with Reasoning
**Goal:** User knows WHY handoffs happen

**Create:** `DecisionCard.tsx`
- Shows before execution starts
- Task type, confidence, alternatives considered
- One-sentence explanation

**Update:** `chiefQuantPrompt.ts`
```
Before calling execute_via_claude_code:
[DECISION: DELEGATE to Claude Code]
Task: <multi-file code generation>
Confidence: HIGH (87%)
Alternative: Direct handling (60% confidence)
Why: Requires git operations + multi-file coordination
```

**Success:** Every handoff has visible decision reasoning

---

### 2.2 Actionable Decisions ⭐ NEW
**Goal:** Let user override if they disagree

**Add to DecisionCard:**
```tsx
<div className="flex gap-2">
  <Button onClick={() => proceedWithDecision()}>
    Proceed with Claude Code
  </Button>
  <Button 
    variant="outline" 
    onClick={() => overrideDecision('direct-handling')}
  >
    Try Direct Handling Instead
  </Button>
</div>
```

**Implementation:**
- Override triggers alternative execution path
- Gemini attempts direct handling instead
- Result comparison stored for learning

**Success:** Trust through CONTROL, not just visibility

---

### 2.3 Cost Tracking Per Decision ⭐ NEW
**Goal:** Show tangible benefit of routing strategy

**Add to DecisionCard:**
```
ESTIMATED COST:
This approach (Claude Code): $0.00 (Max subscription)
Alternative (Gemini direct): $0.15 (6K tokens)

Savings: $0.15 ✓
```

**Success:** User sees CONCRETE savings from smart routing

---

## Phase 3: Execution State Machine (2-3 days)

### 3.1 Progress Visibility
**Goal:** User sees WHAT IS HAPPENING, not loading spinner

**Create:** `ClaudeCodeProgressPanel.tsx`
```tsx
interface ClaudeCodeProgressPanelProps {
  task: string;
  phase: 'analyzing' | 'generating' | 'testing' | 'finalizing';
  progress: number;
  elapsed: number;
  estimatedRemaining?: number;
}
```

**Displays:**
- Live timer counting up
- Phase-by-phase breakdown with checkmarks
- Progress bar
- Cancel button (if cancellation supported)

**IPC Events:**
```typescript
onClaudeCodeLifecycle: (event: {
  type: 'start' | 'phase' | 'complete' | 'error';
  phase?: string;
  progress?: number;
  duration?: number;
  result?: any;
}) => void;
```

**Success:** User sees progress, not black box

---

## Phase 4: Evidence Chain with Verification (3-4 days)

### 4.1 Consolidated Evidence + Causal Chain ⭐ REVISED
**Goal:** Show full reasoning trail with verifiable sources

**Create:** `EvidenceChain.tsx` (consolidates Phase 3 and 5 from original plan)

**Displays:**
```
REASONING FLOW:
Intent: "Why do regime transitions fail?"
  ↓
Analysis: Vol-of-vol correlation analysis
  Evidence: ✓ data/spx_2020-2023.csv (r²=0.78 confirmed)
  ↓
Hypothesis: "Vol-of-vol >0.25 causes spread widening"
  Evidence: ✓ python/analysis/vol_analysis.py (lines 45-67)
  ↓
Implementation: Created vol_analyzer.py plugin
  Evidence: ✓ Claude Code execution (12 tests passed)
  ↓
Validation: Out-of-sample confirmation
  Evidence: ✓ data/backtest_results/run_xyz.json
```

**Each evidence node has:**
- ✓ Verification status
- 🔍 [Verify Claim] button
- Click → Opens inline code viewer with highlighted lines

**Success:** Every claim is traceable and verifiable

---

### 4.2 Inline Verification ⭐ NEW
**Goal:** User can check that r²=0.78 actually exists in the code

**Implementation:**
```tsx
<EvidenceNode>
  ✓ vol_analyzer.py (line 67): r²=0.78 confirmed
  <Button onClick={() => verifyEvidence()}>
    [Verify Claim]
  </Button>
</EvidenceNode>
```

**Clicking "Verify" shows:**
```python
# vol_analyzer.py (lines 64-70)
def calculate_correlation(self, data):
    vol_of_vol = self._calc_vov(data)
    regime_changes = self._detect_changes(data)
    
    r_squared = 0.78  # ← VERIFIED
    p_value = 0.03
```

**Success:** Claims are verifiable, not just stated

---

## Phase 5: Structured Artifacts (2-3 days)

### 5.1 Claude Code Results as Interactive Artifacts
**Goal:** Results render in appropriate panels, not text dumps

**Extend:** `Artifact` type
```typescript
export interface ClaudeCodeArtifact extends Artifact {
  files: Array<{
    path: string;
    content: string;
    annotations?: Array<{ line: number; text: string }>;
  }>;
  tests?: { 
    passed: number; 
    failed: number; 
    output?: string 
  };
  validation?: Record<string, any>;
  nextActions?: string[];
  costSummary?: {
    thisExecution: number;
    alternativeCost: number;
    savings: number;
  };
}
```

**Create:** `ClaudeCodeResultCard.tsx`
- Tabbed interface: [Code] [Tests] [Explanation] [Cost]
- Syntax highlighting
- Click-to-expand file contents
- Action buttons at bottom

---

### 5.2 Undo/Retry Capability ⭐ NEW
**Goal:** Research is iterative, enable refinement

**Add to ClaudeCodeResultCard:**
```tsx
<div className="flex gap-2">
  <Button onClick={() => acceptResult()}>
    ✓ Use This
  </Button>
  <Button variant="outline" onClick={() => retryWithChanges()}>
    🔄 Retry with Changes
  </Button>
  <Button variant="ghost" onClick={() => undoAndTryDifferent()}>
    ↩️ Undo & Try Different Approach
  </Button>
</div>
```

**Implementation:**
- Stores execution context (task, parameters, files touched)
- Retry → Opens dialog for parameter modification
- Undo → Reverts file changes, tries alternative approach

**Success:** User can iterate without starting over

---

## Phase 6: Working Memory Checkpoints (3-4 days)

### 6.1 Auto-Checkpoint System
**Goal:** Zero context loss on interruption

**Implementation:**
- Every 30s during execution, save state to `session_contexts`
- State includes: task, progress, completed steps, next steps, files modified

**On app restart:**
```
┌─────────────────────────────────────────────────────┐
│ 💾 UNFINISHED TASK DETECTED                         │
│                                                     │
│ You were creating a volatility analyzer at 85%     │
│ complete when the app closed.                      │
│                                                     │
│ PROGRESS:                                           │
│ ✓ Hypothesis formulation                           │
│ ✓ Data analysis (r²=0.78 confirmed)               │
│ ✓ Plugin creation (vol_analyzer.py)               │
│ ⏳ Testing on out-of-sample data (interrupted)     │
│                                                     │
│ FILES MODIFIED:                                     │
│ • python/engine/plugins/vol_analyzer.py (+145)     │
│ • tests/test_vol_analyzer.py (+67)                 │
│                                                     │
│ [Resume Task] [Abandon] [View Details]             │
└─────────────────────────────────────────────────────┘
```

**Success:** ADHD-optimized, no context loss

---

## Phase 7: Contextual Education (2-3 days)

### 7.1 Personal Pattern Recognition ⭐ NEW
**Goal:** Teach based on USER'S actual mistakes, not generic advice

**Create:** `ContextualEducationOverlay.tsx`

**Instead of generic:**
```
💡 TIP: Walk-forward validation prevents overfitting
```

**Show personal patterns:**
```
⚠️ YOUR PATTERN TO BREAK:

WATCH: Claude Code adding walk-forward validation

YOUR HISTORY: You've forgotten this in 3 of last 5 backtests
IMPACT: Those 3 all failed out-of-sample
  • 2024-11-15: -60% degradation
  • 2024-11-20: -45% degradation  
  • 2024-11-28: -72% degradation

This is YOUR pattern. Break it this time.
```

**Implementation:**
- Track user's backtest history
- Detect repeated failure patterns
- Surface proactively when similar context arises

**Success:** Education is personal and actionable

---

## Deferred to Future Phases

These are good ideas but require infrastructure we don't have yet:

### Cross-Model Learning with Feedback ⭐ Claude Code Suggestion
- User flags false positive patterns
- System learns from corrections
- **Deferred:** Needs pattern extraction engine first

### Predictive Assessment with Confidence Intervals ⭐ Claude Code Suggestion
- Show "45s ± 15s (based on 12 similar tasks)"
- Success probability with error bounds
- **Deferred:** Needs historical task database first

### Live Cost Dashboard
- Real-time cost tracking across all models
- **Deferred:** Need to implement cost calculation per provider first

---

## Summary of Improvements

| Original Plan | Claude Code Enhancement | Status |
|---------------|-------------------------|--------|
| Decision visibility | + Override buttons & cost tracking | **Phase 2** |
| Working memory state | + Show diffs (what changed) | **Phase 1** |
| Evidence links | + Inline verification | **Phase 4** |
| Generic teaching | + Personal pattern recognition | **Phase 7** |
| Success paths only | + Error cards with suggestions | **Phase 1** |
| Separate causal/evidence | Consolidated into single chain | **Phase 4** |
| One-shot execution | + Undo/retry capability | **Phase 5** |
| Pattern detection | + User feedback loop | **Deferred** |
| Point estimates | + Confidence intervals | **Deferred** |

---

## Success Criteria

| Metric | Target |
|--------|--------|
| User can explain WHY any handoff happened | 100% have decision card |
| User can override decisions | Override success rate >70% |
| No black-box failures | Every error has actionable guidance |
| Context preserved on interrupt | Resume dialog <2s after restart |
| Claims are verifiable | User can verify any evidence claim |
| Teaching is personal | Educational overlays reference user history |
| Results are actionable | Undo/retry works for 100% of executions |

---

## Why This Plan is 10X

1. **Actionable, not just informative** - Override buttons, retry capability
2. **Verifiable, not just claims** - Inline evidence verification
3. **Personal, not generic** - Education based on YOUR patterns
4. **Iterative, not one-shot** - Undo/retry enables refinement
5. **Failure-aware** - Error cards with suggestions, not cryptic messages
6. **ADHD-optimized** - Working memory with diffs, zero context loss
7. **Trust through control** - User can override any decision
8. **Cost-transparent** - Shows savings per routing decision

---

## Implementation Timeline

- **Week 1:** Phase 1 (Foundation + Error Cards + Diffs)
- **Week 2:** Phase 2 (Decision Cards + Overrides + Cost Tracking)
- **Week 3:** Phase 3 (Progress State Machine)
- **Week 4:** Phase 4 (Evidence Chain + Verification)
- **Week 5:** Phase 5 (Structured Artifacts + Undo/Retry)
- **Week 6:** Phase 6 (Working Memory Checkpoints)
- **Week 7:** Phase 7 (Contextual Education)

**Total: ~7 weeks to full 10X implementation**

---

## Next Steps

1. ✅ Fix build errors (completed)
2. Start Phase 1.1: Wire existing infrastructure
3. Implement Phase 1.2: Error visibility
4. Implement Phase 1.3: Working memory diffs

Ready to proceed with implementation?
