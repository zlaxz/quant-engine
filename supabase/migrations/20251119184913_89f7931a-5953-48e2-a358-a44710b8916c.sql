-- Add memory_type and importance columns to memory_notes
-- These allow structured, prioritized quant memory

-- Add memory_type column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'memory_notes' 
    AND column_name = 'memory_type'
  ) THEN
    ALTER TABLE public.memory_notes 
    ADD COLUMN memory_type text DEFAULT 'insight';
  END IF;
END $$;

-- Add importance column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'memory_notes' 
    AND column_name = 'importance'
  ) THEN
    ALTER TABLE public.memory_notes 
    ADD COLUMN importance text DEFAULT 'normal';
  END IF;
END $$;

-- Create indexes for efficient filtering
CREATE INDEX IF NOT EXISTS memory_notes_type_idx 
ON public.memory_notes(memory_type);

CREATE INDEX IF NOT EXISTS memory_notes_importance_idx 
ON public.memory_notes(importance);

-- Create composite index for workspace + type + importance filtering
CREATE INDEX IF NOT EXISTS memory_notes_workspace_type_importance_idx 
ON public.memory_notes(workspace_id, memory_type, importance);

-- Add helpful comment
COMMENT ON COLUMN public.memory_notes.memory_type IS 
'Type of memory: insight, rule, warning, todo, bug, profile_change';

COMMENT ON COLUMN public.memory_notes.importance IS 
'Importance level: low, normal, high, critical';
