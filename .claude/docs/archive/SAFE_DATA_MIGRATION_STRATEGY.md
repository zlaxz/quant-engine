# Safe Data Migration: memory_notes → memories

**Status:** Ready to implement
**Created:** 2025-11-23
**Audit Finding:** Current migration file contains destructive `DROP TABLE IF EXISTS memory_notes CASCADE;` on line 5

---

## Problem

The existing migration file at `/supabase/migrations/20251123000000_enhance_memory_system.sql` contains:

```sql
DROP TABLE IF EXISTS memory_notes CASCADE;
```

This would **destroy all existing data** if there are any records in the `memory_notes` table.

---

## Solution: Safe Migration Strategy

Replace the destructive DROP with a safe migration that:

1. **Preserves existing data** - RENAME instead of DROP
2. **Migrates schema** - Map old columns to new columns with sensible defaults
3. **Adds default values** - For new required columns
4. **Validates migration** - Confirms row counts match before cleanup
5. **Provides audit trail** - Logs all migration steps
6. **Enables rollback** - Keeps backup table until confirmed safe

---

## Implementation

### Complete SQL Code (Insert in Migration File)

Replace the DROP statement and add this safe migration code:

```sql
-- Enhanced Memory System Migration
-- Adds hybrid search (BM25 + Vector), importance weighting, and knowledge graph features
-- SAFE MIGRATION: Preserves existing data from memory_notes table

-- Enable vector extension first
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- STEP 1: Preserve old data (RENAME instead of DROP)
-- ============================================================================

-- Rename old table instead of dropping (preserves data)
ALTER TABLE IF EXISTS memory_notes RENAME TO memory_notes_old;

-- [Rest of table definitions: memories, indexes, etc...]
-- [Keep the existing CREATE TABLE and INDEX statements...]

-- ============================================================================
-- STEP 2: Migrate data from memory_notes_old → memories (SAFE MIGRATION)
-- ============================================================================

-- Validate that old table exists and migrate data with integrity checks
DO $$
DECLARE
  v_old_row_count INTEGER := 0;
  v_new_row_count INTEGER := 0;
  v_migration_success BOOLEAN := FALSE;
BEGIN
  -- Check if backup table exists and count rows
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'memory_notes_old' AND table_schema = 'public') THEN

    -- Count rows before migration
    SELECT COUNT(*) INTO v_old_row_count FROM memory_notes_old;
    RAISE NOTICE '[Migration] Starting data migration: Found % rows in memory_notes_old', v_old_row_count;

    -- Only migrate if there's data to migrate
    IF v_old_row_count > 0 THEN
      -- Migrate data from old simple schema to new enhanced schema
      -- Map old columns: id, workspace_id, content, created_at → new columns
      -- Fill new columns with sensible defaults
      INSERT INTO memories (
        id,
        workspace_id,
        content,
        summary,
        memory_type,
        importance_score,
        protection_level,
        created_at,
        updated_at,
        source,
        confidence,
        regime_context
      )
      SELECT
        id,
        workspace_id,
        content,
        content, -- Use content as summary initially
        'observation', -- Default type for migrated data (conservative choice)
        0.5, -- Default importance for existing data
        2, -- Default protection level (standard - not immutable, not ephemeral)
        created_at,
        created_at, -- Set updated_at to created_at initially
        'migration', -- Mark source as migration to distinguish from new data
        0.8, -- Lower confidence for legacy data to indicate manual review may be needed
        '{"migrated": true, "source": "memory_notes", "migration_date": "' || NOW()::TEXT || '"}' -- Mark migration context
      FROM memory_notes_old
      WHERE id IS NOT NULL AND workspace_id IS NOT NULL AND content IS NOT NULL;

      -- Validate migration success by counting new rows
      SELECT COUNT(*) INTO v_new_row_count FROM memories WHERE source = 'migration';

      IF v_new_row_count = v_old_row_count THEN
        v_migration_success := TRUE;
        RAISE NOTICE '[Migration] SUCCESS: Migrated % rows to memories table', v_new_row_count;
        RAISE NOTICE '[Migration] All data successfully transferred with protection_level=2 (standard)';
      ELSE
        RAISE WARNING '[Migration] Row count mismatch! Expected: %, Actually migrated: %', v_old_row_count, v_new_row_count;
      END IF;
    ELSE
      -- No data in old table - that's fine
      RAISE NOTICE '[Migration] No data in memory_notes_old to migrate (table may be empty)';
      v_migration_success := TRUE;
    END IF;

  ELSE
    -- No old table exists - could be a fresh installation
    RAISE NOTICE '[Migration] No memory_notes_old table found. Skipping data migration (fresh installation?)';
    v_migration_success := TRUE;
  END IF;

  -- Safety check: warn if migration appears incomplete
  IF NOT v_migration_success AND v_old_row_count > 0 THEN
    RAISE WARNING '[Migration] !! DATA INTEGRITY WARNING !!';
    RAISE WARNING '[Migration] Migration appears incomplete. Backup table preserved.';
    RAISE WARNING '[Migration] Rows expected: % | Rows migrated: %', v_old_row_count, v_new_row_count;
    RAISE WARNING '[Migration] Please investigate before cleanup.';
  END IF;
END $$;

-- ============================================================================
-- STEP 3: Verify migration integrity and generate report
-- ============================================================================

-- Run validation query to ensure counts match and no data was lost
DO $$
DECLARE
  v_old_count INTEGER := 0;
  v_new_count INTEGER := 0;
  v_migration_count INTEGER := 0;
  v_orphaned_count INTEGER := 0;
  v_new_data_count INTEGER := 0;
BEGIN
  -- Count rows in backup table
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'memory_notes_old') THEN
    SELECT COUNT(*) INTO v_old_count FROM memory_notes_old;
  END IF;

  -- Count total rows in new table
  SELECT COUNT(*) INTO v_new_count FROM memories;

  -- Count rows that were migrated
  SELECT COUNT(*) INTO v_migration_count FROM memories WHERE source = 'migration';

  -- Count new rows added since migration (not from migration)
  SELECT COUNT(*) INTO v_new_data_count FROM memories WHERE source != 'migration';

  -- Check for orphaned rows (shouldn't happen, but check anyway)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'memory_notes_old') THEN
    SELECT COUNT(*) INTO v_orphaned_count FROM memory_notes_old
      WHERE id NOT IN (SELECT id FROM memories WHERE source = 'migration');
  END IF;

  -- Print validation report
  RAISE NOTICE '';
  RAISE NOTICE '========== MIGRATION VALIDATION REPORT ==========';
  RAISE NOTICE 'Rows in memory_notes_old: %', v_old_count;
  RAISE NOTICE 'Total rows in memories: %', v_new_count;
  RAISE NOTICE '  - Migrated rows (source=migration): %', v_migration_count;
  RAISE NOTICE '  - New data rows (source!=migration): %', v_new_data_count;
  RAISE NOTICE 'Orphaned rows (not migrated): %', v_orphaned_count;
  RAISE NOTICE '================================================';

  -- Alert if there are orphaned rows
  IF v_orphaned_count > 0 THEN
    RAISE WARNING 'ALERT: % rows in memory_notes_old were NOT successfully migrated!', v_orphaned_count;
    RAISE WARNING 'The backup table memory_notes_old has been preserved.';
    RAISE WARNING 'Please manually review these orphaned rows before cleanup.';
  END IF;

  -- Confirm if migration succeeded
  IF v_old_count > 0 AND v_migration_count = v_old_count THEN
    RAISE NOTICE 'MIGRATION INTEGRITY: PASSED - All % rows successfully migrated', v_old_count;
  ELSIF v_old_count = 0 THEN
    RAISE NOTICE 'MIGRATION INTEGRITY: PASSED - No rows to migrate (fresh installation)';
  END IF;
END $$;

-- ============================================================================
-- STEP 4: Create audit view for post-migration review
-- ============================================================================

-- Create a view showing migration metadata for audit trail
CREATE OR REPLACE VIEW migration_audit_trail AS
SELECT
  'memory_notes_old' as source_table,
  (SELECT COUNT(*) FROM memory_notes_old)::INTEGER as total_rows,
  (SELECT MIN(created_at) FROM memory_notes_old) as oldest_record,
  (SELECT MAX(created_at) FROM memory_notes_old) as newest_record,
  NOW() as audit_timestamp;

-- ============================================================================
-- OPTIONAL: CLEANUP (Run ONLY after confirming migration succeeded)
-- ============================================================================
--
-- To clean up the backup table (ONLY after validation passes):
--
-- DROP TABLE memory_notes_old;
-- DROP VIEW migration_audit_trail;
--
-- This should be done as a SEPARATE migration file after confirming:
-- 1. All data successfully migrated
-- 2. Application is working with new memories table
-- 3. No orphaned rows exist
--
```

