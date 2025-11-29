/**
 * OperationCard - Persistent visual card showing tool execution details
 * 
 * Makes Chief Quant's work visible: what files accessed, what data analyzed, what results returned
 */

import { FileCode, FolderOpen, Database, Calendar, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PythonExecutionPanel, PythonExecutionData } from './PythonExecutionPanel';

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
  // Check if this is a Python execution - render specialized panel
  if (operation.tool === 'run_python_script' && operation.result?.metadata?.pythonExecution) {
    const meta = operation.result.metadata;
    const pythonData: PythonExecutionData = {
      id: operation.id,
      scriptPath: meta.scriptPath || operation.args.scriptPath || operation.args.path || 'unknown',
      args: meta.args || operation.args.args || [],
      command: meta.command || 'python3 ...',
      stdout: meta.stdout || '',
      stderr: meta.stderr || '',
      exitCode: meta.exitCode ?? null,
      duration: meta.duration || operation.duration || 0,
      timestamp: operation.timestamp,
      status: meta.status || (operation.success ? 'completed' : 'failed'),
      timeout: meta.timeout || operation.args.timeout
    };
    return <PythonExecutionPanel execution={pythonData} className={className} />;
  }

  const keyInfo = extractKeyInfo(operation.args);
  const resultPreview = operation.error 
    ? operation.error 
    : formatResult(operation.result);

  return (
    <Card className={cn(
      'p-5 mb-3 border-l-4 shadow-md hover:shadow-lg transition-all duration-200 animate-fade-in',
      operation.success 
        ? 'border-l-green-500 bg-gradient-to-br from-green-50/50 to-background dark:from-green-950/20 dark:to-background' 
        : 'border-l-red-500 bg-gradient-to-br from-red-50/50 to-background dark:from-red-950/20 dark:to-background',
      className
    )}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4 pb-3 border-b border-border/50">
        <div className="flex items-center gap-2.5">
          <div className={cn(
            'p-2 rounded-lg',
            operation.success ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'
          )}>
            {getToolIcon(operation.tool)}
          </div>
          <div className="space-y-1">
            <code className="text-sm font-mono font-bold block">{operation.tool}</code>
            <div className="flex items-center gap-2">
              {operation.success ? (
                <Badge variant="outline" className="bg-green-50 dark:bg-green-900/20 border-green-500 text-green-700 dark:text-green-300">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Success
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-red-50 dark:bg-red-900/20 border-red-500 text-red-700 dark:text-red-300">
                  <XCircle className="h-3 w-3 mr-1" />
                  Failed
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 text-xs text-muted-foreground">
          {operation.duration && (
            <Badge variant="secondary" className="font-mono">
              <Clock className="h-3 w-3 mr-1" />
              {operation.duration}ms
            </Badge>
          )}
          <time className="font-mono">
            {new Date(operation.timestamp).toLocaleTimeString()}
          </time>
        </div>
      </div>

      {/* Key Information */}
      {keyInfo.length > 0 && (
        <div className="grid grid-cols-1 gap-2 mb-4">
          {keyInfo.map((info, idx) => (
            <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border/50 hover:border-border transition-colors">
              <div className="p-2 rounded-md bg-background">
                <info.icon className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide block mb-1">{info.label}</span>
                <code className="text-sm text-foreground font-mono bg-background px-2 py-1 rounded block break-all">
                  {info.value}
                </code>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Result */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-wide">
          {operation.success ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Result
            </>
          ) : (
            <>
              <AlertCircle className="h-3.5 w-3.5" />
              Error
            </>
          )}
        </div>
        <div className={cn(
          'text-sm font-mono p-4 rounded-lg border shadow-sm',
          operation.success
            ? 'bg-background border-border text-foreground'
            : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
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
        <details className="mt-4 pt-4 border-t border-border/50">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors font-medium flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {Object.keys(operation.args).length} parameters
            </Badge>
            <span>View all arguments</span>
          </summary>
          <div className="mt-3 p-3 bg-muted rounded-lg text-xs font-mono border border-border">
            <pre className="whitespace-pre-wrap">
              {JSON.stringify(operation.args, null, 2)}
            </pre>
          </div>
        </details>
      )}
    </Card>
  );
}
