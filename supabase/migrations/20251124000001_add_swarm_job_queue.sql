-- Migration: Add Swarm Job Queue for Massive Parallel Agent Execution
-- Purpose: Decouple request from execution to support 50+ parallel agents
-- Pattern: Database-backed job queue with dispatcher/worker architecture

-- ============================================================================
-- STEP 1: Create status enum type for job/task states
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE swarm_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- STEP 2: Create swarm_jobs table (tracks overall massive requests)
-- ============================================================================

CREATE TABLE IF NOT EXISTS swarm_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Job identification
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    objective TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'research', -- 'research', 'evolution', 'audit', 'analysis'

    -- Configuration
    agent_count INTEGER NOT NULL DEFAULT 10,
    config JSONB DEFAULT '{}', -- Additional config (temperature, max_tokens, etc.)

    -- Status tracking
    status swarm_status NOT NULL DEFAULT 'pending',
    progress_pct INTEGER DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),

    -- Results
    synthesis_result TEXT, -- Final synthesized output from primary model
    synthesis_metadata JSONB, -- Token usage, timing, etc.

    -- Error tracking
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Metadata
    created_by TEXT, -- User or system identifier
    tags TEXT[] DEFAULT '{}'
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_swarm_jobs_workspace ON swarm_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_swarm_jobs_status ON swarm_jobs(status);
CREATE INDEX IF NOT EXISTS idx_swarm_jobs_created_at ON swarm_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swarm_jobs_mode ON swarm_jobs(mode);

-- ============================================================================
-- STEP 3: Create swarm_tasks table (tracks individual agent units)
-- ============================================================================

CREATE TABLE IF NOT EXISTS swarm_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Parent job reference
    job_id UUID NOT NULL REFERENCES swarm_jobs(id) ON DELETE CASCADE,

    -- Agent configuration
    agent_role TEXT NOT NULL, -- 'researcher', 'mutator', 'auditor', 'analyst', etc.
    agent_index INTEGER NOT NULL, -- 0-based index within the job

    -- Input/Output
    input_context TEXT NOT NULL, -- The prompt/context sent to the agent
    input_metadata JSONB DEFAULT '{}', -- Additional input data (strategy params, etc.)
    output_content TEXT, -- The agent's response
    output_metadata JSONB DEFAULT '{}', -- Chain of thought, reasoning steps, etc.

    -- Status tracking
    status swarm_status NOT NULL DEFAULT 'pending',

    -- Performance metrics
    tokens_input INTEGER,
    tokens_output INTEGER,
    latency_ms INTEGER, -- Time to complete in milliseconds
    model_used TEXT, -- Which model actually processed this task

    -- Error tracking
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- For worker claiming
    worker_id TEXT, -- Identifies which worker instance claimed this task
    claimed_at TIMESTAMPTZ
);

