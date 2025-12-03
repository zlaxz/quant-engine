/**
 * Tool Handlers for Electron Main Process
 * Implements all tool functions using Node.js APIs
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec, spawnSync } from 'child_process';
import { promisify } from 'util';
import { glob } from 'glob';
import OpenAI from 'openai';
import { app } from 'electron';
import * as FileOps from './fileOperations';
import { ALL_TOOLS } from './toolDefinitions';
import { getMCPManager, initializeMCP } from '../mcp/MCPClientManager';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Supabase client for memory operations (quant-engine instance)
let supabaseClient: SupabaseClient | null = null;
function getSupabaseClient(): SupabaseClient | null {
  if (!supabaseClient) {
    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY;
    if (url && key) {
      supabaseClient = createClient(url, key);
      console.log('[Memory] Supabase client initialized');
    } else {
      console.warn('[Memory] Supabase not configured - memory tools will be unavailable');
    }
  }
  return supabaseClient;
}

// Initialize MCP on module load
let mcpInitialized = false;
async function ensureMCPInitialized(): Promise<void> {
  if (!mcpInitialized) {
    try {
      // Use environment variable or safe fallback - don't hardcode absolute user path
      // This allows the system to work on different machines or setups
      const vaultPath = process.env.OBSIDIAN_VAULT_PATH ||
                        path.join(app.getPath('home'), 'ObsidianVault');

      console.log(`[MCP] Initializing with vault at: ${vaultPath}`);
      await initializeMCP(vaultPath);
      mcpInitialized = true;
      console.log('[MCP] Initialized successfully');
    } catch (error) {
      console.error('[MCP] Failed to initialize:', error);
    }
  }
}

const execAsync = promisify(exec);
const fsPromises = fs.promises;

// Safe logging that won't crash on EPIPE (broken pipe)
function safeLog(...args: any[]): void {
  try {
    console.log(...args);
  } catch (e: any) {
    // Silently ignore EPIPE errors - happens when stdout closed
    if (e.code !== 'EPIPE' && e.message !== 'write EPIPE') {
      // Re-throw non-EPIPE errors
      throw e;
    }
  }
}

// Tool execution timeout (30 seconds)
const TOOL_TIMEOUT_MS = 30000;

// Wrapper for execAsync with timeout
async function execWithTimeout(command: string, options?: { cwd?: string; maxBuffer?: number; timeout?: number; shell?: string }): Promise<{ stdout: string; stderr: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);

  try {
    const result = await execAsync(command, {
      ...options,
      signal: controller.signal as any,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });
    return result;
  } catch (error: any) {
    if (error.name === 'AbortError' || error.killed) {
      throw new Error(`Command timed out after ${TOOL_TIMEOUT_MS / 1000}s: ${command.slice(0, 50)}...`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
  metadata?: any; // Additional structured data for specialized rendering
}

// Get app root directory (internal Python engine is at app_root/python/)
function getAppRoot(): string {
  // In development, use process.cwd()
  // In production, use app.getPath('userData')/../..
  if (process.env.NODE_ENV === 'development') {
    return process.cwd();
  }
  return path.join(app.getPath('userData'), '..', '..', '..');
}

// Get engine root - now points to internal python/ directory
function getEngineRoot(): string {
  return path.join(getAppRoot(), 'python');
}

// Resolve path relative to engine root with security checks
function resolvePath(relativePath: string): { path: string; error?: string } {
  const root = getEngineRoot();

  // Reject absolute paths for security
  if (path.isAbsolute(relativePath)) {
    return { path: '', error: `Absolute paths not allowed: ${relativePath}. Use paths relative to project root.` };
  }

  // Normalize and resolve
  const resolved = path.normalize(path.join(root, relativePath));

  // Security: ensure resolved path is within engine root (prevent ../../ attacks)
  if (!resolved.startsWith(root)) {
    return { path: '', error: `Path traversal detected: ${relativePath}. Must stay within project directory.` };
  }

  return { path: resolved };
}

// Helper to safely resolve path or return error
function safeResolvePath(relativePath: string): string {
  const result = resolvePath(relativePath);
  if (result.error) {
    throw new Error(result.error);
  }
  return result.path;
}

// ==================== FILE OPERATIONS ====================
// File operations delegated to shared FileSystemService

export async function readFile(filePath: string): Promise<ToolResult> {
  return FileOps.readFile(filePath);
}

export async function listDirectory(dirPath: string): Promise<ToolResult> {
  return FileOps.listDirectory(dirPath);
}

export async function searchCode(
  pattern: string,
  searchPath?: string,
  filePattern?: string
): Promise<ToolResult> {
  return FileOps.searchCode(pattern, searchPath, filePattern);
}

export async function writeFile(filePath: string, content: string): Promise<ToolResult> {
  return FileOps.writeFile(filePath, content);
}

export async function appendFile(filePath: string, content: string): Promise<ToolResult> {
  return FileOps.appendFile(filePath, content);
}

export async function deleteFile(filePath: string): Promise<ToolResult> {
  return FileOps.deleteFile(filePath);
}

// ==================== PYTHON EXECUTION ====================

/**
 * Execute a Python script and return its output
 * CIO uses this for read-only analysis (backtests, data queries)
 * Code MODIFICATIONS go through CTO (Claude Code) via execute_via_claude_code
 */
export async function runPythonScript(
  scriptPath: string,
  args?: string[],
  timeoutSeconds?: number
): Promise<ToolResult> {
  const startTime = Date.now();
  let timedOut = false;
  
  try {
    const root = getEngineRoot();
    const fullPath = safeResolvePath(scriptPath);

    // Verify script exists
    if (!fs.existsSync(fullPath)) {
      return {
        success: false,
        content: '',
        error: `Python script not found: ${scriptPath}`,
        metadata: {
          pythonExecution: true,
          scriptPath,
          args: args || [],
          command: `python3 ${scriptPath} ${args?.join(' ') || ''}`,
          stdout: '',
          stderr: '',
          exitCode: null,
          duration: Date.now() - startTime,
          status: 'failed'
        }
      };
    }

    safeLog(`[runPythonScript] Executing: python3 ${scriptPath} ${args?.join(' ') || ''}`);

    // Build command
    const command = ['python3', fullPath, ...(args || [])].map(arg => 
      arg.includes(' ') ? `"${arg}"` : arg
    ).join(' ');

    const timeout = (timeoutSeconds || 300) * 1000;

    // Execute with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);

    try {
      const result = await execAsync(command, {
        cwd: root,
        signal: controller.signal as any,
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large outputs
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      return {
        success: true,
        content: result.stdout || 'Script completed with no output',
        metadata: {
          pythonExecution: true,
          scriptPath,
          args: args || [],
          command,
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          exitCode: 0,
          duration,
          status: 'completed',
          timeout
        }
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      if (error.name === 'AbortError' || error.killed || timedOut) {
        return {
          success: false,
          content: error.stdout || '',
          error: `Script timed out after ${timeoutSeconds || 300} seconds`,
          metadata: {
            pythonExecution: true,
            scriptPath,
            args: args || [],
            command,
            stdout: error.stdout || '',
            stderr: error.stderr || '',
            exitCode: null,
            duration,
            status: 'timeout',
            timeout
          }
        };
      }

      // Script execution failed
      return {
        success: false,
        content: error.stdout || '',
        error: `Script failed: ${error.stderr || error.message}`,
        metadata: {
          pythonExecution: true,
          scriptPath,
          args: args || [],
          command,
          stdout: error.stdout || '',
          stderr: error.stderr || error.message,
          exitCode: error.code || 1,
          duration,
          status: 'failed',
          timeout
        }
      };
    }
  } catch (error: any) {
    const duration = Date.now() - startTime;
    return {
      success: false,
      content: '',
      error: `Failed to execute script: ${error.message}`,
      metadata: {
        pythonExecution: true,
        scriptPath,
        args: args || [],
        command: `python3 ${scriptPath} ${args?.join(' ') || ''}`,
        stdout: '',
        stderr: error.message,
        exitCode: null,
        duration,
        status: 'failed'
      }
    };
  }
}

// ==================== ENVIRONMENT MANAGEMENT ====================

/**
 * Manage Python packages for the quant engine.
 * Uses the secure package_manager.py script to install/uninstall/check packages.
 * Only allows standard PyPI packages (no URLs, git repos, or local paths).
 */
export async function manageEnvironment(
  action: 'install' | 'uninstall' | 'check' | 'list' | 'sync',
  packageName?: string,
  upgrade?: boolean
): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const root = getEngineRoot();
    const scriptPath = path.join(root, 'utils', 'package_manager.py');

    // Verify script exists
    if (!fs.existsSync(scriptPath)) {
      return {
        success: false,
        content: '',
        error: `Package manager script not found at ${scriptPath}`
      };
    }

    // Validate action
    const validActions = ['install', 'uninstall', 'check', 'list', 'sync'];
    if (!validActions.includes(action)) {
      return {
        success: false,
        content: '',
        error: `Invalid action: ${action}. Must be one of: ${validActions.join(', ')}`
      };
    }

    // Package name required for install/uninstall/check
    if (['install', 'uninstall', 'check'].includes(action) && !packageName) {
      return {
        success: false,
        content: '',
        error: `Package name required for ${action} action`
      };
    }

    // Build command arguments
    const args = ['python3', scriptPath, action];
    if (packageName) {
      args.push(packageName);
    }
    if (upgrade && action === 'install') {
      args.push('--upgrade');
    }

    safeLog(`[ManageEnvironment] Running: ${args.join(' ')}`);

    // Execute the package manager script
    const { stdout, stderr } = await execWithTimeout(args.join(' '), {
      cwd: root,
      timeout: 300000 // 5 minute timeout for package operations
    });

    const elapsed = Date.now() - startTime;

    // Parse JSON output from the script
    try {
      const result = JSON.parse(stdout);

      // Format human-readable output
      let formattedContent = '';

      if (action === 'install') {
        if (result.success) {
          formattedContent = `✅ Package "${packageName}" installed successfully`;
          if (result.requirements_updated) {
            formattedContent += '\n   (requirements.txt updated)';
          }
          if (result.warning) {
            formattedContent += `\n   ⚠️ ${result.warning}`;
          }
        } else {
          formattedContent = `❌ Failed to install "${packageName}": ${result.error}`;
        }
      } else if (action === 'uninstall') {
        if (result.success) {
          formattedContent = `✅ Package "${packageName}" uninstalled`;
        } else {
          formattedContent = `❌ Failed to uninstall: ${result.error}`;
        }
      } else if (action === 'check') {
        if (result.installed) {
          formattedContent = `✅ ${packageName} v${result.version} is installed`;
          if (result.location) {
            formattedContent += `\n   Location: ${result.location}`;
          }
        } else {
          formattedContent = `❌ ${packageName} is NOT installed`;
        }
      } else if (action === 'list') {
        if (result.success) {
          formattedContent = `Installed packages (${result.count}):\n`;
          const pkgs = result.packages.slice(0, 50); // Limit display
          formattedContent += pkgs.map((p: any) => `  • ${p.name} v${p.version}`).join('\n');
          if (result.count > 50) {
            formattedContent += `\n  ... and ${result.count - 50} more`;
          }
        } else {
          formattedContent = `❌ Failed to list packages: ${result.error}`;
        }
      } else if (action === 'sync') {
        if (result.success) {
          formattedContent = `✅ Requirements sync complete\n   ${result.packages_installed} package(s) installed`;
        } else {
          formattedContent = `❌ Sync failed: ${result.stderr}`;
        }
      }

      return {
        success: result.success !== false,
        content: formattedContent,
        metadata: {
          action,
          package: packageName,
          elapsed,
          result
        }
      };
    } catch {
      // If stdout isn't JSON, return raw output
      return {
        success: true,
        content: stdout || stderr,
        metadata: { action, package: packageName, elapsed }
      };
    }
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    return {
      success: false,
      content: '',
      error: `Package operation failed: ${error.message}`,
      metadata: { action, package: packageName, elapsed }
    };
  }
}

// ==================== COMMAND EXECUTION ====================

/**
 * Execute a WHITELISTED shell command (for agent use)
 * Security: Only allows safe commands, no arbitrary shell execution
 */
export async function runCommand(command: string): Promise<ToolResult> {
  try {
    const root = getEngineRoot();

    // SECURITY: Whitelist allowed commands
    const ALLOWED_COMMANDS = ['pytest', 'python3', 'ls', 'pwd', 'git status', 'git diff', 'grep'];
    const commandPrefix = command.trim().split(/\s+/)[0];

    if (!ALLOWED_COMMANDS.some(allowed => command.startsWith(allowed))) {
      return {
        success: false,
        content: '',
        error: `Command not allowed: "${commandPrefix}". Allowed: ${ALLOWED_COMMANDS.join(', ')}`
      };
    }

    safeLog(`[runCommand] Executing (whitelisted): ${command.slice(0, 100)}`);

    const { stdout, stderr } = await execWithTimeout(command, {
      cwd: root,
      timeout: 60000, // 60 second timeout
      shell: '/bin/bash' // Explicit shell, not user's shell
    });

    const output = stdout + (stderr ? `\n[stderr]: ${stderr}` : '');
    return {
      success: true,
      content: output || 'Command completed with no output'
    };
  } catch (error: any) {
    return {
      success: false,
      content: '',
      error: `Command failed: ${error.message || error.stderr || String(error)}`
    };
  }
}

// ==================== GIT OPERATIONS ====================

async function runGitCommand(args: string[]): Promise<ToolResult> {
  try {
    const root = getEngineRoot();
    const { stdout, stderr } = await execWithTimeout(`git ${args.join(' ')}`, { cwd: root });
    return { success: true, content: stdout || stderr || 'Command completed' };
  } catch (error: any) {
    return {
      success: false,
      content: '',
      error: `Git error: ${error.stderr || error.message}`
    };
  }
}

export async function gitStatus(): Promise<ToolResult> {
  return runGitCommand(['status', '--porcelain', '-b']);
}

export async function gitDiff(filePath?: string, staged?: boolean): Promise<ToolResult> {
  const args = ['diff'];
  if (staged) args.push('--cached');
  if (filePath) args.push(filePath);
  return runGitCommand(args);
}

export async function gitLog(limit?: number, filePath?: string): Promise<ToolResult> {
  const args = ['log', `--oneline`, `-n`, String(limit || 10)];
  if (filePath) args.push('--', filePath);
  return runGitCommand(args);
}

export async function gitAdd(filePath: string): Promise<ToolResult> {
  return runGitCommand(['add', filePath]);
}

export async function gitCommit(message: string): Promise<ToolResult> {
  return runGitCommand(['commit', '-m', message]);
}

export async function gitBranch(options: { list?: boolean; create?: boolean; delete_branch?: boolean; name?: string }): Promise<ToolResult> {
  const args = ['branch'];

  if (options.list) {
    args.push('-a');
  } else if (options.create && options.name) {
    args.push(options.name);
  } else if (options.delete_branch && options.name) {
    args.push('-d', options.name);
  }

  return runGitCommand(args);
}

export async function gitCheckout(branch: string, create?: boolean): Promise<ToolResult> {
  const args = ['checkout'];
  if (create) args.push('-b');
  args.push(branch);
  return runGitCommand(args);
}

export async function gitPush(args: { remote?: string; branch?: string; force?: boolean }): Promise<ToolResult> {
  const root = getEngineRoot();
  const remote = args.remote || 'origin';
  const cmdArgs = ['push', remote];

  if (args.branch) {
    cmdArgs.push(args.branch);
  }

  if (args.force) {
    cmdArgs.push('--force');
  }

  try {
    const { stdout, stderr } = await execWithTimeout(`git ${cmdArgs.join(' ')}`, { cwd: root });
    return {
      success: true,
      content: stdout || stderr || 'Push completed successfully'
    };
  } catch (error: any) {
    return {
      success: false,
      content: '',
      error: `Push failed: ${error.message}`
    };
  }
}

export async function gitPull(args: { remote?: string; branch?: string; rebase?: boolean }): Promise<ToolResult> {
  const root = getEngineRoot();
  const remote = args.remote || 'origin';
  const cmdArgs = ['pull', remote];

  if (args.branch) {
    cmdArgs.push(args.branch);
  }

  if (args.rebase) {
    cmdArgs.push('--rebase');
  }

  try {
    const { stdout, stderr } = await execWithTimeout(`git ${cmdArgs.join(' ')}`, { cwd: root });
    return {
      success: true,
      content: stdout || stderr || 'Pull completed successfully'
    };
  } catch (error: any) {
    return {
      success: false,
      content: '',
      error: `Pull failed: ${error.message}`
    };
  }
}

export async function gitFetch(args: { remote?: string; prune?: boolean }): Promise<ToolResult> {
  const root = getEngineRoot();
  const cmdArgs = ['fetch'];

  if (args.remote) {
    cmdArgs.push(args.remote);
  } else {
    cmdArgs.push('--all');
  }

  if (args.prune) {
    cmdArgs.push('--prune');
  }

  try {
    const { stdout, stderr } = await execWithTimeout(`git ${cmdArgs.join(' ')}`, { cwd: root });
    return {
      success: true,
      content: stdout || stderr || 'Fetch completed successfully'
    };
  } catch (error: any) {
    return {
      success: false,
      content: '',
      error: `Fetch failed: ${error.message}`
    };
  }
}

// ==================== VALIDATION OPERATIONS ====================

export async function runTests(testPath?: string, verbose?: boolean): Promise<ToolResult> {
  try {
    const root = getEngineRoot();
    const args = ['pytest'];

    if (testPath) args.push(testPath);
    if (verbose) args.push('-v');
    args.push('--tb=short');

    const { stdout, stderr } = await execWithTimeout(args.join(' '), {
      cwd: root,
      timeout: 300000 // 5 minute timeout
    });

    return { success: true, content: stdout + (stderr ? `\n${stderr}` : '') };
  } catch (error: any) {
    // pytest returns non-zero on test failures
    return {
      success: false,
      content: error.stdout || '',
      error: error.stderr || error.message
    };
  }
}

export async function validateStrategy(strategyPath: string): Promise<ToolResult> {
  try {
    const root = getEngineRoot();
    const fullPath = safeResolvePath(strategyPath);

    if (!fs.existsSync(fullPath)) {
      return { success: false, content: '', error: `Strategy file not found: ${strategyPath}` };
    }

    // Run Python syntax check
    const { stdout: _stdout, stderr: _stderr } = await execWithTimeout(`python -m py_compile "${fullPath}"`, { cwd: root });

    // Check for required functions
    const content = fs.readFileSync(fullPath, 'utf-8');
    const requiredFunctions = ['generate_signals', 'on_bar', 'get_parameters'];
    const missingFunctions = requiredFunctions.filter(fn => !content.includes(`def ${fn}`));

    if (missingFunctions.length > 0) {
      return {
        success: false,
        content: '',
        error: `Missing required functions: ${missingFunctions.join(', ')}`
      };
    }

    return { success: true, content: 'Strategy validation passed' };
  } catch (error: any) {
    return { success: false, content: '', error: `Validation error: ${error.message}` };
  }
}

export async function dryRunBacktest(
  strategyKey: string,
  startDate: string,
  endDate: string,
  capital?: number
): Promise<ToolResult> {
  try {
    const backtestCapital = capital || 100000;

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return {
        success: false,
        content: '',
        error: 'Invalid date format. Use YYYY-MM-DD.'
      };
    }

    // Check date range
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (start >= end) {
      return {
        success: false,
        content: '',
        error: 'Start date must be before end date.'
      };
    }

    const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    // Validate parameters
    const validationResults = {
      strategyKey,
      startDate,
      endDate,
      capital: backtestCapital,
      durationDays: days,
      checks: {
        dateFormat: 'PASS',
        dateRange: 'PASS',
        minimumPeriod: days >= 30 ? 'PASS' : 'WARNING: Less than 30 days',
        capitalAmount: backtestCapital >= 10000 ? 'PASS' : 'WARNING: Less than $10,000',
      }
    };

    // Try to check if strategy profile exists (in internal engine)
    const appRoot = getAppRoot();
    const profilePath = path.join(appRoot, 'python', 'engine', 'profiles', `${strategyKey}.json`);
    const profileCheck = fs.existsSync(profilePath)
      ? 'PASS - Profile found'
      : `WARNING - Profile not found at ${profilePath}`;
    (validationResults.checks as any).strategyProfile = profileCheck;

    const allPassed = Object.values(validationResults.checks).every(c => c.startsWith('PASS'));

    return {
      success: true,
      content: `Dry Run Validation:\n${JSON.stringify(validationResults, null, 2)}\n\nStatus: ${allPassed ? 'Ready for backtest' : 'Review warnings before running'}`
    };
  } catch (error: any) {
    return { success: false, content: '', error: `Dry run failed: ${error.message}` };
  }
}

