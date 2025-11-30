# Memory Notes → Memories Migration Implementation Guide

**Status:** Ready for implementation
**Risk Level:** Low (with this safe migration)
**Data Loss Risk:** Zero (backup preserved)
**Created:** 2025-11-23

---

## Overview

This document guides the implementation of a safe data migration from the legacy `memory_notes` table to the enhanced `memories` table. The migration:

- **Preserves all existing data** (no DROP statements)
- **Validates integrity** (row count verification)
- **Enables rollback** (backup table preserved)
- **Provides audit trail** (migration metadata logged)

---

## Files Created

### 1. Documentation

- **`SAFE_DATA_MIGRATION_STRATEGY.md`** (project root)
  - Complete overview of migration strategy
  - Problem analysis and solution
  - Data mapping reference table
  - Implementation steps

- **`.claude/docs/MIGRATION_IMPLEMENTATION_GUIDE.md`** (this file)
  - Step-by-step implementation instructions
  - Quick reference checklist

### 2. SQL Migration Files

- **`supabase/migrations/safe_migration_data_transfer.sql`**
  - Data migration code
  - Insert into main migration file after table definitions
  - Contains validation and audit trail creation

- **`supabase/migrations/20251123000001_cleanup_memory_notes_old.sql`**
  - Optional cleanup migration (run AFTER validation)
  - Removes backup table and audit view
  - Includes final safety checks

- **`supabase/migrations/MIGRATION_VERIFICATION.sql`**
  - Verification queries
  - Run AFTER migration to confirm success
  - Generates readiness checklist

---

## Implementation Steps

### Step 1: Update Main Migration File

**File:** `/supabase/migrations/20251123000000_enhance_memory_system.sql`

**Current problematic code (line 5):**
```sql
DROP TABLE IF EXISTS memory_notes CASCADE;
```

**Replace with:**
```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Rename old table instead of dropping (preserves data)
ALTER TABLE IF EXISTS memory_notes RENAME TO memory_notes_old;
```

**Verification:**
```bash
grep -n "ALTER TABLE.*memory_notes RENAME" supabase/migrations/20251123000000_enhance_memory_system.sql
# Should show: 8:ALTER TABLE IF EXISTS memory_notes RENAME TO memory_notes_old;
```

### Step 2: Add Migration Logic

**After all table and index definitions** (around line 86), add the contents of `supabase/migrations/safe_migration_data_transfer.sql`:

This adds:
- Data migration from `memory_notes_old` → `memories`
- Row count validation
- Orphaned row detection
- Audit trail view creation

**Expected output when running migration:**
```
[Migration] Starting data migration: Found N rows in memory_notes_old
[Migration] SUCCESS: Migrated N rows to memories table
[Migration] All data successfully transferred with protection_level=2 (standard)

========== MIGRATION VALIDATION REPORT ==========
Rows in memory_notes_old: N
Total rows in memories: N
  - Migrated rows (source=migration): N
  - New data rows (source!=migration): 0
Orphaned rows (not migrated): 0
================================================

MIGRATION INTEGRITY: PASSED - All N rows successfully migrated
```

### Step 3: Deploy Migration

```bash
# Push to Supabase
cd /Users/zstoc/GitHub/quant-chat-scaffold
supabase db push

# Or if using migration script
supabase migration up
```

Monitor for:
- [ ] No errors in migration output
- [ ] Validation report shows PASSED status
- [ ] Row counts match
- [ ] No orphaned rows detected

### Step 4: Verify Migration Success

```bash
# Run verification queries
supabase db push --file supabase/migrations/MIGRATION_VERIFICATION.sql

# Or in Supabase SQL Editor, run each query from MIGRATION_VERIFICATION.sql
```

**Key verifications:**
```sql
-- Should show: 0 orphaned rows
SELECT COUNT(*) FROM memory_notes_old
WHERE id NOT IN (SELECT id FROM memories WHERE source = 'migration');

-- Should be equal
SELECT COUNT(*) FROM memory_notes_old;
SELECT COUNT(*) FROM memories WHERE source = 'migration';

-- Should show migration details
SELECT * FROM migration_audit_trail;
```

### Step 5: Test Application

Before cleanup, test that the application:
- [ ] Queries `memories` table successfully
- [ ] Filters by migrated data work correctly
- [ ] New memory creation works
- [ ] Search/filtering functions work
- [ ] No errors in application logs

### Step 6: Optional - Cleanup Old Table

**ONLY after confirming application works perfectly**, run cleanup:

```bash
supabase db push --file supabase/migrations/20251123000001_cleanup_memory_notes_old.sql
```

This:
- Removes `memory_notes_old` backup table
- Drops `migration_audit_trail` view
- Includes final validation checks

---

## Data Mapping Reference

### Old → New Column Mapping

| Old Column | New Column | Value | Notes |
|-----------|-----------|-------|-------|
| `id` | `id` | Copied directly | UUID preserved |
| `workspace_id` | `workspace_id` | Copied directly | Foreign key preserved |
| `content` | `content` | Copied directly | Full text content |
| `content` | `summary` | Copied (= content) | Can be updated later |
| N/A | `memory_type` | `'observation'` | Conservative default |
| N/A | `importance_score` | `0.5` | Neutral default |
| N/A | `protection_level` | `2` | Standard protection |
| `created_at` | `created_at` | Copied directly | Timestamp preserved |
| N/A | `updated_at` | `created_at` | Set to creation time |
| N/A | `source` | `'migration'` | Identifies migrated data |
| N/A | `confidence` | `0.8` | Indicates legacy data |
| N/A | `regime_context` | JSON metadata | Marks migration timestamp |

### New Column Defaults Explained

