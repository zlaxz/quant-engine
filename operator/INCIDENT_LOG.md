# INCIDENT LOG

**Running record of all trading incidents and their resolution.**

---

## Log Format

Each incident should be documented with:
- **Date/Time**: When it occurred
- **Severity**: P1/P2/P3/P4
- **Type**: Connection/Position/Order/Data/Other
- **Description**: What happened
- **Impact**: Capital impact, if any
- **Root Cause**: Why it happened
- **Resolution**: How it was fixed
- **Prevention**: How to prevent recurrence

---

## Template

```markdown
### [YYYY-MM-DD HH:MM] - [Brief Title]

**Severity**: P1/P2/P3/P4
**Type**: Connection | Position | Order | Data | Kill Switch | Other
**Duration**: X minutes

**What Happened**:
[Describe the incident]

**Impact**:
- Capital impact: $X
- Positions affected: [list]
- Orders affected: [list]

**Root Cause**:
[Why did this happen?]

**Resolution**:
[How was it fixed?]

**Prevention**:
[What will prevent this in the future?]

**Follow-up Actions**:
- [ ] Action 1
- [ ] Action 2

---
```

---

## Incident History

### [YYYY-MM-DD] - Template Entry (Remove when first real incident added)

**Severity**: P4
**Type**: Other
**Duration**: N/A

**What Happened**:
This is a template entry to show the format.

**Impact**:
- Capital impact: $0
- Positions affected: None
- Orders affected: None

**Root Cause**:
N/A - Template entry

**Resolution**:
N/A - Template entry

**Prevention**:
N/A - Template entry

**Follow-up Actions**:
- [ ] Remove this template when first real incident is logged

---

<!-- Add new incidents above this line -->

---

## Statistics

| Month | P1 | P2 | P3 | P4 | Total Capital Impact |
|-------|----|----|----|----|---------------------|
| Dec 2025 | 0 | 0 | 0 | 0 | $0 |

---

## Common Incident Patterns

Track recurring issues here:

| Pattern | Count | Last Occurrence | Status |
|---------|-------|-----------------|--------|
| Connection timeout | 0 | N/A | Monitoring |
| Position mismatch | 0 | N/A | Monitoring |
| Pre-flight rejection | 0 | N/A | Monitoring |

---

**Last Updated**: 2025-12-07
**Review Frequency**: Weekly
