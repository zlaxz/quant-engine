/**
 * MessageCard - Kanban-style card for chat messages with rich visualization support
 *
 * Parses directives from content and renders charts, tables, metrics, and code
 * Memoized to prevent re-rendering all messages on every parent update
 */

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { User, Bot, Terminal, Clock, Brain, Zap, Workflow, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { memo, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  parseChartDirective,
  parseTableDirective,
  parseMetricsDirective,
  parseCodeDirective,
  stripDisplayDirectives,
} from '@/lib/displayDirectiveParser';
import { GenericChart, GenericTable, MetricsDashboard, CodeDisplay } from '@/components/charts';

interface MessageCardProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  model?: 'gemini' | 'claude' | 'claude-code' | 'deepseek';
  className?: string;
}

// Get display config based on model (for assistant messages)
function getModelDisplayConfig(model?: string) {
  switch (model) {
    case 'gemini':
      return {
        icon: Brain,
        role: 'CIO',
        model: 'Gemini',
        badgeColor: 'bg-emerald-500 text-white',
        borderColor: 'border-l-emerald-500',
        bgColor: 'bg-emerald-50/50 dark:bg-emerald-950/20',
      };
    case 'claude':
      return {
        icon: Zap,
        role: 'API',
        model: 'Claude',
        badgeColor: 'bg-orange-500 text-white',
        borderColor: 'border-l-orange-500',
        bgColor: 'bg-orange-50/50 dark:bg-orange-950/20',
      };
    case 'claude-code':
      return {
        icon: Terminal,
        role: 'CTO',
        model: 'Claude Code',
        badgeColor: 'bg-amber-600 text-white',
        borderColor: 'border-l-amber-600',
        bgColor: 'bg-amber-50/50 dark:bg-amber-950/20',
      };
    case 'deepseek':
      return {
        icon: Workflow,
        role: 'Analyst',
        model: 'DeepSeek',
        badgeColor: 'bg-cyan-500 text-white',
        borderColor: 'border-l-cyan-500',
        bgColor: 'bg-cyan-50/50 dark:bg-cyan-950/20',
      };
    default:
      return null;
  }
}

// Get display config based on role (fallback for non-model messages)
function getRoleConfig(role: string) {
  switch (role) {
    case 'user':
      return {
        icon: User,
        label: 'You',
        borderColor: 'border-l-blue-500',
        bgColor: 'bg-blue-50/50 dark:bg-blue-950/20',
        badgeColor: 'bg-blue-500 text-white',
      };
    case 'assistant':
      return {
        icon: Bot,
        label: 'Assistant',
        borderColor: 'border-l-purple-500',
        bgColor: 'bg-purple-50/50 dark:bg-purple-950/20',
        badgeColor: 'bg-purple-500 text-white',
      };
    case 'system':
      return {
        icon: Terminal,
        label: 'System',
        borderColor: 'border-l-gray-500',
        bgColor: 'bg-gray-50/50 dark:bg-gray-950/20',
        badgeColor: 'bg-gray-500 text-white',
      };
    default:
      return {
        icon: Bot,
        label: 'Unknown',
        borderColor: 'border-l-gray-500',
        bgColor: 'bg-gray-50/50 dark:bg-gray-950/20',
        badgeColor: 'bg-gray-500 text-white',
      };
  }
}

/**
 * Detect JSON blocks in text and extract them
 */
