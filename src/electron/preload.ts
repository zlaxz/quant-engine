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
  
  // API Keys
  getAPIKeys: () => ipcRenderer.invoke('get-api-keys'),
  setAPIKeys: (keys: { gemini: string; openai: string; deepseek: string }) => ipcRenderer.invoke('set-api-keys', keys),
});

// The ElectronAPI type is defined in src/types/electron.d.ts as a global type
// This ensures all components can see window.electron types without imports
