# Migration Decision Tree & Flow Chart

## Current Situation Analysis

```
┌─────────────────────────────────────────────────────┐
│ Current Migration File Status                       │
├─────────────────────────────────────────────────────┤
│ File: 20251123000000_enhance_memory_system.sql      │
│ Issue: Line 5 contains DROP TABLE IF EXISTS         │
│        memory_notes CASCADE;                        │
│                                                     │
│ Risk Level: HIGH                                    │
│ - All existing memory_notes data would be DELETED   │
│ - No backup created                                 │
│ - No rollback possible                              │
│ - No validation checks                              │
│                                                     │
│ Audit Finding: UNSAFE - needs immediate fix        │
└─────────────────────────────────────────────────────┘
```

---

## Solution Path Decision Tree

```
START: Need to migrate memory_notes → memories
│
├─── Question 1: Do I have existing data in memory_notes?
│    │
│    ├─ YES (Production environment)
│    │  └─→ MUST USE SAFE MIGRATION (this strategy)
│    │     │
│    │     └─→ Go to "Safe Migration Path"
│    │
│    └─ NO (Fresh installation)
│       └─→ Either approach works
│          (Safe migration is recommended for consistency)
│
└─── Question 2: Can I afford downtime?
     │
     ├─ NO (Production, zero-downtime required)
     │  └─→ SAFE MIGRATION (renames are instant in PostgreSQL)
     │     No downtime needed - tables available during rename
     │
     └─ YES (Development, can afford brief downtime)
        └─→ Still recommend SAFE MIGRATION (fewer moving parts)
```

---

## Safe Migration Path (Recommended)

```
┌─────────────────────────────────────────────────┐
│ PHASE 1: PREPARATION (5 minutes)                │
├─────────────────────────────────────────────────┤
│                                                 │
│ [✓] Read SAFE_DATA_MIGRATION_STRATEGY.md       │
│ [✓] Understand data mapping (table provided)   │
│ [✓] Review rollback procedure                  │
│ [✓] Notify team of plan                        │
│ [✓] Database backup (Supabase auto-backups OK) │
│                                                 │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│ PHASE 2: IMPLEMENTATION (5 minutes)             │
├─────────────────────────────────────────────────┤
│                                                 │
│ Step 1: Open migration file                    │
│         supabase/migrations/20251123000000...  │
│                                                 │
│ Step 2: Replace DROP with RENAME               │
│         OLD: DROP TABLE IF EXISTS              │
│         NEW: CREATE EXTENSION IF NOT EXISTS    │
│             ALTER TABLE memory_notes RENAME    │
│                                                 │
│ Step 3: Add migration logic after indexes      │
│         Copy from: safe_migration_data_       │
│         transfer.sql                           │
│                                                 │
│ Step 4: Deploy migration                       │
│         supabase db push                       │
│                                                 │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│ PHASE 3: VALIDATION (2 minutes)                │
├─────────────────────────────────────────────────┤
│                                                 │
│ Check Migration Log Output:                    │
│                                                 │
│ [✓] "[Migration] SUCCESS: Migrated N rows"     │
│ [✓] "MIGRATION INTEGRITY: PASSED"              │
│ [✓] "Orphaned rows: 0"                         │
│                                                 │
│ If any WARNINGS or FAILURES:                   │
│ └─→ DO NOT PROCEED                             │
│     └─→ See Troubleshooting Section            │
│     └─→ Row counts must match exactly          │
│                                                 │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│ PHASE 4: VERIFICATION (5-10 minutes)           │
├─────────────────────────────────────────────────┤
│                                                 │
│ Run SQL Verification Queries:                  │
│ (from MIGRATION_VERIFICATION.sql)              │
│                                                 │
│ ① SELECT COUNT(*) FROM memory_notes_old;      │
│    Result: N (number of old records)           │
│                                                 │
│ ② SELECT COUNT(*) FROM memories WHERE         │
│    source = 'migration';                       │
│    Result: N (must equal query ①)              │
│                                                 │
│ ③ SELECT COUNT(*) FROM memory_notes_old       │
│    WHERE id NOT IN (...);                      │
│    Result: 0 (no orphaned rows)                │
│                                                 │
│ ④ SELECT * FROM migration_audit_trail;        │
│    Result: Shows migration metadata            │
│                                                 │
│ All queries PASS?                              │
│ ├─ YES → Continue to Phase 5                  │
│ └─ NO → DO NOT PROCEED → Troubleshoot          │
│                                                 │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│ PHASE 5: APPLICATION TESTING (5-10 minutes)    │
├─────────────────────────────────────────────────┤
│                                                 │
│ Test in application:                           │
│                                                 │
│ [✓] Can query memories table                   │
│ [✓] Migrated data appears correctly            │
│ [✓] Search/filter functions work               │
│ [✓] New memory creation works                  │
│ [✓] No errors in application logs              │
│ [✓] Performance acceptable                     │
│                                                 │
│ Issues found?                                  │
│ ├─ NO → Continue to Phase 6                   │
│ └─ YES → STOP, DEBUG, do not cleanup           │
│                                                 │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│ PHASE 6: OPTIONAL CLEANUP (1 minute)           │
├─────────────────────────────────────────────────┤
│                                                 │
│ Only run AFTER all previous phases pass:       │
│                                                 │
│ supabase db push \                             │
│   --file supabase/migrations/                  │
│   20251123000001_cleanup_memory_notes_old.sql │
│                                                 │
│ This removes:                                  │
│ ├─ memory_notes_old table (backup)             │
│ ├─ migration_audit_trail view                  │
│ └─ Final validation before cleanup             │
│                                                 │
│ NOTE: Cleanup is OPTIONAL                      │
│ You can keep backup table indefinitely         │
│                                                 │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│ MIGRATION COMPLETE                             │
├─────────────────────────────────────────────────┤
│ Status: SUCCESS                                │
│ Data: Fully migrated & verified                │
│ Backup: Removed (or kept if preferred)         │
│ Application: Fully functional                  │
└─────────────────────────────────────────────────┘
```

