import { ipcMain } from 'electron';
import {
  validateIPC,
  FilePathSchema,
  FileContentSchema,
  DirectoryPathSchema,
  SearchQuerySchema,
} from '../validation/schemas';
import { getFileSystemService } from '../services/FileSystemService';

// Get rotation engine root dynamically at runtime
function getRotationEngineRoot(): string {
  const root = process.env.ROTATION_ENGINE_ROOT;
  if (!root) {
    throw new Error('No project directory configured. Go to Settings to set one.');
  }
  return root;
}

export function registerFileOperationHandlers() {
  // Read file
  ipcMain.handle('read-file', async (_event, filePathRaw: unknown) => {
    try {
      // Validate at IPC boundary
      const filePath = validateIPC(FilePathSchema, filePathRaw, 'file path');
      const fsService = getFileSystemService(getRotationEngineRoot());
      const result = await fsService.readFile(filePath);
      if (result.error) {
        throw new Error(result.error);
      }
      return { content: result.content };
    } catch (error) {
      console.error('Error reading file:', error);
      throw error;
    }
  });

  // Write file
  ipcMain.handle('write-file', async (_event, filePathRaw: unknown, contentRaw: unknown) => {
    try {
      // Validate at IPC boundary
      const filePath = validateIPC(FilePathSchema, filePathRaw, 'file path');
      const content = validateIPC(FileContentSchema, contentRaw, 'file content');
      const fsService = getFileSystemService(getRotationEngineRoot());
      const result = await fsService.writeFile(filePath, content);
      if (!result.success) {
        throw new Error(result.error);
      }
      return { success: true };
    } catch (error) {
      console.error('Error writing file:', error);
      throw error;
    }
  });

  // Delete file
  ipcMain.handle('delete-file', async (_event, filePathRaw: unknown) => {
    try {
      // Validate at IPC boundary
      const filePath = validateIPC(FilePathSchema, filePathRaw, 'file path');
      const fsService = getFileSystemService(getRotationEngineRoot());
      const result = await fsService.deleteFile(filePath);
      if (!result.success) {
        throw new Error(result.error);
      }
      return { success: true };
    } catch (error) {
      console.error('Error deleting file:', error);
      throw error;
    }
  });

  // List directory
  ipcMain.handle('list-dir', async (_event, dirPathRaw: unknown) => {
    try {
      // Validate at IPC boundary (optional string, default to '.')
      const dirPath = validateIPC(DirectoryPathSchema, dirPathRaw, 'directory path');
      const fsService = getFileSystemService(getRotationEngineRoot());
      const result = await fsService.listDirectory(dirPath || '');
      if (result.error) {
        throw new Error(result.error);
      }
      return { entries: result.entries };
    } catch (error: any) {
      console.error('Error listing directory:', error);

      // Provide helpful error for missing config
      if (error.message?.includes('No project directory configured')) {
        throw new Error('No project directory configured. Go to Settings to set one.');
      }

      throw error;
    }
  });

  // Search code - returns flat array matching edge function shape
  ipcMain.handle('search-code', async (_event, queryRaw: unknown, dirPathRaw?: unknown) => {
    try {
      // Validate at IPC boundary
      const query = validateIPC(SearchQuerySchema, queryRaw, 'search query');
      const dirPath = dirPathRaw !== undefined
        ? validateIPC(DirectoryPathSchema, dirPathRaw, 'directory path')
        : undefined;

      const fsService = getFileSystemService(getRotationEngineRoot());
      const result = await fsService.searchCode(query, dirPath, '*.py');

      if (result.error) {
        throw new Error(result.error);
      }

      return { results: result.matches || [] };
    } catch (error: any) {
      console.error('Error searching code:', error);

      // Provide helpful error for missing config
      if (error.message?.includes('No project directory configured')) {
        throw new Error('No project directory configured. Go to Settings to set one.');
      }

      throw error;
    }
  });

  // Get rotation engine root
  ipcMain.handle('get-rotation-engine-root', async () => {
    return getRotationEngineRoot();
  });
}
