/**
 * PnLHeatmap - Calendar-style Daily P&L Visualization
 *
 * Displays daily returns as a heatmap calendar with:
 * - Color-coded returns (green = profit, red = loss)
 * - Monthly/yearly aggregations
 * - Click to see trade details
 */

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  Calendar,
  TrendingUp,
  TrendingDown,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Percent
} from 'lucide-react';

export interface DailyPnL {
  date: string; // YYYY-MM-DD
  pnl: number;
  returnPct: number;
  trades: number;
  regime?: string;
}

interface PnLHeatmapProps {
  data?: DailyPnL[];
  onDayClick?: (date: string, pnl: DailyPnL) => void;
  className?: string;
}

// Generate demo data for the last 12 months
function generateDemoData(): DailyPnL[] {
  const data: DailyPnL[] = [];
  const today = new Date();
  const regimes = ['LOW_VOL', 'HIGH_VOL', 'TRENDING', 'RANGING'];

  for (let i = 365; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    // Generate realistic-looking P&L
    const baseReturn = (Math.random() - 0.48) * 0.03; // Slight positive bias
    const volatility = Math.random() > 0.9 ? 3 : 1; // Occasional big moves
    const returnPct = baseReturn * volatility;
    const pnl = returnPct * 100000; // Assuming $100k portfolio

    data.push({
      date: date.toISOString().split('T')[0],
      pnl,
      returnPct,
      trades: Math.floor(Math.random() * 5) + 1,
      regime: regimes[Math.floor(Math.random() * regimes.length)]
    });
  }

  return data;
}

const DEMO_DATA = generateDemoData();

// Get color based on return percentage
function getColorClass(returnPct: number): string {
  if (returnPct > 0.02) return 'bg-green-600';
  if (returnPct > 0.01) return 'bg-green-500';
  if (returnPct > 0.005) return 'bg-green-400';
  if (returnPct > 0) return 'bg-green-300';
  if (returnPct > -0.005) return 'bg-red-300';
  if (returnPct > -0.01) return 'bg-red-400';
  if (returnPct > -0.02) return 'bg-red-500';
  return 'bg-red-600';
}

// Format currency
function formatCurrency(value: number): string {
  const absValue = Math.abs(value);
  if (absValue >= 1000) {
    return `${value >= 0 ? '+' : '-'}$${(absValue / 1000).toFixed(1)}k`;
  }
  return `${value >= 0 ? '+' : '-'}$${absValue.toFixed(0)}`;
}

// Format percentage
function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

