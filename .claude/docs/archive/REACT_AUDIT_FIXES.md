# REACT DASHBOARD AUDIT - CONCRETE FIXES

This document provides copy-paste ready fixes for all identified issues.

---

## FIX #1: Dependency Array Pattern (Affects 6 Components)

### Problem File: ShadowPositionMonitor.tsx (lines 81-185)

**Current Code (PROBLEMATIC):**
```typescript
const fetchData = useCallback(async () => {
  try {
    // ... fetch operations ...
    setPositions(transformedPositions);
    setGraduationProgress(transformedProgress);
    setRecentTrades(transformedTrades);
    setError(null);
  } catch (err) {
    // ...
  } finally {
    setLoading(false);
  }
}, []);

useEffect(() => {
  fetchData();
  const interval = setInterval(fetchData, 30000);
  return () => clearInterval(interval);
}, [fetchData]); // ESLint warning: fetchData is created anew each render but deps say it's constant
```

**OPTION A: Inline Fetch Logic (RECOMMENDED)**

Replace lines 81-185 with:

```typescript
useEffect(() => {
  const controller = new AbortController();

  const loadData = async () => {
    try {
      setLoading(true);

      // Fetch open positions
      const { data: positionsData, error: positionsError } = await supabase
        .from('shadow_positions')
        .select(`
          id,
          strategy_id,
          symbol,
          side,
          quantity,
          entry_price,
          current_price,
          current_pnl,
          entry_time,
          regime_at_entry,
          strategy_genome(name)
        `)
        .eq('is_open', true)
        .order('entry_time', { ascending: false })
        .limit(20);

      if (positionsError) throw positionsError;

      // Fetch graduation progress
      const { data: graduationData, error: graduationError } = await supabase
        .from('graduation_tracker')
        .select(`
          strategy_id,
          trade_count,
          win_rate,
          rolling_sharpe,
          total_pnl,
          strategy_genome(name)
        `)
        .order('rolling_sharpe', { ascending: false })
        .limit(10);

      if (graduationError) throw graduationError;

      // Fetch recent closed trades
      const { data: tradesData, error: tradesError } = await supabase
        .from('shadow_trades')
        .select(`
          id,
          strategy_id,
          symbol,
          side,
          quantity,
          entry_price,
          exit_price,
          pnl,
          slippage_cost,
          duration_seconds,
          closed_at,
          strategy_genome(name)
        `)
        .not('closed_at', 'is', null)
        .order('closed_at', { ascending: false })
        .limit(20);

      if (tradesError) throw tradesError;

      // Check if request was aborted
      if (controller.signal.aborted) return;

      // Transform positions
      const transformedPositions: ShadowPosition[] = (positionsData || []).map((p: any) => ({
        ...p,
        strategy_name: p.strategy_genome?.name || 'Unknown',
      }));

      // Transform graduation progress
      const transformedProgress: GraduationProgress[] = (graduationData || []).map((g: any) => ({
        strategy_id: g.strategy_id,
        strategy_name: g.strategy_genome?.name || 'Unknown',
        trade_count: g.trade_count || 0,
        win_rate: g.win_rate || 0,
        rolling_sharpe: g.rolling_sharpe || 0,
        total_pnl: g.total_pnl || 0,
        progress_percent: Math.min(100, (g.trade_count / GRADUATION_THRESHOLD) * 100),
        is_ready: g.trade_count >= GRADUATION_THRESHOLD && g.rolling_sharpe >= SHARPE_THRESHOLD,
      }));

      // Transform recent trades
      const transformedTrades: RecentTrade[] = (tradesData || []).map((t: any) => ({
        ...t,
        strategy_name: t.strategy_genome?.name || 'Unknown',
      }));

      setPositions(transformedPositions);
      setGraduationProgress(transformedProgress);
      setRecentTrades(transformedTrades);
      setError(null);
    } catch (err) {
      // Ignore if aborted
      if (err instanceof Error && err.name === 'AbortError') return;

      console.error('Failed to fetch shadow data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  loadData();

  // Set up interval for periodic refresh
  const interval = setInterval(loadData, 30000);

  return () => {
    controller.abort(); // Cancel in-flight requests
    clearInterval(interval);
  };
}, []); // Empty deps - runs once on mount, no dependencies needed
```

**Why This Works:**
- Fetch logic lives inside useEffect
- No external dependencies needed
- Cleanup guaranteed (abort + clearInterval)
- No circular dependency issues

---

