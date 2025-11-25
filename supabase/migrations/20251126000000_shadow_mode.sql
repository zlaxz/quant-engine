-- Migration: Shadow Mode - Real-Time Paper Trading Validation
-- Purpose: Add live position tracking and enhanced trade history for Shadow Validator
-- Date: 2025-11-26
--
-- Architecture:
--   shadow_positions: Live open positions being tracked in real-time
--   shadow_trades: Enhanced with execution quality metrics and regime context

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE position_side AS ENUM ('long', 'short');
CREATE TYPE graduation_status AS ENUM ('pending', 'graduated', 'failed', 'paused');

-- ============================================================================
-- SHADOW POSITIONS TABLE (Live Open Positions)
-- ============================================================================

CREATE TABLE IF NOT EXISTS shadow_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to strategy
    strategy_id UUID NOT NULL REFERENCES strategy_genome(id) ON DELETE CASCADE,

    -- Position identity
    symbol TEXT NOT NULL,
    side position_side NOT NULL,
    quantity FLOAT NOT NULL,

    -- Options-specific (nullable for equity positions)
    option_type TEXT,          -- 'call', 'put', or null for stock/futures
    strike FLOAT,
    expiry DATE,

    -- Entry details
    entry_price FLOAT NOT NULL,
    entry_time TIMESTAMPTZ NOT NULL,
    entry_bid FLOAT,           -- Bid at entry (for slippage analysis)
    entry_ask FLOAT,           -- Ask at entry

    -- Live tracking
    current_price FLOAT,
    current_bid FLOAT,
    current_ask FLOAT,
    current_pnl FLOAT DEFAULT 0,
    current_pnl_pct FLOAT DEFAULT 0,
    unrealized_slippage FLOAT DEFAULT 0,  -- Estimated slippage if closed now

    -- Risk metrics
    max_favorable_excursion FLOAT DEFAULT 0,   -- Peak profit during position
    max_adverse_excursion FLOAT DEFAULT 0,     -- Peak loss during position
    time_in_position_seconds INT DEFAULT 0,

    -- Regime context
    regime_at_entry TEXT,      -- e.g., 'LOW_VOL_GRIND', 'CRASH_ACCELERATION'
    current_regime TEXT,

    -- Status
    is_open BOOLEAN DEFAULT TRUE,

    -- Metadata
    entry_metadata JSONB DEFAULT '{}',
    -- Structure:
    -- {
    --   "signal_strength": 0.85,
    --   "latency_ms": 127,
    --   "quote_size_at_entry": 500,
    --   "order_size": 10,
    --   "fill_type": "full" | "partial" | "rejected"
    -- }

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

-- Indexes for efficient queries
CREATE INDEX idx_shadow_positions_strategy ON shadow_positions(strategy_id);
CREATE INDEX idx_shadow_positions_symbol ON shadow_positions(symbol);
CREATE INDEX idx_shadow_positions_open ON shadow_positions(is_open, strategy_id) WHERE is_open = TRUE;
CREATE INDEX idx_shadow_positions_regime ON shadow_positions(regime_at_entry);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_shadow_positions_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_shadow_positions_updated
    BEFORE UPDATE ON shadow_positions
    FOR EACH ROW
    EXECUTE FUNCTION update_shadow_positions_timestamp();

COMMENT ON TABLE shadow_positions IS 'Live open positions being tracked in shadow/paper trading mode for validation.';

-- ============================================================================
-- ENHANCE SHADOW TRADES TABLE (Add execution quality metrics)
-- ============================================================================

-- Add new columns to existing shadow_trades table
ALTER TABLE shadow_trades
    ADD COLUMN IF NOT EXISTS slippage_cost FLOAT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS duration_seconds INT,
    ADD COLUMN IF NOT EXISTS regime_at_entry TEXT,
    ADD COLUMN IF NOT EXISTS regime_at_exit TEXT,
    ADD COLUMN IF NOT EXISTS entry_bid FLOAT,
    ADD COLUMN IF NOT EXISTS entry_ask FLOAT,
    ADD COLUMN IF NOT EXISTS exit_bid FLOAT,
    ADD COLUMN IF NOT EXISTS exit_ask FLOAT,
    ADD COLUMN IF NOT EXISTS fill_latency_ms INT,
    ADD COLUMN IF NOT EXISTS fill_type TEXT DEFAULT 'full',  -- 'full', 'partial', 'rejected'
    ADD COLUMN IF NOT EXISTS max_favorable_excursion FLOAT,
    ADD COLUMN IF NOT EXISTS max_adverse_excursion FLOAT;