export function PnLHeatmap({
  data = DEMO_DATA,
  onDayClick,
  className
}: PnLHeatmapProps) {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [hoveredDay, setHoveredDay] = useState<DailyPnL | null>(null);
  const [viewMode, setViewMode] = useState<'calendar' | 'monthly'>('calendar');

  // Calculate stats with safe defaults for empty data
  const stats = useMemo(() => {
    const yearData = data.filter(d => d.date.startsWith(String(selectedYear)));
    const totalPnl = yearData.reduce((sum, d) => sum + d.pnl, 0);
    const totalReturn = yearData.reduce((sum, d) => sum + d.returnPct, 0);
    const winDays = yearData.filter(d => d.pnl > 0).length;
    const lossDays = yearData.filter(d => d.pnl < 0).length;
    const totalDays = winDays + lossDays;

    // Safe defaults for empty arrays
    const defaultDay: DailyPnL = { date: '', pnl: 0, returnPct: 0, trades: 0 };
    const bestDay = yearData.length > 0
      ? yearData.reduce((best, d) => d.pnl > best.pnl ? d : best, yearData[0])
      : defaultDay;
    const worstDay = yearData.length > 0
      ? yearData.reduce((worst, d) => d.pnl < worst.pnl ? d : worst, yearData[0])
      : defaultDay;

    return {
      totalPnl,
      totalReturn,
      winDays,
      lossDays,
      winRate: totalDays > 0 ? (winDays / totalDays) * 100 : 0,
      bestDay,
      worstDay,
      tradingDays: yearData.length
    };
  }, [data, selectedYear]);

  // Group by month for calendar view
  const monthlyData = useMemo(() => {
    const months: Record<string, DailyPnL[]> = {};
    data
      .filter(d => d.date.startsWith(String(selectedYear)))
      .forEach(d => {
        const month = d.date.substring(0, 7);
        if (!months[month]) months[month] = [];
        months[month].push(d);
      });
    return months;
  }, [data, selectedYear]);

  // Calculate monthly stats
  const monthlyStats = useMemo(() => {
    return Object.entries(monthlyData).map(([month, days]) => ({
      month,
      pnl: days.reduce((sum, d) => sum + d.pnl, 0),
      returnPct: days.reduce((sum, d) => sum + d.returnPct, 0),
      trades: days.reduce((sum, d) => sum + d.trades, 0),
      days: days.length
    })).sort((a, b) => a.month.localeCompare(b.month));
  }, [monthlyData]);

  // Pre-calculate max P&L to avoid O(n²) in render loop
  const maxMonthlyPnl = useMemo(() => {
    if (monthlyStats.length === 0) return 1; // Avoid division by zero
    return Math.max(...monthlyStats.map(m => Math.abs(m.pnl)), 1);
  }, [monthlyStats]);

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <Card className={cn("bg-card/50 backdrop-blur flex flex-col", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            P&L Heatmap
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setSelectedYear(y => y - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Badge variant="outline" className="font-mono">
              {selectedYear}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setSelectedYear(y => y + 1)}
              disabled={selectedYear >= new Date().getFullYear()}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Year Stats */}
        <div className="grid grid-cols-4 gap-2 mt-2">
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <div className={cn(
              "text-lg font-bold font-mono",
              stats.totalPnl >= 0 ? "text-green-500" : "text-red-500"
            )}>
              {formatCurrency(stats.totalPnl)}
            </div>
            <div className="text-[10px] text-muted-foreground">Total P&L</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <div className={cn(
              "text-lg font-bold font-mono",
              stats.totalReturn >= 0 ? "text-green-500" : "text-red-500"
            )}>
              {formatPercent(stats.totalReturn)}
            </div>
            <div className="text-[10px] text-muted-foreground">Return</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <div className="text-lg font-bold font-mono text-green-500">
              {stats.winRate.toFixed(0)}%
            </div>
            <div className="text-[10px] text-muted-foreground">Win Rate</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <div className="text-lg font-bold font-mono">
              {stats.tradingDays}
            </div>
            <div className="text-[10px] text-muted-foreground">Trading Days</div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-2 flex-1 flex flex-col min-h-0 overflow-auto">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'calendar' | 'monthly')}>
          <TabsList className="grid w-full grid-cols-2 h-8">
            <TabsTrigger value="calendar" className="text-xs">Calendar</TabsTrigger>
            <TabsTrigger value="monthly" className="text-xs">Monthly</TabsTrigger>
          </TabsList>

          <TabsContent value="calendar" className="mt-2">
            {/* Calendar Grid */}
            <div className="grid grid-cols-12 gap-1">
              {months.map((month, monthIndex) => {
                const monthKey = `${selectedYear}-${String(monthIndex + 1).padStart(2, '0')}`;
                const monthDays = monthlyData[monthKey] || [];

                return (
                  <div key={month} className="space-y-1">
                    <div className="text-[10px] text-muted-foreground text-center font-medium">
                      {month}
                    </div>
                    <div className="grid grid-cols-7 gap-px">
                      {/* Day cells */}
                      {Array.from({ length: 31 }, (_, dayIndex) => {
                        const day = dayIndex + 1;
                        const dateStr = `${monthKey}-${String(day).padStart(2, '0')}`;
                        const dayData = monthDays.find(d => d.date === dateStr);

                        if (!dayData) {
                          return (
                            <div
                              key={dayIndex}
                              className="w-2 h-2 rounded-sm bg-muted/30"
                            />
                          );
                        }

                        return (
                          <div
                            key={dayIndex}
                            className={cn(
                              "w-2 h-2 rounded-sm cursor-pointer transition-all",
                              getColorClass(dayData.returnPct),
                              hoveredDay?.date === dateStr && "ring-1 ring-white scale-150 z-10"
                            )}
                            onMouseEnter={() => setHoveredDay(dayData)}
                            onMouseLeave={() => setHoveredDay(null)}
                            onClick={() => onDayClick?.(dateStr, dayData)}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Hover tooltip */}
            {hoveredDay && (
              <div className="mt-2 p-2 rounded-lg bg-popover border text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium">{hoveredDay.date}</span>
                  {hoveredDay.regime && (
                    <Badge variant="outline" className="text-[10px]">
                      {hoveredDay.regime}
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <span className="text-muted-foreground">P&L:</span>
                    <span className={cn(
                      "ml-1 font-mono",
                      hoveredDay.pnl >= 0 ? "text-green-500" : "text-red-500"
                    )}>
                      {formatCurrency(hoveredDay.pnl)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Return:</span>
                    <span className={cn(
                      "ml-1 font-mono",
                      hoveredDay.returnPct >= 0 ? "text-green-500" : "text-red-500"
                    )}>
                      {formatPercent(hoveredDay.returnPct)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Trades:</span>
                    <span className="ml-1 font-mono">{hoveredDay.trades}</span>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="monthly" className="mt-2">
            {/* Monthly Bar Chart */}
            <div className="space-y-1">
              {monthlyStats.map(({ month, pnl, returnPct, trades }) => {
                // Use pre-calculated maxMonthlyPnl instead of recalculating each iteration
                const barWidth = (Math.abs(pnl) / maxMonthlyPnl) * 100;

                return (
                  <div key={month} className="flex items-center gap-2">
                    <div className="w-12 text-xs text-muted-foreground">
                      {months[parseInt(month.split('-')[1]) - 1]}
                    </div>
                    <div className="flex-1 h-6 relative bg-muted/30 rounded overflow-hidden">
                      <div
                        className={cn(
                          "absolute inset-y-0 rounded transition-all",
                          pnl >= 0
                            ? "left-1/2 bg-green-500/70"
                            : "right-1/2 bg-red-500/70"
                        )}
                        style={{ width: `${barWidth / 2}%` }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono">
                        {formatCurrency(pnl)}
                      </div>
                    </div>
                    <div className="w-16 text-right text-xs font-mono">
                      {formatPercent(returnPct)}
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>

        {/* Color legend */}
        <div className="flex items-center justify-center gap-1 mt-3 pt-2 border-t">
          <span className="text-[10px] text-muted-foreground mr-2">Loss</span>
          <div className="w-3 h-3 rounded-sm bg-red-600" />
          <div className="w-3 h-3 rounded-sm bg-red-500" />
          <div className="w-3 h-3 rounded-sm bg-red-400" />
          <div className="w-3 h-3 rounded-sm bg-red-300" />
          <div className="w-3 h-3 rounded-sm bg-green-300" />
          <div className="w-3 h-3 rounded-sm bg-green-400" />
          <div className="w-3 h-3 rounded-sm bg-green-500" />
          <div className="w-3 h-3 rounded-sm bg-green-600" />
          <span className="text-[10px] text-muted-foreground ml-2">Profit</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default PnLHeatmap;
