/**
 * ThinkingStream - Shows Gemini 3's reasoning process in real-time
 * 
 * Displays thinking tokens as they stream with visual differentiation
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
    <Card className={cn('p-4 border-l-4 border-l-purple-500 bg-purple-50/50 dark:bg-purple-950/20', className)}>
      <div className="flex items-center gap-2 mb-3">
        <Brain className="h-4 w-4 text-purple-500" />
        <h4 className="text-sm font-semibold text-purple-700 dark:text-purple-300">
          Gemini 3 Thinking
        </h4>
        {isActive && (
          <Sparkles className="h-3 w-3 text-purple-500 animate-pulse ml-auto" />
        )}
      </div>

      <ScrollArea className="h-32 pr-4">
        <div className="space-y-2 text-sm italic text-purple-900 dark:text-purple-100 leading-relaxed">
          {content.split('\n').map((line, idx) => (
            <p key={idx} className="animate-fade-in">
              {line}
            </p>
          ))}
          {isActive && <span className="inline-block w-2 h-4 bg-purple-500 animate-pulse ml-1" />}
        </div>
      </ScrollArea>

      <p className="text-xs text-muted-foreground mt-2 italic">
        This is Gemini's internal reasoning process before generating the final response
      </p>
    </Card>
  );
}