export async function lintCode(filePath: string): Promise<ToolResult> {
  try {
    const root = getEngineRoot();
    const fullPath = safeResolvePath(filePath);

    const { stdout, stderr } = await execWithTimeout(`flake8 "${fullPath}" --max-line-length=120`, { cwd: root });

    if (!stdout && !stderr) {
      return { success: true, content: 'No linting issues found' };
    }

    return { success: true, content: stdout || stderr };
  } catch (error: any) {
    // flake8 returns non-zero when issues found
    return { success: true, content: error.stdout || 'Linting issues found' };
  }
}

export async function typeCheck(filePath: string): Promise<ToolResult> {
  try {
    const root = getEngineRoot();
    const fullPath = safeResolvePath(filePath);

    const { stdout, stderr: _stderr } = await execWithTimeout(`mypy "${fullPath}"`, { cwd: root });
    return { success: true, content: stdout || 'Type checking passed' };
  } catch (error: any) {
    return { success: false, content: error.stdout || '', error: error.stderr || error.message };
  }
}

/**
 * THE RED TEAM PROTOCOL
 * Runs overfitting detection and robustness checks on a strategy.
 * If this audit fails, the CIO VETOES the trade.
 */
export async function auditStrategyRobustness(strategyKey: string, aggressiveness: string = 'standard'): Promise<ToolResult> {
  try {
    const root = getEngineRoot();
    const scriptPath = path.join(root, 'python', 'scripts', 'overfitting_red_team.py');

    if (!fs.existsSync(scriptPath)) {
      return {
        success: false,
        content: '',
        error: `Red Team script not found at ${scriptPath}. Cannot validate strategy.`
      };
    }

    safeLog(`[RED TEAM] Attacking strategy '${strategyKey}' with aggressiveness='${aggressiveness}'...`);

    const command = `python "${scriptPath}" --strategy "${strategyKey}" --mode "${aggressiveness}"`;
    const { stdout, stderr } = await execWithTimeout(command, {
      cwd: root,
      timeout: 300000 // 5 minute timeout for thorough analysis
    });

    // Parse output to determine pass/fail
    const output = stdout + (stderr ? `\n${stderr}` : '');
    const passed = output.toLowerCase().includes('pass') && !output.toLowerCase().includes('fail');

    return {
      success: passed,
      content: `🔴 RED TEAM AUDIT RESULTS\nStrategy: ${strategyKey}\nAggressiveness: ${aggressiveness}\n\n${output}`,
      metadata: { strategyKey, aggressiveness, passed }
    };
  } catch (error: any) {
    return {
      success: false,
      content: error.stdout || '',
      error: `Red Team audit failed: ${error.stderr || error.message}`
    };
  }
}

/**
 * THE LIFELINE
 * Sends push notifications to Zach's phone via Pushover.
 * For CRITICAL alerts: drawdown warnings, stop-loss triggers, strategy failures.
 */
export async function sendMobileAlert(
  title: string,
  message: string,
  priority: string = 'normal',
  sound: string = 'pushover'
): Promise<ToolResult> {
  try {
    // Pushover API credentials - from environment
    const PUSHOVER_USER = process.env.PUSHOVER_USER_KEY;
    const PUSHOVER_TOKEN = process.env.PUSHOVER_API_TOKEN;

    if (!PUSHOVER_USER || !PUSHOVER_TOKEN) {
      return {
        success: false,
        content: '',
        error: 'LIFELINE OFFLINE: Pushover credentials not configured. Set PUSHOVER_USER_KEY and PUSHOVER_API_TOKEN in .env'
      };
    }

    // Map priority string to Pushover priority number
    const priorityMap: Record<string, number> = {
      'low': -1,      // No sound/vibration
      'normal': 0,    // Normal
      'high': 1,      // Bypass quiet hours
      'emergency': 2  // Repeat until acknowledged
    };

    const priorityValue = priorityMap[priority.toLowerCase()] ?? 0;

    const payload: Record<string, unknown> = {
      token: PUSHOVER_TOKEN,
      user: PUSHOVER_USER,
      title: `🚨 ${title}`,
      message: message,
      priority: priorityValue,
      sound: sound,
      timestamp: Math.floor(Date.now() / 1000)
    };

    // For emergency priority, must specify retry and expire
    if (priorityValue === 2) {
      payload.retry = 60;   // Retry every 60 seconds
      payload.expire = 3600; // Stop after 1 hour
    }

    safeLog(`[LIFELINE] Sending alert: "${title}" (priority: ${priority})`);

    const response = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok || result.status !== 1) {
      return {
        success: false,
        content: JSON.stringify(result),
        error: `Pushover API error: ${result.errors?.join(', ') || 'Unknown error'}`
      };
    }

    safeLog(`[LIFELINE] Alert sent successfully: ${result.request}`);
    return {
      success: true,
      content: `📱 ALERT SENT TO ZACH'S PHONE\nTitle: ${title}\nPriority: ${priority}\nRequest ID: ${result.request}`,
      metadata: { requestId: result.request, priority }
    };
  } catch (error: any) {
    return {
      success: false,
      content: '',
      error: `Lifeline failed: ${error.message}`
    };
  }
}

/**
 * THE GRADUATION GATEKEEPER
 * Controls access to live trading. Strategies must graduate:
 * PAPER (backtest) → SHADOW (paper trading with real data) → LIVE (real money)
 */
export async function liveTradingGateway(
  strategyKey: string,
  action: string,
  reason?: string
): Promise<ToolResult> {
  try {
    const root = getEngineRoot();
    const graduationFile = path.join(root, 'data', 'graduation_registry.json');

    // Load or create graduation registry
    let registry: Record<string, { stage: string; history: Array<{ action: string; reason: string; timestamp: string }> }> = {};

    if (fs.existsSync(graduationFile)) {
      try {
        registry = JSON.parse(fs.readFileSync(graduationFile, 'utf-8'));
      } catch {
        registry = {};
      }
    }

    // Get current status for this strategy
    const current = registry[strategyKey] || {
      stage: 'PAPER',
      history: []
    };

    const stages = ['PAPER', 'SHADOW', 'LIVE'];

    switch (action.toLowerCase()) {
      case 'check_status':
        return {
          success: true,
          content: `📊 GRADUATION STATUS for ${strategyKey}\n\nCurrent Stage: ${current.stage}\nStages: PAPER → SHADOW → LIVE\n\n${
            current.stage === 'LIVE'
              ? '✅ CLEARED FOR LIVE TRADING'
              : current.stage === 'SHADOW'
                ? '⏳ In shadow mode - needs validation before live'
                : '🚫 BLOCKED - Must pass PAPER and SHADOW stages first'
          }\n\nHistory:\n${current.history.map(h => `- ${h.timestamp}: ${h.action} - ${h.reason}`).join('\n') || 'No history'}`
        };

      case 'promote': {
        if (!reason) {
          return {
            success: false,
            content: '',
            error: 'PROMOTION DENIED: Must provide a reason for graduation. What metrics justify this promotion?'
          };
        }

        const currentIndex = stages.indexOf(current.stage);
        if (currentIndex >= stages.length - 1) {
          return {
            success: false,
            content: '',
            error: `Strategy ${strategyKey} is already at LIVE stage. Cannot promote further.`
          };
        }

        const newStage = stages[currentIndex + 1];
        current.stage = newStage;
        current.history.push({
          action: `PROMOTED to ${newStage}`,
          reason,
          timestamp: new Date().toISOString()
        });

        registry[strategyKey] = current;
        fs.mkdirSync(path.dirname(graduationFile), { recursive: true });
        fs.writeFileSync(graduationFile, JSON.stringify(registry, null, 2));

        return {
          success: true,
          content: `✅ STRATEGY PROMOTED\n${strategyKey}: ${stages[currentIndex]} → ${newStage}\nReason: ${reason}\n\n${
            newStage === 'LIVE' ? '⚠️ WARNING: Strategy is now cleared for LIVE TRADING with real money!' : ''
          }`
        };
      }

      case 'demote': {
        if (!reason) {
          return {
            success: false,
            content: '',
            error: 'DEMOTION REQUIRES REASON: Why is this strategy being demoted?'
          };
        }

        const previousStage = current.stage;
        current.stage = 'PAPER';
        current.history.push({
          action: `DEMOTED from ${previousStage} to PAPER`,
          reason,
          timestamp: new Date().toISOString()
        });

        registry[strategyKey] = current;
        fs.mkdirSync(path.dirname(graduationFile), { recursive: true });
        fs.writeFileSync(graduationFile, JSON.stringify(registry, null, 2));

        return {
          success: true,
          content: `🔴 STRATEGY DEMOTED\n${strategyKey}: ${previousStage} → PAPER\nReason: ${reason}\n\nStrategy must re-qualify through all stages before live trading.`
        };
      }

      default:
        return {
          success: false,
          content: '',
          error: `Unknown action: ${action}. Use "check_status", "promote", or "demote".`
        };
    }
  } catch (error: any) {
    return {
      success: false,
      content: '',
      error: `Graduation gateway error: ${error.message}`
    };
  }
}

// ==================== ANALYSIS OPERATIONS ====================

