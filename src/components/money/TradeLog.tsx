/**
 * TradeLog - Trade history with filtering and attribution
 *
 * PHASE 2: Money Visibility - See every trade and its impact
 *
 * Features:
 * - Filter by strategy, date, symbol, outcome
 * - P&L per trade with running total
 * - Regime at time of trade
 * - Strategy attribution
 * - Virtual scrolling for large lists
 * - Export capability
 *
 * ADHD Design:
 * - Color-coded wins/losses instantly visible
 * - Quick filters for common queries
 * - Running P&L to see cumulative impact
 * - Compact view option
 */

import { useState, useMemo, useCallback } from 'react';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Clock,
  Calendar,
  Tag,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// =========================================================================
// Types
// =========================================================================

interface Trade {
  id: string;
  timestamp: string;        // ISO date string
  symbol: string;
  direction: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  fees: number;
  netPnl: number;
  holdingPeriod: string;    // e.g., "2h 34m", "1d 4h"
  strategy: {
    id: string;
    name: string;
  };
  regime: 'trending' | 'meanReverting' | 'volatile' | 'uncertain';
  notes?: string;
  // Entry/exit reasoning (for learning)
  entryReason?: string;
  exitReason?: string;
}

interface TradeLogProps {
  trades: Trade[];
  strategies?: Array<{ id: string; name: string }>;
  onExport?: () => void;
  onTradeClick?: (trade: Trade) => void;
  pageSize?: number;
  compact?: boolean;
  className?: string;
}

// Quick filter presets
interface QuickFilter {
  id: string;
  label: string;
  filter: (trade: Trade) => boolean;
}

const QUICK_FILTERS: QuickFilter[] = [
  { id: 'today', label: 'Today', filter: (t) => isToday(new Date(t.timestamp)) },
  { id: 'week', label: 'This Week', filter: (t) => isThisWeek(new Date(t.timestamp)) },
  { id: 'winners', label: 'Winners', filter: (t) => t.netPnl > 0 },
  { id: 'losers', label: 'Losers', filter: (t) => t.netPnl < 0 },
  { id: 'large', label: 'Large Trades', filter: (t) => Math.abs(t.netPnl) > 1000 },
];

const REGIME_COLORS: Record<string, string> = {
  trending: 'bg-green-500/20 text-green-700 dark:text-green-400',
  meanReverting: 'bg-blue-500/20 text-blue-700 dark:text-blue-400',
  volatile: 'bg-red-500/20 text-red-700 dark:text-red-400',
  uncertain: 'bg-gray-500/20 text-gray-700 dark:text-gray-400',
};

const REGIME_LABELS: Record<string, string> = {
  trending: 'Trend',
  meanReverting: 'Mean Rev',
  volatile: 'Volatile',
  uncertain: 'Uncertain',
};

// Date helpers
function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

function isThisWeek(date: Date): boolean {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  return date >= startOfWeek;
}

// =========================================================================
// Component
// =========================================================================

