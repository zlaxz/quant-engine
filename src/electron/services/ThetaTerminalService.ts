/**
 * ThetaTerminal Auto-Launcher Service
 *
 * Automatically starts the ThetaData Terminal (Java app) when the Electron app launches.
 * Provides live options data with real-time Greeks for execution (Engine B - The Sniper).
 *
 * Features:
 * - Auto-launch on app start
 * - Health monitoring
 * - Graceful shutdown on app close
 * - Credential injection via environment
 */

import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';

const execAsync = promisify(exec);

export enum ThetaTerminalStatus {
  NOT_INSTALLED = 'NOT_INSTALLED',
  STOPPED = 'STOPPED',
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  ERROR = 'ERROR',
}

interface ThetaConfig {
  username: string;
  password: string;
  jarPath: string;
  httpPort: number;
  wsPort: number;
  v3Port: number;
  autoLaunch: boolean;
}

class ThetaTerminalService {
  private static instance: ThetaTerminalService;
  private process: ChildProcess | null = null;
  private status: ThetaTerminalStatus = ThetaTerminalStatus.STOPPED;
  private config: ThetaConfig;
  private startupPromise: Promise<boolean> | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.config = this.loadConfig();
  }

  static getInstance(): ThetaTerminalService {
    if (!ThetaTerminalService.instance) {
      ThetaTerminalService.instance = new ThetaTerminalService();
    }
    return ThetaTerminalService.instance;
  }

  private loadConfig(): ThetaConfig {
    return {
      username: process.env.THETADATA_USERNAME || '',
      password: process.env.THETADATA_PASSWORD || '',
      jarPath: process.env.THETADATA_JAR_PATH || '/Users/zstoc/thetadata/ThetaTerminalv3.jar',
      httpPort: parseInt(process.env.THETADATA_HTTP_PORT || '25510', 10),
      wsPort: parseInt(process.env.THETADATA_WS_PORT || '25520', 10),
      v3Port: parseInt(process.env.THETADATA_V3_PORT || '25503', 10),
      autoLaunch: process.env.THETADATA_AUTO_LAUNCH === 'true',
    };
  }

  /**
   * Check if a port is in use (terminal already running)
   */
  private async isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          resolve(true);
        } else {
          resolve(false);
        }
      });
      server.once('listening', () => {
        server.close();
        resolve(false);
      });
      server.listen(port);
    });
  }

  /**
   * Check if Theta Terminal is responding to HTTP requests
   */
  private async isTerminalResponding(): Promise<boolean> {
    try {
      // Use v3 API on port 25503 - even "No data found" response means terminal is working
      const response = await fetch(`http://localhost:${this.config.v3Port}/v3/option/snapshot/greeks/all?symbol=SPY&expiration=*`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      // 200 = data returned, or plain text "No data found" - both mean it's working
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Find and kill any existing Theta Terminal processes
   */
  private async killExistingProcesses(): Promise<void> {
    try {
      // Find Java processes running ThetaTerminal
      const { stdout } = await execAsync('pgrep -f "ThetaTerminal" || true');
      const pids = stdout.trim().split('\n').filter(Boolean);

      for (const pid of pids) {
        try {
          await execAsync(`kill ${pid}`);
          console.log(`[ThetaTerminal] Killed existing process: ${pid}`);
        } catch {
          // Process may have already exited
        }
      }

      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.log('[ThetaTerminal] No existing processes to kill');
    }
  }

  /**
   * Get current status
   */
  getStatus(): ThetaTerminalStatus {
    return this.status;
  }

  /**
   * Get full status details
   */
  async getStatusDetails(): Promise<{
    status: ThetaTerminalStatus;
    httpPort: number;
    wsPort: number;
    v3Port: number;
    jarExists: boolean;
    credentialsConfigured: boolean;
    responding: boolean;
  }> {
    const jarExists = fs.existsSync(this.config.jarPath);
    const credentialsConfigured = !!(this.config.username && this.config.password);
    const responding = await this.isTerminalResponding();

    // Update status based on response
    if (responding) {
      this.status = ThetaTerminalStatus.RUNNING;
    } else if (this.status === ThetaTerminalStatus.RUNNING) {
      this.status = ThetaTerminalStatus.STOPPED;
    }

    return {
      status: this.status,
      httpPort: this.config.httpPort,
      wsPort: this.config.wsPort,
      v3Port: this.config.v3Port,
      jarExists,
      credentialsConfigured,
      responding,
    };
  }

  /**
   * Start Theta Terminal
   */
  async start(): Promise<boolean> {
    // If already starting, return the existing promise
    if (this.startupPromise) {
      return this.startupPromise;
    }

    // Check if already running
    if (await this.isTerminalResponding()) {
      console.log('[ThetaTerminal] Already running and responding');
      this.status = ThetaTerminalStatus.RUNNING;
      this.startHealthCheck();
      return true;
    }

    // Check prerequisites
    if (!fs.existsSync(this.config.jarPath)) {
      console.error(`[ThetaTerminal] JAR not found at: ${this.config.jarPath}`);
      this.status = ThetaTerminalStatus.NOT_INSTALLED;
      return false;
    }

    if (!this.config.username || !this.config.password) {
      console.error('[ThetaTerminal] Credentials not configured');
      this.status = ThetaTerminalStatus.ERROR;
      return false;
    }

    this.startupPromise = this.doStart();
    const result = await this.startupPromise;
    this.startupPromise = null;
    return result;
  }

  private async doStart(): Promise<boolean> {
    console.log('[ThetaTerminal] Starting Theta Terminal...');
    this.status = ThetaTerminalStatus.STARTING;

    try {
      // Kill any zombie processes
      await this.killExistingProcesses();

      // Check for Java
      try {
        await execAsync('java -version');
      } catch {
        console.error('[ThetaTerminal] Java not found. Please install Java runtime.');
        this.status = ThetaTerminalStatus.ERROR;
        return false;
      }

      // Start the JAR with credentials
      const args = [
        '-jar',
        this.config.jarPath,
        this.config.username,
        this.config.password,
      ];

      console.log(`[ThetaTerminal] Spawning: java ${args.join(' ').replace(this.config.password, '****')}`);

      this.process = spawn('java', args, {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      // Log stdout
      this.process.stdout?.on('data', (data: Buffer) => {
        const output = data.toString().trim();
        if (output) {
          console.log(`[ThetaTerminal] ${output}`);
        }
      });

      // Log stderr
      this.process.stderr?.on('data', (data: Buffer) => {
        const output = data.toString().trim();
        if (output) {
          console.error(`[ThetaTerminal ERROR] ${output}`);
        }
      });

      // Handle process exit
      this.process.on('exit', (code) => {
        console.log(`[ThetaTerminal] Process exited with code: ${code}`);
        this.status = ThetaTerminalStatus.STOPPED;
        this.process = null;
        this.stopHealthCheck();
      });

      this.process.on('error', (err) => {
        console.error('[ThetaTerminal] Process error:', err);
        this.status = ThetaTerminalStatus.ERROR;
      });

      // Wait for terminal to be ready (up to 30 seconds)
      const startTime = Date.now();
      const timeout = 30000;

      while (Date.now() - startTime < timeout) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (await this.isTerminalResponding()) {
          console.log('[ThetaTerminal] Terminal is ready and responding!');
          this.status = ThetaTerminalStatus.RUNNING;
          this.startHealthCheck();
          return true;
        }

        console.log(`[ThetaTerminal] Waiting for terminal... (${Math.round((Date.now() - startTime) / 1000)}s)`);
      }

      console.error('[ThetaTerminal] Timeout waiting for terminal to respond');
      this.status = ThetaTerminalStatus.ERROR;
      return false;

    } catch (error) {
      console.error('[ThetaTerminal] Failed to start:', error);
      this.status = ThetaTerminalStatus.ERROR;
      return false;
    }
  }

  /**
   * Stop Theta Terminal
   */
  async stop(): Promise<void> {
    console.log('[ThetaTerminal] Stopping...');
    this.stopHealthCheck();

    if (this.process) {
      this.process.kill('SIGTERM');

      // Wait for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Force kill if still running
      if (this.process && !this.process.killed) {
        this.process.kill('SIGKILL');
      }

      this.process = null;
    }

    // Kill any remaining processes
    await this.killExistingProcesses();

    this.status = ThetaTerminalStatus.STOPPED;
    console.log('[ThetaTerminal] Stopped');
  }

  /**
   * Start health check interval
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      return;
    }

    this.healthCheckInterval = setInterval(async () => {
      const responding = await this.isTerminalResponding();
      if (!responding && this.status === ThetaTerminalStatus.RUNNING) {
        console.warn('[ThetaTerminal] Health check failed - terminal not responding');
        this.status = ThetaTerminalStatus.ERROR;

        // Attempt restart
        console.log('[ThetaTerminal] Attempting restart...');
        await this.stop();
        await this.start();
      }
    }, 60000); // Check every 60 seconds
  }

  /**
   * Stop health check interval
   */
  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Initialize on app start
   */
  async initialize(): Promise<void> {
    console.log('[ThetaTerminal] Initializing...');
    console.log(`[ThetaTerminal] Auto-launch: ${this.config.autoLaunch}`);
    console.log(`[ThetaTerminal] JAR path: ${this.config.jarPath}`);
    console.log(`[ThetaTerminal] Username: ${this.config.username}`);

    if (this.config.autoLaunch) {
      const success = await this.start();
      if (success) {
        console.log('[ThetaTerminal] Auto-launch successful - Engine B (The Sniper) is ONLINE');
      } else {
        console.error('[ThetaTerminal] Auto-launch failed');
      }
    } else {
      console.log('[ThetaTerminal] Auto-launch disabled - set THETADATA_AUTO_LAUNCH=true to enable');
    }
  }

  /**
   * Cleanup on app shutdown
   */
  async shutdown(): Promise<void> {
    console.log('[ThetaTerminal] Shutting down...');
    await this.stop();
  }
}

// Singleton export
export const thetaTerminalService = ThetaTerminalService.getInstance();

// Helper functions for external use
export async function initializeThetaTerminal(): Promise<void> {
  await thetaTerminalService.initialize();
}

export async function shutdownThetaTerminal(): Promise<void> {
  await thetaTerminalService.shutdown();
}

export async function getThetaTerminalStatus(): Promise<{
  status: ThetaTerminalStatus;
  httpPort: number;
  wsPort: number;
  v3Port: number;
  jarExists: boolean;
  credentialsConfigured: boolean;
  responding: boolean;
}> {
  return thetaTerminalService.getStatusDetails();
}

export async function startThetaTerminal(): Promise<boolean> {
  return thetaTerminalService.start();
}

export async function stopThetaTerminal(): Promise<void> {
  return thetaTerminalService.stop();
}
