import { useResearchDisplay } from '@/contexts/ResearchDisplayContext';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { RegimeTimeline } from './RegimeTimeline';
import { RegimeDistribution } from './RegimeDistribution';
import { DataCoverage } from './DataCoverage';
import { DiscoveryMatrix } from './DiscoveryMatrix';
import { DiscoveryFunnel } from './DiscoveryFunnel';
import { VisualizationType } from '@/types/journey';

export const VisualizationContainer = () => {
  const { state, hideAllVisualizations } = useResearchDisplay();
  const { activeVisualizations, focusArea } = state;

  // ESC to close (ADHD constraint)
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeVisualizations.length > 0) {
        hideAllVisualizations();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [activeVisualizations.length, hideAllVisualizations]);

  if (activeVisualizations.length === 0 || focusArea === 'hidden') {
    return null;
  }

  // Render different layouts based on focus area
  if (focusArea === 'center') {
    return (
      <div className={cn(
        "fixed inset-0 z-40 bg-background/95 backdrop-blur-sm",
        "animate-fade-in"
      )}>
        <div className="container mx-auto h-full p-6 flex flex-col gap-4">
          {/* Close button */}
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="icon"
              onClick={hideAllVisualizations}
              className="hover:bg-destructive/20"
              title="Close (ESC)"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-auto">
            {activeVisualizations.map(viz => (
              <VisualizationComponent key={viz} type={viz} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (focusArea === 'right') {
    return (
      <div className="h-full overflow-auto animate-slide-in-right">
        {activeVisualizations.map(viz => (
          <VisualizationComponent key={viz} type={viz} />
        ))}
      </div>
    );
  }

  if (focusArea === 'modal') {
    return (
      <div 
        className={cn(
          "fixed inset-0 z-50 bg-black/80 flex items-center justify-center",
          "animate-fade-in"
        )}
        onClick={hideAllVisualizations}
      >
        <div 
          className="bg-background rounded-lg shadow-lg max-w-6xl max-h-[90vh] overflow-auto p-6 animate-scale-in relative"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={hideAllVisualizations}
            className="absolute top-2 right-2 hover:bg-destructive/20"
            title="Close (ESC)"
          >
            <X className="h-4 w-4" />
          </Button>

          <div className="mt-8">
            {activeVisualizations.map(viz => (
              <VisualizationComponent key={viz} type={viz} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return null;
};

// Visualization component router
const VisualizationComponent = ({ type }: { type: VisualizationType }) => {
  // Phase 2: Regime Mapping visualizations
  if (type === 'regime_timeline') {
    // TODO: Wire to actual regime classification data
    const mockData = generateMockRegimeData();
    return <RegimeTimeline data={mockData} from="2020-01-01" to="2024-12-31" />;
  }
  
  if (type === 'regime_distribution') {
    const mockData = generateMockRegimeData();
    return <RegimeDistribution data={mockData} totalDays={365 * 5} />;
  }
  
  if (type === 'data_coverage') {
    const mockCoverage = generateMockDataCoverage();
    return <DataCoverage 
      symbols={['SPX', 'SPY', 'VIX', 'VIX9D']} 
      dateRange={{ start: '2020-01-01', end: '2024-12-31' }}
      coverage={mockCoverage}
    />;
  }

  // Phase 3: Strategy Discovery visualizations
  if (type === 'discovery_matrix') {
    const mockStrategies = generateMockStrategyData();
    return <DiscoveryMatrix strategies={mockStrategies} />;
  }

  if (type === 'discovery_funnel') {
    return <DiscoveryFunnel 
      ideasGenerated={47}
      beingTested={23}
      showingPromise={12}
      validated={5}
    />;
  }

  // Placeholder for future phases
  return (
    <div className="rounded-lg border border-border bg-card p-6 mb-4">
      <div className="text-lg font-semibold mb-2 text-foreground">
        {type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
      </div>
      <div className="text-sm text-muted-foreground">
        Visualization coming soon in Phase {getPhaseForVisualization(type)}
      </div>
    </div>
  );
};

function getPhaseForVisualization(type: string): number {
  if (['regime_timeline', 'regime_distribution', 'data_coverage'].includes(type)) return 2;
  if (['discovery_matrix', 'discovery_funnel', 'swarm_grid'].includes(type)) return 3;
  if (['performance_heatmap', 'equity_curve_overlay', 'parameter_sensitivity', 'backtest_queue'].includes(type)) return 4;
  if (['symphony', 'greeks_dashboard', 'allocation_sankey'].includes(type)) return 5;
  return 1;
}

// Mock data generators (TODO: Replace with real data queries)
function generateMockRegimeData() {
  const regimes = ['LOW_VOL', 'HIGH_VOL', 'CRASH', 'MELT_UP'];
  const data = [];
  
  for (let year = 2020; year <= 2024; year++) {
    for (let month = 1; month <= 12; month++) {
      if (year === 2024 && month > 11) break;
      
      data.push({
        date: `${year}-${String(month).padStart(2, '0')}-01`,
        regime: regimes[Math.floor(Math.random() * regimes.length)],
        confidence: 0.7 + Math.random() * 0.3,
        metrics: {
          vix: 15 + Math.random() * 30,
          term_structure: -0.5 + Math.random() * 1.5,
        }
      });
    }
  }
  
  return data;
}

function generateMockDataCoverage(): Array<{
  symbol: string;
  date: string;
  hasData: boolean;
  quality: 'complete' | 'partial' | 'missing';
  rowCount?: number;
  issues?: string[];
}> {
  const symbols = ['SPX', 'SPY', 'VIX', 'VIX9D'];
  const qualities: Array<'complete' | 'partial' | 'missing'> = ['complete', 'partial', 'missing'];
  const coverage: Array<{
    symbol: string;
    date: string;
    hasData: boolean;
    quality: 'complete' | 'partial' | 'missing';
    rowCount?: number;
    issues?: string[];
  }> = [];
  
  for (let year = 2020; year <= 2024; year++) {
    for (let month = 1; month <= 12; month++) {
      if (year === 2024 && month > 11) break;
      
      symbols.forEach(symbol => {
        const quality = qualities[Math.floor(Math.random() * qualities.length)];
        coverage.push({
          symbol,
          date: `${year}-${String(month).padStart(2, '0')}-01`,
          hasData: quality !== 'missing',
          quality,
          rowCount: quality === 'complete' ? 5000 + Math.floor(Math.random() * 2000) : 
                    quality === 'partial' ? 1000 + Math.floor(Math.random() * 1000) : 0,
          issues: quality === 'partial' ? ['Incomplete trading hours'] : undefined,
        });
      });
    }
  }
  
  return coverage;
}

function generateMockStrategyData(): Array<{
  name: string;
  targetRegime: string;
  status: 'empty' | 'testing' | 'promising' | 'validated' | 'rejected';
  candidateCount: number;
  bestSharpe?: number;
  runs?: number;
}> {
  const strategyTypes = ['Iron Condor', 'Long Gamma', 'Vol Spread', 'Momentum'];
  const regimes = ['LOW_VOL', 'HIGH_VOL', 'CRASH', 'MELT_UP'];
  const statuses: Array<'empty' | 'testing' | 'promising' | 'validated' | 'rejected'> = 
    ['empty', 'testing', 'promising', 'validated', 'rejected'];
  
  const strategies: Array<{
    name: string;
    targetRegime: string;
    status: 'empty' | 'testing' | 'promising' | 'validated' | 'rejected';
    candidateCount: number;
    bestSharpe?: number;
    runs?: number;
  }> = [];
  strategyTypes.forEach(stratType => {
    regimes.forEach(regime => {
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      strategies.push({
        name: stratType,
        targetRegime: regime,
        status,
        candidateCount: status === 'empty' ? 0 : Math.floor(Math.random() * 5) + 1,
        bestSharpe: status !== 'empty' ? 0.5 + Math.random() * 2 : undefined,
        runs: status !== 'empty' ? Math.floor(Math.random() * 20) + 5 : undefined,
      });
    });
  });
  
  return strategies;
}
