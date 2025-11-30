/**
 * EvidenceChain - Shows traceable sources for analysis with inline verification
 * Displays at the bottom of assistant messages to provide provenance
 */

import { FileCode, CheckCircle, ExternalLink, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export interface EvidenceNode {
  id: string;
  type: 'file' | 'data' | 'execution' | 'memory';
  source: string;
  description: string;
  verified: boolean;
  details?: string; // Additional context for verification
  lineRange?: string; // For file sources: "45-67"
}

interface EvidenceChainProps {
  nodes: EvidenceNode[];
  onVerify?: (nodeId: string) => void;
  onViewSource?: (nodeId: string) => void;
  className?: string;
}

function EvidenceNodeCard({ 
  node, 
  onVerify, 
  onViewSource 
}: { 
  node: EvidenceNode; 
  onVerify?: (id: string) => void;
  onViewSource?: (id: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  const getIcon = () => {
    if (node.verified) return <CheckCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />;
    return <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  return (
    <div className="flex items-start gap-2 group">
      <div className="mt-0.5">{getIcon()}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs font-mono text-primary">
            {node.source}
            {node.lineRange && <span className="text-muted-foreground"> (lines {node.lineRange})</span>}
          </code>
          <span className="text-xs text-muted-foreground">→</span>
          <span className="text-xs">{node.description}</span>
        </div>

        {/* Actions */}
        <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {node.details && (
            <Collapsible open={showDetails} onOpenChange={setShowDetails}>
              <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground">
                {showDetails ? '▼' : '▶'} Details
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1">
                <pre className="text-xs bg-muted rounded p-2 max-h-24 overflow-y-auto">
                  {node.details}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          )}
          {onVerify && !node.verified && (
            <Button
              onClick={() => onVerify(node.id)}
              variant="ghost"
              size="sm"
              className="h-5 px-2 text-xs"
            >
              Verify
            </Button>
          )}
          {onViewSource && (
            <Button
              onClick={() => onViewSource(node.id)}
              variant="ghost"
              size="sm"
              className="h-5 px-2 text-xs flex items-center gap-1"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              View
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function EvidenceChain({ nodes, onVerify, onViewSource, className }: EvidenceChainProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (nodes.length === 0) return null;

  const verifiedCount = nodes.filter(n => n.verified).length;

  return (
    <Card className={cn('border-l-4 border-l-indigo-500 shadow-sm', className)}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="p-3">
          <CollapsibleTrigger className="flex items-center justify-between w-full hover:bg-muted/50 rounded px-2 py-1 transition-colors">
            <div className="flex items-center gap-2">
              <FileCode className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <span className="text-sm font-semibold">Evidence Trail</span>
              <Badge variant="outline" className="text-xs">
                {verifiedCount}/{nodes.length} verified
              </Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              {isExpanded ? '▼' : '▶'}
            </span>
          </CollapsibleTrigger>

          <CollapsibleContent className="mt-3">
            <div className="space-y-2">
              {nodes.map((node) => (
                <EvidenceNodeCard
                  key={node.id}
                  node={node}
                  onVerify={onVerify}
                  onViewSource={onViewSource}
                />
              ))}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </Card>
  );
}

/**
 * Parse evidence trail from LLM response
 * Looks for [EVIDENCE_TRAIL]...[/EVIDENCE_TRAIL] block
 */
export function parseEvidenceTrail(text: string): EvidenceNode[] {
  const trailMatch = text.match(/\[EVIDENCE_TRAIL\](.*?)\[\/EVIDENCE_TRAIL\]/s);
  if (!trailMatch) return [];

  const trailContent = trailMatch[1];
  const lines = trailContent.split('\n').filter(line => line.trim().startsWith('-'));

  const nodes: EvidenceNode[] = [];
  
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    // Parse format: - path/to/file.py (lines 45-67): description
    const match = line.match(/^\s*-\s*(.+?)(?:\s*\(lines?\s*([\d-]+)\))?\s*:\s*(.+)$/);
    if (!match) {
      // Fallback format: - source: description
      const simpleMatch = line.match(/^\s*-\s*(.+?):\s*(.+)$/);
      if (simpleMatch) {
        nodes.push({
          id: `evidence-${idx}`,
          type: 'file',
          source: simpleMatch[1].trim(),
          description: simpleMatch[2].trim(),
          verified: false
        });
      }
      continue;
    }

    const [, source, lineRange, description] = match;
    
    // Determine type from source
    let type: EvidenceNode['type'] = 'file';
    if (source.includes('Claude Code') || source.includes('execution')) type = 'execution';
    else if (source.includes('data/') || source.includes('.json') || source.includes('.csv')) type = 'data';
    else if (source.includes('memory')) type = 'memory';

    nodes.push({
      id: `evidence-${idx}`,
      type,
      source: source.trim(),
      description: description.trim(),
      lineRange: lineRange?.trim(),
      verified: false
    });
  }
  
  return nodes;
}
