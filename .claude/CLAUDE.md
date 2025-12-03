# Quant-Engine - Claude Code Configuration

**Project Type**: Hybrid (Electron app + Claude Code CLI development)
**Memory Systems**: Obsidian (canonical) + Supabase (dev context) + MCP Graph

---

## Memory Protocol

### Canonical Knowledge
**Obsidian** is the source of truth for all quant research:
- Location: `~/ObsidianVault/Projects/quant-engine/`
- Use MCP tools: `mcp__obsidian__read_note`, `mcp__obsidian__write_note`

### Development Context
**Supabase** via `memory_recall` for implementation decisions:
```bash
memory_recall "quant-engine: [topic]"
```

### Full Protocol
See: `.claude/docs/MEMORY_WORKFLOW.md`

---

## Session Workflow

### Start
1. Read `HANDOFF.md` → Where we left off
2. Read `SESSION_STATE.md` → What's working/broken
3. Query `memory_recall "quant-engine: current work"`
4. Check Obsidian `00-START-HERE.md` if needed

### During
- Document strategies immediately in `06-Strategies/`
- Document backtests in `07-Backtest-Results/`
- Document learnings in `08-Learnings/`

### End
- Update `HANDOFF.md`
- Commit changes
- Update Obsidian if decisions made

---

## LIVE_STATE Daemon Note

The LIVE_STATE daemon generates compaction recovery summaries in `.working/LIVE_STATE.md`.

**Threshold**: Sessions with <100 chars of conversation are skipped.
**Implication**: Short agent tasks won't generate LIVE_STATE files.
**Workaround**: For substantial work, maintain longer conversations.

This is intentional - short agent spawns don't need recovery summaries.

---

## Architecture Overview

```
Quant-Engine App (Research Mode)
├── Gemini 3 Pro (CIO) - Strategy, reasoning, read-only
├── Claude Code (CTO) - Execution, code changes
└── DeepSeek (Swarm) - Cost-efficient parallel work

Claude Code CLI (Development Mode)
├── Full memory system access
├── MCP Obsidian integration
└── Standard development workflow
```

---

## Key Files

| Purpose | Location |
|---------|----------|
| System overview | `ARCHITECTURE.md` |
| Session state | `SESSION_STATE.md` |
| Handoff notes | `HANDOFF.md` |
| Memory workflow | `.claude/docs/MEMORY_WORKFLOW.md` |
| Obsidian knowledge | `~/ObsidianVault/Projects/quant-engine/` |

---

## CIO/CTO Model Names

- **CIO**: Gemini 3 Pro (`gemini-exp-1206` or `gemini-2.0-flash-thinking-exp`)
- **CTO**: Claude Code CLI (this conversation)
- **Swarm**: DeepSeek (cost-efficient)

Badge display: `[Role] • [Model]` (single unified badge)

---

**Last Updated**: 2025-12-02
