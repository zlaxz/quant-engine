/**
 * Observatory - The Market Physics Control Room
 *
 * A dynamic, orchestrated view of market physics where visualizations
 * are added, removed, and emphasized by the engine in real-time.
 *
 * This is NOT a static dashboard. It's a canvas where I narrate
 * what's happening and why.
 */

import { useEffect, useCallback } from 'react';
import { Activity, Eye, Zap, BarChart3, RefreshCw, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { AppHeader } from '@/components/layout';

import {
  OrchestrationCanvas,
  useOrchestration,
} from '@/components/observatory/OrchestrationCanvas';
import { StaticFoundation } from '@/components/observatory/StaticFoundation';
import { JournalView } from '@/components/observatory/JournalView';
import { MissionControl } from '@/components/observatory/MissionControl';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';

// ============================================================================
// Main Component
// ============================================================================

export default function Observatory() {
  const orchestration = useOrchestration();
  const jarvis = useJarvisEvents();

  // Demo: Add some panels when JARVIS events arrive
  useEffect(() => {
    if (jarvis.lastEvent?.activityType === 'discovery') {
      const data = jarvis.lastEvent.data || {};

      // Add a discovery panel
      orchestration.addPanel(
        {
          id: `discovery_${Date.now()}`,
          title: String(data.title || 'Discovery'),
          type: 'explanation',
          data: {
            title: String(data.finding || 'New pattern found'),
            points: data.evidence as string[] || [],
            conclusion: String(data.significance || ''),
          },
          emphasis: 'highlight',
          size: 'medium',
        },
        "Let me show you what I found..."
      );
    }

    if (jarvis.lastEvent?.activityType === 'backtest') {
      const data = jarvis.lastEvent.data || {};

      // Add backtest result panel
      if (data.complete) {
        orchestration.addPanel(
          {
            id: `backtest_${Date.now()}`,
            title: 'Backtest Complete',
            type: 'chart',
            data: data.chart,
            emphasis: 'highlight',
            size: 'large',
          },
          "Here's how the strategy performed..."
        );
      }
    }
  }, [jarvis.lastEvent, orchestration]);

  // Demo mode - show what orchestration can do
  const runDemo = useCallback(() => {
    // Clear existing panels
    orchestration.clearTransient();

    // Narrate the start
    orchestration.narrate("Let me walk you through today's market physics...", 'reveal');

    // Add panels progressively
    setTimeout(() => {
      orchestration.addPanel(
        {
          id: 'regime_current',
          title: 'Current Regime',
          type: 'metric',
          data: {
            value: 'TRENDING',
            label: 'Market State',
            change: 12,
            changeLabel: 'confidence',
          },
          emphasis: 'normal',
          size: 'small',
          persistent: true,
        },
        "First, let's see where we are..."
      );
    }, 500);

    setTimeout(() => {
      orchestration.addPanel(
        {
          id: 'gamma_exposure',
          title: 'Dealer Gamma',
          type: 'chart',
          data: {
            type: 'bar',
            title: 'Gamma Exposure by Strike',
            data: {
              categories: ['580', '585', '590', '595', '600', '605', '610'],
              series: [{
                name: 'Gamma ($B)',
                values: [-1.2, -0.8, -0.3, 2.1, 3.5, 1.8, 0.5],
                color: '#22c55e',
              }],
            },
          },
          emphasis: 'highlight',
          size: 'medium',
        },
        "Look at the gamma profile - dealers are long above 595..."
      );
    }, 1500);

    setTimeout(() => {
      orchestration.narrate(
        "This means dealers will BUY dips above 595. The market has a floor here.",
        'explanation'
      );
    }, 2500);

    setTimeout(() => {
      orchestration.addPanel(
        {
          id: 'entropy_current',
          title: 'Predictability',
          type: 'metric',
          data: {
            value: '72%',
            label: 'Market Clarity',
            change: 8,
            changeLabel: 'vs yesterday',
          },
          emphasis: 'normal',
          size: 'small',
        },
        "Entropy is low - strategies should work well today..."
      );
    }, 3500);

    setTimeout(() => {
      orchestration.addPanel(
        {
          id: 'force_decomposition',
          title: 'Force Breakdown',
          type: 'chart',
          data: {
            type: 'bar',
            title: 'What\'s Pushing Price',
            data: {
              categories: ['Gamma', 'Flow', 'Volatility', 'Correlation'],
              series: [{
                name: 'Force',
                values: [2.3, 1.1, -0.5, 0.8],
              }],
              orientation: 'horizontal',
            },
          },
          emphasis: 'pulse',
          size: 'medium',
          connectedTo: ['gamma_exposure'],
        },
        "Here's the net force picture..."
      );
    }, 4500);

    setTimeout(() => {
      orchestration.narrate(
        "CONCLUSION: Gamma is dominant. Long bias above 595. Consider buying dips.",
        'conclusion'
      );
    }, 5500);

  }, [orchestration]);

  // Header actions
  const headerActions = (
    <div className="flex items-center gap-3">
      {/* Connection status */}
      <div className="flex items-center gap-2">
        <div className={cn(
          'w-2 h-2 rounded-full',
          jarvis.isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-500'
        )} />
        <span className="text-xs text-muted-foreground">
          {jarvis.isConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      {/* Activity indicator */}
      {jarvis.isActive && (
        <Badge variant="outline" className="text-[10px]">
          <Activity className="h-3 w-3 mr-1 animate-pulse" />
          {jarvis.activityLabel}
        </Badge>
      )}

      {/* Demo button */}
      <Button
        variant="outline"
        size="sm"
        onClick={runDemo}
        className="h-7 px-2 text-xs"
      >
        <Zap className="w-3 h-3 mr-1" />
        Run Demo
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        title="Observatory"
        subtitle="Market Physics Control Room"
        actions={headerActions}
      />

      {/* Main Content */}
      <main className="p-6 space-y-4">
        {/* Mission Control - Always visible focus anchor */}
        <MissionControl />

        <Tabs defaultValue="orchestrated" className="space-y-4">
          <TabsList>
            <TabsTrigger value="orchestrated" className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Orchestrated
            </TabsTrigger>
            <TabsTrigger value="static" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Foundation
            </TabsTrigger>
            <TabsTrigger value="journal" className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Journal
            </TabsTrigger>
          </TabsList>

          {/* Orchestrated View - Dynamic canvas */}
          <TabsContent value="orchestrated" className="space-y-4">
            <OrchestrationCanvas orchestration={orchestration} />
          </TabsContent>

          {/* Static View - Always-visible panels */}
          <TabsContent value="static" className="space-y-4">
            <StaticFoundation jarvisState={jarvis} />
          </TabsContent>

          {/* Journal View - Persistent record of activity */}
          <TabsContent value="journal" className="space-y-4">
            <JournalView />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
