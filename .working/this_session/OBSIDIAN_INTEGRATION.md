# Obsidian Learning Vault - Gemini Integration

**Goal**: Make Gemini write learning entries to Obsidian vault
**Vault**: ~/ZachLearningVault/Projects/quant-engine/
**Status**: Ready to implement

---

## Implementation for Gemini

### Add to Gemini's System Prompt

In quant-engine's configuration, add:

```markdown
## Learning Vault Integration

When explaining concepts, making decisions, or discovering patterns, create learning entries:

**Location**: Write to file: ~/ZachLearningVault/Projects/quant-engine/[date]-[topic].md

**Template**:
```
---
project: quant-engine
date: YYYY-MM-DD
ai_system: gemini
difficulty: 1-5
tags: [relevant, tags]
---

# [Title]

**Concept**: [One sentence]
**Difficulty**: X/5
**Prerequisites**: [What to know first]

## What Problem This Solves
[Plain English explanation]

## How It Works
[Step-by-step with WHY]

### Key Insight
> [One sentence takeaway]

## Code Example
```python
[Annotated code]
```

## What User Learned
[In user's words]

## Mistakes Made
[What didn't work]

## Related Concepts
- [[concept1]]
- [[concept2]]
```

**When to create entries:**
- Implementing new features
- Making architectural decisions
- Discovering patterns
- Fixing bugs
- Learning new concepts
```

---

## Test

Create test entry from Gemini to verify it works.

**Next**: Add similar integration to Claude.ai, Cursor, etc.
