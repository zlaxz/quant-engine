/**
 * JournalView - Persistent record of pipeline activity
 *
 * A timeline view showing what was done, when, with what results.
 * This is the "memory" layer - what the orchestration leaves behind.
 *
 * Features:
 * - Timeline of all pipeline runs
 * - Filter by activity type, date range
 * - Star important entries
 * - Add notes to entries
 * - Quick metrics summary
 */

import { useState, useEffect, useCallback } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Activity,
  Beaker,
  Brain,
  Database,
  Filter,
  RefreshCw,
  Search,
  Star,
  StarOff,
  ChevronDown,
  ChevronRight,
  Clock,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  StickyNote,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { supabase, isSupabaseConfigured } from '@/integrations/supabase/client';

// ============================================================================
// Types
// ============================================================================

interface JournalEntry {
  id: string;
  created_at: string;
  activity_type: string;
  title: string;
  description?: string;
  results: Record<string, unknown>;
  parameters: Record<string, unknown>;
  status: string;
  duration_seconds?: number;
  strategy_name?: string;
  tags: string[];
  starred: boolean;
  notes?: string;
  sharpe_ratio?: number;
  total_return_pct?: number;
  max_drawdown_pct?: number;
}

// ============================================================================
// Activity Type Config
// ============================================================================

const activityConfig: Record<string, { icon: typeof Activity; color: string; label: string }> = {
  backtest: { icon: TrendingUp, color: 'text-green-400', label: 'Backtest' },
  discovery: { icon: Search, color: 'text-cyan-400', label: 'Discovery' },
  swarm: { icon: Brain, color: 'text-purple-400', label: 'Swarm' },
  feature_harvest: { icon: Database, color: 'text-blue-400', label: 'Feature Harvest' },
  optimization: { icon: Beaker, color: 'text-amber-400', label: 'Optimization' },
  validation: { icon: CheckCircle, color: 'text-emerald-400', label: 'Validation' },
  analysis: { icon: Activity, color: 'text-pink-400', label: 'Analysis' },
  other: { icon: Activity, color: 'text-gray-400', label: 'Other' },
};

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string }> = {
  completed: { icon: CheckCircle, color: 'text-green-400' },
  running: { icon: Loader2, color: 'text-blue-400' },
  failed: { icon: XCircle, color: 'text-red-400' },
  partial: { icon: AlertTriangle, color: 'text-amber-400' },
  cancelled: { icon: XCircle, color: 'text-gray-400' },
};

// ============================================================================
// Journal Entry Card
// ============================================================================

interface EntryCardProps {
  entry: JournalEntry;
  onStar: (id: string, starred: boolean) => void;
  onAddNotes: (id: string, notes: string) => void;
}

