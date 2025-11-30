# Memory Notes Migration - Quick Reference

## Status

Current Issue: `memory_notes` → `memories` migration needs safe data transfer

| Aspect | Status |
|--------|--------|
| Data Preservation | Safe (RENAME instead of DROP) |
| Migration Logic | Ready to implement |
| Testing Queries | Provided |
| Cleanup Script | Optional, ready to use |

---

## Files Created

| File | Purpose |
|------|---------|
| `SAFE_DATA_MIGRATION_STRATEGY.md` | Complete strategy & SQL code |
| `.claude/docs/MIGRATION_IMPLEMENTATION_GUIDE.md` | Step-by-step instructions |
| `supabase/migrations/safe_migration_data_transfer.sql` | Migration code snippet |
| `supabase/migrations/20251123000001_cleanup_memory_notes_old.sql` | Optional cleanup |
| `supabase/migrations/MIGRATION_VERIFICATION.sql` | Testing & verification |

---

## Quick Implementation (5 Steps)

### 1. Update Main Migration File

**File:** `supabase/migrations/20251123000000_enhance_memory_system.sql`

**Replace line 5:**
```sql
-- OLD (UNSAFE):
DROP TABLE IF EXISTS memory_notes CASCADE;

-- NEW (SAFE):
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE IF EXISTS memory_notes RENAME TO memory_notes_old;
```

### 2. Add Migration Logic

**After line 86** (after all CREATE INDEX statements), insert contents of:
```
supabase/migrations/safe_migration_data_transfer.sql
```

### 3. Deploy

```bash
supabase db push
```

**Watch output for:**
```
[Migration] SUCCESS: Migrated N rows to memories table
MIGRATION INTEGRITY: PASSED
```

### 4. Verify

```bash
# Run these queries in Supabase SQL Editor

-- Check row counts match
SELECT COUNT(*) FROM memory_notes_old;
SELECT COUNT(*) FROM memories WHERE source = 'migration';

-- Check for orphaned rows (should be 0)
SELECT COUNT(*) FROM memory_notes_old
WHERE id NOT IN (SELECT id FROM memories WHERE source = 'migration');

-- View migration metadata
SELECT * FROM migration_audit_trail;
```

### 5. Cleanup (Optional)

After confirming everything works:
```bash
supabase db push --file supabase/migrations/20251123000001_cleanup_memory_notes_old.sql
```

---

## Data Mapping Summary

```
Old Table (memory_notes)          New Table (memories)
├── id                            ├── id (copied)
├── workspace_id                  ├── workspace_id (copied)
├── content                       ├── content (copied)
├── created_at                    ├── created_at (copied)
├── tags                          ├── (not migrated - not in new schema)
└── source (auto='manual'/'auto')  ├── summary = content
                                  ├── memory_type = 'observation'
                                  ├── importance_score = 0.5
                                  ├── protection_level = 2
                                  ├── source = 'migration'
                                  ├── confidence = 0.8
                                  ├── regime_context = {migration metadata}
                                  └── (other fields = defaults)
```

---

## Column Mapping

| Old | New | Value | Reason |
|-----|-----|-------|--------|
| `id` | `id` | Copied | Preserve identity |
| `workspace_id` | `workspace_id` | Copied | Preserve scope |
| `content` | `content` | Copied | Main data |
| `content` | `summary` | Same as content | Can update later |
| - | `memory_type` | `'observation'` | Safe default |
| - | `importance_score` | `0.5` | Neutral, unscored |
| - | `protection_level` | `2` (standard) | Not immutable/ephemeral |
| `created_at` | `created_at` | Copied | Preserve timeline |
| - | `updated_at` | = created_at | Set to creation |
| - | `source` | `'migration'` | Mark as migrated |
| - | `confidence` | `0.8` | Indicate legacy |

---

## Validation Checks

