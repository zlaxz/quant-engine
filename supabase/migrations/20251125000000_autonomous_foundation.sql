-- Migration: Autonomous Research OS Foundation
-- Purpose: Schema for 24/7 strategy evolution with hybrid local/cloud architecture
-- Date: 2025-11-25
--
-- Architecture:
--   Brain (Cloud): strategy_genome, morning_briefings (Supabase)
--   Eyes (Local): 8TB drive with Massive.com flat files
--   Index (Cloud): local_data_index tracks what's available locally

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE strategy_status AS ENUM (
    'incubating',   -- Newly spawned, not yet tested
    'active',       -- Passed initial tests, running in shadow mode
    'failed',       -- Failed validation or shadow trading
    'retired'       -- Superseded by better offspring
);

CREATE TYPE briefing_verdict AS ENUM (
    'pending',      -- Awaiting user review
    'approved',     -- User approved for live trading
    'rejected'      -- User rejected (with optional feedback)
);

-- ============================================================================
-- STRATEGY GENOME TABLE (The DNA of Trading Strategies)
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategy_genome (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Lineage tracking
    parent_id UUID REFERENCES strategy_genome(id) ON DELETE SET NULL,
    generation INT DEFAULT 0,

    -- Status
    status strategy_status DEFAULT 'incubating',

    -- The strategy itself
    name TEXT NOT NULL,
    dna_config JSONB NOT NULL DEFAULT '{}',
    -- Structure of dna_config:
    -- {
    --   "profile_weights": { "profile_1": 0.2, "profile_2": 0.3, ... },
    --   "regime_thresholds": { "vix_low": 15, "vix_high": 25, ... },
    --   "entry_rules": { ... },
    --   "exit_rules": { ... },
    --   "position_sizing": { "method": "kelly", "max_risk": 0.02 }
    -- }

    code_content TEXT,  -- Full Python strategy code if applicable
    code_hash TEXT,     -- Hash for deduplication

    -- Fitness metrics
    fitness_score FLOAT,  -- Composite fitness (higher = better)
    sharpe_ratio FLOAT,
    sortino_ratio FLOAT,
    max_drawdown FLOAT,
    win_rate FLOAT,
    profit_factor FLOAT,
    cagr FLOAT,

    -- Metadata
    metadata JSONB DEFAULT '{}',
    -- Structure:
    -- {
    --   "mutation_type": "parameter_shift",
    --   "mutation_details": { ... },
    --   "backtest_results": { ... },
    --   "shadow_trades_count": 42,
    --   "shadow_pnl": 1234.56
    -- }

    -- Evolution tracking
    mutations_tried INT DEFAULT 0,
    children_spawned INT DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    tested_at TIMESTAMPTZ,
    promoted_at TIMESTAMPTZ  -- When moved to active status
);

-- Indexes for efficient queries
CREATE INDEX idx_strategy_genome_status ON strategy_genome(status);
CREATE INDEX idx_strategy_genome_parent ON strategy_genome(parent_id);
CREATE INDEX idx_strategy_genome_fitness ON strategy_genome(fitness_score DESC NULLS LAST);
CREATE INDEX idx_strategy_genome_generation ON strategy_genome(generation);
CREATE INDEX idx_strategy_genome_code_hash ON strategy_genome(code_hash) WHERE code_hash IS NOT NULL;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_strategy_genome_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_strategy_genome_updated
    BEFORE UPDATE ON strategy_genome
    FOR EACH ROW
    EXECUTE FUNCTION update_strategy_genome_timestamp();

COMMENT ON TABLE strategy_genome IS 'Evolutionary lineage of trading strategies. Each row is a distinct strategy variant.';

