/**
 * OperationCard - Persistent visual card showing tool execution details
 * 
 * Makes Chief Quant's work visible: what files accessed, what data analyzed, what results returned
 */

import { FileCode, FolderOpen, Database, Calendar, Clock } from 'lucide-react';
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
  whyThis?: string;      // Explanation of why this tool was needed
  whatFound?: string;    // Summary of what was discovered
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
      'flex-shrink-0 w-80 border-l-4 shadow-sm hover:shadow-md transition-shadow',
      operation.success 
        ? 'border-l-green-500' 
        : 'border-l-red-500',
      className
    )}>
      <div className="p-3 space-y-3">
        {/* What I Found - Top Summary */}
        {operation.whatFound && operation.success && (
          <div className="bg-green-50 dark:bg-green-950/30 border-l-2 border-green-500 p-2 rounded">
            <div className="text-xs font-semibold text-green-700 dark:text-green-300 mb-1">
              💡 What I Found:
            </div>
            <p className="text-xs text-green-900 dark:text-green-100">
              {operation.whatFound}
            </p>
          </div>
        )}

        {/* Compact Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className={cn(
              'p-1.5 rounded',
              operation.success ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'
            )}>
              {getToolIcon(operation.tool)}
            </div>
            <code className="text-xs font-mono font-bold truncate">{operation.tool}</code>
          </div>
          <Badge variant={operation.success ? "default" : "destructive"} className="text-xs px-1.5 py-0 h-5 flex-shrink-0">
            {operation.success ? "✓" : "✗"}
          </Badge>
        </div>

        {/* Why This? - Reasoning */}
        {operation.whyThis && (
          <div className="bg-blue-50 dark:bg-blue-950/30 border-l-2 border-blue-500 p-2 rounded">
            <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">
              🤔 Why This?
            </div>
            <p className="text-xs text-blue-900 dark:text-blue-100">
              {operation.whyThis}
            </p>
          </div>
        )}

        {/* Time & Duration */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(operation.timestamp).toLocaleTimeString()}
          </span>
          {operation.duration && (
            <Badge variant="secondary" className="font-mono text-xs h-5">
              {operation.duration}ms
            </Badge>
          )}
        </div>

        {/* Compact Key Info */}
        {keyInfo.length > 0 && (
          <div className="space-y-1.5">
            {keyInfo.slice(0, 2).map((info, idx) => (
              <div key={idx} className="bg-muted/50 rounded px-2 py-1.5">
                <div className="text-xs text-muted-foreground">{info.label}</div>
                <code className="text-xs font-mono truncate block" title={info.value}>
                  {info.value}
                </code>
              </div>
            ))}
            {keyInfo.length > 2 && (
              <div className="text-xs text-muted-foreground text-center">
                +{keyInfo.length - 2} more
              </div>
            )}
          </div>
        )}

        {/* Compact Result/Error */}
        <div className={cn(
          'text-xs p-2 rounded border max-h-24 overflow-y-auto',
          operation.success
            ? 'bg-muted/30 border-border'
            : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
        )}>
          <pre className="whitespace-pre-wrap break-words font-mono text-xs">
            {resultPreview}
          </pre>
        </div>

        {/* Expandable Details */}
        {Object.keys(operation.args).length > 2 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground flex items-center gap-1">
              <Badge variant="outline" className="text-xs">
                {Object.keys(operation.args).length} params
              </Badge>
            </summary>
            <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto max-h-32">
              {JSON.stringify(operation.args, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </Card>
  );
}
