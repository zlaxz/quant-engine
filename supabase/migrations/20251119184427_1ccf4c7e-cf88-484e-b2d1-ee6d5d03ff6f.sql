-- Ensure pgvector extension is enabled for embedding storage
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to memory_notes if it doesn't exist
-- Using 1536 dimensions for OpenAI text-embedding-3-small model
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'memory_notes' 
    AND column_name = 'embedding'
  ) THEN
    ALTER TABLE public.memory_notes 
    ADD COLUMN embedding vector(1536);
  END IF;
END $$;

-- Create ivfflat index on embedding column for fast similarity search
-- Using cosine distance operator (<=>)
CREATE INDEX IF NOT EXISTS memory_notes_embedding_idx 
ON public.memory_notes 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create or replace the semantic search function
-- This function takes a query embedding and returns the most similar memory notes
CREATE OR REPLACE FUNCTION public.search_memory_notes(
  query_embedding vector(1536),
  match_workspace_id uuid,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  workspace_id uuid,
  content text,
  source text,
  tags text[],
  created_at timestamptz,
  run_id uuid,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    memory_notes.id,
    memory_notes.workspace_id,
    memory_notes.content,
    memory_notes.source,
    memory_notes.tags,
    memory_notes.created_at,
    memory_notes.run_id,
    memory_notes.metadata,
    1 - (memory_notes.embedding <=> query_embedding) AS similarity
  FROM memory_notes
  WHERE memory_notes.workspace_id = match_workspace_id
    AND memory_notes.embedding IS NOT NULL
    AND 1 - (memory_notes.embedding <=> query_embedding) > match_threshold
  ORDER BY memory_notes.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Add comment explaining the function
COMMENT ON FUNCTION public.search_memory_notes IS 
'Performs semantic search on memory notes using cosine similarity. Returns notes above the similarity threshold, ordered by relevance.';
