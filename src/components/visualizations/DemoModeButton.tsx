import { Button } from '@/components/ui/button';
import { Play } from 'lucide-react';
import { useResearchDisplay } from '@/contexts/ResearchDisplayContext';

export const DemoModeButton = () => {
  const display = useResearchDisplay();

  const runDemo = async () => {
    // Stage 1: Regime Mapping
    display.updateStage('regime_mapping');
    display.showVisualization('regime_timeline');
    display.updateProgress(0, 'Starting regime classification...');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    display.updateProgress(33, 'Analyzing 2020-2021...');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    display.updateProgress(66, 'Analyzing 2022-2023...');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    display.updateProgress(100, 'Classification complete');
    display.showVisualization('regime_distribution');
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Stage 2: Strategy Discovery
    display.updateStage('strategy_discovery');
    display.hideAllVisualizations();
    display.showVisualization('discovery_matrix');
    display.updateProgress(0, 'Discovering strategies...');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    display.updateProgress(50, 'Testing regime-strategy pairs...');
    display.showVisualization('discovery_funnel');
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    display.updateProgress(100, 'Discovery complete');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Done
    display.updateStage('idle');
    display.hideAllVisualizations();
    display.updateProgress(0);
  };

  return (
    <Button
      onClick={runDemo}
      variant="outline"
      size="sm"
      className="gap-2"
    >
      <Play className="h-4 w-4" />
      Demo Dashboard
    </Button>
  );
};
