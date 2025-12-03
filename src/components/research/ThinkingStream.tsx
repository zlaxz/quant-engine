/**
 * ThinkingStream - Shows Gemini 3's reasoning process in real-time
 */

import { Brain, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface ThinkingStreamProps {
  content: string;
  isActive: boolean;
  className?: string;
}

export function ThinkingStream({ content, isActive, className }: ThinkingStreamProps) {
  if (!content && !isActive) return null;

  return (
    <Card className={cn(
      'p-4 border-l-4 border-l-primary/60 bg-muted/30',
      className
    )}>
      <div className="flex items-center gap-2 mb-3">
        <Brain className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-medium text-foreground">
          Gemini Thinking
        </h4>
        {isActive && (
          <Sparkles className="h-3 w-3 text-primary animate-pulse ml-auto" />
        )}
      </div>

      <ScrollArea className="max-h-48 pr-4">
        <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
          {content.split('\n').filter(line => line.trim()).map((line, idx) => (
            <p key={idx} className="opacity-90">
              {line}
            </p>
          ))}
          {isActive && !content && (
            <span className="inline-block w-2 h-4 bg-primary/50 animate-pulse" />
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