---

## Decision Points & Exit Criteria

### Phase 1: Preparation
```
READY?
├─ Team notified
├─ Backup confirmed
├─ Strategy understood
└─ Ready to proceed
      │
      ├─ YES → Phase 2
      └─ NO → Delay until ready
```

### Phase 2: Implementation
```
MIGRATION DEPLOYED?
└─ supabase db push executed successfully
      │
      ├─ YES → Check logs for errors
      │        │
      │        ├─ No errors → Phase 3
      │        └─ Errors → Troubleshoot & retry
      │
      └─ NO → Review file changes & retry
```

### Phase 3: Validation
```
LOGS SHOW SUCCESS?
├─ "[Migration] SUCCESS" message
├─ "MIGRATION INTEGRITY: PASSED"
└─ "Orphaned rows: 0"
      │
      ├─ YES → Phase 4 (run SQL queries)
      └─ NO → DO NOT PROCEED
             └─ Investigate failures
             └─ See Troubleshooting
             └─ May need rollback
```

### Phase 4: Verification
```
SQL QUERIES PASS?
├─ Row counts match
├─ No orphaned rows
├─ Audit trail exists
└─ No NULL values
      │
      ├─ YES → Phase 5 (test app)
      └─ NO → DO NOT PROCEED
             └─ Investigate data integrity
             └─ May need manual cleanup
```

### Phase 5: Application Testing
```
APPLICATION WORKS?
├─ All core features functional
├─ No errors in logs
├─ Performance acceptable
└─ Data displays correctly
      │
      ├─ YES → Phase 6 (cleanup)
      └─ NO → DO NOT CLEANUP
             └─ Fix app issues first
             └─ Backup table still available
```

### Phase 6: Cleanup
```
READY TO REMOVE BACKUP?
├─ All previous phases passed
├─ Running in production > 24 hours
├─ No unexpected issues
└─ Can tolerate losing rollback path
      │
      ├─ YES → Run cleanup migration
      │        └─ Backup removed
      │        └─ Migration complete
      │
      └─ NO → Keep backup indefinitely
             └─ Can cleanup anytime later
             └─ No harm keeping it
```

---

## Outcome Scenarios

### Scenario A: Success ✓

```
┌──────────────────────────────────────────┐
│ OUTCOME: COMPLETE SUCCESS                │
├──────────────────────────────────────────┤
│                                          │
│ All rows migrated successfully           │
│ No orphaned data                         │
│ Application working perfectly            │
│ Cleanup completed (optional)             │
│                                          │
│ Next: Monitor for 24-48 hours           │
│       If all good, document completion   │
│                                          │
└──────────────────────────────────────────┘
```

### Scenario B: Row Count Mismatch ⚠️

