import { ipcMain } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';

const ROTATION_ENGINE_ROOT = process.env.ROTATION_ENGINE_ROOT || '/Users/zstoc/rotation-engine';

// Validate path is within rotation-engine to prevent directory traversal
function validatePath(filePath: string): string {
  const resolved = path.resolve(ROTATION_ENGINE_ROOT, filePath);
  if (!resolved.startsWith(ROTATION_ENGINE_ROOT)) {
    throw new Error('Invalid path: outside rotation-engine directory');
  }
  return resolved;
}

export function registerFileOperationHandlers() {
  // Read file
  ipcMain.handle('read-file', async (_event, filePath: string) => {
    try {
      const fullPath = validatePath(filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      return { content };
    } catch (error) {
      console.error('Error reading file:', error);
      throw error;
    }
  });

  // Write file
  ipcMain.handle('write-file', async (_event, filePath: string, content: string) => {
    try {
      const fullPath = validatePath(filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('Error writing file:', error);
      throw error;
    }
  });

  // Delete file
  ipcMain.handle('delete-file', async (_event, filePath: string) => {
    try {
      const fullPath = validatePath(filePath);
      await fs.unlink(fullPath);
      return { success: true };
    } catch (error) {
      console.error('Error deleting file:', error);
      throw error;
    }
  });

  // List directory
  ipcMain.handle('list-dir', async (_event, dirPath: string) => {
    try {
      const fullPath = validatePath(dirPath || '.');
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      return {
        entries: entries.map(entry => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
        })),
      };
    } catch (error) {
      console.error('Error listing directory:', error);
      throw error;
    }
  });

  // Search code
  ipcMain.handle('search-code', async (_event, query: string, dirPath?: string) => {
    try {
      const searchRoot = dirPath ? validatePath(dirPath) : ROTATION_ENGINE_ROOT;
      const pattern = '**/*.py';
      const files = await glob(pattern, { cwd: searchRoot, absolute: true });

      const results = [];
      const regex = new RegExp(query, 'gi');

      for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');
        const matches = [];

        lines.forEach((line, idx) => {
          if (regex.test(line)) {
            matches.push({
              line: idx + 1,
              content: line.trim(),
            });
          }
        });

        if (matches.length > 0) {
          results.push({
            file: path.relative(ROTATION_ENGINE_ROOT, file),
            matches,
          });
        }
      }

      return { results };
    } catch (error) {
      console.error('Error searching code:', error);
      throw error;
    }
  });

  // Get rotation engine root
  ipcMain.handle('get-rotation-engine-root', async () => {
    return ROTATION_ENGINE_ROOT;
  });
}