---

## Migration Data Mapping

### Column Mapping: memory_notes → memories

| Old Column | New Column | Mapping Logic |
|-----------|-----------|--------------|
| `id` | `id` | Direct copy |
| `workspace_id` | `workspace_id` | Direct copy |
| `content` | `content` | Direct copy |
| `content` | `summary` | Copy content (can be updated later) |
| N/A | `memory_type` | Default: `'observation'` |
| N/A | `importance_score` | Default: `0.5` |
| N/A | `protection_level` | Default: `2` (standard) |
| `created_at` | `created_at` | Direct copy |
| `created_at` | `updated_at` | Set to created_at initially |
| N/A | `source` | Set to `'migration'` (audit trail) |
| N/A | `confidence` | Default: `0.8` (lower for legacy data) |
| N/A | `regime_context` | Set to JSON with migration metadata |

### Default Values Explained

- **memory_type = 'observation'**: Conservative choice - most historical notes are observations
- **importance_score = 0.5**: Neutral/default - existing data hasn't been scored yet
- **protection_level = 2**: Standard protection - not immutable, not ephemeral
- **source = 'migration'**: Marks where data came from (enables filtering)
- **confidence = 0.8**: Lower than 1.0 to indicate legacy data may need review
- **regime_context**: JSON metadata to identify migrated data

