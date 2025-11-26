import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCircle2, Loader2, Circle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DiscoveryMatrixProps {
  strategies: Array<{
    name: string;
    targetRegime: string;
    status: 'empty' | 'testing' | 'promising' | 'validated' | 'rejected';
    candidateCount: number;
    bestSharpe?: number;
    runs?: number;
  }>;
}

const REGIMES = [
  { key: 'LOW_VOL', label: 'Low Vol' },
  { key: 'HIGH_VOL', label: 'High Vol' },
  { key: 'CRASH', label: 'Crash' },
  { key: 'MELT_UP', label: 'Melt Up' },
];

export const DiscoveryMatrix = ({ strategies }: DiscoveryMatrixProps) => {
  const [selectedCell, setSelectedCell] = useState<{ strategy: string; regime: string } | null>(null);

  // Group strategies by type
  const strategyTypes = useMemo(() => {
    const types = new Set(strategies.map(s => s.name));
    return Array.from(types);
  }, [strategies]);

  // Build matrix data
  const matrixData = useMemo(() => {
    const matrix: Record<string, Record<string, typeof strategies[0] | undefined>> = {};
    
    strategyTypes.forEach(stratType => {
      matrix[stratType] = {};
      REGIMES.forEach(regime => {
        const match = strategies.find(s => s.name === stratType && s.targetRegime === regime.key);
        matrix[stratType][regime.key] = match;
      });
    });
    
    return matrix;
  }, [strategies, strategyTypes]);

  const getCellIcon = (status?: string) => {
    switch (status) {
      case 'validated': return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case 'promising': return <CheckCircle2 className="h-4 w-4 text-amber-500" />;
      case 'testing': return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'rejected': return <XCircle className="h-4 w-4 text-red-500" />;
      default: return <Circle className="h-4 w-4 text-muted-foreground/30" />;
    }
  };

  const getCellColor = (status?: string) => {
    switch (status) {
      case 'validated': return 'bg-emerald-500/20 border-emerald-500/50';
      case 'promising': return 'bg-amber-500/20 border-amber-500/50';
      case 'testing': return 'bg-blue-500/20 border-blue-500/50 animate-pulse';
      case 'rejected': return 'bg-red-500/10 border-red-500/30';
      default: return 'bg-muted/20 border-border/50';
    }
  };

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-2">Strategy × Regime Discovery Matrix</h3>
          <p className="text-sm text-muted-foreground">
            Exploration progress across strategy types and market regimes
          </p>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            <span>Validated</span>
          </div>
          <div className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-amber-500" />
            <span>Promising</span>
          </div>
          <div className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 text-blue-500" />
            <span>Testing</span>
          </div>
          <div className="flex items-center gap-1">
            <XCircle className="h-3 w-3 text-red-500" />
            <span>Rejected</span>
          </div>
          <div className="flex items-center gap-1">
            <Circle className="h-3 w-3 text-muted-foreground/30" />
            <span>Unexplored</span>
          </div>
        </div>

        {/* Matrix */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left p-2 text-sm font-medium border-b"></th>
                {REGIMES.map(regime => (
                  <th key={regime.key} className="text-center p-2 text-sm font-medium border-b">
                    {regime.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {strategyTypes.map(stratType => (
                <tr key={stratType}>
                  <td className="p-2 text-sm font-medium border-r">
                    {stratType}
                  </td>
                  {REGIMES.map(regime => {
                    const cell = matrixData[stratType][regime.key];
                    const isSelected = selectedCell?.strategy === stratType && selectedCell?.regime === regime.key;
                    
                    return (
                      <td key={regime.key} className="p-2">
                        <TooltipProvider delayDuration={100}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className={cn(
                                  "relative min-h-[60px] rounded-lg border-2 transition-all cursor-pointer",
                                  getCellColor(cell?.status),
                                  isSelected && "ring-2 ring-primary ring-offset-2",
                                  "hover:scale-105"
                                )}
                                onClick={() => setSelectedCell(
                                  isSelected ? null : { strategy: stratType, regime: regime.key }
                                )}
                              >
                                <div className="absolute inset-0 flex flex-col items-center justify-center p-2">
                                  {getCellIcon(cell?.status)}
                                  {cell && cell.candidateCount > 0 && (
                                    <Badge variant="secondary" className="mt-1 text-xs">
                                      {cell.candidateCount}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <div className="space-y-1 text-xs max-w-xs">
                                <div className="font-semibold">
                                  {stratType} × {regime.label}
                                </div>
                                {cell ? (
                                  <>
                                    <div>Status: <span className="font-medium">{cell.status}</span></div>
                                    <div>Candidates: {cell.candidateCount}</div>
                                    {cell.runs && <div>Runs: {cell.runs}</div>}
                                    {cell.bestSharpe !== undefined && (
                                      <div>Best Sharpe: <span className="font-medium">{cell.bestSharpe.toFixed(2)}</span></div>
                                    )}
                                  </>
                                ) : (
                                  <div className="text-muted-foreground">Not yet explored</div>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Selected Cell Details */}
        {selectedCell && (
          <div className="mt-4 p-4 border rounded-lg bg-muted/20 animate-fade-in">
            <div className="text-sm font-semibold mb-2">
              {selectedCell.strategy} × {REGIMES.find(r => r.key === selectedCell.regime)?.label}
            </div>
            <div className="text-xs text-muted-foreground">
              Click cell again to deselect. Detailed run data will be wired in future updates.
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
