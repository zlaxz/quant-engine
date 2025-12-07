/**
 * StrategyLibrary - Browsable library of trading strategies
 */

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  Search,
  Plus,
  Library,
  Zap,
  TrendingDown,
  Activity,
  TrendingUp,
  Beaker,
  Filter,
} from 'lucide-react';
import { StrategyCard } from './StrategyCard';
import { StrategyDetail } from './StrategyDetail';
import type { Strategy, StrategyCategory, StrategyStatus } from './types';
import { DEMO_STRATEGIES } from './types';

interface StrategyLibraryProps {
  strategies?: Strategy[];
  onRunStrategy?: (id: string) => void;
  onCreateStrategy?: () => void;
  className?: string;
}

const categoryFilters: { value: StrategyCategory | 'all'; label: string; icon: typeof Zap }[] = [
  { value: 'all', label: 'All', icon: Library },
  { value: 'gamma', label: 'Gamma', icon: Zap },
  { value: 'theta', label: 'Theta', icon: TrendingDown },
  { value: 'vega', label: 'Vega', icon: Activity },
  { value: 'momentum', label: 'Momentum', icon: TrendingUp },
  { value: 'custom', label: 'Custom', icon: Beaker },
];

const statusFilters: { value: StrategyStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'research', label: 'Research' },
  { value: 'paper', label: 'Paper' },
  { value: 'live', label: 'Live' },
];

export function StrategyLibrary({
  strategies = DEMO_STRATEGIES,
  onRunStrategy,
  onCreateStrategy,
  className,
}: StrategyLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<StrategyCategory | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<StrategyStatus | 'all'>('all');
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);

  // Filter strategies
  const filteredStrategies = useMemo(() => {
    return strategies.filter(s => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (
          !s.name.toLowerCase().includes(query) &&
          !s.description.toLowerCase().includes(query)
        ) {
          return false;
        }
      }

      // Category filter
      if (categoryFilter !== 'all' && s.category !== categoryFilter) {
        return false;
      }

      // Status filter
      if (statusFilter !== 'all' && s.status !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [strategies, searchQuery, categoryFilter, statusFilter]);

  // Stats
  const stats = useMemo(() => ({
    total: strategies.length,
    live: strategies.filter(s => s.status === 'live').length,
    paper: strategies.filter(s => s.status === 'paper').length,
    research: strategies.filter(s => s.status === 'research').length,
  }), [strategies]);

  const handleView = (id: string) => {
    const strategy = strategies.find(s => s.id === id);
    if (strategy) setSelectedStrategy(strategy);
  };

  const handleRun = (id: string) => {
    onRunStrategy?.(id);
  };

  if (selectedStrategy) {
    return (
      <StrategyDetail
        strategy={selectedStrategy}
        onBack={() => setSelectedStrategy(null)}
        onRun={() => handleRun(selectedStrategy.id)}
        className={className}
      />
    );
  }

  return (
    <Card className={cn('bg-card/50 backdrop-blur flex flex-col h-full', className)}>
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Library className="h-5 w-5 text-primary" />
            Strategy Library
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {stats.live} Live
            </Badge>
            <Badge variant="outline" className="text-xs">
              {stats.paper} Paper
            </Badge>
            <Button size="sm" onClick={onCreateStrategy}>
              <Plus className="h-4 w-4 mr-1" />
              New
            </Button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="space-y-2 mt-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search strategies..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Category Filters */}
            <div className="flex items-center gap-1">
              {categoryFilters.map(({ value, label, icon: Icon }) => (
                <Button
                  key={value}
                  variant={categoryFilter === value ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setCategoryFilter(value)}
                >
                  <Icon className="h-3 w-3 mr-1" />
                  {label}
                </Button>
              ))}
            </div>

            <div className="h-4 w-px bg-border" />

            {/* Status Filters */}
            <div className="flex items-center gap-1">
              {statusFilters.map(({ value, label }) => (
                <Button
                  key={value}
                  variant={statusFilter === value ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setStatusFilter(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden px-3 pb-3">
        <ScrollArea className="h-full">
          {filteredStrategies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Filter className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">No strategies match your filters</p>
              <Button
                variant="link"
                className="mt-2"
                onClick={() => {
                  setSearchQuery('');
                  setCategoryFilter('all');
                  setStatusFilter('all');
                }}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredStrategies.map(strategy => (
                <StrategyCard
                  key={strategy.id}
                  strategy={strategy}
                  onView={handleView}
                  onRun={handleRun}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export default StrategyLibrary;
