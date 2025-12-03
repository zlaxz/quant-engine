/**
 * Pop-out Window Manager
 * 
 * Creates and manages independent visualization windows that can be
 * dragged to different monitors and receive real-time updates.
 */

import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PopoutWindow {
  id: string;
  window: BrowserWindow;
  visualizationType: string;
  data: unknown;
}

// Track all pop-out windows
const popoutWindows: Map<string, PopoutWindow> = new Map();

// Reference to main window for coordinate calculations
let mainWindowRef: BrowserWindow | null = null;

export function setMainWindowRef(mainWindow: BrowserWindow) {
  mainWindowRef = mainWindow;
}

/**
 * Register all pop-out window IPC handlers
 */
export function registerPopoutHandlers() {
  // Create a new pop-out window
  ipcMain.handle('popout:create', async (_event, config: {
    id: string;
    title: string;
    visualizationType: string;
    data: unknown;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
  }) => {
    const { id, title, visualizationType, data, width = 600, height = 500 } = config;

    // Close existing window with same ID if exists
    const existing = popoutWindows.get(id);
    if (existing) {
      existing.window.close();
      popoutWindows.delete(id);
    }

    // Calculate position - try to place on different monitor or offset from main
    let x = config.x;
    let y = config.y;

    if (x === undefined || y === undefined) {
      const displays = screen.getAllDisplays();
      const mainBounds = mainWindowRef?.getBounds();

      if (displays.length > 1 && mainBounds) {
        // Find a different display than the main window
        const mainDisplay = screen.getDisplayNearestPoint({ x: mainBounds.x, y: mainBounds.y });
        const otherDisplay = displays.find(d => d.id !== mainDisplay.id);

        if (otherDisplay) {
          // Center on the other display
          x = otherDisplay.bounds.x + (otherDisplay.bounds.width - width) / 2;
          y = otherDisplay.bounds.y + (otherDisplay.bounds.height - height) / 2;
        }
      }

      // Fallback: offset from main window
      if (x === undefined || y === undefined) {
        const offset = popoutWindows.size * 30;
        x = (mainBounds?.x || 100) + 50 + offset;
        y = (mainBounds?.y || 100) + 50 + offset;
      }
    }

    // Create the pop-out window
    const popoutWindow = new BrowserWindow({
      width,
      height,
      x: Math.round(x),
      y: Math.round(y),
      title: title || 'Visualization',
      frame: true,
      resizable: true,
      minimizable: true,
      maximizable: true,
      alwaysOnTop: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        webSecurity: false,
        preload: path.join(__dirname, '../preload.cjs'),
      },
    });

    // Load the pop-out page with visualization data
    const isDev = process.env.NODE_ENV === 'development';
    const baseUrl = isDev ? 'http://localhost:8080' : `file://${path.join(__dirname, '../../dist/index.html')}`;
    
    // Use hash routing for the popout route
    const url = `${baseUrl}#/popout/${encodeURIComponent(id)}`;
    popoutWindow.loadURL(url);

    // Send initial data once loaded
    popoutWindow.webContents.once('did-finish-load', () => {
      popoutWindow.webContents.send('popout:data', {
        id,
        visualizationType,
        data,
        title,
      });
    });

    // Track the window
    popoutWindows.set(id, {
      id,
      window: popoutWindow,
      visualizationType,
      data,
    });

    // Clean up when closed
    popoutWindow.on('closed', () => {
      popoutWindows.delete(id);
      // Notify main window that popout was closed
      mainWindowRef?.webContents.send('popout:closed', { id });
    });

    console.log(`[PopoutWindows] Created window ${id} at (${x}, ${y})`);
    return { success: true, id };
  });

  // Update data in an existing pop-out window
  ipcMain.handle('popout:update', async (_event, config: {
    id: string;
    data: unknown;
  }) => {
    const popout = popoutWindows.get(config.id);
    if (!popout) {
      return { success: false, error: 'Window not found' };
    }

    // Update stored data
    popout.data = config.data;

    // Send update to the window
    popout.window.webContents.send('popout:data-update', {
      id: config.id,
      data: config.data,
    });

    return { success: true };
  });

  // Close a pop-out window
  ipcMain.handle('popout:close', async (_event, id: string) => {
    const popout = popoutWindows.get(id);
    if (popout) {
      popout.window.close();
      popoutWindows.delete(id);
      return { success: true };
    }
    return { success: false, error: 'Window not found' };
  });

  // Get all open pop-out window IDs
  ipcMain.handle('popout:list', async () => {
    return Array.from(popoutWindows.keys());
  });

  // Focus a pop-out window
  ipcMain.handle('popout:focus', async (_event, id: string) => {
    const popout = popoutWindows.get(id);
    if (popout) {
      popout.window.focus();
      return { success: true };
    }
    return { success: false, error: 'Window not found' };
  });

  // Broadcast update to all pop-out windows (for real-time sync)
  ipcMain.handle('popout:broadcast', async (_event, data: {
    type: string;
    payload: unknown;
  }) => {
    for (const [, popout] of popoutWindows) {
      popout.window.webContents.send('popout:broadcast', data);
    }
    return { success: true, count: popoutWindows.size };
  });

  console.log('[PopoutWindows] Handlers registered');
}

/**
 * Close all pop-out windows (called on app quit)
 */
export function closeAllPopouts() {
  for (const [, popout] of popoutWindows) {
    popout.window.close();
  }
  popoutWindows.clear();
}

/**
 * Send real-time update to specific visualization types
 */
export function broadcastVisualizationUpdate(visualizationType: string, data: unknown) {
  for (const [, popout] of popoutWindows) {
    if (popout.visualizationType === visualizationType) {
      popout.window.webContents.send('popout:data-update', {
        id: popout.id,
        data,
      });
    }
  }
}
