-- =============================================================================
-- Goal-Seeking Architecture: Missions Table
-- =============================================================================
--
-- Transforms the daemon from "keep pool full" to "achieve mathematical targets".
-- Users set missions with specific targets, the daemon hunts until they're met.
--
-- Created: 2025-12-03
-- =============================================================================

-- Missions table: Stores user-defined mathematical targets
CREATE TABLE IF NOT EXISTS missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Mission definition
    name TEXT NOT NULL,
    objective TEXT NOT NULL,  -- Human-readable description of what we're hunting

    -- Target metrics (the mathematical goal)
    target_metric TEXT NOT NULL DEFAULT 'sharpe',  -- 'sharpe', 'daily_return', 'sortino', 'cagr'
    target_value FLOAT NOT NULL,                    -- The number to hit (e.g., 2.0 for Sharpe > 2)
    target_operator TEXT NOT NULL DEFAULT 'gte',    -- 'gte', 'lte', 'eq' (greater/less than or equal)

    -- Constraints (strategies must also satisfy these)
    max_drawdown FLOAT DEFAULT -0.20,               -- Maximum acceptable drawdown (negative)
    min_win_rate FLOAT DEFAULT 0.0,                 -- Minimum win rate (0.0 = no constraint)
    min_trades INT DEFAULT 50,                      -- Minimum trades for statistical validity
    max_correlation FLOAT DEFAULT 0.70,             -- Max correlation with existing strategies

    -- Regime targeting (optional)
    target_regimes TEXT[] DEFAULT ARRAY[]::TEXT[],  -- Empty = all regimes, otherwise specific ones

    -- Status tracking
    status TEXT NOT NULL DEFAULT 'active',          -- 'active', 'paused', 'completed', 'abandoned'
    priority INT DEFAULT 1,                         -- Higher = more swarm resources allocated

    -- Progress tracking
    current_best_value FLOAT DEFAULT 0.0,           -- Best value achieved so far
    current_best_strategy_id UUID,                  -- Reference to best strategy found
    attempts INT DEFAULT 0,                         -- Total swarm dispatches for this mission
    strategies_evaluated INT DEFAULT 0,             -- Total strategies tested
    strategies_passed INT DEFAULT 0,                -- Strategies that met ALL criteria

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,                         -- When mission actually started running
    completed_at TIMESTAMPTZ,                       -- When target was achieved
    deadline TIMESTAMPTZ,                           -- Optional deadline

    -- Metadata
    metadata JSONB DEFAULT '{}'::JSONB,

    -- Foreign key to best strategy
    CONSTRAINT fk_best_strategy FOREIGN KEY (current_best_strategy_id)
        REFERENCES strategy_genome(id) ON DELETE SET NULL
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
CREATE INDEX IF NOT EXISTS idx_missions_priority ON missions(priority DESC);
CREATE INDEX IF NOT EXISTS idx_missions_target_metric ON missions(target_metric);

-- Mission progress history: Track improvements over time
CREATE TABLE IF NOT EXISTS mission_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,

    -- Snapshot of progress
    best_value FLOAT NOT NULL,
    best_strategy_id UUID REFERENCES strategy_genome(id) ON DELETE SET NULL,
    strategies_evaluated_delta INT DEFAULT 0,       -- How many evaluated in this batch

    -- What triggered this progress update
    trigger_type TEXT NOT NULL,                     -- 'swarm_complete', 'red_team_pass', 'manual'
    swarm_job_id UUID,                             -- If triggered by swarm completion

    -- Metadata
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mission_progress_mission ON mission_progress(mission_id);
CREATE INDEX IF NOT EXISTS idx_mission_progress_time ON mission_progress(created_at DESC);

-- Red Team audit results: Strategies must pass before entering the pool
CREATE TABLE IF NOT EXISTS red_team_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID NOT NULL REFERENCES strategy_genome(id) ON DELETE CASCADE,
    mission_id UUID REFERENCES missions(id) ON DELETE SET NULL,

    -- Audit result
    passed BOOLEAN NOT NULL DEFAULT FALSE,
    overall_score FLOAT,                            -- 0-100 composite score

    -- Individual assessor scores (from red_team_swarm.py personas)
    liquidity_score FLOAT,
    macro_shock_score FLOAT,
    overfitting_score FLOAT,
    fee_impact_score FLOAT,
    correlation_score FLOAT,
    regime_blind_score FLOAT,

    -- Critical findings
    critical_issues TEXT[],                         -- Array of blocking issues
    warnings TEXT[],                                -- Non-blocking concerns

    -- Raw audit content
    full_report TEXT,                               -- Complete markdown report
    reasoning_chains JSONB,                         -- Reasoning from each assessor

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    duration_ms INT                                 -- How long the audit took
);

