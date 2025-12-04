-- Migration: Gamma Intelligence Tables
-- Purpose: Bridge Python gamma calculations to React UI via Supabase
-- Date: 2025-12-04
--
-- Architecture:
--   Python (gamma_calc.py) → Supabase (dealer_positioning, gamma_walls) → React (GammaIntelligenceMonitor)
--   Real-time subscriptions enable automatic UI updates when Python publishes new data

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE dealer_positioning_type AS ENUM (
    'LONG_GAMMA',   -- Dealers long gamma = stabilizing market (buy dips, sell rips)
    'SHORT_GAMMA',  -- Dealers short gamma = amplifying moves
    'NEUTRAL'       -- Near zero gamma exposure
);

CREATE TYPE gamma_wall_type AS ENUM (
    'SUPPORT',      -- Put wall below spot - support level
    'RESISTANCE',   -- Call wall above spot - resistance level
    'MAGNET',       -- Zero gamma level - price attraction point
    'FLIP_ZONE'     -- Where gamma flips sign
);

CREATE TYPE vol_impact_type AS ENUM (
    'AMPLIFIED',    -- Dealers short gamma - vol amplified
    'DAMPENED',     -- Dealers long gamma - vol dampened
    'NEUTRAL'       -- No significant gamma effect
);

-- ============================================================================
-- DEALER POSITIONING TABLE
-- Primary table for gamma exposure summary by symbol
-- ============================================================================

CREATE TABLE IF NOT EXISTS dealer_positioning (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Symbol identification
    symbol TEXT NOT NULL,

    -- Core positioning data
    positioning dealer_positioning_type NOT NULL,
    positioning_strength FLOAT NOT NULL CHECK (positioning_strength >= 0 AND positioning_strength <= 100),

    -- Gamma metrics
    net_gamma FLOAT NOT NULL,           -- Net GEX in dollars
    call_gamma FLOAT,                   -- Call contribution
    put_gamma FLOAT,                    -- Put contribution
    gamma_notional FLOAT,               -- Total notional gamma exposure

    -- Context
    spot_price FLOAT NOT NULL,
    zero_gamma_level FLOAT,             -- Price where GEX flips sign

    -- Vol impact assessment
    vol_impact vol_impact_type DEFAULT 'NEUTRAL',

    -- Metadata
    data_source TEXT DEFAULT 'calculated',  -- 'calculated', 'live_feed', 'estimated'
    calculation_timestamp TIMESTAMPTZ DEFAULT NOW(),

    -- Standard timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique constraint: one active record per symbol (upsert pattern)
    CONSTRAINT dealer_positioning_symbol_unique UNIQUE (symbol)
);

-- Indexes
CREATE INDEX idx_dealer_positioning_symbol ON dealer_positioning(symbol);
CREATE INDEX idx_dealer_positioning_type ON dealer_positioning(positioning);
CREATE INDEX idx_dealer_positioning_updated ON dealer_positioning(updated_at DESC);

-- Enable realtime for React subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE dealer_positioning;

-- ============================================================================
-- GAMMA WALLS TABLE
-- Individual gamma walls (support/resistance levels)
-- ============================================================================

CREATE TABLE IF NOT EXISTS gamma_walls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Symbol identification
    symbol TEXT NOT NULL,

    -- Wall data
    strike FLOAT NOT NULL,
    wall_type gamma_wall_type NOT NULL,
    wall_strength FLOAT NOT NULL CHECK (wall_strength >= 0 AND wall_strength <= 100),

    -- Context
    distance_from_spot FLOAT NOT NULL,  -- Positive = above spot, negative = below
    gamma_at_strike FLOAT,              -- GEX concentrated at this strike
    open_interest INT,                  -- OI at this strike

    -- Pin probability (for magnet walls)
    pin_probability FLOAT CHECK (pin_probability >= 0 AND pin_probability <= 1),

    -- Metadata
    expiration_date DATE,               -- If wall is expiry-specific
    data_source TEXT DEFAULT 'calculated',

    -- Standard timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_gamma_walls_symbol ON gamma_walls(symbol);
CREATE INDEX idx_gamma_walls_type ON gamma_walls(wall_type);
CREATE INDEX idx_gamma_walls_strike ON gamma_walls(strike);
CREATE INDEX idx_gamma_walls_updated ON gamma_walls(updated_at DESC);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE gamma_walls;

-- ============================================================================
-- MARKET REGIME LIVE TABLE
-- Current market regime for UI display
-- ============================================================================

