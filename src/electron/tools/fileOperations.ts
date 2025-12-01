/**
 * File Operations for Tool Handlers
 * Wraps FileSystemService for use by LLM tool calling
 */

import { getFileSystemService } from '../services/FileSystemService';
import { app } from 'electron';
import path from 'path';

export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
  metadata?: any; // Additional structured data for specialized rendering
}

// Get rotation-engine root - uses app-relative path to match toolHandlers
function getEngineRoot(): string {
  // Use app-relative path to match toolHandlers
  const appRoot = app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : process.cwd();
  return path.join(appRoot, 'python');
}

export async function readFile(filePath: string): Promise<ToolResult> {
  try {
    const fsService = getFileSystemService(getEngineRoot());
    const result = await fsService.readFile(filePath);

    if (result.error) {
      return { success: false, content: '', error: result.error };
    }

    return { success: true, content: result.content || '' };
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
    const fsService = getFileSystemService(getEngineRoot());
    const result = await fsService.listDirectory(dirPath || '');

    if (result.error) {
      return { success: false, content: '', error: result.error };
    }

    const MAX_ENTRIES = 200;
    const entries = result.entries || [];
    const truncated = entries.length > MAX_ENTRIES;
    const limitedEntries = entries.slice(0, MAX_ENTRIES);

    let resultContent = JSON.stringify(limitedEntries, null, 2);
    if (truncated) {
      const warning = `⚠️ DIRECTORY TRUNCATED: Showing ${MAX_ENTRIES} of ${entries.length} entries.`;
      resultContent = `${warning}\n\n${resultContent}`;
    }

    return { success: true, content: resultContent };
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
    const fsService = getFileSystemService(getEngineRoot());
    const result = await fsService.searchCode(pattern, searchPath, filePattern);

    if (result.error) {
      return { success: false, content: '', error: result.error };
    }

    const matches = result.matches || [];

    if (matches.length === 0) {
      return { success: true, content: 'No matches found' };
    }

    let resultContent = `Found ${matches.length} matches:\n${JSON.stringify(matches, null, 2)}`;
    if (result.truncated) {
      resultContent = `⚠️ RESULTS TRUNCATED: ${result.warning}\n\n${resultContent}`;
    }

    return { success: true, content: resultContent };
  } catch (error: any) {
    return {
      success: false,
      content: '',
      error: `Search error: ${error.message}`
    };
  }
}

export async function writeFile(filePath: string, content: string): Promise<ToolResult> {
  try {
    const fsService = getFileSystemService(getEngineRoot());
    const result = await fsService.writeFile(filePath, content);

    if (!result.success) {
      return { success: false, content: '', error: result.error };
    }

    return { success: true, content: result.message || `File written: ${filePath}` };
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
    const fsService = getFileSystemService(getEngineRoot());
    const result = await fsService.appendFile(filePath, content);

    if (!result.success) {
      return { success: false, content: '', error: result.error };
    }

    return { success: true, content: result.message || `Content appended to: ${filePath}` };
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
    const fsService = getFileSystemService(getEngineRoot());
    const result = await fsService.deleteFile(filePath);

    if (!result.success) {
      return { success: false, content: '', error: result.error };
    }

    return { success: true, content: result.message || `File deleted: ${filePath}` };
  } catch (error) {
    return {
      success: false,
      content: '',
      error: `Error deleting file: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
