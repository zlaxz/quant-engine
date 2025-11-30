# Migration Data Flow & Architecture Diagram

---

## Current State vs Proposed State

### Current (Unsafe) Migration

```
┌────────────────────────────────────────────┐
│ memory_notes table                         │
│ ├── 100 rows of data                       │
│ └── (workspace, content, created_at)       │
└────────────────────────────────────────────┘
           ↓
    [DROP TABLE]  ❌ UNSAFE
           ↓
      DATA LOST
     No backup
   No rollback
```

---

### Proposed (Safe) Migration

```
┌────────────────────────────────────────────┐
│ memory_notes table (ORIGINAL)              │
│ ├── id, workspace_id, content, created_at  │
│ └── 100 rows of data                       │
└────────────────────────────────────────────┘
           ↓
   [RENAME TABLE] ✓ SAFE
           ↓
┌────────────────────────────────────────────┐
│ memory_notes_old table (BACKUP)            │
│ ├── Same structure as original             │
│ └── 100 rows preserved                     │
└────────────────────────────────────────────┘
           ↓
 [MIGRATE DATA - INSERT SELECT]
           ↓
┌────────────────────────────────────────────┐
│ memories table (NEW SCHEMA)                │
│ ├── id, workspace_id, content, summary     │
│ ├── memory_type, importance_score          │
│ ├── protection_level, regime_context       │
│ ├── ... + 15 more enhanced fields          │
│ └── 100 rows migrated + defaults filled    │
└────────────────────────────────────────────┘
           ↓
    [VALIDATION]
    ├── Row counts match: 100 = 100 ✓
    ├── No orphaned rows: 0 ✓
    └── Audit trail created ✓
           ↓
 [OPTIONAL CLEANUP]
           ↓
   DROP memory_notes_old
  (backup removed after validation)
```

---

## Data Flow Through Migration Process

```
START: Deploy Migration File
    │
    ├─ Enable vector extension
    ├─ Rename memory_notes → memory_notes_old
    └─ Create memories table with new schema
    │
    ↓
STEP 2: Migrate Data
    │
    └─ DO $$ (PL/pgSQL block)
        │
        ├─ Check if memory_notes_old exists
        │
        ├─ IF exists:
        │  │
        │  ├─ COUNT(*) → v_old_row_count = N
        │  │
        │  ├─ INSERT INTO memories
        │  │  SELECT id, workspace_id, content,
        │  │         content AS summary,
        │  │         'observation' AS memory_type,
        │  │         0.5 AS importance_score,
        │  │         ... (all defaults)
        │  │  FROM memory_notes_old
        │  │
        │  ├─ COUNT(*) FROM memories WHERE source='migration'
        │  │  → v_new_row_count = N
        │  │
        │  └─ IF v_new_row_count = v_old_row_count
        │     THEN v_migration_success = TRUE ✓
        │     ELSE RAISE WARNING ❌
        │
        └─ END IF
    │
    ↓
STEP 3: Validate Migration
    │
    └─ DO $$ (PL/pgSQL block)
        │
        ├─ COUNT(*) FROM memory_notes_old = X
        ├─ COUNT(*) FROM memories = Y
        ├─ COUNT(*) FROM memories WHERE source='migration' = Z
        ├─ COUNT(*) orphaned rows = 0
        │
        └─ Print validation report
            ├─ RAISE NOTICE: Row counts
            ├─ RAISE NOTICE: Orphaned count
            └─ RAISE NOTICE: Status (PASSED/FAILED)
    │
    ↓
STEP 4: Create Audit Trail
    │
    └─ CREATE VIEW migration_audit_trail
        ├─ Shows source_table name
        ├─ Shows total_rows
        ├─ Shows oldest_record date
        ├─ Shows newest_record date
        └─ Shows audit_timestamp
    │
    ↓
STEP 5: Wait for Validation
    │
    ├─ IF migration PASSED
    │  └─ Ready for cleanup (optional)
    │
    └─ IF migration FAILED
       └─ DO NOT CLEANUP
          └─ Troubleshoot first
    │
    ↓
STEP 6: Optional Cleanup
    │
    └─ IF all validations passed AND app tested:
        │
        ├─ Final validation before cleanup
        ├─ DROP TABLE memory_notes_old
        ├─ DROP VIEW migration_audit_trail
        │
        └─ DONE ✓
```

---

## Column Data Flow

