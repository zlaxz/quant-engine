-- Migration: Add Memory Expiry Fields (v2.1 Memory System)
-- Purpose: Support permanent/standard classification with automatic pruning
-- Run this in Supabase SQL Editor: Dashboard > SQL Editor > New Query

-- Add permanent flag (true = never expires, false = subject to 30-day expiry)
ALTER TABLE memories
ADD COLUMN IF NOT EXISTS permanent BOOLEAN DEFAULT FALSE;

-- Add expiration timestamp (NULL = permanent, DATE = auto-prune after this date)
ALTER TABLE memories
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Index for efficient pruning queries
CREATE INDEX IF NOT EXISTS idx_memories_expires_at
ON memories(expires_at)
WHERE expires_at IS NOT NULL;

-- Index for querying permanent memories
CREATE INDEX IF NOT EXISTS idx_memories_permanent
ON memories(permanent)
WHERE permanent = TRUE;

-- Update existing memories: Set non-immutable ones to expire in 30 days
-- (immutable memories become permanent)
UPDATE memories
SET
    permanent = COALESCE(immutable, FALSE),
    expires_at = CASE
        WHEN COALESCE(immutable, FALSE) = TRUE THEN NULL
        ELSE NOW() + INTERVAL '30 days'
    END
WHERE permanent IS NULL;

-- Create pruning function (run daily via cron or manual)
CREATE OR REPLACE FUNCTION prune_expired_memories()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM memories
    WHERE expires_at IS NOT NULL
    AND expires_at < NOW()
    AND permanent = FALSE;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RAISE NOTICE 'Pruned % expired memories', deleted_count;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Verify migration
SELECT
    COUNT(*) as total_memories,
    COUNT(*) FILTER (WHERE permanent = TRUE) as permanent_count,
    COUNT(*) FILTER (WHERE expires_at IS NOT NULL) as expiring_count,
    COUNT(*) FILTER (WHERE expires_at < NOW()) as expired_count
FROM memories;

COMMENT ON COLUMN memories.permanent IS 'If TRUE, memory never expires. If FALSE, subject to expires_at date.';
COMMENT ON COLUMN memories.expires_at IS 'When this memory should be auto-pruned. NULL for permanent memories.';
