-- Create research_reports table for persisting /auto_analyze outputs
CREATE TABLE IF NOT EXISTS public.research_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  session_id UUID NULL REFERENCES public.chat_sessions(id) ON DELETE SET NULL,
  scope TEXT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for efficient workspace queries
CREATE INDEX IF NOT EXISTS idx_research_reports_workspace_id ON public.research_reports(workspace_id);

-- Create index for scope lookups
CREATE INDEX IF NOT EXISTS idx_research_reports_scope ON public.research_reports(scope);

-- Create index for tag searches using GIN
CREATE INDEX IF NOT EXISTS idx_research_reports_tags ON public.research_reports USING GIN(tags);

-- Create index for chronological queries
CREATE INDEX IF NOT EXISTS idx_research_reports_created_at ON public.research_reports(created_at DESC);

-- Add trigger for automatic updated_at timestamps
CREATE TRIGGER update_research_reports_updated_at
  BEFORE UPDATE ON public.research_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE public.research_reports ENABLE ROW LEVEL SECURITY;

-- Create policy allowing all operations (matching other tables in this workspace)
CREATE POLICY "Allow all operations on research_reports"
  ON public.research_reports
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Add comment explaining table purpose
COMMENT ON TABLE public.research_reports IS 'Stores persistent research reports from /auto_analyze command for later retrieval and analysis';