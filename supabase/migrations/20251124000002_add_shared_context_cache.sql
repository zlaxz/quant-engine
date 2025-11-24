-- Migration: Add shared_context for Neural/Context Caching
-- Purpose: Store context cache IDs so we don't re-upload codebase for every agent
-- Supports: Google Gemini Context Caching, OpenAI Context, etc.

-- ============================================================================
-- STEP 1: Add shared_context column to swarm_jobs
-- ============================================================================

ALTER TABLE swarm_jobs
ADD COLUMN IF NOT EXISTS shared_context JSONB DEFAULT '{}';

-- Structure:
-- {
--   "cache_id": "gemini-cache-abc123",        -- Provider's cache ID
--   "provider": "google",                     -- Which provider created the cache
--   "model": "gemini-3-pro-preview",          -- Model the cache is for
--   "files_hash": "sha256:...",               -- Hash of uploaded files (for invalidation)
--   "created_at": "2024-11-24T...",           -- When cache was created
--   "expires_at": "2024-11-25T...",           -- When cache expires
--   "token_count": 50000                      -- Tokens in cache
-- }

COMMENT ON COLUMN swarm_jobs.shared_context IS 'Context cache IDs for provider-specific caching (e.g., Gemini Context Caching)';

-- ============================================================================
-- STEP 2: Add shared_context to swarm_tasks (for task-specific overrides)
-- ============================================================================

ALTER TABLE swarm_tasks
ADD COLUMN IF NOT EXISTS shared_context JSONB DEFAULT NULL;

COMMENT ON COLUMN swarm_tasks.shared_context IS 'Optional task-specific context cache override';

-- ============================================================================
-- STEP 3: Add helper function to check if cache is still valid
-- ============================================================================

CREATE OR REPLACE FUNCTION is_context_cache_valid(p_shared_context JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_expires_at TIMESTAMPTZ;
BEGIN
    IF p_shared_context IS NULL OR p_shared_context = '{}'::JSONB THEN
        RETURN FALSE;
    END IF;

    -- Check if expires_at exists and is in the future
    v_expires_at := (p_shared_context->>'expires_at')::TIMESTAMPTZ;

    IF v_expires_at IS NULL THEN
        RETURN TRUE; -- No expiration, assume valid
    END IF;

    RETURN v_expires_at > NOW();
END;
$$;

COMMENT ON FUNCTION is_context_cache_valid IS 'Check if a context cache is still valid based on expiration';

-- ============================================================================
-- STEP 4: Add index for cache lookups
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_swarm_jobs_cache_id
ON swarm_jobs ((shared_context->>'cache_id'))
WHERE shared_context IS NOT NULL AND shared_context != '{}'::JSONB;
