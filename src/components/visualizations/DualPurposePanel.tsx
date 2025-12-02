/**
 * Dual Purpose Panel - Displays visualizations (primary) and artifacts (secondary)
 * Automatically transitions between modes based on CIO directives
 */

import { useState, useEffect } from 'react';
import { useResearchDisplay } from '@/contexts/ResearchDisplayContext';
import { ArtifactDisplay } from './ArtifactDisplay';
import { RegimeTimeline } from './RegimeTimeline';
import { RegimeDistribution } from './RegimeDistribution';
import { DataCoverage } from './DataCoverage';
import { DiscoveryMatrix } from './DiscoveryMatrix';
import { DiscoveryFunnel } from './DiscoveryFunnel';
import { ScenarioSimulator } from './ScenarioSimulator';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getStageVisualizationConfig } from '@/lib/stageVisualizationMapper';
import {
  generateRegimeHeatmap,
  generateStrategyCards,
  generateDiscoveryMatrix,
  generateScenarioSimulation,
} from '@/lib/mockData';

export const DualPurposePanel = () => {
  const { state, currentArtifact, clearArtifact, showVisualization } = useResearchDisplay();
  const [displayMode, setDisplayMode] = useState<'visualization' | 'artifact'>('visualization');
  const [autoReturnTimer, setAutoReturnTimer] = useState<NodeJS.Timeout | null>(null);

  // Phase 4: Auto-show stage-appropriate visualizations when stage changes
  useEffect(() => {
    const config = getStageVisualizationConfig(state.currentStage);
    
    // Auto-show default visualizations for current stage (only if no visualizations active)
    if (config.defaultVisualizations.length > 0 && state.activeVisualizations.length === 0) {
      config.defaultVisualizations.forEach(viz => {
        showVisualization(viz);
      });
    }
  }, [state.currentStage, state.activeVisualizations.length, showVisualization]);

  // Manage mode transitions
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
  }, [currentArtifact]);

  const handleArtifactClose = () => {
    if (autoReturnTimer) clearTimeout(autoReturnTimer);
    setDisplayMode('visualization');
    clearArtifact();
  };

  // Artifact mode
  if (displayMode === 'artifact' && currentArtifact) {
    return (
      <div className={cn(
        "h-full transition-opacity duration-300",
        displayMode === 'artifact' ? 'opacity-100' : 'opacity-0'
      )}>
        <ArtifactDisplay artifact={currentArtifact} onClose={handleArtifactClose} />
      </div>
    );
  }

  // Visualization mode (primary)
  return (
    <div className={cn(
      "h-full transition-opacity duration-300",
      displayMode === 'visualization' ? 'opacity-100' : 'opacity-0'
    )}>
      {state.activeVisualizations.length > 0 ? (
        <div className="h-full overflow-auto p-4 space-y-4">
          {state.activeVisualizations.map((viz) => (
            <div key={viz}>
              {renderVisualization(viz)}
            </div>
          ))}
        </div>
      ) : (
        <StageEmptyState stage={state.currentStage} />
      )}
    </div>
  );
};

function renderVisualization(type: string) {
  // Generate mock data for visualizations
  const regimeData = generateRegimeHeatmap('2023-01-01', '2023-12-31');
  const strategyCards = generateStrategyCards();
  const discoveryMatrix = generateDiscoveryMatrix();
  
  // Transform API contract data to match existing component interfaces
  const regimeDataTransformed = regimeData.data.map(d => ({
    date: d.date,
    regime: d.regime_key, // Map regime_key → regime
    confidence: d.confidence,
    metrics: d.metrics,
  }));

  // Generate mock coverage data for DataCoverage component
  const mockCoverage = ['SPY', 'QQQ', 'IWM'].flatMap(symbol =>
    regimeData.data.slice(0, 30).map(d => ({
      symbol,
      date: d.date,
      hasData: Math.random() > 0.1,
      quality: Math.random() > 0.8 ? 'complete' : Math.random() > 0.5 ? 'partial' : 'missing' as 'complete' | 'partial' | 'missing',
      rowCount: Math.floor(Math.random() * 10000) + 1000,
    }))
  );

  // Transform discovery matrix + strategy cards for DiscoveryMatrix component
  const strategiesTransformed = strategyCards.strategies.flatMap(strategy => 
    discoveryMatrix.matrix.map(cell => ({
      name: strategy.name,
      targetRegime: cell.regime,
      status: cell.status === 'CONQUERED' ? 'validated' : 
              cell.status === 'EXPLORING' ? 'testing' : 'empty' as 'validated' | 'testing' | 'empty',
      candidateCount: cell.status === 'CONQUERED' ? 1 : cell.status === 'EXPLORING' ? 3 : 0,
      bestSharpe: cell.status === 'CONQUERED' ? strategy.stats.sharpe : undefined,
      runs: cell.status !== 'UNTOUCHED' ? Math.floor(Math.random() * 20) + 5 : undefined,
    }))
  );
  
  switch (type) {
    case 'regime_timeline':
      return <RegimeTimeline data={regimeDataTransformed} />;
    case 'regime_distribution':
      return <RegimeDistribution data={regimeDataTransformed} />;
    case 'data_coverage':
      return <DataCoverage 
        symbols={['SPY', 'QQQ', 'IWM']} 
        dateRange={{ start: '2023-01-01', end: '2023-12-31' }}
        coverage={mockCoverage}
      />;
    case 'discovery_matrix':
      return <DiscoveryMatrix strategies={strategiesTransformed} />;
    case 'discovery_funnel':
      return <DiscoveryFunnel ideasGenerated={45} beingTested={12} showingPromise={5} validated={2} />;
    case 'scenario_simulator':
      const scenarioData = generateScenarioSimulation();
      return <ScenarioSimulator data={scenarioData} />;
    default:
      return null;
  }
}

/**
 * Phase 4: Stage-aware empty state with educational context
 */
function StageEmptyState({ stage }: { stage: string }) {
  const config = getStageVisualizationConfig(stage as any);

  return (
    <div className="h-full flex flex-col p-4 overflow-auto">
      <Card className="flex-1 flex flex-col items-center justify-center p-6 bg-card/50 backdrop-blur border-dashed">
        {/* Icon and Title */}
        <div className="text-4xl mb-3">{config.emptyStateIcon}</div>
        <h3 className="text-lg font-semibold text-center mb-2">{config.emptyStateTitle}</h3>
        <p className="text-sm text-muted-foreground text-center max-w-md leading-relaxed">
          {config.emptyStateMessage}
        </p>

        {/* Educational Context */}
        {config.educationalContext && (
          <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20 max-w-md w-full">
            <div className="flex items-start gap-2">
              <span className="text-base shrink-0">💡</span>
              <div>
                <p className="text-xs font-medium text-primary mb-0.5">Learning Moment</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {config.educationalContext}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Quick Start Prompts */}
        {stage === 'idle' && (
          <div className="mt-4 pt-4 border-t border-border w-full max-w-md">
            <p className="text-xs text-muted-foreground text-center mb-2">
              Try these prompts to get started:
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              <Button variant="outline" size="sm" className="text-xs h-7 px-2">
                Map market regimes from 2020-2024
              </Button>
              <Button variant="outline" size="sm" className="text-xs h-7 px-2">
                What should we discover today?
              </Button>
              <Button variant="outline" size="sm" className="text-xs h-7 px-2">
                Show me recent findings
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
