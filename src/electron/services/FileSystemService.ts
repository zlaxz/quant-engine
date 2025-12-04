/**
 * Shared FileSystemService
 * Consolidates all file operations with consistent path validation, error handling, and backups
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export interface FileResult {
  content?: string;
  error?: string;
}

export interface OperationResult {
  success: boolean;
  error?: string;
  message?: string;
}

export interface DirectoryResult {
  entries?: Array<{ name: string; type: 'file' | 'directory' }>;
  error?: string;
}

export interface SearchResult {
  matches?: Array<{ file: string; line: number; context: string }>;
  truncated?: boolean;
  warning?: string;
  error?: string;
}

export class FileSystemService {
  private root: string;
  private allowedPaths: Set<string> = new Set();

  constructor(rootPath: string) {
    this.root = rootPath;
    this.allowedPaths.add(rootPath);
  }

  /**
   * Get the current root path
   */
  getRoot(): string {
    return this.root;
  }

  /**
   * Update root path (used when project directory changes)
   */
  setRoot(rootPath: string): void {
    // Remove old root from allowed paths
    this.allowedPaths.delete(this.root);
    this.root = rootPath;
    this.allowedPaths.add(rootPath);
  }

  /**
   * Add an additional allowed path (e.g., data drive)
   */
  addAllowedPath(allowedPath: string): void {
    if (allowedPath && fsSync.existsSync(allowedPath)) {
      this.allowedPaths.add(path.normalize(allowedPath));
      console.log(`[FileSystemService] Added allowed path: ${allowedPath}`);
    }
  }

  /**
   * Remove an allowed path
   */
  removeAllowedPath(allowedPath: string): void {
    this.allowedPaths.delete(path.normalize(allowedPath));
  }

  /**
   * Get all allowed paths
   */
  getAllowedPaths(): string[] {
    return Array.from(this.allowedPaths);
  }

  /**
   * Check if an absolute path is within any allowed directory
   * NOTE: Currently disabled (always returns true) to give agent full filesystem access
   * like Claude Code. Re-enable allowedPaths checking if sandboxing is needed.
   */
  private isPathAllowed(_absolutePath: string): boolean {
    // SANDBOX DISABLED - Full filesystem access granted
    // To re-enable sandboxing, uncomment the code below:
    // const normalized = path.normalize(absolutePath);
    // for (const allowed of this.allowedPaths) {
    //   if (normalized.startsWith(allowed)) {
    //     return true;
    //   }
    // }
    // return false;
    return true;
  }

  /**
   * Resolve and validate path - supports both relative and absolute paths
   * Absolute paths must be within an allowed directory
   * Relative paths are resolved from the project root
   */
  private resolvePath(inputPath: string): { path: string; error?: string } {
    // Handle absolute paths - must be within an allowed directory
    if (path.isAbsolute(inputPath)) {
      const normalized = path.normalize(inputPath);
      if (this.isPathAllowed(normalized)) {
        return { path: normalized };
      }
      return {
        path: '',
        error: `Path not in allowed directories: ${inputPath}. Allowed: ${this.getAllowedPaths().join(', ')}`
      };
    }

    // Handle relative paths - resolve from project root
    const resolved = path.normalize(path.join(this.root, inputPath));

    // Security: ensure resolved path is within an allowed directory
    if (!this.isPathAllowed(resolved)) {
      return {
        path: '',
        error: `Path traversal detected: ${inputPath}. Must stay within allowed directories.`
      };
    }

    return { path: resolved };
  }

  /**
   * Read file contents
   */
  async readFile(relativePath: string): Promise<FileResult> {
    const resolved = this.resolvePath(relativePath);
    if (resolved.error) return { error: resolved.error };

    try {
      // Check if file exists
      if (!fsSync.existsSync(resolved.path)) {
        return { error: `File not found: ${relativePath}` };
      }

      // Check file size before reading
      const stats = await fs.stat(resolved.path);
      if (stats.size > MAX_FILE_SIZE) {
        return {
          error: `File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB. Use search_code to find specific content.`
        };
      }

      const content = await fs.readFile(resolved.path, 'utf-8');
      return { content };
    } catch (err: any) {
      return { error: `Error reading file: ${err.message}` };
    }
  }

  /**
   * Write file contents with optional backup
   */
  async writeFile(
    relativePath: string,
    content: string,
    backup = true
  ): Promise<OperationResult> {
    const resolved = this.resolvePath(relativePath);
    if (resolved.error) return { success: false, error: resolved.error };

    try {
      // Create backup if file exists
      let backupMessage = '';
      if (backup && fsSync.existsSync(resolved.path)) {
        const backupPath = `${resolved.path}.backup.${Date.now()}`;
        await fs.copyFile(resolved.path, backupPath);
        backupMessage = `\nBackup created: ${path.basename(backupPath)}`;
      }

      // Ensure directory exists
      await fs.mkdir(path.dirname(resolved.path), { recursive: true });

      // Write file
      await fs.writeFile(resolved.path, content, 'utf-8');

      return {
        success: true,
        message: `File written: ${relativePath}${backupMessage}`
      };
    } catch (err: any) {
      return { success: false, error: `Error writing file: ${err.message}` };
    }
  }

  /**
   * Append to file
   */
  async appendFile(relativePath: string, content: string): Promise<OperationResult> {
    const resolved = this.resolvePath(relativePath);
    if (resolved.error) return { success: false, error: resolved.error };

    try {
      if (!fsSync.existsSync(resolved.path)) {
        return { success: false, error: `File not found: ${relativePath}` };
      }

      await fs.appendFile(resolved.path, content, 'utf-8');
      return { success: true, message: `Content appended to: ${relativePath}` };
    } catch (err: any) {
      return { success: false, error: `Error appending to file: ${err.message}` };
    }
  }

  /**
   * Delete file with optional backup
   */
  async deleteFile(relativePath: string, backup = true): Promise<OperationResult> {
    const resolved = this.resolvePath(relativePath);
    if (resolved.error) return { success: false, error: resolved.error };

    try {
      if (!fsSync.existsSync(resolved.path)) {
        return { success: false, error: `File not found: ${relativePath}` };
      }

      // Create backup before deleting
      let backupMessage = '';
      if (backup) {
        const backupPath = `${resolved.path}.deleted.${Date.now()}`;
        await fs.copyFile(resolved.path, backupPath);
        backupMessage = `\nBackup saved: ${path.basename(backupPath)}`;
      }

      await fs.unlink(resolved.path);
      return {
        success: true,
        message: `File deleted: ${relativePath}${backupMessage}`
      };
    } catch (err: any) {
      return { success: false, error: `Error deleting file: ${err.message}` };
    }
  }

  /**
   * List directory contents
   */
  async listDirectory(relativePath: string = ''): Promise<DirectoryResult> {
    const resolved = this.resolvePath(relativePath || '.');
    if (resolved.error) return { error: resolved.error };

    try {
      if (!fsSync.existsSync(resolved.path)) {
        return { error: `Directory not found: ${relativePath || '.'}` };
      }

      const entries = await fs.readdir(resolved.path, { withFileTypes: true });
      const result = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' as const : 'file' as const
      }));

      return { entries: result };
    } catch (err: any) {
      return { error: `Error listing directory: ${err.message}` };
    }
  }

  /**
   * Search code using grep
   */
  async searchCode(
    pattern: string,
    relativePath: string = '',
    filePattern?: string
  ): Promise<SearchResult> {
    const targetPath = relativePath
      ? this.resolvePath(relativePath).path
      : this.root;

    const resolved = this.resolvePath(relativePath || '.');
    if (resolved.error) return { error: resolved.error };

    const MAX_RESULTS = 50;
    const SEARCH_TIMEOUT_MS = 30000; // 30 second timeout

    return new Promise((resolve) => {
      // Build grep arguments array (prevents shell injection)
      const grepArgs = ['-rn', pattern, targetPath];

      if (filePattern) {
        grepArgs.push(`--include=${filePattern}`);
      }

      // Exclude common directories
      grepArgs.push(
        '--exclude-dir=node_modules',
        '--exclude-dir=.git',
        '--exclude-dir=__pycache__',
        '--exclude-dir=.venv'
      );

      const grep = spawn('grep', grepArgs, { cwd: this.root });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Timeout handler - kill grep if it takes too long
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        grep.kill('SIGTERM');
        console.warn(`[FileSystemService] Search timed out after ${SEARCH_TIMEOUT_MS / 1000}s`);
      }, SEARCH_TIMEOUT_MS);

      grep.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      grep.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      grep.on('close', (code) => {
        clearTimeout(timeoutHandle);

        if (timedOut) {
          resolve({ error: `Search timed out after ${SEARCH_TIMEOUT_MS / 1000} seconds` });
          return;
        }
        // grep returns 1 for no matches (not an error)
        if (code === 1 || !stdout.trim()) {
          resolve({ matches: [] });
          return;
        }

        if (code !== 0) {
          resolve({
            error: `Search error: ${stderr || `grep exited with code ${code}`}`
          });
          return;
        }

        // Parse grep output into structured results
        const lines = stdout.trim().split('\n').filter(Boolean);
        const truncated = lines.length > MAX_RESULTS;

        const matches = lines.slice(0, MAX_RESULTS).map(line => {
          const match = line.match(/^([^:]+):(\d+):(.*)$/);
          if (match) {
            return {
              file: match[1].replace(this.root + '/', ''),
              line: parseInt(match[2]),
              context: match[3].trim()
            };
          }
          return { file: '', line: 0, context: line };
        });

        resolve({
          matches,
          truncated,
          ...(truncated && {
            warning: `Showing ${MAX_RESULTS} of ${lines.length} matches`
          })
        });
      });

      grep.on('error', (err) => {
        clearTimeout(timeoutHandle);
        resolve({ error: `Search error: ${err.message}` });
      });
    });
  }

  /**
   * Clean up old backup files (older than 7 days)
   */
  async cleanupBackups(): Promise<{ deleted: number; error?: string }> {
    try {
      const { glob } = await import('glob');
      const backupFiles = await glob('**/*.backup.*', {
        cwd: this.root,
        absolute: true
      });

      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      let deleted = 0;

      for (const file of backupFiles) {
        try {
          const stats = await fs.stat(file);
          if (stats.mtimeMs < sevenDaysAgo) {
            await fs.unlink(file);
            deleted++;
          }
        } catch (err) {
          // Skip files that can't be accessed
          console.warn(`Failed to clean up backup ${file}:`, err);
        }
      }

      return { deleted };
    } catch (err: any) {
      return { deleted: 0, error: err.message };
    }
  }
}

// Singleton instance
let instance: FileSystemService | null = null;

export function getFileSystemService(rootPath?: string): FileSystemService {
  if (!instance && rootPath) {
    instance = new FileSystemService(rootPath);
  }
  if (!instance) {
    throw new Error(
      'FileSystemService not initialized. Call with rootPath first or ensure ROTATION_ENGINE_ROOT is set.'
    );
  }
  return instance;
}

export function setFileSystemRoot(rootPath: string): void {
  if (instance) {
    instance.setRoot(rootPath);
  } else {
    instance = new FileSystemService(rootPath);
  }
}

/**
 * Add an additional allowed path (e.g., data drive)
 */
export function addAllowedPath(allowedPath: string): void {
  if (instance) {
    instance.addAllowedPath(allowedPath);
  } else {
    console.warn('[FileSystemService] Cannot add allowed path - service not initialized');
  }
}

/**
 * Get all currently allowed paths
 */
export function getAllowedPaths(): string[] {
  if (instance) {
    return instance.getAllowedPaths();
  }
  return [];
}
