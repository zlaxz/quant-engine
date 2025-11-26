/**
 * Dual Purpose Panel - Displays visualizations (primary) and artifacts (secondary)
 * Automatically transitions between modes based on Chief Quant directives
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
import { Brain, TrendingUp, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  generateRegimeHeatmap,
  generateStrategyCards,
  generateDiscoveryMatrix,
  generateScenarioSimulation,
} from '@/lib/mockData';

export const DualPurposePanel = () => {
  const { state, currentArtifact, clearArtifact } = useResearchDisplay();
  const [displayMode, setDisplayMode] = useState<'visualization' | 'artifact'>('visualization');
  const [autoReturnTimer, setAutoReturnTimer] = useState<NodeJS.Timeout | null>(null);

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
        <EmptyState stage={state.currentStage} />
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

function EmptyState({ stage }: { stage: string }) {
  const stageInfo = {
    idle: {
      icon: Brain,
      title: 'Ready to Start',
      description: 'Ask Chief Quant to begin research. Try: "Map market regimes for 2023"',
    },
    regime_mapping: {
      icon: Calendar,
      title: 'Regime Mapping in Progress',
      description: 'Analyzing market conditions and classifying regimes...',
    },
    strategy_discovery: {
      icon: TrendingUp,
      title: 'Strategy Discovery Running',
      description: 'Swarm agents discovering optimal convexity profiles...',
    },
  };

  const info = stageInfo[stage as keyof typeof stageInfo] || stageInfo.idle;
  const Icon = info.icon;

  return (
    <Card className="h-full flex items-center justify-center p-8">
      <div className="text-center space-y-4 max-w-md">
        <Icon className="h-12 w-12 mx-auto text-muted-foreground" />
        <h3 className="text-lg font-semibold">{info.title}</h3>
        <p className="text-sm text-muted-foreground">{info.description}</p>
      </div>
    </Card>
  );
}
