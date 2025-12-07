-- Migration: Alpha Factory Pipeline Tracking
-- Purpose: Track the complete journey from features to live trading
-- Date: 2025-12-04
--
-- Architecture:
--   Raw Data → Features → Discovery → Mission → Strategy → Backtest → Audit → Shadow → Graduate → Live
--   Each stage tracked with realtime subscriptions for UI visualization

-- ============================================================================
-- PIPELINE RUNS (Stage 1: Features)
-- Tracks each run of the feature calculation pipeline
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    run_type TEXT NOT NULL CHECK (run_type IN ('scheduled', 'manual', 'daemon')),
    duration_seconds FLOAT,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    symbols_requested TEXT[],
    symbols_completed TEXT[],
    symbols_failed TEXT[],
    total_features_calculated INT DEFAULT 0,
    errors JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pipeline_runs_timestamp ON pipeline_runs(run_timestamp DESC);
CREATE INDEX idx_pipeline_runs_status ON pipeline_runs(status);

-- ============================================================================
-- PIPELINE MODULE STATUS
-- Per-module tracking within a pipeline run
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_module_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID REFERENCES pipeline_runs(id) ON DELETE CASCADE,
    module_name TEXT NOT NULL CHECK (module_name IN (
        'raw_features', 'regime', 'sector_regime', 'domain_features',
        'momentum_logic', 'cross_asset', 'gamma_calc'
    )),
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    features_calculated INT DEFAULT 0,
    duration_ms INT,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pipeline_module_run ON pipeline_module_status(run_id);

-- ============================================================================
-- DISCOVERY EVENTS (Stage 2)
-- Opportunities detected by MorphologyScanner
-- ============================================================================

CREATE TYPE discovery_event_type AS ENUM (
    'REGIME_TRANSITION',
    'VOL_EXTREME',
    'MOMENTUM_EXTREME',
    'GAMMA_FLIP',
    'SECTOR_ROTATION',
    'CORRELATION_BREAK'
);

CREATE TABLE IF NOT EXISTS discovery_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type discovery_event_type NOT NULL,
    symbol TEXT NOT NULL,
    confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Link to mission if one was created
    mission_created_id UUID,  -- Will reference missions table

    -- Metadata
    scanner_version TEXT DEFAULT '1.0',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_discovery_events_timestamp ON discovery_events(event_timestamp DESC);
CREATE INDEX idx_discovery_events_type ON discovery_events(event_type);
CREATE INDEX idx_discovery_events_symbol ON discovery_events(symbol);
CREATE INDEX idx_discovery_events_mission ON discovery_events(mission_created_id);

-- ============================================================================
-- BACKTEST RUNS (Stage 5)
-- Historical validation of strategies
-- ============================================================================

CREATE TABLE IF NOT EXISTS backtest_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID,  -- References strategy_genome
    mission_id UUID,   -- References missions
    run_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Configuration
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    initial_capital FLOAT NOT NULL DEFAULT 100000,

    -- Results
    total_return FLOAT,
    sharpe_ratio FLOAT,
    max_drawdown FLOAT,
    win_rate FLOAT,
    profit_factor FLOAT,
    total_trades INT,
    avg_trade_duration_days FLOAT,

    -- Status
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    passed_criteria BOOLEAN,
    failure_reasons TEXT[],

    -- Full results (for detailed analysis)
    equity_curve JSONB,  -- Array of {date, equity} points
    trade_log JSONB,     -- Array of trade records
    full_metrics JSONB,  -- All calculated metrics

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_backtest_runs_strategy ON backtest_runs(strategy_id);
CREATE INDEX idx_backtest_runs_mission ON backtest_runs(mission_id);
CREATE INDEX idx_backtest_runs_timestamp ON backtest_runs(run_timestamp DESC);
CREATE INDEX idx_backtest_runs_status ON backtest_runs(status);

-- ============================================================================
-- RED TEAM AUDITS (Stage 6)
-- Adversarial strategy validation
-- ============================================================================