```
OLD SCHEMA (memory_notes)
│
├── id → memories.id
│   Example: UUID '123abc...'
│   Mapping: Copy directly ✓
│
├── workspace_id → memories.workspace_id
│   Example: UUID 'workspace-1'
│   Mapping: Copy directly ✓
│
├── content → memories.content
│   Example: "RSI hit 70 on SPY"
│   Mapping: Copy directly ✓
│
├── content → memories.summary
│   Example: "RSI hit 70 on SPY"
│   Mapping: Copy from content field
│   (Can be updated later)
│
├── created_at → memories.created_at
│   Example: 2025-11-20 14:30:00
│   Mapping: Copy directly ✓
│
├── created_at → memories.updated_at
│   Example: 2025-11-20 14:30:00
│   Mapping: Set to created_at initially
│   (Auto-updated on changes via trigger)
│
└── tags (not used) → (dropped)
   Example: ['insights', 'market']
   Mapping: Not migrated to new schema
   (Can be stored in category/entities if needed)


NEW FIELDS (filled with defaults)
│
├── summary = content (copied field)
├── memory_type = 'observation' (conservative default)
├── importance_score = 0.5 (neutral, unscored)
├── protection_level = 2 (standard)
├── source = 'migration' (identifies migrated data)
├── confidence = 0.8 (indicates legacy data)
├── regime_context = '{"migrated": true, ...}' (metadata)
│
└── All other fields = NULL (can be populated later)
   ├── embedding (NULL until calculated)
   ├── memory_type (now 'observation' for all)
   ├── category (NULL, can be set later)
   ├── symbols (NULL, can be extracted)
   ├── strategies (NULL, can be linked)
   └── ... etc
```

---

## Database State at Each Phase

### Phase 0: Before Migration

```
┌─────────────────┐
│  Database       │
├─────────────────┤
│ Tables:         │
│  ├─ workspaces  │
│  ├─ chat_sessions
│  ├─ messages    │
│  ├─ backtest_runs
│  ├─ memory_notes ← 100 rows (simple schema)
│  └─ ... others  │
│                 │
└─────────────────┘
```

### Phase 1: During Migration (RENAME)

```
┌──────────────────────────┐
│  Database                │
├──────────────────────────┤
│ Tables:                  │
│  ├─ workspaces           │
│  ├─ memory_notes_old ← Just renamed, same 100 rows
│  ├─ memories (created, empty for now)
│  └─ ... others           │
│                          │
│ State: INTERMEDIATE      │
│ Both tables present      │
│                          │
└──────────────────────────┘
```

### Phase 2: During Migration (INSERT SELECT)

```
┌──────────────────────────────────────┐
│  Database                            │
├──────────────────────────────────────┤
│ memory_notes_old:                    │
│  ├─ id, workspace_id, content, ...   │
│  └─ 100 rows (untouched)             │
│                                      │
│ memories:                            │
│  ├─ id, workspace_id, content, ...   │
│  ├─ memory_type, importance_score    │
│  └─ 100 rows (being inserted)        │
│                                      │
│ State: MIGRATING                     │
│ Data copied & transformed            │
│                                      │
└──────────────────────────────────────┘
```

### Phase 3: After Migration (VALIDATE)

```
┌───────────────────────────────────────┐
│  Database                             │
├───────────────────────────────────────┤
│ memory_notes_old:                     │
│  └─ 100 rows (backup, preserved)      │
│                                       │
│ memories:                             │
│  ├─ 100 rows (migrated data)          │
│  ├─ source='migration' (all)          │
│  └─ All new fields populated          │
│                                       │
│ migration_audit_trail (view):         │
│  └─ Shows migration metadata          │
│                                       │
│ State: COMPLETE & VALIDATED           │
│ Ready for cleanup or production use   │
│                                       │
└───────────────────────────────────────┘
```

### Phase 4: After Cleanup (OPTIONAL)

```
┌─────────────────┐
│  Database       │
├─────────────────┤
│ Tables:         │
│  ├─ memories ← 100 rows (final schema)
│  ├─ workspaces  │
│  └─ ... others  │
│                 │
│ Removed:        │
│  ├─ memory_notes_old (backup deleted)
│  └─ migration_audit_trail (view deleted)
│                 │
│ State: FINAL    │
│ Old schema gone │
│                 │
└─────────────────┘
```

---

## Validation Data Flow

```
AFTER MIGRATION COMPLETES:

Validation Queries Run:
├─ Count memory_notes_old rows
│  └─ Result: 100
│
├─ Count memories rows (where source='migration')
│  └─ Result: 100
│
├─ Find orphaned rows
│  └─ Result: 0 (all rows found)
│
├─ Check for NULL values
│  └─ Result: 0 NULLs in critical fields
│
└─ Verify audit trail
   └─ Result: Shows migration timestamp

COMPARISON:
100 memory_notes_old
 = 100 memories (source='migration')
 = 100 with source='migration'
 = 0 orphaned
 = 0 orphaned

STATUS: PASSED ✓
All data accounted for
Safe to cleanup (optional)
```

---

## Rollback Data Flow (If Needed)

```
IF APPLICATION ISSUES FOUND:

Step 1: Delete migrated data
│
└─ DELETE FROM memories WHERE source = 'migration'
   ├─ Removes 100 rows
   └─ memories table now empty
│
Step 2: Restore backup
│
└─ ALTER TABLE memory_notes_old RENAME TO memory_notes
   ├─ Backup renamed back
   └─ Original schema restored
│
Step 3: Application reverts
│
└─ Uses memory_notes again
   └─ No client-side changes needed

TIME REQUIRED: < 1 minute
DATA LOST: ZERO (backup preserved)
IMPACT: Low (original state restored)
```

