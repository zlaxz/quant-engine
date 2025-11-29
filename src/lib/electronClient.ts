/// <reference types="../types/electron" />

/**
 * Hybrid Client - Routes to Electron IPC or Supabase edge functions
 * 
 * Local operations (file I/O, Python) use Electron when available.
 * Database operations always use Supabase edge functions.
 */

import { supabase } from '@/integrations/supabase/client';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electron;

// File Operations
export async function readFile(filePath: string): Promise<{ content: string }> {
  if (isElectron) {
    return window.electron.readFile(filePath);
  }
  
  // Fallback to edge function
  const { data, error } = await supabase.functions.invoke('read-file', {
    body: { path: filePath },
  });
  
  if (error) throw error;
  return data;
}

export async function writeFile(filePath: string, content: string): Promise<{ success: boolean }> {
  if (isElectron) {
    return window.electron.writeFile(filePath, content);
  }
  
  const { data, error } = await supabase.functions.invoke('write-file', {
    body: { path: filePath, content },
  });
  
  if (error) throw error;
  return data;
}

export async function deleteFile(filePath: string): Promise<{ success: boolean }> {
  if (isElectron) {
    return window.electron.deleteFile(filePath);
  }
  
  throw new Error('deleteFile is only available in Electron environment');
}

export async function listDir(dirPath: string): Promise<{ entries: Array<{ name: string; type: 'file' | 'directory' }> }> {
  if (isElectron) {
    return window.electron.listDir(dirPath);
  }
  
  const { data, error } = await supabase.functions.invoke('list-dir', {
    body: { path: dirPath },
  });
  
  if (error) throw error;
  return data;
}

export async function searchCode(query: string, dirPath?: string): Promise<{ results: Array<{ file: string; line: number; context: string }> }> {
  if (isElectron) {
    const result = await window.electron.searchCode(query, dirPath);
    // Transform Electron response (content) to match edge function format (context)
    return {
      results: result.results.map(r => ({ file: r.file, line: r.line, context: (r as any).content || (r as any).context }))
    };
  }
  
  const { data, error } = await supabase.functions.invoke('search-code', {
    body: { query, path: dirPath },
  });
  
  if (error) throw error;
  return data;
}

// ==================== QUANT ENGINE API ====================
// Python server URL - matches toolHandlers.ts
const QUANT_ENGINE_URL = 'http://localhost:5000';

// Type definitions for Quant Engine API
export interface RegimeData {
  date: string;
  regime: string;
  regime_id: number;
  confidence: number;
  metrics: {
    rv5?: number;
    rv20?: number;
    close?: number;
    trend?: 'up' | 'down';
  };
  description: string;
}

export interface RegimeHeatmapResponse {
  success: boolean;
  data?: RegimeData[];
  count?: number;
  date_range?: { start: string; end: string };
  error?: string;
}

export interface StrategyPerformance {
  sharpe: number;
  max_drawdown: number;
  win_rate: number;
  avg_return: number;
  recommended_allocation: number;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  risk_level: 'low' | 'medium' | 'high';
  optimal_regimes: string[];
  instruments: string[];
  performance?: StrategyPerformance;
  current_allocation?: number;
  signal?: 'BUY' | 'HOLD' | 'REDUCE' | 'AVOID';
}

export interface StrategyListResponse {
  success: boolean;
  strategies?: Array<{ id: string; name: string; risk_level: string; description: string }>;
  count?: number;
  error?: string;
}

export interface StrategyCardResponse {
  success: boolean;
  strategy?: Strategy;
  error?: string;
}