export async function findFunction(name: string, searchPath?: string): Promise<ToolResult> {
  try {
    const root = getEngineRoot();
    const targetPath = searchPath ? safeResolvePath(searchPath) : root;

    // Use grep to find function definitions
    const pattern = `def ${name}\\(`;
    const { stdout } = await execWithTimeout(
      `grep -rn "${pattern}" "${targetPath}" --include="*.py"`,
      { cwd: root }
    );

    if (!stdout.trim()) {
      return { success: false, content: '', error: `Function '${name}' not found` };
    }

    return { success: true, content: `Found function '${name}':\n${stdout}` };
  } catch (error: any) {
    if (error.code === 1) {
      return { success: false, content: '', error: `Function '${name}' not found` };
    }
    return { success: false, content: '', error: error.message };
  }
}

export async function findClass(name: string, searchPath?: string): Promise<ToolResult> {
  try {
    const root = getEngineRoot();
    const targetPath = searchPath ? safeResolvePath(searchPath) : root;

    const pattern = `class ${name}[\\(:]`;
    const { stdout } = await execWithTimeout(
      `grep -rn -E "${pattern}" "${targetPath}" --include="*.py"`,
      { cwd: root }
    );

    if (!stdout.trim()) {
      return { success: false, content: '', error: `Class '${name}' not found` };
    }

    return { success: true, content: `Found class '${name}':\n${stdout}` };
  } catch (error: any) {
    if (error.code === 1) {
      return { success: false, content: '', error: `Class '${name}' not found` };
    }
    return { success: false, content: '', error: error.message };
  }
}

export async function findUsages(symbol: string, searchPath?: string): Promise<ToolResult> {
  return searchCode(symbol, searchPath, '*.py');
}

