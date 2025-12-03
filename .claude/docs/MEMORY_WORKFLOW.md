# Memory Workflow for Quant-Engine Development

**Purpose**: How to use memory systems during Claude Code CLI sessions
**Canonical Doc**: ~/ObsidianVault/Projects/quant-engine/CLAUDE_CODE_PROTOCOL.md

---

## Quick Reference

### Session Start
1. Read `HANDOFF.md` and `SESSION_STATE.md`
2. Query: `memory_recall "quant-engine: current work"`
3. Check Obsidian: `mcp__obsidian__read_note "Projects/quant-engine/00-START-HERE.md"`

### During Session
- Before implementing: `memory_recall "quant-engine: [topic]"`
- New strategy: Create `06-Strategies/[name]/SPEC.md` in Obsidian
- Backtest done: Create `07-Backtest-Results/YYYY-MM/[result].md`
- Learning: Create `08-Learnings/[category]/[learning].md`

### Session End
1. Update `HANDOFF.md`
2. Update Obsidian if decisions made
3. Commit changes

---

## Three Memory Systems

| System | What It Stores | When to Use |
|--------|----------------|-------------|
| **Obsidian** | Quant knowledge (strategies, backtests, learnings) | Always for research artifacts |
| **Supabase** | Dev decisions, implementation choices | `memory_recall` for context |
| **MCP Graph** | Entity relationships | Understanding architecture |

---

## Memory Query Patterns

```bash
# Feature work
memory_recall "quant-engine: [feature] implementation"

# Debugging
memory_recall "quant-engine: errors with [component]"

# Architecture
memory_recall "quant-engine: why [decision]"

# Strategy
memory_recall "quant-engine: [strategy type] approaches"
```

---

## Obsidian MCP Commands

```
# Read
mcp__obsidian__read_note "Projects/quant-engine/[path]"

# Write
mcp__obsidian__write_note path="Projects/quant-engine/[path]" content="..."

# Update
mcp__obsidian__patch_note path="..." oldString="..." newString="..."

# List
mcp__obsidian__list_directory "Projects/quant-engine"
```

---

## Key Principle

**Obsidian is CANONICAL for quant knowledge.**

Exact parameter values, backtest results, strategy specs → Obsidian.
Implementation decisions, dev context → Supabase memory.
Entity relationships → MCP Knowledge Graph.

---

See full protocol: ~/ObsidianVault/Projects/quant-engine/CLAUDE_CODE_PROTOCOL.md
