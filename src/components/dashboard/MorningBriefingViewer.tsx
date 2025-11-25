/**
 * Morning Briefing Viewer - Card-based strategy briefings
 *
 * Shows daily briefings from the Night Shift daemon:
 * - Top strategies with plain-English narratives
 * - Performance metrics
 * - Graduation notifications
 *
 * Created: 2025-11-24
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  FileText,
  TrendingUp,
  Calendar,
  RefreshCw,
  Loader2,
  ChevronRight,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import {
  safeFormat,
  safeIsToday,
  safeIsYesterday,
} from '@/lib/dateUtils';

interface Briefing {
  id: string;
  title: string;
  content: string;
  briefing_type: 'daily_summary' | 'graduation' | 'alert' | 'performance';
  created_at: string;
  metadata?: {
    strategyName?: string;
    sharpe?: number;
    fitness?: number;
    tradeCount?: number;
    recommendation?: string;
  };
}

const briefingIcons: Record<string, React.ReactNode> = {
  daily_summary: <FileText className="h-4 w-4" />,
  graduation: <Sparkles className="h-4 w-4 text-yellow-500" />,
  alert: <AlertCircle className="h-4 w-4 text-orange-500" />,
  performance: <TrendingUp className="h-4 w-4 text-green-500" />,
};

const briefingColors: Record<string, string> = {
  daily_summary: 'border-l-blue-500',
  graduation: 'border-l-yellow-500',
  alert: 'border-l-orange-500',
  performance: 'border-l-green-500',
};

// Demo briefings for when no real data exists
function getDemoBriefings(): Briefing[] {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  return [
    {
      id: 'demo-1',
      title: 'Night Shift Daily Summary',
      briefing_type: 'daily_summary',
      content: 'Processed 47 strategy mutations overnight. 3 candidates show promising Sharpe ratios above 1.5. Best performer: MomentumBreakout_v3 with Sharpe 1.82 across 2020-2024 backtest period.',
      created_at: now.toISOString(),
      metadata: {
        strategyName: 'MomentumBreakout_v3',
        sharpe: 1.82,
        fitness: 0.76,
        tradeCount: 342,
        recommendation: 'Continue to shadow trading phase with 25% of target position size',
      },
    },
    {
      id: 'demo-2',
      title: 'Strategy Graduation Alert',
      briefing_type: 'graduation',
      content: 'VixMeanRevert_2024 has completed 50+ shadow trades with rolling Sharpe of 1.67. Ready for production review.',
      created_at: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
      metadata: {
        strategyName: 'VixMeanRevert_2024',
        sharpe: 1.67,
        fitness: 0.71,
        tradeCount: 52,
        recommendation: 'Review execution quality and slippage metrics before production deployment',
      },
    },
    {
      id: 'demo-3',
      title: 'Performance Update',
      briefing_type: 'performance',
      content: 'Shadow portfolio up 2.3% this week. Low volatility regime continuing - theta decay strategies outperforming.',
      created_at: yesterday.toISOString(),
      metadata: {
        sharpe: 2.1,
        tradeCount: 18,
      },
    },
    {
      id: 'demo-4',
      title: 'Regime Transition Alert',
      briefing_type: 'alert',
      content: 'VIX approaching 20 threshold. Consider reducing short gamma exposure. Term structure flattening.',
      created_at: new Date(yesterday.getTime() - 12 * 60 * 60 * 1000).toISOString(),
      metadata: {
        recommendation: 'Reduce short straddle positions by 50% if VIX closes above 20',
      },
    },
  ];
}

export function MorningBriefingViewer() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchBriefings = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('morning_briefings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (fetchError) {
        // Use demo data if table doesn't exist
        if (fetchError.code === 'PGRST116' || fetchError.code === '42P01') {
          setBriefings(getDemoBriefings());
          setError(null);
          return;
        }
        throw fetchError;
      }

      // If no real data, show demo briefings
      if (!data || data.length === 0) {
        setBriefings(getDemoBriefings());
      } else {
        setBriefings(data);
      }
      setError(null);
    } catch (err) {
      console.error('Failed to fetch briefings:', err);
      setError(err instanceof Error ? err.message : 'Failed to load briefings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBriefings();
  }, [fetchBriefings]);

  const formatDate = (dateStr: string) => {
    if (safeIsToday(dateStr)) return 'Today';
    if (safeIsYesterday(dateStr)) return 'Yesterday';
    return safeFormat(dateStr, 'MMM d, yyyy', 'Unknown date');
  };

  const formatTime = (dateStr: string) => {
    return safeFormat(dateStr, 'h:mm a', '--:--');
  };

  // Group briefings by date
  const groupedBriefings = briefings.reduce((acc, briefing) => {
    const date = safeFormat(briefing.created_at, 'yyyy-MM-dd', 'unknown');
    if (!acc[date]) acc[date] = [];
    acc[date].push(briefing);
    return acc;
  }, {} as Record<string, Briefing[]>);

  if (loading) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-full">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Morning Briefings
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchBriefings}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full">
          <div className="px-4 pb-4 space-y-4">
            {error ? (
              <div className="text-center py-4 text-red-500 text-sm">{error}</div>
            ) : briefings.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                No briefings yet
                <p className="text-xs mt-1">The Night Shift will publish daily summaries</p>
              </div>
            ) : (
              Object.entries(groupedBriefings).map(([date, dayBriefings]) => (
                <div key={date} className="space-y-2">
                  {/* Date header */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground sticky top-0 bg-background py-1">
                    <Calendar className="h-3 w-3" />
                    {formatDate(dayBriefings[0].created_at)}
                  </div>

                  {/* Briefing cards */}
                  {dayBriefings.map((briefing) => (
                    <div
                      key={briefing.id}
                      className={cn(
                        'p-3 rounded-lg bg-muted/50 border-l-2 cursor-pointer transition-all',
                        briefingColors[briefing.briefing_type] || 'border-l-gray-500',
                        expandedId === briefing.id && 'bg-muted'
                      )}
                      onClick={() =>
                        setExpandedId(expandedId === briefing.id ? null : briefing.id)
                      }
                    >
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1">
                          {briefingIcons[briefing.briefing_type] || <FileText className="h-4 w-4" />}
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-sm truncate">{briefing.title}</h4>
                            <p className="text-xs text-muted-foreground">
                              {formatTime(briefing.created_at)}
                            </p>
                          </div>
                        </div>
                        <ChevronRight
                          className={cn(
                            'h-4 w-4 text-muted-foreground transition-transform',
                            expandedId === briefing.id && 'rotate-90'
                          )}
                        />
                      </div>

                      {/* Metrics badges */}
                      {briefing.metadata && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {briefing.metadata.sharpe && (
                            <Badge variant="secondary" className="text-xs">
                              Sharpe: {briefing.metadata.sharpe.toFixed(2)}
                            </Badge>
                          )}
                          {briefing.metadata.fitness && (
                            <Badge variant="secondary" className="text-xs">
                              Fitness: {briefing.metadata.fitness.toFixed(2)}
                            </Badge>
                          )}
                          {briefing.metadata.tradeCount && (
                            <Badge variant="secondary" className="text-xs">
                              {briefing.metadata.tradeCount} trades
                            </Badge>
                          )}
                        </div>
                      )}

                      {/* Expanded content */}
                      {expandedId === briefing.id && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                            {briefing.content}
                          </p>
                          {briefing.metadata?.recommendation && (
                            <div className="mt-2 p-2 rounded bg-background">
                              <p className="text-xs font-medium text-foreground">
                                Recommendation:
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {briefing.metadata.recommendation}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