```
┌──────────────────────────────────────────┐
│ OUTCOME: MIGRATION INCOMPLETE            │
├──────────────────────────────────────────┤
│                                          │
│ Expected: 100 rows                       │
│ Migrated: 95 rows                        │
│ Orphaned: 5 rows                         │
│                                          │
│ ACTION REQUIRED:                         │
│ 1. Run query to find orphaned rows      │
│ 2. Investigate why not migrated         │
│ 3. Check migration logs for errors      │
│ 4. Manually migrate if possible          │
│ 5. Or delete if corrupted               │
│ 6. Retry migration                      │
│                                          │
│ IMPORTANT: backup still exists          │
│ No data has been lost                   │
│                                          │
└──────────────────────────────────────────┘
```

### Scenario C: Rollback Needed 🔄

```
┌──────────────────────────────────────────┐
│ OUTCOME: APPLICATION ISSUES FOUND        │
├──────────────────────────────────────────┤
│                                          │
│ Discovered app doesn't work with        │
│ new memories table schema               │
│                                          │
│ ROLLBACK PROCEDURE:                      │
│ 1. DELETE FROM memories WHERE           │
│    source = 'migration';                │
│ 2. ALTER TABLE memory_notes_old         │
│    RENAME TO memory_notes;              │
│ 3. App reverts to old schema            │
│                                          │
│ TIME TO ROLLBACK: < 1 minute            │
│ DATA LOSS: ZERO                         │
│ IMPACT: Minimal                         │
│                                          │
│ Then: Fix app code & retry              │
│                                          │
└──────────────────────────────────────────┘
```

---

## Risk Assessment Matrix

| Phase | Risk | Mitigation | Recovery |
|-------|------|-----------|----------|
| Preparation | Low | Review docs | Read again |
| Implementation | Low | Backup preserved | Rollback easy |
| Validation | Medium | Automated checks | Retry migration |
| Testing | Low | App-level only | Rollback possible |
| Cleanup | Very Low | Checked twice | Keep backup |

---

## Go / No-Go Checklist

### Before Starting Migration

```
GO if:
[✓] Backup database available (Supabase auto-backups OK)
[✓] Team ready and notified
[✓] No active transactions expected
[✓] Read SAFE_DATA_MIGRATION_STRATEGY.md
[✓] Understand rollback procedure

NO-GO if:
[✗] High transaction volume expected
[✗] Team not ready
[✗] Multiple migrations planned simultaneously
[✗] Production at critical time
[✗] Untested schema changes
```

### Before Cleanup

```
GO if:
[✓] Migration validation PASSED
[✓] Application tested (24+ hours)
[✓] No errors in logs
[✓] Row counts verified exact match
[✓] No orphaned rows found
[✓] Ready to lose rollback capability

NO-GO if:
[✗] Any phase failed validation
[✗] Application issues found
[✗] Row counts don't match
[✗] Team wants to keep backup "just in case"
[✗] Less than 24 hours since migration
```

---

## Quick Status Indicators

| Indicator | Success | Warning | Failure |
|-----------|---------|---------|---------|
| Migration logs | PASSED | WARNING | FAILED/ERROR |
| Row counts | Equal | Off by 1-2 | Significant gap |
| Orphaned rows | 0 | 1-2 | More than 2 |
| Application | No errors | Warnings | Exceptions |
| Rollback needed | No | Maybe | Yes |

---

## Reference Links

- **Full Strategy:** SAFE_DATA_MIGRATION_STRATEGY.md
- **Implementation:** MIGRATION_IMPLEMENTATION_GUIDE.md
- **Quick Ref:** MIGRATION_QUICK_REFERENCE.md
- **This File:** MIGRATION_DECISION_TREE.md
- **Migration Code:** supabase/migrations/safe_migration_data_transfer.sql
- **Verification:** supabase/migrations/MIGRATION_VERIFICATION.sql
- **Cleanup:** supabase/migrations/20251123000001_cleanup_memory_notes_old.sql

---

## Summary

This safe migration strategy:

✓ **Preserves all data** (RENAME, never DROP)
✓ **Validates automatically** (row count checks)
✓ **Enables rollback** (backup preserved)
✓ **Provides visibility** (logging & audit trail)
✓ **Zero data loss risk** (backup indefinite)

**Estimated time:** 20 minutes
**Risk level:** Very low
**Rollback:** Yes (< 1 minute)
**Recommended:** ✓ Safe to proceed
