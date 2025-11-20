import { supabase } from "@/integrations/supabase/client";

export interface WriteOperation {
  operation: 'write' | 'append' | 'patch' | 'delete' | 'rename' | 'copy' | 'create_dir';
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

/**
 * Execute a write operation via the write-file edge function
 */
export async function executeWriteOperation(operation: WriteOperation): Promise<WriteResult> {
  try {
    console.log('Executing write operation:', operation);
    
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
 * Write or overwrite entire file
 */
export async function writeFile(path: string, content: string): Promise<WriteResult> {
  return executeWriteOperation({
    operation: 'write',
    path,
    content
  });
}

/**
 * Append content to end of file
 */
export async function appendFile(path: string, content: string): Promise<WriteResult> {
  return executeWriteOperation({
    operation: 'append',
    path,
    content
  });
}

/**
 * Apply unified diff patch
 */
export async function applyPatch(path: string, diff: string): Promise<WriteResult> {
  return executeWriteOperation({
    operation: 'patch',
    path,
    diff
  });
}

/**
 * Delete file (with backup)
 */
export async function deleteFile(path: string): Promise<WriteResult> {
  return executeWriteOperation({
    operation: 'delete',
    path
  });
}

/**
 * Rename or move file
 */
export async function renameFile(oldPath: string, newPath: string): Promise<WriteResult> {
  return executeWriteOperation({
    operation: 'rename',
    path: oldPath,
    newPath
  });
}

/**
 * Copy file
 */
export async function copyFile(sourcePath: string, destPath: string): Promise<WriteResult> {
  return executeWriteOperation({
    operation: 'copy',
    path: sourcePath,
    newPath: destPath
  });
}

/**
 * Create directory
 */
export async function createDirectory(path: string): Promise<WriteResult> {
  return executeWriteOperation({
    operation: 'create_dir',
    path
  });
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
    const oldLine = oldLines[i] || '';
    const newLine = newLines[i] || '';
    
    if (oldLine !== newLine) {
      if (oldLine && !newLine) {
        diffLines.push(`- ${oldLine}`);
      } else if (!oldLine && newLine) {
        diffLines.push(`+ ${newLine}`);
      } else {
        diffLines.push(`- ${oldLine}`);
        diffLines.push(`+ ${newLine}`);
      }
    } else if (diffLines.length > 0 && diffLines.length < 100) {
      // Include context lines near changes (up to 100 total lines)
      diffLines.push(`  ${oldLine}`);
    }
  }
  
  return diffLines.join('\n');
}