export async function codeStats(statsPath?: string): Promise<ToolResult> {
  try {
    const root = getEngineRoot();
    const targetPath = statsPath ? safeResolvePath(statsPath) : root;

    // Use glob library and fs instead of shell commands (prevents shell injection)
    const files = await glob('**/*.py', {
      cwd: targetPath,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.venv/**', '**/__pycache__/**', '**/.git/**']
    });

    let totalLines = 0;
    let totalFunctions = 0;
    let totalClasses = 0;

    // Process each file
    for (const file of files) {
      try {
        const content = await fsPromises.readFile(file, 'utf-8');
        const lines = content.split('\n');
        totalLines += lines.length;

        // Count function definitions (def keyword at start of line)
        totalFunctions += (content.match(/^def\s+\w+/gm) || []).length;

        // Count class definitions (class keyword at start of line)
        totalClasses += (content.match(/^class\s+\w+/gm) || []).length;
      } catch (err) {
        // Skip files that can't be read (permissions, encoding issues)
        console.warn(`Skipping file ${file}: ${err}`);
      }
    }

    const stats = {
      pythonFiles: files.length,
      totalLines,
      functions: totalFunctions,
      classes: totalClasses
    };

    return {
      success: true,
      content: `Code Statistics for ${statsPath || 'project'}:\n${JSON.stringify(stats, null, 2)}`
    };
  } catch (error: any) {
    return { success: false, content: '', error: error.message };
  }
}

// ==================== BACKTEST OPERATIONS ====================

// Python server URL - internal engine running on localhost
const PYTHON_SERVER_URL = 'http://localhost:5001';

// Helper function to execute a single backtest via HTTP call to Python server
async function executeSingleBacktest(
  strategyKey: string,
  startDate: string,
  endDate: string,
  capital: number,
  profileConfig?: Record<string, any>
): Promise<{ success: boolean; metrics?: any; equityCurve?: any[]; error?: string }> {
  try {
    // Build request body
    const requestBody = {
      strategy_key: strategyKey,
      start_date: startDate,
      end_date: endDate,
      capital: capital,
      config: profileConfig || {}
    };

    safeLog(`[Backtest] Calling Python server: ${PYTHON_SERVER_URL}/api/backtest`);
    safeLog(`[Backtest] Request: ${JSON.stringify(requestBody).slice(0, 200)}...`);

    // Call the Python HTTP server
    const response = await fetch(`${PYTHON_SERVER_URL}/api/backtest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(300000), // 5 minute timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Backtest server error (${response.status}): ${errorText}`,
      };
    }

    const results = await response.json();

    if (results.error) {
      return {
        success: false,
        error: results.error,
      };
    }

    return {
      success: true,
      metrics: results.metrics,
      equityCurve: results.equity_curve,
    };
  } catch (error: any) {
    // Handle timeout
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return {
        success: false,
        error: 'Backtest timed out after 5 minutes. Try a shorter date range.',
      };
    }

    // Handle connection errors (server not running)
    if (error.code === 'ECONNREFUSED') {
      return {
        success: false,
        error: `Python server not running at ${PYTHON_SERVER_URL}. Start the server with: python3 python/server.py`,
      };
    }

    return {
      success: false,
      error: `Backtest failed: ${error.message}`,
    };
  }
}

export async function batchBacktest(
  strategyKey: string,
  paramGrid: string,
  startDate: string,
  endDate: string,
  capital?: number
): Promise<ToolResult> {
  try {
    const grid = JSON.parse(paramGrid);
    const backtestCapital = capital || 100000;

    // Generate parameter combinations
    const combinations: Record<string, any>[] = [];
    const keys = Object.keys(grid);

    function generateCombinations(index: number, current: Record<string, any>) {
      if (index === keys.length) {
        combinations.push({ ...current });
        return;
      }
      const key = keys[index];
      for (const value of grid[key]) {
        current[key] = value;
        generateCombinations(index + 1, current);
      }
    }

    generateCombinations(0, {});

    if (combinations.length > 100) {
      return {
        success: false,
        content: '',
        error: `Too many combinations (${combinations.length}). Maximum is 100 to prevent system overload.`
      };
    }

    if (combinations.length > 20) {
      return {
        success: true,
        content: `Warning: ${combinations.length} combinations will take significant time.\n\nParameter grid:\n${JSON.stringify(grid, null, 2)}\n\nRecommendation: Start with a smaller grid or use sweep_params for single parameter analysis.\n\nProceed? This will run ${combinations.length} backtests sequentially.`
      };
    }

    // Execute backtests sequentially (limit concurrent executions)
    const results: any[] = [];
    let completed = 0;
    let failed = 0;

    for (const params of combinations) {
      try {
        const result = await executeSingleBacktest(
          strategyKey,
          startDate,
          endDate,
          backtestCapital,
          params
        );

        if (result.success) {
          results.push({
            params,
            status: 'completed',
            metrics: result.metrics,
          });
          completed++;
        } else {
          results.push({
            params,
            status: 'failed',
            error: result.error,
          });
          failed++;
        }
      } catch (error: any) {
        results.push({
          params,
          status: 'failed',
          error: error.message,
        });
        failed++;
      }
    }

    // Find best parameters by Sharpe ratio
    const successfulResults = results.filter(r => r.status === 'completed');
    const sortedBySharpe = successfulResults.sort((a, b) =>
      (b.metrics?.sharpe || -Infinity) - (a.metrics?.sharpe || -Infinity)
    );

    const summary = {
      totalCombinations: combinations.length,
      completed,
      failed,
      bestParams: sortedBySharpe[0]?.params,
      bestMetrics: sortedBySharpe[0]?.metrics,
      top5: sortedBySharpe.slice(0, 5).map(r => ({
        params: r.params,
        sharpe: r.metrics?.sharpe,
        cagr: r.metrics?.cagr,
        maxDrawdown: r.metrics?.max_drawdown,
      })),
    };

    return {
      success: true,
      content: `Batch Backtest Results:\n${JSON.stringify(summary, null, 2)}\n\nFull results:\n${JSON.stringify(results, null, 2)}`
    };
  } catch (error: any) {
    return { success: false, content: '', error: `Batch backtest error: ${error.message}` };
  }
}

export async function sweepParams(
  strategyKey: string,
  paramName: string,
  start: number,
  end: number,
  step: number,
  startDate: string,
  endDate: string,
  capital?: number
): Promise<ToolResult> {
  try {
    const backtestCapital = capital || 100000;

    // Generate parameter values
    const values: number[] = [];
    for (let v = start; v <= end; v += step) {
      values.push(v);
    }

    if (values.length > 50) {
      return {
        success: false,
        content: '',
        error: `Too many values (${values.length}). Maximum is 50. Increase step size.`
      };
    }

    // Execute backtests for each parameter value
    const results: any[] = [];
    let completed = 0;
    let failed = 0;

    for (const value of values) {
      try {
        const paramConfig = { [paramName]: value };
        const result = await executeSingleBacktest(
          strategyKey,
          startDate,
          endDate,
          backtestCapital,
          paramConfig
        );

        if (result.success) {
          results.push({
            paramValue: value,
            status: 'completed',
            metrics: result.metrics,
          });
          completed++;
        } else {
          results.push({
            paramValue: value,
            status: 'failed',
            error: result.error,
          });
          failed++;
        }
      } catch (error: any) {
        results.push({
          paramValue: value,
          status: 'failed',
          error: error.message,
        });
        failed++;
      }
    }

    // Find optimal parameter value by Sharpe ratio
    const successfulResults = results.filter(r => r.status === 'completed');
    const sortedBySharpe = successfulResults.sort((a, b) =>
      (b.metrics?.sharpe || -Infinity) - (a.metrics?.sharpe || -Infinity)
    );

    const summary = {
      parameter: paramName,
      range: `${start} to ${end} (step: ${step})`,
      totalTests: values.length,
      completed,
      failed,
      optimalValue: sortedBySharpe[0]?.paramValue,
      optimalMetrics: sortedBySharpe[0]?.metrics,
      performanceCurve: successfulResults.map(r => ({
        value: r.paramValue,
        sharpe: r.metrics?.sharpe,
        cagr: r.metrics?.cagr,
      })),
    };

    return {
      success: true,
      content: `Parameter Sweep Results:\n${JSON.stringify(summary, null, 2)}\n\nFull results:\n${JSON.stringify(results, null, 2)}`
    };
  } catch (error: any) {
    return { success: false, content: '', error: `Parameter sweep error: ${error.message}` };
  }
}

export async function crossValidate(
  strategyKey: string,
  params: string,
  startDate: string,
  endDate: string,
  numFolds?: number,
  capital?: number
): Promise<ToolResult> {
  try {
    const folds = numFolds || 5;
    const backtestCapital = capital || 100000;
    const paramConfig = JSON.parse(params);

    // Parse dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    const totalDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const foldDays = Math.floor(totalDays / folds);

    if (foldDays < 30) {
      return {
        success: false,
        content: '',
        error: `Period too short for ${folds}-fold cross-validation. Need at least ${folds * 30} days.`
      };
    }

    // Generate fold periods
    const foldPeriods: { train: [string, string], test: [string, string] }[] = [];
    for (let i = 0; i < folds; i++) {
      const testStart = new Date(start.getTime() + i * foldDays * 24 * 60 * 60 * 1000);
      const testEnd = new Date(testStart.getTime() + foldDays * 24 * 60 * 60 * 1000);

      // For simplicity, use all data before test period as training
      foldPeriods.push({
        train: [startDate, testStart.toISOString().split('T')[0]],
        test: [testStart.toISOString().split('T')[0], testEnd.toISOString().split('T')[0]],
      });
    }

    // Execute backtests for each fold (test periods only)
    const results: any[] = [];
    let completed = 0;
    let failed = 0;

    for (let i = 0; i < foldPeriods.length; i++) {
      const fold = foldPeriods[i];
      try {
        const result = await executeSingleBacktest(
          strategyKey,
          fold.test[0],
          fold.test[1],
          backtestCapital,
          paramConfig
        );

        if (result.success) {
          results.push({
            fold: i + 1,
            period: fold.test,
            status: 'completed',
            metrics: result.metrics,
          });
          completed++;
        } else {
          results.push({
            fold: i + 1,
            period: fold.test,
            status: 'failed',
            error: result.error,
          });
          failed++;
        }
      } catch (error: any) {
        results.push({
          fold: i + 1,
          period: fold.test,
          status: 'failed',
          error: error.message,
        });
        failed++;
      }
    }

    // Calculate aggregate statistics
    const successfulResults = results.filter(r => r.status === 'completed');
    const metrics = successfulResults.map(r => r.metrics);

    const avgSharpe = metrics.reduce((sum, m) => sum + (m?.sharpe || 0), 0) / metrics.length;
    const avgCAGR = metrics.reduce((sum, m) => sum + (m?.cagr || 0), 0) / metrics.length;
    const avgMaxDD = metrics.reduce((sum, m) => sum + (m?.max_drawdown || 0), 0) / metrics.length;

    const summary = {
      strategy: strategyKey,
      parameters: paramConfig,
      numFolds: folds,
      completed,
      failed,
      averageMetrics: {
        sharpe: avgSharpe,
        cagr: avgCAGR,
        maxDrawdown: avgMaxDD,
      },
      foldResults: results,
    };

    return {
      success: true,
      content: `Cross-Validation Results:\n${JSON.stringify(summary, null, 2)}`
    };
  } catch (error: any) {
    return { success: false, content: '', error: `Cross-validation error: ${error.message}` };
  }
}

// ==================== QUANT ENGINE API OPERATIONS ====================

/**
 * Get regime heatmap data from the Quant Engine API
 */
export async function getRegimeHeatmap(
  startDate?: string,
  endDate?: string
): Promise<ToolResult> {
  try {
    // Build query string
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);

    const queryString = params.toString();
    const url = `${PYTHON_SERVER_URL}/regimes${queryString ? `?${queryString}` : ''}`;

    safeLog(`[Regimes] Fetching from: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, content: '', error: `Server error (${response.status}): ${errorText}` };
    }

    const result = await response.json();

    if (!result.success) {
      return { success: false, content: '', error: result.error || 'Unknown error' };
    }

    return {
      success: true,
      content: `Regime Heatmap (${result.count} days):\n${JSON.stringify(result.data, null, 2)}`,
      metadata: result
    };
  } catch (error: any) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return { success: false, content: '', error: 'Request timed out' };
    }
    if (error.code === 'ECONNREFUSED') {
      return { success: false, content: '', error: `Quant Engine not running at ${PYTHON_SERVER_URL}. Start with: cd python && python server.py` };
    }
    return { success: false, content: '', error: `Request failed: ${error.message}` };
  }
}

/**
 * List all available strategies from the Quant Engine API
 */
export async function listStrategies(): Promise<ToolResult> {
  try {
    safeLog(`[Strategies] Listing all strategies`);

    const response = await fetch(`${PYTHON_SERVER_URL}/strategies`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, content: '', error: `Server error (${response.status}): ${errorText}` };
    }

    const result = await response.json();

    if (!result.success) {
      return { success: false, content: '', error: result.error || 'Unknown error' };
    }

    // Format strategies for display
    const formatted = result.strategies.map((s: any) =>
      `• ${s.id}: ${s.name} [${s.risk_level}]\n  ${s.description}`
    ).join('\n\n');

    return {
      success: true,
      content: `Available Strategies (${result.count}):\n\n${formatted}`,
      metadata: result
    };
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      return { success: false, content: '', error: `Quant Engine not running at ${PYTHON_SERVER_URL}` };
    }
    return { success: false, content: '', error: `Request failed: ${error.message}` };
  }
}

/**
 * Get detailed strategy card from the Quant Engine API
 */
export async function getStrategyDetails(strategyId: string): Promise<ToolResult> {
  try {
    safeLog(`[Strategy] Getting details for: ${strategyId}`);

    const response = await fetch(`${PYTHON_SERVER_URL}/strategies/${strategyId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (response.status === 404) {
      return { success: false, content: '', error: `Strategy not found: ${strategyId}` };
    }

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, content: '', error: `Server error (${response.status}): ${errorText}` };
    }

    const result = await response.json();

    if (!result.success) {
      return { success: false, content: '', error: result.error || 'Unknown error' };
    }

    const s = result.strategy;
    const perf = s.performance || {};

    const formatted = `
Strategy: ${s.name} (${s.id})
${'='.repeat(50)}

Description: ${s.description}

Risk Level: ${s.risk_level.toUpperCase()}
Signal: ${s.signal || 'N/A'}
Current Allocation: ${((s.current_allocation || 0) * 100).toFixed(1)}%

Optimal Regimes: ${s.optimal_regimes.join(', ')}
Instruments: ${s.instruments.join(', ')}

Performance Metrics:
  • Sharpe Ratio: ${perf.sharpe?.toFixed(2) || 'N/A'}
  • Max Drawdown: ${perf.max_drawdown?.toFixed(1) || 'N/A'}%
  • Win Rate: ${((perf.win_rate || 0) * 100).toFixed(1)}%
  • Avg Return: ${perf.avg_return?.toFixed(2) || 'N/A'}%
    `.trim();

    return {
      success: true,
      content: formatted,
      metadata: result
    };
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      return { success: false, content: '', error: `Quant Engine not running at ${PYTHON_SERVER_URL}` };
    }
    return { success: false, content: '', error: `Request failed: ${error.message}` };
  }
}

/**
 * Run scenario simulation via Quant Engine API
 */
export async function runScenarioSimulation(
  scenario: 'vix_shock' | 'price_drop' | 'vol_crush',
  params?: Record<string, number>,
  portfolio?: Record<string, number>
): Promise<ToolResult> {
  try {
    safeLog(`[Simulate] Running scenario: ${scenario}`);

    const requestBody = {
      scenario,
      params: params || {},
      portfolio: portfolio || {}
    };

    const response = await fetch(`${PYTHON_SERVER_URL}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, content: '', error: `Server error (${response.status}): ${errorText}` };
    }

    const result = await response.json();

    if (!result.success) {
      return { success: false, content: '', error: result.error || 'Unknown error' };
    }

    const impact = result.impact;

    // Format by-strategy breakdown
    const strategyBreakdown = Object.entries(impact.by_strategy)
      .map(([id, data]: [string, any]) =>
        `  • ${id}: ${data.pnl_pct > 0 ? '+' : ''}${data.pnl_pct.toFixed(2)}% (allocation: ${(data.allocation * 100).toFixed(1)}%)`
      ).join('\n');

    const formatted = `
Scenario Simulation: ${scenario.toUpperCase()}
${'='.repeat(50)}

Parameters: ${JSON.stringify(result.params)}
Stress Level: ${impact.stress_level}

Portfolio Impact: ${impact.portfolio_pnl_pct > 0 ? '+' : ''}${impact.portfolio_pnl_pct.toFixed(2)}%

By Strategy:
${strategyBreakdown}

${impact.greeks_impact ? `Greeks Impact:
  • Delta: ${impact.greeks_impact.delta?.toFixed(3) || 'N/A'}
  • Gamma: ${impact.greeks_impact.gamma?.toFixed(3) || 'N/A'}
  • Vega: ${impact.greeks_impact.vega?.toFixed(3) || 'N/A'}
  • Theta: ${impact.greeks_impact.theta?.toFixed(3) || 'N/A'}` : ''}

Recommendations:
${impact.recommendations.map((r: string) => `  • ${r}`).join('\n')}
    `.trim();

    return {
      success: true,
      content: formatted,
      metadata: result
    };
  } catch (error: any) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return { success: false, content: '', error: 'Simulation timed out' };
    }
    if (error.code === 'ECONNREFUSED') {
      return { success: false, content: '', error: `Quant Engine not running at ${PYTHON_SERVER_URL}` };
    }
    return { success: false, content: '', error: `Simulation failed: ${error.message}` };
  }
}

/**
 * Check Quant Engine health status
 */
export async function checkQuantEngineHealth(): Promise<ToolResult> {
  try {
    const response = await fetch(`${PYTHON_SERVER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return {
        success: false,
        content: '',
        error: `Quant Engine returned status ${response.status}`
      };
    }

    const data = await response.json();

    const formatted = `
Quant Engine Health Check
${'='.repeat(50)}

Status: ${data.status === 'healthy' ? '✓ HEALTHY' : '✗ UNHEALTHY'}
Version: ${data.version || 'unknown'}
Timestamp: ${data.timestamp || 'N/A'}

Available Endpoints:
${(data.endpoints || []).map((e: string) => `  • ${e}`).join('\n')}
    `.trim();

    return {
      success: true,
      content: formatted,
      metadata: data
    };
  } catch (error: any) {
    return {
      success: false,
      content: '',
      error: `Quant Engine not reachable at ${PYTHON_SERVER_URL}. Start with: cd python && python server.py`
    };
  }
}

// ==================== DATA INSPECTION ====================

export async function inspectMarketData(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<ToolResult> {
  try {
    const root = getEngineRoot();
    const dataPath = path.join(root, 'data', 'polygon', `${symbol.toUpperCase()}.csv`);

    if (!fs.existsSync(dataPath)) {
      return {
        success: false,
        content: '',
        error: `Data file not found for ${symbol}. Expected at: ${dataPath}`
      };
    }

    // Read and filter data
    const content = fs.readFileSync(dataPath, 'utf-8');
    const lines = content.split('\n');
    const header = lines[0];

    const filteredLines = lines.slice(1).filter(line => {
      if (!line.trim()) return false;
      const date = line.split(',')[0];
      return date >= startDate && date <= endDate;
    });

    return {
      success: true,
      content: `${symbol} data from ${startDate} to ${endDate}:\nRows: ${filteredLines.length}\nHeader: ${header}\nFirst 5 rows:\n${filteredLines.slice(0, 5).join('\n')}`
    };
  } catch (error: any) {
    return { success: false, content: '', error: error.message };
  }
}

export async function dataQualityCheck(
  symbol: string,
  startDate?: string,
  endDate?: string
): Promise<ToolResult> {
  const root = getEngineRoot();
  const dataPath = path.join(root, 'data', 'polygon', `${symbol.toUpperCase()}.csv`);

  if (!fs.existsSync(dataPath)) {
    return { success: false, content: '', error: `Data file not found: ${dataPath}` };
  }

  try {
    const content = fs.readFileSync(dataPath, 'utf-8');
    const lines = content.trim().split('\n');

    // Parse data
    const data: Array<{
      date: Date;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }> = [];

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const values = lines[i].split(',');
      const date = new Date(values[0]);

      // Skip if outside date range
      if (startDate && date < new Date(startDate)) continue;
      if (endDate && date > new Date(endDate)) continue;

      data.push({
        date,
        open: parseFloat(values[1]),
        high: parseFloat(values[2]),
        low: parseFloat(values[3]),
        close: parseFloat(values[4]),
        volume: parseFloat(values[5] || '0')
      });
    }

    if (data.length === 0) {
      return { success: false, content: '', error: 'No data found in date range' };
    }

    // Sort by date
    data.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Quality checks
    const issues: string[] = [];
    const warnings: string[] = [];

    // 1. Check for missing dates (gaps)
    const gaps: string[] = [];
    for (let i = 1; i < data.length; i++) {
      const daysDiff = (data[i].date.getTime() - data[i-1].date.getTime()) / (1000 * 60 * 60 * 24);
      // Allow for weekends (3 days) but flag longer gaps
      if (daysDiff > 4) {
        gaps.push(`${data[i-1].date.toISOString().split('T')[0]} to ${data[i].date.toISOString().split('T')[0]} (${Math.round(daysDiff)} days)`);
      }
    }
    if (gaps.length > 0) {
      warnings.push(`Found ${gaps.length} data gaps:\n  - ${gaps.slice(0, 5).join('\n  - ')}${gaps.length > 5 ? `\n  - ... and ${gaps.length - 5} more` : ''}`);
    }

    // 2. Check for OHLC validity (high >= low, high >= open/close, etc.)
    let ohlcErrors = 0;
    for (const row of data) {
      if (row.high < row.low) ohlcErrors++;
      if (row.high < row.open || row.high < row.close) ohlcErrors++;
      if (row.low > row.open || row.low > row.close) ohlcErrors++;
    }
    if (ohlcErrors > 0) {
      issues.push(`${ohlcErrors} rows have invalid OHLC relationships (high < low, etc.)`);
    }

    // 3. Check for price outliers (>10% daily move)
    const outliers: string[] = [];
    for (let i = 1; i < data.length; i++) {
      const pctChange = Math.abs(data[i].close - data[i-1].close) / data[i-1].close;
      if (pctChange > 0.10) {
        outliers.push(`${data[i].date.toISOString().split('T')[0]}: ${(pctChange * 100).toFixed(1)}% move`);
      }
    }
    if (outliers.length > 0) {
      warnings.push(`Found ${outliers.length} large daily moves (>10%):\n  - ${outliers.slice(0, 5).join('\n  - ')}${outliers.length > 5 ? `\n  - ... and ${outliers.length - 5} more` : ''}`);
    }

    // 4. Check for zero/negative values
    let zeroValues = 0;
    let negativeValues = 0;
    for (const row of data) {
      if (row.open <= 0 || row.high <= 0 || row.low <= 0 || row.close <= 0) {
        if (row.open < 0 || row.high < 0 || row.low < 0 || row.close < 0) {
          negativeValues++;
        } else {
          zeroValues++;
        }
      }
    }
    if (negativeValues > 0) issues.push(`${negativeValues} rows have negative prices`);
    if (zeroValues > 0) issues.push(`${zeroValues} rows have zero prices`);

    // 5. Check for duplicate dates
    const dateSet = new Set<string>();
    let duplicates = 0;
    for (const row of data) {
      const key = row.date.toISOString().split('T')[0];
      if (dateSet.has(key)) duplicates++;
      dateSet.add(key);
    }
    if (duplicates > 0) issues.push(`${duplicates} duplicate dates found`);

    // 6. Check for NaN values
    let nanCount = 0;
    for (const row of data) {
      if (isNaN(row.open) || isNaN(row.high) || isNaN(row.low) || isNaN(row.close)) {
        nanCount++;
      }
    }
    if (nanCount > 0) issues.push(`${nanCount} rows have NaN values`);

    // 7. Volume checks
    let zeroVolume = 0;
    for (const row of data) {
      if (row.volume === 0) zeroVolume++;
    }
    if (zeroVolume > data.length * 0.1) {
      warnings.push(`${zeroVolume} rows (${((zeroVolume/data.length)*100).toFixed(1)}%) have zero volume`);
    }

    // Summary
    const dateRange = `${data[0].date.toISOString().split('T')[0]} to ${data[data.length-1].date.toISOString().split('T')[0]}`;

    let report = `## Data Quality Report: ${symbol.toUpperCase()}\n\n`;
    report += `**Date Range:** ${dateRange}\n`;
    report += `**Total Rows:** ${data.length}\n\n`;

    if (issues.length === 0 && warnings.length === 0) {
      report += `✅ **No issues found** - Data appears clean.\n`;
    } else {
      if (issues.length > 0) {
        report += `### ❌ Critical Issues (${issues.length})\n`;
        issues.forEach(issue => report += `- ${issue}\n`);
        report += '\n';
      }
      if (warnings.length > 0) {
        report += `### ⚠️ Warnings (${warnings.length})\n`;
        warnings.forEach(warning => report += `- ${warning}\n`);
      }
    }

    return { success: true, content: report };
  } catch (error: any) {
    return { success: false, content: '', error: error.message };
  }
}

export async function getTradeLog(runId: string): Promise<ToolResult> {
  return {
    success: true,
    content: `Trade log retrieval for run ${runId} requires Supabase database connection.\nUse /runs command in chat to see available runs.`
  };
}

// ==================== BACKUP CLEANUP ====================

export async function cleanupBackups(
  dryRun?: boolean,
  olderThanDays?: number
): Promise<ToolResult> {
  try {
    const root = getEngineRoot();
    const days = olderThanDays ?? 7;
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

    // Find all backup files
    const backupFiles = await glob('**/*.backup.*', {
      cwd: root,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**']
    });

    const deletedBackupFiles = await glob('**/*.deleted.*', {
      cwd: root,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**']
    });

    const allBackupFiles = [...backupFiles, ...deletedBackupFiles];

    // Filter by age
    const oldBackups: string[] = [];
    for (const file of allBackupFiles) {
      try {
        const stats = await fsPromises.stat(file);
        if (stats.mtimeMs < cutoff) {
          oldBackups.push(file);
        }
      } catch (err) {
        // Skip files that can't be accessed
        console.warn(`Skipping backup file ${file}: ${err}`);
      }
    }

    if (oldBackups.length === 0) {
      return {
        success: true,
        content: `No backup files older than ${days} days found.`
      };
    }

    if (dryRun) {
      const relativeBackups = oldBackups.map(f => path.relative(root, f));
      return {
        success: true,
        content: `Would delete ${oldBackups.length} backup files:\n${relativeBackups.join('\n')}`
      };
    }

    // Delete the old backups
    for (const file of oldBackups) {
      await fsPromises.unlink(file);
    }

    return {
      success: true,
      content: `Deleted ${oldBackups.length} backup files older than ${days} days.`
    };
  } catch (error: any) {
    return {
      success: false,
      content: '',
      error: `Backup cleanup error: ${error.message}`
    };
  }
}

// ==================== AGENT SPAWNING ====================

// Get DeepSeek client for agent spawning
function getDeepSeekClient(): OpenAI | null {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' });
}

// OpenAI-compatible tool definitions for agent use
const AGENT_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. Use this to examine code, configuration, or data files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to read (relative to project root)' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List contents of a directory to explore the codebase structure.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to directory (relative to project root, use "." for root)' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search for patterns in code files using grep-like functionality.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (supports regex)' },
          path: { type: 'string', description: 'Directory to search in (optional, defaults to project root)' },
          file_pattern: { type: 'string', description: 'File glob pattern like "*.py" or "*.ts" (optional)' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to write to (relative to project root)' },
          content: { type: 'string', description: 'Content to write to the file' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a shell command. Use for running tests, scripts, or other CLI operations.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' }
        },
        required: ['command']
      }
    }
  }
];

