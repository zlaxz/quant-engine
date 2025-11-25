/**
 * Memory System UI - Browse and tag memories
 *
 * Shows:
 * - Searchable memory list
 * - Filter by project/category/protection level
 * - Tag management
 * - Memory details with source reference
 * - Protection level indicators
 *
 * Created: 2025-11-24
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Brain,
  Search,
  RefreshCw,
  Loader2,
  Tag,
  Shield,
  ShieldAlert,
  ShieldCheck,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { safeFormat, safeFormatDistanceToNow } from '@/lib/dateUtils';

interface Memory {
  id: string;
  content: string;
  summary?: string;
  project?: string;
  category?: string;
  protection_level: number;
  tags: string[];
  source_file?: string;
  source_line?: number;
  created_at: string;
  last_accessed?: string;
  access_count: number;
}

const PROTECTION_LEVELS = [
  { level: 0, label: 'Critical', icon: <ShieldAlert className="h-3 w-3" />, color: 'text-red-500' },
  { level: 1, label: 'Protected', icon: <Shield className="h-3 w-3" />, color: 'text-orange-500' },
  { level: 2, label: 'Standard', icon: <ShieldCheck className="h-3 w-3" />, color: 'text-blue-500' },
  { level: 3, label: 'Ephemeral', icon: <FileText className="h-3 w-3" />, color: 'text-gray-500' },
];

const CATEGORIES = [
  'architecture',
  'decision',
  'lesson',
  'pattern',
  'bug',
  'config',
  'workflow',
  'other',
];

export function MemoryBrowser() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [_selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [projects, setProjects] = useState<string[]>([]);

  const fetchMemories = useCallback(async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('memory_notes')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (projectFilter !== 'all') {
        query = query.eq('project', projectFilter);
      }
      if (categoryFilter !== 'all') {
        query = query.eq('category', categoryFilter);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) {
        if (fetchError.code === '42P01') {
          // Table doesn't exist, use mock data
          setMemories(getMockMemories());
          setProjects(['quant-chat', 'rotation-engine', 'claudebrain']);
          setError(null);
        } else {
          throw fetchError;
        }
      } else {
        setMemories((data as Memory[]) || []);
        // Extract unique projects
        const uniqueProjects = [...new Set((data || []).map((m: any) => m.project).filter(Boolean))];
        setProjects(uniqueProjects as string[]);
        setError(null);
      }
    } catch (err) {
      console.error('Failed to fetch memories:', err);
      setMemories(getMockMemories());
      setProjects(['quant-chat', 'rotation-engine', 'claudebrain']);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [projectFilter, categoryFilter]);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  const filteredMemories = memories.filter((memory) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      memory.content.toLowerCase().includes(query) ||
      memory.summary?.toLowerCase().includes(query) ||
      memory.tags.some((t) => t.toLowerCase().includes(query))
    );
  });

  const getProtectionConfig = (level: number) => {
    return PROTECTION_LEVELS.find((p) => p.level === level) || PROTECTION_LEVELS[2];
  };

  const memoryCounts = {
    total: memories.length,
    critical: memories.filter((m) => m.protection_level === 0).length,
    protected: memories.filter((m) => m.protection_level === 1).length,
    recent: memories.filter(
      (m) => new Date(m.created_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    ).length,
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

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Brain className="h-4 w-4" />
            Memory System
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchMemories}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0 flex flex-col">
        {/* Stats Bar */}
        <div className="px-4 pb-2 grid grid-cols-4 gap-2 text-center border-b">
          <div>
            <div className="text-lg font-semibold">{memoryCounts.total}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-red-500">{memoryCounts.critical}</div>
            <div className="text-xs text-muted-foreground">Critical</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-orange-500">{memoryCounts.protected}</div>
            <div className="text-xs text-muted-foreground">Protected</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-green-500">{memoryCounts.recent}</div>
            <div className="text-xs text-muted-foreground">This Week</div>
          </div>
        </div>

        {/* Filters */}
        <div className="px-4 py-2 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search memories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <div className="flex gap-2">
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Memory List */}
        <ScrollArea className="flex-1">
          <div className="px-4 pb-4 space-y-2">
            {error ? (
              <div className="text-center py-4 text-red-500 text-sm">{error}</div>
            ) : filteredMemories.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {searchQuery || projectFilter !== 'all' || categoryFilter !== 'all'
                  ? 'No matching memories'
                  : 'No memories stored yet'}
              </div>
            ) : (
              filteredMemories.map((memory) => {
                const protection = getProtectionConfig(memory.protection_level);

                return (
                  <Dialog key={memory.id}>
                    <DialogTrigger asChild>
                      <div
                        className={cn(
                          'p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors space-y-2',
                          memory.protection_level === 0 && 'border-l-2 border-red-500'
                        )}
                        onClick={() => setSelectedMemory(memory)}
                      >
                        {/* Header */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium line-clamp-2">
                              {memory.summary || memory.content.slice(0, 100)}
                            </p>
                          </div>
                          <div className={cn('shrink-0', protection.color)}>
                            {protection.icon}
                          </div>
                        </div>

                        {/* Meta */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {memory.project && (
                            <Badge variant="outline" className="text-xs">
                              {memory.project}
                            </Badge>
                          )}
                          {memory.category && (
                            <Badge variant="secondary" className="text-xs">
                              {memory.category}
                            </Badge>
                          )}
                          {memory.tags.slice(0, 2).map((tag) => (
                            <Badge key={tag} variant="outline" className="text-xs">
                              <Tag className="h-2 w-2 mr-1" />
                              {tag}
                            </Badge>
                          ))}
                          {memory.tags.length > 2 && (
                            <span className="text-xs text-muted-foreground">
                              +{memory.tags.length - 2}
                            </span>
                          )}
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{safeFormatDistanceToNow(memory.created_at)} ago</span>
                          <span>{memory.access_count} accesses</span>
                        </div>
                      </div>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <span className={protection.color}>{protection.icon}</span>
                          Memory Details
                          <Badge variant="outline" className="ml-2">
                            {protection.label}
                          </Badge>
                        </DialogTitle>
                        <DialogDescription>
                          Created {safeFormat(memory.created_at, 'MMM d, yyyy HH:mm', 'Unknown')}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        {/* Content */}
                        <div>
                          <h4 className="text-sm font-medium mb-2">Content</h4>
                          <div className="p-3 rounded-lg bg-muted/50 text-sm whitespace-pre-wrap">
                            {memory.content}
                          </div>
                        </div>

                        {/* Summary */}
                        {memory.summary && (
                          <div>
                            <h4 className="text-sm font-medium mb-2">Summary</h4>
                            <p className="text-sm text-muted-foreground">{memory.summary}</p>
                          </div>
                        )}

                        {/* Metadata */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <h4 className="text-sm font-medium mb-2">Project</h4>
                            <Badge variant="outline">{memory.project || 'None'}</Badge>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium mb-2">Category</h4>
                            <Badge variant="secondary">{memory.category || 'None'}</Badge>
                          </div>
                        </div>

                        {/* Tags */}
                        <div>
                          <h4 className="text-sm font-medium mb-2">Tags</h4>
                          <div className="flex flex-wrap gap-1">
                            {memory.tags.length > 0 ? (
                              memory.tags.map((tag) => (
                                <Badge key={tag} variant="outline">
                                  <Tag className="h-3 w-3 mr-1" />
                                  {tag}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-sm text-muted-foreground">No tags</span>
                            )}
                          </div>
                        </div>

                        {/* Source */}
                        {memory.source_file && (
                          <div>
                            <h4 className="text-sm font-medium mb-2">Source</h4>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <FileText className="h-4 w-4" />
                              <span className="font-mono">
                                {memory.source_file}
                                {memory.source_line && `:${memory.source_line}`}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Stats */}
                        <div className="grid grid-cols-3 gap-3 pt-3 border-t">
                          <div className="text-center">
                            <div className="text-lg font-semibold">{memory.access_count}</div>
                            <div className="text-xs text-muted-foreground">Accesses</div>
                          </div>
                          <div className="text-center">
                            <div className="text-lg font-semibold">
                              {memory.last_accessed
                                ? safeFormatDistanceToNow(memory.last_accessed)
                                : '-'}
                            </div>
                            <div className="text-xs text-muted-foreground">Last Accessed</div>
                          </div>
                          <div className="text-center">
                            <div className={cn('text-lg font-semibold', protection.color)}>
                              L{memory.protection_level}
                            </div>
                            <div className="text-xs text-muted-foreground">Protection</div>
                          </div>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                );
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function getMockMemories(): Memory[] {
  return [
    {
      id: '1',
      content:
        'SPY spreads are $0.01-0.05, NOT $0.75. Always WebSearch for current market data before making assumptions about transaction costs.',
      summary: 'SPY spread assumption was wrong - verify market data',
      project: 'rotation-engine',
      category: 'lesson',
      protection_level: 0,
      tags: ['market-data', 'spreads', 'critical'],
      created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      access_count: 47,
      last_accessed: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: '2',
      content:
        'Memory system uses hybrid recall: BM25 for keyword matching + pgvector for semantic similarity. Both results merged and deduplicated.',
      summary: 'Hybrid recall architecture decision',
      project: 'quant-chat',
      category: 'architecture',
      protection_level: 1,
      tags: ['memory', 'architecture', 'search'],
      source_file: 'src/electron/memory/RecallEngine.ts',
      source_line: 45,
      created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      access_count: 23,
      last_accessed: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: '3',
      content:
        'Regime classifier uses 6 states: LOW_VOL_GRIND, HIGH_VOL_OSCILLATION, TREND_UP, TREND_DOWN, BREAKOUT, CRASH. VIX percentile and term structure are key inputs.',
      summary: '6-state regime classification system',
      project: 'rotation-engine',
      category: 'decision',
      protection_level: 1,
      tags: ['regime', 'classification', 'volatility'],
      created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      access_count: 34,
    },
    {
      id: '4',
      content:
        'VelocityData external drive mounted at /Volumes/VelocityData. Contains 8TB of historical market data including SPY options from 2018.',
      summary: 'VelocityData drive path and contents',
      project: 'quant-chat',
      category: 'config',
      protection_level: 2,
      tags: ['data', 'infrastructure'],
      created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      access_count: 12,
    },
    {
      id: '5',
      content:
        'Never create markdown files in project root. All documentation goes in .claude/docs/. Only exception is README.md.',
      summary: 'Directory organization rule',
      project: 'claudebrain',
      category: 'pattern',
      protection_level: 0,
      tags: ['organization', 'files', 'critical'],
      created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      access_count: 89,
      last_accessed: new Date().toISOString(),
    },
  ];
}
