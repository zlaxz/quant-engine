// Global type declarations for Electron API
// This ensures all components can see the window.electron types
// Updated: 2025-11-22 with new chat API signature and API key support

interface ElectronAPI {
  // File operations
  readFile: (filePath: string) => Promise<{ content: string }>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>;
  deleteFile: (filePath: string) => Promise<{ success: boolean }>;
  listDir: (dirPath: string) => Promise<{ entries: Array<{ name: string; type: 'file' | 'directory' }> }>;
  searchCode: (query: string, dirPath?: string) => Promise<{ results: Array<{ file: string; line: number; context: string }> }>;
  
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
  
  // API Keys
  getAPIKeys: () => Promise<{ gemini: string; openai: string; deepseek: string }>;
  setAPIKeys: (keys: { gemini: string; openai: string; deepseek: string }) => Promise<{ success: boolean }>;

  // Infrastructure Settings
  getInfraConfig: () => Promise<{
    massiveApiKey: string;
    polygonApiKey: string;
    telegramBotToken: string;
    telegramChatId: string;
    dataDrivePath: string;
  }>;
  setInfraConfig: (config: {
    massiveApiKey: string;
    polygonApiKey: string;
    telegramBotToken: string;
    telegramChatId: string;
    dataDrivePath: string;
  }) => Promise<{ success: boolean }>;
  testDataDrive: (path: string) => Promise<{ success: boolean; fileCount?: number; error?: string }>;
  testPolygonApi: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  testTelegram: (botToken: string, chatId: string) => Promise<{ success: boolean; error?: string }>;

  // Data Inventory
  getDataInventory: () => Promise<{
    assets: Array<{
      symbol: string;
      dataType: string;
      startDate: string;
      endDate: string;
      totalDays: number;
      gapCount: number;
      qualityScore: number;
      sizeGB: number;
    }>;
    disk: {
      totalGB: number;
      usedGB: number;
      freeGB: number;
    } | null;
  }>;

  // Memory System
  memoryRecall: (
    query: string,
    workspaceId: string,
    options?: {
      limit?: number;
      minImportance?: number;
      useCache?: boolean;
      rerank?: boolean;
      categories?: string[];
      symbols?: string[];
    }
  ) => Promise<{
    memories: Array<{
      id: string;
      content: string;
      summary: string;
      type: string;
      category: string | null;
      symbols: string[] | null;
      importance: number;
      relevanceScore: number;
      source: string;
      createdAt: string;
    }>;
    totalFound: number;
    searchTimeMs: number;
    usedCache: boolean;
    query: string;
    expandedQueries?: string[];
    error?: string;
  }>;

  memoryFormatForPrompt: (memories: any[]) => Promise<string>;
  memoryWarmCache: (workspaceId: string) => Promise<{ success: boolean; error?: string }>;
  memoryDaemonStatus: () => Promise<{ daemonRunning: boolean; cacheSize: number; totalMemories: number; error?: string }>;
  checkMemoryTriggers: (message: string, workspaceId: string) => Promise<Array<{
    id: string;
    content: string;
    summary: string;
    triggeredBy?: string[];
    importance: number;
  }>>;
  getStaleMemories: (workspaceId: string) => Promise<Array<{
    id: string;
    content: string;
    summary: string;
    protection_level: number;
    financial_impact: number | null;
    last_recalled_at: string | null;
    days_since_recall: number;
  }>>;
  markMemoriesRecalled: (memoryIds: string[]) => Promise<{ success: boolean; error?: string }>;

  // Tool progress events (for real-time tool execution visibility)
  onToolProgress: (callback: (data: {
    type: 'thinking' | 'tools-starting' | 'executing' | 'completed';
    tool?: string;
    args?: Record<string, any>;
    success?: boolean;
    preview?: string;
    count?: number;
    iteration?: number;
    message?: string;
    timestamp: number;
  }) => void) => () => void;

  // LLM streaming events (for real-time text streaming)
  onLLMStream: (callback: (data: {
    type: 'chunk' | 'done' | 'error' | 'thinking';
    content?: string;
    error?: string;
    timestamp: number;
  }) => void) => () => void;

  // Remove listeners (cleanup)
  removeToolProgressListener: () => void;
  removeLLMStreamListener: () => void;

  // Daemon Management (Night Shift)
  startDaemon: () => Promise<{ success: boolean; pid?: number; error?: string }>;
  stopDaemon: () => Promise<{ success: boolean; error?: string }>;
  restartDaemon: () => Promise<{ success: boolean; pid?: number; error?: string }>;
  getDaemonStatus: () => Promise<{
    running: boolean;
    pid: number | null;
    autoRestart: boolean;
    restartAttempts: number;
  }>;
  getDaemonLogs: () => Promise<string[]>;

  // System Health
  getSystemHealth: () => Promise<{
    daemon: boolean;
    dataDrive: boolean;
    api: boolean;
    bridge: boolean;
  }>;
  panicStop: () => Promise<{ success: boolean; error?: string }>;

  // Daemon log streaming
  onDaemonLog: (callback: (log: string) => void) => () => void;

  // Daemon status updates
  onDaemonStatus: (callback: (data: {
    status: 'online' | 'offline' | 'starting' | 'crashed';
    pid: number | null;
    timestamp: number;
  }) => void) => () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
