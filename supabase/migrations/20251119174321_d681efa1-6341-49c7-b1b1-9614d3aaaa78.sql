-- Enable Row Level Security on all tables
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_notes ENABLE ROW LEVEL SECURITY;

-- Create permissive policies for all tables (Phase 1 - no authentication yet)
-- WARNING: These allow ALL operations. Update these policies when you add authentication!

-- Workspaces policies
CREATE POLICY "Allow all operations on workspaces" ON workspaces FOR ALL USING (true) WITH CHECK (true);

-- Chat sessions policies
CREATE POLICY "Allow all operations on chat_sessions" ON chat_sessions FOR ALL USING (true) WITH CHECK (true);

-- Messages policies
CREATE POLICY "Allow all operations on messages" ON messages FOR ALL USING (true) WITH CHECK (true);

-- Strategies policies
CREATE POLICY "Allow all operations on strategies" ON strategies FOR ALL USING (true) WITH CHECK (true);

-- Backtest runs policies
CREATE POLICY "Allow all operations on backtest_runs" ON backtest_runs FOR ALL USING (true) WITH CHECK (true);

-- Memory notes policies
CREATE POLICY "Allow all operations on memory_notes" ON memory_notes FOR ALL USING (true) WITH CHECK (true);

-- Fix function search_path issue (just replace without dropping)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;