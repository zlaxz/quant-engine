/**
 * Strategies Page - Full-page Strategy Library
 */

import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { StrategyLibrary } from '@/features/strategies';
import { AppHeader } from '@/components/layout';
import { useToast } from '@/hooks/use-toast';

export default function Strategies() {
  const { toast } = useToast();

  const handleRunStrategy = (id: string) => {
    toast({
      title: 'Running Backtest',
      description: `Starting backtest for strategy: ${id}`,
    });
    // TODO: Integrate with Python backtester
  };

  const handleCreateStrategy = () => {
    toast({
      title: 'Strategy Builder',
      description: 'Strategy builder coming soon!',
    });
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <AppHeader
        title="Strategy Library"
        subtitle="Browse, backtest, and deploy strategies"
        actions={
          <Button size="sm" className="gap-1" onClick={handleCreateStrategy}>
            <Plus className="h-3.5 w-3.5" />
            New Strategy
          </Button>
        }
      />

      {/* Strategy Library */}
      <div className="flex-1 p-4 overflow-hidden">
        <StrategyLibrary
          onRunStrategy={handleRunStrategy}
          onCreateStrategy={handleCreateStrategy}
          className="h-full"
        />
      </div>
    </div>
  );
}