// Execute a tool call from the agent
async function executeAgentTool(toolName: string, args: Record<string, any>): Promise<string> {
  safeLog(`   [Agent Tool] ${toolName}`, JSON.stringify(args).slice(0, 100));

  try {
    let result: ToolResult;

    switch (toolName) {
      case 'read_file':
        result = await readFile(args.path);
        break;
      case 'list_directory':
        result = await listDirectory(args.path);
        break;
      case 'search_code':
        result = await searchCode(args.pattern, args.path, args.file_pattern);
        break;
      case 'write_file':
        result = await writeFile(args.path, args.content);
        break;
      case 'run_python_script':
        result = await runPythonScript(args.script_path, args.args, args.timeout_seconds);
        break;
      case 'run_command':
        result = await runCommand(args.command);
        break;
      default:
        return `Unknown tool: ${toolName}`;
    }

    if (result.success) {
      // Truncate very long outputs to prevent context overflow
      const content = result.content;
      if (content.length > 15000) {
        return content.slice(0, 15000) + '\n\n[Output truncated - showing first 15000 chars]';
      }
      return content;
    } else {
      return `Error: ${result.error || 'Unknown error'}`;
    }
  } catch (error: any) {
    return `Tool execution error: ${error.message}`;
  }
}

export async function spawnAgent(
  task: string,
  agentType: string,
  context?: string
): Promise<ToolResult> {
  const startTime = Date.now();

  // USE PYTHON SCRIPT - BYPASSES BROKEN ELECTRON/TYPESCRIPT PIPELINE
  safeLog('\n' + '🐍'.repeat(30));
  safeLog('🚀 SPAWN_AGENT VIA PYTHON (Direct DeepSeek)');
  safeLog(`   Agent Type: ${agentType}`);
  safeLog(`   Task Preview: ${task.slice(0, 100)}...`);
  safeLog(`   Timestamp: ${new Date().toISOString()}`);
  safeLog('🐍'.repeat(30));

  try {
    // Path to Python agent script
    // In production (electron-builder), use app.getPath('userData')/../
    // In development, use process.cwd()
    const isDev = process.env.NODE_ENV === 'development';
    const projectRoot = isDev ? process.cwd() : path.join(app.getPath('userData'), '..', '..', '..');
    const scriptPath = path.join(projectRoot, 'scripts', 'deepseek_agent.py');

    safeLog(`   Project root: ${projectRoot}`);
    safeLog(`   Script path: ${scriptPath}`);

    // Build command arguments
    const args = [scriptPath, task, agentType];
    if (context) {
      args.push(context);
    }

    safeLog(`🐍 Executing: python3 ${scriptPath}`);

    // Execute Python script - use spawnSync to prevent command injection
    // SECURITY: spawnSync passes args directly, no shell interpretation
    const pythonArgs = [scriptPath, task, agentType];
    if (context) pythonArgs.push(context);

    // SECURITY: Whitelist environment variables (prevent API key exposure to Python script)
    const safeEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      TMPDIR: process.env.TMPDIR,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, // Needed for agent to work
      // DO NOT pass other API keys or secrets
    };

    const result = spawnSync('python3', pythonArgs, {
      encoding: 'utf-8',
      timeout: 600000, // 10 minute timeout - DeepSeek can be slow
      env: safeEnv,  // Whitelisted vars only
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      stdio: ['pipe', 'pipe', 'pipe'] // Capture stdout and stderr
    });

    const elapsed = Date.now() - startTime;

    // Check for timeout (SIGTERM signal)
    if (result.signal === 'SIGTERM') {
      safeLog(`❌ Python agent timed out after ${elapsed}ms`);
      return {
        success: false,
        content: '',
        error: `Agent timed out after ${Math.floor(elapsed / 1000)}s (max 600s). Task may be too complex. Try breaking into smaller steps.`
      };
    }

    // Check for spawn errors
    if (result.error) {
      safeLog(`❌ Python spawn error: ${result.error.message}`);
      return {
        success: false,
        content: '',
        error: `Failed to spawn Python: ${result.error.message}`
      };
    }

    // Check for non-zero exit
    if (result.status !== 0) {
      safeLog(`❌ Python exited with code ${result.status}`);
      safeLog(`   stderr: ${result.stderr || 'none'}`);
      safeLog(`   stdout: ${result.stdout || 'none'}`);
      return {
        success: false,
        content: '',
        error: `Python agent failed (exit ${result.status}):\n${result.stderr || result.stdout || 'No output'}`
      };
    }

    safeLog(`🐍 Python agent completed in ${elapsed}ms`);
    // Log stderr for debugging (Python script logs to stderr)
    if (result.stderr) {
      safeLog(`   [stderr] ${result.stderr.slice(0, 500)}`);
    }

    return {
      success: true,
      content: `[${agentType.toUpperCase()} AGENT - DIRECT DEEPSEEK]\n[Time: ${elapsed}ms]\n\n${result.stdout}`
    };
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    safeLog(`❌ Python agent failed after ${elapsed}ms:`, error.message);

    // If Python script fails, return the error
    return {
      success: false,
      content: '',
      error: `Python agent failed: ${error.message}`
    };
  }
}

// OLD TYPESCRIPT IMPLEMENTATION - KEPT FOR REFERENCE
// @ts-ignore - unused reference implementation
async function spawnAgentTypescript(
  task: string,
  agentType: string,
  context?: string
): Promise<ToolResult> {
  const startTime = Date.now();

  safeLog('\n' + '='.repeat(60));
  safeLog('🚀 SPAWN_AGENT (TypeScript - DEPRECATED)');
  safeLog(`   Agent Type: ${agentType}`);
  safeLog('='.repeat(60));

  try {
    const deepseekClient = getDeepSeekClient();
    if (!deepseekClient) {
      return {
        success: false,
        content: '',
        error: 'DEEPSEEK_API_KEY not configured. Go to Settings to add your API key.'
      };
    }

    // Agent-specific system prompts with tool instructions
    const agentPrompts: Record<string, string> = {
      analyst: `You are a data analyst agent with FULL TOOL ACCESS.
You can read files, list directories, search code, write files, and run commands.
USE YOUR TOOLS to gather the information you need before providing analysis.
Do not ask for file contents - read them yourself using read_file.
Be thorough: explore the codebase, read relevant files, then provide specific, data-backed analysis.`,
      reviewer: `You are a code reviewer agent with FULL TOOL ACCESS.
You can read files, list directories, search code, and run tests.
USE YOUR TOOLS to read the actual code before reviewing.
Do not rely on context passed to you - read the files yourself for accuracy.
Be specific: cite line numbers, show code snippets, suggest concrete fixes.`,
      researcher: `You are a research agent with FULL TOOL ACCESS.
You can explore the codebase, read files, search for patterns, and run commands.
USE YOUR TOOLS to investigate thoroughly before drawing conclusions.
Provide comprehensive analysis with specific evidence from the code.`,
      coder: `You are a coding agent with FULL TOOL ACCESS.
You can read existing code, write new code, and run tests to verify your work.
USE YOUR TOOLS: read existing files to understand patterns, write your code, then test it.
Follow the coding style you observe in the codebase. Include error handling.`
    };

    const systemPrompt = agentPrompts[agentType.toLowerCase()] || agentPrompts.analyst;
    const userMessage = context ? `${task}\n\n## Initial Context:\n${context}` : task;

    // Initialize conversation
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ];

    // Agentic loop - iterate until model gives final answer (no more tool calls)
    const MAX_ITERATIONS = 15;
    let iterations = 0;
    let totalTokens = 0;
    let toolCallLog: string[] = [];

    safeLog('🔄 Starting agentic loop...');

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      safeLog(`\n   [Iteration ${iterations}/${MAX_ITERATIONS}]`);

      // CRITICAL: Log right before API call to prove we're hitting DeepSeek
      safeLog('🔵 ABOUT TO CALL DEEPSEEK API');
      safeLog(`   URL: https://api.deepseek.com/chat/completions`);
      safeLog(`   Model: deepseek-chat`);
      safeLog(`   Messages count: ${messages.length}`);

      // Call DeepSeek with tools
      const completion = await deepseekClient.chat.completions.create({
        model: 'deepseek-chat', // Using deepseek-chat which supports function calling
        messages,
        tools: AGENT_TOOLS,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 4000
      });

      // Log proof of API response
      safeLog('🟢 DEEPSEEK API RESPONDED');
      safeLog(`   Response ID: ${completion.id || 'NONE'}`);
      safeLog(`   Model used: ${completion.model || 'UNKNOWN'}`);
      safeLog(`   Tokens: ${JSON.stringify(completion.usage || {})}`);

      totalTokens += completion.usage?.total_tokens || 0;
      const message = completion.choices[0].message;

      // Check if model wants to call tools
      if (message.tool_calls && message.tool_calls.length > 0) {
        safeLog(`   📞 Agent requesting ${message.tool_calls.length} tool call(s)`);

        // Add assistant message with tool calls to conversation
        messages.push(message as OpenAI.Chat.ChatCompletionMessageParam);

        // Execute each tool call
        for (const toolCall of message.tool_calls) {
          if (toolCall.type !== 'function') continue;
          
          const toolName = toolCall.function.name;
          let toolArgs: Record<string, any> = {};

          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            toolArgs = {};
          }

          toolCallLog.push(`${toolName}(${JSON.stringify(toolArgs).slice(0, 50)}...)`);

          // Execute the tool
          const toolResult = await executeAgentTool(toolName, toolArgs);

          // Add tool result to conversation
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult
          });
        }
      } else {
        // No tool calls - this is the final response
        safeLog('   ✅ Agent finished (no more tool calls)');
        const finalResponse = message.content || 'Agent completed but returned no content.';

        const elapsed = Date.now() - startTime;
        const verificationToken = `AGENT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Format response with metadata
        const formattedResponse = `[${agentType.toUpperCase()} AGENT RESPONSE]
[VERIFIED: ${verificationToken} | Iterations: ${iterations} | Tools Used: ${toolCallLog.length} | Time: ${elapsed}ms | Tokens: ${totalTokens}]
[Tool Calls: ${toolCallLog.join(', ') || 'none'}]

${finalResponse}`;

        safeLog(`\n   🏁 Agent complete: ${iterations} iterations, ${toolCallLog.length} tool calls, ${elapsed}ms`);

        return {
          success: true,
          content: formattedResponse
        };
      }
    }

    // Max iterations reached
    const elapsed = Date.now() - startTime;
    return {
      success: true,
      content: `[${agentType.toUpperCase()} AGENT - MAX ITERATIONS]
Agent reached maximum iterations (${MAX_ITERATIONS}).
Tool calls made: ${toolCallLog.join(', ')}
Time elapsed: ${elapsed}ms
Tokens used: ${totalTokens}

The agent may not have fully completed the task. Consider breaking it into smaller tasks.`
    };

  } catch (error: any) {
    console.error('❌ Agent spawn error:', error);
    return {
      success: false,
      content: '',
      error: `Agent spawn failed: ${error.message || String(error)}`
    };
  }
}

// Interface for parallel agent configuration
interface ParallelAgentConfig {
  id: string;
  task: string;
  agent_type: string;
  context?: string;
}

/**
 * Spawn multiple agents in PARALLEL with full tool calling capabilities
 * This is MUCH faster than sequential spawn_agent calls for independent tasks
 */
export async function spawnAgentsParallel(
  agents: ParallelAgentConfig[]
): Promise<ToolResult> {
  const startTime = Date.now();

  safeLog('\n' + '🐍🐍'.repeat(30));
  safeLog('🚀🚀 SPAWN_AGENTS_PARALLEL - PYTHON (Direct DeepSeek)');
  safeLog(`   Spawning ${agents.length} agents in parallel`);
  agents.forEach((a, i) => safeLog(`   Agent ${i + 1}: ${a.id} (${a.agent_type})`));
  safeLog(`   Timestamp: ${new Date().toISOString()}`);
  safeLog('🐍🐍'.repeat(30));

  try {
    // Launch all agents in parallel - reuse Python implementation
    const agentPromises = agents.map(async (agentConfig) => {
      safeLog(`\n   [${agentConfig.id}] Starting Python agent: ${agentConfig.agent_type}`);
      const agentStartTime = Date.now();

      try {
        // Use the same Python script approach as spawn_agent
        const result = await spawnAgent(
          agentConfig.task,
          agentConfig.agent_type,
          agentConfig.context
        );

        const elapsed = Date.now() - agentStartTime;
        safeLog(`   [${agentConfig.id}] ✅ Completed in ${elapsed}ms`);

        return {
          id: agentConfig.id,
          success: result.success,
          content: result.content,
          error: result.error,
          elapsed
        };
      } catch (error: any) {
        const elapsed = Date.now() - agentStartTime;
        safeLog(`   [${agentConfig.id}] ❌ Failed in ${elapsed}ms: ${error.message}`);

        return {
          id: agentConfig.id,
          success: false,
          content: '',
          error: error.message,
          elapsed
        };
      }
    });

    // Wait for all agents to complete
    const results = await Promise.all(agentPromises);
    const totalElapsed = Date.now() - startTime;

    // Format results
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    let formattedOutput = `[PARALLEL AGENTS COMPLETE]
[Spawned: ${agents.length} | Succeeded: ${successCount} | Failed: ${failCount} | Total Time: ${totalElapsed}ms]

`;

    for (const result of results) {
      formattedOutput += `\n${'='.repeat(50)}\n`;
      formattedOutput += `## Agent: ${result.id} (${result.success ? '✅ SUCCESS' : '❌ FAILED'}) [${result.elapsed}ms]\n`;
      formattedOutput += `${'='.repeat(50)}\n`;

      if (result.success) {
        formattedOutput += result.content;
      } else {
        formattedOutput += `Error: ${result.error}`;
      }
      formattedOutput += '\n';
    }

    safeLog(`\n🏁 All ${agents.length} parallel agents complete in ${totalElapsed}ms`);

    return {
      success: failCount === 0,
      content: formattedOutput,
      error: failCount > 0 ? `${failCount} agent(s) failed` : undefined
    };

  } catch (error: any) {
    console.error('❌ Parallel agent spawn error:', error);
    return {
      success: false,
      content: '',
      error: `Parallel agent spawn failed: ${error.message || String(error)}`
    };
  }
}


// ==================== CLAUDE CODE CLI EXECUTION ====================

/**
 * Circuit breaker for Claude Code CLI to prevent cascade failures
 */
const claudeCodeCircuitBreaker = {
  failureCount: 0,
  lastFailure: 0,
  threshold: 3,
  resetTimeout: 5 * 60 * 1000, // 5 minute reset

  shouldExecute(): boolean {
    if (this.failureCount >= this.threshold) {
      const timeSinceLastFailure = Date.now() - this.lastFailure;
      if (timeSinceLastFailure < this.resetTimeout) {
        return false; // Circuit open - too many recent failures
      }
      // Reset after timeout period
      this.failureCount = 0;
    }
    return true;
  },

  recordSuccess(): void {
    this.failureCount = 0; // Reset on success
  },

  recordFailure(): void {
    this.failureCount++;
    this.lastFailure = Date.now();
  },

  getStatus(): { open: boolean; failures: number; timeUntilReset: number } {
    const timeSinceLastFailure = Date.now() - this.lastFailure;
    const open = this.failureCount >= this.threshold && timeSinceLastFailure < this.resetTimeout;
    return {
      open,
      failures: this.failureCount,
      timeUntilReset: open ? this.resetTimeout - timeSinceLastFailure : 0
    };
  }
};

