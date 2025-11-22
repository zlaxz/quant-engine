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

export async function searchCode(query: string, dirPath?: string): Promise<{ results: Array<{ file: string; line: number; content: string }> }> {
  if (isElectron) {
    return window.electron.searchCode(query, dirPath);
  }
  
  const { data, error } = await supabase.functions.invoke('search-code', {
    body: { query, path: dirPath },
  });
  
  if (error) throw error;
  return data;
}

// Python Execution
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

// LLM Operations - can optionally use Electron for lower latency
export async function chatPrimary(messages: Array<{ role: string; content: string }>): Promise<{ content: string; provider: string; model: string }> {
  if (isElectron) {
    // Use direct API call via Electron
    return window.electron.chatPrimary(messages);
  }
  
  // Use edge function
  const { data, error } = await supabase.functions.invoke('chat-primary', {
    body: { messages },
  });
  
  if (error) throw error;
  return data;
}

export async function chatSwarm(messages: Array<{ role: string; content: string }>): Promise<{ content: string; provider: string; model: string }> {
  if (isElectron) {
    return window.electron.chatSwarm(messages);
  }
  
  const { data, error } = await supabase.functions.invoke('chat-swarm', {
    body: { messages },
  });
  
  if (error) throw error;
  return data;
}

export async function chatSwarmParallel(prompts: Array<{ agentId: string; messages: Array<{ role: string; content: string }> }>): Promise<Array<{ agentId: string; content: string }>> {
  if (isElectron) {
    return window.electron.chatSwarmParallel(prompts);
  }
  
  const { data, error } = await supabase.functions.invoke('chat-swarm-parallel', {
    body: { prompts },
  });
  
  if (error) throw error;
  return data;
}

export async function helperChat(messages: Array<{ role: string; content: string }>): Promise<{ content: string }> {
  if (isElectron) {
    return window.electron.helperChat(messages);
  }
  
  const { data, error } = await supabase.functions.invoke('helper-chat', {
    body: { messages },
  });
  
  if (error) throw error;
  return data;
}

// Environment
export async function getRotationEngineRoot(): Promise<string> {
  if (isElectron) {
    return window.electron.getRotationEngineRoot();
  }
  
  // Fallback to env variable
  return import.meta.env.VITE_ROTATION_ENGINE_ROOT || '/Users/zstoc/rotation-engine';
}

// Helper to check if running in Electron
export function isRunningInElectron(): boolean {
  return !!isElectron;
}
