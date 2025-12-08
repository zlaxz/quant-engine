/**
 * useBroker Hook
 * React hook for broker connection and trading operations
 *
 * CRITICAL WARNING: This hook currently returns STUB DATA.
 * DO NOT use for real trading until connected to actual broker API.
 *
 * TODO: Implement actual Electron IPC calls to broker service
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  Account,
  Position,
  Order,
  OrderRequest,
  Quote,
  BrokerStatus,
} from '@/services/broker';

// CRITICAL: Flag indicating stub data is in use
const IS_STUB_DATA = true;
const STUB_DATA_WARNING = 'DEMO MODE: Using simulated data - NOT connected to real broker';

interface UseBrokerOptions {
  autoConnect?: boolean;
  refreshInterval?: number; // ms
}

interface UseBrokerReturn {
  // Connection
  status: BrokerStatus;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;

  // Account data
  account: Account | null;
  positions: Position[];
  orders: Order[];

  // Trading
  placeOrder: (order: OrderRequest) => Promise<Order>;
  cancelOrder: (orderId: string) => Promise<void>;

  // Market data
  getQuote: (symbol: string) => Promise<Quote>;

  // State
  isLoading: boolean;
  error: string | null;

  // CRITICAL: Stub data indicators
  isStubData: boolean;
  stubDataWarning: string | null;

  // Refresh
  refresh: () => Promise<void>;
}

export function useBroker(options: UseBrokerOptions = {}): UseBrokerReturn {
  const { autoConnect = false, refreshInterval = 5000 } = options;

  const [status, setStatus] = useState<BrokerStatus>({
    connected: false,
    broker: 'none',
  });
  const [account, setAccount] = useState<Account | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Connect to broker
  const connect = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // CRITICAL: Log warning when using stub data
      if (IS_STUB_DATA) {
        console.warn('[useBroker] ⚠️ STUB DATA MODE - NOT connected to real broker');
        console.warn('[useBroker] All positions, account data, and trades are SIMULATED');
      }

      // TODO: Implement actual broker connection via Electron IPC
      // For now, simulate connection
      await new Promise(resolve => setTimeout(resolve, 500));

      setStatus({
        connected: true,
        broker: IS_STUB_DATA ? 'demo' : 'schwab',
        accountId: IS_STUB_DATA ? 'DEMO-STUB-DATA' : 'demo-account',
        lastUpdate: new Date(),
        // Add warning to status for UI consumption
        ...(IS_STUB_DATA && { warning: STUB_DATA_WARNING }),
      });

      // Fetch initial data
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setStatus(prev => ({ ...prev, connected: false, error: String(err) }));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Disconnect from broker
  const disconnect = useCallback(async () => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    setStatus({
      connected: false,
      broker: 'none',
    });
    setAccount(null);
    setPositions([]);
    setOrders([]);
  }, []);

  // Refresh all data
  const refresh = useCallback(async () => {
    if (!status.connected) return;

    try {
      // TODO: Implement actual data fetching via Electron IPC
      // For now, return stub data
      setAccount({
        id: 'demo-account',
        name: 'Trading Account',
        type: 'margin',
        buyingPower: 50000,
        cashBalance: 25000,
        portfolioValue: 125000,
        dayTradingBuyingPower: 200000,
      });

      setPositions([
        {
          symbol: 'SPY',
          quantity: 100,
          averageCost: 580.50,
          marketValue: 59850,
          unrealizedPnl: 1350,
          unrealizedPnlPercent: 2.32,
          assetType: 'equity',
        },
        {
          symbol: 'SPY240120C600',
          quantity: 5,
          averageCost: 2.50,
          marketValue: 1500,
          unrealizedPnl: 250,
          unrealizedPnlPercent: 20,
          assetType: 'option',
          optionType: 'call',
          strikePrice: 600,
          expirationDate: '2024-01-20',
          delta: 0.35,
          gamma: 0.02,
          theta: -0.15,
          vega: 0.12,
        },
      ]);

      setOrders([]);

      setStatus(prev => ({ ...prev, lastUpdate: new Date() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh');
    }
  }, [status.connected]);

  // Place order
  const placeOrder = useCallback(async (order: OrderRequest): Promise<Order> => {
    if (!status.connected) {
      throw new Error('Not connected to broker');
    }

    setIsLoading(true);
    try {
      // TODO: Implement actual order placement via Electron IPC
      const newOrder: Order = {
        id: `order-${Date.now()}`,
        symbol: order.symbol,
        quantity: order.quantity,
        filledQuantity: 0,
        side: order.side,
        orderType: order.orderType,
        limitPrice: order.limitPrice,
        stopPrice: order.stopPrice,
        status: 'pending',
        timeInForce: order.timeInForce,
        createdAt: new Date(),
      };

      setOrders(prev => [newOrder, ...prev]);
      return newOrder;
    } finally {
      setIsLoading(false);
    }
  }, [status.connected]);

  // Cancel order
  const cancelOrder = useCallback(async (orderId: string) => {
    if (!status.connected) {
      throw new Error('Not connected to broker');
    }

    setIsLoading(true);
    try {
      // TODO: Implement actual order cancellation via Electron IPC
      setOrders(prev =>
        prev.map(order =>
          order.id === orderId ? { ...order, status: 'cancelled' as const } : order
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [status.connected]);

  // Get quote
  const getQuote = useCallback(async (symbol: string): Promise<Quote> => {
    // TODO: Implement actual quote fetching via Electron IPC
    const basePrice = symbol === 'SPY' ? 598.50 : 100;
    return {
      symbol,
      bid: basePrice - 0.01,
      ask: basePrice + 0.01,
      last: basePrice,
      volume: 45000000,
      open: basePrice - 2,
      high: basePrice + 3,
      low: basePrice - 4,
      close: basePrice - 1,
      change: 1,
      changePercent: 0.17,
      timestamp: new Date(),
    };
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, [autoConnect, connect]);

  // Set up refresh interval
  useEffect(() => {
    if (status.connected && refreshInterval > 0) {
      refreshTimerRef.current = setInterval(refresh, refreshInterval);
    }

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [status.connected, refreshInterval, refresh]);

  return {
    status,
    connect,
    disconnect,
    account,
    positions,
    orders,
    placeOrder,
    cancelOrder,
    getQuote,
    isLoading,
    error,
    // CRITICAL: Always expose stub data status
    isStubData: IS_STUB_DATA,
    stubDataWarning: IS_STUB_DATA ? STUB_DATA_WARNING : null,
    refresh,
  };
}

export default useBroker;