// ============================================================================
// QUANT SKILL ROUTING SYSTEM
// Automatically detects quant tasks and injects mandatory skill methodology
// ============================================================================

interface SkillRoute {
  builder: string;
  auditors: string[];
  description: string;
}

const SKILL_ROUTES: Record<string, SkillRoute> = {
  'backtest': {
    builder: 'backtest-architect',
    auditors: ['backtest-bias-auditor', 'strategy-logic-auditor'],
    description: 'Backtesting infrastructure with bias detection'
  },
  'strategy': {
    builder: 'options-strategy-builder',
    auditors: ['strategy-logic-auditor', 'overfitting-detector'],
    description: 'Trading strategy with logic validation'
  },
  'data_pipeline': {
    builder: 'financial-data-engineer',
    auditors: ['data-quality-auditor'],
    description: 'Data pipeline with quality validation'
  },
  'ml_model': {
    builder: 'ml-timeseries-expert',
    auditors: ['ml-model-validator', 'overfitting-detector', 'statistical-validator'],
    description: 'ML model with overfitting detection'
  },
  'validation': {
    builder: 'performance-analyst',
    auditors: ['statistical-validator', 'monte-carlo-simulator'],
    description: 'Performance validation with statistical rigor'
  },
  'feature_engineering': {
    builder: 'feature-engineering-quant',
    auditors: ['backtest-bias-auditor'],
    description: 'Feature engineering with look-ahead bias prevention'
  },
  'risk_management': {
    builder: 'risk-management-expert',
    auditors: ['options-risk-specialist'],
    description: 'Risk framework with Greeks management'
  },
  'options': {
    builder: 'options-pricing-expert',
    auditors: ['options-risk-specialist', 'options-execution-expert'],
    description: 'Options pricing and execution'
  }
};

/**
 * Detect the type of quant task from the task description
 * Returns null if not a recognized quant task (will skip skill injection)
 */
function detectQuantTaskType(task: string): string | null {
  const lower = task.toLowerCase();

  // Order matters - more specific matches first
  if (lower.includes('backtest') || lower.includes('back-test') || lower.includes('historical test')) {
    return 'backtest';
  }
  if (lower.includes('ml ') || lower.includes('machine learning') || lower.includes('train') && lower.includes('model')) {
    return 'ml_model';
  }
  if (lower.includes('feature') && (lower.includes('engineer') || lower.includes('create') || lower.includes('build'))) {
    return 'feature_engineering';
  }
  if (lower.includes('data') && (lower.includes('pipeline') || lower.includes('clean') || lower.includes('load'))) {
    return 'data_pipeline';
  }
  if (lower.includes('option') && (lower.includes('price') || lower.includes('greek') || lower.includes('vol'))) {
    return 'options';
  }
  if (lower.includes('risk') && (lower.includes('manage') || lower.includes('size') || lower.includes('limit'))) {
    return 'risk_management';
  }
  if (lower.includes('validate') || lower.includes('performance') || lower.includes('statistical')) {
    return 'validation';
  }
  if (lower.includes('strategy') || lower.includes('signal') || lower.includes('entry') || lower.includes('exit')) {
    return 'strategy';
  }

  return null; // Not a recognized quant task
}

/**
 * Build skill injection prompt for Claude Code
 * This MANDATES the Builder→Auditor methodology with 2x clean audit requirement
 */
function buildSkillInjectionPrompt(taskType: string): string {
  const route = SKILL_ROUTES[taskType];
  if (!route) return '';

  const auditorsList = route.auditors.map(a => `~/.claude/skills/${a}/SKILL.md`).join('\n   - ');
  // Build audit steps for display (referenced in template below via auditorsList)

  return `

## ⚠️ MANDATORY SKILL PROTOCOL (DO NOT SKIP) ⚠️

**Detected Task Type:** ${taskType} (${route.description})

This is a quant task that REQUIRES the Builder→Auditor methodology.
Skipping this protocol leads to bugs, look-ahead bias, and invalid results.

### STEP 1: BUILD (use ${route.builder} skill)

Before writing ANY code, read the builder skill:
\`\`\`bash
cat ~/.claude/skills/${route.builder}/SKILL.md
\`\`\`

Follow its methodology, patterns, and best practices for building this component.

### STEP 2: AUDIT (use ${route.auditors.join(', ')} skills)

After building, you MUST run audits. Read each auditor skill:
   - ${auditorsList}

Run the COMPLETE audit checklist from each skill. Common checks:
- Look-ahead bias (using future data)
- Off-by-one errors in indexing
- Survivorship bias in data
- Overfitting to historical data
- Missing edge case handling
- Incorrect calculations

### STEP 3: FIX & RE-AUDIT LOOP

If ANY issues are found:
1. FIX all identified issues
2. RE-RUN all auditors (full checklist, not just the failing items)
3. REPEAT until CLEAN

### STEP 4: CONFIRM 2 CONSECUTIVE CLEAN AUDITS

Your response MUST include this audit trail:

\`\`\`
=== AUDIT TRAIL ===
ROUND 1: [List issues found OR "CLEAN - No issues"]
ROUND 2: [List issues found OR "CLEAN - No issues"]
...continue until 2 consecutive CLEAN...

FINAL STATUS: ✅ CLEAN AUDIT 2/2 CONFIRMED
=== END AUDIT TRAIL ===
\`\`\`

### ❌ FAILURE CONDITIONS (will be rejected)

- Returning code without running audits
- Claiming "looks good" without reading the skill files
- Only 1 clean audit (need 2 consecutive)
- Skipping any auditor in the list
- Partial audit (must complete FULL checklist)

### ✅ SUCCESS CRITERIA

- All auditor skill checklists completed
- All issues fixed and verified
- 2 consecutive CLEAN audit rounds
- Audit trail included in response

**Remember: "If you didn't audit it, it's probably wrong."**

`;
}

/**
 * Execute a task via Claude Code CLI
 *
 * This bridges Gemini (reasoning) to Claude Code (execution) in the multi-model architecture.
 * Claude Code runs on the Claude Max subscription (fixed cost), making execution economical.
 *
 * Flow:
 * 1. Gemini reasons about what needs to be done
 * 2. Gemini calls this tool with the task and context
 * 3. This handler spawns Claude Code CLI with the prompt
 * 4. Claude Code executes (has full tool access: bash, python, files, git)
 * 5. Result returns to Gemini for synthesis
 *
 * Agent Strategy (Claude Code decides):
 * - Minor tasks: Claude handles directly or uses native Claude agents (free with Max)
 * - MASSIVE parallel: Claude spawns DeepSeek agents via curl (cost-efficient at scale)
 */
