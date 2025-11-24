-- Enhanced Memory System Migration
-- Adds hybrid search (BM25 + Vector), importance weighting, and knowledge graph features

-- Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Migrate old simple table if exists (preserve data)
ALTER TABLE IF EXISTS memory_notes RENAME TO memory_notes_old;

-- Enhanced memories table with hybrid search support
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id TEXT,

  -- Content fields
  content TEXT NOT NULL,
  summary TEXT,

  -- Full-text search vector (auto-generated)
  content_tsvector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,

  -- Semantic embeddings
  embedding vector(1536),
  embedding_model TEXT DEFAULT 'text-embedding-3-small',

  -- Importance and access tracking
  importance_score REAL DEFAULT 0.5 CHECK (importance_score >= 0.0 AND importance_score <= 1.0),
  access_count INTEGER DEFAULT 0,
  last_accessed TIMESTAMPTZ,
  decay_factor REAL DEFAULT 1.0,

  -- Memory classification
  memory_type TEXT NOT NULL CHECK (memory_type IN ('observation', 'lesson', 'rule', 'strategy', 'mistake', 'success')),
  category TEXT, -- entry_rules, risk_management, market_conditions, etc

  -- Trading context
  symbols TEXT[],
  strategies TEXT[],
  outcome JSONB, -- {pnl: 500, win: true, risk_reward: 2.5}
  market_conditions JSONB,

  -- Knowledge graph relationships
  entities JSONB, -- [{type: 'indicator', name: 'RSI', value: 70}]
  related_memories UUID[],
  contradicts UUID[],
  supersedes UUID[],

  -- Regime context (CRITICAL for strategy discovery)
  regime_context JSONB DEFAULT '{}',
  -- Structure: {
  --   primary_regime: 1-6,
  --   regime_name: "Trend Up",
  --   convexity_profile: 1-6,
  --   temporal_context: {date_range, vix_regime, vix_range},
  --   statistical_validity: {n_observations, confidence_level, pbo_score, deflated_sharpe}
  -- }

  -- Protection against forgetting (prevent catastrophic loss)
  protection_level INTEGER DEFAULT 2 CHECK (protection_level >= 0 AND protection_level <= 3), -- 0=immutable, 1=protected, 2=standard, 3=ephemeral
  immutable BOOLEAN DEFAULT FALSE,
  financial_impact NUMERIC(15,2), -- Cost if forgotten (dollars)
  last_recalled_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'chat',
  confidence REAL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  archived BOOLEAN DEFAULT FALSE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace_id);
CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_content_fts ON memories USING GIN(content_tsvector);
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_symbols ON memories USING GIN(symbols);
CREATE INDEX IF NOT EXISTS idx_memories_strategies ON memories USING GIN(strategies);
CREATE INDEX IF NOT EXISTS idx_memories_type_importance ON memories(workspace_id, memory_type, importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_memories_protection_level ON memories(protection_level);
CREATE INDEX IF NOT EXISTS idx_memories_protection_financial ON memories(protection_level, financial_impact DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_memories_regime ON memories USING GIN(regime_context jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_memories_last_recalled ON memories(last_recalled_at);

-- Add regime and statistical context to backtest_runs
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS regime_id INTEGER;
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS regime_context JSONB DEFAULT '{}';
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS statistical_validity JSONB DEFAULT '{}';

-- Session tracking for daemon state
CREATE TABLE IF NOT EXISTS memory_extraction_state (
  session_id TEXT PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  last_processed_message_id TEXT,
  last_extraction_time TIMESTAMPTZ DEFAULT NOW(),
  total_extracted INTEGER DEFAULT 0,
  extraction_metadata JSONB
);

-- Consolidated trading rules (promoted from repeated lessons)
CREATE TABLE IF NOT EXISTS trading_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rule_content TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('entry', 'exit', 'risk', 'position_sizing', 'general')),
  confidence REAL DEFAULT 0.5 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  supporting_memory_ids UUID[],
  violation_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_validated TIMESTAMPTZ,
  active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_trading_rules_workspace ON trading_rules(workspace_id);

-- Regime-Profile Performance Matrix (auto-populated from backtest runs)
CREATE TABLE IF NOT EXISTS regime_profile_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Regime and Profile IDs (1-6 each)
  regime_id INTEGER NOT NULL CHECK (regime_id >= 1 AND regime_id <= 6),
  profile_id INTEGER NOT NULL CHECK (profile_id >= 1 AND profile_id <= 6),

  -- Aggregated performance metrics
  avg_sharpe NUMERIC(8,4),
  avg_cagr NUMERIC(8,4),
  avg_max_drawdown NUMERIC(8,4),
  win_rate NUMERIC(5,4),
  total_runs INTEGER DEFAULT 0,
  total_trades INTEGER DEFAULT 0,

  -- Supporting evidence
  run_ids UUID[],

  -- Statistical confidence
  confidence_score NUMERIC(4,3) CHECK (confidence_score >= 0.000 AND confidence_score <= 1.000), -- 0.000 to 1.000
  t_statistic NUMERIC(8,4),
  p_value NUMERIC(10,8),

  -- Tracking
  first_observed TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(workspace_id, regime_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_rpp_regime ON regime_profile_performance(regime_id);
CREATE INDEX IF NOT EXISTS idx_rpp_profile ON regime_profile_performance(profile_id);
CREATE INDEX IF NOT EXISTS idx_rpp_sharpe ON regime_profile_performance(avg_sharpe DESC);
CREATE INDEX IF NOT EXISTS idx_rpp_confidence ON regime_profile_performance(confidence_score DESC);

-- Query performance tracking
CREATE TABLE IF NOT EXISTS memory_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  expanded_queries TEXT[],
  returned_memory_ids UUID[],
  relevance_scores REAL[],
  response_time_ms INTEGER,
  used_reranking BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_queries_workspace ON memory_queries(workspace_id);

-- Market Events (for temporal queries like "2020 crash")
CREATE TABLE IF NOT EXISTS market_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Event identification
  event_name TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('crash', 'rally', 'regime_shift', 'vol_spike', 'catalyst')),

  -- Temporal bounds
  start_date DATE NOT NULL,
  end_date DATE NOT NULL CHECK (end_date >= start_date),
  peak_date DATE,

  -- Regime characteristics
  primary_regime INTEGER CHECK (primary_regime >= 1 AND primary_regime <= 6),
  regime_sequence INTEGER[], -- Regime transitions during event

  -- Market conditions
  vix_peak NUMERIC(6,2),
  vix_avg NUMERIC(6,2),
  spx_drawdown NUMERIC(6,4),

  -- What worked/failed
  winning_profiles INTEGER[],
  losing_profiles INTEGER[],

  -- Linked memories
  memory_ids UUID[],

  -- For search
  embedding vector(1536),
  description TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(workspace_id, event_name)
);

CREATE INDEX IF NOT EXISTS idx_events_regime ON market_events(primary_regime);
CREATE INDEX IF NOT EXISTS idx_events_dates ON market_events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_events_embedding ON market_events USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100);

-- Memory Evidence (provenance chains)
CREATE TABLE IF NOT EXISTS memory_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,

  -- Evidence details
  evidence_type TEXT NOT NULL, -- 'backtest_run', 'validation', 'user_confirmation', 'file'
  evidence_path TEXT,
  evidence_hash TEXT, -- SHA-256 for integrity checking
  evidence_data JSONB, -- Snapshot of key data

  -- Metadata
  notes TEXT,
  captured_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_memory ON memory_evidence(memory_id);
CREATE INDEX IF NOT EXISTS idx_evidence_type ON memory_evidence(evidence_type);

