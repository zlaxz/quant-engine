/**
 * StrategyLibrary - Card grid of all strategies
 *
 * PHASE 4: Strategy Management
 *
 * Features:
 * - Filterable card grid
 * - Group by status or type
 * - Search by name/description
 * - Sort by performance metrics
 * - Quick stats summary
 *
 * ADHD Design:
 * - Visual grid over tables
 * - Color-coded status obvious
 * - Filter controls always visible
 * - Summary stats at top
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Search,
  Filter,
  Grid3x3,
  List,
  SortAsc,
  SortDesc,
  Plus,
  AlertTriangle,
  CheckCircle,
  Activity,
  TrendingUp,
  LayoutGrid,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { StrategyCard, Strategy } from './StrategyCard';

// =========================================================================
// Types
// =========================================================================

type SortField = 'name' | 'sharpe' | 'returns30d' | 'winRate' | 'discoveredAt' | 'confidence';
type GroupBy = 'none' | 'status' | 'type' | 'regime';
type ViewMode = 'grid' | 'compact';

interface StrategyLibraryProps {
  strategies: Strategy[];
  onViewStrategy?: (strategy: Strategy) => void;
  onPauseStrategy?: (strategy: Strategy) => void;
  onResumeStrategy?: (strategy: Strategy) => void;
  onPromoteStrategy?: (strategy: Strategy) => void;
  onRetireStrategy?: (strategy: Strategy) => void;
  onAddStrategy?: () => void;
  className?: string;
}

// =========================================================================
// Component
// =========================================================================

export function StrategyLibrary({
  strategies,
  onViewStrategy,
  onPauseStrategy,
  onResumeStrategy,
  onPromoteStrategy,
  onRetireStrategy,
  onAddStrategy,
  className,
}: StrategyLibraryProps) {
  // Filter/sort state
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('sharpe');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Filter strategies
  const filteredStrategies = useMemo(() => {
    return strategies.filter((s) => {
      // Search filter
      if (searchText) {
        const search = searchText.toLowerCase();
        if (
          !s.name.toLowerCase().includes(search) &&
          !s.description.toLowerCase().includes(search)
        ) {
          return false;
        }
      }

      // Status filter
      if (statusFilter !== 'all' && s.status !== statusFilter) {
        return false;
      }

      // Type filter
      if (typeFilter !== 'all' && s.type !== typeFilter) {
        return false;
      }

      return true;
    });
  }, [strategies, searchText, statusFilter, typeFilter]);

  // Sort strategies
  const sortedStrategies = useMemo(() => {
    return [...filteredStrategies].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortField) {
        case 'name':
          aVal = a.name;
          bVal = b.name;
          break;
        case 'sharpe':
          aVal = a.sharpe;
          bVal = b.sharpe;
          break;
        case 'returns30d':
          aVal = a.returns30d;
          bVal = b.returns30d;
          break;
        case 'winRate':
          aVal = a.winRate;
          bVal = b.winRate;
          break;
        case 'discoveredAt':
          aVal = new Date(a.discoveredAt).getTime();
          bVal = new Date(b.discoveredAt).getTime();
          break;
        case 'confidence':
          aVal = a.confidence;
          bVal = b.confidence;
          break;
        default:
          return 0;
      }

      let comparison = 0;
      if (typeof aVal === 'string') {
        comparison = aVal.localeCompare(bVal);
      } else {
        comparison = aVal - bVal;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredStrategies, sortField, sortDirection]);

  // Group strategies
  const groupedStrategies = useMemo(() => {
    if (groupBy === 'none') {
      return { 'All Strategies': sortedStrategies };
    }

    const groups: Record<string, Strategy[]> = {};

    sortedStrategies.forEach((s) => {
      let key: string;
      switch (groupBy) {
        case 'status':
          key = s.status.charAt(0).toUpperCase() + s.status.slice(1);
          break;
        case 'type':
          key = s.type.charAt(0).toUpperCase() + s.type.slice(1);
          break;
        case 'regime':
          key =
            s.bestRegime === 'meanReverting'
              ? 'Mean Reverting'
              : s.bestRegime.charAt(0).toUpperCase() + s.bestRegime.slice(1);
          break;
        default:
          key = 'Other';
      }

      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    });

    // Sort groups by a logical order
    const statusOrder = ['Live', 'Paper', 'Validation', 'Discovery', 'Paused', 'Retired'];
    const sortedGroups: Record<string, Strategy[]> = {};

    if (groupBy === 'status') {
      statusOrder.forEach((status) => {
        if (groups[status]) {
          sortedGroups[status] = groups[status];
        }
      });
    } else {
      Object.keys(groups)
        .sort()
        .forEach((key) => {
          sortedGroups[key] = groups[key];
        });
    }

    return sortedGroups;
  }, [sortedStrategies, groupBy]);

  // Summary stats
  const stats = useMemo(() => {
    const live = strategies.filter((s) => s.status === 'live');
    const paper = strategies.filter((s) => s.status === 'paper');
    const degrading = strategies.filter((s) => s.performanceTrend === 'degrading');
    const aligned = strategies.filter(
      (s) => s.currentRegimeAligned && (s.status === 'live' || s.status === 'paper')
    );

    return {
      total: strategies.length,
      live: live.length,
      paper: paper.length,
      degrading: degrading.length,
      aligned: aligned.length,
      activeTotal: live.length + paper.length,
    };
  }, [strategies]);

  // Toggle sort direction
  const toggleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDirection('desc');
      }
    },
    [sortField]
  );

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <LayoutGrid className="h-5 w-5" />
              Strategy Library
            </CardTitle>
            <CardDescription>
              {filteredStrategies.length} of {strategies.length} strategies
            </CardDescription>
          </div>

          {/* Summary badges */}
          <div className="flex items-center gap-2">
            <Badge variant="default" className="bg-green-500">
              {stats.live} Live
            </Badge>
            <Badge variant="secondary" className="bg-blue-500 text-white">
              {stats.paper} Paper
            </Badge>
            {stats.degrading > 0 && (
              <Badge variant="destructive">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {stats.degrading} Degrading
              </Badge>
            )}
            {stats.aligned > 0 && (
              <Badge variant="outline" className="text-green-600 border-green-500">
                <CheckCircle className="h-3 w-3 mr-1" />
                {stats.aligned}/{stats.activeTotal} Aligned
              </Badge>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-3 mt-4">
          {/* Search and Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search strategies..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="pl-8"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="live">Live</SelectItem>
                <SelectItem value="paper">Paper</SelectItem>
                <SelectItem value="validation">Validation</SelectItem>
                <SelectItem value="discovery">Discovery</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="retired">Retired</SelectItem>
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="momentum">Momentum</SelectItem>
                <SelectItem value="meanReversion">Mean Reversion</SelectItem>
                <SelectItem value="factor">Factor</SelectItem>
                <SelectItem value="ml">ML/AI</SelectItem>
                <SelectItem value="arbitrage">Arbitrage</SelectItem>
              </SelectContent>
            </Select>

            {onAddStrategy && (
              <Button onClick={onAddStrategy}>
                <Plus className="h-4 w-4 mr-1" />
                Add Strategy
              </Button>
            )}
          </div>

          {/* Sort and Group */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Sort by:</span>
              <Select
                value={sortField}
                onValueChange={(v) => setSortField(v as SortField)}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sharpe">Sharpe</SelectItem>
                  <SelectItem value="returns30d">30d Returns</SelectItem>
                  <SelectItem value="winRate">Win Rate</SelectItem>
                  <SelectItem value="confidence">Confidence</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="discoveredAt">Discovered</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
                }
              >
                {sortDirection === 'asc' ? (
                  <SortAsc className="h-4 w-4" />
                ) : (
                  <SortDesc className="h-4 w-4" />
                )}
              </Button>

              <div className="border-l pl-2 ml-2">
                <span className="text-sm text-muted-foreground mr-2">Group:</span>
                <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
                  <SelectTrigger className="w-[100px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="status">Status</SelectItem>
                    <SelectItem value="type">Type</SelectItem>
                    <SelectItem value="regime">Regime</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* View mode toggle */}
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(v) => v && setViewMode(v as ViewMode)}
            >
              <ToggleGroupItem value="grid" aria-label="Grid view">
                <Grid3x3 className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="compact" aria-label="Compact view">
                <List className="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {filteredStrategies.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No strategies match your filters</p>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(groupedStrategies).map(([group, groupStrategies]) => (
              <div key={group}>
                {groupBy !== 'none' && (
                  <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                    {group}
                    <Badge variant="secondary">{groupStrategies.length}</Badge>
                  </h3>
                )}
                <div
                  className={cn(
                    'grid gap-4',
                    viewMode === 'grid'
                      ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                      : 'grid-cols-1 md:grid-cols-2'
                  )}
                >
                  {groupStrategies.map((strategy) => (
                    <StrategyCard
                      key={strategy.id}
                      strategy={strategy}
                      onView={onViewStrategy}
                      onPause={onPauseStrategy}
                      onResume={onResumeStrategy}
                      onPromote={onPromoteStrategy}
                      onRetire={onRetireStrategy}
                      compact={viewMode === 'compact'}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default StrategyLibrary;