export async function executeViaClaudeCode(
  task: string,
  context?: string,
  parallelHint?: 'none' | 'minor' | 'massive',
  sessionId?: string
): Promise<ToolResult> {
  const startTime = Date.now();

  // ====== INPUT VALIDATION ======
  // Validate task is not empty
  if (!task || task.trim().length === 0) {
    return {
      success: false,
      content: '',
      error: 'Task cannot be empty'
    };
  }

  // Validate length to prevent buffer overflow
  const MAX_SIZE = 1024 * 1024; // 1MB
  if (task.length > MAX_SIZE) {
    return {
      success: false,
      content: '',
      error: `Task exceeds 1MB limit (${task.length} bytes)`
    };
  }

  if (context && context.length > MAX_SIZE) {
    return {
      success: false,
      content: '',
      error: `Context exceeds 1MB limit (${context.length} bytes)`
    };
  }

  // Validate parallelHint is valid enum value
  const validHints = ['none', 'minor', 'massive'];
  if (parallelHint && !validHints.includes(parallelHint)) {
    return {
      success: false,
      content: '',
      error: `Invalid parallel_hint: "${parallelHint}". Must be one of: ${validHints.join(', ')}`
    };
  }

  // Check circuit breaker before attempting execution
  if (!claudeCodeCircuitBreaker.shouldExecute()) {
    const status = claudeCodeCircuitBreaker.getStatus();
    return {
      success: false,
      content: '',
      error: `Claude Code circuit breaker is OPEN (${status.failures} recent failures). ` +
             `Will reset in ${Math.ceil(status.timeUntilReset / 1000)}s. ` +
             `This prevents cascade failures when Claude Code is unavailable.`
    };
  }

  // ====== USER APPROVAL FLOW ======
  // Queue command for user approval before execution
  const { queueCommandForApproval } = await import('../ipc-handlers/claudeCodeHandlers');
  
  safeLog('\n' + '⏳'.repeat(30));
  safeLog('🔔 AWAITING USER APPROVAL FOR CLAUDE CODE EXECUTION');
  safeLog(`   Task: ${task.slice(0, 100)}${task.length > 100 ? '...' : ''}`);
  safeLog(`   Parallel hint: ${parallelHint || 'none'}`);
  safeLog('⏳'.repeat(30));
  
  const approved = await queueCommandForApproval(
    { task, context, files: [], timeout: 300000 },
    parallelHint
  );
  
  if (!approved) {
    safeLog('❌ CLAUDE CODE EXECUTION REJECTED BY USER');
    return {
      success: false,
      content: '',
      error: 'Claude Code execution was rejected by user. Command not sent.'
    };
  }
  
  safeLog('✅ CLAUDE CODE EXECUTION APPROVED BY USER');

  safeLog('\n' + '🔵'.repeat(30));
  safeLog('🚀 EXECUTE VIA CLAUDE CODE CLI (ASYNC)');
  safeLog(`   Task: ${task.slice(0, 100)}${task.length > 100 ? '...' : ''}`);
  safeLog(`   Context provided: ${context ? 'yes' : 'no'}`);
  safeLog(`   Parallel hint: ${parallelHint || 'none'}`);
  safeLog(`   Session ID: ${sessionId || 'none (results will not be inserted to chat)'}`);
  safeLog(`   Timestamp: ${new Date().toISOString()}`);
  safeLog('🔵'.repeat(30));

  try {
    // Build the prompt for Claude Code
    // SECURITY: Use markdown code fencing to prevent prompt injection
    let prompt = `# Task from Quant Engine (Gemini 3 Pro)

## Task
\`\`\`
${task}
\`\`\`
`;

    if (context) {
      prompt += `
## Context (Gemini's Analysis)
\`\`\`
${context}
\`\`\`
`;
    }

    // ====== SKILL INJECTION ======
    // Detect quant task type and inject mandatory skill protocol
    const detectedTaskType = detectQuantTaskType(task);
    if (detectedTaskType) {
      const skillPrompt = buildSkillInjectionPrompt(detectedTaskType);
      prompt += skillPrompt;
      safeLog(`   🎯 Detected quant task type: ${detectedTaskType}`);
      safeLog(`   📚 Injecting skill protocol: ${SKILL_ROUTES[detectedTaskType].builder} → ${SKILL_ROUTES[detectedTaskType].auditors.join(', ')}`);
    } else {
      safeLog('   ℹ️ No quant task type detected - proceeding without skill injection');
    }

    prompt += `
## Instructions
- Execute this task completely
- You have full tool access: bash, python, file operations, git
- Report results clearly
- If the task requires multiple steps, complete all of them

## Execution Environment Details

**Project Structure:**
\`\`\`
/Users/zstoc/GitHub/quant-engine/
├── python/                    # Python quant engine (YOU ARE HERE)
│   ├── server.py              # Flask server (port 5000)
│   ├── engine/                # Core modules
│   │   ├── data/              # Data loaders, features
│   │   ├── analysis/          # Regime detection, metrics
│   │   ├── trading/           # Backtesting, strategies
│   │   ├── pricing/           # Options pricing, Greeks
│   │   └── plugins/           # Extensible analysis plugins
│   └── requirements.txt       # Python dependencies
├── src/                       # React/Electron frontend
└── SESSION_STATE.md           # Current project state
\`\`\`

**Data Storage:**
- Market Data: /Volumes/VelocityData/market_data/ (8TB external SSD)
  - Options: /us_options_opra/day_aggs_v1/
  - Stocks: /velocity_om/parquet/stock/
- Use yfinance as fallback if VelocityData unavailable

**Python Environment:**
- Version: 3.14.0
- Key Packages: pandas, numpy, scipy, flask, yfinance
- Check requirements.txt for full dependency list

**Your Tools:**
- **Bash:** Full shell access (cd, ls, mkdir, grep, curl, etc.)
- **Python:** Execute any .py script with arguments
- **Git:** Status, commit, push, branches, etc. (full access)
- **File I/O:** Read, write, search any file in project
`;

    // Add agent strategy based on parallel hint
    if (parallelHint === 'massive') {
      prompt += `
## Parallel Execution (MASSIVE scale indicated)
For this task, use DeepSeek agents for cost-efficient parallel processing.
Script: python3 scripts/deepseek_agent.py "<task>" "<agent_type>" "<context>"
Agent types: analyst, reviewer, researcher, coder
Spawn multiple agents in parallel when tasks are independent.
Example: python3 scripts/deepseek_agent.py "Analyze regime 3" "analyst" &
`;
    } else if (parallelHint === 'minor') {
      prompt += `
## Parallel Execution (minor scale)
You may spawn native Claude agents for parallel work if beneficial (covered by Max subscription).
`;
    }
    // For 'none' or undefined, no special agent instructions - Claude handles directly

    // Check if Claude Code CLI is available
    const whichResult = spawnSync('which', ['claude'], {
      encoding: 'utf-8',
      timeout: 5000
    });

    if (whichResult.status !== 0 || !whichResult.stdout?.trim()) {
      safeLog('❌ Claude Code CLI not found');
      return {
        success: false,
        content: '',
        error: 'Claude Code CLI not installed or not in PATH. Install from: https://github.com/anthropics/claude-code'
      };
    }

    safeLog(`   Claude Code found at: ${whichResult.stdout.trim()}`);

    // Get the quant-engine project root for working directory
    const isDev = process.env.NODE_ENV === 'development';
    const projectRoot = isDev ? process.cwd() : path.join(app.getPath('userData'), '..', '..', '..');
    const resolved = path.resolve(projectRoot); // Resolve symlinks

    // VALIDATION: Verify this is actually a project directory
    const gitDir = path.join(resolved, '.git');
    const packageFile = path.join(resolved, 'package.json');
    const pythonDir = path.join(resolved, 'python');

    if (!fs.existsSync(gitDir) && !fs.existsSync(packageFile) && !fs.existsSync(pythonDir)) {
      safeLog(`❌ Working directory validation failed: ${resolved}`);
      return {
        success: false,
        content: '',
        error: `Cannot verify project root at ${resolved}. Expected .git, package.json, or python/ directory.`
      };
    }

    safeLog(`   Working directory: ${resolved} ✓`);

    // Add SESSION_STATE.md if it exists
    const sessionStatePath = path.join(resolved, 'SESSION_STATE.md');
    if (fs.existsSync(sessionStatePath)) {
      const sessionState = fs.readFileSync(sessionStatePath, 'utf-8');
      safeLog(`   Including SESSION_STATE.md (${sessionState.length} bytes)`);

      prompt += `

## Project Current State (from SESSION_STATE.md)

${sessionState}

**IMPORTANT:**
- Don't break anything marked "Working"
- Focus on "In Progress" and "Next Actions"
- Known issues are listed in "Broken" section
`;
    }

    // Add result file instructions if session_id is provided
    if (sessionId) {
      prompt += `
## CRITICAL: Result File (MUST DO)

**Session ID:** ${sessionId}
**Result File Path:** /tmp/claude-code-results/${sessionId}.json

When you complete this task, you MUST write your results to the JSON file above.
This allows Quant Engine to display your results in the chat UI.

**Write the result file using this exact format:**
\`\`\`bash
mkdir -p /tmp/claude-code-results
cat > /tmp/claude-code-results/${sessionId}.json << 'RESULT_EOF'
{
  "session_id": "${sessionId}",
  "content": "Your detailed response here. Include everything the user needs to know.",
  "task_summary": "Brief 1-line summary of what you accomplished",
  "files_created": ["path/to/new/file.py"],
  "files_modified": ["path/to/modified/file.py"],
  "display_directives": [],
  "exit_code": 0
}
RESULT_EOF
\`\`\`

**For display directives (charts/tables), add to the array:**
\`\`\`json
"display_directives": [
  {"type": "line_chart", "data": {"title": "Equity Curve", "series": [...]}},
  {"type": "metrics_dashboard", "data": {"sharpe": 1.5, "max_dd": -0.12}}
]
\`\`\`

`;
    }

    prompt += `
## Expected Response Format

Structure your response clearly:

**Summary:** <What you accomplished in 1-2 sentences>

**Results:**
<Data, output, or confirmation. Use UI directives if displaying charts/tables>

**Files Modified:**
- path/to/file1.py (created)
- path/to/file2.py (updated lines 45-67)

**Issues:** <Any problems encountered, or "None">

**Next Steps:** <If task is incomplete, what remains>

## Output Limits

- **Maximum output size:** 10MB
- **If output exceeds limit:** First 10MB returned + truncation notice
- **For large results:** Write to file and return file path instead

Example for large data:
\`\`\`python
# Don't print 100MB of data
results.to_csv('/tmp/backtest_results.csv')
print("Results written to /tmp/backtest_results.csv (15MB)")
\`\`\`

## Context Verification

Task context and reasoning from Gemini are included below. Verify you understand:
- The problem being solved
- Any constraints or limitations
- Expected outcomes
`;

    // M11: Add context preservation validation logging
    if (context) {
      safeLog(`   Context provided: ${context.length} bytes`);
      safeLog(`   Context preview: ${context.slice(0, 200)}...`);

      prompt += `
## Context (Gemini's Analysis)
\`\`\`
${context}
\`\`\`
`;
    }

    safeLog('🔵 Executing Claude Code CLI...');

    // Execute Claude Code CLI via visible Terminal with background fallback
    safeLog('   Setting up Claude Code execution...');

    // Create temp files for output
    const outputFile = path.join(process.env.TMPDIR || '/tmp', `clauded-output-${Date.now()}.txt`);
    const promptFile = path.join(process.env.TMPDIR || '/tmp', `clauded-prompt-${Date.now()}.txt`);

    // Write prompt to file to avoid shell escaping issues
    fs.writeFileSync(promptFile, prompt);

    // Build command that runs in Terminal with BOTH:
    // 1. Visible output you can watch
    // 2. Output captured to file for return to Gemini
    // 3. Terminal stays open for follow-up interaction
    // Sanitize task preview: remove newlines and escape special chars for shell
    const taskPreview = task.slice(0, 100).replace(/[\n\r]/g, ' ').replace(/"/g, '\\"');

    // HYBRID MODE:
    // - Use --print for initial task (completes and captures output)
    // - Tee output to both screen AND file
    // - After completion, drop into interactive bash so user can run more commands
    // - User can run `claude` again for follow-up interaction
    const terminalCommand = `cd "${resolved}" && echo "🚀 Claude Code Execution" && echo "Working directory: ${resolved}" && echo "Task: ${taskPreview}..." && echo "" && echo "=====================================" && claude --print --output-format text "$(cat ${promptFile})" 2>&1 | tee ${outputFile}; EXIT_CODE=$?; echo "__EXIT_CODE__:$EXIT_CODE" >> ${outputFile}; echo ""; echo "=====================================" && echo "✅ Task complete (exit: $EXIT_CODE)" && echo "" && echo "💡 Terminal stays open - run 'claude' for follow-up interaction" && echo "=====================================" && exec bash`;

    // Try to open Terminal.app with the command (visible for monitoring)
    const appleScript = `
tell application "Terminal"
  activate
  set newTab to do script "${terminalCommand.replace(/"/g, '\\"')}"
end tell
`;

    safeLog('   Opening Terminal window for monitoring...');
    const terminalResult = spawnSync('osascript', ['-e', appleScript], {
      encoding: 'utf-8',
      timeout: 5000
    });

    // Declare result variable for use in both paths
    let result: { stdout: string; stderr: string; status: number };

    if (terminalResult.status !== 0) {
      safeLog(`⚠️ Terminal launch failed: ${terminalResult.stderr}`);
      safeLog(`   Falling back to background execution (no visible Terminal)`);

      // Fallback: Execute claude in background without Terminal
      // Note: -p is --print (not prompt), prompt goes at end as positional arg
      const bgResult = spawnSync('claude', ['--print', '--output-format', 'text', prompt], {
        encoding: 'utf-8',
        cwd: resolved,
        timeout: 600000, // 10 minutes
        maxBuffer: 10 * 1024 * 1024,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USER: process.env.USER,
          TMPDIR: process.env.TMPDIR,
          NODE_ENV: process.env.NODE_ENV,
        }
      });

      const elapsed = Date.now() - startTime;

      // Check for timeout
      if (bgResult.signal === 'SIGTERM') {
        claudeCodeCircuitBreaker.recordFailure();
        return {
          success: false,
          content: '',
          error: `Claude Code timed out after ${Math.floor(elapsed / 1000)}s`
        };
      }

      // Check for errors
      if (bgResult.error) {
        claudeCodeCircuitBreaker.recordFailure();
        return {
          success: false,
          content: '',
          error: `Failed to spawn Claude Code: ${bgResult.error.message}`
        };
      }

      // Success - process result
      const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB
      let stdout = bgResult.stdout;

      if (stdout.length > MAX_OUTPUT_SIZE) {
        safeLog(`⚠️ Large output (${(stdout.length / 1024 / 1024).toFixed(1)}MB), truncating to 10MB`);
        stdout = stdout.slice(0, MAX_OUTPUT_SIZE) +
          `\n\n[⚠️ OUTPUT TRUNCATED: Output is ${(stdout.length / 1024 / 1024).toFixed(1)}MB, showing first 10MB]`;
      }

      result = {
        stdout: stdout,
        stderr: bgResult.stderr,
        status: bgResult.status || 0
      };

      safeLog(`✅ Background execution completed (exit ${result.status})`);

      // Cleanup temp files
      if (fs.existsSync(promptFile)) fs.unlinkSync(promptFile);
      if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
    } else {
      // ASYNC MODE: Terminal opened successfully, return immediately
      // Results will be picked up by the file watcher and inserted as chat messages
      safeLog('   ✅ Terminal window opened - returning immediately (async mode)');
      safeLog(`   Results will be written to: /tmp/claude-code-results/${sessionId || 'no-session'}.json`);

      const elapsed = Date.now() - startTime;

      // Record success in circuit breaker (we successfully delegated)
      claudeCodeCircuitBreaker.recordSuccess();

      // Return success with delegation message
      return {
        success: true,
        content: JSON.stringify({
          type: 'claude-code-delegation',
          status: 'delegated',
          message: `Task delegated to Claude Code. Running in Terminal window.${sessionId ? ' Results will appear in chat when complete.' : ''}`,
          sessionId: sessionId || null,
          resultFile: sessionId ? `/tmp/claude-code-results/${sessionId}.json` : null,
          timestamp: new Date().toISOString(),
          duration: elapsed,
          metadata: {
            hasContext: !!context,
            parallelHint: parallelHint || 'none',
            taskLength: task.length,
            contextLength: context?.length || 0
          }
        }, null, 2),
        metadata: {
          delegated: true,
          sessionId: sessionId || null,
          elapsed
        }
      };
    }

    // This code only runs for background fallback
    const elapsed = Date.now() - startTime;

    // Check for non-zero exit (background fallback only)
    if (result.status !== 0) {
      safeLog(`❌ Claude Code exited with code ${result.status}`);
      safeLog(`   stderr: ${result.stderr || 'none'}`);

      return {
        success: false,
        content: result.stdout || '',
        error: `Claude Code failed (exit ${result.status}):\n${result.stderr || 'No error details'}`
      };
    }

    safeLog(`✅ Claude Code background execution completed in ${elapsed}ms`);

    // Return structured JSON for programmatic parsing (background fallback)
    const structuredResponse = {
      type: 'claude-code-execution',
      status: result.status === 0 ? 'success' : 'failure',
      exitCode: result.status,
      duration: elapsed,
      stdout: result.stdout,
      stderr: result.stderr || '',
      timestamp: new Date().toISOString(),
      metadata: {
        hasContext: !!context,
        parallelHint: parallelHint || 'none',
        taskLength: task.length,
        contextLength: context?.length || 0,
        mode: 'background-fallback'
      }
    };

    // Record success in circuit breaker
    claudeCodeCircuitBreaker.recordSuccess();

    return {
      success: true,
      content: JSON.stringify(structuredResponse, null, 2),
      metadata: {
        elapsed,
        exitCode: result.status,
        hasContext: !!context,
        parallelHint: parallelHint || 'none'
      }
    };

  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    safeLog(`❌ Claude Code execution failed after ${elapsed}ms:`, error.message);

    // Record failure in circuit breaker
    claudeCodeCircuitBreaker.recordFailure();

    return {
      success: false,
      content: '',
      error: `Claude Code execution failed: ${error.message}`
    };
  }
}


// ==================== SUPABASE MEMORY HANDLERS ====================

async function handleSaveMemory(
  content: string,
  summary: string,
  memoryType: string,
  importance: number,
  tags?: string[]
): Promise<ToolResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      success: false,
      content: '',
      error: 'Supabase not configured - cannot save memory'
    };
  }

  try {
    // Generate embedding for the content using OpenAI
    let embedding: number[] | null = null;
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      const openai = new OpenAI({ apiKey: openaiKey });
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: content
      });
      embedding = embeddingResponse.data[0].embedding;
    }

    // Insert into memories table
    const { data, error } = await supabase
      .from('memories')
      .insert({
        content,
        summary,
        memory_type: memoryType,
        importance_score: importance / 5, // Normalize to 0-1
        embedding,
        created_at: new Date().toISOString(),
        // Store tags in a searchable format
        category: tags?.join(', ') || null
      })
      .select('id')
      .single();

    if (error) {
      console.error('[Memory] Save failed:', error);
      return {
        success: false,
        content: '',
        error: `Failed to save memory: ${error.message}`
      };
    }

    console.log('[Memory] Saved successfully:', data.id);
    return {
      success: true,
      content: JSON.stringify({
        message: 'Memory saved successfully',
        id: data.id,
        type: memoryType,
        importance,
        tags
      })
    };
  } catch (error) {
    console.error('[Memory] Save error:', error);
    return {
      success: false,
      content: '',
      error: error instanceof Error ? error.message : 'Unknown error saving memory'
    };
  }
}

async function handleRecallMemory(
  query: string,
  memoryType?: string,
  limit: number = 10
): Promise<ToolResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      success: false,
      content: '',
      error: 'Supabase not configured - cannot recall memories'
    };
  }

  try {
    // Try semantic search first if we have OpenAI
    let results: any[] = [];
    const openaiKey = process.env.OPENAI_API_KEY;

    if (openaiKey) {
      // Generate query embedding
      const openai = new OpenAI({ apiKey: openaiKey });
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: query
      });
      const queryEmbedding = embeddingResponse.data[0].embedding;

      // Call the match_memories RPC function if it exists
      const { data: semanticResults, error: rpcError } = await supabase
        .rpc('match_memories', {
          query_embedding: queryEmbedding,
          match_threshold: 0.5,
          match_count: limit
        });

      if (!rpcError && semanticResults) {
        results = semanticResults;
      }
    }

    // Fallback to text search if semantic search didn't return results
    if (results.length === 0) {
      let queryBuilder = supabase
        .from('memories')
        .select('id, content, summary, memory_type, importance_score, category, created_at')
        .or(`content.ilike.%${query}%,summary.ilike.%${query}%`)
        .order('importance_score', { ascending: false })
        .limit(limit);

      if (memoryType) {
        queryBuilder = queryBuilder.eq('memory_type', memoryType);
      }

      const { data, error } = await queryBuilder;
      if (error) {
        throw error;
      }
      results = data || [];
    }

    // Format results
    const formattedResults = results.map((m: any) => ({
      id: m.id,
      summary: m.summary,
      content: m.content?.substring(0, 500) + (m.content?.length > 500 ? '...' : ''),
      type: m.memory_type,
      importance: Math.round((m.importance_score || 0) * 5),
      tags: m.category,
      created: m.created_at,
      relevance: m.similarity || null
    }));

    return {
      success: true,
      content: JSON.stringify({
        query,
        count: formattedResults.length,
        memories: formattedResults
      }, null, 2)
    };
  } catch (error) {
    console.error('[Memory] Recall error:', error);
    return {
      success: false,
      content: '',
      error: error instanceof Error ? error.message : 'Unknown error recalling memories'
    };
  }
}


// ==================== MCP/OBSIDIAN HANDLERS ====================

const QUANT_ENGINE_OBSIDIAN_PREFIX = 'Projects/quant-engine';

async function handleObsidianReadNote(relativePath: string): Promise<ToolResult> {
  await ensureMCPInitialized();
  const mcp = getMCPManager();
  const fullPath = `${QUANT_ENGINE_OBSIDIAN_PREFIX}/${relativePath}`;

  const result = await mcp.obsidianReadNote(fullPath);

  if (result.success) {
    return {
      success: true,
      content: JSON.stringify(result.content, null, 2)
    };
  } else {
    return {
      success: false,
      content: '',
      error: result.error || 'Failed to read note'
    };
  }
}