CREATE TABLE IF NOT EXISTS red_team_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID,  -- References strategy_genome
    backtest_id UUID REFERENCES backtest_runs(id),
    audit_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Overall result
    overall_score FLOAT NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
    is_passed BOOLEAN NOT NULL,

    -- Per-persona scores (0-100)
    liquidity_realist_score FLOAT CHECK (liquidity_realist_score >= 0 AND liquidity_realist_score <= 100),
    macro_shock_score FLOAT CHECK (macro_shock_score >= 0 AND macro_shock_score <= 100),
    overfitting_hunter_score FLOAT CHECK (overfitting_hunter_score >= 0 AND overfitting_hunter_score <= 100),
    fee_paranoid_score FLOAT CHECK (fee_paranoid_score >= 0 AND fee_paranoid_score <= 100),
    correlation_saboteur_score FLOAT CHECK (correlation_saboteur_score >= 0 AND correlation_saboteur_score <= 100),
    regime_blindspot_score FLOAT CHECK (regime_blindspot_score >= 0 AND regime_blindspot_score <= 100),

    -- Issues found
    critical_issues TEXT[] DEFAULT '{}',
    warnings TEXT[] DEFAULT '{}',

    -- Detailed reasoning from each persona
    reasoning_chains JSONB DEFAULT '{}'::jsonb,

    -- Audit metadata
    audit_version TEXT DEFAULT '1.0',
    duration_seconds FLOAT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_red_team_strategy ON red_team_audits(strategy_id);
CREATE INDEX idx_red_team_passed ON red_team_audits(is_passed);
CREATE INDEX idx_red_team_timestamp ON red_team_audits(audit_timestamp DESC);

-- ============================================================================
-- GRADUATION PROGRESS (Stage 8)
-- Track progress from shadow to live trading
-- ============================================================================

CREATE TABLE IF NOT EXISTS graduation_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID UNIQUE,  -- One record per strategy
    strategy_name TEXT NOT NULL,

    -- Timeline
    shadow_start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    graduation_date TIMESTAMPTZ,

    -- Current metrics
    total_trades INT DEFAULT 0,
    winning_trades INT DEFAULT 0,
    current_sharpe FLOAT,
    max_drawdown FLOAT,
    total_pnl FLOAT DEFAULT 0,

    -- Graduation requirements (targets)
    target_trades INT DEFAULT 20,
    target_sharpe FLOAT DEFAULT 1.0,
    target_max_dd FLOAT DEFAULT 0.15,

    -- Requirement status
    trades_requirement_met BOOLEAN DEFAULT FALSE,
    sharpe_requirement_met BOOLEAN DEFAULT FALSE,
    drawdown_requirement_met BOOLEAN DEFAULT FALSE,
    is_eligible BOOLEAN DEFAULT FALSE,

    -- Blocking reasons if not eligible
    blocking_reasons TEXT[] DEFAULT '{}',

    -- Metadata
    last_evaluated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_graduation_strategy ON graduation_progress(strategy_id);
CREATE INDEX idx_graduation_eligible ON graduation_progress(is_eligible);

-- ============================================================================
-- PIPELINE ITEMS (Cross-Stage Tracking)
-- Track individual items as they flow through the entire pipeline
-- ============================================================================

CREATE TYPE pipeline_stage AS ENUM (
    'features',
    'discovery',
    'mission',
    'strategy',
    'backtest',
    'audit',
    'shadow',
    'graduate',
    'live'
);

CREATE TYPE pipeline_outcome AS ENUM (
    'in_progress',
    'graduated',
    'abandoned',
    'failed_backtest',
    'failed_audit',
    'failed_shadow',
    'paused'
);

CREATE TABLE IF NOT EXISTS pipeline_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Item identification
    item_type TEXT NOT NULL CHECK (item_type IN ('opportunity', 'strategy')),
    display_name TEXT NOT NULL,

    -- Current stage
    current_stage pipeline_stage NOT NULL,
    stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Foreign keys to stage-specific records
    discovery_event_id UUID REFERENCES discovery_events(id),
    mission_id UUID,  -- References missions
    strategy_id UUID, -- References strategy_genome
    backtest_id UUID REFERENCES backtest_runs(id),
    audit_id UUID REFERENCES red_team_audits(id),
    graduation_id UUID REFERENCES graduation_progress(id),

    -- Journey tracking
    journey_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    journey_completed_at TIMESTAMPTZ,
    final_outcome pipeline_outcome DEFAULT 'in_progress',

    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pipeline_items_stage ON pipeline_items(current_stage);
