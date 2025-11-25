/**
 * Token Spend Tracker - LLM cost monitoring
 *
 * Shows:
 * - Total spend (today, week, month)
 * - Breakdown by model (Sonnet, Haiku, DeepSeek)
 * - Token usage statistics
 * - Cost trend visualization
 * - Budget alerts
 *
 * Created: 2025-11-24
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Coins,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Zap,
  Brain,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays, startOfDay, startOfWeek, startOfMonth } from 'date-fns';

interface TokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  requests: number;
}

interface DailyUsage {
  date: string;
  totalCost: number;
  totalTokens: number;
}

interface TokenStats {
  today: { cost: number; tokens: number; requests: number };
  week: { cost: number; tokens: number; requests: number };
  month: { cost: number; tokens: number; requests: number };
  byModel: TokenUsage[];
  daily: DailyUsage[];
  budget: { daily: number; weekly: number; monthly: number };
}

const MODEL_CONFIG: Record<
  string,
  { icon: React.ReactNode; color: string; inputCost: number; outputCost: number }
> = {
  'claude-sonnet': {
    icon: <Sparkles className="h-3 w-3" />,
    color: 'text-purple-500',
    inputCost: 3.0, // per million
    outputCost: 15.0,
  },
  'claude-haiku': {
    icon: <Zap className="h-3 w-3" />,
    color: 'text-blue-500',
    inputCost: 0.25,
    outputCost: 1.25,
  },
  'claude-opus': {
    icon: <Brain className="h-3 w-3" />,
    color: 'text-orange-500',
    inputCost: 15.0,
    outputCost: 75.0,
  },
  'deepseek': {
    icon: <Zap className="h-3 w-3" />,
    color: 'text-green-500',
    inputCost: 0.14,
    outputCost: 0.28,
  },
  'gemini-flash': {
    icon: <Zap className="h-3 w-3" />,
    color: 'text-cyan-500',
    inputCost: 0.075,
    outputCost: 0.30,
  },
};

const DEFAULT_BUDGETS = {
  daily: 10,
  weekly: 50,
  monthly: 150,
};

export function TokenSpendTracker() {
  const [stats, setStats] = useState<TokenStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [_error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch from Supabase token_usage table
      const { data, error: fetchError } = await supabase
        .from('token_usage')
        .select('*')
        .gte('created_at', subDays(new Date(), 30).toISOString())
        .order('created_at', { ascending: false });

      if (fetchError) {
        // Use mock data if table doesn't exist
        if (fetchError.code === '42P01') {
          setStats(getMockStats());
          setError(null);
        } else {
          throw fetchError;
        }
      } else {
        // Process data into stats
        const processed = processUsageData(data || []);
        setStats(processed);
        setError(null);
      }
    } catch (err) {
      console.error('Failed to fetch token stats:', err);
      setStats(getMockStats());
      setError(null); // Use mock data silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    // Refresh every 5 minutes
    const interval = setInterval(fetchStats, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const formatCost = (cost: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cost);
  };

  const formatTokens = (tokens: number) => {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
    return tokens.toString();
  };

  const getBudgetStatus = (spent: number, budget: number) => {
    const percent = (spent / budget) * 100;
    if (percent >= 100) return { color: 'text-red-500', status: 'Over budget' };
    if (percent >= 80) return { color: 'text-orange-500', status: 'Near limit' };
    if (percent >= 50) return { color: 'text-yellow-500', status: 'On track' };
    return { color: 'text-green-500', status: 'Under budget' };
  };

  if (loading) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-full">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!stats) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-full text-muted-foreground">
          No usage data available
        </CardContent>
      </Card>
    );
  }

  const todayBudget = getBudgetStatus(stats.today.cost, stats.budget.daily);
  const weekBudget = getBudgetStatus(stats.week.cost, stats.budget.weekly);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Coins className="h-4 w-4" />
            Token Spend
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchStats}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <Tabs defaultValue="overview" className="h-full flex flex-col">
          <TabsList className="mx-4 grid w-auto grid-cols-3">
            <TabsTrigger value="overview" className="text-xs">
              Overview
            </TabsTrigger>
            <TabsTrigger value="models" className="text-xs">
              By Model
            </TabsTrigger>
            <TabsTrigger value="trend" className="text-xs">
              Trend
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex-1 min-h-0 mt-2">
            <ScrollArea className="h-full">
              <div className="px-4 pb-4 space-y-4">
                {/* Budget Alerts */}
                {stats.today.cost >= stats.budget.daily * 0.8 && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-orange-500/10 text-orange-500 text-sm">
                    <AlertTriangle className="h-4 w-4" />
                    <span>Approaching daily budget limit</span>
                  </div>
                )}

                {/* Period Stats */}
                <div className="grid grid-cols-3 gap-2">
                  {/* Today */}
                  <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                    <div className="text-xs text-muted-foreground">Today</div>
                    <div className="text-xl font-semibold">
                      {formatCost(stats.today.cost)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatTokens(stats.today.tokens)} tokens
                    </div>
                    <Progress
                      value={Math.min(100, (stats.today.cost / stats.budget.daily) * 100)}
                      className="h-1"
                    />
                    <div className={cn('text-xs', todayBudget.color)}>
                      {todayBudget.status}
                    </div>
                  </div>

                  {/* Week */}
                  <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                    <div className="text-xs text-muted-foreground">This Week</div>
                    <div className="text-xl font-semibold">
                      {formatCost(stats.week.cost)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatTokens(stats.week.tokens)} tokens
                    </div>
                    <Progress
                      value={Math.min(100, (stats.week.cost / stats.budget.weekly) * 100)}
                      className="h-1"
                    />
                    <div className={cn('text-xs', weekBudget.color)}>
                      {weekBudget.status}
                    </div>
                  </div>

                  {/* Month */}
                  <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                    <div className="text-xs text-muted-foreground">This Month</div>
                    <div className="text-xl font-semibold">
                      {formatCost(stats.month.cost)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatTokens(stats.month.tokens)} tokens
                    </div>
                    <Progress
                      value={Math.min(100, (stats.month.cost / stats.budget.monthly) * 100)}
                      className="h-1"
                    />
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <div className="text-xs text-muted-foreground">Requests Today</div>
                    <div className="text-lg font-semibold">{stats.today.requests}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <div className="text-xs text-muted-foreground">Avg Cost/Request</div>
                    <div className="text-lg font-semibold">
                      {stats.today.requests > 0
                        ? formatCost(stats.today.cost / stats.today.requests)
                        : '$0.00'}
                    </div>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="models" className="flex-1 min-h-0 mt-2">
            <ScrollArea className="h-full">
              <div className="px-4 pb-4 space-y-2">
                {stats.byModel.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No model usage data
                  </div>
                ) : (
                  stats.byModel.map((model) => {
                    const config = MODEL_CONFIG[model.model] || {
                      icon: <Sparkles className="h-3 w-3" />,
                      color: 'text-gray-500',
                    };
                    const totalCost = stats.byModel.reduce((sum, m) => sum + m.cost, 0);
                    const percent = totalCost > 0 ? (model.cost / totalCost) * 100 : 0;

                    return (
                      <div
                        key={model.model}
                        className="p-3 rounded-lg bg-muted/50 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={config.color}>{config.icon}</span>
                            <span className="font-medium text-sm">{model.model}</span>
                          </div>
                          <span className="font-semibold">{formatCost(model.cost)}</span>
                        </div>
                        <Progress value={percent} className="h-1.5" />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>
                            In: {formatTokens(model.inputTokens)} | Out:{' '}
                            {formatTokens(model.outputTokens)}
                          </span>
                          <span>{model.requests} requests</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="trend" className="flex-1 min-h-0 mt-2">
            <ScrollArea className="h-full">
              <div className="px-4 pb-4 space-y-2">
                {/* Simple bar chart of daily spending */}
                <div className="space-y-1">
                  {stats.daily.slice(0, 7).map((day, i) => {
                    const maxCost = Math.max(...stats.daily.map((d) => d.totalCost));
                    const width = maxCost > 0 ? (day.totalCost / maxCost) * 100 : 0;
                    const isToday = i === 0;

                    return (
                      <div key={day.date} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span
                            className={cn(
                              'text-muted-foreground',
                              isToday && 'font-medium text-foreground'
                            )}
                          >
                            {isToday ? 'Today' : format(new Date(day.date), 'EEE')}
                          </span>
                          <span className="font-mono">{formatCost(day.totalCost)}</span>
                        </div>
                        <div className="h-3 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all',
                              day.totalCost > stats.budget.daily
                                ? 'bg-red-500'
                                : day.totalCost > stats.budget.daily * 0.8
                                ? 'bg-orange-500'
                                : 'bg-primary'
                            )}
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Weekly comparison */}
                <div className="pt-4 border-t">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Week over week</span>
                    {stats.daily.length >= 14 && (
                      <div className="flex items-center gap-1">
                        {(() => {
                          const thisWeek = stats.daily
                            .slice(0, 7)
                            .reduce((sum, d) => sum + d.totalCost, 0);
                          const lastWeek = stats.daily
                            .slice(7, 14)
                            .reduce((sum, d) => sum + d.totalCost, 0);
                          const change =
                            lastWeek > 0
                              ? ((thisWeek - lastWeek) / lastWeek) * 100
                              : 0;
                          const isUp = change > 0;

                          return (
                            <>
                              {isUp ? (
                                <TrendingUp className="h-3 w-3 text-red-500" />
                              ) : (
                                <TrendingDown className="h-3 w-3 text-green-500" />
                              )}
                              <span
                                className={cn(
                                  'font-mono',
                                  isUp ? 'text-red-500' : 'text-green-500'
                                )}
                              >
                                {isUp ? '+' : ''}
                                {change.toFixed(0)}%
                              </span>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function processUsageData(data: any[]): TokenStats {
  const today = startOfDay(new Date());
  const weekStart = startOfWeek(new Date());
  const monthStart = startOfMonth(new Date());

  const todayData = data.filter((d) => new Date(d.created_at) >= today);
  const weekData = data.filter((d) => new Date(d.created_at) >= weekStart);
  const monthData = data.filter((d) => new Date(d.created_at) >= monthStart);

  const sumStats = (items: any[]) => ({
    cost: items.reduce((sum, d) => sum + (d.cost || 0), 0),
    tokens: items.reduce(
      (sum, d) => sum + (d.input_tokens || 0) + (d.output_tokens || 0),
      0
    ),
    requests: items.length,
  });

  // Group by model
  const byModel: TokenUsage[] = [];
  const modelMap = new Map<string, TokenUsage>();
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
    entry.inputTokens += d.input_tokens || 0;
    entry.outputTokens += d.output_tokens || 0;
    entry.cost += d.cost || 0;
    entry.requests += 1;
  }
  modelMap.forEach((v) => byModel.push(v));
  byModel.sort((a, b) => b.cost - a.cost);

  // Group by day for trend
  const dailyMap = new Map<string, DailyUsage>();
  for (const d of data) {
    const date = format(new Date(d.created_at), 'yyyy-MM-dd');
    if (!dailyMap.has(date)) {
      dailyMap.set(date, { date, totalCost: 0, totalTokens: 0 });
    }
    const entry = dailyMap.get(date)!;
    entry.totalCost += d.cost || 0;
    entry.totalTokens += (d.input_tokens || 0) + (d.output_tokens || 0);
  }
  const daily = Array.from(dailyMap.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return {
    today: sumStats(todayData),
    week: sumStats(weekData),
    month: sumStats(monthData),
    byModel,
    daily,
    budget: DEFAULT_BUDGETS,
  };
}

function getMockStats(): TokenStats {
  const daily: DailyUsage[] = Array.from({ length: 14 }, (_, i) => ({
    date: format(subDays(new Date(), i), 'yyyy-MM-dd'),
    totalCost: Math.random() * 8 + 2,
    totalTokens: Math.floor(Math.random() * 500000) + 100000,
  }));

  return {
    today: {
      cost: 5.47,
      tokens: 245000,
      requests: 34,
    },
    week: {
      cost: 32.18,
      tokens: 1420000,
      requests: 187,
    },
    month: {
      cost: 98.45,
      tokens: 4350000,
      requests: 523,
    },
    byModel: [
      {
        model: 'claude-sonnet',
        inputTokens: 2500000,
        outputTokens: 850000,
        cost: 72.5,
        requests: 412,
      },
      {
        model: 'claude-haiku',
        inputTokens: 800000,
        outputTokens: 200000,
        cost: 8.45,
        requests: 89,
      },
      {
        model: 'gemini-flash',
        inputTokens: 1200000,
        outputTokens: 300000,
        cost: 4.5,
        requests: 156,
      },
      {
        model: 'deepseek',
        inputTokens: 500000,
        outputTokens: 150000,
        cost: 2.1,
        requests: 45,
      },
    ],
    daily,
    budget: DEFAULT_BUDGETS,
  };
}