---

## Memory Path Through System

```
USER DATA:
"RSI 70 on SPY, consider exit"
│
├─ memory_notes (OLD)
│  ├─ id: uuid1
│  ├─ workspace_id: ws1
│  ├─ content: "RSI 70 on SPY, consider exit"
│  └─ created_at: 2025-11-20
│
└─ migration_notes_old (BACKUP)
   ├─ id: uuid1
   ├─ workspace_id: ws1
   ├─ content: "RSI 70 on SPY, consider exit"
   └─ created_at: 2025-11-20
│
└─ memories (NEW)
   ├─ id: uuid1 (preserved)
   ├─ workspace_id: ws1 (preserved)
   ├─ content: "RSI 70 on SPY, consider exit" (preserved)
   ├─ summary: "RSI 70 on SPY, consider exit" (copied from content)
   ├─ memory_type: 'observation' (default)
   ├─ importance_score: 0.5 (default)
   ├─ protection_level: 2 (default)
   ├─ source: 'migration' (marker)
   ├─ confidence: 0.8 (legacy indicator)
   ├─ regime_context: {migration metadata}
   └─ created_at: 2025-11-20 (preserved)
│
├─ Query returns: memory with all fields
├─ Application displays: "RSI 70 on SPY..." with metadata
└─ Can be updated: Add embedding, adjust importance, etc.
```

---

## Error Handling Flow

```
START MIGRATION
│
├─ RENAME memory_notes → memory_notes_old
│  ├─ Success → Continue
│  └─ Fail (table doesn't exist) → Fresh install, skip
│
├─ INSERT SELECT from memory_notes_old
│  ├─ Success → Continue
│  └─ Fail (schema mismatch) → ALERT: See troubleshooting
│
├─ VALIDATE counts
│  ├─ Match (100 = 100) → SUCCESS
│  ├─ Mismatch (100 != 95) → WARNING: Orphaned rows
│  └─ NULL values found → WARNING: Data integrity issue
│
├─ CREATE audit trail
│  ├─ Success → COMPLETE
│  └─ Fail (view creation) → MINOR: Manual review
│
└─ IF ANY FAILURE
   └─ DO NOT PROCEED to cleanup
      └─ Backup table preserved for rollback
         └─ Can retry after fixing
```

---

## Index Creation During Migration

```
BEFORE MIGRATION:
memory_notes:
└─ idx_memory_notes_workspace_id
   idx_memory_notes_created_at
   idx_memory_notes_tags (GIN)

AFTER MIGRATION:
memories:
├─ idx_memories_workspace (btree)
├─ idx_memories_session (btree)
├─ idx_memories_content_fts (GIN tsvector)
├─ idx_memories_embedding (IVFFlat vector)
├─ idx_memories_importance (btree DESC)
├─ idx_memories_category (btree)
├─ idx_memories_created (btree DESC)
├─ idx_memories_symbols (GIN array)
├─ idx_memories_strategies (GIN array)
├─ idx_memories_type_importance (btree compound)
├─ idx_memories_protection_level (btree)
├─ idx_memories_regime (GIN JSONB)
└─ idx_memories_last_recalled (btree)

RESULT: 13 indexes for fast queries
        Supports hybrid search, filtering by type/importance
        Vector similarity search enabled
        Full-text search enabled
```

---

## Performance Characteristics

```
Migration Performance:
├─ Table rename: < 10ms (instant in PostgreSQL)
├─ Data migration (100 rows): < 100ms
├─ Validation queries: < 50ms
├─ Total migration time: < 1 second
│
Application Performance (after migration):
├─ Query by workspace_id: Fast (btree index)
├─ Full-text search: Fast (GIN tsvector)
├─ Vector search: Fast (IVFFlat index)
├─ Filter by type+importance: Fast (compound index)
└─ Mixed hybrid search: Fast (combined indexes)

Disk Usage:
├─ Before: ~1 row × columns ≈ 500 bytes/row
├─ After: ~1.5 row × columns ≈ 750 bytes/row
│         (extra columns, but same data)
└─ Increase: ~50-100KB for typical dataset

No performance degradation with new schema ✓
```

---

## Summary: Data Flow Safety

```
UNSAFE OLD WAY:
memory_notes --[DROP]--> GONE (no backup, no rollback)

SAFE NEW WAY:
memory_notes --[RENAME]--> memory_notes_old (backup)
                            ↓
                      [INSERT SELECT with validation]
                            ↓
                           memories (new schema, 100% mapped)
                            ↓
                      [Verify row counts match]
                            ↓
                      [Optional cleanup after validation]
                            ↓
                      [Can rollback anytime]
```

**Key difference:** Data never deleted, always backed up, always validated.
