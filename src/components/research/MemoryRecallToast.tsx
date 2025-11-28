/**
 * MemoryRecallToast - Shows what memories were recalled with previews
 * 
 * Displays as a rich toast when Chief Quant accesses memories
 */

import { Brain, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface Memory {
  id: string;
  content: string;
  category?: string;
  importance?: number;
  tags?: string[];
}

interface MemoryRecallToastProps {
  memories: Memory[];
  onClose?: () => void;
  className?: string;
}

export function MemoryRecallToast({ memories, onClose, className }: MemoryRecallToastProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (memories.length === 0) return null;

  const topMemories = isExpanded ? memories : memories.slice(0, 3);

  return (
    <Card className={cn('p-4 border-l-4 border-l-blue-500 bg-blue-50 dark:bg-blue-950/20 animate-fade-in', className)}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-blue-500" />
          <h4 className="text-sm font-semibold text-blue-700 dark:text-blue-300">
            Memory Recalled
          </h4>
          <Badge variant="secondary" className="text-xs h-5">
            {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
          </Badge>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-6 w-6 p-0"
          >
            ×
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {topMemories.map((memory) => (
          <div
            key={memory.id}
            className="p-2 rounded-md border bg-card hover:bg-muted/50 transition-colors"
          >
            <p className="text-xs line-clamp-2 mb-1">
              {memory.content}
            </p>
            <div className="flex items-center gap-1 flex-wrap">
              {memory.category && (
                <Badge variant="outline" className="text-xs h-4">
                  {memory.category}
                </Badge>
              )}
              {memory.importance && memory.importance > 0.7 && (
                <Badge variant="secondary" className="text-xs h-4">
                  High Priority
                </Badge>
              )}
              {memory.tags?.slice(0, 2).map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs h-4">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>

      {memories.length > 3 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full mt-2 h-7 text-xs"
        >
          <ChevronDown
            className={cn(
              'h-3 w-3 mr-1 transition-transform',
              isExpanded && 'rotate-180'
            )}
          />
          {isExpanded ? 'Show Less' : `Show ${memories.length - 3} More`}
        </Button>
      )}

      <p className="text-xs text-muted-foreground mt-2 italic">
        Chief Quant is using these past insights to inform the current analysis
      </p>
    </Card>
  );
}