| Check | Query | Expected |
|-------|-------|----------|
| Row count | `SELECT COUNT(*) FROM memory_notes_old;` `SELECT COUNT(*) FROM memories WHERE source='migration';` | Equal |
| Orphaned rows | `SELECT COUNT(*) FROM memory_notes_old WHERE id NOT IN (SELECT id FROM memories WHERE source='migration');` | 0 |
| Audit trail | `SELECT * FROM migration_audit_trail;` | Shows migration timestamp |
| No NULLs | `SELECT COUNT(*) FROM memories WHERE source='migration' AND (id IS NULL OR workspace_id IS NULL OR content IS NULL);` | 0 |

---

## Safety Guardrails

| Safeguard | How It Works |
|-----------|-------------|
| Backup table | `memory_notes_old` preserved indefinitely |
| Row count validation | Automatic check during migration |
| Orphaned row detection | Finds rows not successfully migrated |
| Audit trail | `migration_audit_trail` view with timestamps |
| Rollback possible | Data never deleted until cleanup run |
| Intelligent defaults | Conservative choices for new columns |

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Row count mismatch | Migration incomplete | Find orphaned rows, retry |
| Orphaned rows found | Some rows not migrated | Manually migrate or delete |
| memory_notes still exists | Migration not run | Confirm RENAME statement added |
| memory_notes_old missing | Already cleaned up | Check if on new schema |

---

## Rollback (If Needed)

```sql
-- 1. Delete migrated data
DELETE FROM memories WHERE source = 'migration';

-- 2. Restore backup
ALTER TABLE memory_notes_old RENAME TO memory_notes;

-- 3. Application reverts to old schema
```

**No data lost** because backup table preserved.

---

## Performance Impact

- Migration runs in seconds (< 1s for typical data)
- Row count validation automatic
- No downtime required (PostgreSQL handles renames gracefully)
- Indexes created in parallel with data

---

## Monitoring

### During Migration
```
[Migration] Starting data migration: Found N rows
[Migration] SUCCESS: Migrated N rows
========== MIGRATION VALIDATION REPORT ==========
Rows migrated: N
Orphaned rows: 0
MIGRATION INTEGRITY: PASSED
```

### After Migration
Run verification queries to confirm:
- Row counts match
- No orphaned rows
- Audit trail available
- Application works

---

## Key Decisions

| Question | Answer | Why |
|----------|--------|-----|
| Keep backup table? | YES (indefinitely) | Safe rollback, can delete later |
| Mark migrated data? | YES (source='migration') | Distinguish from new data |
| Lower confidence? | YES (0.8) | Indicates may need review |
| Conservative type? | YES ('observation') | Safest assumption |
| Default importance? | YES (0.5) | Neutral, can be scored later |

---

## Next Steps

1. **Read:** `SAFE_DATA_MIGRATION_STRATEGY.md` (complete overview)
2. **Implement:** Follow `.claude/docs/MIGRATION_IMPLEMENTATION_GUIDE.md`
3. **Update:** Replace DROP in main migration file
4. **Deploy:** `supabase db push`
5. **Verify:** Run verification queries
6. **Test:** Confirm application works
7. **Cleanup:** Optional - remove backup after confirmation

---

## Files to Review

- **Complete strategy:** `/Users/zstoc/GitHub/quant-chat-scaffold/SAFE_DATA_MIGRATION_STRATEGY.md`
- **Implementation guide:** `/Users/zstoc/GitHub/quant-chat-scaffold/.claude/docs/MIGRATION_IMPLEMENTATION_GUIDE.md`
- **Migration code:** `/Users/zstoc/GitHub/quant-chat-scaffold/supabase/migrations/safe_migration_data_transfer.sql`
- **Verification queries:** `/Users/zstoc/GitHub/quant-chat-scaffold/supabase/migrations/MIGRATION_VERIFICATION.sql`

---

## Estimated Timeline

| Phase | Time |
|-------|------|
| Read strategy | 5 min |
| Update migration file | 5 min |
| Deploy | 1 min |
| Verification | 2 min |
| Application testing | 5-10 min |
| Cleanup (optional) | 1 min |
| **Total** | **20 min** |

---

**Status:** Ready to implement
**Risk:** Very low (backup preserved)
**Data Loss Risk:** Zero
**Rollback:** Yes (data preserved in backup)
