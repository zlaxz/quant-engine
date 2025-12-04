-- Fix: Add Sharpe ratio calculation to graduation metrics
-- Previously, shadow_sharpe was never calculated, making graduation impossible
--
-- Sharpe formula: mean(returns) / stddev(returns) * sqrt(252)
-- We use per-trade returns (pnl / entry_price) for calculation

CREATE OR REPLACE FUNCTION update_graduation_metrics(p_strategy_id UUID)
RETURNS VOID AS $$
DECLARE
    v_stats RECORD;
    v_regime_dist JSONB;
    v_sharpe FLOAT;
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
    WHERE strategy_id = p_strategy_id
      AND fill_type != 'rejected';  -- Exclude rejected trades

    -- Calculate Sharpe ratio from trade returns
    -- Returns = pnl / entry_price for each trade
    -- Sharpe = mean(returns) / stddev(returns) * sqrt(252) [annualized]
    SELECT
        CASE
            WHEN COUNT(*) < 3 THEN 0  -- Need at least 3 trades for meaningful Sharpe
            WHEN STDDEV(pnl / NULLIF(entry_price, 0)) IS NULL OR STDDEV(pnl / NULLIF(entry_price, 0)) = 0 THEN
                CASE
                    WHEN AVG(pnl / NULLIF(entry_price, 0)) > 0 THEN 3.0  -- All positive, cap at 3
                    WHEN AVG(pnl / NULLIF(entry_price, 0)) < 0 THEN -3.0  -- All negative, cap at -3
                    ELSE 0
                END
            ELSE
                (AVG(pnl / NULLIF(entry_price, 0)) / STDDEV(pnl / NULLIF(entry_price, 0))) * SQRT(252)
        END
    INTO v_sharpe
    FROM shadow_trades
    WHERE strategy_id = p_strategy_id
      AND fill_type != 'rejected'
      AND entry_price > 0;  -- Avoid division by zero

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

    -- Update graduation tracker - NOW INCLUDING SHARPE!
    UPDATE graduation_tracker
    SET
        shadow_trade_count = v_stats.trade_count,
        shadow_total_pnl = v_stats.total_pnl,
        shadow_sharpe = COALESCE(v_sharpe, 0),  -- THE FIX: Now actually setting shadow_sharpe
        shadow_win_rate = v_stats.win_rate,
        shadow_profit_factor = v_stats.profit_factor,
        avg_slippage_cost = v_stats.avg_slippage,
        avg_fill_latency_ms = v_stats.avg_latency,
        regime_distribution = COALESCE(v_regime_dist, '{}'),
        graduation_threshold_met = (
            v_stats.trade_count >= required_trade_count AND
            v_stats.win_rate >= required_win_rate AND
            COALESCE(v_sharpe, 0) >= required_sharpe  -- Also check Sharpe in threshold
        ),
        last_evaluation_at = NOW()
    WHERE strategy_id = p_strategy_id;
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the fix
COMMENT ON FUNCTION update_graduation_metrics IS
'Updates graduation tracker with shadow trading metrics including Sharpe ratio.
Fixed 2025-12-03: Previously shadow_sharpe was never calculated, making graduation impossible.
Now calculates annualized Sharpe from per-trade returns.';
