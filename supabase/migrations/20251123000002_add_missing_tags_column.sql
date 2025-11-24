-- Add missing tags column to memories table
-- This was accidentally omitted from the initial enhanced schema

ALTER TABLE memories ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories USING GIN(tags);