CREATE INDEX IF NOT EXISTS idx_red_team_strategy ON red_team_audits(strategy_id);
CREATE INDEX IF NOT EXISTS idx_red_team_passed ON red_team_audits(passed);

-- Swarm dispatch types for autonomous decision engine
CREATE TYPE swarm_dispatch_type AS ENUM (
    'aggressive',   -- High exploration, seeking alpha (low returns situation)
    'risk',         -- Focus on drawdown reduction (high drawdown situation)
    'novelty',      -- Explore new strategy types (idle situation)
    'refinement',   -- Fine-tune parameters on promising strategies
    'red_team'      -- Audit strategies before promotion
);

-- Mission swarm dispatches: Track what the daemon sends out
CREATE TABLE IF NOT EXISTS mission_dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,

    -- Dispatch details
    dispatch_type swarm_dispatch_type NOT NULL,
    swarm_job_id UUID,                              -- Reference to swarm_jobs
    agent_count INT DEFAULT 10,

    -- Decision context (why this dispatch was made)
    decision_context JSONB NOT NULL,                -- State that led to this decision
    -- Example: {"returns_gap": -1.5, "drawdown_excess": 0.05, "idle_hours": 4}

    -- Results
    status TEXT DEFAULT 'dispatched',               -- 'dispatched', 'completed', 'failed'
    strategies_generated INT DEFAULT 0,
    strategies_passed_audit INT DEFAULT 0,
    best_value_found FLOAT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dispatch_mission ON mission_dispatches(mission_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_type ON mission_dispatches(dispatch_type);

-- =============================================================================
-- RPC Functions for Goal-Seeking Operations
-- =============================================================================

-- Get active mission with highest priority
CREATE OR REPLACE FUNCTION get_active_mission()
RETURNS TABLE (
    mission_id UUID,
    name TEXT,
    target_metric TEXT,
    target_value FLOAT,
    target_operator TEXT,
    max_drawdown FLOAT,
    current_best_value FLOAT,
    current_best_strategy_id UUID,
    priority INT,
    gap_to_target FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id AS mission_id,
        m.name,
        m.target_metric,
        m.target_value,
        m.target_operator,
        m.max_drawdown,
        m.current_best_value,
        m.current_best_strategy_id,
        m.priority,
        CASE
            WHEN m.target_operator = 'gte' THEN m.target_value - COALESCE(m.current_best_value, 0)
            WHEN m.target_operator = 'lte' THEN COALESCE(m.current_best_value, 0) - m.target_value
            ELSE ABS(m.target_value - COALESCE(m.current_best_value, 0))
        END AS gap_to_target
    FROM missions m
    WHERE m.status = 'active'
    ORDER BY m.priority DESC, m.created_at ASC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Check if mission target is met
CREATE OR REPLACE FUNCTION check_mission_complete(p_mission_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_mission missions%ROWTYPE;
    v_target_met BOOLEAN := FALSE;
BEGIN
    SELECT * INTO v_mission FROM missions WHERE id = p_mission_id;

    IF v_mission IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Check if target is met based on operator
    CASE v_mission.target_operator
        WHEN 'gte' THEN
            v_target_met := v_mission.current_best_value >= v_mission.target_value;
        WHEN 'lte' THEN
            v_target_met := v_mission.current_best_value <= v_mission.target_value;
        WHEN 'eq' THEN
            v_target_met := ABS(v_mission.current_best_value - v_mission.target_value) < 0.01;
        ELSE
            v_target_met := FALSE;
    END CASE;

    -- If target met, update mission status
    IF v_target_met THEN
        UPDATE missions
        SET status = 'completed',
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = p_mission_id;
    END IF;

    RETURN v_target_met;
END;
$$ LANGUAGE plpgsql;

-- Update mission progress when a new best strategy is found
CREATE OR REPLACE FUNCTION update_mission_progress(
    p_mission_id UUID,
    p_strategy_id UUID,
    p_metric_value FLOAT,
    p_trigger_type TEXT DEFAULT 'swarm_complete'
)
RETURNS BOOLEAN AS $$
DECLARE
    v_current_best FLOAT;
    v_is_improvement BOOLEAN := FALSE;
BEGIN
    -- Get current best
    SELECT current_best_value INTO v_current_best
    FROM missions WHERE id = p_mission_id;

    -- Check if this is an improvement
    IF p_metric_value > COALESCE(v_current_best, -999) THEN
        v_is_improvement := TRUE;

        -- Update mission
        UPDATE missions SET
            current_best_value = p_metric_value,
            current_best_strategy_id = p_strategy_id,
            strategies_evaluated = strategies_evaluated + 1,
            updated_at = NOW()
        WHERE id = p_mission_id;

        -- Record progress
        INSERT INTO mission_progress (
            mission_id, best_value, best_strategy_id,
            trigger_type, strategies_evaluated_delta
        ) VALUES (
            p_mission_id, p_metric_value, p_strategy_id,
            p_trigger_type, 1
        );

        -- Check if mission is now complete
        PERFORM check_mission_complete(p_mission_id);
    END IF;

    RETURN v_is_improvement;
END;
$$ LANGUAGE plpgsql;

-- Get strategies pending red team audit
CREATE OR REPLACE FUNCTION get_strategies_pending_audit(p_limit INT DEFAULT 10)
RETURNS TABLE (
    strategy_id UUID,
    strategy_name TEXT,
    fitness_score FLOAT,
    sharpe_ratio FLOAT,
    code_content TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        sg.id AS strategy_id,
        sg.name AS strategy_name,
        sg.fitness_score,
        sg.sharpe_ratio,
        sg.code_content
    FROM strategy_genome sg
    LEFT JOIN red_team_audits rta ON sg.id = rta.strategy_id
    WHERE sg.status = 'incubating'
      AND rta.id IS NULL  -- No audit yet
    ORDER BY sg.fitness_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Record red team audit result
CREATE OR REPLACE FUNCTION record_red_team_audit(
    p_strategy_id UUID,
    p_mission_id UUID,
    p_passed BOOLEAN,
    p_overall_score FLOAT,
    p_scores JSONB,  -- Individual persona scores
    p_issues TEXT[],
    p_warnings TEXT[],
    p_full_report TEXT,
    p_duration_ms INT
)
RETURNS UUID AS $$
DECLARE
    v_audit_id UUID;
BEGIN
    INSERT INTO red_team_audits (
        strategy_id, mission_id, passed, overall_score,
        liquidity_score, macro_shock_score, overfitting_score,
        fee_impact_score, correlation_score, regime_blind_score,
        critical_issues, warnings, full_report, duration_ms
    ) VALUES (
        p_strategy_id, p_mission_id, p_passed, p_overall_score,
        (p_scores->>'liquidity')::FLOAT,
        (p_scores->>'macro_shock')::FLOAT,
        (p_scores->>'overfitting')::FLOAT,
        (p_scores->>'fee_impact')::FLOAT,
        (p_scores->>'correlation')::FLOAT,
        (p_scores->>'regime_blind')::FLOAT,
        p_issues, p_warnings, p_full_report, p_duration_ms
    ) RETURNING id INTO v_audit_id;

    -- If passed, promote strategy to active
    IF p_passed THEN
        UPDATE strategy_genome
        SET status = 'active',
            promoted_at = NOW(),
            metadata = metadata || jsonb_build_object(
                'red_team_audit_id', v_audit_id,
                'red_team_score', p_overall_score,
                'passed_red_team_at', NOW()
            )
        WHERE id = p_strategy_id;
    ELSE
        -- If failed, mark strategy as failed with reason
        UPDATE strategy_genome
        SET status = 'failed',
            metadata = metadata || jsonb_build_object(
                'red_team_audit_id', v_audit_id,
                'red_team_score', p_overall_score,
                'red_team_issues', p_issues,
                'failed_red_team_at', NOW()
            )
        WHERE id = p_strategy_id;
    END IF;

    RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Update triggers
-- =============================================================================

CREATE OR REPLACE FUNCTION update_missions_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_missions_updated
    BEFORE UPDATE ON missions
    FOR EACH ROW
    EXECUTE FUNCTION update_missions_timestamp();

-- =============================================================================
-- Sample seed mission (for testing)
-- =============================================================================

-- Uncomment to insert a test mission:
-- INSERT INTO missions (name, objective, target_metric, target_value, target_operator, max_drawdown, priority)
-- VALUES (
--     'Alpha Hunter v1',
--     'Find a strategy with Sharpe > 2.0 that survives red team audit',
--     'sharpe',
--     2.0,
--     'gte',
--     -0.15,
--     10
-- );

COMMENT ON TABLE missions IS 'Goal-seeking targets for the autonomous daemon. Set a target, daemon hunts until achieved.';
COMMENT ON TABLE mission_progress IS 'Historical progress towards mission targets.';
COMMENT ON TABLE red_team_audits IS 'Adversarial audit results. Strategies must pass to enter production.';
COMMENT ON TABLE mission_dispatches IS 'Record of swarm dispatches made by autonomous decision engine.';