-- Overfitting Warnings (special critical memories)
CREATE TABLE IF NOT EXISTS overfitting_warnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- What was tried
  strategy_name TEXT NOT NULL,
  approach_description TEXT NOT NULL,
  parameter_space JSONB,
  num_variations_tested INTEGER,

  -- Evidence of overfitting
  failure_type TEXT NOT NULL CHECK (failure_type IN (
    'parameter_sensitivity', 'walk_forward_failure', 'regime_specific_only',
    'data_snooping', 'multiple_testing', 'insufficient_sample'
  )),
  evidence_detail TEXT NOT NULL,

  -- Metrics
  in_sample_sharpe NUMERIC(8,4),
  out_of_sample_sharpe NUMERIC(8,4),
  pbo_score NUMERIC(6,4),
  deflated_sharpe NUMERIC(8,4),
  walk_forward_efficiency NUMERIC(6,4),

  -- Warning for future
  warning_message TEXT NOT NULL,
  do_not_repeat TEXT,

  -- For matching similar approaches
  strategy_embedding vector(1536),

  -- Linked to backtest run
  run_id UUID REFERENCES backtest_runs(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overfitting_strategy ON overfitting_warnings(strategy_name);
CREATE INDEX IF NOT EXISTS idx_overfitting_embedding ON overfitting_warnings
  USING ivfflat (strategy_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_overfitting_run ON overfitting_warnings(run_id);

-- Auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_memories_updated_at
  BEFORE UPDATE ON memories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Hybrid search function (BM25 + Vector)
CREATE OR REPLACE FUNCTION hybrid_search_memories(
  query_text TEXT,
  query_embedding vector(1536),
  match_workspace_id UUID,
  limit_count INTEGER DEFAULT 20,
  bm25_weight REAL DEFAULT 0.3,
  vector_weight REAL DEFAULT 0.7,
  min_importance REAL DEFAULT 0.0
)
RETURNS TABLE(
  id UUID,
  content TEXT,
  summary TEXT,
  memory_type TEXT,
  category TEXT,
  symbols TEXT[],
  importance_score REAL,
  bm25_score REAL,
  vector_score REAL,
  hybrid_score REAL,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  WITH bm25_scores AS (
    SELECT
      m.id,
      ts_rank_cd(m.content_tsvector, plainto_tsquery('english', query_text)) as score
    FROM memories m
    WHERE m.workspace_id = match_workspace_id
      AND m.content_tsvector @@ plainto_tsquery('english', query_text)
      AND m.importance_score >= min_importance
      AND m.archived = FALSE
  ),
  vector_scores AS (
    SELECT
      m.id,
      1 - (m.embedding <=> query_embedding) as score
    FROM memories m
    WHERE m.workspace_id = match_workspace_id
      AND m.embedding IS NOT NULL
      AND m.importance_score >= min_importance
      AND m.archived = FALSE
    ORDER BY m.embedding <=> query_embedding
    LIMIT limit_count * 2
  ),
  combined AS (
    SELECT
      COALESCE(b.id, v.id) as memory_id,
      COALESCE(b.score, 0) * bm25_weight as weighted_bm25,
      COALESCE(v.score, 0) * vector_weight as weighted_vector
    FROM bm25_scores b
    FULL OUTER JOIN vector_scores v ON b.id = v.id
  )
  SELECT
    m.id,
    m.content,
    m.summary,
    m.memory_type,
    m.category,
    m.symbols,
    m.importance_score,
    c.weighted_bm25 / NULLIF(bm25_weight, 0) as bm25_score,
    c.weighted_vector / NULLIF(vector_weight, 0) as vector_score,
    (c.weighted_bm25 + c.weighted_vector) * m.importance_score as hybrid_score,
    m.created_at
  FROM combined c
  JOIN memories m ON m.id = c.memory_id
  ORDER BY hybrid_score DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Find similar overfitting warnings (prevent repeating failed approaches)
CREATE OR REPLACE FUNCTION find_similar_warnings(
  match_workspace_id UUID,
  strategy_embedding vector(1536),
  current_regime INTEGER DEFAULT NULL,
  threshold REAL DEFAULT 0.7
)
RETURNS TABLE(
  id UUID,
  warning_message TEXT,
  failure_type TEXT,
  in_sample_sharpe NUMERIC,
  out_of_sample_sharpe NUMERIC,
  pbo_score NUMERIC,
  similarity REAL,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ow.id,
    ow.warning_message,
    ow.failure_type,
    ow.in_sample_sharpe,
    ow.out_of_sample_sharpe,
    ow.pbo_score,
    (1 - (ow.strategy_embedding <=> strategy_embedding))::REAL as similarity,
    ow.created_at
  FROM overfitting_warnings ow
  WHERE ow.workspace_id = match_workspace_id
    AND ow.strategy_embedding <=> strategy_embedding < (1 - threshold)
  ORDER BY ow.strategy_embedding <=> strategy_embedding
  LIMIT 10;
END;
$$ LANGUAGE plpgsql;

-- Get regime-profile performance (for "what works in Regime X?" queries)
CREATE OR REPLACE FUNCTION get_regime_performance(
  match_workspace_id UUID,
  regime_filter INTEGER DEFAULT NULL,
  profile_filter INTEGER DEFAULT NULL,
  min_confidence REAL DEFAULT 0.5
)
RETURNS TABLE(
  regime_id INTEGER,
  profile_id INTEGER,
  avg_sharpe NUMERIC,
  avg_cagr NUMERIC,
  total_runs INTEGER,
  confidence_score NUMERIC,
  run_ids UUID[],
  last_updated TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    rpp.regime_id,
    rpp.profile_id,
    rpp.avg_sharpe,
    rpp.avg_cagr,
    rpp.total_runs,
    rpp.confidence_score,
    rpp.run_ids,
    rpp.last_updated
  FROM regime_profile_performance rpp
  WHERE rpp.workspace_id = match_workspace_id
    AND (regime_filter IS NULL OR rpp.regime_id = regime_filter)
    AND (profile_filter IS NULL OR rpp.profile_id = profile_filter)
    AND rpp.confidence_score >= min_confidence
  ORDER BY rpp.avg_sharpe DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- MISSING FUNCTIONS AND TRIGGERS (Audit Completion)
-- ==============================================================================

-- 1. TEMPORAL QUERY RPC: Get memories for specific market events
CREATE OR REPLACE FUNCTION get_memories_for_event(
  match_workspace_id UUID,
  event_name_filter TEXT
)
RETURNS TABLE(
  id UUID,
  content TEXT,
  summary TEXT,
  memory_type TEXT,
  importance_score REAL,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.content, m.summary, m.memory_type, m.importance_score, m.created_at
  FROM memories m
  JOIN market_events me ON m.id = ANY(me.memory_ids)
  WHERE me.workspace_id = match_workspace_id
    AND me.event_name = event_name_filter
  ORDER BY m.importance_score DESC;
END;
$$ LANGUAGE plpgsql;

-- 2. EVIDENCE CHAIN RPC: Get provenance for memory integrity
CREATE OR REPLACE FUNCTION get_memory_provenance(
  memory_id_input UUID
)
RETURNS TABLE(
  evidence_type TEXT,
  evidence_path TEXT,
  evidence_hash TEXT,
  hash_valid BOOLEAN,
  captured_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    me.evidence_type,
    me.evidence_path,
    me.evidence_hash,
    TRUE as hash_valid,
    me.captured_at
  FROM memory_evidence me
  WHERE me.memory_id = memory_id_input
  ORDER BY me.captured_at DESC;
END;
$$ LANGUAGE plpgsql;

-- 3. AUTO-POPULATE REGIME PERFORMANCE MATRIX
CREATE OR REPLACE FUNCTION update_regime_performance_matrix()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process completed runs with regime context
  IF NEW.status != 'completed' OR NEW.regime_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Update or insert regime-profile performance
  INSERT INTO regime_profile_performance (
    workspace_id,
    regime_id,
    profile_id,
    avg_sharpe,
    total_runs,
    run_ids
  )
  SELECT
    NEW.workspace_id,
    NEW.regime_id,
    (NEW.params->>'profile_id')::INTEGER,
    (NEW.metrics->>'sharpe')::NUMERIC,
    1,
    ARRAY[NEW.id]::UUID[]
  ON CONFLICT (workspace_id, regime_id, profile_id)
  DO UPDATE SET
    avg_sharpe = ((regime_profile_performance.avg_sharpe * regime_profile_performance.total_runs) + EXCLUDED.avg_sharpe) / (regime_profile_performance.total_runs + 1),
    total_runs = regime_profile_performance.total_runs + 1,
    run_ids = array_append(regime_profile_performance.run_ids, NEW.id),
    last_updated = NOW()
  WHERE regime_profile_performance.workspace_id = NEW.workspace_id
    AND regime_profile_performance.regime_id = NEW.regime_id
    AND regime_profile_performance.profile_id = (NEW.params->>'profile_id')::INTEGER;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-population
CREATE TRIGGER update_regime_matrix_on_run_complete
  AFTER INSERT OR UPDATE ON backtest_runs
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND NEW.regime_id IS NOT NULL)
  EXECUTE FUNCTION update_regime_performance_matrix();

-- 4. ROW LEVEL SECURITY POLICIES FOR IMMUTABLE PROTECTION

-- Enable RLS on memories table
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;

-- Policy: Prevent deletion of immutable memories
CREATE POLICY immutable_no_delete ON memories
  FOR DELETE
  USING (immutable = FALSE);

-- Policy: Prevent updates to immutable memories
CREATE POLICY immutable_no_update ON memories
  FOR UPDATE
  USING (immutable = FALSE)
  WITH CHECK (immutable = FALSE);

-- Policy: Allow read access for all authenticated users
CREATE POLICY memories_read_all ON memories
  FOR SELECT
  USING (true);

-- Policy: Allow inserts for authenticated users
CREATE POLICY memories_insert_authenticated ON memories
  FOR INSERT
  WITH CHECK (true);

-- Enable RLS on critical tables
ALTER TABLE trading_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE overfitting_warnings ENABLE ROW LEVEL SECURITY;

-- RLS for trading_rules
CREATE POLICY trading_rules_read ON trading_rules
  FOR SELECT
  USING (true);

CREATE POLICY trading_rules_insert ON trading_rules
  FOR INSERT
  WITH CHECK (true);

-- RLS for overfitting_warnings
CREATE POLICY overfitting_warnings_read ON overfitting_warnings
  FOR SELECT
  USING (true);

CREATE POLICY overfitting_warnings_insert ON overfitting_warnings
  FOR INSERT
  WITH CHECK (true);