CREATE INDEX idx_pipeline_items_outcome ON pipeline_items(final_outcome);
CREATE INDEX idx_pipeline_items_journey ON pipeline_items(journey_started_at DESC);

-- ============================================================================
-- STAGE TRANSITIONS
-- Track every stage transition for flow visualization
-- ============================================================================

CREATE TABLE IF NOT EXISTS stage_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_item_id UUID REFERENCES pipeline_items(id) ON DELETE CASCADE,
    from_stage pipeline_stage NOT NULL,
    to_stage pipeline_stage NOT NULL,
    transition_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    success BOOLEAN NOT NULL,
    failure_reason TEXT,
    duration_in_stage_seconds FLOAT,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_stage_transitions_item ON stage_transitions(pipeline_item_id);
CREATE INDEX idx_stage_transitions_timestamp ON stage_transitions(transition_timestamp DESC);
CREATE INDEX idx_stage_transitions_from ON stage_transitions(from_stage);
CREATE INDEX idx_stage_transitions_to ON stage_transitions(to_stage);

-- ============================================================================
-- PIPELINE METRICS (Aggregated Stats)
-- Pre-computed metrics for fast dashboard display
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_date DATE NOT NULL,

    -- Stage counts
    features_runs INT DEFAULT 0,
    discoveries_count INT DEFAULT 0,
    missions_created INT DEFAULT 0,
    strategies_generated INT DEFAULT 0,
    backtests_run INT DEFAULT 0,
    audits_passed INT DEFAULT 0,
    audits_failed INT DEFAULT 0,
    shadow_active INT DEFAULT 0,
    graduated_count INT DEFAULT 0,

    -- Conversion rates
    discovery_to_mission_rate FLOAT,
    backtest_pass_rate FLOAT,
    audit_pass_rate FLOAT,
    shadow_to_graduate_rate FLOAT,

    -- Timing metrics
    avg_backtest_duration_seconds FLOAT,
    avg_audit_duration_seconds FLOAT,
    avg_time_to_graduate_hours FLOAT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT pipeline_metrics_date_unique UNIQUE (metric_date)
);

CREATE INDEX idx_pipeline_metrics_date ON pipeline_metrics(metric_date DESC);

-- ============================================================================
-- UPDATE TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_pipeline_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_pipeline_items_updated
    BEFORE UPDATE ON pipeline_items
    FOR EACH ROW
    EXECUTE FUNCTION update_pipeline_timestamp();

CREATE TRIGGER trigger_graduation_progress_updated
    BEFORE UPDATE ON graduation_progress
    FOR EACH ROW
    EXECUTE FUNCTION update_pipeline_timestamp();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Get current pipeline stage counts
