/**
 * Process Guardian - Daemon Manager for Night Shift
 *
 * Spawns research_daemon.py as a child process with:
 * - Auto-restart on crash (5s delay)
 * - Log streaming to renderer
 * - Health monitoring
 *
 * Created: 2025-11-24
 */

import { ipcMain, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

// Daemon state
let daemonProcess: ChildProcess | null = null;
let daemonPid: number | null = null;
let autoRestartEnabled = true;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_DELAY_MS = 5000;

// Log buffer for UI
const logBuffer: string[] = [];
const MAX_LOG_LINES = 500;

function getRotationEngineRoot(): string {
  const root = process.env.ROTATION_ENGINE_ROOT;
  if (!root) {
    throw new Error('No project directory configured. Go to Settings to set one.');
  }
  return root;
}

function addLog(line: string) {
  const timestamp = new Date().toISOString().slice(11, 19);
  const logLine = `[${timestamp}] ${line}`;
  logBuffer.push(logLine);
  if (logBuffer.length > MAX_LOG_LINES) {
    logBuffer.shift();
  }

  // Stream to renderer
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win) => {
    win.webContents.send('daemon-log', logLine);
  });
}

function sendStatusUpdate(status: 'online' | 'offline' | 'starting' | 'crashed') {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win) => {
    win.webContents.send('daemon-status', {
      status,
      pid: daemonPid,
      timestamp: Date.now(),
    });
  });
}

async function startDaemon(): Promise<{ success: boolean; pid?: number; error?: string }> {
  if (daemonProcess && !daemonProcess.killed) {
    return { success: false, error: 'Daemon already running' };
  }

  try {
    const engineRoot = getRotationEngineRoot();
    const daemonPath = path.join(engineRoot, 'daemon.py');  // Python backend daemon

    // Verify daemon script exists
    if (!fs.existsSync(daemonPath)) {
      return { success: false, error: `Daemon not found: ${daemonPath}` };
    }

    addLog('Starting Night Shift daemon...');
    sendStatusUpdate('starting');

    daemonProcess = spawn('python3', [daemonPath], {
      cwd: engineRoot,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1', // Real-time output
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    daemonPid = daemonProcess.pid || null;
    restartAttempts = 0;

    // Stream stdout
    daemonProcess.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach((line: string) => addLog(`[OUT] ${line}`));
    });

    // Stream stderr
    daemonProcess.stderr?.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach((line: string) => addLog(`[ERR] ${line}`));
    });

    // Handle exit
    daemonProcess.on('exit', (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      addLog(`Daemon exited with ${reason}`);
      daemonProcess = null;
      daemonPid = null;

      // Skip auto-restart if we're in the middle of a manual restart operation
      if (isRestarting) {
        addLog('Exit during restart operation - skipping auto-restart');
        sendStatusUpdate('offline');
        return;
      }

      if (code !== 0 && autoRestartEnabled && restartAttempts < MAX_RESTART_ATTEMPTS) {
        sendStatusUpdate('crashed');
        restartAttempts++;
        addLog(`Auto-restart attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS} in ${RESTART_DELAY_MS / 1000}s...`);
        setTimeout(() => {
          // Double-check we're not in a restart operation
          if (!isRestarting) {
            startDaemon();
          }
        }, RESTART_DELAY_MS);
      } else {
        sendStatusUpdate('offline');
        if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
          addLog('Max restart attempts reached. Manual intervention required.');
        }
      }
    });

    // Handle spawn error
    daemonProcess.on('error', (err) => {
      addLog(`Spawn error: ${err.message}`);
      daemonProcess = null;
      daemonPid = null;
      sendStatusUpdate('crashed');
    });

    addLog(`Night Shift started (PID: ${daemonPid})`);
    sendStatusUpdate('online');

    return { success: true, pid: daemonPid || undefined };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    addLog(`Failed to start daemon: ${errorMsg}`);
    sendStatusUpdate('offline');
    return { success: false, error: errorMsg };
  }
}

