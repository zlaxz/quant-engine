/**
 * OperationCard - Persistent visual card showing tool execution details
 * 
 * Makes Chief Quant's work visible: what files accessed, what data analyzed, what results returned
 */

import { FileCode, FolderOpen, Database, Calendar, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface OperationCardData {
  id: string;
  tool: string;
  args: Record<string, any>;
  result?: any;
  error?: string;
  timestamp: number;
  duration?: number;
  success: boolean;
}

interface OperationCardProps {
  operation: OperationCardData;
  className?: string;
}

function getToolIcon(tool: string) {
  if (tool.includes('file') || tool.includes('read') || tool.includes('write')) {
    return <FileCode className="h-4 w-4" />;
  }
  if (tool.includes('dir') || tool.includes('list')) {
    return <FolderOpen className="h-4 w-4" />;
  }
  if (tool.includes('data') || tool.includes('inspect')) {
    return <Database className="h-4 w-4" />;
  }
  return <FileCode className="h-4 w-4" />;
}

function extractKeyInfo(args: Record<string, any>) {
  const info: Array<{ icon: any; label: string; value: string }> = [];

  // File paths
  if (args.filePath || args.path) {
    const filePath = args.filePath || args.path;
    info.push({
      icon: FileCode,
      label: 'File',
      value: filePath
    });
  }

  // Date ranges
  if (args.start_date || args.startDate) {
    info.push({
      icon: Calendar,
      label: 'Start',
      value: args.start_date || args.startDate
    });
  }
  if (args.end_date || args.endDate) {
    info.push({
      icon: Calendar,
      label: 'End',
      value: args.end_date || args.endDate
    });
  }

  // Symbols
  if (args.symbol) {
    info.push({
      icon: Database,
      label: 'Symbol',
      value: args.symbol
    });
  }

  // Strategy
  if (args.strategy || args.strategyKey) {
    info.push({
      icon: FileCode,
      label: 'Strategy',
      value: args.strategy || args.strategyKey
    });
  }

  return info;
}

function formatResult(result: any): string {
  if (!result) return 'No result';
  
  if (typeof result === 'string') {
    // Truncate long strings
    return result.length > 200 ? result.substring(0, 200) + '...' : result;
  }
  
  if (Array.isArray(result)) {
    return `Found ${result.length} items`;
  }
  
  if (typeof result === 'object') {
    // Extract key information from objects
    const keys = Object.keys(result);
    if (keys.length === 0) return 'Empty result';
    
    // For file listings
    if (keys.includes('name') && keys.includes('type')) {
      return JSON.stringify(result, null, 2);
    }
    
    return `Object with ${keys.length} properties`;
  }
  
  return String(result);
}

export function OperationCard({ operation, className }: OperationCardProps) {
  const keyInfo = extractKeyInfo(operation.args);
  const resultPreview = operation.error 
    ? operation.error 
    : formatResult(operation.result);

  return (
    <Card className={cn(
      'p-4 mb-3 border-l-4 animate-fade-in',
      operation.success 
        ? 'border-l-green-500 bg-green-50 dark:bg-green-950/20' 
        : 'border-l-red-500 bg-red-50 dark:bg-red-950/20',
      className
    )}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {getToolIcon(operation.tool)}
          <code className="text-sm font-mono font-semibold">{operation.tool}</code>
          {operation.success ? (
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          ) : (
            <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {operation.duration && (
            <Badge variant="outline" className="font-mono">
              <Clock className="h-3 w-3 mr-1" />
              {operation.duration}ms
            </Badge>
          )}
          <span className="font-mono">
            {new Date(operation.timestamp).toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* Key Information */}
      {keyInfo.length > 0 && (
        <div className="space-y-2 mb-3 pb-3 border-b border-border/50">
          {keyInfo.map((info, idx) => (
            <div key={idx} className="flex items-start gap-2 text-sm">
              <info.icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground font-medium min-w-[60px]">{info.label}:</span>
              <code className="text-foreground font-mono text-xs bg-background/50 px-2 py-0.5 rounded">
                {info.value}
              </code>
            </div>
          ))}
        </div>
      )}

      {/* Result */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {operation.success ? (
            <>
              <CheckCircle2 className="h-3 w-3" />
              Result
            </>
          ) : (
            <>
              <AlertCircle className="h-3 w-3" />
              Error
            </>
          )}
        </div>
        <div className={cn(
          'text-sm font-mono p-3 rounded-md',
          operation.success
            ? 'bg-background/50 text-foreground'
            : 'bg-red-100 dark:bg-red-950/30 text-red-900 dark:text-red-200'
        )}>
          {resultPreview.includes('\n') || resultPreview.includes('{') ? (
            <pre className="whitespace-pre-wrap text-xs">{resultPreview}</pre>
          ) : (
            <span className="text-xs">{resultPreview}</span>
          )}
        </div>
      </div>

      {/* All Arguments (collapsed by default) */}
      {Object.keys(operation.args).length > keyInfo.length && (
        <details className="mt-3 pt-3 border-t border-border/50">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
            All parameters ({Object.keys(operation.args).length})
          </summary>
          <div className="mt-2 p-2 bg-background/50 rounded text-xs font-mono">
            <pre className="whitespace-pre-wrap">
              {JSON.stringify(operation.args, null, 2)}
            </pre>
          </div>
        </details>
      )}
    </Card>
  );
}
