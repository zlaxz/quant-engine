// Global type declarations for Electron API
// This ensures all components can see the window.electron types

interface ElectronAPI {
  // File operations
  readFile: (filePath: string) => Promise<{ content: string }>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>;
  deleteFile: (filePath: string) => Promise<{ success: boolean }>;
  listDir: (dirPath: string) => Promise<{ entries: Array<{ name: string; type: 'file' | 'directory' }> }>;
  searchCode: (query: string, dirPath?: string) => Promise<{ results: Array<{ file: string; line: number; content: string }> }>;
  
  // Python execution
  runBacktest: (params: {
    strategyKey: string;
    startDate: string;
    endDate: string;
    capital: number;
    profileConfig?: Record<string, unknown>;
  }) => Promise<{
    success: boolean;
    metrics?: Record<string, number>;
    equityCurve?: Array<{ date: string; value: number }>;
    trades?: unknown[];
    rawResultsPath?: string;
    error?: string;
  }>;
  
  // LLM operations
  chatPrimary: (messages: Array<{ role: string; content: string }>) => Promise<{ content: string; provider: string; model: string }>;
  chatSwarm: (messages: Array<{ role: string; content: string }>) => Promise<{ content: string; provider: string; model: string }>;
  chatSwarmParallel: (prompts: Array<{ agentId: string; messages: Array<{ role: string; content: string }> }>) => Promise<Array<{ agentId: string; content: string }>>;
  helperChat: (messages: Array<{ role: string; content: string }>) => Promise<{ content: string }>;
  
  // Environment
  getRotationEngineRoot: () => Promise<string>;
  
  // Project directory settings
  getProjectDirectory: () => Promise<string | null>;
  setProjectDirectory: (dirPath: string) => Promise<{ success: boolean }>;
  pickDirectory: () => Promise<string | null>;
  createDefaultProjectDirectory: () => Promise<{ success: boolean; path?: string }>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
