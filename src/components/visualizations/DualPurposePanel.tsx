/**
 * Dual Purpose Panel - Dynamic visualization based on context
 * Shows different components based on VisualizationContext state
 * 
 * NO MOCK DATA - Connects to Python API and Supabase
 */

import { useState, useEffect, useCallback } from 'react';
import { useResearchDisplay } from '@/contexts/ResearchDisplayContext';
import { useVisualizationContext, VisualizationView } from '@/contexts/VisualizationContext';
import { ArtifactDisplay } from './ArtifactDisplay';
import { SystemIntegrityHUD } from '@/components/dashboard/SystemIntegrityHUD';
import { MissionControl } from '@/components/dashboard/MissionControl';
import { SwarmHiveMonitor } from '@/components/swarm/SwarmHiveMonitor';
import { GraduationTracker } from '@/components/dashboard/GraduationTracker';
import { BacktestRunner } from '@/components/dashboard/BacktestRunner';
import { SystemIntegrity } from '@/components/dashboard/SystemIntegrity';
import { FindingsPanel } from '@/components/research/FindingsPanel';
import { CIOInsightPanel } from '@/components/insight';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Target, Bug, TrendingUp, Play, Shield, Star, ExternalLink, Eye } from 'lucide-react';

// Tab configuration for pop-out
const TAB_CONFIG: Record<VisualizationView, { id: string; title: string; icon: typeof Star }> = {
  default: { id: 'findings', title: 'Findings', icon: Star },
  mission: { id: 'mission-control', title: 'Mission Control', icon: Target },
  swarm: { id: 'swarm-monitor', title: 'Swarm Monitor', icon: Bug },
  graduation: { id: 'graduation-pipeline', title: 'Graduation Pipeline', icon: TrendingUp },
  backtest: { id: 'backtest-runner', title: 'Backtest Runner', icon: Play },
  integrity: { id: 'system-integrity', title: 'System Integrity', icon: Shield },
  insight: { id: 'cio-insight', title: 'CIO Insight', icon: Eye },
};

export const DualPurposePanel = () => {
  const { currentArtifact, clearArtifact } = useResearchDisplay();
  const { currentView, setView } = useVisualizationContext();
  const [displayMode, setDisplayMode] = useState<'visualization' | 'artifact'>('visualization');
  const [autoReturnTimer, setAutoReturnTimer] = useState<NodeJS.Timeout | null>(null);

  // Manage artifact mode transitions
  useEffect(() => {
    if (currentArtifact) {
      setDisplayMode('artifact');
      
      // Set 30s auto-return timer
      if (autoReturnTimer) clearTimeout(autoReturnTimer);
      const timer = setTimeout(() => {
        setDisplayMode('visualization');
        clearArtifact();
      }, 30000);
      setAutoReturnTimer(timer);
    } else {
      setDisplayMode('visualization');
      if (autoReturnTimer) {
        clearTimeout(autoReturnTimer);
        setAutoReturnTimer(null);
      }
    }

    return () => {
      if (autoReturnTimer) clearTimeout(autoReturnTimer);
    };
  }, [currentArtifact, clearArtifact, autoReturnTimer]);

  const handleArtifactClose = () => {
    if (autoReturnTimer) clearTimeout(autoReturnTimer);
    setDisplayMode('visualization');
    clearArtifact();
  };

  // Artifact mode
  if (displayMode === 'artifact' && currentArtifact) {
    return (
      <div className="h-full flex flex-col">
        <SystemIntegrityHUD />
        <div className={cn(
          "flex-1 transition-opacity duration-300",
          displayMode === 'artifact' ? 'opacity-100' : 'opacity-0'
        )}>
          <ArtifactDisplay artifact={currentArtifact} onClose={handleArtifactClose} />
        </div>
      </div>
    );
  }

  // Visualization mode with context-aware switching
  const handlePopout = useCallback((view: VisualizationView) => {
    const config = TAB_CONFIG[view];
    window.electron?.popoutCreate?.({
      id: config.id,
      title: config.title,
      visualizationType: view,
      data: {},
    });
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* System Integrity HUD - Always visible */}
      <SystemIntegrityHUD />

      {/* View Tabs */}
      <Tabs 
        value={currentView} 
        onValueChange={(v) => setView(v as VisualizationView)}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="flex items-center gap-1 mx-2 mt-2">
          <TabsList className="grid flex-1 grid-cols-7 h-9 shrink-0">
            <TabsTrigger value="insight" className="text-xs gap-1">
              <Eye className="h-3 w-3" />
              <span className="hidden sm:inline">Insight</span>
            </TabsTrigger>
            <TabsTrigger value="default" className="text-xs gap-1">
              <Star className="h-3 w-3" />
              <span className="hidden sm:inline">Findings</span>
            </TabsTrigger>
            <TabsTrigger value="mission" className="text-xs gap-1">
              <Target className="h-3 w-3" />
              <span className="hidden sm:inline">Mission</span>
            </TabsTrigger>
            <TabsTrigger value="swarm" className="text-xs gap-1">
              <Bug className="h-3 w-3" />
              <span className="hidden sm:inline">Swarm</span>
            </TabsTrigger>
            <TabsTrigger value="graduation" className="text-xs gap-1">
              <TrendingUp className="h-3 w-3" />
              <span className="hidden sm:inline">Pipeline</span>
            </TabsTrigger>
            <TabsTrigger value="backtest" className="text-xs gap-1">
              <Play className="h-3 w-3" />
              <span className="hidden sm:inline">Backtest</span>
            </TabsTrigger>
            <TabsTrigger value="integrity" className="text-xs gap-1">
              <Shield className="h-3 w-3" />
              <span className="hidden sm:inline">Integrity</span>
            </TabsTrigger>
          </TabsList>
          
          {/* Pop-out button for current tab */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => handlePopout(currentView)}
            title={`Pop out ${TAB_CONFIG[currentView].title}`}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-2 min-h-0">
          <TabsContent value="insight" className="h-full mt-0 data-[state=active]:flex data-[state=active]:flex-col">
            <CIOInsightPanel />
          </TabsContent>

          <TabsContent value="default" className="h-full mt-0 data-[state=active]:flex data-[state=active]:flex-col">
            <FindingsPanel />
          </TabsContent>

          <TabsContent value="mission" className="h-full mt-0">
            <MissionControl />
          </TabsContent>

          <TabsContent value="swarm" className="h-full mt-0">
            <SwarmHiveMonitor />
          </TabsContent>

          <TabsContent value="graduation" className="h-full mt-0">
            <GraduationTracker />
          </TabsContent>

          <TabsContent value="backtest" className="h-full mt-0">
            <BacktestRunner />
          </TabsContent>

          <TabsContent value="integrity" className="h-full mt-0">
            <SystemIntegrity />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};
