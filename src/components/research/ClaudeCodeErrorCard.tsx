/**
 * ClaudeCodeErrorCard - Shows structured error information when Claude Code execution fails
 * Includes actionable guidance and similar failure patterns
 */

import { AlertCircle, Lightbulb, History, RotateCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export interface ClaudeCodeError {
  type: 'syntax' | 'runtime' | 'timeout' | 'spawn' | 'unknown';
  message: string;
  stderr?: string;
  exitCode?: number;
  suggestion: string;
  similarFailures?: Array<{
    date: string;
    task: string;
    resolution: string;
  }>;
}

interface ClaudeCodeErrorCardProps {
  error: ClaudeCodeError;
  onRetry?: () => void;
  className?: string;
}

const errorStyles = {
  timeout: { border: 'border-l-yellow-500', bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-600 dark:text-yellow-400', icon: 'text-yellow-600 dark:text-yellow-400' },
  syntax: { border: 'border-l-orange-500', bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-600 dark:text-orange-400', icon: 'text-orange-600 dark:text-orange-400' },
  runtime: { border: 'border-l-red-500', bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400', icon: 'text-red-600 dark:text-red-400' },
  spawn: { border: 'border-l-purple-500', bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-600 dark:text-purple-400', icon: 'text-purple-600 dark:text-purple-400' },
  unknown: { border: 'border-l-gray-500', bg: 'bg-gray-100 dark:bg-gray-900/30', text: 'text-gray-600 dark:text-gray-400', icon: 'text-gray-600 dark:text-gray-400' }
} as const;

function parseErrorType(stderr: string, exitCode: number | undefined): ClaudeCodeError['type'] {
  if (stderr.includes('timeout') || stderr.includes('SIGTERM')) return 'timeout';
  if (stderr.includes('SyntaxError') || stderr.includes('IndentationError')) return 'syntax';
  if (stderr.includes('Failed to spawn')) return 'spawn';
  if (exitCode !== undefined && exitCode !== 0) return 'runtime';
  return 'unknown';
}

function generateSuggestion(type: ClaudeCodeError['type'], stderr: string): string {
  switch (type) {
    case 'timeout':
      return 'Task too complex for single execution. Try breaking into smaller steps or increase timeout.';
    case 'syntax':
      if (stderr.includes('IndentationError')) {
        return 'Python indentation error. Check mixed tabs/spaces in generated code.';
      }
      return 'Python syntax error. Review the generated code structure.';
    case 'runtime':
      if (stderr.includes('ModuleNotFoundError') || stderr.includes('ImportError')) {
        return 'Missing Python dependency. Use manage_environment tool to install required packages.';
      }
      if (stderr.includes('FileNotFoundError')) {
        return 'File path incorrect. Verify the file exists at the specified location.';
      }
      return 'Runtime error during execution. Review error details below.';
    case 'spawn':
      return 'Claude Code CLI not available. Ensure Claude Code is installed and accessible in PATH.';
    default:
      return 'Unexpected error. Review error details and try again.';
  }
}

export function ClaudeCodeErrorCard({ error, onRetry, className }: ClaudeCodeErrorCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const colorClass = errorStyles[error.type];

  return (
    <Card className={cn(
      'border-l-4 shadow-md',
      `border-l-${colorClass}-500`,
      className
    )}>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className={cn('p-2 rounded', styles.bg)}>
            <AlertCircle className={cn('h-5 w-5', styles.icon)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-sm">Claude Code Execution Failed</h4>
              <Badge variant="outline" className="text-xs">
                {error.type}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {error.message}
            </p>
          </div>
        </div>

        {/* Suggestion */}
        <div className="bg-blue-50 dark:bg-blue-950/30 border-l-2 border-blue-500 p-3 rounded">
          <div className="flex items-start gap-2">
            <Lightbulb className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">
                💡 Suggested Fix:
              </div>
              <p className="text-xs text-blue-900 dark:text-blue-100">
                {error.suggestion}
              </p>
            </div>
          </div>
        </div>

        {/* Error Details (Collapsible) */}
        {error.stderr && (
          <Collapsible open={showDetails} onOpenChange={setShowDetails}>
            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Badge variant="outline" className="text-xs">
                {error.exitCode !== undefined ? `Exit Code: ${error.exitCode}` : 'Error Details'}
              </Badge>
              <span>{showDetails ? '▼' : '▶'} View stderr</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <pre className="text-xs p-3 bg-muted rounded border max-h-48 overflow-y-auto font-mono">
                {error.stderr}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Similar Failures */}
        {error.similarFailures && error.similarFailures.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border-l-2 border-amber-500 p-3 rounded">
            <div className="flex items-start gap-2 mb-2">
              <History className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                📊 Similar Past Failures:
              </div>
            </div>
            <div className="space-y-2">
              {error.similarFailures.slice(0, 2).map((failure, idx) => (
                <div key={idx} className="text-xs">
                  <div className="text-amber-900 dark:text-amber-100 font-medium">
                    {failure.date}: {failure.task}
                  </div>
                  <div className="text-amber-700 dark:text-amber-300">
                    ✓ Resolved: {failure.resolution}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {onRetry && (
          <div className="flex gap-2">
            <Button
              onClick={onRetry}
              size="sm"
              variant="outline"
              className="flex items-center gap-2"
            >
              <RotateCw className="h-3 w-3" />
              Retry
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Helper to create ClaudeCodeError from tool result
 */
export function createClaudeCodeError(
  result: { error?: string; content?: string },
  stderr?: string,
  exitCode?: number
): ClaudeCodeError {
  const errorMsg = result.error || 'Unknown error';
  const type = parseErrorType(stderr || errorMsg, exitCode);
  const suggestion = generateSuggestion(type, stderr || errorMsg);

  return {
    type,
    message: errorMsg,
    stderr,
    exitCode,
    suggestion,
    similarFailures: [] // TODO: Query from session_contexts for similar failures
  };
}
