/**
 * InteractiveFlowDiagram - Process Flow with Diverge/Merge Points
 *
 * Shows the complete system architecture with:
 * - Clickable nodes
 * - Animated data flow
 * - Diverge/merge visualization
 * - Process status indicators
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  GitBranch,
  GitMerge,
  Play,
  Pause,
  RotateCcw,
  Database,
  Cpu,
  Search,
  Calculator,
  Scale,
  Brain,
  FileText,
  TrendingUp,
  ArrowDown,
  ArrowRight,
  Zap
} from 'lucide-react';

export interface FlowNode {
  id: string;
  label: string;
  description: string;
  type: 'source' | 'process' | 'decision' | 'merge' | 'output';
  icon: React.ComponentType<{ className?: string }>;
  status: 'idle' | 'active' | 'complete';
  position: { x: number; y: number };
  connections: string[]; // IDs of connected nodes
}

export interface FlowEdge {
  from: string;
  to: string;
  type: 'normal' | 'diverge' | 'merge';
  label?: string;
  animated?: boolean;
}

interface InteractiveFlowDiagramProps {
  nodes?: FlowNode[];
  edges?: FlowEdge[];
  onNodeClick?: (nodeId: string) => void;
  className?: string;
}

// Default flow diagram data
const DEFAULT_NODES: FlowNode[] = [
  { id: 'raw_data', label: 'Raw Data', description: 'Options chains & OHLCV', type: 'source', icon: Database, status: 'complete', position: { x: 50, y: 5 }, connections: ['features'] },
  { id: 'features', label: 'Feature Engine', description: 'Physics feature extraction', type: 'process', icon: Cpu, status: 'complete', position: { x: 50, y: 15 }, connections: ['diverge_1'] },
  { id: 'diverge_1', label: 'Parallel Analysis', description: 'Split into specialized swarms', type: 'decision', icon: GitBranch, status: 'active', position: { x: 50, y: 25 }, connections: ['scout', 'math', 'jury'] },
  { id: 'scout', label: 'Scout Swarm', description: 'Feature selection', type: 'process', icon: Search, status: 'complete', position: { x: 20, y: 40 }, connections: ['merge_1'] },
  { id: 'math', label: 'Math Swarm', description: 'Equation discovery', type: 'process', icon: Calculator, status: 'active', position: { x: 50, y: 40 }, connections: ['merge_1'] },
  { id: 'jury', label: 'Jury Swarm', description: 'Regime classification', type: 'process', icon: Scale, status: 'idle', position: { x: 80, y: 40 }, connections: ['merge_1'] },
  { id: 'merge_1', label: 'Synthesis', description: 'Combine swarm results', type: 'merge', icon: GitMerge, status: 'idle', position: { x: 50, y: 55 }, connections: ['ai_native'] },
  { id: 'ai_native', label: 'AI-Native', description: 'Observer synthesis', type: 'process', icon: Brain, status: 'idle', position: { x: 50, y: 65 }, connections: ['diverge_2'] },
  { id: 'diverge_2', label: 'Strategy Split', description: 'Multiple strategy paths', type: 'decision', icon: GitBranch, status: 'idle', position: { x: 50, y: 75 }, connections: ['backtest', 'factor'] },
  { id: 'backtest', label: 'Backtest', description: 'Historical validation', type: 'process', icon: TrendingUp, status: 'idle', position: { x: 30, y: 85 }, connections: ['playbook'] },
  { id: 'factor', label: 'Factor Engine', description: 'Factor computation', type: 'process', icon: Zap, status: 'idle', position: { x: 70, y: 85 }, connections: ['playbook'] },
  { id: 'playbook', label: 'Playbook', description: 'Trading rules', type: 'output', icon: FileText, status: 'idle', position: { x: 50, y: 95 }, connections: [] },
];

const DEFAULT_EDGES: FlowEdge[] = [
  { from: 'raw_data', to: 'features', type: 'normal', animated: true },
  { from: 'features', to: 'diverge_1', type: 'normal', animated: true },
  { from: 'diverge_1', to: 'scout', type: 'diverge', label: 'Scout', animated: true },
  { from: 'diverge_1', to: 'math', type: 'diverge', label: 'Math', animated: true },
  { from: 'diverge_1', to: 'jury', type: 'diverge', label: 'Jury' },
  { from: 'scout', to: 'merge_1', type: 'merge' },
  { from: 'math', to: 'merge_1', type: 'merge', animated: true },
  { from: 'jury', to: 'merge_1', type: 'merge' },
  { from: 'merge_1', to: 'ai_native', type: 'normal' },
  { from: 'ai_native', to: 'diverge_2', type: 'normal' },
  { from: 'diverge_2', to: 'backtest', type: 'diverge', label: 'Validate' },
  { from: 'diverge_2', to: 'factor', type: 'diverge', label: 'Compute' },
  { from: 'backtest', to: 'playbook', type: 'merge' },
  { from: 'factor', to: 'playbook', type: 'merge' },
];

const nodeTypeStyles = {
  source: 'bg-blue-500/20 border-blue-500/50 text-blue-400',
  process: 'bg-purple-500/20 border-purple-500/50 text-purple-400',
  decision: 'bg-amber-500/20 border-amber-500/50 text-amber-400',
  merge: 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400',
  output: 'bg-green-500/20 border-green-500/50 text-green-400'
};

const statusIndicators = {
  idle: 'bg-gray-500',
  active: 'bg-blue-500 animate-pulse',
  complete: 'bg-green-500'
};

export function InteractiveFlowDiagram({
  nodes = DEFAULT_NODES,
  edges = DEFAULT_EDGES,
  onNodeClick,
  className
}: InteractiveFlowDiagramProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [animationOffset, setAnimationOffset] = useState(0);

  // Animate flow
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setAnimationOffset(o => (o + 1) % 100);
    }, 50);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Calculate path between two nodes (coordinates are 0-100 to match viewBox)
  const getPath = (from: FlowNode, to: FlowNode): string => {
    const x1 = from.position.x;
    const y1 = from.position.y + 3; // Offset from bottom of node
    const x2 = to.position.x;
    const y2 = to.position.y - 1; // Offset to top of node

    // Simple curved path
    const midY = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  };

  const nodeById = nodes.reduce((acc, n) => ({ ...acc, [n.id]: n }), {} as Record<string, FlowNode>);

  return (
    <Card className={cn("bg-card/50 backdrop-blur flex flex-col", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-primary" />
            System Flow
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setIsPlaying(!isPlaying)}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setAnimationOffset(0)}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-2 flex-1 flex flex-col min-h-0">
        <div className="relative flex-1 min-h-[200px] bg-muted/10 rounded-lg overflow-hidden">
          {/* SVG for edges */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
            <defs>
              {/* Animated gradient for active edges */}
              <linearGradient id="flowGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset={`${animationOffset}%`} stopColor="rgb(59, 130, 246)" stopOpacity="0" />
                <stop offset={`${(animationOffset + 20) % 100}%`} stopColor="rgb(59, 130, 246)" stopOpacity="1" />
                <stop offset={`${(animationOffset + 40) % 100}%`} stopColor="rgb(59, 130, 246)" stopOpacity="0" />
              </linearGradient>

              {/* Arrow marker - small and subtle */}
              <marker id="arrowhead" markerWidth="4" markerHeight="3" refX="3" refY="1.5" orient="auto">
                <polygon points="0 0, 4 1.5, 0 3" fill="currentColor" className="text-muted-foreground/50" />
              </marker>
            </defs>

            {/* Draw edges */}
            {edges.map((edge, i) => {
              const from = nodeById[edge.from];
              const to = nodeById[edge.to];
              if (!from || !to) return null;

              const path = getPath(from, to);
              const isAnimated = edge.animated && isPlaying;

              return (
                <g key={`${edge.from}-${edge.to}-${i}`}>
                  {/* Edge path */}
                  <path
                    d={path}
                    fill="none"
                    stroke={isAnimated ? "url(#flowGradient)" : "currentColor"}
                    strokeWidth="0.8"
                    className={cn(
                      "transition-all duration-300",
                      isAnimated ? "" : "text-muted-foreground/20"
                    )}
                    markerEnd="url(#arrowhead)"
                  />

                  {/* Edge label - using SVG units, not CSS */}
                  {edge.label && (
                    <text
                      x={(from.position.x + to.position.x) / 2}
                      y={(from.position.y + to.position.y) / 2 + 1}
                      textAnchor="middle"
                      fontSize="2.5"
                      fill="currentColor"
                      className="text-muted-foreground"
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Nodes */}
          {nodes.map(node => {
            const Icon = node.icon;
            const isHovered = hoveredNode === node.id;

            return (
              <div
                key={node.id}
                className={cn(
                  "absolute transform -translate-x-1/2 -translate-y-1/2",
                  "cursor-pointer transition-all duration-200",
                  isHovered && "z-10 scale-110"
                )}
                style={{
                  left: `${node.position.x}%`,
                  top: `${node.position.y}%`
                }}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => onNodeClick?.(node.id)}
              >
                {/* Node container */}
                <div className={cn(
                  "relative flex flex-col items-center p-2 rounded-lg border-2 min-w-[60px]",
                  nodeTypeStyles[node.type],
                  isHovered && "shadow-lg"
                )}>
                  {/* Status indicator */}
                  <div className={cn(
                    "absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full",
                    statusIndicators[node.status]
                  )} />

                  {/* Icon */}
                  <Icon className="h-5 w-5 mb-1" />

                  {/* Label */}
                  <span className="text-[10px] font-medium whitespace-nowrap">
                    {node.label}
                  </span>

                  {/* Decision node indicator */}
                  {node.type === 'decision' && (
                    <GitBranch className="absolute -bottom-1 h-3 w-3 text-amber-400" />
                  )}

                  {/* Merge node indicator */}
                  {node.type === 'merge' && (
                    <GitMerge className="absolute -bottom-1 h-3 w-3 text-cyan-400" />
                  )}
                </div>

                {/* Hover tooltip */}
                {isHovered && (
                  <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-20 w-40 p-2 rounded-lg bg-popover border shadow-xl text-center">
                    <p className="text-xs font-medium mb-1">{node.label}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {node.description}
                    </p>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[8px] mt-1",
                        node.status === 'active' && "border-blue-500 text-blue-400",
                        node.status === 'complete' && "border-green-500 text-green-400"
                      )}
                    >
                      {node.status.toUpperCase()}
                    </Badge>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t text-[10px]">
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 rounded border-2 bg-blue-500/20 border-blue-500/50" />
            <span className="text-muted-foreground">Source</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 rounded border-2 bg-purple-500/20 border-purple-500/50" />
            <span className="text-muted-foreground">Process</span>
          </div>
          <div className="flex items-center gap-1">
            <GitBranch className="h-3 w-3 text-amber-400" />
            <span className="text-muted-foreground">Diverge</span>
          </div>
          <div className="flex items-center gap-1">
            <GitMerge className="h-3 w-3 text-cyan-400" />
            <span className="text-muted-foreground">Merge</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 rounded border-2 bg-green-500/20 border-green-500/50" />
            <span className="text-muted-foreground">Output</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default InteractiveFlowDiagram;
