/**
 * LiveTradingPanel - Real-time IBKR trading integration
 *
 * Provides:
 * - Multi-account support (paper/live simultaneously)
 * - Account switching and aggregated views
 * - Real-time position monitoring from IBKR
 * - Quick order entry for ES/MES/NQ/MNQ
 * - Per-account and global kill switch
 * - Daily P&L tracking (by account or aggregated)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Wifi,
  WifiOff,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Power,
  PowerOff,
  Zap,
  DollarSign,
  Activity,
  Shield,
  AlertOctagon,
  Users,
  Plus,
  Trash2,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface Account {
  name: string;
  mode: 'paper' | 'live';
  host: string;
  port: number;
  connected: boolean;
  halted: boolean;
  ibkrAccountId?: string;
}

interface Position {
  symbol: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  unrealized_pnl: number;
  realized_pnl_today: number;
  notional_value: number;
  is_long: boolean;
  last_update: string;
  account?: string;
}

interface DailyStats {
  date: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  pnl_percent: number;
  trades_count: number;
  win_rate: number;
  max_drawdown: number;
  account?: string;
}

interface ConnectionStatus {
  connected: boolean;
  mode: 'paper' | 'live' | null;
  halted: boolean;
  availableSymbols: string[];
  accounts?: Account[];
}

interface OrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  orderType: 'MARKET' | 'LIMIT';
  limitPrice?: number;
  account?: string;
}

// ============================================================================
// Component
// ============================================================================

export function LiveTradingPanel({ className }: { className?: string }) {
  // Account state
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const [showAggregated, setShowAggregated] = useState(false);
  const [showAccountSetup, setShowAccountSetup] = useState(false);

  // Connection state (legacy - for backwards compatibility)
  const [status, setStatus] = useState<ConnectionStatus>({
    connected: false,
    mode: null,
    halted: false,
    availableSymbols: [],
    accounts: [],
  });
  const [connecting, setConnecting] = useState(false);

  // Position state
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [positionsByAccount, setPositionsByAccount] = useState<Record<string, Record<string, Position>>>({});
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [dailyStatsByAccount, setDailyStatsByAccount] = useState<Record<string, DailyStats>>({});
  const [totalExposure, setTotalExposure] = useState(0);
  const [netPosition, setNetPosition] = useState(0);

  // Order entry state
  const [orderSymbol, setOrderSymbol] = useState('MES');
  const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderQty, setOrderQty] = useState(1);
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [limitPrice, setLimitPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Polling interval - use ref to avoid stale closures
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Derived state
  const hasAnyConnected = accounts.some(a => a.connected);
  const activeAccountData = accounts.find(a => a.name === activeAccount);

  // ============================================================================
  // API Calls
  // ============================================================================

  const fetchAccounts = useCallback(async () => {
    try {
      const result = await window.electron.trading.accounts();
      if (result.success && result.accounts) {
        setAccounts(result.accounts);
        // Set active account if not set
        if (!activeAccount && result.accounts.length > 0) {
          setActiveAccount(result.activeAccount || result.accounts[0].name);
        }
      }
    } catch {
      // Server not running or accounts not configured
    }
  }, [activeAccount]);

  const checkHealth = useCallback(async () => {
    try {
      const result = await window.electron.trading.health();
      if (result.status === 'ok') {
        setStatus({
          connected: result.connected,
          mode: result.mode,
          halted: false,
          availableSymbols: ['ES', 'MES', 'NQ', 'MNQ'],
          accounts: result.accounts,
        });
        // Also fetch accounts
        await fetchAccounts();
      }
    } catch {
      // Server not running
    }
  }, [fetchAccounts]);

  const fetchStatus = useCallback(async () => {
    try {
      const result = await window.electron.trading.status();
      setStatus(result);
      // Update accounts from status
      if (result.accounts) {
        setAccounts(result.accounts as Account[]);
      }
    } catch {
      setStatus({ connected: false, mode: null, halted: false, availableSymbols: [], accounts: [] });
    }
  }, []);

  const fetchPositions = useCallback(async () => {
    if (!hasAnyConnected) return;
    try {
      // Fetch aggregated positions
      const result = await window.electron.trading.positions({ aggregate: true });
      if (result.success) {
        if (result.positions) {
          setPositions(result.positions);
        }
        if (result.byAccount) {
          setPositionsByAccount(result.byAccount);
        }
        setTotalExposure(result.totalExposure || 0);
        setNetPosition(result.netPosition || 0);
      }
    } catch (error) {
      console.error('Failed to fetch positions:', error);
    }
  }, [hasAnyConnected]);

  const fetchDailyPnl = useCallback(async () => {
    if (!hasAnyConnected) return;
    try {
      const result = await window.electron.trading.dailyPnl({ aggregate: true });
      if (result.success) {
        if (result.dailyStats) {
          setDailyStats(result.dailyStats);
        }
        if (result.byAccount) {
          setDailyStatsByAccount(result.byAccount);
        }
      }
    } catch (error) {
      console.error('Failed to fetch daily PnL:', error);
    }
  }, [hasAnyConnected]);

  // ============================================================================
  // Connection Handlers
  // ============================================================================

  // Setup dual accounts (paper + live)
  const handleSetupDual = async () => {
    setConnecting(true);
    try {
      const result = await window.electron.trading.setupDual();
      if (result.success) {
        toast.success(`Dual accounts configured: ${result.accounts?.join(', ')}`);
        await fetchAccounts();
        setShowAccountSetup(false);
      } else {
        toast.error(`Setup failed: ${result.error}`);
      }
    } catch (error) {
      toast.error(`Setup error: ${error}`);
    } finally {
      setConnecting(false);
    }
  };

  // Connect a specific account
  const handleConnectAccount = async (accountName: string) => {
    setConnecting(true);
    try {
      const result = await window.electron.trading.connectAccount(accountName);
      if (result.success) {
        toast.success(`Connected ${accountName} (${result.mode})`);
        await fetchAccounts();
        await fetchPositions();
        await fetchDailyPnl();
      } else {
        toast.error(`Connection failed: ${result.error}`);
      }
    } catch (error) {
      toast.error(`Connection error: ${error}`);
    } finally {
      setConnecting(false);
    }
  };

  // Disconnect a specific account
  const handleDisconnectAccount = async (accountName: string) => {
    try {
      const result = await window.electron.trading.disconnectAccount(accountName);
      if (result.success) {
        toast.info(`Disconnected ${accountName}`);
        await fetchAccounts();
      } else {
        toast.error(`Disconnect failed: ${result.error}`);
      }
    } catch (error) {
      toast.error(`Disconnect error: ${error}`);
    }
  };

  // Connect all accounts
  const handleConnectAll = async () => {
    setConnecting(true);
    try {
      const result = await window.electron.trading.connectAll();
      if (result.success) {
        const connected = Object.entries(result.results || {})
          .filter(([_, r]) => r.connected)
          .map(([name]) => name);
        if (connected.length > 0) {
          toast.success(`Connected: ${connected.join(', ')}`);
        }
        await fetchAccounts();
        await fetchPositions();
        await fetchDailyPnl();
      } else {
        toast.error(`Connect all failed: ${result.error}`);
      }
    } catch (error) {
      toast.error(`Connect error: ${error}`);
    } finally {
      setConnecting(false);
    }
  };

  // Disconnect all accounts
  const handleDisconnectAll = async () => {
    try {
      await window.electron.trading.disconnectAll();
      await fetchAccounts();
      setPositions({});
      setPositionsByAccount({});
      setDailyStats(null);
      setDailyStatsByAccount({});
      toast.info('Disconnected all accounts');
    } catch (error) {
      toast.error(`Disconnect error: ${error}`);
    }
  };

  // Legacy handlers (backwards compatibility)
  const handleConnect = async (mode: 'paper' | 'live') => {
    setConnecting(true);
    try {
      const result = await window.electron.trading.connect(mode);
      if (result.success) {
        toast.success(`Connected to IBKR in ${mode} mode`);
        await fetchAccounts();
        await fetchPositions();
        await fetchDailyPnl();
      } else {
        toast.error(`Connection failed: ${result.error}`);
      }
    } catch (error) {
      toast.error(`Connection error: ${error}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await window.electron.trading.disconnect();
      setStatus({ connected: false, mode: null, halted: false, availableSymbols: [], accounts: [] });
      setAccounts([]);
      setPositions({});
      setDailyStats(null);
      toast.info('Disconnected from IBKR');
    } catch (error) {
      toast.error(`Disconnect error: ${error}`);
    }
  };

  // Set active account for orders
  const handleSetActiveAccount = async (name: string) => {
    try {
      await window.electron.trading.setActiveAccount(name);
      setActiveAccount(name);
    } catch (error) {
      console.error('Failed to set active account:', error);
    }
  };

  // ============================================================================
  // Order Handlers
  // ============================================================================

  const handleSubmitOrder = async () => {
    if (orderQty <= 0) {
      toast.error('Quantity must be positive');
      return;
    }

    if (orderType === 'LIMIT' && !limitPrice) {
      toast.error('Limit price required for LIMIT orders');
      return;
    }

    if (!activeAccount && accounts.length > 0) {
      toast.error('Please select an account first');
      return;
    }

    setSubmitting(true);
    try {
      const params: OrderParams = {
        symbol: orderSymbol,
        side: orderSide,
        quantity: orderQty,
        orderType,
        limitPrice: orderType === 'LIMIT' ? parseFloat(limitPrice) : undefined,
        account: activeAccount || undefined,
      };

      const result = await window.electron.trading.order(params);

      if (result.success) {
        const acctLabel = result.order?.account ? ` (${result.order.account})` : '';
        toast.success(`Order submitted: ${orderSide} ${orderQty} ${orderSymbol}${acctLabel}`);
        // Refresh positions
        await fetchPositions();
        await fetchDailyPnl();
      } else {
        toast.error(`Order failed: ${result.error}`);
      }
    } catch (error) {
      toast.error(`Order error: ${error}`);
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================================
  // Kill Switch
  // ============================================================================

  // Kill switch for a specific account
  const handleKillSwitchAccount = async (accountName: string) => {
    try {
      const result = await window.electron.trading.killSwitch(
        `Manual kill switch from UI for ${accountName}`,
        { account: accountName }
      );

      if (result.success) {
        toast.warning(`KILL SWITCH: ${accountName} - All positions flattened`);
        await fetchAccounts();
        await fetchPositions();
        await fetchDailyPnl();
      } else {
        toast.error(`Kill switch failed: ${result.error}`);
      }
    } catch (error) {
      toast.error(`Kill switch error: ${error}`);
    }
  };

  // Kill switch for ALL accounts
  const handleKillSwitchAll = async () => {
    try {
      const result = await window.electron.trading.killSwitch(
        'Manual kill switch from UI - ALL ACCOUNTS',
        { all: true }
      );

      if (result.success) {
        toast.warning('GLOBAL KILL SWITCH ACTIVATED - All accounts flattened');
        await fetchAccounts();
        await fetchPositions();
        await fetchDailyPnl();
      } else {
        toast.error(`Kill switch failed: ${result.error}`);
      }
    } catch (error) {
      toast.error(`Kill switch error: ${error}`);
    }
  };

  // Legacy handler
  const handleKillSwitch = async () => {
    await handleKillSwitchAll();
  };

  // ============================================================================
  // Effects
  // ============================================================================

  // Initial health check and accounts fetch
  useEffect(() => {
    checkHealth();
    fetchAccounts();
  }, [checkHealth, fetchAccounts]);

  // Start polling when any account is connected
  // FIX: Use refs to avoid stale closure memory leak
  useEffect(() => {
    // Clear any existing interval first
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    if (hasAnyConnected) {
      pollIntervalRef.current = setInterval(() => {
        fetchAccounts();
        fetchPositions();
        fetchDailyPnl();
      }, 2000);
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [hasAnyConnected, fetchAccounts, fetchPositions, fetchDailyPnl]);

  // Listen for kill switch events
  useEffect(() => {
    const unsubscribe = window.electron.onKillSwitchActivated?.((data) => {
      toast.error(`KILL SWITCH: ${data.reason}`, { duration: 10000 });
      // Refresh state after kill switch
      fetchAccounts();
      fetchPositions();
    });
    return unsubscribe;
  }, [fetchAccounts, fetchPositions]);

  // ============================================================================
  // Render
  // ============================================================================

  // Get positions based on view mode
  const displayPositions = showAggregated || !activeAccount
    ? Object.values(positions)
    : Object.values(positionsByAccount[activeAccount] || {});
  const hasPositions = displayPositions.length > 0;

  // Get daily stats based on view mode
  const displayStats = showAggregated || !activeAccount
    ? dailyStats
    : dailyStatsByAccount[activeAccount] || null;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Account Management Card */}
      <Card className="bg-card/50 backdrop-blur">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              IBKR Accounts
            </CardTitle>
            <div className="flex items-center gap-2">
              {accounts.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Label htmlFor="aggregate-toggle" className="text-xs">Aggregate</Label>
                  <Switch
                    id="aggregate-toggle"
                    checked={showAggregated}
                    onCheckedChange={setShowAggregated}
                  />
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleSetupDual}
                disabled={connecting}
              >
                <Settings className="w-4 h-4 mr-1" />
                Setup Dual
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <div className="text-center py-4">
              <div className="text-muted-foreground mb-3">No accounts configured</div>
              <div className="flex items-center justify-center gap-4">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleSetupDual}
                  disabled={connecting}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Quick Setup (Paper + Live)
                </Button>
                <span className="text-muted-foreground">or</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleConnect('paper')}
                  disabled={connecting}
                >
                  Connect Single Account
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Account List */}
              {accounts.map((account) => (
                <div
                  key={account.name}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-lg border transition-colors',
                    account.name === activeAccount && 'bg-primary/10 border-primary',
                    account.connected ? 'bg-muted/30' : 'bg-muted/10'
                  )}
                >
                  <div className="flex items-center gap-3">
                    {/* Connection indicator */}
                    <div
                      className={cn(
                        'w-3 h-3 rounded-full',
                        account.connected ? 'bg-green-500' : 'bg-muted-foreground/50'
                      )}
                    />
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {account.name}
                        <Badge
                          variant={account.mode === 'live' ? 'destructive' : 'default'}
                          className={cn(
                            'text-xs uppercase',
                            account.mode === 'paper' && 'bg-blue-500'
                          )}
                        >
                          {account.mode}
                        </Badge>
                        {account.halted && (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            HALTED
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {account.host}:{account.port}
                        {account.ibkrAccountId && ` - ${account.ibkrAccountId}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Set as active button */}
                    {account.connected && account.name !== activeAccount && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetActiveAccount(account.name)}
                      >
                        Set Active
                      </Button>
                    )}
                    {/* Connect/Disconnect button */}
                    {account.connected ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDisconnectAccount(account.name)}
                      >
                        <PowerOff className="w-4 h-4 mr-1" />
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleConnectAccount(account.name)}
                        disabled={connecting}
                        className={cn(
                          account.mode === 'live'
                            ? 'border-red-500 text-white bg-red-600 hover:bg-red-700'
                            : 'bg-blue-600 hover:bg-blue-700'
                        )}
                      >
                        <Power className="w-4 h-4 mr-1" />
                        Connect
                      </Button>
                    )}
                  </div>
                </div>
              ))}

              {/* Bulk actions */}
              <div className="flex items-center justify-between pt-2 border-t">
                <div className="text-sm text-muted-foreground">
                  {accounts.filter(a => a.connected).length} of {accounts.length} connected
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { fetchAccounts(); fetchPositions(); fetchDailyPnl(); }}
                  >
                    <RefreshCw className="w-4 h-4 mr-1" />
                    Refresh
                  </Button>
                  {hasAnyConnected ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDisconnectAll}
                    >
                      Disconnect All
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleConnectAll}
                      disabled={connecting}
                    >
                      Connect All
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Daily P&L Card */}
      {hasAnyConnected && displayStats && (
        <Card className="bg-card/50 backdrop-blur">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-primary" />
                Daily P&L
                {!showAggregated && activeAccount && (
                  <Badge variant="outline" className="ml-2">{activeAccount}</Badge>
                )}
                {showAggregated && <Badge variant="outline" className="ml-2">All Accounts</Badge>}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Total P&L</div>
                <div
                  className={cn(
                    'text-xl font-mono font-bold',
                    displayStats.total_pnl >= 0 ? 'text-green-500' : 'text-red-500'
                  )}
                >
                  {displayStats.total_pnl >= 0 ? '+' : ''}
                  ${displayStats.total_pnl.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Realized</div>
                <div
                  className={cn(
                    'text-lg font-mono',
                    displayStats.realized_pnl >= 0 ? 'text-green-500' : 'text-red-500'
                  )}
                >
                  ${displayStats.realized_pnl.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Unrealized</div>
                <div
                  className={cn(
                    'text-lg font-mono',
                    displayStats.unrealized_pnl >= 0 ? 'text-green-500' : 'text-red-500'
                  )}
                >
                  ${displayStats.unrealized_pnl.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Win Rate</div>
                <div className="text-lg font-mono">
                  {displayStats.win_rate.toFixed(1)}%
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Positions Card */}
      {hasAnyConnected && (
        <Card className="bg-card/50 backdrop-blur">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                Positions
                {!showAggregated && activeAccount && (
                  <Badge variant="outline" className="ml-2">{activeAccount}</Badge>
                )}
                {showAggregated && <Badge variant="outline" className="ml-2">All Accounts</Badge>}
              </CardTitle>
              <div className="text-sm text-muted-foreground">
                Exposure: ${totalExposure.toLocaleString()} | Net: {netPosition}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {hasPositions ? (
              <div className="space-y-2">
                {displayPositions.map((pos, idx) => (
                  <div
                    key={`${pos.symbol}-${pos.account || idx}`}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center',
                          pos.is_long ? 'bg-green-500/20' : 'bg-red-500/20'
                        )}
                      >
                        {pos.is_long ? (
                          <TrendingUp className="w-4 h-4 text-green-500" />
                        ) : (
                          <TrendingDown className="w-4 h-4 text-red-500" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {pos.symbol}
                          {showAggregated && pos.account && (
                            <Badge variant="outline" className="text-xs">{pos.account}</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {pos.quantity} @ ${pos.avg_cost.toFixed(2)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={cn(
                          'font-mono font-medium',
                          pos.unrealized_pnl >= 0 ? 'text-green-500' : 'text-red-500'
                        )}
                      >
                        {pos.unrealized_pnl >= 0 ? '+' : ''}
                        ${pos.unrealized_pnl.toFixed(2)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Current: ${pos.current_price.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-4">
                No open positions
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Order Entry Card */}
      {hasAnyConnected && activeAccountData && !activeAccountData.halted && (
        <Card className="bg-card/50 backdrop-blur">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Quick Order
              </CardTitle>
              <Badge
                variant={activeAccountData.mode === 'live' ? 'destructive' : 'default'}
                className={cn('uppercase', activeAccountData.mode === 'paper' && 'bg-blue-500')}
              >
                {activeAccount}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 gap-3">
              <div>
                <Label className="text-xs">Symbol</Label>
                <Select value={orderSymbol} onValueChange={setOrderSymbol}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MES">MES</SelectItem>
                    <SelectItem value="MNQ">MNQ</SelectItem>
                    <SelectItem value="ES">ES</SelectItem>
                    <SelectItem value="NQ">NQ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Side</Label>
                <Select
                  value={orderSide}
                  onValueChange={(v) => setOrderSide(v as 'BUY' | 'SELL')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BUY">BUY</SelectItem>
                    <SelectItem value="SELL">SELL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Qty</Label>
                <Input
                  type="number"
                  min={1}
                  value={orderQty}
                  onChange={(e) => setOrderQty(parseInt(e.target.value) || 1)}
                />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select
                  value={orderType}
                  onValueChange={(v) => setOrderType(v as 'MARKET' | 'LIMIT')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MARKET">MARKET</SelectItem>
                    <SelectItem value="LIMIT">LIMIT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {orderType === 'LIMIT' ? (
                <div>
                  <Label className="text-xs">Limit Price</Label>
                  <Input
                    type="number"
                    step="0.25"
                    placeholder="Price"
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                  />
                </div>
              ) : (
                <div className="flex items-end">
                  <Button
                    className={cn(
                      'w-full',
                      orderSide === 'BUY'
                        ? 'bg-green-600 hover:bg-green-700'
                        : 'bg-red-600 hover:bg-red-700'
                    )}
                    onClick={handleSubmitOrder}
                    disabled={submitting}
                  >
                    {submitting ? 'Sending...' : `${orderSide} ${orderQty} ${orderSymbol}`}
                  </Button>
                </div>
              )}
            </div>
            {orderType === 'LIMIT' && (
              <div className="mt-3">
                <Button
                  className={cn(
                    'w-full',
                    orderSide === 'BUY'
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-red-600 hover:bg-red-700'
                  )}
                  onClick={handleSubmitOrder}
                  disabled={submitting || !limitPrice}
                >
                  {submitting
                    ? 'Sending...'
                    : `${orderSide} ${orderQty} ${orderSymbol} @ ${limitPrice}`}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Kill Switch */}
      {hasAnyConnected && (
        <Card className="bg-red-500/10 border-red-500/50">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-red-500" />
                <div>
                  <div className="font-medium text-red-500">Emergency Kill Switch</div>
                  <div className="text-xs text-muted-foreground">
                    Cancel all orders and flatten positions
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Per-account kill switch */}
                {activeAccount && activeAccountData?.connected && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1 border-red-500 text-red-500">
                        <AlertOctagon className="w-4 h-4" />
                        Kill {activeAccount}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-red-500">
                          Kill Switch for {activeAccount}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This will immediately:
                          <ul className="list-disc list-inside mt-2 space-y-1">
                            <li>Cancel all pending orders in {activeAccount}</li>
                            <li>Flatten all positions in {activeAccount}</li>
                            <li>Halt trading for {activeAccount}</li>
                          </ul>
                          <div className="mt-4 font-bold text-foreground">
                            Other accounts will not be affected.
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-red-600 hover:bg-red-700"
                          onClick={() => handleKillSwitchAccount(activeAccount)}
                        >
                          KILL {activeAccount.toUpperCase()}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {/* Global kill switch */}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" className="gap-1">
                      <AlertOctagon className="w-4 h-4" />
                      KILL ALL
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-red-500">
                        Global Kill Switch - ALL Accounts?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        This will immediately for ALL connected accounts:
                        <ul className="list-disc list-inside mt-2 space-y-1">
                          <li>Cancel ALL pending orders</li>
                          <li>Flatten ALL open positions at market</li>
                          <li>Halt all trading activity</li>
                        </ul>
                        <div className="mt-4 font-bold text-foreground">
                          This affects: {accounts.filter(a => a.connected).map(a => a.name).join(', ')}
                        </div>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-red-600 hover:bg-red-700"
                        onClick={handleKillSwitchAll}
                      >
                        KILL ALL ACCOUNTS
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default LiveTradingPanel;
