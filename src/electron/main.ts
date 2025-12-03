// Load .env FIRST before any other imports that might use env vars
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
// In dev: __dirname is src/electron, so go up 2 levels
// In prod: __dirname is dist-electron, so also go up 2 levels (or 1 if bundled differently)
const possibleEnvPaths = [
  path.resolve(__dirname, '../../.env'),      // From src/electron or dist-electron
  path.resolve(__dirname, '../.env'),         // One level up
  path.resolve(process.cwd(), '.env'),        // Current working directory
];

let envLoaded = false;
for (const envPath of possibleEnvPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    console.log('[Main] Loaded .env from:', envPath);
    envLoaded = true;
    break;
  }
}
if (!envLoaded) {
  console.warn('[Main] Could not find .env file, tried:', possibleEnvPaths);
}
console.log('[Main] VITE_SUPABASE_URL:', process.env.VITE_SUPABASE_URL ? 'SET' : 'NOT SET');

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import fs from 'fs';
import os from 'os';
import Store from 'electron-store';
import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import { registerFileOperationHandlers } from './ipc-handlers/fileOperations';
import { registerPythonExecutionHandlers } from './ipc-handlers/pythonExecution';
import { registerLlmHandlers } from './ipc-handlers/llmClient';
import { registerMemoryHandlers, setMemoryServices, registerAnalysisHandlers } from './ipc-handlers/memoryHandlers';
import { registerDaemonHandlers, stopDaemonOnExit } from './ipc-handlers/daemonManager';
import { registerContextHandlers } from './ipc-handlers/contextHandlers';
import { registerDecisionHandlers } from './ipc-handlers/decisionHandlers';
import { registerClaudeCodeHandlers } from './ipc-handlers/claudeCodeHandlers';
import { setupCheckpointHandlers } from './ipc-handlers/checkpoints';
import { setupPatternHandlers } from './ipc-handlers/patterns';
import { registerPopoutHandlers, setMainWindowRef, closeAllPopouts } from './ipc-handlers/popoutWindows';
import { setFileSystemRoot, addAllowedPath } from './services/FileSystemService';
import { MemoryDaemon } from './memory/MemoryDaemon';
import { RecallEngine } from './memory/RecallEngine';
import { OverfittingDetector } from './analysis/overfittingDetector';
import { RegimeTagger } from './analysis/regimeTagger';
import { WarningSystem } from './analysis/warningSystem';
import { PatternDetector } from './analysis/patternDetector';
import { StaleMemoryInjector } from './memory/staleMemoryInjector';
import { TriggerRecall } from './memory/triggerRecall';
import { initClaudeCodeResultWatcher } from './ipc-handlers/claudeCodeResultWatcher';
import OpenAI from 'openai';

// __filename and __dirname already defined at top of file for dotenv

// Initialize electron-store for persistent settings
const store = new Store<{
  projectDirectory?: string;
  'apiKeys.gemini'?: string;
  'apiKeys.openai'?: string;
  'apiKeys.deepseek'?: string;
  // Infrastructure settings
  'infra.massiveApiKey'?: string;
  'infra.polygonApiKey'?: string;
  'infra.telegramBotToken'?: string;
  'infra.telegramChatId'?: string;
  'infra.dataDrivePath'?: string;
  // Supabase configuration
  'supabase.url'?: string;
  'supabase.anonKey'?: string;
}>();

let mainWindow: BrowserWindow | null = null;
let memoryDaemon: MemoryDaemon | null = null;
let localDb: Database.Database | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Disabled to allow Supabase API calls from file:// origin
      webSecurity: false, // Allow cross-origin requests from file:// protocol
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // In development, load from Vite dev server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:8080');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from built files
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Validate Python environment - checks if launchd-managed server is running
async function validatePythonEnvironment(): Promise<{ valid: boolean; error?: string }> {
  const PYTHON_SERVER_URL = 'http://localhost:5001';

  // Check if Python server is reachable (managed by launchd)
  try {
    const response = await fetch(`${PYTHON_SERVER_URL}/health`, {
      signal: AbortSignal.timeout(3000)
    });
    if (response.ok) {
      const data = await response.json();
      console.log(`[Validation] Python server healthy: v${data.version}`);
      return { valid: true };
    }
  } catch {
    // Server not responding - warn but don't block app startup
    console.warn('[Validation] Python server not responding on port 5001');
    console.warn('[Validation] Backtests will not work until server is started');
    console.warn('[Validation] The server should be managed by launchd (com.quantengine.server)');
  }

  // Return valid but log warning - don't block app startup for server issues
  return { valid: true };
}