async function stopDaemon(): Promise<{ success: boolean; error?: string }> {
  autoRestartEnabled = false; // Disable auto-restart when manually stopping

  if (!daemonProcess) {
    return { success: true }; // Already stopped
  }

  try {
    addLog('Stopping Night Shift...');

    // Send SIGTERM for graceful shutdown
    daemonProcess.kill('SIGTERM');

    // Wait for exit (max 10s)
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (daemonProcess && !daemonProcess.killed) {
          addLog('Force killing daemon (SIGKILL)...');
          daemonProcess.kill('SIGKILL');
        }
        resolve();
      }, 10000);

      daemonProcess?.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    daemonProcess = null;
    daemonPid = null;
    addLog('Night Shift stopped');
    sendStatusUpdate('offline');

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    addLog(`Error stopping daemon: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// Flag to prevent race conditions during restart
let isRestarting = false;

async function restartDaemon(): Promise<{ success: boolean; pid?: number; error?: string }> {
  // Prevent concurrent restart attempts
  if (isRestarting) {
    return { success: false, error: 'Restart already in progress' };
  }

  isRestarting = true;

  try {
    // Disable auto-restart during manual restart to prevent race
    autoRestartEnabled = false;

    // Stop and wait for complete cleanup
    const stopResult = await stopDaemon();
    if (!stopResult.success) {
      addLog(`Warning: Stop returned error: ${stopResult.error}`);
    }

    // Small delay to ensure process cleanup
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Reset state and re-enable auto-restart
    autoRestartEnabled = true;
    restartAttempts = 0;

    return startDaemon();
  } finally {
    isRestarting = false;
  }
}

function getDaemonStatus(): {
  running: boolean;
  pid: number | null;
  autoRestart: boolean;
  restartAttempts: number;
} {
  return {
    running: daemonProcess !== null && !daemonProcess.killed,
    pid: daemonPid,
    autoRestart: autoRestartEnabled,
    restartAttempts,
  };
}

function getDaemonLogs(): string[] {
  return [...logBuffer];
}

async function getSystemHealth(): Promise<{
  daemon: boolean;
  dataDrive: boolean;
  api: boolean;
  bridge: boolean;
}> {
  // Check daemon
  const daemonRunning = daemonProcess !== null && !daemonProcess.killed;

  // Check data drive
  const dataDrivePath = process.env.DATA_DIR || '/Volumes/VelocityData';
  const dataDriveExists = fs.existsSync(dataDrivePath);

  // Check API key
  const apiKeySet = !!(
    process.env.POLYGON_API_KEY ||
    process.env.AWS_ACCESS_KEY_ID
  );

  // Check bridge (attempt connection to localhost:8080)
  let bridgeRunning = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch('http://localhost:8080/health', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    bridgeRunning = response.ok;
  } catch {
    bridgeRunning = false;
  }

  return {
    daemon: daemonRunning,
    dataDrive: dataDriveExists,
    api: apiKeySet,
    bridge: bridgeRunning,
  };
}

async function panicStop(): Promise<{ success: boolean; error?: string }> {
  addLog('!!! PANIC STOP INITIATED !!!');

  // Stop daemon
  autoRestartEnabled = false;
  if (daemonProcess) {
    daemonProcess.kill('SIGKILL');
    daemonProcess = null;
    daemonPid = null;
  }

  // TODO: Close shadow positions via Supabase
  addLog('Shadow positions should be manually reviewed');

  sendStatusUpdate('offline');
  return { success: true };
}

export function registerDaemonHandlers() {
  ipcMain.handle('daemon:start', async () => {
    return startDaemon();
  });

  ipcMain.handle('daemon:stop', async () => {
    return stopDaemon();
  });

  ipcMain.handle('daemon:restart', async () => {
    return restartDaemon();
  });

  ipcMain.handle('daemon:status', () => {
    return getDaemonStatus();
  });

  ipcMain.handle('daemon:logs', () => {
    return getDaemonLogs();
  });

  ipcMain.handle('system:health', async () => {
    return getSystemHealth();
  });

  ipcMain.handle('system:panic', async () => {
    return panicStop();
  });
}

// Export for main.ts cleanup - synchronous cleanup on app exit
export function stopDaemonOnExit() {
  if (!daemonProcess) return;

  autoRestartEnabled = false;
  const pid = daemonPid;

  // Try graceful SIGTERM first
  try {
    daemonProcess.kill('SIGTERM');
  } catch (error) {
    console.error('[DaemonManager] SIGTERM failed:', error);
  }

  // Force kill after 3 seconds if still running
  setTimeout(() => {
    if (daemonProcess && !daemonProcess.killed) {
      console.log('[DaemonManager] Process still running, sending SIGKILL');
      try {
        daemonProcess.kill('SIGKILL');
      } catch (error) {
        console.error('[DaemonManager] SIGKILL failed:', error);

        // Last resort: kill by PID directly if we have it
        if (pid) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch (e) {
            console.error(`[DaemonManager] Direct PID kill failed: ${e}`);
          }
        }
      }
    }
  }, 3000);
}