-- ============================================================================
-- MORNING BRIEFINGS TABLE (The User's "Tinder Cards")
-- ============================================================================

CREATE TABLE IF NOT EXISTS morning_briefings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to strategy
    strategy_id UUID NOT NULL REFERENCES strategy_genome(id) ON DELETE CASCADE,

    -- Content for the user
    headline TEXT NOT NULL,  -- "New momentum strategy shows 2.3 Sharpe in shadow trading"
    narrative TEXT NOT NULL, -- Detailed explanation of what the strategy does and why it's promising
    key_metrics JSONB DEFAULT '{}',
    -- Structure:
    -- {
    --   "sharpe": 2.3,
    --   "shadow_trades": 47,
    --   "shadow_pnl": 1234.56,
    --   "win_rate": 0.68,
    --   "max_drawdown": -0.08
    -- }

    -- User interaction
    verdict briefing_verdict DEFAULT 'pending',
    user_feedback TEXT,  -- Optional notes when approving/rejecting
    read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,

    -- Priority/ranking
    priority_score FLOAT DEFAULT 0,  -- Higher = show first

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_morning_briefings_strategy ON morning_briefings(strategy_id);
CREATE INDEX idx_morning_briefings_verdict ON morning_briefings(verdict);
CREATE INDEX idx_morning_briefings_unread ON morning_briefings(read, created_at DESC) WHERE read = FALSE;
CREATE INDEX idx_morning_briefings_priority ON morning_briefings(priority_score DESC, created_at DESC);

COMMENT ON TABLE morning_briefings IS 'Daily feed of promising strategies for user review. Like Tinder cards for trading strategies.';

-- ============================================================================
-- LOCAL DATA INDEX (Tracks What's on the 8TB Drive)
-- ============================================================================

CREATE TABLE IF NOT EXISTS local_data_index (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What data this represents
    symbol TEXT NOT NULL,
    date DATE NOT NULL,
    data_type TEXT NOT NULL,  -- 'trades', 'quotes', 'options_chains', 'ohlcv'

    -- Local file info
    file_path TEXT NOT NULL,  -- Relative path on the 8TB drive
    size_bytes BIGINT,
    row_count BIGINT,

    -- Data quality
    is_complete BOOLEAN DEFAULT TRUE,
    quality_flags JSONB DEFAULT '{}',
    -- Structure:
    -- {
    --   "gaps_detected": false,
    --   "duplicate_rows": 0,
    --   "validation_passed": true
    -- }

    -- Source info
    source TEXT DEFAULT 'massive.com',  -- Data provider
    source_file TEXT,  -- Original filename from provider

    -- Timestamps
    downloaded_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed TIMESTAMPTZ,

    UNIQUE(symbol, date, data_type)
);

-- Indexes for common queries
CREATE INDEX idx_local_data_index_symbol ON local_data_index(symbol);
CREATE INDEX idx_local_data_index_date ON local_data_index(date);
CREATE INDEX idx_local_data_index_type ON local_data_index(data_type);
CREATE INDEX idx_local_data_index_symbol_date ON local_data_index(symbol, date);

COMMENT ON TABLE local_data_index IS 'Index of market data files stored on local 8TB drive. Synced from Massive.com.';

-- ============================================================================
-- SHADOW TRADES TABLE (Paper Trading Verification)
-- ============================================================================

CREATE TABLE IF NOT EXISTS shadow_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to strategy
    strategy_id UUID NOT NULL REFERENCES strategy_genome(id) ON DELETE CASCADE,

    -- Trade details
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,  -- 'buy' or 'sell'
    quantity FLOAT NOT NULL,
    entry_price FLOAT NOT NULL,
    exit_price FLOAT,

    -- Options-specific
    option_type TEXT,  -- 'call', 'put', or null for stock
    strike FLOAT,
    expiry DATE,

    -- P&L
    pnl FLOAT,
    pnl_percent FLOAT,

    -- Timestamps
    signal_time TIMESTAMPTZ NOT NULL,
    entry_time TIMESTAMPTZ,
    exit_time TIMESTAMPTZ,

    -- Execution metadata
    execution_metadata JSONB DEFAULT '{}',
    -- Structure:
    -- {
    --   "slippage_estimate": 0.02,
    --   "market_regime": "low_vol_uptrend",
    --   "signal_strength": 0.85
    -- }

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_shadow_trades_strategy ON shadow_trades(strategy_id);
CREATE INDEX idx_shadow_trades_symbol ON shadow_trades(symbol);
CREATE INDEX idx_shadow_trades_time ON shadow_trades(signal_time DESC);

COMMENT ON TABLE shadow_trades IS 'Paper trades generated by strategies in shadow mode for validation before approval.';

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Calculate composite fitness score
CREATE OR REPLACE FUNCTION calculate_fitness_score(
    p_sharpe FLOAT,
    p_sortino FLOAT,
    p_max_dd FLOAT,
    p_win_rate FLOAT,
    p_profit_factor FLOAT
)
RETURNS FLOAT AS $$
DECLARE
    v_fitness FLOAT;
BEGIN
    -- Weighted composite of key metrics
    -- Prioritizes risk-adjusted returns and drawdown control
    v_fitness := (
        COALESCE(p_sharpe, 0) * 0.30 +          -- 30% weight on Sharpe
        COALESCE(p_sortino, 0) * 0.20 +         -- 20% weight on Sortino
        (1 + COALESCE(p_max_dd, -1)) * 0.25 +   -- 25% weight on drawdown (inverted, higher is better)
        COALESCE(p_win_rate, 0) * 0.10 +        -- 10% weight on win rate
        LEAST(COALESCE(p_profit_factor, 0), 5) * 0.15 / 5  -- 15% weight on profit factor (capped at 5)
    );

    RETURN v_fitness;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Get top N strategies by fitness
CREATE OR REPLACE FUNCTION get_top_strategies(
    p_status strategy_status DEFAULT 'active',
    p_limit INT DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    fitness_score FLOAT,
    sharpe_ratio FLOAT,
    generation INT,
    children_spawned INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        sg.id,
        sg.name,
        sg.fitness_score,
        sg.sharpe_ratio,
        sg.generation,
        sg.children_spawned
    FROM strategy_genome sg
    WHERE sg.status = p_status
    ORDER BY sg.fitness_score DESC NULLS LAST
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Create a mutation (offspring) of a strategy
CREATE OR REPLACE FUNCTION create_mutation(
    p_parent_id UUID,
    p_name TEXT,
    p_dna_config JSONB,
    p_code_content TEXT DEFAULT NULL,
    p_mutation_type TEXT DEFAULT 'unknown'
)
RETURNS UUID AS $$
DECLARE
    v_new_id UUID;
    v_parent_generation INT;
BEGIN
    -- Get parent's generation
    SELECT generation INTO v_parent_generation
    FROM strategy_genome
    WHERE id = p_parent_id;

    -- Create offspring
    INSERT INTO strategy_genome (
        parent_id,
        generation,
        name,
        dna_config,
        code_content,
        code_hash,
        metadata
    ) VALUES (
        p_parent_id,
        COALESCE(v_parent_generation, 0) + 1,
        p_name,
        p_dna_config,
        p_code_content,
        CASE WHEN p_code_content IS NOT NULL
             THEN md5(p_code_content)
             ELSE NULL
        END,
        jsonb_build_object('mutation_type', p_mutation_type)
    )
    RETURNING id INTO v_new_id;

    -- Update parent's children count
    UPDATE strategy_genome
    SET children_spawned = children_spawned + 1
    WHERE id = p_parent_id;

    RETURN v_new_id;
END;
$$ LANGUAGE plpgsql;

-- Promote strategy to active status and create briefing
CREATE OR REPLACE FUNCTION promote_strategy(
    p_strategy_id UUID,
    p_headline TEXT,
    p_narrative TEXT
)
RETURNS UUID AS $$
DECLARE
    v_briefing_id UUID;
    v_metrics JSONB;
BEGIN
    -- Get strategy metrics for briefing
    SELECT jsonb_build_object(
        'sharpe', sharpe_ratio,
        'sortino', sortino_ratio,
        'max_drawdown', max_drawdown,
        'win_rate', win_rate,
        'profit_factor', profit_factor,
        'fitness', fitness_score
    ) INTO v_metrics
    FROM strategy_genome
    WHERE id = p_strategy_id;

    -- Update strategy status
    UPDATE strategy_genome
    SET
        status = 'active',
        promoted_at = NOW()
    WHERE id = p_strategy_id;

    -- Create morning briefing
    INSERT INTO morning_briefings (
        strategy_id,
        headline,
        narrative,
        key_metrics,
        priority_score
    ) VALUES (
        p_strategy_id,
        p_headline,
        p_narrative,
        v_metrics,
        COALESCE((v_metrics->>'fitness')::FLOAT, 0)
    )
    RETURNING id INTO v_briefing_id;

    RETURN v_briefing_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE strategy_genome ENABLE ROW LEVEL SECURITY;
ALTER TABLE morning_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_data_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow_trades ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access (single-tenant for now)
CREATE POLICY "Allow authenticated access to strategy_genome"
    ON strategy_genome FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow authenticated access to morning_briefings"
    ON morning_briefings FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow authenticated access to local_data_index"
    ON local_data_index FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow authenticated access to shadow_trades"
    ON shadow_trades FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Also allow anon for development/local testing
CREATE POLICY "Allow anon read access to strategy_genome"
    ON strategy_genome FOR SELECT
    TO anon
    USING (true);

CREATE POLICY "Allow anon read access to morning_briefings"
    ON morning_briefings FOR SELECT
    TO anon
    USING (true);

CREATE POLICY "Allow anon read access to local_data_index"
    ON local_data_index FOR SELECT
    TO anon
    USING (true);

-- Service role can do everything
CREATE POLICY "Service role full access to strategy_genome"
    ON strategy_genome FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access to morning_briefings"
    ON morning_briefings FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access to local_data_index"
    ON local_data_index FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access to shadow_trades"
    ON shadow_trades FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- SUMMARY
-- ============================================================================

COMMENT ON SCHEMA public IS
'Autonomous Research OS Foundation:
- strategy_genome: Evolutionary lineage of trading strategies
- morning_briefings: User feed of promising discoveries ("Tinder Cards")
- local_data_index: Index of 8TB local drive data (Massive.com flat files)
- shadow_trades: Paper trading verification before production

Helper functions:
- calculate_fitness_score(): Composite metric calculation
- get_top_strategies(): Query best performers
- create_mutation(): Spawn offspring strategy
- promote_strategy(): Move to active + create briefing';