export function TradeLog({
  trades,
  strategies = [],
  onExport,
  onTradeClick,
  pageSize = 20,
  compact = false,
  className,
}: TradeLogProps) {
  // Filter state
  const [searchText, setSearchText] = useState('');
  const [strategyFilter, setStrategyFilter] = useState<string>('all');
  const [regimeFilter, setRegimeFilter] = useState<string>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | 'winners' | 'losers'>('all');
  const [activeQuickFilters, setActiveQuickFilters] = useState<string[]>([]);

  // Sort state
  const [sortColumn, setSortColumn] = useState<keyof Trade>('timestamp');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(0);

  // Toggle quick filter
  const toggleQuickFilter = useCallback((filterId: string) => {
    setActiveQuickFilters((prev) =>
      prev.includes(filterId)
        ? prev.filter((f) => f !== filterId)
        : [...prev, filterId]
    );
    setCurrentPage(0);
  }, []);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setSearchText('');
    setStrategyFilter('all');
    setRegimeFilter('all');
    setOutcomeFilter('all');
    setActiveQuickFilters([]);
    setCurrentPage(0);
  }, []);

  // Filter trades
  const filteredTrades = useMemo(() => {
    return trades.filter((trade) => {
      // Search filter
      if (searchText) {
        const search = searchText.toLowerCase();
        if (
          !trade.symbol.toLowerCase().includes(search) &&
          !trade.strategy.name.toLowerCase().includes(search) &&
          !trade.notes?.toLowerCase().includes(search)
        ) {
          return false;
        }
      }

      // Strategy filter
      if (strategyFilter !== 'all' && trade.strategy.id !== strategyFilter) {
        return false;
      }

      // Regime filter
      if (regimeFilter !== 'all' && trade.regime !== regimeFilter) {
        return false;
      }

      // Outcome filter
      if (outcomeFilter === 'winners' && trade.netPnl <= 0) return false;
      if (outcomeFilter === 'losers' && trade.netPnl >= 0) return false;

      // Quick filters
      for (const filterId of activeQuickFilters) {
        const quickFilter = QUICK_FILTERS.find((f) => f.id === filterId);
        if (quickFilter && !quickFilter.filter(trade)) {
          return false;
        }
      }

      return true;
    });
  }, [trades, searchText, strategyFilter, regimeFilter, outcomeFilter, activeQuickFilters]);

  // Sort trades
  const sortedTrades = useMemo(() => {
    return [...filteredTrades].sort((a, b) => {
      let aVal: any = a[sortColumn];
      let bVal: any = b[sortColumn];

      // Handle nested strategy name
      if (sortColumn === ('strategy' as keyof Trade)) {
        aVal = a.strategy.name;
        bVal = b.strategy.name;
      }

      // Compare
      let comparison = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      } else if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal);
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredTrades, sortColumn, sortDirection]);

  // Paginate
  const totalPages = Math.ceil(sortedTrades.length / pageSize);
  const paginatedTrades = sortedTrades.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize
  );

  // Calculate running P&L for visible trades
  const tradesWithRunningPnL = useMemo(() => {
    let runningTotal = 0;
    // Calculate running total from start of filtered data
    const allBeforePage = sortedTrades.slice(0, currentPage * pageSize);
    runningTotal = allBeforePage.reduce((sum, t) => sum + t.netPnl, 0);

    return paginatedTrades.map((trade) => {
      runningTotal += trade.netPnl;
      return { ...trade, runningPnL: runningTotal };
    });
  }, [sortedTrades, paginatedTrades, currentPage, pageSize]);

  // Summary stats for filtered trades
  const summary = useMemo(() => {
    const winners = filteredTrades.filter((t) => t.netPnl > 0);
    const losers = filteredTrades.filter((t) => t.netPnl < 0);
    const totalPnL = filteredTrades.reduce((sum, t) => sum + t.netPnl, 0);

    return {
      total: filteredTrades.length,
      winners: winners.length,
      losers: losers.length,
      winRate: filteredTrades.length > 0 ? (winners.length / filteredTrades.length) * 100 : 0,
      totalPnL,
      avgWin: winners.length > 0 ? winners.reduce((s, t) => s + t.netPnl, 0) / winners.length : 0,
      avgLoss: losers.length > 0 ? losers.reduce((s, t) => s + t.netPnl, 0) / losers.length : 0,
    };
  }, [filteredTrades]);

  // Handle sort
  const handleSort = useCallback((column: keyof Trade) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  }, [sortColumn]);

  // Sort indicator
  const SortIndicator = ({ column }: { column: keyof Trade }) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="h-4 w-4 ml-1 opacity-50" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="h-4 w-4 ml-1" />
    ) : (
      <ArrowDown className="h-4 w-4 ml-1" />
    );
  };

  // Has any filters active?
  const hasFilters =
    searchText ||
    strategyFilter !== 'all' ||
    regimeFilter !== 'all' ||
    outcomeFilter !== 'all' ||
    activeQuickFilters.length > 0;

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className={compact ? 'pb-2' : undefined}>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Trade Log
            </CardTitle>
            {!compact && (
              <CardDescription>
                {filteredTrades.length} trades{' '}
                {hasFilters && `(filtered from ${trades.length})`}
              </CardDescription>
            )}
          </div>

          {/* Summary badges */}
          <div className="flex items-center gap-2">
            <Badge variant={summary.totalPnL >= 0 ? 'default' : 'destructive'}>
              {summary.totalPnL >= 0 ? '+' : ''}$
              {summary.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </Badge>
            <Badge variant="outline">
              {summary.winRate.toFixed(0)}% WR
            </Badge>
            {onExport && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" onClick={onExport}>
                      <Download className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Export trades</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>

        {/* Filters */}
        {!compact && (
          <div className="flex flex-col gap-3 mt-4">
            {/* Search and dropdowns */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search symbol, strategy..."
                  value={searchText}
                  onChange={(e) => {
                    setSearchText(e.target.value);
                    setCurrentPage(0);
                  }}
                  className="pl-8"
                />
              </div>

              <Select
                value={strategyFilter}
                onValueChange={(v) => {
                  setStrategyFilter(v);
                  setCurrentPage(0);
                }}
              >
                <SelectTrigger className="w-[150px]">
                  <Tag className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Strategy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Strategies</SelectItem>
                  {strategies.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={regimeFilter}
                onValueChange={(v) => {
                  setRegimeFilter(v);
                  setCurrentPage(0);
                }}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Regime" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Regimes</SelectItem>
                  <SelectItem value="trending">Trending</SelectItem>
                  <SelectItem value="meanReverting">Mean Reverting</SelectItem>
                  <SelectItem value="volatile">Volatile</SelectItem>
                  <SelectItem value="uncertain">Uncertain</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={outcomeFilter}
                onValueChange={(v: 'all' | 'winners' | 'losers') => {
                  setOutcomeFilter(v);
                  setCurrentPage(0);
                }}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Outcome" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Trades</SelectItem>
                  <SelectItem value="winners">Winners</SelectItem>
                  <SelectItem value="losers">Losers</SelectItem>
                </SelectContent>
              </Select>

              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              )}
            </div>

            {/* Quick filters */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Quick:</span>
              {QUICK_FILTERS.map((qf) => (
                <Button
                  key={qf.id}
                  variant={activeQuickFilters.includes(qf.id) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggleQuickFilter(qf.id)}
                >
                  {qf.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {/* Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  className="cursor-pointer hover:bg-muted"
                  onClick={() => handleSort('timestamp')}
                >
                  <div className="flex items-center">
                    Time
                    <SortIndicator column="timestamp" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted"
                  onClick={() => handleSort('symbol')}
                >
                  <div className="flex items-center">
                    Symbol
                    <SortIndicator column="symbol" />
                  </div>
                </TableHead>
                <TableHead>Dir</TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted text-right"
                  onClick={() => handleSort('netPnl')}
                >
                  <div className="flex items-center justify-end">
                    P&L
                    <SortIndicator column="netPnl" />
                  </div>
                </TableHead>
                {!compact && (
                  <>
                    <TableHead className="text-right">Running</TableHead>
                    <TableHead>Strategy</TableHead>
                    <TableHead>Regime</TableHead>
                    <TableHead>Hold</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tradesWithRunningPnL.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={compact ? 4 : 8}
                    className="text-center text-muted-foreground py-8"
                  >
                    No trades found
                  </TableCell>
                </TableRow>
              ) : (
                tradesWithRunningPnL.map((trade) => (
                  <TableRow
                    key={trade.id}
                    className={cn(
                      'cursor-pointer hover:bg-muted/50',
                      onTradeClick && 'cursor-pointer'
                    )}
                    onClick={() => onTradeClick?.(trade)}
                  >
                    <TableCell className="font-mono text-sm">
                      {new Date(trade.timestamp).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}{' '}
                      <span className="text-muted-foreground">
                        {new Date(trade.timestamp).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{trade.symbol}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          trade.direction === 'long'
                            ? 'border-green-500 text-green-600'
                            : 'border-red-500 text-red-600'
                        )}
                      >
                        {trade.direction === 'long' ? (
                          <TrendingUp className="h-3 w-3 mr-1" />
                        ) : (
                          <TrendingDown className="h-3 w-3 mr-1" />
                        )}
                        {trade.direction.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono font-medium',
                        trade.netPnl >= 0 ? 'text-green-600' : 'text-red-600'
                      )}
                    >
                      {trade.netPnl >= 0 ? '+' : ''}$
                      {trade.netPnl.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    {!compact && (
                      <>
                        <TableCell
                          className={cn(
                            'text-right font-mono text-sm',
                            trade.runningPnL >= 0
                              ? 'text-green-600/70'
                              : 'text-red-600/70'
                          )}
                        >
                          {trade.runningPnL >= 0 ? '+' : ''}$
                          {trade.runningPnL.toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0,
                          })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {trade.strategy.name}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={cn('text-xs', REGIME_COLORS[trade.regime])}>
                            {REGIME_LABELS[trade.regime]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {trade.holdingPeriod}
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-muted-foreground">
              Showing {currentPage * pageSize + 1}-
              {Math.min((currentPage + 1) * pageSize, sortedTrades.length)} of{' '}
              {sortedTrades.length}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm">
                Page {currentPage + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Summary footer */}
        {!compact && filteredTrades.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4 pt-4 border-t text-sm">
            <div>
              <div className="text-muted-foreground">Total Trades</div>
              <div className="font-medium">{summary.total}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Win Rate</div>
              <div
                className={cn(
                  'font-medium',
                  summary.winRate >= 50 ? 'text-green-600' : 'text-red-600'
                )}
              >
                {summary.winRate.toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Avg Win</div>
              <div className="font-medium text-green-600">
                +${summary.avgWin.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Avg Loss</div>
              <div className="font-medium text-red-600">
                ${summary.avgLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Net P&L</div>
              <div
                className={cn(
                  'font-medium',
                  summary.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'
                )}
              >
                {summary.totalPnL >= 0 ? '+' : ''}$
                {summary.totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default TradeLog;