function EntryCard({ entry, onStar, onAddNotes }: EntryCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(entry.notes || '');

  const config = activityConfig[entry.activity_type] || activityConfig.other;
  const status = statusConfig[entry.status] || statusConfig.completed;
  const ActivityIcon = config.icon;
  const StatusIcon = status.icon;

  const handleSaveNotes = () => {
    onAddNotes(entry.id, notesValue);
    setIsEditingNotes(false);
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <Card className={cn(
        'transition-all duration-200',
        entry.starred && 'border-amber-500/50 bg-amber-500/5'
      )}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-2">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                {/* Activity Icon */}
                <div className={cn('mt-0.5', config.color)}>
                  <ActivityIcon className="h-5 w-5" />
                </div>

                {/* Title & Meta */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-medium truncate">
                      {entry.title}
                    </CardTitle>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {config.label}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs mt-1 flex items-center gap-2">
                    <Clock className="h-3 w-3" />
                    {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                    {entry.duration_seconds && (
                      <span className="text-muted-foreground">
                        ({Math.round(entry.duration_seconds / 60)}m)
                      </span>
                    )}
                  </CardDescription>
                </div>
              </div>

              {/* Right Side: Metrics & Controls */}
              <div className="flex items-center gap-2 shrink-0">
                {/* Quick Metrics */}
                {entry.sharpe_ratio !== undefined && (
                  <Badge variant={entry.sharpe_ratio > 1.5 ? 'default' : 'secondary'} className="text-[10px]">
                    Sharpe: {entry.sharpe_ratio.toFixed(2)}
                  </Badge>
                )}
                {entry.total_return_pct !== undefined && (
                  <Badge
                    variant={entry.total_return_pct > 0 ? 'default' : 'destructive'}
                    className="text-[10px]"
                  >
                    {entry.total_return_pct > 0 ? '+' : ''}{entry.total_return_pct.toFixed(1)}%
                  </Badge>
                )}

                {/* Status */}
                <StatusIcon className={cn('h-4 w-4', status.color, entry.status === 'running' && 'animate-spin')} />

                {/* Star */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStar(entry.id, !entry.starred);
                  }}
                >
                  {entry.starred ? (
                    <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
                  ) : (
                    <StarOff className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>

                {/* Expand/Collapse */}
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {/* Description */}
            {entry.description && (
              <p className="text-sm text-muted-foreground">{entry.description}</p>
            )}

            {/* Results */}
            {Object.keys(entry.results).length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">Results</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {Object.entries(entry.results).map(([key, value]) => (
                    <div key={key} className="p-2 rounded bg-muted/50">
                      <div className="text-[10px] text-muted-foreground capitalize">
                        {key.replace(/_/g, ' ')}
                      </div>
                      <div className="text-sm font-medium">
                        {typeof value === 'number'
                          ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
                          : Array.isArray(value)
                            ? `${value.length} items`
                            : String(value)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Parameters */}
            {Object.keys(entry.parameters).length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">Parameters</h4>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(entry.parameters).map(([key, value]) => (
                    <Badge key={key} variant="outline" className="text-[10px]">
                      {key}: {String(value)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            {entry.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {entry.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {/* Notes */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <StickyNote className="h-3 w-3" />
                  Notes
                </h4>
                {!isEditingNotes && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setIsEditingNotes(true)}
                  >
                    {entry.notes ? 'Edit' : 'Add Note'}
                  </Button>
                )}
              </div>
              {isEditingNotes ? (
                <div className="space-y-2">
                  <Textarea
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    placeholder="Add your notes here..."
                    className="text-sm"
                    rows={3}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setNotesValue(entry.notes || '');
                        setIsEditingNotes(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSaveNotes}>
                      Save
                    </Button>
                  </div>
                </div>
              ) : entry.notes ? (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {entry.notes}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground italic">No notes yet</p>
              )}
            </div>

            {/* Timestamp */}
            <div className="text-[10px] text-muted-foreground">
              {format(new Date(entry.created_at), 'PPpp')}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function JournalView() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [starredOnly, setStarredOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch entries
  const fetchEntries = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      let query = supabase
        .from('pipeline_journal')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (filter !== 'all') {
        query = query.eq('activity_type', filter);
      }
      if (starredOnly) {
        query = query.eq('starred', true);
      }

      const { data, error } = await query;
      if (error) throw error;
      setEntries(data || []);
    } catch (err) {
      console.error('[Journal] Failed to fetch entries:', err);
    } finally {
      setLoading(false);
    }
  }, [filter, starredOnly]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Star entry
  const handleStar = async (id: string, starred: boolean) => {
    if (!isSupabaseConfigured) return;

    try {
      await supabase.from('pipeline_journal').update({ starred }).eq('id', id);
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, starred } : e))
      );
    } catch (err) {
      console.error('[Journal] Failed to star entry:', err);
    }
  };

  // Add notes
  const handleAddNotes = async (id: string, notes: string) => {
    if (!isSupabaseConfigured) return;

    try {
      await supabase.from('pipeline_journal').update({ notes }).eq('id', id);
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, notes } : e))
      );
    } catch (err) {
      console.error('[Journal] Failed to update notes:', err);
    }
  };

  // Filter entries by search
  const filteredEntries = entries.filter((entry) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      entry.title.toLowerCase().includes(query) ||
      entry.description?.toLowerCase().includes(query) ||
      entry.strategy_name?.toLowerCase().includes(query) ||
      entry.tags.some((t) => t.toLowerCase().includes(query))
    );
  });

  // Summary stats
  const stats = {
    total: entries.length,
    backtests: entries.filter((e) => e.activity_type === 'backtest').length,
    starred: entries.filter((e) => e.starred).length,
    avgSharpe: entries
      .filter((e) => e.sharpe_ratio)
      .reduce((sum, e) => sum + (e.sharpe_ratio || 0), 0) /
      (entries.filter((e) => e.sharpe_ratio).length || 1),
  };

  if (!isSupabaseConfigured) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
          <p>Supabase not configured. Journal entries cannot be loaded.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header & Filters */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Pipeline Journal</h2>
          <p className="text-sm text-muted-foreground">
            {stats.total} entries, {stats.starred} starred
            {stats.avgSharpe > 0 && ` | Avg Sharpe: ${stats.avgSharpe.toFixed(2)}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 w-48"
            />
          </div>

          {/* Activity Filter */}
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-36">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="backtest">Backtests</SelectItem>
              <SelectItem value="discovery">Discoveries</SelectItem>
              <SelectItem value="swarm">Swarms</SelectItem>
              <SelectItem value="feature_harvest">Feature Harvest</SelectItem>
              <SelectItem value="optimization">Optimization</SelectItem>
              <SelectItem value="validation">Validation</SelectItem>
            </SelectContent>
          </Select>

          {/* Starred Toggle */}
          <Button
            variant={starredOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStarredOnly(!starredOnly)}
          >
            <Star className={cn('h-4 w-4 mr-1', starredOnly && 'fill-current')} />
            Starred
          </Button>

          {/* Refresh */}
          <Button variant="outline" size="icon" onClick={fetchEntries}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Entry List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredEntries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Activity className="h-8 w-8 mx-auto mb-2" />
            <p>No journal entries found</p>
            <p className="text-xs mt-1">
              Run a backtest or swarm to see entries appear here
            </p>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[calc(100vh-280px)]">
          <div className="space-y-3 pr-4">
            {filteredEntries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                onStar={handleStar}
                onAddNotes={handleAddNotes}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

export default JournalView;