async function handleObsidianWriteNote(relativePath: string, content: string): Promise<ToolResult> {
  await ensureMCPInitialized();
  const mcp = getMCPManager();
  const fullPath = `${QUANT_ENGINE_OBSIDIAN_PREFIX}/${relativePath}`;

  const result = await mcp.obsidianWriteNote(fullPath, content);

  if (result.success) {
    return {
      success: true,
      content: `Successfully wrote note: ${fullPath}`
    };
  } else {
    return {
      success: false,
      content: '',
      error: result.error || 'Failed to write note'
    };
  }
}

async function handleObsidianSearchNotes(query: string, limit: number = 10): Promise<ToolResult> {
  await ensureMCPInitialized();
  const mcp = getMCPManager();

  const result = await mcp.obsidianSearchNotes(query, limit);

  if (result.success) {
    return {
      success: true,
      content: JSON.stringify(result.content, null, 2)
    };
  } else {
    return {
      success: false,
      content: '',
      error: result.error || 'Failed to search notes'
    };
  }
}

async function handleObsidianListDirectory(relativePath: string): Promise<ToolResult> {
  await ensureMCPInitialized();
  const mcp = getMCPManager();
  const fullPath = relativePath === '/'
    ? QUANT_ENGINE_OBSIDIAN_PREFIX
    : `${QUANT_ENGINE_OBSIDIAN_PREFIX}/${relativePath}`;

  const result = await mcp.obsidianListDirectory(fullPath);

  if (result.success) {
    return {
      success: true,
      content: JSON.stringify(result.content, null, 2)
    };
  } else {
    return {
      success: false,
      content: '',
      error: result.error || 'Failed to list directory'
    };
  }
}

async function handleObsidianDocumentLearning(
  category: string,
  title: string,
  context: string,
  details: string,
  why: string,
  nextSteps?: string
): Promise<ToolResult> {
  await ensureMCPInitialized();
  const mcp = getMCPManager();

  // Determine folder based on category
  const categoryFolder = category === 'what-worked' ? 'what-worked'
    : category === 'what-failed' ? 'what-failed'
    : 'overfitting-warnings';

  // Create filename from title (kebab-case)
  const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const fullPath = `${QUANT_ENGINE_OBSIDIAN_PREFIX}/08-Learnings/${categoryFolder}/${filename}.md`;

  // Create structured content
  const date = new Date().toISOString().split('T')[0];
  const content = `# ${title}

**Date:** ${date}
**Category:** ${category}

## Context
${context}

## ${category === 'what-worked' ? 'What Worked' : category === 'what-failed' ? 'What We Tried' : 'The Trap'}
${details}

## ${category === 'what-worked' ? 'Why It Worked' : category === 'what-failed' ? 'Why It Failed' : 'How to Detect'}
${why}

${nextSteps ? `## ${category === 'what-worked' ? 'Replication Conditions' : category === 'what-failed' ? 'Alternative Approach' : 'Prevention'}
${nextSteps}` : ''}
`;

  const result = await mcp.obsidianWriteNote(fullPath, content);

  if (result.success) {
    return {
      success: true,
      content: `Learning documented: ${fullPath}`
    };
  } else {
    return {
      success: false,
      content: '',
      error: result.error || 'Failed to document learning'
    };
  }
}

async function handleObsidianDocumentBacktest(args: {
  strategy_name: string;
  start_date: string;
  end_date: string;
  sharpe_ratio: number;
  sortino_ratio?: number;
  max_drawdown: number;
  win_rate?: number;
  total_trades?: number;
  validated?: boolean;
  notes?: string;
}): Promise<ToolResult> {
  await ensureMCPInitialized();
  const mcp = getMCPManager();

  const date = new Date().toISOString().split('T')[0];
  const monthFolder = date.slice(0, 7); // YYYY-MM
  const filename = `${args.strategy_name}_${date}`;
  const fullPath = `${QUANT_ENGINE_OBSIDIAN_PREFIX}/07-Backtest-Results/${monthFolder}/${filename}.md`;

  const content = `# Backtest: ${args.strategy_name} - ${date}

## Data Range
- **Start:** ${args.start_date}
- **End:** ${args.end_date}

## Performance Metrics

| Metric | Value |
|--------|-------|
| Sharpe Ratio | ${args.sharpe_ratio.toFixed(2)} |
${args.sortino_ratio !== undefined ? `| Sortino Ratio | ${args.sortino_ratio.toFixed(2)} |` : ''}
| Max Drawdown | ${args.max_drawdown.toFixed(1)}% |
${args.win_rate !== undefined ? `| Win Rate | ${args.win_rate.toFixed(1)}% |` : ''}
${args.total_trades !== undefined ? `| Total Trades | ${args.total_trades} |` : ''}

## Validation Status
${args.validated ? '✅ Overfitting validation performed' : '⚠️ NOT YET VALIDATED - Run overfitting-detector before trusting results'}

${args.notes ? `## Notes
${args.notes}` : ''}

---
*Generated: ${new Date().toISOString()}*
`;

  const result = await mcp.obsidianWriteNote(fullPath, content);

  if (result.success) {
    return {
      success: true,
      content: `Backtest documented: ${fullPath}`
    };
  } else {
    return {
      success: false,
      content: '',
      error: result.error || 'Failed to document backtest'
    };
  }
}

// ==================== MCP KNOWLEDGE GRAPH HANDLERS ====================

async function handleKGSearch(query: string): Promise<ToolResult> {
  await ensureMCPInitialized();
  const mcp = getMCPManager();

  const result = await mcp.memorySearchNodes(query);

  if (result.success) {
    return {
      success: true,
      content: JSON.stringify(result.content, null, 2)
    };
  } else {
    return {
      success: false,
      content: '',
      error: result.error || 'Failed to search knowledge graph'
    };
  }
}

async function handleKGCreateEntity(
  name: string,
  entityType: string,
  observations: string[]
): Promise<ToolResult> {
  await ensureMCPInitialized();
  const mcp = getMCPManager();

  const result = await mcp.memoryCreateEntities([{
    name,
    entityType,
    observations
  }]);

  if (result.success) {
    return {
      success: true,
      content: `Entity created: ${name} (${entityType})`
    };
  } else {
    return {
      success: false,
      content: '',
      error: result.error || 'Failed to create entity'
    };
  }
}

async function handleKGCreateRelation(
  fromEntity: string,
  toEntity: string,
  relationType: string
): Promise<ToolResult> {
  await ensureMCPInitialized();
  const mcp = getMCPManager();

  const result = await mcp.memoryCreateRelations([{
    from: fromEntity,
    to: toEntity,
    relationType
  }]);

  if (result.success) {
    return {
      success: true,
      content: `Relation created: ${fromEntity} --[${relationType}]--> ${toEntity}`
    };
  } else {
    return {
      success: false,
      content: '',
      error: result.error || 'Failed to create relation'
    };
  }
}


// ==================== TOOL DISPATCHER ====================

export async function executeTool(
  name: string,
  args: Record<string, any>
): Promise<ToolResult> {
  safeLog(`[Tool] Executing: ${name}`, args);

  // Validate required arguments
  const toolDef = ALL_TOOLS.find(t => t.name === name);
  if (toolDef?.parameters?.required) {
    const missing: string[] = [];

    for (const requiredParam of toolDef.parameters.required) {
      if (!(requiredParam in args) || args[requiredParam] === undefined || args[requiredParam] === null) {
        missing.push(requiredParam);
      }
    }

    if (missing.length > 0) {
      safeLog(`[Tool] ERROR: Missing required parameters for ${name}:`, missing);
      return {
        success: false,
        content: '',
        error: `Missing required parameters for tool "${name}": ${missing.join(', ')}. Please provide all required arguments.`
      };
    }
  }

  switch (name) {
    // Direct response (no-op tool for conversational responses)
    case 'respond_directly':
      return {
        success: true,
        content: args.response || ''
      };

    // File operations
    case 'read_file':
      return readFile(args.path);
    case 'list_directory':
      return listDirectory(args.path);
    case 'search_code':
      return searchCode(args.pattern, args.path, args.file_pattern);
    case 'write_file':
      return writeFile(args.path, args.content);
    case 'append_file':
      return appendFile(args.path, args.content);
    case 'delete_file':
      return deleteFile(args.path);

    // Python execution
    case 'run_python_script':
      return runPythonScript(args.script_path, args.args, args.timeout_seconds);

    // Environment management
    case 'manage_environment':
      return manageEnvironment(args.action, args.package, args.upgrade);

    // Git operations
    case 'git_status':
      return gitStatus();
    case 'git_diff':
      return gitDiff(args.path, args.staged);
    case 'git_log':
      return gitLog(args.limit, args.path);
    case 'git_add':
      return gitAdd(args.path);
    case 'git_commit':
      return gitCommit(args.message);
    case 'git_branch':
      return gitBranch(args);
    case 'git_checkout':
      return gitCheckout(args.branch, args.create);
    case 'git_push':
      return gitPush(args as { remote?: string; branch?: string; force?: boolean });
    case 'git_pull':
      return gitPull(args as { remote?: string; branch?: string; rebase?: boolean });
    case 'git_fetch':
      return gitFetch(args as { remote?: string; prune?: boolean });

    // Validation
    case 'run_tests':
      return runTests(args.path, args.verbose);
    case 'validate_strategy':
      return validateStrategy(args.path);
    case 'dry_run_backtest':
      return dryRunBacktest(args.strategy_key, args.start_date, args.end_date, args.capital);
    case 'lint_code':
      return lintCode(args.path);
    case 'type_check':
      return typeCheck(args.path);

    case 'audit_strategy_robustness':
      // THE RED TEAM PROTOCOL - Run overfitting detection on a strategy
      return auditStrategyRobustness(args.strategy_key, args.aggressiveness || 'standard');

    case 'send_mobile_alert':
      // THE LIFELINE - Push notification via Pushover
      return sendMobileAlert(args.title, args.message, args.priority || 'normal', args.sound || 'pushover');

    case 'live_trading_gateway':
      // THE GRADUATION GATEKEEPER - Paper → Shadow → Live
      return liveTradingGateway(args.strategy_key, args.action, args.reason);

    // Analysis
    case 'find_function':
      return findFunction(args.name, args.path);
    case 'find_class':
      return findClass(args.name, args.path);
    case 'find_usages':
      return findUsages(args.symbol, args.path);
    case 'code_stats':
      return codeStats(args.path);

    // Backtest
    case 'batch_backtest':
      return batchBacktest(args.strategy_key, args.param_grid, args.start_date, args.end_date, args.capital);
    case 'sweep_params':
      return sweepParams(args.strategy_key, args.param_name, args.start, args.end, args.step, args.start_date, args.end_date, args.capital);
    case 'cross_validate':
      return crossValidate(args.strategy_key, args.params, args.start_date, args.end_date, args.num_folds, args.capital);

    // Quant Engine API
    case 'get_regime_heatmap':
      return getRegimeHeatmap(args.start_date, args.end_date);
    case 'list_strategies':
      return listStrategies();
    case 'get_strategy_details':
      return getStrategyDetails(args.strategy_id);
    case 'get_portfolio_greeks':
      // REAL DATA: Query Python engine for live portfolio Greeks
      try {
        safeLog(`[Greeks] Fetching real portfolio risk from ${PYTHON_SERVER_URL}...`);
        const greeksResponse = await fetch(`${PYTHON_SERVER_URL}/portfolio/greeks`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(5000),
        });

        if (!greeksResponse.ok) {
          return {
            success: false,
            content: '',
            error: `Python Engine Error (${greeksResponse.status}): Could not fetch live Greeks. Ensure server.py is running.`
          };
        }

        const greeksResult = await greeksResponse.json();
        const greeks = greeksResult.portfolio_greeks || {};
        const formatted = `
PORTFOLIO GREEKS (LIVE)
-----------------------
Net Delta: ${greeks.net_delta?.toFixed(2) || 0}
Net Gamma: ${greeks.net_gamma?.toFixed(4) || 0}
Net Theta: ${greeks.net_theta?.toFixed(2) || 0}
Net Vega:  ${greeks.net_vega?.toFixed(2) || 0}

Active Positions: ${greeksResult.position_count || 0}
Warnings: ${greeks.warnings?.join(', ') || 'None'}
`.trim();

        return { success: true, content: formatted, metadata: greeksResult };
      } catch (greeksError: any) {
        if (greeksError.code === 'ECONNREFUSED') {
          return {
            success: false,
            content: '',
            error: `CONNECTION REFUSED: Python engine is offline at ${PYTHON_SERVER_URL}. Start it with 'python server.py'.`
          };
        }
        return { success: false, content: '', error: `Greeks fetch failed: ${greeksError.message}` };
      }
    case 'run_simulation':
      return runScenarioSimulation(args.scenario, args.params, args.portfolio);
    case 'quant_engine_health':
      return checkQuantEngineHealth();

    // Data inspection
    case 'inspect_market_data':
      return inspectMarketData(args.symbol, args.start_date, args.end_date);
    case 'data_quality_check':
      return dataQualityCheck(args.symbol, args.start_date, args.end_date);
    case 'get_trade_log':
      return getTradeLog(args.run_id);

    // Agent spawning
    case 'spawn_agent':
      return spawnAgent(args.task, args.agent_type, args.context);
    case 'spawn_agents_parallel':
      return spawnAgentsParallel(args.agents);

    // Backup cleanup
    case 'cleanup_backups':
      return cleanupBackups(args.dryRun, args.olderThanDays);

    // Claude Code CLI execution (Gemini → Claude Code bridge)
    case 'execute_via_claude_code':
      return executeViaClaudeCode(args.task, args.context, args.parallel_hint, args.session_id);

    // MCP/Obsidian Knowledge Base tools
    case 'obsidian_read_note':
      return handleObsidianReadNote(args.path);
    case 'obsidian_write_note':
      return handleObsidianWriteNote(args.path, args.content);
    case 'obsidian_search_notes':
      return handleObsidianSearchNotes(args.query, args.limit);
    case 'obsidian_list_directory':
      return handleObsidianListDirectory(args.path);
    case 'obsidian_document_learning':
      return handleObsidianDocumentLearning(args.category, args.title, args.context, args.details, args.why, args.next_steps);
    case 'obsidian_document_backtest':
      return handleObsidianDocumentBacktest(args as {
        strategy_name: string;
        start_date: string;
        end_date: string;
        sharpe_ratio: number;
        sortino_ratio?: number;
        max_drawdown: number;
        win_rate?: number;
        total_trades?: number;
        validated?: boolean;
        notes?: string;
      });

    // MCP Knowledge Graph tools
    case 'kg_search':
      return handleKGSearch(args.query);
    case 'kg_create_entity':
      return handleKGCreateEntity(args.name, args.entity_type, args.observations);
    case 'kg_create_relation':
      return handleKGCreateRelation(args.from_entity, args.to_entity, args.relation_type);

    // Supabase Memory tools
    case 'save_memory':
      return handleSaveMemory(args.content, args.summary, args.memory_type, args.importance, args.tags);
    case 'recall_memory':
      return handleRecallMemory(args.query, args.memory_type, args.limit);

    default:
      return { success: false, content: '', error: `Unknown tool: ${name}` };
  }
}