---

## Validation & Safety Checks

### Pre-Migration Validation

The migration code includes:

1. **Table existence check** - Verifies `memory_notes_old` exists before migration
2. **Row count before/after** - Ensures no data loss
3. **Orphaned row detection** - Flags any rows not migrated
4. **Verbose logging** - RAISE NOTICE statements show progress

### Post-Migration Validation

1. **Automatic report generation** - Shows migration statistics
2. **Integrity check** - Confirms row counts match
3. **Alert on failure** - Warns if migration appears incomplete
4. **Audit trail** - `migration_audit_trail` view preserves metadata

### Failure Recovery

If migration fails:

1. **Backup preserved** - `memory_notes_old` table remains
2. **Can retry** - Delete from memories and retry
3. **Rollback possible** - Recreate `memory_notes` from backup
4. **No data loss** - Original data still in backup table

---

## Step-by-Step Implementation

### 1. Find and Open Current Migration File

```bash
cat /Users/zstoc/GitHub/quant-chat-scaffold/supabase/migrations/20251123000000_enhance_memory_system.sql
```

### 2. Replace the DROP Statement

Current (unsafe):
```sql
DROP TABLE IF EXISTS memory_notes CASCADE;
```

New (safe):
```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Rename old table instead of dropping (preserves data)
ALTER TABLE IF EXISTS memory_notes RENAME TO memory_notes_old;
```

### 3. Add Migration Logic

After all the table and index definitions, add the data migration code (see complete SQL above).

### 4. Test the Migration

```sql
-- Check if backup exists
SELECT table_name FROM information_schema.tables
WHERE table_name = 'memory_notes_old';

-- Verify row counts
SELECT
  (SELECT COUNT(*) FROM memory_notes_old) as old_rows,
  (SELECT COUNT(*) FROM memories WHERE source = 'migration') as migrated_rows;

-- View audit trail
SELECT * FROM migration_audit_trail;
```

### 5. Cleanup (AFTER VALIDATION)

Only after confirming the migration succeeded, run cleanup as a separate migration:

```bash
# Create a new migration file (e.g., 20251123_cleanup_memory_notes_old.sql)

# Contents:
DROP TABLE IF EXISTS memory_notes_old;
DROP VIEW IF EXISTS migration_audit_trail;
```

---

## Rollback Plan

If migration needs to be rolled back:

```sql
-- 1. Delete migrated data from new table
DELETE FROM memories WHERE source = 'migration';

-- 2. Rename backup back to original name
ALTER TABLE memory_notes_old RENAME TO memory_notes;

-- 3. Recreate audit view if needed
CREATE OR REPLACE VIEW migration_audit_trail AS ...
```

---

## Files to Update

1. **Primary:** `/Users/zstoc/GitHub/quant-chat-scaffold/supabase/migrations/20251123000000_enhance_memory_system.sql`
   - Replace DROP statement (line 5)
   - Add migration code after indexes (after line 86)

2. **Reference:** This document (`SAFE_DATA_MIGRATION_STRATEGY.md`)
   - Keep as documentation

---

## Verification Checklist

- [ ] Backup table `memory_notes_old` created
- [ ] All rows migrated to `memories` table
- [ ] Row counts match (SELECT COUNT(*) verification)
- [ ] No orphaned rows exist
- [ ] Audit trail view created
- [ ] Migration log shows SUCCESS status
- [ ] Application tested with new schema
- [ ] Ready to cleanup (drop old table)

---

## Key Differences from Original

| Aspect | Original (Unsafe) | New (Safe) |
|--------|-------------------|-----------|
| Data preservation | DROP (destroys) | RENAME (preserves) |
| Error handling | None | Comprehensive checks |
| Validation | None | Row count + orphan detection |
| Audit trail | None | migration_audit_trail view |
| Rollback | Impossible (data lost) | Possible (data preserved) |
| Logging | None | RAISE NOTICE for visibility |

---

## Status

This migration strategy is **ready to implement**. The complete SQL code is provided above and can be inserted directly into the migration file.
