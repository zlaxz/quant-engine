-- Add notes field to backtest_runs for research annotations
ALTER TABLE public.backtest_runs 
ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN public.backtest_runs.notes IS 
'User notes and observations about this backtest run for research tracking';