-- Indexes for efficient worker polling and job aggregation
CREATE INDEX IF NOT EXISTS idx_swarm_tasks_job_id ON swarm_tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_swarm_tasks_status ON swarm_tasks(status);
CREATE INDEX IF NOT EXISTS idx_swarm_tasks_pending ON swarm_tasks(status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_swarm_tasks_job_status ON swarm_tasks(job_id, status);
CREATE INDEX IF NOT EXISTS idx_swarm_tasks_worker ON swarm_tasks(worker_id) WHERE worker_id IS NOT NULL;

-- ============================================================================
-- STEP 4: Helper functions for atomic task claiming and job progress
-- ============================================================================

-- Atomically claim a batch of pending tasks (prevents race conditions)
CREATE OR REPLACE FUNCTION claim_swarm_tasks(
    p_worker_id TEXT,
    p_batch_size INTEGER DEFAULT 5
)
RETURNS SETOF swarm_tasks
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH claimed AS (
        SELECT id
        FROM swarm_tasks
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    )
    UPDATE swarm_tasks t
    SET
        status = 'processing',
        worker_id = p_worker_id,
        claimed_at = NOW(),
        started_at = NOW()
    FROM claimed c
    WHERE t.id = c.id
    RETURNING t.*;
END;
$$;

-- Update job progress based on completed tasks
CREATE OR REPLACE FUNCTION update_job_progress(p_job_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_total INTEGER;
    v_completed INTEGER;
    v_failed INTEGER;
    v_progress INTEGER;
BEGIN
    -- Count tasks by status
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'completed'),
        COUNT(*) FILTER (WHERE status = 'failed')
    INTO v_total, v_completed, v_failed
    FROM swarm_tasks
    WHERE job_id = p_job_id;

    -- Calculate progress percentage
    IF v_total > 0 THEN
        v_progress := ((v_completed + v_failed) * 100) / v_total;
    ELSE
        v_progress := 0;
    END IF;

    -- Update job progress
    UPDATE swarm_jobs
    SET
        progress_pct = v_progress,
        status = CASE
            -- All tasks completed successfully
            WHEN v_completed = v_total THEN 'completed'::swarm_status
            -- All tasks finished (some failed)
            WHEN (v_completed + v_failed) = v_total AND v_failed > 0 THEN 'completed'::swarm_status
            -- Still processing
            WHEN v_progress > 0 THEN 'processing'::swarm_status
            ELSE status
        END,
        completed_at = CASE
            WHEN (v_completed + v_failed) = v_total THEN NOW()
            ELSE completed_at
        END
    WHERE id = p_job_id;
END;
$$;

-- Get job status with task breakdown
CREATE OR REPLACE FUNCTION get_job_status(p_job_id UUID)
RETURNS TABLE (
    job_id UUID,
    job_status swarm_status,
    progress_pct INTEGER,
    total_tasks INTEGER,
    pending_tasks INTEGER,
    processing_tasks INTEGER,
    completed_tasks INTEGER,
    failed_tasks INTEGER,
    avg_latency_ms NUMERIC,
    total_tokens INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        j.id AS job_id,
        j.status AS job_status,
        j.progress_pct,
        COUNT(t.id)::INTEGER AS total_tasks,
        COUNT(t.id) FILTER (WHERE t.status = 'pending')::INTEGER AS pending_tasks,
        COUNT(t.id) FILTER (WHERE t.status = 'processing')::INTEGER AS processing_tasks,
        COUNT(t.id) FILTER (WHERE t.status = 'completed')::INTEGER AS completed_tasks,
        COUNT(t.id) FILTER (WHERE t.status = 'failed')::INTEGER AS failed_tasks,
        AVG(t.latency_ms) FILTER (WHERE t.status = 'completed') AS avg_latency_ms,
        SUM(COALESCE(t.tokens_input, 0) + COALESCE(t.tokens_output, 0))::INTEGER AS total_tokens
    FROM swarm_jobs j
    LEFT JOIN swarm_tasks t ON t.job_id = j.id
    WHERE j.id = p_job_id
    GROUP BY j.id, j.status, j.progress_pct;
END;
$$;

-- ============================================================================
-- STEP 5: Trigger to auto-update job progress when tasks change
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_update_job_progress()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Only update progress when task status changes to completed or failed
    IF NEW.status IN ('completed', 'failed') AND OLD.status != NEW.status THEN
        PERFORM update_job_progress(NEW.job_id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_swarm_tasks_progress ON swarm_tasks;
CREATE TRIGGER trg_swarm_tasks_progress
    AFTER UPDATE OF status ON swarm_tasks
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_job_progress();

-- ============================================================================
-- STEP 6: Enable Row Level Security (RLS)
-- ============================================================================

ALTER TABLE swarm_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE swarm_tasks ENABLE ROW LEVEL SECURITY;

-- For now, allow authenticated and anon users full access
-- In production, tighten these based on workspace ownership

-- swarm_jobs policies
DROP POLICY IF EXISTS "Allow all access to swarm_jobs" ON swarm_jobs;
CREATE POLICY "Allow all access to swarm_jobs" ON swarm_jobs
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- swarm_tasks policies
DROP POLICY IF EXISTS "Allow all access to swarm_tasks" ON swarm_tasks;
CREATE POLICY "Allow all access to swarm_tasks" ON swarm_tasks
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- STEP 7: Enable Realtime for live UI updates
-- ============================================================================

-- Enable realtime on both tables for Supabase Realtime subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE swarm_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE swarm_tasks;

-- ============================================================================
-- STEP 8: Create views for common queries
-- ============================================================================

-- View: Active jobs with progress summary
CREATE OR REPLACE VIEW v_active_swarm_jobs AS
SELECT
    j.id,
    j.workspace_id,
    j.objective,
    j.mode,
    j.agent_count,
    j.status,
    j.progress_pct,
    j.created_at,
    j.started_at,
    COUNT(t.id) FILTER (WHERE t.status = 'completed') AS completed_count,
    COUNT(t.id) FILTER (WHERE t.status = 'failed') AS failed_count,
    COUNT(t.id) FILTER (WHERE t.status = 'processing') AS processing_count,
    COUNT(t.id) FILTER (WHERE t.status = 'pending') AS pending_count
FROM swarm_jobs j
LEFT JOIN swarm_tasks t ON t.job_id = j.id
WHERE j.status IN ('pending', 'processing')
GROUP BY j.id
ORDER BY j.created_at DESC;

-- View: Recent completed jobs with results summary
CREATE OR REPLACE VIEW v_completed_swarm_jobs AS
SELECT
    j.id,
    j.workspace_id,
    j.objective,
    j.mode,
    j.agent_count,
    j.status,
    j.synthesis_result,
    j.created_at,
    j.completed_at,
    EXTRACT(EPOCH FROM (j.completed_at - j.started_at)) AS duration_seconds,
    COUNT(t.id) FILTER (WHERE t.status = 'completed') AS completed_count,
    COUNT(t.id) FILTER (WHERE t.status = 'failed') AS failed_count,
    AVG(t.latency_ms) FILTER (WHERE t.status = 'completed') AS avg_task_latency_ms,
    SUM(COALESCE(t.tokens_input, 0) + COALESCE(t.tokens_output, 0)) AS total_tokens
FROM swarm_jobs j
LEFT JOIN swarm_tasks t ON t.job_id = j.id
WHERE j.status = 'completed'
GROUP BY j.id
ORDER BY j.completed_at DESC;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE swarm_jobs IS 'Tracks overall swarm job requests (50+ agent executions)';
COMMENT ON TABLE swarm_tasks IS 'Tracks individual agent tasks within a swarm job';
COMMENT ON FUNCTION claim_swarm_tasks IS 'Atomically claims a batch of pending tasks for a worker (prevents race conditions)';
COMMENT ON FUNCTION update_job_progress IS 'Updates job progress based on completed/failed task counts';
COMMENT ON FUNCTION get_job_status IS 'Returns comprehensive job status with task breakdown';
