-- QUANT CHAT WORKBENCH - INITIAL SCHEMA
-- Phase 1: Core tables for workspace, chat, strategies, backtests, and memory
-- 
-- INSTRUCTIONS: Run this SQL in your Supabase SQL Editor
-- (Supabase Dashboard → SQL Editor → New Query → Paste & Run)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- TABLE: workspaces
-- Logical containers for organizing chat sessions and strategies
-- ============================================================================
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    default_system_prompt TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster workspace lookups
CREATE INDEX idx_workspaces_created_at ON workspaces(created_at DESC);

-- ============================================================================
-- TABLE: chat_sessions
-- Individual chat conversations within a workspace
-- ============================================================================
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for chat_sessions
CREATE INDEX idx_chat_sessions_workspace_id ON chat_sessions(workspace_id);
CREATE INDEX idx_chat_sessions_created_at ON chat_sessions(created_at DESC);

-- ============================================================================
-- TABLE: messages
-- Individual messages within a chat session
-- Roles: 'system', 'user', 'assistant', 'tool'
-- ============================================================================
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    model TEXT,
    provider TEXT,
    token_usage JSONB DEFAULT NULL,
    tool_calls JSONB DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for messages
CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);

-- ============================================================================
-- TABLE: strategies
-- Trading strategies that can be backtested
-- ============================================================================
CREATE TABLE strategies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    config JSONB DEFAULT '{}',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for active strategies
CREATE INDEX idx_strategies_active ON strategies(active) WHERE active = TRUE;
CREATE INDEX idx_strategies_key ON strategies(key);

-- ============================================================================
-- TABLE: backtest_runs
-- Records of strategy backtests, optionally linked to chat sessions
-- ============================================================================
CREATE TABLE backtest_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
    strategy_key TEXT NOT NULL,
    params JSONB DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    metrics JSONB DEFAULT NULL,
    equity_curve JSONB DEFAULT NULL,
    raw_results_url TEXT,
    error TEXT
);

-- Indexes for backtest_runs
CREATE INDEX idx_backtest_runs_session_id ON backtest_runs(session_id);
CREATE INDEX idx_backtest_runs_strategy_key ON backtest_runs(strategy_key);
CREATE INDEX idx_backtest_runs_status ON backtest_runs(status);
CREATE INDEX idx_backtest_runs_started_at ON backtest_runs(started_at DESC);

-- ============================================================================
-- TABLE: memory_notes
-- User notes and auto-generated insights within a workspace
-- ============================================================================
CREATE TABLE memory_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
    content TEXT NOT NULL,
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for memory_notes
CREATE INDEX idx_memory_notes_workspace_id ON memory_notes(workspace_id);
CREATE INDEX idx_memory_notes_created_at ON memory_notes(created_at DESC);
CREATE INDEX idx_memory_notes_tags ON memory_notes USING GIN(tags);

-- ============================================================================
-- TRIGGER FUNCTIONS: Auto-update updated_at timestamps
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to tables with updated_at
CREATE TRIGGER update_workspaces_updated_at
    BEFORE UPDATE ON workspaces
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chat_sessions_updated_at
    BEFORE UPDATE ON chat_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_strategies_updated_at
    BEFORE UPDATE ON strategies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- SAMPLE DATA (Optional - for development/testing)
-- ============================================================================
-- Insert a default workspace
INSERT INTO workspaces (name, description, default_system_prompt)
VALUES (
    'Default Workspace',
    'Your main quantitative trading workspace',
    'You are a quantitative trading assistant specializing in options strategies and risk analysis.'
);
