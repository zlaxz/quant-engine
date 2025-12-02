import { Button } from '@/components/ui/button';
import { Play } from 'lucide-react';
import { useResearchDisplay } from '@/contexts/ResearchDisplayContext';
import { toast } from 'sonner';

export const DemoModeButton = () => {
  const display = useResearchDisplay();

  const runDemo = async () => {
    toast.info('Demo Mode: Watch the CIO analyze a strategy with full transparency', { duration: 8000 });
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Stage 1: Transparency explanation
    display.updateStage('regime_mapping');
    display.updateProgress(0, 'CIO explaining plan...');
    
    toast.info('CIO: "I\'m analyzing Short Put OTM performance in 2023. I\'ll read /strategies/short_put_otm.py, inspect SPX data, backtest 3 profiles, and analyze trade logs."', { duration: 10000 });
    
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    // Stage 2: Tool execution begins
    display.updateProgress(25, 'Reading strategy file...');
    toast.success('✓ Read /strategies/short_put_otm.py: 156 lines, 4 parameters', { duration: 8000 });
    
    await new Promise(resolve => setTimeout(resolve, 6000));
    
    display.updateProgress(50, 'Inspecting market data...');
    toast.success('✓ SPX data 2023-01-01 to 2023-12-31: 252 days, VIX 12.4-28.7', { duration: 8000 });
    
    await new Promise(resolve => setTimeout(resolve, 6000));
    
    // Stage 3: Backtesting
    display.updateStage('backtesting');
    display.updateProgress(75, 'Running backtest...');
    toast.success('✓ Backtest complete: Sharpe 1.85, Win Rate 68%, Max DD -12.4%', { duration: 8000 });
    
    await new Promise(resolve => setTimeout(resolve, 6000));
    
    display.updateProgress(100, 'Analysis complete');
    display.showVisualization('regime_timeline');
    
    toast.success('Analysis Complete! CIO found that Profile 2 (45 DTE, 0.30 delta) worked best in low-vol periods.', { duration: 10000 });
    
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    // Reset
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
