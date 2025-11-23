/**
 * Tool Handlers for Electron Main Process
 * Implements all tool functions using Node.js APIs
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec, execSync, spawn } from 'child_process';
import { promisify } from 'util';
import { glob } from 'glob';

const execAsync = promisify(exec);

// Tool execution timeout (30 seconds)
const TOOL_TIMEOUT_MS = 30000;

// Wrapper for execAsync with timeout
async function execWithTimeout(command: string, options?: { cwd?: string; maxBuffer?: number; timeout?: number }): Promise<{ stdout: string; stderr: string }> {
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
}

// Get rotation-engine root from environment or settings
function getEngineRoot(): string {
  return process.env.ROTATION_ENGINE_ROOT || path.join(process.env.HOME || '', 'rotation-engine');
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

export async function readFile(filePath: string): Promise<ToolResult> {
  try {
    const fullPath = safeResolvePath(filePath);

    if (!fs.existsSync(fullPath)) {
      return { success: false, content: '', error: `File not found: ${filePath}` };
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return {
      success: false,
      content: '',
      error: `Error reading file: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function listDirectory(dirPath: string): Promise<ToolResult> {
  try {
    const fullPath = safeResolvePath(dirPath || '.');

    if (!fs.existsSync(fullPath)) {
      return { success: false, content: '', error: `Directory not found: ${dirPath}` };
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const items = entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file'
    }));

    return { success: true, content: JSON.stringify(items, null, 2) };
  } catch (error) {
    return {
      success: false,
      content: '',
      error: `Error listing directory: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function searchCode(
  pattern: string,
  searchPath?: string,
  filePattern?: string
): Promise<ToolResult> {
  try {
    const root = getEngineRoot();
    const targetPath = searchPath ? safeResolvePath(searchPath) : root;

    // Use grep for searching
    let grepCmd = `grep -rn "${pattern.replace(/"/g, '\\"')}" "${targetPath}"`;

    if (filePattern) {
      grepCmd += ` --include="${filePattern}"`;
    }

    // Exclude common directories
    grepCmd += ' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=__pycache__ --exclude-dir=.venv';

    const { stdout, stderr } = await execWithTimeout(grepCmd, {
      maxBuffer: 10 * 1024 * 1024,
      cwd: root
    });

    // Parse grep output into structured results
    const lines = stdout.trim().split('\n').filter(Boolean);
    const matches = lines.slice(0, 50).map(line => {
      const match = line.match(/^([^:]+):(\d+):(.*)$/);
      if (match) {
        return {
          file: match[1].replace(root + '/', ''),
          line: parseInt(match[2]),
          context: match[3].trim()
        };
      }
      return { file: '', line: 0, context: line };
    });

    return {
      success: true,
      content: `Found ${lines.length} matches:\n${JSON.stringify(matches, null, 2)}`
    };
  } catch (error: any) {
    // grep returns exit code 1 when no matches found
    if (error.code === 1) {
      return { success: true, content: 'No matches found' };
    }
    return {
      success: false,
      content: '',
      error: `Search error: ${error.message}`
    };
  }
}

export async function writeFile(filePath: string, content: string): Promise<ToolResult> {
  try {
    const fullPath = safeResolvePath(filePath);
    const dir = path.dirname(fullPath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Create backup if file exists
    let backupPath: string | undefined;
    if (fs.existsSync(fullPath)) {
      backupPath = `${fullPath}.backup.${Date.now()}`;
      fs.copyFileSync(fullPath, backupPath);
    }

    fs.writeFileSync(fullPath, content, 'utf-8');

    let message = `File written: ${filePath}`;
    if (backupPath) {
      message += `\nBackup created: ${path.basename(backupPath)}`;
    }

    return { success: true, content: message };
  } catch (error) {
    return {
      success: false,
      content: '',
      error: `Error writing file: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function appendFile(filePath: string, content: string): Promise<ToolResult> {
  try {
    const fullPath = safeResolvePath(filePath);

    if (!fs.existsSync(fullPath)) {
      return { success: false, content: '', error: `File not found: ${filePath}` };
    }

    fs.appendFileSync(fullPath, content, 'utf-8');
    return { success: true, content: `Content appended to: ${filePath}` };
  } catch (error) {
    return {
      success: false,
      content: '',
      error: `Error appending to file: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function deleteFile(filePath: string): Promise<ToolResult> {
  try {
    const fullPath = safeResolvePath(filePath);

    if (!fs.existsSync(fullPath)) {
      return { success: false, content: '', error: `File not found: ${filePath}` };
    }

    // Create backup before deleting
    const backupPath = `${fullPath}.deleted.${Date.now()}`;
    fs.copyFileSync(fullPath, backupPath);
    fs.unlinkSync(fullPath);

    return {
      success: true,
      content: `File deleted: ${filePath}\nBackup saved: ${path.basename(backupPath)}`
    };
  } catch (error) {
    return {
      success: false,
      content: '',
      error: `Error deleting file: ${error instanceof Error ? error.message : String(error)}`
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
    const { stdout, stderr } = await execWithTimeout(`python -m py_compile "${fullPath}"`, { cwd: root });

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
  endDate: string
): Promise<ToolResult> {
  try {
    const root = getEngineRoot();

    // Run quick validation without full execution
    const cmd = `python -c "
from backtester import Backtester
bt = Backtester('${strategyKey}')
bt.validate_params('${startDate}', '${endDate}')
print('Dry run validation passed')
"`;

    const { stdout, stderr } = await execWithTimeout(cmd, { cwd: root });
    return { success: true, content: stdout || 'Dry run validation passed' };
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

    const { stdout, stderr } = await execWithTimeout(`mypy "${fullPath}"`, { cwd: root });
    return { success: true, content: stdout || 'Type checking passed' };
  } catch (error: any) {
    return { success: false, content: error.stdout || '', error: error.stderr || error.message };
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

    // Count Python files and lines
    const { stdout: fileCount } = await execWithTimeout(
      `find "${targetPath}" -name "*.py" -type f | wc -l`,
      { cwd: root }
    );

    const { stdout: lineCount } = await execWithTimeout(
      `find "${targetPath}" -name "*.py" -type f -exec cat {} + | wc -l`,
      { cwd: root }
    );

    const { stdout: funcCount } = await execWithTimeout(
      `grep -r "def " "${targetPath}" --include="*.py" | wc -l`,
      { cwd: root }
    );

    const { stdout: classCount } = await execWithTimeout(
      `grep -r "class " "${targetPath}" --include="*.py" | wc -l`,
      { cwd: root }
    );

    const stats = {
      pythonFiles: parseInt(fileCount.trim()),
      totalLines: parseInt(lineCount.trim()),
      functions: parseInt(funcCount.trim()),
      classes: parseInt(classCount.trim())
    };

    return {
      success: true,
      content: `Code Statistics:\n${JSON.stringify(stats, null, 2)}`
    };
  } catch (error: any) {
    return { success: false, content: '', error: error.message };
  }
}

// ==================== BACKTEST OPERATIONS ====================

export async function batchBacktest(
  strategyKey: string,
  paramGrid: string,
  startDate: string,
  endDate: string,
  capital?: number
): Promise<ToolResult> {
  try {
    const root = getEngineRoot();
    const grid = JSON.parse(paramGrid);

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
        error: `Too many combinations (${combinations.length}). Maximum is 100.`
      };
    }

    // Run backtests (simplified - in production would run in parallel)
    const results: any[] = [];
    for (const params of combinations.slice(0, 10)) { // Limit for demo
      results.push({
        params,
        status: 'simulated',
        note: 'Full backtest execution requires rotation-engine connection'
      });
    }

    return {
      success: true,
      content: `Batch backtest prepared:\n${combinations.length} combinations\nResults:\n${JSON.stringify(results, null, 2)}`
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
  endDate: string
): Promise<ToolResult> {
  try {
    const values: number[] = [];
    for (let v = start; v <= end; v += step) {
      values.push(v);
    }

    return {
      success: true,
      content: `Parameter sweep prepared:\n${paramName}: ${values.join(', ')}\nFull execution requires rotation-engine connection`
    };
  } catch (error: any) {
    return { success: false, content: '', error: error.message };
  }
}

export async function crossValidate(
  strategyKey: string,
  params: string,
  startDate: string,
  endDate: string,
  numFolds?: number
): Promise<ToolResult> {
  try {
    const folds = numFolds || 5;

    return {
      success: true,
      content: `Cross-validation prepared:\nStrategy: ${strategyKey}\nFolds: ${folds}\nPeriod: ${startDate} to ${endDate}\nFull execution requires rotation-engine connection`
    };
  } catch (error: any) {
    return { success: false, content: '', error: error.message };
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
  startDate: string,
  endDate: string
): Promise<ToolResult> {
  try {
    // First get the data
    const result = await inspectMarketData(symbol, startDate, endDate);

    if (!result.success) {
      return result;
    }

    return {
      success: true,
      content: `Data quality check for ${symbol}:\n${result.content}\n\nNote: Full quality analysis requires pandas/numpy processing`
    };
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

// ==================== TOOL DISPATCHER ====================

export async function executeTool(
  name: string,
  args: Record<string, any>
): Promise<ToolResult> {
  console.log(`[Tool] Executing: ${name}`, args);

  switch (name) {
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

    // Validation
    case 'run_tests':
      return runTests(args.path, args.verbose);
    case 'validate_strategy':
      return validateStrategy(args.path);
    case 'dry_run_backtest':
      return dryRunBacktest(args.strategy_key, args.start_date, args.end_date);
    case 'lint_code':
      return lintCode(args.path);
    case 'type_check':
      return typeCheck(args.path);

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
      return sweepParams(args.strategy_key, args.param_name, args.start, args.end, args.step, args.start_date, args.end_date);
    case 'cross_validate':
      return crossValidate(args.strategy_key, args.params, args.start_date, args.end_date, args.num_folds);

    // Data inspection
    case 'inspect_market_data':
      return inspectMarketData(args.symbol, args.start_date, args.end_date);
    case 'data_quality_check':
      return dataQualityCheck(args.symbol, args.start_date, args.end_date);
    case 'get_trade_log':
      return getTradeLog(args.run_id);

    default:
      return { success: false, content: '', error: `Unknown tool: ${name}` };
  }
}
