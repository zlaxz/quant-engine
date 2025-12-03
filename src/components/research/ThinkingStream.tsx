/**
 * ThinkingStream - Shows Gemini 3's reasoning process in real-time
 */

import { useState, useEffect } from 'react';
import { Brain, Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ThinkingStreamProps {
  content: string;
  isActive: boolean;
  className?: string;
}

export function ThinkingStream({ content, isActive, className }: ThinkingStreamProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [hasContent, setHasContent] = useState(false);

  // Track if we've ever had content
  useEffect(() => {
    if (content) setHasContent(true);
  }, [content]);

  // Auto-collapse when thinking completes
  useEffect(() => {
    if (!isActive && hasContent) {
      setIsExpanded(false);
    }
  }, [isActive, hasContent]);

  // Auto-expand when new thinking starts
  useEffect(() => {
    if (isActive) {
      setIsExpanded(true);
    }
  }, [isActive]);

  // Don't render if we've never had content
  if (!hasContent && !isActive) return null;

  return (
    <Card className={cn(
      'border-l-4 border-l-primary/60 bg-muted/30',
      className
    )}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center gap-2 text-left hover:bg-muted/50 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <Brain className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-medium text-foreground">
          Gemini Thinking
        </h4>
        {isActive && (
          <Sparkles className="h-3 w-3 text-primary animate-pulse ml-auto" />
        )}
        {!isActive && hasContent && (
          <span className="text-xs text-muted-foreground ml-auto">Completed</span>
        )}
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pr-4">
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
        </div>
      )}
    </Card>
  );
}
