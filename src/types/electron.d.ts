// Global type declarations for Electron API
// This ensures all components can see the window.electron types
// Updated: 2025-12-03 with ThetaData Terminal support

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
  chatPrimary: (messages: Array<{ role: string; content: string }>) => Promise<{ content: string; provider: string; model: string; cancelled?: boolean }>;
  chatSwarm: (messages: Array<{ role: string; content: string }>) => Promise<{ content: string; provider: string; model: string }>;
  chatSwarmParallel: (prompts: Array<{ agentId: string; messages: Array<{ role: string; content: string }> }>) => Promise<Array<{ agentId: string; content: string }>>;
  helperChat: (messages: Array<{ role: string; content: string }>) => Promise<{ content: string }>;

  // Request cancellation (ESC key support)
  cancelRequest: () => Promise<{ success: boolean }>;
  
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

  // Analysis handlers
  getWarnings: (strategy: string, regimeId: string, workspaceId: string) => Promise<any>;
  tagRegime: (runId: string, startDate: string, endDate: string) => Promise<{ success: boolean; regime?: any; error?: string }>;

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
    type: 'chunk' | 'done' | 'error' | 'thinking' | 'cancelled' | 'clear-hallucinated';
    content?: string;
    error?: string;
    timestamp: number;
  }) => void) => () => void;

  // Tool execution events (for detailed tool call tree visibility)
  onToolExecutionEvent: (callback: (event: {
    type: 'tool-start' | 'tool-complete' | 'tool-error';
    tool: string;
    args: Record<string, any>;
    result?: any;
    error?: string;
    timestamp: number;
    duration?: number;
    whyThis?: string;
    whatFound?: string;
  }) => void) => () => void;

  // Claude Code lifecycle events (for transparency components)
  onClaudeCodeEvent: (callback: (event: {
    type: 'decision' | 'progress' | 'error' | 'checkpoint' | 'complete' | 'cancelled';
    data: unknown;
  }) => void) => () => void;

  // Claude Code directive emissions (real-time UI control from Claude Code output)
  onClaudeCodeDirectives: (callback: (event: {
    directives: any[];
    source: string;
    timestamp: number;
    rawOutput: string;
  }) => void) => () => void;
  
  // Claude Code execution
  executeClaudeCode: (config: {
    task: string;
    context?: string;
    files?: string[];
    timeout?: number;
  }) => Promise<{
    success: boolean;
    output?: string;
    files?: Array<{ path: string; content: string }>;
    tests?: { passed: number; failed: number; output?: string };
    error?: string;
    duration: number;
  }>;
  
  // Cancel Claude Code execution
  cancelClaudeCode: () => Promise<{ success: boolean; message: string }>;
  
  // Check Claude Code availability
  checkClaudeCodeAvailability: () => Promise<{
    available: boolean;
    version: string | null;
    message: string;
  }>;
  
  // Claude Code approval flow
  approveClaudeCodeCommand: (commandId: string) => Promise<{ success: boolean; error?: string; message?: string }>;
  rejectClaudeCodeCommand: (commandId: string) => Promise<{ success: boolean; error?: string; message?: string }>;
  
  // Listen for pending Claude Code commands awaiting approval
  onClaudeCodePending: (callback: (command: {
    id: string;
    task: string;
    context?: string;
    files?: string[];
    parallelHint?: string;
    timestamp: number;
  }) => void) => () => void;
  
  // Override routing decision (allows user to override Chief Quant's routing choices)
  overrideRoutingDecision: (decisionId: string, overrideTo: string) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;

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

  // Python Server Management
  startPythonServer: () => Promise<{ success: boolean; pid?: number; error?: string }>;
  stopPythonServer: () => Promise<{ success: boolean; error?: string }>;
  restartPythonServer: () => Promise<{ success: boolean; pid?: number; error?: string }>;

  // ThetaData Terminal Management
  getThetaTerminalStatus: () => Promise<{
    status: 'NOT_INSTALLED' | 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR';
    httpPort: number;
    wsPort: number;
    v3Port: number;
    jarExists: boolean;
    credentialsConfigured: boolean;
    responding: boolean;
  }>;
  startThetaTerminal: () => Promise<boolean>;
  stopThetaTerminal: () => Promise<void>;

  // Daemon log streaming
  onDaemonLog: (callback: (log: string) => void) => () => void;

  // Daemon status updates
  onDaemonStatus: (callback: (data: {
    status: 'online' | 'offline' | 'starting' | 'crashed';
    pid: number | null;
    timestamp: number;
  }) => void) => () => void;

  // Context Management
  contextGetProtectedCanon: (workspaceId: string) => Promise<{
    success: boolean;
    canon?: {
      formattedContent: string;
      tokenEstimate: number;
      lessonCount: number;
      ruleCount: number;
    };
    error?: string;
  }>;
  contextGetBudgetStatus: (
    tier0Content: string,
    tier1Content: string,
    tier2Content: string,
    messages: Array<{ role: string; content: string }>
  ) => Promise<{
    success: boolean;
    status?: {
      totalTokens: number;
      maxTokens: number;
      usagePercent: number;
      tierBreakdown: {
        tier0: number;
        tier1: number;
        tier2: number;
        tier3: number;
      };
      needsCompression: boolean;
      needsSummarization: boolean;
      atHardLimit: boolean;
    };
    error?: string;
  }>;
  contextBuildLLMMessages: (params: {
    baseSystemPrompt: string;
    workspaceId: string;
    workingMemory: string;
    retrievedMemories: string;
    conversationHistory: Array<{ role: string; content: string }>;
    newUserMessage: string;
  }) => Promise<{
    success: boolean;
    messages?: Array<{ role: string; content: string }>;
    status?: {
      totalTokens: number;
      maxTokens: number;
      usagePercent: number;
      needsCompression: boolean;
      needsSummarization: boolean;
      atHardLimit: boolean;
    };
    canonIncluded?: boolean;
    error?: string;
  }>;
  contextClearCanonCache: (workspaceId?: string) => Promise<{ success: boolean; error?: string }>;

  // Checkpoint Management (Phase 6: Working Memory Checkpoints)
  checkpointStart: (checkpoint: any) => Promise<{ success: boolean; checkpointId?: string; error?: string }>;
  checkpointUpdate: (id: string, updates: any) => Promise<{ success: boolean; error?: string }>;
  checkpointComplete: (id: string) => Promise<{ success: boolean; error?: string }>;
  checkpointAbandon: (id: string) => Promise<{ success: boolean; error?: string }>;
  checkpointGetActive: () => Promise<{ success: boolean; checkpoints: any[]; error?: string }>;
  checkpointGet: (id: string) => Promise<{ success: boolean; checkpoint: any | null; error?: string }>;
  checkpointGetRecent: () => Promise<{ success: boolean; checkpoints: any[]; error?: string }>;
  checkpointDelete: (id: string) => Promise<{ success: boolean; error?: string }>;
  checkpointClearAll: () => Promise<{ success: boolean; error?: string }>;

  // Pattern Detection (Phase 7: Contextual Education)
  patternDetect: (
    workspaceId: string,
    context: string
  ) => Promise<{
    pattern: {
      id: string;
      patternType: string;
      title: string;
      description: string;
      occurrences: number;
      lastOccurrence: string;
      failures: Array<{
        date: string;
        runId: string;
        strategyName: string;
        degradation: number;
        details: string;
      }>;
      recommendation: string;
      severity: 'low' | 'medium' | 'high';
    } | null;
    confidence: number;
  }>;
  patternGetHistory: (
    workspaceId: string
  ) => Promise<
    Array<{
      id: string;
      patternType: string;
      title: string;
      description: string;
      occurrences: number;
      lastOccurrence: string;
      failures: Array<{
        date: string;
        runId: string;
        strategyName: string;
        degradation: number;
        details: string;
      }>;
      recommendation: string;
      severity: 'low' | 'medium' | 'high';
      storedAt: string;
    }>
  >;
  patternDismiss: (patternId: string) => Promise<{ success: boolean }>;

  // Pop-out Window Management
  popoutCreate: (config: {
    id: string;
    title: string;
    visualizationType: string;
    data: unknown;
    width?: number;
    height?: number;
  }) => Promise<{ success: boolean; id: string }>;
  popoutUpdate: (id: string, data: unknown) => Promise<{ success: boolean; error?: string }>;
  popoutClose: (id: string) => Promise<{ success: boolean; error?: string }>;
  popoutList: () => Promise<string[]>;
  popoutFocus: (id: string) => Promise<{ success: boolean; error?: string }>;
  popoutBroadcast: (type: string, payload: unknown) => Promise<{ success: boolean; count: number }>;

  // Popout window event listeners (for receiving broadcasts in popout windows)
  onPopoutBroadcast: (callback: (data: { type: string; payload: unknown }) => void) => () => void;
  onPopoutData: (callback: (data: { id: string; visualizationType: string; data: unknown; title: string }) => void) => () => void;
  onPopoutDataUpdate: (callback: (data: { id: string; data: unknown }) => void) => () => void;
  onPopoutClosed: (callback: (data: { id: string }) => void) => () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