CREATE OR REPLACE FUNCTION get_pipeline_stage_counts()
RETURNS TABLE (
    stage TEXT,
    item_count BIGINT,
    in_progress BIGINT,
    completed BIGINT,
    failed BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pi.current_stage::TEXT as stage,
        COUNT(*) as item_count,
        COUNT(*) FILTER (WHERE pi.final_outcome = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE pi.final_outcome = 'graduated') as completed,
        COUNT(*) FILTER (WHERE pi.final_outcome IN ('failed_backtest', 'failed_audit', 'failed_shadow', 'abandoned')) as failed
    FROM pipeline_items pi
    GROUP BY pi.current_stage
    ORDER BY
        CASE pi.current_stage
            WHEN 'features' THEN 1
            WHEN 'discovery' THEN 2
            WHEN 'mission' THEN 3
            WHEN 'strategy' THEN 4
            WHEN 'backtest' THEN 5
            WHEN 'audit' THEN 6
            WHEN 'shadow' THEN 7
            WHEN 'graduate' THEN 8
            WHEN 'live' THEN 9
        END;
END;
$$ LANGUAGE plpgsql;

-- Get conversion funnel
CREATE OR REPLACE FUNCTION get_pipeline_funnel(p_days INT DEFAULT 30)
RETURNS TABLE (
    stage TEXT,
    count BIGINT,
    percentage FLOAT
) AS $$
DECLARE
    total_discoveries BIGINT;
BEGIN
    SELECT COUNT(*) INTO total_discoveries
    FROM discovery_events
    WHERE event_timestamp > NOW() - (p_days || ' days')::INTERVAL;

    IF total_discoveries = 0 THEN
        total_discoveries := 1; -- Prevent division by zero
    END IF;

    RETURN QUERY
    WITH stage_counts AS (
        SELECT 'discovery' as s, COUNT(*) as c FROM discovery_events WHERE event_timestamp > NOW() - (p_days || ' days')::INTERVAL
        UNION ALL
        SELECT 'mission', COUNT(*) FROM pipeline_items WHERE current_stage >= 'mission' AND journey_started_at > NOW() - (p_days || ' days')::INTERVAL
        UNION ALL
        SELECT 'strategy', COUNT(*) FROM pipeline_items WHERE current_stage >= 'strategy' AND journey_started_at > NOW() - (p_days || ' days')::INTERVAL
        UNION ALL
        SELECT 'backtest', COUNT(*) FROM pipeline_items WHERE current_stage >= 'backtest' AND journey_started_at > NOW() - (p_days || ' days')::INTERVAL
        UNION ALL
        SELECT 'audit', COUNT(*) FROM pipeline_items WHERE current_stage >= 'audit' AND journey_started_at > NOW() - (p_days || ' days')::INTERVAL
        UNION ALL
        SELECT 'shadow', COUNT(*) FROM pipeline_items WHERE current_stage >= 'shadow' AND journey_started_at > NOW() - (p_days || ' days')::INTERVAL
        UNION ALL
        SELECT 'graduate', COUNT(*) FROM pipeline_items WHERE current_stage >= 'graduate' AND journey_started_at > NOW() - (p_days || ' days')::INTERVAL
        UNION ALL
        SELECT 'live', COUNT(*) FROM pipeline_items WHERE current_stage = 'live' AND journey_started_at > NOW() - (p_days || ' days')::INTERVAL
    )
    SELECT s as stage, c as count, (c::FLOAT / total_discoveries * 100) as percentage
    FROM stage_counts
    ORDER BY
        CASE s
            WHEN 'discovery' THEN 1
            WHEN 'mission' THEN 2
            WHEN 'strategy' THEN 3
            WHEN 'backtest' THEN 4
            WHEN 'audit' THEN 5
            WHEN 'shadow' THEN 6
            WHEN 'graduate' THEN 7
            WHEN 'live' THEN 8
        END;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ENABLE REALTIME
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_module_status;
ALTER PUBLICATION supabase_realtime ADD TABLE discovery_events;
ALTER PUBLICATION supabase_realtime ADD TABLE backtest_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE red_team_audits;
ALTER PUBLICATION supabase_realtime ADD TABLE graduation_progress;
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_items;
ALTER PUBLICATION supabase_realtime ADD TABLE stage_transitions;

-- ============================================================================
-- GRANTS
-- ============================================================================

GRANT ALL ON pipeline_runs TO service_role;
GRANT ALL ON pipeline_module_status TO service_role;
GRANT ALL ON discovery_events TO service_role;
GRANT ALL ON backtest_runs TO service_role;
GRANT ALL ON red_team_audits TO service_role;
GRANT ALL ON graduation_progress TO service_role;
GRANT ALL ON pipeline_items TO service_role;
GRANT ALL ON stage_transitions TO service_role;
GRANT ALL ON pipeline_metrics TO service_role;
GRANT EXECUTE ON FUNCTION get_pipeline_stage_counts TO service_role;
GRANT EXECUTE ON FUNCTION get_pipeline_funnel TO service_role;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE pipeline_runs IS 'Tracks each run of the feature calculation pipeline (Stage 1)';
COMMENT ON TABLE pipeline_module_status IS 'Per-module status within a pipeline run';
COMMENT ON TABLE discovery_events IS 'Opportunities detected by MorphologyScanner (Stage 2)';
COMMENT ON TABLE backtest_runs IS 'Historical validation results (Stage 5)';
COMMENT ON TABLE red_team_audits IS 'Adversarial audit results from 6 personas (Stage 6)';
COMMENT ON TABLE graduation_progress IS 'Progress tracking from shadow to live (Stage 8)';
COMMENT ON TABLE pipeline_items IS 'Cross-stage tracking of items flowing through the pipeline';
COMMENT ON TABLE stage_transitions IS 'Every stage transition for flow visualization';
COMMENT ON TABLE pipeline_metrics IS 'Pre-computed daily metrics for dashboard';