CREATE TABLE IF NOT EXISTS market_regime_live (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Single row pattern (one active regime at a time)
    is_current BOOLEAN DEFAULT TRUE,

    -- VIX regime
    vix_level FLOAT NOT NULL,
    vix_regime TEXT NOT NULL,  -- 'OPTIMAL', 'SUBOPTIMAL', 'PAUSE'

    -- SPY trend
    spy_price FLOAT,
    spy_trend TEXT,  -- 'STRONG_UP', 'UP', 'NEUTRAL', 'DOWN', 'STRONG_DOWN'

    -- MA levels
    sma_20 FLOAT,
    sma_50 FLOAT,
    sma_200 FLOAT,

    -- Correlation regime
    sector_correlation FLOAT,  -- Average pairwise correlation
    correlation_regime TEXT,   -- 'RISK_ON', 'RISK_OFF', 'TRANSITIONING'

    -- Position multiplier
    position_multiplier FLOAT DEFAULT 1.0 CHECK (position_multiplier >= 0 AND position_multiplier <= 2.0),

    -- Metadata
    data_source TEXT DEFAULT 'calculated',
    calculation_timestamp TIMESTAMPTZ DEFAULT NOW(),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE market_regime_live;

-- ============================================================================
-- GAMMA FLIP EVENTS TABLE
-- Historical gamma flip events for pattern analysis
-- ============================================================================

CREATE TABLE IF NOT EXISTS gamma_flip_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    symbol TEXT NOT NULL,

    -- Flip details
    flip_timestamp TIMESTAMPTZ NOT NULL,
    from_positioning dealer_positioning_type NOT NULL,
    to_positioning dealer_positioning_type NOT NULL,

    -- Context at flip
    spot_price_at_flip FLOAT NOT NULL,
    zero_gamma_level FLOAT,
    net_gex_before FLOAT,
    net_gex_after FLOAT,

    -- Outcome tracking (filled in later)
    price_1h_later FLOAT,
    price_1d_later FLOAT,
    vol_change_1d FLOAT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_gamma_flip_symbol ON gamma_flip_events(symbol);
CREATE INDEX idx_gamma_flip_timestamp ON gamma_flip_events(flip_timestamp DESC);

-- ============================================================================
-- UPDATE TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_gamma_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_dealer_positioning_updated
    BEFORE UPDATE ON dealer_positioning
    FOR EACH ROW
    EXECUTE FUNCTION update_gamma_timestamp();

CREATE TRIGGER trigger_gamma_walls_updated
    BEFORE UPDATE ON gamma_walls
    FOR EACH ROW
    EXECUTE FUNCTION update_gamma_timestamp();

CREATE TRIGGER trigger_market_regime_live_updated
    BEFORE UPDATE ON market_regime_live
    FOR EACH ROW
    EXECUTE FUNCTION update_gamma_timestamp();

-- ============================================================================
-- RPC FUNCTIONS FOR EFFICIENT QUERIES
-- ============================================================================

-- Get complete gamma intelligence for a symbol
CREATE OR REPLACE FUNCTION get_gamma_intelligence(p_symbol TEXT)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'positioning', (
            SELECT row_to_json(dp.*)
            FROM dealer_positioning dp
            WHERE dp.symbol = p_symbol
        ),
        'walls', (
            SELECT jsonb_agg(row_to_json(gw.*))
            FROM gamma_walls gw
            WHERE gw.symbol = p_symbol
            ORDER BY gw.wall_strength DESC
        ),
        'regime', (
            SELECT row_to_json(mr.*)
            FROM market_regime_live mr
            WHERE mr.is_current = TRUE
            LIMIT 1
        )
    ) INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Cleanup old gamma walls (keep only latest per symbol)
CREATE OR REPLACE FUNCTION cleanup_old_gamma_walls(p_keep_hours INT DEFAULT 24)
RETURNS INT AS $$
DECLARE
    deleted_count INT;
BEGIN
    DELETE FROM gamma_walls
    WHERE updated_at < NOW() - (p_keep_hours || ' hours')::INTERVAL;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- GRANTS (for service role access from Python)
-- ============================================================================

GRANT ALL ON dealer_positioning TO service_role;
GRANT ALL ON gamma_walls TO service_role;
GRANT ALL ON market_regime_live TO service_role;
GRANT ALL ON gamma_flip_events TO service_role;
GRANT EXECUTE ON FUNCTION get_gamma_intelligence TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_old_gamma_walls TO service_role;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE dealer_positioning IS 'Current dealer gamma positioning by symbol. Python writes, React reads via realtime subscription.';
COMMENT ON TABLE gamma_walls IS 'Gamma walls (support/resistance levels) derived from options OI. Multiple walls per symbol.';
COMMENT ON TABLE market_regime_live IS 'Current market regime for UI display. Single-row pattern with is_current flag.';
COMMENT ON TABLE gamma_flip_events IS 'Historical gamma flip events for pattern analysis and ML training.';