-- Add index for regime analysis
CREATE INDEX IF NOT EXISTS idx_shadow_trades_regime ON shadow_trades(regime_at_entry);
CREATE INDEX IF NOT EXISTS idx_shadow_trades_duration ON shadow_trades(duration_seconds);

COMMENT ON COLUMN shadow_trades.slippage_cost IS 'Cost of slippage: (fill_price - mid_price) * quantity';
COMMENT ON COLUMN shadow_trades.duration_seconds IS 'Time from entry to exit in seconds';
COMMENT ON COLUMN shadow_trades.regime_at_entry IS 'Market regime when position was opened';
COMMENT ON COLUMN shadow_trades.fill_latency_ms IS 'Simulated latency between signal and fill (50-200ms)';

-- ============================================================================
-- GRADUATION TRACKER TABLE (Strategy Readiness for Production)
-- ============================================================================

CREATE TABLE IF NOT EXISTS graduation_tracker (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to strategy
    strategy_id UUID NOT NULL REFERENCES strategy_genome(id) ON DELETE CASCADE,

    -- Graduation criteria progress
    shadow_trade_count INT DEFAULT 0,
    shadow_sharpe FLOAT,
    shadow_sortino FLOAT,
    shadow_max_drawdown FLOAT,
    shadow_win_rate FLOAT,
    shadow_profit_factor FLOAT,
    shadow_total_pnl FLOAT DEFAULT 0,

    -- Execution quality metrics
    avg_slippage_cost FLOAT DEFAULT 0,
    avg_fill_latency_ms FLOAT,
    rejection_rate FLOAT DEFAULT 0,    -- Trades rejected due to liquidity
    partial_fill_rate FLOAT DEFAULT 0,

    -- Regime coverage
    regime_distribution JSONB DEFAULT '{}',
    -- Structure:
    -- {
    --   "LOW_VOL_GRIND": { "trades": 15, "pnl": 234.56, "sharpe": 2.1 },
    --   "CRASH_ACCELERATION": { "trades": 5, "pnl": -45.67, "sharpe": -0.3 }
    -- }

    -- Graduation status
    status graduation_status DEFAULT 'pending',
    graduation_threshold_met BOOLEAN DEFAULT FALSE,
    graduation_date TIMESTAMPTZ,

    -- Thresholds for graduation (configurable per strategy)
    required_trade_count INT DEFAULT 50,
    required_sharpe FLOAT DEFAULT 1.5,
    required_win_rate FLOAT DEFAULT 0.50,
    max_allowed_drawdown FLOAT DEFAULT -0.20,

    -- Metadata
    evaluation_notes TEXT,
    last_evaluation_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(strategy_id)
);

-- Indexes
CREATE INDEX idx_graduation_tracker_status ON graduation_tracker(status);
CREATE INDEX idx_graduation_tracker_threshold ON graduation_tracker(graduation_threshold_met) WHERE graduation_threshold_met = TRUE;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_graduation_tracker_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_graduation_tracker_updated
    BEFORE UPDATE ON graduation_tracker
    FOR EACH ROW
    EXECUTE FUNCTION update_graduation_tracker_timestamp();

