/**
 * File system operations for rotation-engine codebase
 */

export interface FileResult {
  content?: string;
  error?: string;
}

export interface DirectoryResult {
  items?: Array<{ name: string; type: 'file' | 'directory' }>;
  error?: string;
}

export interface SearchResult {
  matches?: Array<{ file: string; line: number; content: string }>;
  error?: string;
}

function validatePath(path: string, engineRoot: string): { valid: boolean; fullPath: string; error?: string } {
  // Remove leading slash and normalize
  const cleanPath = path.replace(/^\/+/, '').replace(/\\/g, '/');
  
  // Check for directory traversal
  if (cleanPath.includes('..') || cleanPath.startsWith('/')) {
    return { valid: false, fullPath: '', error: 'Invalid path: directory traversal not allowed' };
  }
  
  const fullPath = `${engineRoot}/${cleanPath}`;
  return { valid: true, fullPath };
}

export async function readFile(path: string, engineRoot: string): Promise<FileResult> {
  try {
    const validation = validatePath(path, engineRoot);
    if (!validation.valid) {
      return { error: validation.error };
    }

    const content = await Deno.readTextFile(validation.fullPath);
    return { content };
  } catch (error) {
    return { error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function listDirectory(path: string, engineRoot: string): Promise<DirectoryResult> {
  try {
    const validation = validatePath(path || '.', engineRoot);
    if (!validation.valid) {
      return { error: validation.error };
    }

    const items: Array<{ name: string; type: 'file' | 'directory' }> = [];
    
    for await (const entry of Deno.readDir(validation.fullPath)) {
      items.push({
        name: entry.name,
        type: entry.isDirectory ? 'directory' : 'file'
      });
    }

    return { items: items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    }) };
  } catch (error) {
    return { error: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function searchCode(
  pattern: string,
  searchPath: string | undefined,
  filePattern: string | undefined,
  engineRoot: string
): Promise<SearchResult> {
  try {
    const validation = validatePath(searchPath || '.', engineRoot);
    if (!validation.valid) {
      return { error: validation.error };
    }

    // Validate regex pattern
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'i');
    } catch (regexError) {
      return { error: `Invalid regex pattern: ${regexError instanceof Error ? regexError.message : 'Unknown error'}` };
    }

    const matches: Array<{ file: string; line: number; content: string }> = [];

    async function searchDirectory(dir: string, relativePath: string = '') {
      for await (const entry of Deno.readDir(dir)) {
        const entryPath = `${dir}/${entry.name}`;
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory) {
          // Skip common non-code directories
          if (!['node_modules', '.git', '__pycache__', 'venv', '.venv'].includes(entry.name)) {
            await searchDirectory(entryPath, relPath);
          }
        } else if (entry.isFile) {
          // Apply file pattern filter if provided
          if (filePattern && !entry.name.match(new RegExp(filePattern.replace('*', '.*')))) {
            continue;
          }

          try {
            const content = await Deno.readTextFile(entryPath);
            const lines = content.split('\n');
            
            lines.forEach((line, index) => {
              if (regex.test(line)) {
                matches.push({
                  file: relPath,
                  line: index + 1,
                  content: line.trim()
                });
              }
            });
          } catch {
            // Skip files that can't be read as text
          }
        }
      }
    }

    await searchDirectory(validation.fullPath);
    return { matches };
  } catch (error) {
    return { error: `Search failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Write or overwrite file with backup creation and validation
 */
export async function writeFile(
  path: string,
  content: string,
  engineRoot: string
): Promise<{ success: boolean; backupPath?: string; error?: string }> {
  try {
    const validation = validatePath(path, engineRoot);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const fullPath = validation.fullPath;

    // Create backup if file exists
    let backupPath: string | undefined;
    try {
      await Deno.stat(fullPath);
      // File exists - create backup
      const backupDir = `${engineRoot}/.backups`;
      await Deno.mkdir(backupDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = path.split('/').pop();
      backupPath = `${backupDir}/${fileName}.${timestamp}.bak`;
      
      await Deno.copyFile(fullPath, backupPath);
    } catch {
      // File doesn't exist - no backup needed
    }

    // Python syntax validation for .py files
    if (path.endsWith('.py')) {
      const validationResult = await validatePythonSyntax(content);
      if (!validationResult.valid) {
        return { success: false, error: `Python syntax error: ${validationResult.error}` };
      }
    }

    // Write file
    await Deno.writeTextFile(fullPath, content);

    // Log write operation
    await logWriteOperation('write', path, engineRoot);

    return { success: true, backupPath };
  } catch (error) {
    return { success: false, error: `Failed to write file: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Append content to existing file
 */
export async function appendFile(
  path: string,
  content: string,
  engineRoot: string
): Promise<{ success: boolean; preview?: string; error?: string }> {
  try {
    const validation = validatePath(path, engineRoot);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const fullPath = validation.fullPath;

    // Read existing content
    let existingContent = '';
    try {
      existingContent = await Deno.readTextFile(fullPath);
    } catch {
      // File doesn't exist - will create new
    }

    // Append with proper newline handling
    const newContent = existingContent + (existingContent && !existingContent.endsWith('\n') ? '\n' : '') + content;

    // Write updated content
    await Deno.writeTextFile(fullPath, newContent);

    // Generate preview of last 20 lines
    const lines = newContent.split('\n');
    const previewLines = lines.slice(-20);
    const preview = previewLines.join('\n');

    // Log append operation
    await logWriteOperation('append', path, engineRoot);

    return { success: true, preview };
  } catch (error) {
    return { success: false, error: `Failed to append to file: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Delete file (move to .trash directory)
 */
export async function deleteFile(
  path: string,
  engineRoot: string
): Promise<{ success: boolean; trashPath?: string; error?: string }> {
  try {
    const validation = validatePath(path, engineRoot);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const fullPath = validation.fullPath;

    // Check if file exists
    try {
      await Deno.stat(fullPath);
    } catch {
      return { success: false, error: 'File does not exist' };
    }

    // Prevent deletion of critical paths
    const criticalPatterns = ['.git/', 'config/', '.env'];
    if (criticalPatterns.some(pattern => path.includes(pattern))) {
      return { success: false, error: 'Cannot delete critical files or directories' };
    }

    // Move to .trash directory
    const trashDir = `${engineRoot}/.trash`;
    await Deno.mkdir(trashDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = path.split('/').pop();
    const trashPath = `${trashDir}/${fileName}.${timestamp}`;

    await Deno.rename(fullPath, trashPath);

    // Log delete operation
    await logWriteOperation('delete', path, engineRoot);

    return { success: true, trashPath };
  } catch (error) {
    return { success: false, error: `Failed to delete file: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Rename or move file
 */
export async function renameFile(
  oldPath: string,
  newPath: string,
  engineRoot: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const oldValidation = validatePath(oldPath, engineRoot);
    const newValidation = validatePath(newPath, engineRoot);

    if (!oldValidation.valid) {
      return { success: false, error: oldValidation.error };
    }
    if (!newValidation.valid) {
      return { success: false, error: newValidation.error };
    }

    const oldFullPath = oldValidation.fullPath;
    const newFullPath = newValidation.fullPath;

    // Check if source exists
    try {
      await Deno.stat(oldFullPath);
    } catch {
      return { success: false, error: 'Source file does not exist' };
    }

    // Check if destination already exists
    try {
      await Deno.stat(newFullPath);
      return { success: false, error: 'Destination file already exists' };
    } catch {
      // Destination doesn't exist - good
    }

    // Create destination directory if needed
    const newDir = newFullPath.substring(0, newFullPath.lastIndexOf('/'));
    await Deno.mkdir(newDir, { recursive: true });

    // Rename file
    await Deno.rename(oldFullPath, newFullPath);

    // Log rename operation
    await logWriteOperation('rename', `${oldPath} -> ${newPath}`, engineRoot);

    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to rename file: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Copy file to new location
 */
export async function copyFile(
  sourcePath: string,
  destPath: string,
  engineRoot: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const sourceValidation = validatePath(sourcePath, engineRoot);
    const destValidation = validatePath(destPath, engineRoot);

    if (!sourceValidation.valid) {
      return { success: false, error: sourceValidation.error };
    }
    if (!destValidation.valid) {
      return { success: false, error: destValidation.error };
    }

    const sourceFullPath = sourceValidation.fullPath;
    const destFullPath = destValidation.fullPath;

    // Check if source exists
    try {
      await Deno.stat(sourceFullPath);
    } catch {
      return { success: false, error: 'Source file does not exist' };
    }

    // Check if destination already exists
    try {
      await Deno.stat(destFullPath);
      return { success: false, error: 'Destination file already exists. Use overwrite flag if needed.' };
    } catch {
      // Destination doesn't exist - good
    }

    // Create destination directory if needed
    const destDir = destFullPath.substring(0, destFullPath.lastIndexOf('/'));
    await Deno.mkdir(destDir, { recursive: true });

    // Copy file
    await Deno.copyFile(sourceFullPath, destFullPath);

    // Log copy operation
    await logWriteOperation('copy', `${sourcePath} -> ${destPath}`, engineRoot);

    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to copy file: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Create directory
 */
export async function createDirectory(
  path: string,
  engineRoot: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const validation = validatePath(path, engineRoot);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const fullPath = validation.fullPath;

    // Create directory recursively
    await Deno.mkdir(fullPath, { recursive: true });

    // Log create directory operation
    await logWriteOperation('create_dir', path, engineRoot);

    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to create directory: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Validate Python syntax using py_compile
 */
async function validatePythonSyntax(content: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const tempFile = await Deno.makeTempFile({ suffix: '.py' });
    await Deno.writeTextFile(tempFile, content);

    const cmd = new Deno.Command('python', {
      args: ['-m', 'py_compile', tempFile],
      stdout: 'piped',
      stderr: 'piped'
    });

    const { code, stderr } = await cmd.output();
    
    // Cleanup temp file
    try {
      await Deno.remove(tempFile);
    } catch {
      // Ignore cleanup errors
    }

    if (code !== 0) {
      const errorOutput = new TextDecoder().decode(stderr);
      return { valid: false, error: errorOutput };
    }

    return { valid: true };
  } catch (error) {
    // If Python validation fails, allow write but warn
    console.warn('Python syntax validation failed:', error);
    return { valid: true }; // Non-blocking
  }
}

/**
 * Log write operations to audit trail
 */
async function logWriteOperation(operation: string, path: string, engineRoot: string): Promise<void> {
  try {
    const logDir = `${engineRoot}/.logs`;
    await Deno.mkdir(logDir, { recursive: true });
    
    const logFile = `${logDir}/write_operations.log`;
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${operation}: ${path}\n`;
    
    // Append to log file
    const file = await Deno.open(logFile, { create: true, append: true });
    await file.write(new TextEncoder().encode(logEntry));
    file.close();
  } catch (error) {
    // Log failures are non-blocking
    console.error('Failed to log write operation:', error);
  }
}
