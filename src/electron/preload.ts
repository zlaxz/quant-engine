import { contextBridge, ipcRenderer } from 'electron';

// Expose safe IPC methods to renderer
contextBridge.exposeInMainWorld('electron', {
  // File operations
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),
  deleteFile: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
  listDir: (dirPath: string) => ipcRenderer.invoke('list-dir', dirPath),
  searchCode: (query: string, dirPath?: string) => ipcRenderer.invoke('search-code', query, dirPath),

  // Python execution
  runBacktest: (params: {
    strategyKey: string;
    startDate: string;
    endDate: string;
    capital: number;
    profileConfig?: Record<string, unknown>;
  }) => ipcRenderer.invoke('run-backtest', params),

  // LLM operations
  chatPrimary: (messages: Array<{ role: string; content: string }>) => ipcRenderer.invoke('chat-primary', messages),
  chatSwarm: (messages: Array<{ role: string; content: string }>) => ipcRenderer.invoke('chat-swarm', messages),
  chatSwarmParallel: (prompts: Array<{ agentId: string; messages: Array<{ role: string; content: string }> }>) => ipcRenderer.invoke('chat-swarm-parallel', prompts),
  helperChat: (messages: Array<{ role: string; content: string }>) => ipcRenderer.invoke('helper-chat', messages),

  // Environment
  getRotationEngineRoot: () => ipcRenderer.invoke('get-rotation-engine-root'),
  
  // Project directory settings
  getProjectDirectory: () => ipcRenderer.invoke('get-project-directory'),
  setProjectDirectory: (dirPath: string) => ipcRenderer.invoke('set-project-directory', dirPath),
  pickDirectory: () => ipcRenderer.invoke('pick-directory'),
  createDefaultProjectDirectory: () => ipcRenderer.invoke('create-default-project-directory'),
});

// Type definition for window.electron
export interface ElectronAPI {
  readFile: (filePath: string) => Promise<{ content: string }>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>;
  deleteFile: (filePath: string) => Promise<{ success: boolean }>;
  listDir: (dirPath: string) => Promise<{ entries: Array<{ name: string; type: 'file' | 'directory' }> }>;
  searchCode: (query: string, dirPath?: string) => Promise<{ results: Array<{ file: string; line: number; context: string }> }>;
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
  chatPrimary: (messages: Array<{ role: string; content: string }>) => Promise<{ content: string; provider: string; model: string }>;
  chatSwarm: (messages: Array<{ role: string; content: string }>) => Promise<{ content: string; provider: string; model: string }>;
  chatSwarmParallel: (prompts: Array<{ agentId: string; messages: Array<{ role: string; content: string }> }>) => Promise<Array<{ agentId: string; content: string }>>;
  helperChat: (messages: Array<{ role: string; content: string }>) => Promise<{ content: string }>;
  getRotationEngineRoot: () => Promise<string>;
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