**OPTION B: Add ESLint Disable Comment (IF Option A isn't viable)**

```typescript
const fetchData = useCallback(async () => {
  // ... existing code ...
}, []);

useEffect(() => {
  fetchData();
  const interval = setInterval(fetchData, 30000);
  return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // fetchData is intentionally not included because it never changes due to empty deps in useCallback
```

---

## FIX #2: Type Safety - Replace `any` Types

### Problem File: ShadowPositionMonitor.tsx (lines 145, 151, 163)

**Current Code (PROBLEMATIC):**
```typescript
const transformedPositions: ShadowPosition[] = (positionsData || []).map((p: any) => ({
  ...p,
  strategy_name: p.strategy_genome?.name || 'Unknown',
}));
```

**Fixed Code:**

Add these interfaces at the top of the file after imports:

```typescript
// Type-safe data interfaces for Supabase responses
interface PositionRow {
  id: string;
  strategy_id: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  entry_price: number;
  current_price: number;
  current_pnl: number;
  entry_time: string;
  regime_at_entry: string;
  strategy_genome?: {
    name?: string;
  } | null;
  is_open: boolean;
}

interface GraduationRow {
  strategy_id: string;
  trade_count: number | null;
  win_rate: number | null;
  rolling_sharpe: number | null;
  total_pnl: number | null;
  strategy_genome?: {
    name?: string;
  } | null;
}

interface TradeRow {
  id: string;
  strategy_id: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  entry_price: number;
  exit_price: number;
  pnl: number;
  slippage_cost: number;
  duration_seconds: number;
  closed_at: string;
  strategy_genome?: {
    name?: string;
  } | null;
}
```

Then update the transformation code:

```typescript
// Transform positions
const transformedPositions: ShadowPosition[] = (positionsData as PositionRow[] || []).map((p) => ({
  ...p,
  strategy_name: p.strategy_genome?.name || 'Unknown',
}));

// Transform graduation progress
const transformedProgress: GraduationProgress[] = (graduationData as GraduationRow[] || []).map((g) => ({
  strategy_id: g.strategy_id,
  strategy_name: g.strategy_genome?.name || 'Unknown',
  trade_count: g.trade_count || 0,
  win_rate: g.win_rate || 0,
  rolling_sharpe: g.rolling_sharpe || 0,
  total_pnl: g.total_pnl || 0,
  progress_percent: Math.min(100, ((g.trade_count || 0) / GRADUATION_THRESHOLD) * 100),
  is_ready: (g.trade_count || 0) >= GRADUATION_THRESHOLD && (g.rolling_sharpe || 0) >= SHARPE_THRESHOLD,
}));

// Transform recent trades
const transformedTrades: RecentTrade[] = (tradesData as TradeRow[] || []).map((t) => ({
  ...t,
  strategy_name: t.strategy_genome?.name || 'Unknown',
}));
```

**Benefits:**
- TypeScript now validates all property access
- IDE autocomplete works
- Errors caught at compile time, not runtime

---

## FIX #3: Type Safety - TokenSpendTracker.tsx

### Problem File: TokenSpendTracker.tsx (lines 445+)

**Current Code (PROBLEMATIC):**
```typescript
function processUsageData(data: any[]): TokenStats {
  const today = startOfDay(new Date());
  const weekStart = startOfWeek(new Date());
  const monthStart = startOfMonth(new Date());

  const todayData = data.filter((d) => new Date(d.created_at) >= today);
  // ...
  for (const d of monthData) {
    const model = d.model || 'unknown';
    if (!modelMap.has(model)) {
      modelMap.set(model, {
        model,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        requests: 0,
      });
    }
    const entry = modelMap.get(model)!;
    entry.inputTokens += d.input_tokens || 0; // Unsafe
    entry.outputTokens += d.output_tokens || 0;
    entry.cost += d.cost || 0;
    entry.requests += 1;
  }
}
```

**Fixed Code:**

Add this interface at the top:

```typescript
interface TokenUsageRecord {
  created_at: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}
```

Then update the function:

```typescript
function processUsageData(data: TokenUsageRecord[]): TokenStats {
  const today = startOfDay(new Date());
  const weekStart = startOfWeek(new Date());
  const monthStart = startOfMonth(new Date());

  const todayData = data.filter((d) => new Date(d.created_at) >= today);
  const weekData = data.filter((d) => new Date(d.created_at) >= weekStart);
  const monthData = data.filter((d) => new Date(d.created_at) >= monthStart);

  const sumStats = (items: TokenUsageRecord[]) => ({
    cost: items.reduce((sum, d) => sum + d.cost, 0),
    tokens: items.reduce(
      (sum, d) => sum + d.input_tokens + d.output_tokens,
      0
    ),
    requests: items.length,
  });

  // Group by model
  const byModel: TokenUsage[] = [];
  const modelMap = new Map<string, TokenUsage>();

  for (const d of monthData) {
    const model = d.model;
    if (!modelMap.has(model)) {
      modelMap.set(model, {
        model,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        requests: 0,
      });
    }
    const entry = modelMap.get(model)!;
    entry.inputTokens += d.input_tokens; // Now type-safe
    entry.outputTokens += d.output_tokens;
    entry.cost += d.cost;
    entry.requests += 1;
  }

  modelMap.forEach((v) => byModel.push(v));
  byModel.sort((a, b) => b.cost - a.cost);

  // ... rest of function
}
```

---

## FIX #4: Division by Zero Protection

### Problem File: TokenSpendTracker.tsx (lines 162-168)

**Current Code (PROBLEMATIC):**
```typescript
const getBudgetStatus = (spent: number, budget: number) => {
  const percent = (spent / budget) * 100; // Can be Infinity if budget = 0
  if (percent >= 100) return { color: 'text-red-500', status: 'Over budget' };
  if (percent >= 80) return { color: 'text-orange-500', status: 'Near limit' };
  if (percent >= 50) return { color: 'text-yellow-500', status: 'On track' };
  return { color: 'text-green-500', status: 'Under budget' };
};
```

**Fixed Code:**
```typescript
const getBudgetStatus = (spent: number, budget: number) => {
  // Protect against zero or negative budgets
  if (budget <= 0) {
    return { color: 'text-muted-foreground', status: 'No budget set' };
  }

  const percent = (spent / budget) * 100;

  if (percent >= 100) {
    return { color: 'text-red-500', status: 'Over budget' };
  }
  if (percent >= 80) {
    return { color: 'text-orange-500', status: 'Near limit' };
  }
  if (percent >= 50) {
    return { color: 'text-yellow-500', status: 'On track' };
  }
  return { color: 'text-green-500', status: 'Under budget' };
};
```

---

## FIX #5: Race Condition Protection

### Problem File: ShadowPositionMonitor.tsx (Alternative Implementation)

**Add AbortController-based approach:**

```typescript
const abortControllerRef = useRef<AbortController | null>(null);

useEffect(() => {
  // Cancel any previous request
  if (abortControllerRef.current) {
    abortControllerRef.current.abort();
  }

  const controller = new AbortController();
  abortControllerRef.current = controller;

  const loadData = async () => {
    try {
      setLoading(true);

      // Use Promise.all for parallel requests
      const [positionsResult, graduationResult, tradesResult] = await Promise.all([
        supabase
          .from('shadow_positions')
          .select(`...`)
          .eq('is_open', true)
          .order('entry_time', { ascending: false })
          .limit(20),
        supabase
          .from('graduation_tracker')
          .select(`...`)
          .order('rolling_sharpe', { ascending: false })
          .limit(10),
        supabase
          .from('shadow_trades')
          .select(`...`)
          .not('closed_at', 'is', null)
          .order('closed_at', { ascending: false })
          .limit(20),
      ]);

      // Check if aborted before processing
      if (controller.signal.aborted) return;

      const { data: positionsData, error: positionsError } = positionsResult;
      const { data: graduationData, error: graduationError } = graduationResult;
      const { data: tradesData, error: tradesError } = tradesResult;

      if (positionsError || graduationError || tradesError) {
        throw new Error([
          positionsError?.message,
          graduationError?.message,
          tradesError?.message,
        ]
          .filter(Boolean)
          .join('; '));
      }

      // Transform and set state
      const transformedPositions: ShadowPosition[] = (positionsData || []).map((p: any) => ({
        ...p,
        strategy_name: p.strategy_genome?.name || 'Unknown',
      }));

      // ... rest of transformations ...

      setPositions(transformedPositions);
      setGraduationProgress(transformedProgress);
      setRecentTrades(transformedTrades);
      setError(null);
    } catch (err) {
      // Ignore AbortError
      if (err instanceof Error && err.name === 'AbortError') return;

      console.error('Failed to fetch shadow data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  loadData();

  // Refresh every 30 seconds
  const interval = setInterval(loadData, 30000);

  return () => {
    controller.abort();
    clearInterval(interval);
  };
}, []);
```

---

## FIX #6: Memoization for Filter Operations

### Problem Files: Multiple (StrategyGenomeBrowser, MemoryBrowser, DataInventory)

**Example: StrategyGenomeBrowser.tsx (lines 181-187)**

**Current Code (PROBLEMATIC):**
```typescript
const filteredStrategies = strategies.filter((strategy) => {
  const matchesSearch =
    strategy.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    strategy.description?.toLowerCase().includes(searchQuery.toLowerCase());
  const matchesStatus = statusFilter === 'all' || strategy.status === statusFilter;
  return matchesSearch && matchesStatus;
});
```

**Fixed Code:**
```typescript
import { useMemo } from 'react';

const filteredStrategies = useMemo(
  () =>
    strategies.filter((strategy) => {
      const matchesSearch =
        strategy.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        strategy.description?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || strategy.status === statusFilter;
      return matchesSearch && matchesStatus;
    }),
  [strategies, searchQuery, statusFilter]
);
```

**Apply same pattern to:**
- `MemoryBrowser.tsx` lines 147-155: filteredMemories
- `DataInventory.tsx` lines 186-190: filteredAssets

---

## FIX #7: Error Boundary Component

Create new file: `/Users/zstoc/GitHub/quant-chat-scaffold/src/components/dashboard/DashboardErrorBoundary.tsx`

```typescript
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: React.ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class DashboardErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(
      `Dashboard component "${this.props.name || 'Unknown'}" error:`,
      error,
      errorInfo
    );
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Card className="h-full border-red-500/50 bg-red-500/5">
          <CardContent className="flex items-center justify-center h-full">
            <div className="text-center max-w-sm">
              <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-3" />
              <h3 className="font-semibold text-red-500 mb-1">
                {this.props.name || 'Component'} Error
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {this.state.error?.message || 'An unexpected error occurred'}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={this.handleReset}
                className="gap-2"
              >
                <RefreshCw className="h-3 w-3" />
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}
```

**Usage (wrap each dashboard component):**

```typescript
import { DashboardErrorBoundary } from './DashboardErrorBoundary';

export function Dashboard() {
  return (
    <div className="grid grid-cols-3 gap-4">
      <DashboardErrorBoundary name="Activity Feed">
        <ActivityFeed />
      </DashboardErrorBoundary>

      <DashboardErrorBoundary name="Shadow Positions">
        <ShadowPositionMonitor />
      </DashboardErrorBoundary>

      {/* ... etc ... */}
    </div>
  );
}
```

---

## FIX #8: Accessibility - Aria Labels

### Example: ActivityFeed.tsx (lines 270-275)

**Current Code (PROBLEMATIC):**
```typescript
<button
  onClick={() => setIsLive(!isLive)}
  className="text-xs text-muted-foreground hover:text-foreground"
>
  {isLive ? 'Pause' : 'Resume'}
</button>
```

**Fixed Code:**
```typescript
<button
  onClick={() => setIsLive(!isLive)}
  className="text-xs text-muted-foreground hover:text-foreground"
  aria-label={isLive ? 'Pause activity feed' : 'Resume activity feed'}
  aria-pressed={isLive}
>
  {isLive ? 'Pause' : 'Resume'}
</button>
```

### Example: ActivityFeed.tsx (lines 261-268)

**Current Code (PROBLEMATIC):**
```typescript
<span className="relative flex h-2 w-2 mr-1">
  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
</span>
```

**Fixed Code:**
```typescript
<span
  className="relative flex h-2 w-2 mr-1"
  aria-label="Live indicator - activity feed is streaming"
>
  <span
    className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"
    aria-hidden="true"
  />
  <span
    className="relative inline-flex rounded-full h-2 w-2 bg-green-500"
    aria-hidden="true"
  />
</span>
```

---

## IMPLEMENTATION ORDER

**Week 1:**
1. Apply Fix #1 (Dependency Arrays) - 30 mins each component = 3 hours total
2. Apply Fix #2 & #3 (Type Safety) - 1.5 hours
3. Apply Fix #4 (Division by Zero) - 15 mins
4. Apply Fix #7 (Error Boundary) - 1 hour

**Week 2:**
5. Apply Fix #6 (Memoization) - 1 hour
6. Apply Fix #8 (Accessibility) - 2 hours
7. Test in development environment - 2 hours
8. Deploy to staging - 1 hour

**Total Time:** ~12 hours for experienced developer

---

## TESTING EACH FIX

```typescript
// Test Fix #1 - Dependency arrays
// In devtools: Force a rapid re-render (state change)
// Verify no new listeners are created with each render
// Check browser console for ESLint warnings

// Test Fix #2 - Type safety
// Try to access non-existent properties
// TypeScript should error at compile time
// Test: npm run type-check

// Test Fix #3 - Type safety
// Same as Fix #2

// Test Fix #4 - Division by zero
// Set DEFAULT_BUDGETS to { daily: 0, weekly: 0, monthly: 0 }
// Verify UI shows "No budget set" instead of Infinity

// Test Fix #6 - Memoization
// Add console.log inside useMemo
// Change unrelated state
// Verify console.log doesn't appear (filter not recalculated)

// Test Fix #7 - Error Boundary
// Manually throw error in a component render
// Verify error boundary catches it and shows fallback

// Test Fix #8 - Accessibility
// Use browser accessibility inspector
// Verify aria-label appears in audit results
```

---

## FINAL VERIFICATION

Run before committing:

```bash
# Type check
npm run type-check

# ESLint
npm run lint

# Build
npm run build

# Test
npm run test

# Visual inspection
npm run dev
# Open DevTools > Lighthouse > Accessibility
```

All 11 issues should be resolved before production deployment.
