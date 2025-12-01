# Documentation Cleanup - Instructions

**From**: memoryplan session (2025-11-30)
**For**: quant-engine session
**Priority**: HIGH - Prevents stale doc confusion

---

## Problem

ARCHITECTURE.md and other docs in quant-engine are stale/outdated. This caused confusion when trying to understand current system state.

---

## Solution

Run the organization cleanup script in INTERACTIVE mode:

```bash
bash ~/.claude-tools/organize-project-docs.sh . --interactive
```

**Interactive mode will:**
1. Show each .md file in project root
2. Show file age (days old)
3. Ask: "Move to .working/this_session/? (y/n)"
4. You control what gets moved

**Safe to move:**
- Old audit reports (AUDIT_*.md)
- Test reports (TEST_*.md, PHASE*.md)
- Completion summaries (*_COMPLETE.md)
- Migration plans (*_MIGRATION.md)

**Keep (or move to .claude/docs/):**
- Current architecture docs (if still accurate)
- Active setup guides
- Current README/documentation

---

## After Cleanup

**Update docs that you keep:**

Add to top of each doc:
```markdown
**Last Reviewed**: 2025-11-30
**Status**: CURRENT | NEEDS UPDATE | STALE
**Reviewed By**: [Your name or Claude]
```

This prevents future confusion about doc freshness.

---

## Expected Result

**Before:**
- 50+ .md files scattered in root
- Can't tell what's current
- Stale info causes wrong decisions

**After:**
- SESSION_STATE.md (current state)
- README.md (if exists)
- Maybe 2-3 current docs in .claude/docs/
- Everything else archived in .working/

**ADHD-friendly**: Minimal files, easy to find current info, no chaos.

---

**Created by**: memoryplan session implementing doc organization system
**Script location**: ~/.claude-tools/organize-project-docs.sh
