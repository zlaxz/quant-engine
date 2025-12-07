/**
 * Trading Handlers - IPC handlers for live trading operations
 * ============================================================
 *
 * Connects the Electron frontend to the Python trading server.
 * All trading operations go through the Flask API at port 5002.
 *
 * IMPORTANT:
 * 1. Start the trading server first: python -m engine.trading.trading_server
 * 2. Start TWS or IB Gateway before connecting
 * 3. Paper mode by default - explicit action required for live
 */

import { ipcMain, BrowserWindow } from 'electron';

const TRADING_SERVER_URL = 'http://localhost:5002';

// Types
interface OrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  orderType: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
  limitPrice?: number;
  stopPrice?: number;
  timeInForce?: 'GTC' | 'DAY' | 'IOC';
  strategyName?: string;
  priority?: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
  dryRun?: boolean;
}

interface TradingStatus {
  connected: boolean;
  mode: 'paper' | 'live' | null;
  halted: boolean;
  availableSymbols: string[];
}

// Helper to call trading server
async function callTradingServer(
  endpoint: string,
  options: RequestInit = {}
): Promise<any> {
  const url = `${TRADING_SERVER_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `Server error: ${response.status}`,
      };
    }

    return data;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return {
        success: false,
        error: `Trading server not running at ${TRADING_SERVER_URL}. Start with: python -m engine.trading.trading_server`,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export function registerTradingHandlers() {
  // =========================================================================
  // Connection Handlers
  // =========================================================================

  /**
   * Connect to IBKR
   * @param mode - 'paper' or 'live'
   */
  ipcMain.handle('trading:connect', async (_event, mode: 'paper' | 'live' = 'paper') => {
    console.log(`[Trading] Connecting to IBKR in ${mode} mode...`);

    // Safety check - require explicit confirmation for live mode
    if (mode === 'live') {
      console.warn('[Trading] ⚠️ LIVE MODE REQUESTED - Real money at risk!');
    }

    return await callTradingServer('/api/trading/connect', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    });
  });

  /**
   * Disconnect from IBKR
   */
  ipcMain.handle('trading:disconnect', async () => {
    console.log('[Trading] Disconnecting from IBKR...');

    return await callTradingServer('/api/trading/disconnect', {
      method: 'POST',
    });
  });

  /**
   * Get connection status
   */
  ipcMain.handle('trading:status', async (): Promise<TradingStatus | { success: false; error: string }> => {
    return await callTradingServer('/api/trading/status');
  });

  // =========================================================================
  // Position Handlers
  // =========================================================================

  /**
   * Get all open positions
   */
  ipcMain.handle('trading:positions', async () => {
    return await callTradingServer('/api/trading/positions');
  });

  /**
   * Get quote for a symbol
   */
  ipcMain.handle('trading:quote', async (_event, symbol: string) => {
    return await callTradingServer(`/api/trading/quote/${encodeURIComponent(symbol)}`);
  });

  // =========================================================================
  // Order Handlers
  // =========================================================================

  /**
   * Submit an order
   */
  ipcMain.handle('trading:order', async (_event, params: OrderParams) => {
    console.log(`[Trading] Order: ${params.side} ${params.quantity} ${params.symbol}`);

    // Validate required fields
    if (!params.symbol || !params.side || !params.quantity) {
      return {
        success: false,
        error: 'Missing required fields: symbol, side, quantity',
      };
    }

    // Validate quantity
    if (params.quantity <= 0) {
      return {
        success: false,
        error: 'Quantity must be positive',
      };
    }

    // Validate limit price for LIMIT orders
    if ((params.orderType === 'LIMIT' || params.orderType === 'STOP_LIMIT') && !params.limitPrice) {
      return {
        success: false,
        error: `${params.orderType} order requires limitPrice`,
      };
    }

    return await callTradingServer('/api/trading/order', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  });

  /**
   * Cancel an order
   */
  ipcMain.handle('trading:cancel', async (_event, orderId: string) => {
    console.log(`[Trading] Cancelling order: ${orderId}`);

    return await callTradingServer('/api/trading/cancel', {
      method: 'POST',
      body: JSON.stringify({ orderId }),
    });
  });

  /**
   * Cancel all orders (optionally for a specific symbol)
   */
  ipcMain.handle('trading:cancelAll', async (_event, symbol?: string) => {
    console.log(`[Trading] Cancelling all orders${symbol ? ` for ${symbol}` : ''}`);

    return await callTradingServer('/api/trading/cancel-all', {
      method: 'POST',
      body: JSON.stringify({ symbol }),
    });
  });

  // =========================================================================
  // Kill Switch
  // =========================================================================

  /**
   * EMERGENCY: Flatten all positions
   */
  ipcMain.handle('trading:killSwitch', async (_event, reason: string = 'Manual trigger') => {
    console.log(`[Trading] 🚨 KILL SWITCH: ${reason}`);

    // Broadcast to all windows
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('trading:killSwitchActivated', { reason });
    });

    return await callTradingServer('/api/trading/kill-switch', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  });

  // =========================================================================
  // Trading Control
  // =========================================================================

  /**
   * Halt all trading
   */
  ipcMain.handle('trading:halt', async (_event, reason: string) => {
    console.log(`[Trading] Halting: ${reason}`);

    return await callTradingServer('/api/trading/halt', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  });

  /**
   * Resume trading
   */
  ipcMain.handle('trading:resume', async () => {
    console.log('[Trading] Resuming trading');

    return await callTradingServer('/api/trading/resume', {
      method: 'POST',
    });
  });

  // =========================================================================
  // Stats Handlers
  // =========================================================================

  /**
   * Get trading statistics
   */
  ipcMain.handle('trading:stats', async () => {
    return await callTradingServer('/api/trading/stats');
  });

  /**
   * Get daily P&L
   */
  ipcMain.handle('trading:dailyPnl', async () => {
    return await callTradingServer('/api/trading/daily-pnl');
  });

  // =========================================================================
  // Health Check
  // =========================================================================

  /**
   * Check if trading server is running
   */
  ipcMain.handle('trading:health', async () => {
    return await callTradingServer('/api/trading/health');
  });

  console.log('[Trading] Handlers registered');
}