- **memory_type**: All migrated data becomes `'observation'` type (safest assumption)
- **importance_score**: `0.5` (neutral) - legacy data hasn't been scored yet
- **protection_level**: `2` (standard) - not immutable, not ephemeral
- **source**: `'migration'` - distinguishes migrated from new data
- **confidence**: `0.8` - lower than 1.0 to indicate possible review needed
- **regime_context**: JSON including migration timestamp for audit trail

---

## Rollback Procedure

If something goes wrong and you need to rollback:

```sql
-- 1. Delete the migrated data from new table
DELETE FROM memories WHERE source = 'migration';

-- 2. Rename the backup table back
ALTER TABLE memory_notes_old RENAME TO memory_notes;

-- 3. Application reverts to using memory_notes
-- (No schema changes needed on client side)
```

**This is safe because:**
- Original data still exists in backup
- No data has been deleted
- Can retry migration after fixing issues

---

## Monitoring & Validation

### During Migration

Watch the logs for:
```
[Migration] Starting data migration...
[Migration] SUCCESS: Migrated N rows
MIGRATION INTEGRITY: PASSED
```

If you see:
```
[Migration] WARNING: Row count mismatch!
[Migration] !! DATA INTEGRITY WARNING !!
```

**STOP** - do not proceed to cleanup until issue is resolved.

### After Migration

Run the verification checklist:

```sql
-- 1. Row count match
SELECT
  (SELECT COUNT(*) FROM memory_notes_old) as old_count,
  (SELECT COUNT(*) FROM memories WHERE source = 'migration') as migrated_count;
-- Should be equal

-- 2. No orphaned rows
SELECT COUNT(*) FROM memory_notes_old
WHERE id NOT IN (SELECT id FROM memories WHERE source = 'migration');
-- Should be 0

-- 3. Audit trail exists
SELECT * FROM migration_audit_trail;
-- Should show migration metadata
```

### Before Cleanup

Confirm:
- [ ] All verification queries pass
- [ ] Application tested and working
- [ ] No errors in recent logs
- [ ] Team aware of cleanup plan

---

## Troubleshooting

### Problem: Row count mismatch after migration

**Symptom:**
```
Expected: 100 | Rows migrated: 95
```

**Solution:**
1. Don't proceed to cleanup
2. Run query to find orphaned rows:
   ```sql
   SELECT id, content, created_at FROM memory_notes_old
   WHERE id NOT IN (SELECT id FROM memories WHERE source = 'migration');
   ```
3. Investigate why these rows weren't migrated
4. Check migration log for error messages
5. Manually migrate if needed or delete if corrupted

### Problem: Backup table doesn't exist

**Symptom:**
```
relation "memory_notes_old" does not exist
```

**Solution:**
- Migration might have already completed and cleaned up
- Check if `memory_notes` table exists:
  ```sql
  SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'memory_notes');
  ```
- If yes, you're on old schema - need to create memories and migrate
- If no, you're already on new schema

### Problem: memory_notes table still exists (before migration)

**Symptom:**
```
ALTER TABLE memory_notes RENAME...
ERROR: relation "memory_notes" already exists
```

**Solution:**
- Migration has already been run
- This is expected - backup table `memory_notes_old` should exist
- Verify backup: `SELECT COUNT(*) FROM memory_notes_old;`

---

## Checklist: Ready to Implement

### Pre-Migration

- [ ] Read `SAFE_DATA_MIGRATION_STRATEGY.md`
- [ ] Understand data mapping (column reference above)
- [ ] Backup database (Supabase automated backups sufficient)
- [ ] Notify team of planned migration
- [ ] Review rollback procedure

### Migration Execution

- [ ] Update main migration file (replace DROP with RENAME)
- [ ] Add migration logic from `safe_migration_data_transfer.sql`
- [ ] Deploy with `supabase db push`
- [ ] Monitor migration output
- [ ] Confirm no errors in logs

### Post-Migration

- [ ] Run verification queries from `MIGRATION_VERIFICATION.sql`
- [ ] Test application with new schema
- [ ] Verify row counts match
- [ ] Confirm no orphaned rows
- [ ] Application performs normally
- [ ] Document any issues found

### Cleanup (Optional, after confirmation)

- [ ] All tests pass
- [ ] Application works perfectly
- [ ] Team sign-off obtained
- [ ] Run cleanup migration
- [ ] Verify backup table removed
- [ ] Document migration completion

---

## Key Safety Features

This migration includes:

1. **No Data Loss**
   - RENAME instead of DROP
   - Backup table preserved indefinitely
   - Can rollback anytime

2. **Validation**
   - Row count verification before/after
   - Orphaned row detection
   - NULL value checks

3. **Audit Trail**
   - `migration_audit_trail` view with timestamps
   - Source marked as `'migration'` for identification
   - Regime context includes migration metadata

4. **Intelligent Defaults**
   - Conservative choices (observation type)
   - Lower confidence to indicate review may be needed
   - Standard protection level (middle of spectrum)

5. **Logging**
   - RAISE NOTICE statements show progress
   - RAISE WARNING alerts on issues
   - Full validation report generated

---

## References

- **Main Strategy:** `SAFE_DATA_MIGRATION_STRATEGY.md`
- **Migration Code:** `supabase/migrations/safe_migration_data_transfer.sql`
- **Cleanup Script:** `supabase/migrations/20251123000001_cleanup_memory_notes_old.sql`
- **Verification:** `supabase/migrations/MIGRATION_VERIFICATION.sql`

---

## Questions?

Refer to `SAFE_DATA_MIGRATION_STRATEGY.md` for:
- Complete SQL code
- Detailed mapping explanation
- Failure recovery procedures
- Cost/benefit analysis

Or run the verification queries to inspect the actual data.
