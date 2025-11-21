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
    profileConfig?: Record<string, any>;
  }) => ipcRenderer.invoke('run-backtest', params),

  // LLM operations
  chatPrimary: (messages: any[]) => ipcRenderer.invoke('chat-primary', messages),
  chatSwarm: (messages: any[]) => ipcRenderer.invoke('chat-swarm', messages),
  chatSwarmParallel: (prompts: any[]) => ipcRenderer.invoke('chat-swarm-parallel', prompts),
  helperChat: (messages: any[]) => ipcRenderer.invoke('helper-chat', messages),

  // Environment
  getRotationEngineRoot: () => ipcRenderer.invoke('get-rotation-engine-root'),
});

// Type definition for window.electron
export interface ElectronAPI {
  readFile: (filePath: string) => Promise<{ content: string }>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>;
  deleteFile: (filePath: string) => Promise<{ success: boolean }>;
  listDir: (dirPath: string) => Promise<{ entries: Array<{ name: string; type: 'file' | 'directory' }> }>;
  searchCode: (query: string, dirPath?: string) => Promise<{ results: any[] }>;
  runBacktest: (params: any) => Promise<any>;
  chatPrimary: (messages: any[]) => Promise<{ content: string; provider: string; model: string }>;
  chatSwarm: (messages: any[]) => Promise<{ content: string; provider: string; model: string }>;
  chatSwarmParallel: (prompts: any[]) => Promise<any[]>;
  helperChat: (messages: any[]) => Promise<{ content: string }>;
  getRotationEngineRoot: () => Promise<string>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
