-- Migration: Add session_contexts for multi-model coordination
-- Purpose: Enable Gemini <-> Claude Code <-> DeepSeek context sharing during active sessions
-- Part of: 10X Architecture - Multi-Model Quant Research System

-- ============================================================================
-- STEP 1: Create session_contexts table (without vector for now - can add later)
-- ============================================================================

CREATE TABLE IF NOT EXISTS session_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,

  -- Model identification
  model TEXT NOT NULL CHECK (model IN ('gemini', 'claude', 'deepseek', 'system')),
  role TEXT NOT NULL CHECK (role IN ('reasoning', 'execution', 'analysis', 'orchestration', 'error')),

  -- Content
  content TEXT NOT NULL,
  summary TEXT, -- Optional short summary for quick scanning

  -- Metadata
  tool_calls JSONB DEFAULT '[]', -- Tools used in this context
  tokens_used INTEGER,
  latency_ms INTEGER,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- STEP 2: Indexes for fast retrieval
-- ============================================================================

-- Primary lookup: get all context for a session
CREATE INDEX IF NOT EXISTS idx_session_contexts_session
ON session_contexts(session_id, created_at ASC);

-- Model-specific queries
CREATE INDEX IF NOT EXISTS idx_session_contexts_model
ON session_contexts(session_id, model);

-- ============================================================================
-- STEP 3: Helper functions
-- ============================================================================

-- Get full session context as formatted text
CREATE OR REPLACE FUNCTION get_session_context_text(p_session_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_result TEXT := '';
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT model, role, content, created_at
    FROM session_contexts
    WHERE session_id = p_session_id
    ORDER BY created_at ASC
  LOOP
    v_result := v_result || E'\n---\n' ||
      '[' || UPPER(v_row.model) || ' - ' || v_row.role || ' @ ' ||
      to_char(v_row.created_at, 'HH24:MI:SS') || E']\n' ||
      v_row.content;
  END LOOP;

  RETURN v_result;
END;
$$;

-- Get context from specific model only
CREATE OR REPLACE FUNCTION get_model_context(p_session_id UUID, p_model TEXT)
RETURNS TABLE (
  id UUID,
  role TEXT,
  content TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
  SELECT id, role, content, created_at
  FROM session_contexts
  WHERE session_id = p_session_id AND model = p_model
  ORDER BY created_at ASC;
$$;

-- Get latest reasoning from Gemini (for Claude Code to use)
CREATE OR REPLACE FUNCTION get_latest_reasoning(p_session_id UUID)
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT content
  FROM session_contexts
  WHERE session_id = p_session_id
    AND model = 'gemini'
    AND role = 'reasoning'
  ORDER BY created_at DESC
  LIMIT 1;
$$;

-- ============================================================================
-- STEP 4: Cleanup function for old sessions
-- ============================================================================

-- Archive table for deleted session contexts
CREATE TABLE IF NOT EXISTS session_contexts_archive (
  LIKE session_contexts INCLUDING ALL
);

CREATE INDEX IF NOT EXISTS idx_archive_created
ON session_contexts_archive(created_at DESC);

-- Archive sessions older than 7 days (with archiving before delete)
CREATE OR REPLACE FUNCTION cleanup_old_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := NOW() - INTERVAL '7 days';  -- Extended from 24 hours
  v_archived INTEGER;
  v_deleted INTEGER;
BEGIN
  -- First, archive old contexts (preserves data)
  INSERT INTO session_contexts_archive
  SELECT * FROM session_contexts
  WHERE created_at < v_cutoff;

  GET DIAGNOSTICS v_archived = ROW_COUNT;

  -- Then delete from active table
  DELETE FROM session_contexts
  WHERE created_at < v_cutoff;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Log cleanup event
  RAISE NOTICE 'Cleaned up % session contexts (archived: %, deleted: %)',
    v_deleted, v_archived, v_deleted;

  RETURN v_deleted;
END;
$$;

-- ============================================================================
-- STEP 5: Session management table
-- ============================================================================

CREATE TABLE IF NOT EXISTS active_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID UNIQUE NOT NULL,

  -- Session metadata
  project_name TEXT DEFAULT 'quant-engine',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity TIMESTAMPTZ DEFAULT NOW(),

  -- Model usage tracking
  gemini_calls INTEGER DEFAULT 0,
  claude_calls INTEGER DEFAULT 0,
  deepseek_calls INTEGER DEFAULT 0,

  -- Cost tracking
  estimated_cost_usd NUMERIC(10,4) DEFAULT 0,

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned'))
);

CREATE INDEX IF NOT EXISTS idx_active_sessions_status
ON active_sessions(status, last_activity DESC);

-- ============================================================================
-- STEP 6: Comments
-- ============================================================================

COMMENT ON TABLE session_contexts IS 'Ephemeral cross-model context sharing during active quant research sessions';
COMMENT ON TABLE active_sessions IS 'Track active multi-model research sessions for cost and usage monitoring';
COMMENT ON FUNCTION get_session_context_text IS 'Format full session context as readable text for model injection';
COMMENT ON FUNCTION get_latest_reasoning IS 'Get Gemini reasoning for Claude Code execution context';
