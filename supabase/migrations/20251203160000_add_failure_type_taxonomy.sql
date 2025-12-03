-- Migration: Add Failure Type Taxonomy to causal_memories
-- Purpose: Standardize failure classification for statistical analysis
--
-- This transforms text-based failure reasons into a queryable taxonomy,
-- enabling statistical analysis like:
-- "What percentage of trend strategies fail due to regime mismatch?"

-- Add failure_type column with enum constraint
ALTER TABLE causal_memories
ADD COLUMN IF NOT EXISTS failure_type TEXT;

-- Add check constraint to enforce valid failure types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'causal_memories_failure_type_check'
  ) THEN
    ALTER TABLE causal_memories
    ADD CONSTRAINT causal_memories_failure_type_check
    CHECK (failure_type IS NULL OR failure_type IN (
      'overfitting',
      'regime_mismatch',
      'fee_erosion',
      'liquidity_drag',
      'lookahead_bias',
      'noise_stops',
      'execution_lag',
      'correlation_break',
      'tail_risk',
      'parameter_fragile',
      'unknown'
    ));
  END IF;
END $$;

-- Create index on failure_type for fast reporting
CREATE INDEX IF NOT EXISTS idx_causal_memories_failure_type
ON causal_memories (failure_type);

-- Create index for combined queries (workspace + failure_type)
CREATE INDEX IF NOT EXISTS idx_causal_memories_workspace_failure
ON causal_memories (workspace_id, failure_type);

-- Add comment documenting the taxonomy
COMMENT ON COLUMN causal_memories.failure_type IS 'Standardized failure classification. Values:
- overfitting: Failed white noise test, curve-fitted to past data
- regime_mismatch: Strategy logic contradicts current market regime
- fee_erosion: Edge eaten by transaction costs
- liquidity_drag: Spread wider than edge
- lookahead_bias: Code used future data
- noise_stops: Stop loss too tight for market noise
- execution_lag: Signal too slow for price action
- correlation_break: Assumed relationship broke down
- tail_risk: Black swan devastated position
- parameter_fragile: Only works with exact parameter values
- unknown: Cannot determine cause';

-- Create aggregate view for failure type statistics
CREATE OR REPLACE VIEW failure_type_stats AS
SELECT
  failure_type,
  COUNT(*) as occurrence_count,
  ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) as percentage,
  MAX(created_at) as last_occurrence
FROM causal_memories
WHERE failure_type IS NOT NULL
GROUP BY failure_type
ORDER BY occurrence_count DESC;

-- Grant access to the view
GRANT SELECT ON failure_type_stats TO authenticated;
GRANT SELECT ON failure_type_stats TO anon;
