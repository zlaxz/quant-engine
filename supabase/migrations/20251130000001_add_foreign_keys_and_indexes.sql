-- Migration: Add foreign keys and composite indexes to session_contexts
-- Purpose: Improve data integrity and query performance
-- Part of: Audit improvement implementation (2025-11-30)

-- ============================================================================
-- STEP 1: Add foreign key constraint (if chat_sessions table exists)
-- ============================================================================

-- Note: Adjust this if your session table has a different name
-- This prevents orphaned session contexts when sessions are deleted
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_sessions') THEN
    ALTER TABLE session_contexts
    ADD CONSTRAINT fk_session_contexts_session_id
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE;
  ELSE
    RAISE NOTICE 'chat_sessions table not found - skipping foreign key constraint';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Add composite indexes for common query patterns
-- ============================================================================

-- Query pattern: Get all context for a session with specific role
-- Example: SELECT * FROM session_contexts WHERE session_id = ? AND role = 'reasoning'
CREATE INDEX IF NOT EXISTS idx_session_contexts_session_role
ON session_contexts(session_id, role);

-- Query pattern: Get recent contexts (cleanup queries, time-based retrieval)
CREATE INDEX IF NOT EXISTS idx_session_contexts_created_desc
ON session_contexts(created_at DESC);

-- Query pattern: Get latest context from a specific model across sessions
-- Example: SELECT * FROM session_contexts WHERE model = 'gemini' ORDER BY created_at DESC LIMIT 10
CREATE INDEX IF NOT EXISTS idx_session_contexts_model_created
ON session_contexts(model, created_at DESC);

-- Query pattern: Get all context for active sessions
-- Note: Partial indexes with NOW() aren't allowed (non-immutable)
-- Using regular index instead - filter in application layer
CREATE INDEX IF NOT EXISTS idx_session_contexts_recent_sessions
ON session_contexts(session_id, created_at DESC);

-- ============================================================================
-- STEP 3: Add comments for documentation
-- ============================================================================

COMMENT ON INDEX idx_session_contexts_session_role IS 'Optimizes role-based context retrieval within sessions';
COMMENT ON INDEX idx_session_contexts_created_desc IS 'Optimizes time-based queries and cleanup operations';
COMMENT ON INDEX idx_session_contexts_model_created IS 'Optimizes model-specific context history queries';
COMMENT ON INDEX idx_session_contexts_recent_sessions IS 'Index for session-based queries (filter in app layer)';
