import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DataCoverageProps {
  symbols: string[];
  dateRange: {
    start: string;
    end: string;
  };
  coverage: Array<{
    symbol: string;
    date: string;
    hasData: boolean;
    quality?: 'complete' | 'partial' | 'missing';
    rowCount?: number;
    issues?: string[];
  }>;
}

export const DataCoverage = ({ symbols, dateRange, coverage }: DataCoverageProps) => {
  // Group coverage by symbol
  const coverageBySymbol = useMemo(() => {
    const grouped: Record<string, typeof coverage> = {};
    
    symbols.forEach(symbol => {
      grouped[symbol] = coverage.filter(c => c.symbol === symbol);
    });
    
    return grouped;
  }, [symbols, coverage]);

  // Calculate stats per symbol
  const symbolStats = useMemo(() => {
    return symbols.map(symbol => {
      const symbolCoverage = coverageBySymbol[symbol] || [];
      const total = symbolCoverage.length;
      const complete = symbolCoverage.filter(c => c.quality === 'complete').length;
      const partial = symbolCoverage.filter(c => c.quality === 'partial').length;
      const missing = symbolCoverage.filter(c => c.quality === 'missing' || !c.hasData).length;
      const issues = symbolCoverage.filter(c => c.issues && c.issues.length > 0).length;
      
      return {
        symbol,
        total,
        complete,
        partial,
        missing,
        issues,
        score: total > 0 ? ((complete + partial * 0.5) / total) * 100 : 0,
      };
    });
  }, [symbols, coverageBySymbol]);

  const getQualityColor = (quality?: string) => {
    switch (quality) {
      case 'complete': return 'bg-emerald-500';
      case 'partial': return 'bg-amber-500';
      case 'missing': return 'bg-red-500/50';
      default: return 'bg-muted';
    }
  };

  const getQualityIcon = (quality?: string) => {
    switch (quality) {
      case 'complete': return <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
      case 'partial': return <AlertCircle className="h-3 w-3 text-amber-500" />;
      case 'missing': return <XCircle className="h-3 w-3 text-red-500" />;
      default: return null;
    }
  };

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-2">Data Coverage & Quality</h3>
          <p className="text-sm text-muted-foreground">
            Symbol availability across date range: {dateRange.start} to {dateRange.end}
          </p>
        </div>

        {/* Overall Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center p-3 border rounded-lg">
            <div className="text-2xl font-bold">
              {symbolStats.reduce((sum, s) => sum + s.complete, 0)}
            </div>
            <div className="text-xs text-muted-foreground">Complete Days</div>
          </div>
          <div className="text-center p-3 border rounded-lg">
            <div className="text-2xl font-bold text-amber-500">
              {symbolStats.reduce((sum, s) => sum + s.partial, 0)}
            </div>
            <div className="text-xs text-muted-foreground">Partial Days</div>
          </div>
          <div className="text-center p-3 border rounded-lg">
            <div className="text-2xl font-bold text-red-500">
              {symbolStats.reduce((sum, s) => sum + s.missing, 0)}
            </div>
            <div className="text-xs text-muted-foreground">Missing Days</div>
          </div>
          <div className="text-center p-3 border rounded-lg">
            <div className="text-2xl font-bold text-destructive">
              {symbolStats.reduce((sum, s) => sum + s.issues, 0)}
            </div>
            <div className="text-xs text-muted-foreground">Data Issues</div>
          </div>
        </div>

        {/* Symbol Coverage */}
        <div className="space-y-3">
          <div className="text-sm font-medium">Symbol Coverage</div>
          {symbolStats.map(stat => (
            <div key={stat.symbol} className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{stat.symbol}</span>
                  <Badge variant={stat.score >= 90 ? 'default' : stat.score >= 70 ? 'secondary' : 'destructive'}>
                    {stat.score.toFixed(0)}% coverage
                  </Badge>
                  {stat.issues > 0 && (
                    <Badge variant="outline" className="text-destructive">
                      {stat.issues} issues
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                    {stat.complete}
                  </span>
                  <span className="flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 text-amber-500" />
                    {stat.partial}
                  </span>
                  <span className="flex items-center gap-1">
                    <XCircle className="h-3 w-3 text-red-500" />
                    {stat.missing}
                  </span>
                </div>
              </div>

              {/* Mini calendar view */}
              <div className="flex gap-0.5 h-2">
                <TooltipProvider delayDuration={100}>
                  {coverageBySymbol[stat.symbol]?.map((item, idx) => (
                    <Tooltip key={idx}>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "flex-1 rounded-sm cursor-pointer",
                            getQualityColor(item.quality)
                          )}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <div className="space-y-1 text-xs">
                          <div className="font-semibold">{item.date}</div>
                          <div className="flex items-center gap-1">
                            {getQualityIcon(item.quality)}
                            <span>{item.quality || 'unknown'}</span>
                          </div>
                          {item.rowCount && <div>Rows: {item.rowCount.toLocaleString()}</div>}
                          {item.issues && item.issues.length > 0 && (
                            <div className="pt-1 border-t border-border">
                              <div className="font-semibold text-destructive">Issues:</div>
                              {item.issues.map((issue, i) => (
                                <div key={i}>• {issue}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </TooltipProvider>
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex gap-4 text-xs pt-2 border-t">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-emerald-500" />
            <span>Complete</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-amber-500" />
            <span>Partial</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-red-500/50" />
            <span>Missing</span>
          </div>
        </div>
      </div>
    </Card>
  );
};
