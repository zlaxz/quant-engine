import { useResearchDisplay } from '@/contexts/ResearchDisplayContext';
import { cn } from '@/lib/utils';

export const VisualizationContainer = () => {
  const { state } = useResearchDisplay();
  const { activeVisualizations, focusArea } = state;

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
      <div className={cn(
        "fixed inset-0 z-50 bg-black/80 flex items-center justify-center",
        "animate-fade-in"
      )}>
        <div className="bg-background rounded-lg shadow-lg max-w-6xl max-h-[90vh] overflow-auto p-6 animate-scale-in">
          {activeVisualizations.map(viz => (
            <VisualizationComponent key={viz} type={viz} />
          ))}
        </div>
      </div>
    );
  }

  return null;
};

// Placeholder component - will be replaced with actual visualizations in later phases
const VisualizationComponent = ({ type }: { type: string }) => {
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