function extractJsonBlocks(text: string): { json: object; raw: string }[] {
  const blocks: { json: object; raw: string }[] = [];
  
  // Match ```json blocks
  const codeBlockPattern = /```json\s*([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockPattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      blocks.push({ json: parsed, raw: match[0] });
    } catch {
      // Not valid JSON
    }
  }
  
  // Match standalone JSON objects (line starting with {)
  const lines = text.split('\n');
  let jsonBuffer = '';
  let inJson = false;
  let braceCount = 0;
  
  for (const line of lines) {
    if (!inJson && line.trim().startsWith('{')) {
      inJson = true;
      jsonBuffer = '';
      braceCount = 0;
    }
    
    if (inJson) {
      jsonBuffer += line + '\n';
      braceCount += (line.match(/{/g) || []).length;
      braceCount -= (line.match(/}/g) || []).length;
      
      if (braceCount === 0) {
        try {
          const parsed = JSON.parse(jsonBuffer.trim());
          blocks.push({ json: parsed, raw: jsonBuffer.trim() });
        } catch {
          // Not valid JSON
        }
        inJson = false;
        jsonBuffer = '';
      }
    }
  }
  
  return blocks;
}

/**
 * Try to convert detected JSON into a visualization
 */
function jsonToVisualization(json: object): { type: 'metrics' | 'table' | 'keyvalue'; data: any } | null {
  const obj = json as Record<string, unknown>;
  
  // Check if it's a metrics-like object (flat key-value with numbers)
  const keys = Object.keys(obj);
  if (keys.length > 0 && keys.length <= 10) {
    const allPrimitive = keys.every(k => 
      typeof obj[k] === 'number' || 
      typeof obj[k] === 'string' || 
      typeof obj[k] === 'boolean'
    );
    
    if (allPrimitive) {
      // Convert to metrics format
      const metrics = keys.map(key => {
        const value = obj[key];
        const numValue = typeof value === 'number' ? value : null;
        
        // Determine status based on common metric patterns
        let status: 'good' | 'warning' | 'critical' | 'neutral' = 'neutral';
        const keyLower = key.toLowerCase();
        
        if (numValue !== null) {
          if (keyLower.includes('sharpe') || keyLower.includes('ratio')) {
            status = numValue > 1.5 ? 'good' : numValue > 0.5 ? 'warning' : 'critical';
          } else if (keyLower.includes('drawdown') || keyLower.includes('loss')) {
            status = Math.abs(numValue) < 0.1 ? 'good' : Math.abs(numValue) < 0.2 ? 'warning' : 'critical';
          } else if (keyLower.includes('win') || keyLower.includes('rate') || keyLower.includes('accuracy')) {
            status = numValue > 0.6 ? 'good' : numValue > 0.4 ? 'warning' : 'critical';
          } else if (keyLower.includes('profit') || keyLower.includes('return') || keyLower.includes('gain')) {
            status = numValue > 0 ? 'good' : 'critical';
          }
        }
        
        return {
          name: key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim(),
          value: value,
          status,
          format: typeof value === 'number' && Math.abs(value as number) < 1 ? '0.2%' : undefined
        };
      });
      
      return {
        type: 'metrics',
        data: { id: `auto-metrics-${Date.now()}`, metrics }
      };
    }
  }
  
  // Check if it's array data (could be table)
  if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object') {
    const firstRow = obj[0] as Record<string, unknown>;
    const columns = Object.keys(firstRow).map(key => ({
      key,
      label: key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim()
    }));
    
    return {
      type: 'table',
      data: {
        id: `auto-table-${Date.now()}`,
        columns,
        rows: obj as Record<string, unknown>[]
      }
    };
  }
  
  return null;
}

/**
 * Parse all rich content from message
 */
function parseRichContent(content: string) {
  // First try explicit directives
  const chart = parseChartDirective(content);
  const table = parseTableDirective(content);
  const metrics = parseMetricsDirective(content);
  const code = parseCodeDirective(content);
  let cleanText = stripDisplayDirectives(content);

  // Auto-detect JSON and try to visualize it
  const autoVisualizations: Array<{ type: 'metrics' | 'table' | 'keyvalue'; data: any }> = [];
  
  if (!chart && !table && !metrics) {
    const jsonBlocks = extractJsonBlocks(cleanText);
    
    for (const block of jsonBlocks) {
      const viz = jsonToVisualization(block.json);
      if (viz) {
        autoVisualizations.push(viz);
        // Remove the JSON from clean text since we're visualizing it
        cleanText = cleanText.replace(block.raw, '').trim();
      }
    }
  }

  return { chart, table, metrics, code, cleanText, autoVisualizations };
}

/**
 * Format text with basic markdown-like styling
 */
function formatText(text: string) {
  // Split into paragraphs
  const paragraphs = text.split('\n\n');
  
  return paragraphs.map((paragraph, pIdx) => {
    // Check for headers
    if (paragraph.startsWith('# ')) {
      return <h2 key={pIdx} className="text-lg font-bold mt-3 mb-2">{paragraph.slice(2)}</h2>;
    }
    if (paragraph.startsWith('## ')) {
      return <h3 key={pIdx} className="text-base font-semibold mt-3 mb-1.5">{paragraph.slice(3)}</h3>;
    }
    if (paragraph.startsWith('### ')) {
      return <h4 key={pIdx} className="text-sm font-semibold mt-2 mb-1">{paragraph.slice(4)}</h4>;
    }

    // Check for bullet lists
    const lines = paragraph.split('\n');
    const isBulletList = lines.every(line => line.trim().startsWith('- ') || line.trim().startsWith('• ') || line.trim() === '');
    
    if (isBulletList && lines.some(l => l.trim())) {
      return (
        <ul key={pIdx} className="list-disc list-inside space-y-1 my-2 ml-2">
          {lines.filter(l => l.trim()).map((line, lIdx) => (
            <li key={lIdx} className="text-sm">{line.replace(/^[-•]\s*/, '')}</li>
          ))}
        </ul>
      );
    }

    // Check for numbered lists
    const isNumberedList = lines.every(line => /^\d+[.)]\s/.test(line.trim()) || line.trim() === '');
    
    if (isNumberedList && lines.some(l => l.trim())) {
      return (
        <ol key={pIdx} className="list-decimal list-inside space-y-1 my-2 ml-2">
          {lines.filter(l => l.trim()).map((line, lIdx) => (
            <li key={lIdx} className="text-sm">{line.replace(/^\d+[.)]\s*/, '')}</li>
          ))}
        </ol>
      );
    }

    // Regular paragraph with inline code support
    const parts = paragraph.split(/(`[^`]+`)/g);
    return (
      <p key={pIdx} className="text-sm leading-relaxed mb-2">
        {parts.map((part, partIdx) => {
          if (part.startsWith('`') && part.endsWith('`')) {
            return (
              <code key={partIdx} className="px-1 py-0.5 bg-muted rounded text-xs font-mono">
                {part.slice(1, -1)}
              </code>
            );
          }
          // Handle bold
          const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
          return boldParts.map((bp, bpIdx) => {
            if (bp.startsWith('**') && bp.endsWith('**')) {
              return <strong key={`${partIdx}-${bpIdx}`}>{bp.slice(2, -2)}</strong>;
            }
            return <span key={`${partIdx}-${bpIdx}`}>{bp}</span>;
          });
        })}
      </p>
    );
  });
}

