/**
 * Dual Purpose Panel - Dynamic visualization based on context
 * Shows different components based on VisualizationContext state
 * 
 * NO MOCK DATA - Connects to Python API and Supabase
 */

import { useState, useEffect } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Target, Bug, TrendingUp, Play, Shield, Star } from 'lucide-react';

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
        <TabsList className="grid w-full grid-cols-6 h-9 mx-2 mt-2 shrink-0" style={{ width: 'calc(100% - 16px)' }}>
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

        <div className="flex-1 overflow-auto p-2 min-h-0">
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
