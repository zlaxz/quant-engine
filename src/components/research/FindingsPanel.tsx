/**
 * Findings Panel - Display key discoveries and insights
 */

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Star, AlertTriangle, BookCheck, Trophy, Lightbulb, X, Plus } from 'lucide-react';
import { Finding, FindingType, FindingImportance } from '@/types/findings';
import { loadFindings, removeFinding } from '@/lib/findingsStorage';
import { cn } from '@/lib/utils';

const FINDING_ICONS: Record<FindingType, typeof Star> = {
  discovery: Star,
  warning: AlertTriangle,
  rule: BookCheck,
  milestone: Trophy,
  insight: Lightbulb,
};

const IMPORTANCE_COLORS: Record<FindingImportance, string> = {
  critical: 'text-destructive border-destructive',
  high: 'text-orange-500 border-orange-500',
  medium: 'text-yellow-500 border-yellow-500',
  low: 'text-muted-foreground border-muted-foreground',
};

export const FindingsPanel = () => {
  const [findings, setFindings] = useState<Finding[]>(loadFindings());
  const [searchQuery, setSearchQuery] = useState('');

  // Sort findings: critical warnings first, then by date
  const sortedFindings = useMemo(() => {
    return [...findings].sort((a, b) => {
      // Critical warnings always first
      if (a.importance === 'critical' && b.importance !== 'critical') return -1;
      if (b.importance === 'critical' && a.importance !== 'critical') return 1;
      
      // Then by date (newest first)
      return new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime();
    });
  }, [findings]);

  // Filter findings by search
  const filteredFindings = useMemo(() => {
    if (!searchQuery) return sortedFindings;
    
    const query = searchQuery.toLowerCase();
    return sortedFindings.filter(
      f =>
        f.title.toLowerCase().includes(query) ||
        f.description.toLowerCase().includes(query) ||
        f.tags?.some(t => t.toLowerCase().includes(query))
    );
  }, [sortedFindings, searchQuery]);

  // Show top 5 by default
  const displayedFindings = filteredFindings.slice(0, 5);

  const handleRemove = (id: string) => {
    removeFinding(id);
    setFindings(loadFindings());
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Star className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Key Findings</CardTitle>
          </div>
          <Badge variant="secondary" className="text-xs">
            {findings.length}
          </Badge>
        </div>
        <CardDescription>Important discoveries from your research</CardDescription>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col min-h-0 space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search findings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Findings List */}
        <ScrollArea className="flex-1">
          <div className="space-y-2 pr-4">
            {displayedFindings.length > 0 ? (
              displayedFindings.map((finding) => (
                <FindingCard key={finding.id} finding={finding} onRemove={handleRemove} />
              ))
            ) : findings.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No findings match your search</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Show More indicator */}
        {filteredFindings.length > 5 && (
          <div className="text-center py-2 border-t">
            <p className="text-xs text-muted-foreground">
              Showing top 5 of {filteredFindings.length} findings
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

function FindingCard({ finding, onRemove }: { finding: Finding; onRemove: (id: string) => void }) {
  const Icon = FINDING_ICONS[finding.type];
  const colorClass = IMPORTANCE_COLORS[finding.importance];

  return (
    <Card className={cn('relative group', finding.importance === 'critical' && 'border-destructive')}>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', colorClass)} />
          
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <h4 className="font-semibold text-sm leading-tight">{finding.title}</h4>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                onClick={() => onRemove(finding.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed mb-2">
              {finding.description}
            </p>

            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs">
                {finding.type}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(finding.discoveredAt).toLocaleDateString()}
              </span>
              {finding.tags?.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-12">
      <div className="mb-4 flex justify-center gap-2">
        <Star className="h-8 w-8 text-muted-foreground/50" />
        <Lightbulb className="h-8 w-8 text-muted-foreground/50" />
        <Trophy className="h-8 w-8 text-muted-foreground/50" />
      </div>
      <h3 className="font-semibold mb-2">No findings yet</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-xs mx-auto">
        Key discoveries will appear here as you research. Chief Quant will automatically capture important insights.
      </p>
      <Button variant="outline" size="sm" disabled>
        <Plus className="h-3 w-3 mr-1" />
        Add Manual Finding
      </Button>
    </div>
  );
}
