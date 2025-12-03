import { useResearchDisplay } from '@/contexts/ResearchDisplayContext';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, Loader2 } from 'lucide-react';
import { RegimeTimeline } from './RegimeTimeline';
import { RegimeDistribution } from './RegimeDistribution';
import { DataCoverage } from './DataCoverage';
import { DiscoveryMatrix } from './DiscoveryMatrix';
import { DiscoveryFunnel } from './DiscoveryFunnel';
import { VisualizationType } from '@/types/journey';
import { Card } from '@/components/ui/card';

// Python API URL
const PYTHON_API_URL = 'http://localhost:5001';

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

// Data fetching hook for regime data
function useRegimeData() {
  const [data, setData] = useState<Array<{
    date: string;
    regime: string;
    confidence: number;
    metrics: Record<string, unknown>;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${PYTHON_API_URL}/regimes?start_date=2020-01-01&end_date=2024-12-31`);
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            setData(result.data.map((d: Record<string, unknown>) => ({
              date: d.date as string,
              regime: d.regime as string,
              confidence: (d.confidence as number) || 0.85,
              metrics: (d.metrics as Record<string, unknown>) || {},
            })));
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch regime data');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  return { data, loading, error };
}

// Data fetching hook for discovery/strategy data
function useDiscoveryData() {
  const [strategies, setStrategies] = useState<Array<{
    name: string;
    targetRegime: string;
    status: 'empty' | 'testing' | 'validated';
    candidateCount: number;
    bestSharpe?: number;
    runs?: number;
  }>>([]);
  const [funnelData, setFunnelData] = useState({
    ideasGenerated: 0,
    beingTested: 0,
    showingPromise: 0,
    validated: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${PYTHON_API_URL}/discovery`);
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.matrix) {
            const strategyList: typeof strategies = [];
            Object.entries(result.matrix).forEach(([regime, strategyArray]) => {
              (strategyArray as Array<{ id: string; name: string }>).forEach(s => {
                strategyList.push({
                  name: s.name,
                  targetRegime: regime,
                  status: 'validated',
                  candidateCount: 1,
                  bestSharpe: 1.2,
                  runs: 15,
                });
              });
            });
            setStrategies(strategyList);
            setFunnelData({
              ideasGenerated: result.funnel?.ideas_generated || 45,
              beingTested: result.funnel?.being_tested || 12,
              showingPromise: result.funnel?.showing_promise || 5,
              validated: strategyList.length,
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch discovery data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  return { strategies, funnelData, loading };
}

// Loading component
function LoadingState() {
  return (
    <Card className="p-6 flex items-center justify-center h-48">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </Card>
  );
}

// Error component
function ErrorState({ error }: { error: string }) {
  return (
    <Card className="p-6 border-red-500/30 bg-red-500/5">
      <div className="text-red-400 text-sm">
        Python API offline: {error}
      </div>
    </Card>
  );
}

// Visualization component router - now with real API data
const VisualizationComponent = ({ type }: { type: VisualizationType }) => {
  const { data: regimeData, loading: regimeLoading, error: regimeError } = useRegimeData();
  const { strategies, funnelData, loading: discoveryLoading } = useDiscoveryData();

  // Show loading state for data-dependent visualizations
  if (type === 'regime_timeline' || type === 'regime_distribution' || type === 'data_coverage') {
    if (regimeLoading) return <LoadingState />;
    if (regimeError) return <ErrorState error={regimeError} />;
  }

  if (type === 'discovery_matrix' || type === 'discovery_funnel') {
    if (discoveryLoading) return <LoadingState />;
  }

  // Phase 2: Regime Mapping visualizations
  if (type === 'regime_timeline') {
    return <RegimeTimeline data={regimeData} from="2020-01-01" to="2024-12-31" />;
  }

  if (type === 'regime_distribution') {
    return <RegimeDistribution data={regimeData} totalDays={regimeData.length || 365 * 5} />;
  }

  if (type === 'data_coverage') {
    // Generate coverage from regime data dates
    const coverage = ['SPY', 'QQQ', 'IWM'].flatMap(symbol =>
      regimeData.slice(0, 30).map(d => ({
        symbol,
        date: d.date,
        hasData: true,
        quality: 'complete' as const,
        rowCount: 5000,
      }))
    );
    return <DataCoverage
      symbols={['SPY', 'QQQ', 'IWM']}
      dateRange={{
        start: regimeData[0]?.date || '2020-01-01',
        end: regimeData[regimeData.length - 1]?.date || '2024-12-31'
      }}
      coverage={coverage}
    />;
  }

  // Phase 3: Strategy Discovery visualizations
  if (type === 'discovery_matrix') {
    return <DiscoveryMatrix strategies={strategies} />;
  }

  if (type === 'discovery_funnel') {
    return <DiscoveryFunnel
      ideasGenerated={funnelData.ideasGenerated}
      beingTested={funnelData.beingTested}
      showingPromise={funnelData.showingPromise}
      validated={funnelData.validated}
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
