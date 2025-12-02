-- Causal Memory: Storing the physics of why strategies work
CREATE TABLE IF NOT EXISTS causal_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    event_description TEXT NOT NULL,
    mechanism TEXT,             -- e.g., "Vol-of-vol expansion forces market maker widening"
    causal_graph JSONB,         -- Nodes and edges of causality
    statistical_validation JSONB, -- { "p_value": 0.03, "sample_size": 1000 }
    counterfactuals JSONB,      -- "If VIX > 30, this trade fails"
    related_strategies TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Semantic search for mechanisms
ALTER TABLE causal_memories ADD COLUMN IF NOT EXISTS embedding vector(1536);
CREATE INDEX IF NOT EXISTS causal_memories_embedding_idx ON causal_memories USING ivfflat (embedding vector_cosine_ops);

-- Enable RLS
ALTER TABLE causal_memories ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their workspace's causal memories
CREATE POLICY IF NOT EXISTS "Users can access workspace causal memories"
ON causal_memories FOR ALL
USING (workspace_id IN (
  SELECT id FROM workspaces WHERE id = workspace_id
));

-- Grant access
GRANT ALL ON causal_memories TO authenticated;
GRANT ALL ON causal_memories TO anon;
