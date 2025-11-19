-- Add run_id and metadata columns to memory_notes table
ALTER TABLE memory_notes
ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES backtest_runs(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- Add index for faster queries on run_id
CREATE INDEX IF NOT EXISTS idx_memory_notes_run_id ON memory_notes(run_id);

-- Add index for workspace queries
CREATE INDEX IF NOT EXISTS idx_memory_notes_workspace_created ON memory_notes(workspace_id, created_at DESC);