export const MessageCard = memo(function MessageCard({ role, content, timestamp, model, className }: MessageCardProps) {
  const [showRaw, setShowRaw] = useState(false);
  
  const roleConfig = getRoleConfig(role);
  const modelConfig = getModelDisplayConfig(model);

  // Parse rich content from directives
  const { chart, table, metrics, code, cleanText, autoVisualizations } = useMemo(
    () => parseRichContent(content),
    [content]
  );

  const hasRichContent = chart || table || metrics || code || autoVisualizations.length > 0;
  const hasDirectives = content !== cleanText;

  // For assistant messages with known model, use model config; otherwise use role config
  const displayConfig = (role === 'assistant' && modelConfig) ? {
    icon: modelConfig.icon,
    label: modelConfig.role,
    sublabel: modelConfig.model,
    badgeColor: modelConfig.badgeColor,
    borderColor: modelConfig.borderColor,
    bgColor: modelConfig.bgColor,
  } : {
    icon: roleConfig.icon,
    label: roleConfig.label,
    sublabel: null,
    badgeColor: roleConfig.badgeColor,
    borderColor: roleConfig.borderColor,
    bgColor: roleConfig.bgColor,
  };

  const Icon = displayConfig.icon;

  return (
    <Card className={cn(
      'p-4 mb-3 border-l-4 shadow-sm hover:shadow-md transition-all duration-200 animate-fade-in',
      displayConfig.borderColor,
      displayConfig.bgColor,
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-border/50">
        <Badge
          className={cn('flex items-center gap-1.5', displayConfig.badgeColor)}
          aria-label={displayConfig.sublabel ? `${displayConfig.label} - ${displayConfig.sublabel}` : displayConfig.label}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="font-semibold">{displayConfig.label}</span>
          {displayConfig.sublabel && (
            <span className="text-xs opacity-80">• {displayConfig.sublabel}</span>
          )}
        </Badge>
        <div className="flex items-center gap-2">
          {hasDirectives && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => setShowRaw(!showRaw)}
            >
              {showRaw ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
              {showRaw ? 'Hide raw' : 'Show raw'}
            </Button>
          )}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <time dateTime={timestamp}>
              {format(new Date(timestamp), 'h:mm a')}
            </time>
          </div>
        </div>
      </div>

      {/* Rich Content Visualizations */}
      {hasRichContent && (
        <div className="space-y-4 mb-4">
          {/* Metrics Dashboard */}
          {metrics && (
            <div className="rounded-lg border bg-background p-3">
              <MetricsDashboard data={metrics} />
            </div>
          )}

          {/* Chart */}
          {chart && (
            <div className="rounded-lg border bg-background p-3">
              <GenericChart data={chart} />
            </div>
          )}

          {/* Table */}
          {table && (
            <div className="rounded-lg border bg-background overflow-hidden">
              <GenericTable data={table} />
            </div>
          )}

          {/* Code Display */}
          {code && (
            <div className="rounded-lg border bg-background overflow-hidden">
              <CodeDisplay data={code} />
            </div>
          )}

          {/* Auto-detected visualizations */}
          {autoVisualizations.map((viz, idx) => (
            <div key={`auto-${idx}`} className="rounded-lg border bg-background p-3">
              {viz.type === 'metrics' && <MetricsDashboard data={viz.data} />}
              {viz.type === 'table' && <GenericTable data={viz.data} />}
            </div>
          ))}
        </div>
      )}

      {/* Text Content */}
      <div className="prose prose-sm dark:prose-invert max-w-none">
        {cleanText.startsWith('Command:') ? (
          <code className="block p-2 bg-background/50 rounded border border-border text-sm font-mono">
            {cleanText.replace('Command: ', '')}
          </code>
        ) : (
          <div>{formatText(cleanText)}</div>
        )}
      </div>

      {/* Raw Content (for debugging) */}
      {showRaw && hasDirectives && (
        <div className="mt-4 pt-4 border-t">
          <div className="text-[10px] font-medium text-muted-foreground mb-2">Raw Response (with directives)</div>
          <pre className="text-[10px] font-mono bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
            {content}
          </pre>
        </div>
      )}
    </Card>
  );
});
