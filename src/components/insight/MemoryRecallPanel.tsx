/**
 * MemoryRecallPanel - Shows what memories CIO accessed with full context
 */

import { useState } from 'react';
import { Brain, ChevronDown, ChevronRight, Clock, Tag, Zap } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export interface RecalledMemory {
  id: string;
  content: string;
  summary?: string;
  category?: string;
  importance?: number;
  tags?: string[];
  recallScore?: number;
  createdAt?: string;
}

interface MemoryRecallPanelProps {
  memories: RecalledMemory[];
  searchQuery?: string;
  searchTimeMs?: number;
  className?: string;
}

function MemoryCard({ memory, isExpanded, onToggle }: { 
  memory: RecalledMemory; 
  isExpanded: boolean; 
  onToggle: () => void;
}) {
  const importanceColor = memory.importance 
    ? memory.importance > 0.8 ? 'text-red-500' 
    : memory.importance > 0.5 ? 'text-yellow-500' 
    : 'text-muted-foreground'
    : 'text-muted-foreground';

  return (
    <Card 
      className={cn(
        'p-3 cursor-pointer transition-all hover:bg-muted/50',
        isExpanded && 'ring-1 ring-primary/30'
      )}
      onClick={onToggle}
    >
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 mt-0.5">
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </Button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {memory.category && (
              <Badge variant="outline" className="text-xs h-5">
                {memory.category}
              </Badge>
            )}
            {memory.recallScore && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Zap className="h-3 w-3" />
                {(memory.recallScore * 100).toFixed(0)}% match
              </span>
            )}
            {memory.importance && (
              <span className={cn('text-xs flex items-center gap-1', importanceColor)}>
                ★ {(memory.importance * 10).toFixed(1)}
              </span>
            )}
          </div>

          <p className={cn('text-sm', !isExpanded && 'line-clamp-2')}>
            {memory.summary || memory.content}
          </p>

          {isExpanded && memory.summary && memory.content !== memory.summary && (
            <div className="mt-2 p-2 bg-muted/50 rounded text-xs text-muted-foreground">
              <p className="font-medium mb-1">Full content:</p>
              <p className="whitespace-pre-wrap">{memory.content}</p>
            </div>
          )}

          {isExpanded && memory.tags && memory.tags.length > 0 && (
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              <Tag className="h-3 w-3 text-muted-foreground" />
              {memory.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs h-5">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {isExpanded && memory.createdAt && (
            <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {new Date(memory.createdAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export function MemoryRecallPanel({ 
  memories, 
  searchQuery, 
  searchTimeMs,
  className 
}: MemoryRecallPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className={cn('rounded-lg border bg-card p-3 flex flex-col', className)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-cyan-500" />
          <h4 className="text-sm font-semibold">Memory Recall</h4>
          <Badge variant="secondary" className="text-xs">
            {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
          </Badge>
        </div>
        {searchTimeMs !== undefined && (
          <span className="text-xs text-muted-foreground">
            {searchTimeMs}ms
          </span>
        )}
      </div>

      {searchQuery && (
        <div className="mb-3 p-2 bg-muted/50 rounded text-xs">
          <span className="text-muted-foreground">Query: </span>
          <span className="font-mono">{searchQuery.slice(0, 100)}{searchQuery.length > 100 ? '...' : ''}</span>
        </div>
      )}

      {memories.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-8">
          <p>No memories recalled for this message</p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-2 pr-2">
            {memories.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                isExpanded={expandedId === memory.id}
                onToggle={() => setExpandedId(expandedId === memory.id ? null : memory.id)}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      <p className="text-xs text-muted-foreground mt-3 pt-2 border-t italic">
        These past insights inform CIO's current analysis
      </p>
    </div>
  );
}
