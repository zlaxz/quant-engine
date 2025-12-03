/**
 * HiveMonitor - MapReduce Pipeline Visualization for Massive Swarms
 *
 * Visualizes the hierarchical synthesis pipeline:
 * - Layer 1 (Grunts): N DeepSeek agents generate raw findings
 * - Layer 2 (Officers): Batch findings into chunks, summarize each
 * - Layer 3 (General): Merge summaries into executive brief
 *
 * Features:
 * - Real-time pipeline stage visualization
 * - Token consumption tracking per layer
 * - Executive summary preview
 * - Drill-down to individual agent outputs
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  Zap,
  Users,
  Star,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface AgentStatus {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  symbol?: string;
  sector?: string;
  tokensUsed?: number;
  latencyMs?: number;
  output?: string;
  reasoning?: string;
  error?: string;
}

interface LayerStatus {
  layer: 'grunt' | 'officer' | 'general';
  name: string;
  icon: React.ReactNode;
  totalAgents: number;
  completedAgents: number;
  failedAgents: number;
  tokensUsed: number;
  status: 'pending' | 'active' | 'completed' | 'failed';
  agents: AgentStatus[];
}

interface HiveProgress {
  id: string;
  topic: string;
  startedAt: string;
  status: 'pending' | 'processing' | 'synthesizing' | 'completed' | 'failed';
  layers: LayerStatus[];
  executiveSummary?: string;
  totalTokens: number;
  estimatedCost: number;
}

interface HiveMonitorProps {
  jobId?: string;
  topic?: string;
  onComplete?: (summary: string) => void;
  onClose?: () => void;
  // Demo mode for testing without live data
  demoMode?: boolean;
  className?: string;
}

// ============================================================================
// Demo Data Generator
// ============================================================================

function generateDemoProgress(phase: number): HiveProgress {
  const gruntCount = 50;
  const officerCount = 5;

  const gruntAgents: AgentStatus[] = Array.from({ length: gruntCount }, (_, i) => ({
    id: `grunt_${i + 1}`,
    symbol: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA'][i % 5],
    sector: ['Technology', 'Financials', 'Healthcare'][i % 3],
    status: phase >= 2
      ? 'completed'
      : i < phase * 10
        ? 'completed'
        : i < phase * 10 + 5
          ? 'processing'
          : 'pending',
    tokensUsed: phase >= 2 ? 450 + Math.floor(Math.random() * 200) : 0,
    latencyMs: phase >= 2 ? 1200 + Math.floor(Math.random() * 800) : 0,
  }));

  const officerAgents: AgentStatus[] = Array.from({ length: officerCount }, (_, i) => ({
    id: `officer_${i + 1}`,
    status: phase >= 3
      ? 'completed'
      : phase === 2 && i < 3
        ? 'completed'
        : phase === 2 && i < 5
          ? 'processing'
          : 'pending',
    tokensUsed: phase >= 3 ? 800 + Math.floor(Math.random() * 400) : 0,
    latencyMs: phase >= 3 ? 2500 + Math.floor(Math.random() * 1000) : 0,
  }));

  const generalAgents: AgentStatus[] = [{
    id: 'general_1',
    status: phase >= 4 ? 'completed' : phase === 3 ? 'processing' : 'pending',
    tokensUsed: phase >= 4 ? 1200 : 0,
    latencyMs: phase >= 4 ? 3500 : 0,
  }];

  const layers: LayerStatus[] = [
    {
      layer: 'grunt',
      name: 'Research Agents',
      icon: <Users className="w-4 h-4" />,
      totalAgents: gruntCount,
      completedAgents: gruntAgents.filter(a => a.status === 'completed').length,
      failedAgents: gruntAgents.filter(a => a.status === 'failed').length,
      tokensUsed: gruntAgents.reduce((sum, a) => sum + (a.tokensUsed || 0), 0),
      status: phase >= 2 ? 'completed' : phase >= 1 ? 'active' : 'pending',
      agents: gruntAgents,
    },
    {
      layer: 'officer',
      name: 'Summary Officers',
      icon: <Star className="w-4 h-4" />,
      totalAgents: officerCount,
      completedAgents: officerAgents.filter(a => a.status === 'completed').length,
      failedAgents: officerAgents.filter(a => a.status === 'failed').length,
      tokensUsed: officerAgents.reduce((sum, a) => sum + (a.tokensUsed || 0), 0),
      status: phase >= 3 ? 'completed' : phase === 2 ? 'active' : 'pending',
      agents: officerAgents,
    },
    {
      layer: 'general',
      name: 'Executive Synthesis',
      icon: <Zap className="w-4 h-4" />,
      totalAgents: 1,
      completedAgents: generalAgents.filter(a => a.status === 'completed').length,
      failedAgents: generalAgents.filter(a => a.status === 'failed').length,
      tokensUsed: generalAgents.reduce((sum, a) => sum + (a.tokensUsed || 0), 0),
      status: phase >= 4 ? 'completed' : phase === 3 ? 'active' : 'pending',
      agents: generalAgents,
    },
  ];

  const totalTokens = layers.reduce((sum, l) => sum + l.tokensUsed, 0);

  return {
    id: 'demo-hive-001',
    topic: 'S&P 500 Global Radar Scan',
    startedAt: new Date().toISOString(),
    status: phase >= 4 ? 'completed' : phase >= 3 ? 'synthesizing' : 'processing',
    layers,
    executiveSummary: phase >= 4 ? `# Executive Brief: S&P 500 Global Radar

## Critical Alert
Technology sector showing elevated fragility scores. NVDA and AMD exhibiting unusual volatility clustering.

## Priority Actions
1. Reduce tech exposure by 15%
2. Increase defensive allocation (XLU, XLP)
3. Monitor VIX for confirmation

## Requires Human Judgment
- Conflicting signals on energy sector
- Rate sensitivity unclear

## Recommendation
**CONDITIONAL GO** - Proceed with hedged positions` : undefined,
    totalTokens,
    estimatedCost: totalTokens * 0.00000168, // DeepSeek pricing
  };
}

// ============================================================================
// Layer Component
// ============================================================================

interface LayerCardProps {
  layer: LayerStatus;
  isExpanded: boolean;
  onToggle: () => void;
  onAgentClick: (agent: AgentStatus) => void;
}

function LayerCard({ layer, isExpanded, onToggle, onAgentClick }: LayerCardProps) {
  const progressPct = layer.totalAgents > 0
    ? Math.round((layer.completedAgents / layer.totalAgents) * 100)
    : 0;

  const statusColors = {
    pending: 'bg-gray-100 dark:bg-gray-800 border-gray-300',
    active: 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700',
    completed: 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700',
    failed: 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700',
  };

  return (
    <Card className={cn('transition-colors', statusColors[layer.status])}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <button
            onClick={onToggle}
            className="flex items-center gap-2 hover:opacity-80"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <div className="flex items-center gap-2">
              {layer.icon}
              <CardTitle className="text-sm font-medium">{layer.name}</CardTitle>
            </div>
          </button>

          <div className="flex items-center gap-2">
            {layer.status === 'active' && (
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            )}
            {layer.status === 'completed' && (
              <CheckCircle className="w-4 h-4 text-green-500" />
            )}
            <Badge variant="outline" className="text-xs">
              {layer.completedAgents}/{layer.totalAgents}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="space-y-2">
          <Progress value={progressPct} className="h-1.5" />

          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{layer.tokensUsed.toLocaleString()} tokens</span>
            <span>${(layer.tokensUsed * 0.00000168).toFixed(4)}</span>
          </div>

          {isExpanded && layer.agents.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <div className="grid grid-cols-10 gap-1">
                {layer.agents.map((agent) => (
                  <TooltipProvider key={agent.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => onAgentClick(agent)}
                          className={cn(
                            'w-3 h-3 rounded-full transition-transform hover:scale-150',
                            agent.status === 'pending' && 'bg-gray-400',
                            agent.status === 'processing' && 'bg-yellow-400 animate-pulse',
                            agent.status === 'completed' && 'bg-green-500',
                            agent.status === 'failed' && 'bg-red-500'
                          )}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        <p className="font-medium">{agent.id}</p>
                        {agent.symbol && <p>{agent.symbol} ({agent.sector})</p>}
                        <p className="text-muted-foreground">{agent.status}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Agent Detail Dialog
// ============================================================================

interface AgentDetailDialogProps {
  agent: AgentStatus | null;
  onClose: () => void;
}

function AgentDetailDialog({ agent, onClose }: AgentDetailDialogProps) {
  if (!agent) return null;

  return (
    <Dialog open={!!agent} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className={cn(
                'w-3 h-3 rounded-full',
                agent.status === 'completed' && 'bg-green-500',
                agent.status === 'failed' && 'bg-red-500',
                agent.status === 'processing' && 'bg-yellow-400 animate-pulse',
                agent.status === 'pending' && 'bg-gray-400'
              )}
            />
            {agent.id}
            {agent.symbol && ` - ${agent.symbol}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            {agent.tokensUsed && (
              <Badge variant="outline">{agent.tokensUsed} tokens</Badge>
            )}
            {agent.latencyMs && (
              <Badge variant="outline">{(agent.latencyMs / 1000).toFixed(1)}s</Badge>
            )}
            {agent.sector && (
              <Badge variant="secondary">{agent.sector}</Badge>
            )}
          </div>

          {agent.output && (
            <div>
              <h4 className="text-sm font-medium mb-2">Output</h4>
              <ScrollArea className="h-48 rounded-md border p-3 bg-muted/30">
                <pre className="text-xs whitespace-pre-wrap font-mono">
                  {agent.output}
                </pre>
              </ScrollArea>
            </div>
          )}

          {agent.reasoning && (
            <div>
              <h4 className="text-sm font-medium mb-2">Reasoning Chain</h4>
              <ScrollArea className="h-32 rounded-md border p-3 bg-blue-50 dark:bg-blue-900/20">
                <pre className="text-xs whitespace-pre-wrap font-mono text-blue-900 dark:text-blue-100">
                  {agent.reasoning}
                </pre>
              </ScrollArea>
            </div>
          )}

          {agent.error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-3 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-800 dark:text-red-200">
                {agent.error}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// HiveMonitor Component
// ============================================================================

export function HiveMonitor({
  jobId,
  topic = 'Swarm Analysis',
  onComplete,
  onClose,
  demoMode = false,
  className,
}: HiveMonitorProps) {
  const [progress, setProgress] = useState<HiveProgress | null>(null);
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set(['grunt']));
  const [selectedAgent, setSelectedAgent] = useState<AgentStatus | null>(null);
  const [demoPhase, setDemoPhase] = useState(0);
  const demoIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Demo mode simulation
  useEffect(() => {
    if (demoMode) {
      setProgress(generateDemoProgress(demoPhase));

      // Auto-advance demo
      if (demoPhase < 4) {
        demoIntervalRef.current = setTimeout(() => {
          setDemoPhase(p => p + 1);
        }, 2000);
      }

      return () => {
        if (demoIntervalRef.current) {
          clearTimeout(demoIntervalRef.current);
        }
      };
    }
  }, [demoMode, demoPhase]);

  // Real data fetching (placeholder - would connect to your backend)
  useEffect(() => {
    if (!demoMode && jobId) {
      // TODO: Connect to real swarm job API
      // const unsubscribe = subscribeToHiveJob(jobId, setProgress);
      // return () => unsubscribe();
    }
  }, [demoMode, jobId]);

  // Handle completion
  useEffect(() => {
    if (progress?.status === 'completed' && progress.executiveSummary && onComplete) {
      onComplete(progress.executiveSummary);
    }
  }, [progress?.status, progress?.executiveSummary, onComplete]);

  const toggleLayer = useCallback((layer: string) => {
    setExpandedLayers(prev => {
      const next = new Set(prev);
      if (next.has(layer)) {
        next.delete(layer);
      } else {
        next.add(layer);
      }
      return next;
    });
  }, []);

  const restartDemo = useCallback(() => {
    setDemoPhase(0);
  }, []);

  if (!progress) {
    return (
      <div className={cn('flex items-center justify-center p-8', className)}>
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Initializing hive...</span>
      </div>
    );
  }

  const overallProgress = progress.layers.reduce(
    (sum, l) => sum + l.completedAgents,
    0
  ) / progress.layers.reduce((sum, l) => sum + l.totalAgents, 0) * 100;

  return (
    <div className={cn('rounded-lg border bg-card p-4 space-y-4', className)}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Hive Mind Pipeline</h3>
            <Badge variant={
              progress.status === 'completed' ? 'default' :
              progress.status === 'failed' ? 'destructive' : 'secondary'
            }>
              {progress.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{progress.topic}</p>
        </div>

        <div className="flex items-center gap-2">
          {demoMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={restartDemo}
              className="h-7"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Reset
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose} className="h-7">
              Close
            </Button>
          )}
        </div>
      </div>

      {/* Overall Progress */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Overall Progress</span>
          <span>{Math.round(overallProgress)}%</span>
        </div>
        <Progress value={overallProgress} className="h-2" />
      </div>

      {/* Cost Summary */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <FileText className="w-3 h-3" />
          <span>{progress.totalTokens.toLocaleString()} total tokens</span>
        </div>
        <div className="flex items-center gap-1">
          <Zap className="w-3 h-3" />
          <span>${progress.estimatedCost.toFixed(4)} est. cost</span>
        </div>
      </div>

      <Separator />

      {/* Pipeline Layers */}
      <div className="space-y-3">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          MapReduce Pipeline
        </h4>

        {progress.layers.map((layer) => (
          <LayerCard
            key={layer.layer}
            layer={layer}
            isExpanded={expandedLayers.has(layer.layer)}
            onToggle={() => toggleLayer(layer.layer)}
            onAgentClick={setSelectedAgent}
          />
        ))}
      </div>

      {/* Executive Summary */}
      {progress.executiveSummary && (
        <>
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-green-500" />
              <h4 className="text-sm font-medium">Executive Summary</h4>
            </div>
            <ScrollArea className="h-48 rounded-md border p-4 bg-green-50 dark:bg-green-900/20">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <pre className="text-xs whitespace-pre-wrap font-mono">
                  {progress.executiveSummary}
                </pre>
              </div>
            </ScrollArea>
          </div>
        </>
      )}

      {/* Agent Detail Dialog */}
      <AgentDetailDialog
        agent={selectedAgent}
        onClose={() => setSelectedAgent(null)}
      />
    </div>
  );
}

export default HiveMonitor;
