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

  // Request cancellation (ESC key support)
  cancelRequest: () => ipcRenderer.invoke('cancel-request'),

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

  // Infrastructure Settings
  getInfraConfig: () => ipcRenderer.invoke('get-infra-config'),
  setInfraConfig: (config: {
    massiveApiKey: string;
    polygonApiKey: string;
    telegramBotToken: string;
    telegramChatId: string;
    dataDrivePath: string;
  }) => ipcRenderer.invoke('set-infra-config', config),
  testDataDrive: (path: string) => ipcRenderer.invoke('test-data-drive', path),
  testPolygonApi: (apiKey: string) => ipcRenderer.invoke('test-polygon-api', apiKey),
  testTelegram: (botToken: string, chatId: string) => ipcRenderer.invoke('test-telegram', botToken, chatId),

  // Data Inventory
  getDataInventory: () => ipcRenderer.invoke('get-data-inventory'),

  // Memory System
  memoryRecall: (query: string, workspaceId: string, options?: any) =>
    ipcRenderer.invoke('memory:recall', query, workspaceId, options),
  memoryFormatForPrompt: (memories: any[]) =>
    ipcRenderer.invoke('memory:formatForPrompt', memories),
  memoryWarmCache: (workspaceId: string) =>
    ipcRenderer.invoke('memory:warmCache', workspaceId),
  memoryDaemonStatus: () =>
    ipcRenderer.invoke('memory:daemon:status'),
  checkMemoryTriggers: (message: string, workspaceId: string) =>
    ipcRenderer.invoke('memory:check-triggers', message, workspaceId),
  getStaleMemories: (workspaceId: string) =>
    ipcRenderer.invoke('memory:get-stale', workspaceId),
  markMemoriesRecalled: (memoryIds: string[]) =>
    ipcRenderer.invoke('memory:mark-recalled', memoryIds),

  // Analysis handlers
  getWarnings: (strategy: string, regimeId: string, workspaceId: string) =>
    ipcRenderer.invoke('analysis:get-warnings', strategy, regimeId, workspaceId),
  tagRegime: (runId: string, startDate: string, endDate: string) =>
    ipcRenderer.invoke('analysis:tag-regime', runId, startDate, endDate),

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
  }) => void) => {
    ipcRenderer.on('tool-progress', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('tool-progress');
  },

  // LLM streaming events (for real-time text streaming)
  onLLMStream: (callback: (data: {
    type: 'chunk' | 'done' | 'error' | 'thinking' | 'cancelled';
    content?: string;
    error?: string;
    timestamp: number;
  }) => void) => {
    ipcRenderer.on('llm-stream', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('llm-stream');
  },

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
  }) => void) => {
    ipcRenderer.on('tool-execution-event', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('tool-execution-event');
  },

  // Claude Code lifecycle events
  onClaudeCodeEvent: (callback: (event: {
    type: 'decision' | 'progress' | 'error' | 'checkpoint' | 'complete' | 'cancelled';
    data: unknown;
  }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('claude-code-event', handler);
    return () => ipcRenderer.removeListener('claude-code-event', handler);
  },

  // Claude Code directive emissions (for real-time UI control)
  onClaudeCodeDirectives: (callback: (event: {
    directives: any[];
    source: string;
    timestamp: number;
  }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('claude-code-directives', handler);
    return () => ipcRenderer.removeListener('claude-code-directives', handler);
  },
  
  // Claude Code execution
  executeClaudeCode: (config: { task: string; context?: string; files?: string[]; timeout?: number }) =>
    ipcRenderer.invoke('claude-code:execute', config),
  
  // Cancel Claude Code execution
  cancelClaudeCode: () => ipcRenderer.invoke('claude-code:cancel'),
  
  // Check Claude Code availability
  checkClaudeCodeAvailability: () => ipcRenderer.invoke('claude-code:check-availability'),

  // Claude Code approval flow
  approveClaudeCodeCommand: (commandId: string) => 
    ipcRenderer.invoke('claude-code:approve', commandId),
  rejectClaudeCodeCommand: (commandId: string) => 
    ipcRenderer.invoke('claude-code:reject', commandId),
  
  // Listen for pending Claude Code commands awaiting approval
  onClaudeCodePending: (callback: (command: {
    id: string;
    task: string;
    context?: string;
    files?: string[];
    parallelHint?: string;
    timestamp: number;
  }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('claude-code-pending', handler);
    return () => ipcRenderer.removeListener('claude-code-pending', handler);
  },

  // Decision override
  overrideRoutingDecision: (decisionId: string, overrideTo: string) => 
    ipcRenderer.invoke('override-routing-decision', { decisionId, overrideTo }),

  // Remove listeners (cleanup)
  removeToolProgressListener: () => ipcRenderer.removeAllListeners('tool-progress'),
  removeLLMStreamListener: () => ipcRenderer.removeAllListeners('llm-stream'),

  // Daemon Management (Night Shift)
  startDaemon: () => ipcRenderer.invoke('daemon:start'),
  stopDaemon: () => ipcRenderer.invoke('daemon:stop'),
  restartDaemon: () => ipcRenderer.invoke('daemon:restart'),
  getDaemonStatus: () => ipcRenderer.invoke('daemon:status'),
  getDaemonLogs: () => ipcRenderer.invoke('daemon:logs'),

  // System Health
  getSystemHealth: () => ipcRenderer.invoke('system:health'),
  panicStop: () => ipcRenderer.invoke('system:panic'),

  // Daemon log streaming
  onDaemonLog: (callback: (log: string) => void) => {
    ipcRenderer.on('daemon-log', (_event, log) => callback(log));
    return () => ipcRenderer.removeAllListeners('daemon-log');
  },

  // Daemon status updates
  onDaemonStatus: (callback: (data: { status: string; pid: number | null; timestamp: number }) => void) => {
    ipcRenderer.on('daemon-status', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('daemon-status');
  },

  // Context Management
  contextGetProtectedCanon: (workspaceId: string) =>
    ipcRenderer.invoke('context-get-protected-canon', workspaceId),
  contextGetBudgetStatus: (
    tier0Content: string,
    tier1Content: string,
    tier2Content: string,
    messages: Array<{ role: string; content: string }>
  ) => ipcRenderer.invoke('context-get-budget-status', tier0Content, tier1Content, tier2Content, messages),
  contextBuildLLMMessages: (params: {
    baseSystemPrompt: string;
    workspaceId: string;
    workingMemory: string;
    retrievedMemories: string;
    conversationHistory: Array<{ role: string; content: string }>;
    newUserMessage: string;
  }) => ipcRenderer.invoke('context-build-llm-messages', params),
  contextClearCanonCache: (workspaceId?: string) =>
    ipcRenderer.invoke('context-clear-canon-cache', workspaceId),

  // Checkpoint Management (Phase 6)
  checkpointStart: (checkpoint: any) => ipcRenderer.invoke('checkpoint:start', checkpoint),
  checkpointUpdate: (id: string, updates: any) => ipcRenderer.invoke('checkpoint:update', { id, updates }),
  checkpointComplete: (id: string) => ipcRenderer.invoke('checkpoint:complete', id),
  checkpointAbandon: (id: string) => ipcRenderer.invoke('checkpoint:abandon', id),
  checkpointGetActive: () => ipcRenderer.invoke('checkpoint:get-active'),
  checkpointGet: (id: string) => ipcRenderer.invoke('checkpoint:get', id),
  checkpointGetRecent: () => ipcRenderer.invoke('checkpoint:get-recent'),
  checkpointDelete: (id: string) => ipcRenderer.invoke('checkpoint:delete', id),
  checkpointClearAll: () => ipcRenderer.invoke('checkpoint:clear-all'),

  // Pattern detection (Phase 7)
  patternDetect: (workspaceId: string, context: string) =>
    ipcRenderer.invoke('pattern:detect', { workspaceId, context }),
  patternGetHistory: (workspaceId: string) =>
    ipcRenderer.invoke('pattern:get-history', { workspaceId }),
  patternDismiss: (patternId: string) =>
    ipcRenderer.invoke('pattern:dismiss', { patternId }),
});

// The ElectronAPI type is defined in src/types/electron.d.ts as a global type
// This ensures all components can see window.electron types without imports