export interface SimulationImpact {
  portfolio_pnl_pct: number;
  by_strategy: Record<string, { allocation: number; pnl_pct: number; sensitivity?: number }>;
  greeks_impact?: Record<string, number>;
  recommendations: string[];
  stress_level: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface SimulationResponse {
  success: boolean;
  scenario?: string;
  params?: Record<string, unknown>;
  impact?: SimulationImpact;
  error?: string;
}

export interface BacktestResponse {
  success: boolean;
  metrics?: Record<string, number>;
  equity_curve?: Array<{ date: string; value: number; drawdown?: number }>;
  trades?: unknown[];
  engine_source?: string;
  error?: string;
}

// Fetch regime heatmap data
export async function fetchRegimeHeatmap(
  startDate?: string,
  endDate?: string
): Promise<RegimeHeatmapResponse> {
  try {
    // Build query string
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);

    const queryString = params.toString();
    const url = `${QUANT_ENGINE_URL}/regimes${queryString ? `?${queryString}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Server error (${response.status}): ${errorText}` };
    }

    return await response.json();
  } catch (error: unknown) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return { success: false, error: 'Request timed out' };
    }
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      return { success: false, error: `Quant Engine not running at ${QUANT_ENGINE_URL}` };
    }
    return { success: false, error: `Request failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

// List all available strategies
export async function fetchStrategies(): Promise<StrategyListResponse> {
  try {
    const response = await fetch(`${QUANT_ENGINE_URL}/strategies`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Server error (${response.status}): ${errorText}` };
    }

    return await response.json();
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      return { success: false, error: `Quant Engine not running at ${QUANT_ENGINE_URL}` };
    }
    return { success: false, error: `Request failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

// Get strategy details by ID
export async function fetchStrategyDetails(strategyId: string): Promise<StrategyCardResponse> {
  try {
    const response = await fetch(`${QUANT_ENGINE_URL}/strategies/${strategyId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (response.status === 404) {
      return { success: false, error: `Strategy not found: ${strategyId}` };
    }

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Server error (${response.status}): ${errorText}` };
    }

    return await response.json();
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      return { success: false, error: `Quant Engine not running at ${QUANT_ENGINE_URL}` };
    }
    return { success: false, error: `Request failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

// Run scenario simulation
export async function runSimulation(scenario: {
  scenario: 'vix_shock' | 'price_drop' | 'vol_crush';
  params?: Record<string, number>;
  portfolio?: Record<string, number>;
}): Promise<SimulationResponse> {
  try {
    const response = await fetch(`${QUANT_ENGINE_URL}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scenario),
      signal: AbortSignal.timeout(60000), // 60 second timeout for complex simulations
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Server error (${response.status}): ${errorText}` };
    }

    return await response.json();
  } catch (error: unknown) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return { success: false, error: 'Simulation timed out' };
    }
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      return { success: false, error: `Quant Engine not running at ${QUANT_ENGINE_URL}` };
    }
    return { success: false, error: `Simulation failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

// Run backtest via Quant Engine API (new HTTP-based implementation)
export async function runQuantBacktest(params: {
  strategyKey: string;
  startDate: string;
  endDate: string;
  capital?: number;
  config?: Record<string, unknown>;
}): Promise<BacktestResponse> {
  try {
    const response = await fetch(`${QUANT_ENGINE_URL}/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strategy_key: params.strategyKey,
        params: {
          startDate: params.startDate,
          endDate: params.endDate,
          capital: params.capital || 100000,
        },
        config: params.config,
      }),
      signal: AbortSignal.timeout(300000), // 5 minute timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Backtest server error (${response.status}): ${errorText}` };
    }

    return await response.json();
  } catch (error: unknown) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return { success: false, error: 'Backtest timed out after 5 minutes' };
    }
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      return { success: false, error: `Quant Engine not running at ${QUANT_ENGINE_URL}. Start with: cd python && python server.py` };
    }
    return { success: false, error: `Backtest failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

// Health check for Quant Engine
export async function checkQuantEngineHealth(): Promise<{
  healthy: boolean;
  version?: string;
  endpoints?: string[];
  error?: string;
}> {
  try {
    const response = await fetch(`${QUANT_ENGINE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { healthy: false, error: `Server returned ${response.status}` };
    }

    const data = await response.json();
    return {
      healthy: data.status === 'healthy',
      version: data.version,
      endpoints: data.endpoints,
    };
  } catch {
    return { healthy: false, error: `Quant Engine not reachable at ${QUANT_ENGINE_URL}` };
  }
}

// Legacy Python Execution (kept for backward compatibility)
export async function runBacktest(params: {
  strategyKey: string;
  startDate: string;
  endDate: string;
  capital: number;
  profileConfig?: Record<string, unknown>;
}): Promise<{
  success: boolean;
  metrics?: Record<string, number>;
  equityCurve?: Array<{ date: string; value: number }>;
  trades?: unknown[];
  rawResultsPath?: string;
  error?: string;
}> {
  if (isElectron) {
    return window.electron.runBacktest(params);
  }

  // Fallback to edge function (which may use bridge server or stub)
  const { data, error } = await supabase.functions.invoke('backtest-run', {
    body: params,
  });

  if (error) throw error;
  return data;
}

// LLM Operations - all calls route through Electron IPC when available
export async function chatPrimary(messages: Array<{ role: string; content: string }>): Promise<{ content: string; provider: string; model: string }> {
  if (isElectron && window.electron) {
    try {
      return await window.electron.chatPrimary(messages);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`LLM call failed: ${errorMsg}`);
    }
  }

  // Fallback to edge function for web-only deployment (not supported yet)
  throw new Error('Chat not available in web mode');
}

export async function chatSwarm(messages: Array<{ role: string; content: string }>): Promise<{ content: string; provider: string; model: string }> {
  if (isElectron) {
    try {
      return await window.electron.chatSwarm(messages);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`LLM call failed: ${errorMsg}`);
    }
  }
  
  const { data, error } = await supabase.functions.invoke('chat-swarm', {
    body: { messages },
  });
  
  if (error) throw new Error(`LLM call failed: ${error.message}`);
  return data;
}

export async function chatSwarmParallel(prompts: Array<{ agentId: string; messages: Array<{ role: string; content: string }> }>): Promise<Array<{ agentId: string; content: string }>> {
  if (isElectron) {
    try {
      return await window.electron.chatSwarmParallel(prompts);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`LLM call failed: ${errorMsg}`);
    }
  }
  
  const { data, error } = await supabase.functions.invoke('chat-swarm-parallel', {
    body: { prompts },
  });
  
  if (error) throw new Error(`LLM call failed: ${error.message}`);
  return data;
}

export async function helperChat(messages: Array<{ role: string; content: string }>): Promise<{ content: string }> {
  if (isElectron) {
    try {
      return await window.electron.helperChat(messages);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Helper chat failed: ${errorMsg}`);
    }
  }
  
  const { data, error } = await supabase.functions.invoke('helper-chat', {
    body: { messages },
  });
  
  if (error) throw new Error(`Helper chat failed: ${error.message}`);
  return data;
}

// Environment
export async function getRotationEngineRoot(): Promise<string> {
  if (isElectron) {
    return window.electron.getRotationEngineRoot();
  }
  
  // Fallback to env variable - must be set in .env
  const root = import.meta.env.VITE_ROTATION_ENGINE_ROOT;
  if (!root) {
    throw new Error('VITE_ROTATION_ENGINE_ROOT environment variable is not set');
  }
  return root;
}

// Helper to check if running in Electron
export function isRunningInElectron(): boolean {
  return !!isElectron;
}
