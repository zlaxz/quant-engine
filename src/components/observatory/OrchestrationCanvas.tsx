/**
 * OrchestrationCanvas - The Conductor's Dynamic Canvas
 *
 * A dynamic panel system where I (Claude/the engine) can:
 * - Add panels with narration
 * - Remove panels when no longer relevant
 * - Emphasize panels to draw attention
 * - Arrange panels in layouts
 * - Connect panels to show relationships
 *
 * This is the core of the "information symphony" approach.
 */

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Maximize2, Minimize2, Link2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { GenericChart } from '@/components/charts/GenericChart';
import type { ChartData } from '@/components/charts/types';

// ============================================================================
// Types
// ============================================================================

export type PanelEmphasis = 'normal' | 'highlight' | 'dim' | 'pulse';
export type PanelSize = 'small' | 'medium' | 'large' | 'full';

export interface OrchestratedPanel {
  id: string;
  title: string;
  narration?: string; // The explanation/story for this panel
  type: 'chart' | 'message' | 'metric' | 'explanation' | 'connection';
  data?: ChartData | Record<string, unknown>;
  emphasis: PanelEmphasis;
  size: PanelSize;
  order: number;
  connectedTo?: string[]; // IDs of related panels
  timestamp: Date;
  persistent?: boolean; // If true, stays until explicitly removed
}

export interface NarrationMessage {
  id: string;
  text: string;
  type: 'reveal' | 'explanation' | 'question' | 'conclusion' | 'warning';
  relatedPanelId?: string;
  timestamp: Date;
}

interface OrchestrationState {
  panels: Map<string, OrchestratedPanel>;
  narration: NarrationMessage[];
  activeConnections: Array<{ from: string; to: string; label?: string }>;
}

// ============================================================================
// Orchestration Hook - Controls the canvas
// ============================================================================

export function useOrchestration() {
  const [state, setState] = useState<OrchestrationState>({
    panels: new Map(),
    narration: [],
    activeConnections: [],
  });

  // Add a new panel with optional narration
  const addPanel = useCallback((panel: Omit<OrchestratedPanel, 'timestamp' | 'order'>, narration?: string) => {
    setState(prev => {
      const newPanels = new Map(prev.panels);
      const order = newPanels.size;

      newPanels.set(panel.id, {
        ...panel,
        timestamp: new Date(),
        order,
      });

      const newNarration = narration
        ? [...prev.narration, {
            id: `narr_${Date.now()}`,
            text: narration,
            type: 'reveal' as const,
            relatedPanelId: panel.id,
            timestamp: new Date(),
          }]
        : prev.narration;

      return {
        ...prev,
        panels: newPanels,
        narration: newNarration.slice(-10), // Keep last 10 narrations
      };
    });
  }, []);

  // Remove a panel
  const removePanel = useCallback((id: string) => {
    setState(prev => {
      const newPanels = new Map(prev.panels);
      newPanels.delete(id);
      return { ...prev, panels: newPanels };
    });
  }, []);

  // Clear all non-persistent panels
  const clearTransient = useCallback(() => {
    setState(prev => {
      const newPanels = new Map(prev.panels);
      for (const [id, panel] of newPanels) {
        if (!panel.persistent) {
          newPanels.delete(id);
        }
      }
      return { ...prev, panels: newPanels };
    });
  }, []);

  // Emphasize a panel (draw attention)
  const emphasize = useCallback((id: string, emphasis: PanelEmphasis) => {
    setState(prev => {
      const newPanels = new Map(prev.panels);
      const panel = newPanels.get(id);
      if (panel) {
        newPanels.set(id, { ...panel, emphasis });
      }
      return { ...prev, panels: newPanels };
    });
  }, []);

  // Add narration without a panel
  const narrate = useCallback((text: string, type: NarrationMessage['type'] = 'explanation') => {
    setState(prev => ({
      ...prev,
      narration: [...prev.narration, {
        id: `narr_${Date.now()}`,
        text,
        type,
        timestamp: new Date(),
      }].slice(-10),
    }));
  }, []);

  // Connect two panels visually
  const connect = useCallback((fromId: string, toId: string, label?: string) => {
    setState(prev => ({
      ...prev,
      activeConnections: [...prev.activeConnections, { from: fromId, to: toId, label }],
    }));
  }, []);

  // Disconnect panels
  const disconnect = useCallback((fromId: string, toId: string) => {
    setState(prev => ({
      ...prev,
      activeConnections: prev.activeConnections.filter(
        c => !(c.from === fromId && c.to === toId)
      ),
    }));
  }, []);

  // Resize a panel
  const resize = useCallback((id: string, size: PanelSize) => {
    setState(prev => {
      const newPanels = new Map(prev.panels);
      const panel = newPanels.get(id);
      if (panel) {
        newPanels.set(id, { ...panel, size });
      }
      return { ...prev, panels: newPanels };
    });
  }, []);

  return {
    state,
    addPanel,
    removePanel,
    clearTransient,
    emphasize,
    narrate,
    connect,
    disconnect,
    resize,
  };
}

// ============================================================================
// Panel Component
// ============================================================================

