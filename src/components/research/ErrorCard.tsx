/**
 * ErrorCard - Actionable error display with recovery options
 * 
 * Features:
 * - Clear error message
 * - View Code button
 * - Copy Error button
 * - Retry button
 * - Stack trace expansion
 */

import { AlertCircle, Copy, RotateCcw, Code2, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export interface ErrorDetails {
  message: string;
  code?: string;
  file?: string;
  line?: number;
  stack?: string;
  context?: string;
}

interface ErrorCardProps {
  error: ErrorDetails;
  onRetry?: () => void;
  onViewCode?: () => void;
  className?: string;
}

export function ErrorCard({ error, onRetry, onViewCode, className }: ErrorCardProps) {
  const [showStack, setShowStack] = useState(false);
  const { toast } = useToast();

  const handleCopy = () => {
    const errorText = [
      error.message,
      error.file && error.line ? `at ${error.file}:${error.line}` : '',
      error.stack || '',
    ].filter(Boolean).join('\n\n');

    navigator.clipboard.writeText(errorText);
    toast({
      title: 'Copied to clipboard',
      description: 'Error details copied',
    });
  };

  return (
    <Card className={cn('p-4 border-l-4 border-l-red-500 bg-red-50 dark:bg-red-950/20', className)}>
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
        
        <div className="flex-1 min-w-0 space-y-3">
          {/* Error Message */}
          <div>
            <h4 className="text-sm font-semibold text-red-700 dark:text-red-300 mb-1">
              Error
            </h4>
            <p className="text-sm text-red-900 dark:text-red-100">
              {error.message}
            </p>
          </div>

          {/* Location */}
          {error.file && error.line && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Code2 className="h-3 w-3" />
              <code className="font-mono">{error.file}:{error.line}</code>
            </div>
          )}

          {/* Context */}
          {error.context && (
            <div className="p-2 rounded bg-muted/50 border">
              <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground">
                {error.context}
              </pre>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            {onRetry && (
              <Button
                size="sm"
                variant="default"
                onClick={onRetry}
                className="h-7"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Retry
              </Button>
            )}
            
            {onViewCode && error.file && (
              <Button
                size="sm"
                variant="outline"
                onClick={onViewCode}
                className="h-7"
              >
                <Code2 className="h-3 w-3 mr-1" />
                View Code
              </Button>
            )}
            
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopy}
              className="h-7"
            >
              <Copy className="h-3 w-3 mr-1" />
              Copy Error
            </Button>

            {error.stack && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowStack(!showStack)}
                className="h-7"
              >
                <ChevronDown
                  className={cn(
                    'h-3 w-3 mr-1 transition-transform',
                    showStack && 'rotate-180'
                  )}
                />
                Stack Trace
              </Button>
            )}
          </div>

          {/* Stack Trace */}
          {showStack && error.stack && (
            <ScrollArea className="h-32 rounded-md border bg-muted/50 p-2">
              <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                {error.stack}
              </pre>
            </ScrollArea>
          )}
        </div>
      </div>
    </Card>
  );
}
