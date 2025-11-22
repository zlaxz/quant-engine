import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

export interface WriteOperation {
  operation: 'write' | 'append' | 'delete' | 'rename' | 'copy' | 'create_dir';
  path: string;
  content?: string;
  diff?: string;
  newPath?: string;
}

export interface WriteResult {
  success: boolean;
  backup_path?: string;
  preview?: string;
  error?: string;
  message?: string;
}

export interface ConfirmationContext {
  operation: WriteOperation;
  existingContent?: string;
  preview?: string;
}

// Confirmation callback type
export type WriteConfirmationCallback = (
  context: ConfirmationContext,
  onConfirm: (createBackup: boolean) => Promise<WriteResult>
) => void;

/**
 * Execute a write operation via the write-file edge function
 */
export async function executeWriteOperation(operation: WriteOperation): Promise<WriteResult> {
  try {
    const { data, error } = await supabase.functions.invoke('write-file', {
      body: operation
    });
    
    if (error) {
      console.error('Write operation error:', error);
      return {
        success: false,
        error: error.message || 'Write operation failed'
      };
    }
    
    return data as WriteResult;
  } catch (error) {
    console.error('Write operation exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Read file for preview/diff
 */
async function readFileForPreview(path: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('read-file', {
      body: { path }
    });
    
    if (error || !data) {
      return null;
    }
    
    return data.content || null;
  } catch (error) {
    console.error('Failed to read file for preview:', error);
    return null;
  }
}

/**
 * Validate Python syntax (basic check)
 */
function validatePythonSyntax(content: string): { valid: boolean; error?: string } {
  // Basic syntax checks
  const lines = content.split('\n');
  
  // Check for common syntax errors
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') continue;
    
    // Check for unmatched brackets/parens
    const openBrackets = (line.match(/\[/g) || []).length;
    const closeBrackets = (line.match(/\]/g) || []).length;
    const openParens = (line.match(/\(/g) || []).length;
    const closeParens = (line.match(/\)/g) || []).length;
    const openBraces = (line.match(/\{/g) || []).length;
    const closeBraces = (line.match(/\}/g) || []).length;
    
    // Allow multiline constructs
    if (trimmed.endsWith('\\')) continue;
    
    // Check for common syntax patterns that indicate issues
    if (trimmed.match(/^(def|class|if|elif|else|for|while|try|except|finally|with)\s/) && !trimmed.endsWith(':')) {
      return {
        valid: false,
        error: `Line ${i + 1}: Missing colon after ${trimmed.split(/\s+/)[0]} statement`
      };
    }
  }
  
  return { valid: true };
}

/**
 * Write or overwrite entire file (with confirmation)
 */
export async function writeFile(
  path: string, 
  content: string,
  confirmCallback?: WriteConfirmationCallback
): Promise<WriteResult> {
  // Validate Python syntax if it's a .py file
  if (path.endsWith('.py')) {
    const syntaxCheck = validatePythonSyntax(content);
    if (!syntaxCheck.valid) {
      return {
        success: false,
        error: `Python syntax validation failed: ${syntaxCheck.error}`
      };
    }
  }
  
  // Read existing file for diff preview
  const existingContent = await readFileForPreview(path);
  
  // Generate preview
  let preview = content;
  if (existingContent) {
    preview = generateDiffPreview(existingContent, content);
  }
  
  const operation: WriteOperation = {
    operation: 'write',
    path,
    content
  };
  
  // If confirmation callback provided, use it
  if (confirmCallback) {
    return new Promise((resolve) => {
      confirmCallback(
        {
          operation,
          existingContent: existingContent || undefined,
          preview
        },
        async (createBackup) => {
          const result = await executeWriteOperation(operation);
          logWriteOperation(operation, result);
          resolve(result);
          return result;
        }
      );
    });
  }
  
  // Direct execution (no confirmation)
  const result = await executeWriteOperation(operation);
  logWriteOperation(operation, result);
  return result;
}

/**
 * Append content to end of file (with confirmation)
 */
export async function appendFile(
  path: string, 
  content: string,
  confirmCallback?: WriteConfirmationCallback
): Promise<WriteResult> {
  // Read existing file for preview
  const existingContent = await readFileForPreview(path);
  
  // Generate preview (last 20 lines of result)
  const newContent = existingContent 
    ? existingContent + (existingContent.endsWith('\n') ? '' : '\n') + content
    : content;
  
  const lines = newContent.split('\n');
  const preview = lines.slice(-20).join('\n');
  
  const operation: WriteOperation = {
    operation: 'append',
    path,
    content
  };
  
  // If confirmation callback provided, use it
  if (confirmCallback) {
    return new Promise((resolve) => {
      confirmCallback(
        {
          operation,
          existingContent: existingContent || undefined,
          preview
        },
        async (createBackup) => {
          const result = await executeWriteOperation(operation);
          logWriteOperation(operation, result);
          resolve(result);
          return result;
        }
      );
    });
  }
  
  // Direct execution
  const result = await executeWriteOperation(operation);
  logWriteOperation(operation, result);
  return result;
}

/**
 * Delete file (with confirmation)
 */
export async function deleteFile(
  path: string,
  confirmCallback?: WriteConfirmationCallback
): Promise<WriteResult> {
  // Read existing file for preview
  const existingContent = await readFileForPreview(path);
  
  const operation: WriteOperation = {
    operation: 'delete',
    path
  };
  
  // If confirmation callback provided, use it
  if (confirmCallback) {
    return new Promise((resolve) => {
      confirmCallback(
        {
          operation,
          existingContent: existingContent || undefined,
          preview: existingContent || undefined
        },
        async (createBackup) => {
          const result = await executeWriteOperation(operation);
          logWriteOperation(operation, result);
          resolve(result);
          return result;
        }
      );
    });
  }
  
  // Direct execution
  const result = await executeWriteOperation(operation);
  logWriteOperation(operation, result);
  return result;
}

/**
 * Rename or move file
 */
export async function renameFile(
  oldPath: string, 
  newPath: string,
  confirmCallback?: WriteConfirmationCallback
): Promise<WriteResult> {
  const operation: WriteOperation = {
    operation: 'rename',
    path: oldPath,
    newPath
  };
  
  if (confirmCallback) {
    return new Promise((resolve) => {
      confirmCallback(
        { operation },
        async (createBackup) => {
          const result = await executeWriteOperation(operation);
          logWriteOperation(operation, result);
          resolve(result);
          return result;
        }
      );
    });
  }
  
  const result = await executeWriteOperation(operation);
  logWriteOperation(operation, result);
  return result;
}

/**
 * Copy file
 */
export async function copyFile(
  sourcePath: string, 
  destPath: string,
  confirmCallback?: WriteConfirmationCallback
): Promise<WriteResult> {
  const operation: WriteOperation = {
    operation: 'copy',
    path: sourcePath,
    newPath: destPath
  };
  
  if (confirmCallback) {
    return new Promise((resolve) => {
      confirmCallback(
        { operation },
        async (createBackup) => {
          const result = await executeWriteOperation(operation);
          logWriteOperation(operation, result);
          resolve(result);
          return result;
        }
      );
    });
  }
  
  const result = await executeWriteOperation(operation);
  logWriteOperation(operation, result);
  return result;
}

/**
 * Create directory
 */
export async function createDirectory(path: string): Promise<WriteResult> {
  const operation: WriteOperation = {
    operation: 'create_dir',
    path
  };
  
  const result = await executeWriteOperation(operation);
  logWriteOperation(operation, result);
  return result;
}

/**
 * Generate diff preview between old and new content
 */
export function generateDiffPreview(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  const maxLines = Math.max(oldLines.length, newLines.length);
  const diffLines: string[] = [];
  
  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    
    if (oldLine !== newLine) {
      if (oldLine !== undefined && newLine === undefined) {
        diffLines.push(`- ${oldLine}`);
      } else if (oldLine === undefined && newLine !== undefined) {
        diffLines.push(`+ ${newLine}`);
      } else {
        diffLines.push(`- ${oldLine}`);
        diffLines.push(`+ ${newLine}`);
      }
    } else if (diffLines.length > 0 && diffLines.length < 200) {
      // Include context lines near changes (up to 200 total lines)
      diffLines.push(`  ${oldLine}`);
    }
  }
  
  return diffLines.join('\n');
}

/**
 * Log write operation to audit trail
 */
function logWriteOperation(operation: WriteOperation, result: WriteResult): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    operation: operation.operation,
    path: operation.path,
    newPath: operation.newPath,
    success: result.success,
    backup_path: result.backup_path,
    error: result.error
  };
  
  // Store in localStorage for audit trail
  try {
    const existingLogs = localStorage.getItem('write_operations_log');
    const logs = existingLogs ? JSON.parse(existingLogs) : [];
    
    logs.push(logEntry);
    
    // Keep only last 100 operations
    if (logs.length > 100) {
      logs.splice(0, logs.length - 100);
    }
    
    localStorage.setItem('write_operations_log', JSON.stringify(logs));
  } catch (error) {
    console.error('Failed to log write operation:', error);
  }
}

/**
 * Get write operation audit log
 */
export function getWriteOperationLog(): any[] {
  try {
    const logs = localStorage.getItem('write_operations_log');
    return logs ? JSON.parse(logs) : [];
  } catch (error) {
    console.error('Failed to retrieve write operation log:', error);
    return [];
  }
}