interface PanelProps {
  panel: OrchestratedPanel;
  onRemove: () => void;
  onResize: (size: PanelSize) => void;
}

function Panel({ panel, onRemove, onResize }: PanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const sizeClasses: Record<PanelSize, string> = {
    small: 'col-span-1',
    medium: 'col-span-2',
    large: 'col-span-3',
    full: 'col-span-full',
  };

  const emphasisClasses: Record<PanelEmphasis, string> = {
    normal: 'border-border',
    highlight: 'border-cyan-500 shadow-lg shadow-cyan-500/20',
    dim: 'opacity-50',
    pulse: 'border-amber-500 animate-pulse',
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: -20 }}
      transition={{ duration: 0.3 }}
      className={cn(sizeClasses[panel.size], isExpanded && 'col-span-full')}
    >
      <Card className={cn(
        'h-full transition-all duration-300',
        emphasisClasses[panel.emphasis]
      )}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-sm font-medium">{panel.title}</CardTitle>
            {panel.narration && (
              <CardDescription className="text-xs mt-1 text-cyan-400">
                {panel.narration}
              </CardDescription>
            )}
          </div>
          <div className="flex items-center gap-1">
            {panel.connectedTo && panel.connectedTo.length > 0 && (
              <Badge variant="outline" className="text-[10px]">
                <Link2 className="h-3 w-3 mr-1" />
                {panel.connectedTo.length}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? (
                <Minimize2 className="h-3 w-3" />
              ) : (
                <Maximize2 className="h-3 w-3" />
              )}
            </Button>
            {!panel.persistent && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={onRemove}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {panel.type === 'chart' && panel.data && (
            <div className={cn('transition-all', isExpanded ? 'h-[500px]' : 'h-[250px]')}>
              <GenericChart data={panel.data as ChartData} />
            </div>
          )}
          {panel.type === 'message' && (
            <div className="text-sm text-muted-foreground">
              {String(panel.data?.message || '')}
            </div>
          )}
          {panel.type === 'metric' && panel.data && (
            <MetricDisplay data={panel.data as Record<string, unknown>} />
          )}
          {panel.type === 'explanation' && (
            <ExplanationDisplay data={panel.data as Record<string, unknown>} />
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ============================================================================
// Metric Display
// ============================================================================

function MetricDisplay({ data }: { data: Record<string, unknown> }) {
  const value = data.value as string | number;
  const label = data.label as string;
  const change = data.change as number | undefined;
  const changeLabel = data.changeLabel as string | undefined;

  return (
    <div className="flex flex-col items-center justify-center py-4">
      <div className="text-4xl font-bold">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
      {change !== undefined && (
        <div className={cn(
          'text-sm mt-2',
          change >= 0 ? 'text-green-500' : 'text-red-500'
        )}>
          {change >= 0 ? '+' : ''}{change}% {changeLabel || ''}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Explanation Display
// ============================================================================

function ExplanationDisplay({ data }: { data: Record<string, unknown> }) {
  const title = data.title as string;
  const points = data.points as string[] | undefined;
  const conclusion = data.conclusion as string | undefined;

  return (
    <div className="space-y-3">
      {title && <div className="font-medium">{title}</div>}
      {points && (
        <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
          {points.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>
      )}
      {conclusion && (
        <div className="text-sm font-medium text-cyan-400 mt-2 pt-2 border-t border-border">
          {conclusion}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Narration Feed
// ============================================================================

function NarrationFeed({ messages }: { messages: NarrationMessage[] }) {
  const typeColors: Record<NarrationMessage['type'], string> = {
    reveal: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300',
    explanation: 'bg-blue-500/10 border-blue-500/30 text-blue-300',
    question: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
    conclusion: 'bg-green-500/10 border-green-500/30 text-green-300',
    warning: 'bg-red-500/10 border-red-500/30 text-red-300',
  };

  if (messages.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      <AnimatePresence>
        {messages.slice(-3).map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className={cn(
              'p-3 rounded-lg border text-sm',
              typeColors[msg.type]
            )}
          >
            {msg.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Main Canvas Component
// ============================================================================

interface OrchestrationCanvasProps {
  orchestration: ReturnType<typeof useOrchestration>;
  className?: string;
}

export function OrchestrationCanvas({ orchestration, className }: OrchestrationCanvasProps) {
  const { state, removePanel, resize } = orchestration;
  const panels = Array.from(state.panels.values()).sort((a, b) => a.order - b.order);

  return (
    <div className={cn('space-y-4', className)}>
      {/* Narration Feed */}
      <NarrationFeed messages={state.narration} />

      {/* Dynamic Panel Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <AnimatePresence>
          {panels.map((panel) => (
            <Panel
              key={panel.id}
              panel={panel}
              onRemove={() => removePanel(panel.id)}
              onResize={(size) => resize(panel.id, size)}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Empty State */}
      {panels.length === 0 && (
        <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
          <div className="text-lg mb-2">Awaiting orchestration...</div>
          <div className="text-sm">Run an analysis to see visualizations appear here</div>
        </div>
      )}
    </div>
  );
}

export default OrchestrationCanvas;