COMMENT ON TABLE graduation_tracker IS 'Tracks strategy progress toward production readiness based on shadow trading performance.';

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Open a new shadow position
CREATE OR REPLACE FUNCTION open_shadow_position(
    p_strategy_id UUID,
    p_symbol TEXT,
    p_side position_side,
    p_quantity FLOAT,
    p_entry_price FLOAT,
    p_entry_bid FLOAT,
    p_entry_ask FLOAT,
    p_regime TEXT,
    p_latency_ms INT DEFAULT 100,
    p_option_type TEXT DEFAULT NULL,
    p_strike FLOAT DEFAULT NULL,
    p_expiry DATE DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_position_id UUID;
BEGIN
    INSERT INTO shadow_positions (
        strategy_id,
        symbol,
        side,
        quantity,
        entry_price,
        entry_time,
        entry_bid,
        entry_ask,
        current_price,
        regime_at_entry,
        current_regime,
        option_type,
        strike,
        expiry,
        entry_metadata
    ) VALUES (
        p_strategy_id,
        p_symbol,
        p_side,
        p_quantity,
        p_entry_price,
        NOW(),
        p_entry_bid,
        p_entry_ask,
        p_entry_price,
        p_regime,
        p_regime,
        p_option_type,
        p_strike,
        p_expiry,
        jsonb_build_object(
            'latency_ms', p_latency_ms,
            'fill_type', 'full'
        )
    )
    RETURNING id INTO v_position_id;

    -- Initialize graduation tracker if not exists
    INSERT INTO graduation_tracker (strategy_id)
    VALUES (p_strategy_id)
    ON CONFLICT (strategy_id) DO NOTHING;

    RETURN v_position_id;
END;
$$ LANGUAGE plpgsql;

-- Close a shadow position and record the trade
CREATE OR REPLACE FUNCTION close_shadow_position(
    p_position_id UUID,
    p_exit_price FLOAT,
    p_exit_bid FLOAT,
    p_exit_ask FLOAT,
    p_regime TEXT
)
RETURNS UUID AS $$
DECLARE
    v_position RECORD;
    v_trade_id UUID;
    v_pnl FLOAT;
    v_pnl_pct FLOAT;
    v_slippage FLOAT;
    v_duration INT;
BEGIN
    -- Get position details
    SELECT * INTO v_position
    FROM shadow_positions
    WHERE id = p_position_id AND is_open = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Position not found or already closed: %', p_position_id;
    END IF;

    -- Calculate P&L based on side
    IF v_position.side = 'long' THEN
        v_pnl := (p_exit_price - v_position.entry_price) * v_position.quantity;
        -- Slippage: bought at ask, sold at bid
        v_slippage := (v_position.entry_ask - v_position.entry_price) +
                      (p_exit_price - p_exit_bid);
    ELSE
        v_pnl := (v_position.entry_price - p_exit_price) * v_position.quantity;
        -- Slippage: sold at bid, bought at ask
        v_slippage := (v_position.entry_price - v_position.entry_bid) +
                      (p_exit_ask - p_exit_price);
    END IF;

    v_slippage := v_slippage * v_position.quantity;
    v_pnl_pct := v_pnl / (v_position.entry_price * v_position.quantity);
    v_duration := EXTRACT(EPOCH FROM (NOW() - v_position.entry_time))::INT;

    -- Close the position
    UPDATE shadow_positions
    SET
        is_open = FALSE,
        closed_at = NOW(),
        current_price = p_exit_price,
        current_bid = p_exit_bid,
        current_ask = p_exit_ask,
        current_pnl = v_pnl,
        current_pnl_pct = v_pnl_pct,
        unrealized_slippage = v_slippage,
        time_in_position_seconds = v_duration,
        current_regime = p_regime
    WHERE id = p_position_id;

    -- Record the trade
    INSERT INTO shadow_trades (
        strategy_id,
        symbol,
        side,
        quantity,
        entry_price,
        exit_price,
        option_type,
        strike,
        expiry,
        pnl,
        pnl_percent,
        slippage_cost,
        duration_seconds,
        regime_at_entry,
        regime_at_exit,
        entry_bid,
        entry_ask,
        exit_bid,
        exit_ask,
        fill_latency_ms,
        fill_type,
        max_favorable_excursion,
        max_adverse_excursion,
        signal_time,
        entry_time,
        exit_time,
        execution_metadata
    ) VALUES (
        v_position.strategy_id,
        v_position.symbol,
        v_position.side::TEXT,
        v_position.quantity,
        v_position.entry_price,
        p_exit_price,
        v_position.option_type,
        v_position.strike,
        v_position.expiry,
        v_pnl,
        v_pnl_pct,
        v_slippage,
        v_duration,
        v_position.regime_at_entry,
        p_regime,
        v_position.entry_bid,
        v_position.entry_ask,
        p_exit_bid,
        p_exit_ask,
        (v_position.entry_metadata->>'latency_ms')::INT,
        v_position.entry_metadata->>'fill_type',
        v_position.max_favorable_excursion,
        v_position.max_adverse_excursion,
        v_position.entry_time,
        v_position.entry_time,
        NOW(),
        v_position.entry_metadata
    )
    RETURNING id INTO v_trade_id;

    -- Update graduation tracker
    PERFORM update_graduation_metrics(v_position.strategy_id);

    RETURN v_trade_id;
END;
$$ LANGUAGE plpgsql;

-- Update graduation metrics after each trade
CREATE OR REPLACE FUNCTION update_graduation_metrics(p_strategy_id UUID)
RETURNS VOID AS $$
DECLARE
    v_stats RECORD;
    v_regime_dist JSONB;
BEGIN
    -- Calculate aggregate stats from shadow_trades
    SELECT
        COUNT(*) as trade_count,
        COALESCE(SUM(pnl), 0) as total_pnl,
        COALESCE(AVG(slippage_cost), 0) as avg_slippage,
        COALESCE(AVG(fill_latency_ms), 0) as avg_latency,
        COALESCE(
            COUNT(*) FILTER (WHERE pnl > 0)::FLOAT /
            NULLIF(COUNT(*), 0),
            0
        ) as win_rate,
        COALESCE(
            SUM(pnl) FILTER (WHERE pnl > 0) /
            NULLIF(ABS(SUM(pnl) FILTER (WHERE pnl < 0)), 0),
            0
        ) as profit_factor
    INTO v_stats
    FROM shadow_trades
    WHERE strategy_id = p_strategy_id;

    -- Calculate regime distribution
    SELECT jsonb_object_agg(
        regime_at_entry,
        jsonb_build_object(
            'trades', count,
            'pnl', pnl
        )
    )
    INTO v_regime_dist
    FROM (
        SELECT
            regime_at_entry,
            COUNT(*) as count,
            SUM(pnl) as pnl
        FROM shadow_trades
        WHERE strategy_id = p_strategy_id
          AND regime_at_entry IS NOT NULL
        GROUP BY regime_at_entry
    ) subq;

    -- Update graduation tracker
    UPDATE graduation_tracker
    SET
        shadow_trade_count = v_stats.trade_count,
        shadow_total_pnl = v_stats.total_pnl,
        shadow_win_rate = v_stats.win_rate,
        shadow_profit_factor = v_stats.profit_factor,
        avg_slippage_cost = v_stats.avg_slippage,
        avg_fill_latency_ms = v_stats.avg_latency,
        regime_distribution = COALESCE(v_regime_dist, '{}'),
        graduation_threshold_met = (
            v_stats.trade_count >= required_trade_count AND
            v_stats.win_rate >= required_win_rate
        ),
        last_evaluation_at = NOW()
    WHERE strategy_id = p_strategy_id;
END;
$$ LANGUAGE plpgsql;

-- Check if strategy is ready for graduation
CREATE OR REPLACE FUNCTION check_graduation_ready(p_strategy_id UUID)
RETURNS TABLE (
    is_ready BOOLEAN,
    trade_count INT,
    sharpe FLOAT,
    win_rate FLOAT,
    missing_criteria TEXT[]
) AS $$
DECLARE
    v_tracker RECORD;
    v_missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
    SELECT * INTO v_tracker
    FROM graduation_tracker
    WHERE strategy_id = p_strategy_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT
            FALSE,
            0,
            0::FLOAT,
            0::FLOAT,
            ARRAY['No graduation tracker found']::TEXT[];
        RETURN;
    END IF;

    -- Check each criterion
    IF v_tracker.shadow_trade_count < v_tracker.required_trade_count THEN
        v_missing := array_append(v_missing,
            format('Trade count %s < %s required', v_tracker.shadow_trade_count, v_tracker.required_trade_count));
    END IF;

    IF COALESCE(v_tracker.shadow_sharpe, 0) < v_tracker.required_sharpe THEN
        v_missing := array_append(v_missing,
            format('Sharpe %s < %s required', COALESCE(v_tracker.shadow_sharpe, 0), v_tracker.required_sharpe));
    END IF;

    IF COALESCE(v_tracker.shadow_win_rate, 0) < v_tracker.required_win_rate THEN
        v_missing := array_append(v_missing,
            format('Win rate %s < %s required', COALESCE(v_tracker.shadow_win_rate, 0), v_tracker.required_win_rate));
    END IF;

    RETURN QUERY SELECT
        array_length(v_missing, 1) IS NULL OR array_length(v_missing, 1) = 0,
        v_tracker.shadow_trade_count,
        v_tracker.shadow_sharpe,
        v_tracker.shadow_win_rate,
        v_missing;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE shadow_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE graduation_tracker ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access
CREATE POLICY "Allow authenticated access to shadow_positions"
    ON shadow_positions FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow authenticated access to graduation_tracker"
    ON graduation_tracker FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Allow anon read access for development
CREATE POLICY "Allow anon read access to shadow_positions"
    ON shadow_positions FOR SELECT
    TO anon
    USING (true);

CREATE POLICY "Allow anon read access to graduation_tracker"
    ON graduation_tracker FOR SELECT
    TO anon
    USING (true);

-- Service role full access
CREATE POLICY "Service role full access to shadow_positions"
    ON shadow_positions FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access to graduation_tracker"
    ON graduation_tracker FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- SUMMARY
-- ============================================================================

COMMENT ON SCHEMA public IS
'Shadow Mode - Real-Time Paper Trading Validation:

Tables:
- shadow_positions: Live open positions tracked in real-time
- shadow_trades: Enhanced with slippage_cost, duration_seconds, regime_at_entry
- graduation_tracker: Strategy readiness tracking for production

Functions:
- open_shadow_position(): Open a new paper trading position
- close_shadow_position(): Close position and record trade with execution quality
- update_graduation_metrics(): Recalculate graduation progress after each trade
- check_graduation_ready(): Verify if strategy meets graduation criteria

Graduation Criteria (configurable):
- 50+ shadow trades
- Sharpe ratio >= 1.5
- Win rate >= 50%
- Max drawdown >= -20%';