app.whenReady().then(() => {
  // Initialize project directory from store or environment variable
  const savedDirectory = store.get('projectDirectory');
  if (savedDirectory) {
    process.env.ROTATION_ENGINE_ROOT = savedDirectory;
    // Initialize FileSystemService with root path
    setFileSystemRoot(savedDirectory);
  }

  // Add data drive to allowed paths for agent access
  const savedDataDrive = store.get('infra.dataDrivePath');
  const dataDrivePath = savedDataDrive || '/Volumes/VelocityData';
  if (fs.existsSync(dataDrivePath)) {
    addAllowedPath(dataDrivePath);
    console.log(`[Main] Added data drive to allowed paths: ${dataDrivePath}`);
  } else {
    console.log(`[Main] Data drive not found: ${dataDrivePath} (will add when available)`);
  }

  // Initialize API keys from store
  const savedGemini = store.get('apiKeys.gemini');
  const savedOpenai = store.get('apiKeys.openai');
  const savedDeepseek = store.get('apiKeys.deepseek');
  if (savedGemini) process.env.GEMINI_API_KEY = savedGemini;
  if (savedOpenai) process.env.OPENAI_API_KEY = savedOpenai;
  if (savedDeepseek) process.env.DEEPSEEK_API_KEY = savedDeepseek;

  // Initialize Supabase credentials from environment or stored config
  // Load from .env file or electron-store, never hardcode
  const savedSupabaseUrl = store.get('supabase.url') || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const savedSupabaseKey = store.get('supabase.anonKey') || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (savedSupabaseUrl) process.env.SUPABASE_URL = savedSupabaseUrl;
  if (savedSupabaseKey) process.env.SUPABASE_ANON_KEY = savedSupabaseKey;

  // Warn if Supabase not configured (but don't crash - app may work in limited mode)
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.warn('Supabase credentials not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env');
  }

  // Register project directory IPC handlers
  ipcMain.handle('get-project-directory', () => {
    return store.get('projectDirectory') || process.env.ROTATION_ENGINE_ROOT || null;
  });

  ipcMain.handle('set-project-directory', async (_event, dirPath: string) => {
    // Validate directory exists
    if (!fs.existsSync(dirPath)) {
      throw new Error('Directory does not exist');
    }

    // Validate it's a directory
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory');
    }

    store.set('projectDirectory', dirPath);
    process.env.ROTATION_ENGINE_ROOT = dirPath;
    // Update FileSystemService root
    setFileSystemRoot(dirPath);
    return { success: true };
  });

  ipcMain.handle('pick-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Project Directory',
      message: 'Choose your rotation-engine repository directory',
    });
    return result.filePaths[0] || null;
  });

  ipcMain.handle('create-default-project-directory', async () => {
    try {
      const homeDir = os.homedir();
      const defaultPath = path.join(homeDir, 'quant-projects');
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(defaultPath)) {
        fs.mkdirSync(defaultPath, { recursive: true });
      }

      return { success: true, path: defaultPath };
    } catch (error: any) {
      throw new Error(`Failed to create default directory: ${error.message}`);
    }
  });

  // API Keys handlers
  ipcMain.handle('get-api-keys', () => {
    return {
      gemini: store.get('apiKeys.gemini') || '',
      openai: store.get('apiKeys.openai') || '',
      deepseek: store.get('apiKeys.deepseek') || '',
    };
  });

  ipcMain.handle('set-api-keys', (_event, keys: { gemini: string; openai: string; deepseek: string }) => {
    try {
      store.set('apiKeys.gemini', keys.gemini);
      store.set('apiKeys.openai', keys.openai);
      store.set('apiKeys.deepseek', keys.deepseek);

      // Update environment variables for edge functions
      if (keys.gemini) process.env.GEMINI_API_KEY = keys.gemini;
      if (keys.openai) process.env.OPENAI_API_KEY = keys.openai;
      if (keys.deepseek) process.env.DEEPSEEK_API_KEY = keys.deepseek;

      return { success: true };
    } catch (error: any) {
      console.error('[Main] Set API keys error:', error);
      return { success: false, error: error.message };
    }
  });

  // Infrastructure settings handlers
  ipcMain.handle('get-infra-config', () => {
    return {
      massiveApiKey: store.get('infra.massiveApiKey') || '',
      polygonApiKey: store.get('infra.polygonApiKey') || '',
      telegramBotToken: store.get('infra.telegramBotToken') || '',
      telegramChatId: store.get('infra.telegramChatId') || '',
      dataDrivePath: store.get('infra.dataDrivePath') || '/Volumes/VelocityData/market_data',
    };
  });

  ipcMain.handle('set-infra-config', (_event, config: {
    massiveApiKey: string;
    polygonApiKey: string;
    telegramBotToken: string;
    telegramChatId: string;
    dataDrivePath: string;
  }) => {
    try {
      store.set('infra.massiveApiKey', config.massiveApiKey);
      store.set('infra.polygonApiKey', config.polygonApiKey);
      store.set('infra.telegramBotToken', config.telegramBotToken);
      store.set('infra.telegramChatId', config.telegramChatId);
      store.set('infra.dataDrivePath', config.dataDrivePath);

      // Update environment variables
      if (config.massiveApiKey) process.env.AWS_ACCESS_KEY_ID = config.massiveApiKey;
      if (config.polygonApiKey) {
        process.env.POLYGON_API_KEY = config.polygonApiKey;
        process.env.AWS_SECRET_ACCESS_KEY = config.polygonApiKey;
      }
      if (config.dataDrivePath) {
        process.env.DATA_DIR = config.dataDrivePath;
        // Add to allowed paths for agent file access
        if (fs.existsSync(config.dataDrivePath)) {
          addAllowedPath(config.dataDrivePath);
          console.log(`[Main] Added data drive to allowed paths: ${config.dataDrivePath}`);
        }
      }

      return { success: true };
    } catch (error: any) {
      console.error('[Main] Set infra config error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('test-data-drive', async (_event, drivePath: string) => {
    try {
      if (!fs.existsSync(drivePath)) {
        return { success: false, error: 'Path does not exist' };
      }
      const stats = fs.statSync(drivePath);
      if (!stats.isDirectory()) {
        return { success: false, error: 'Path is not a directory' };
      }
      // Count files in directory
      const files = fs.readdirSync(drivePath);
      return { success: true, fileCount: files.length };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('test-polygon-api', async (_event, apiKey: string) => {
    try {
      const response = await fetch(
        `https://api.polygon.io/v2/aggs/ticker/SPY/prev?apiKey=${apiKey}`
      );
      if (response.ok) {
        return { success: true };
      } else {
        const data = await response.json();
        return { success: false, error: data.error || 'API request failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('test-telegram', async (_event, botToken: string, chatId: string) => {
    try {
      const message = '🧪 Test from Quant Chat Workbench';
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: message }),
        }
      );
      const data = await response.json();
      if (data.ok) {
        return { success: true };
      } else {
        return { success: false, error: data.description || 'Telegram API failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-data-inventory', async () => {
    // Stub implementation - returns empty inventory
    return {
      assets: [],
      disk: null
    };
  });

  // Initialize memory system
  const memoryDbPath = path.join(app.getPath('userData'), 'memory.db');
  localDb = new Database(memoryDbPath);

  // Supabase public credentials (anon key is safe to embed)
  const SUPABASE_URL = 'https://ynaqtawyynqikfyranda.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InluYXF0YXd5eW5xaWtmeXJhbmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1NzM5NjMsImV4cCI6MjA3OTE0OTk2M30.VegcJvLluy8toSYqnR7Ufc5jx5XAl1-XeDRl8KbsIIw';

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const recallEngine = new RecallEngine(localDb, supabase);
  memoryDaemon = new MemoryDaemon(localDb, supabase, {
    intervalMs: 30000, // 30 seconds
    minImportance: 0.3,
  });

  // Initialize analysis modules
  const openaiKey = process.env.OPENAI_API_KEY;
  const openaiClient = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

  const overfittingDetector = new OverfittingDetector(supabase, openaiClient);
  const regimeTagger = new RegimeTagger(supabase);
  const warningSystem = new WarningSystem(supabase, openaiClient);
  const patternDetector = new PatternDetector(supabase);
  const staleInjector = new StaleMemoryInjector(supabase);
  const triggerRecall = new TriggerRecall(recallEngine);

  // Register all IPC handlers
  registerFileOperationHandlers();
  registerPythonExecutionHandlers();
  registerLlmHandlers();
  registerDaemonHandlers();
  registerDecisionHandlers();
  registerClaudeCodeHandlers();
  setupCheckpointHandlers();
  setupPatternHandlers();
  registerPopoutHandlers();

  // Connect memory services to handlers BEFORE registering handlers
  setMemoryServices(memoryDaemon, recallEngine);

  // THEN register memory handlers so they have access to services
  registerMemoryHandlers();

  // Register context management handlers
  registerContextHandlers(supabase);

  // Register analysis handlers
  registerAnalysisHandlers(
    overfittingDetector,
    regimeTagger,
    warningSystem,
    patternDetector,
    staleInjector,
    triggerRecall
  );

  // Start memory daemon and wait for it before creating window
  memoryDaemon.start().then(async () => {
    console.log('[Main] Memory daemon started successfully');

    // Initialize Claude Code result watcher
    initClaudeCodeResultWatcher();
    console.log('[Main] Claude Code result watcher initialized');

    // Validate Python environment
    const validation = await validatePythonEnvironment();
    if (!validation.valid) {
      console.error('[Validation] Python environment check failed:', validation.error);
      dialog.showErrorBox(
        'Python Environment Error',
        `${validation.error}\n\nThe app will start but backtests will not work until this is fixed.`
      );
    } else {
      console.log('[Validation] ✅ Python environment ready');
    }
    
    createWindow();
    
    // Set main window reference for popout positioning
    if (mainWindow) {
      setMainWindowRef(mainWindow);
    }
  }).catch(err => {
    console.error('[Main] Failed to start memory daemon:', err);
    // Fall back to creating window even if daemon fails
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', async () => {
  // Close all pop-out windows first
  closeAllPopouts();

  // Stop research daemon (Night Shift)
  stopDaemonOnExit();

  // Stop memory daemon gracefully
  if (memoryDaemon) {
    await memoryDaemon.stop();
  }
  if (localDb) {
    localDb.close();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
