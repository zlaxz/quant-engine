import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface RegimeTimelineProps {
  data: Array<{
    date: string;
    regime: string;
    confidence?: number;
    metrics?: Record<string, any>;
  }>;
  from?: string;
  to?: string;
  currentPosition?: string;
}

const REGIME_COLORS = {
  LOW_VOL: 'bg-emerald-500',
  HIGH_VOL: 'bg-amber-500',
  CRASH: 'bg-red-500',
  MELT_UP: 'bg-violet-500',
  UNKNOWN: 'bg-muted',
  UNCLASSIFIED: 'bg-muted/40',
} as const;

const REGIME_LABELS = {
  LOW_VOL: 'Low Vol Grind',
  HIGH_VOL: 'High Vol Oscillation',
  CRASH: 'Crash Acceleration',
  MELT_UP: 'Melt Up',
  UNKNOWN: 'Unknown',
  UNCLASSIFIED: 'Unclassified',
} as const;

export const RegimeTimeline = ({ data, from, to, currentPosition }: RegimeTimelineProps) => {
  // Group data by year and month
  const timelineData = useMemo(() => {
    const startDate = from ? new Date(from) : new Date(data[0]?.date || Date.now());
    const endDate = to ? new Date(to) : new Date(data[data.length - 1]?.date || Date.now());
    
    const years: Record<string, Array<{ month: number; regime: string; date: string; confidence?: number; metrics?: Record<string, any> }>> = {};
    
    // Create year buckets
    for (let year = startDate.getFullYear(); year <= endDate.getFullYear(); year++) {
      years[year] = [];
    }
    
    // Fill with data or unclassified markers
    const dataMap = new Map(data.map(d => [d.date, d]));
    
    for (let year = startDate.getFullYear(); year <= endDate.getFullYear(); year++) {
      for (let month = 0; month < 12; month++) {
        // Skip months outside range
        if (year === startDate.getFullYear() && month < startDate.getMonth()) continue;
        if (year === endDate.getFullYear() && month > endDate.getMonth()) break;
        
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const item = dataMap.get(dateKey);
        
        years[year].push({
          month: month,
          regime: item?.regime || 'UNCLASSIFIED',
          date: dateKey,
          confidence: item?.confidence,
          metrics: item?.metrics,
        });
      }
    }
    
    return years;
  }, [data, from, to]);

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-2">Regime Classification Timeline</h3>
          <p className="text-sm text-muted-foreground">
            Visual map of market regimes over time
          </p>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-xs">
          {Object.entries(REGIME_LABELS).map(([key, label]) => (
            <div key={key} className="flex items-center gap-2">
              <div className={cn("w-4 h-4 rounded", REGIME_COLORS[key as keyof typeof REGIME_COLORS])} />
              <span>{label}</span>
            </div>
          ))}
        </div>

        {/* Timeline */}
        <div className="space-y-3">
          {Object.entries(timelineData).map(([year, months]) => (
            <div key={year} className="flex items-center gap-2">
              <div className="text-sm font-mono text-muted-foreground w-12 shrink-0">
                {year}
              </div>
              <div className="flex-1 flex gap-0.5">
                <TooltipProvider delayDuration={100}>
                  {months.map((item, idx) => {
                    const isCurrentPosition = currentPosition && item.date === currentPosition;
                    return (
                      <Tooltip key={idx}>
                        <TooltipTrigger asChild>
                          <div
                            className={cn(
                              "flex-1 h-8 rounded-sm transition-all cursor-pointer hover:opacity-80 relative",
                              REGIME_COLORS[item.regime as keyof typeof REGIME_COLORS] || REGIME_COLORS.UNKNOWN,
                              isCurrentPosition && "ring-2 ring-primary ring-offset-1"
                            )}
                            style={{
                              opacity: item.confidence ? item.confidence : (item.regime === 'UNCLASSIFIED' ? 0.3 : 1)
                            }}
                          >
                            {isCurrentPosition && (
                              <div className="absolute -top-1 left-1/2 -translate-x-1/2">
                                <div className="text-xs text-primary animate-pulse">▼</div>
                              </div>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <div className="space-y-1 text-xs">
                            <div className="font-semibold">
                              {new Date(item.date).toLocaleDateString('en-US', { 
                                year: 'numeric', 
                                month: 'short' 
                              })}
                            </div>
                            <div>
                              Regime: <span className="font-medium">
                                {REGIME_LABELS[item.regime as keyof typeof REGIME_LABELS] || item.regime}
                              </span>
                            </div>
                            {item.confidence && (
                              <div>Confidence: {(item.confidence * 100).toFixed(0)}%</div>
                            )}
                            {item.metrics && (
                              <div className="pt-1 border-t border-border mt-1">
                                {Object.entries(item.metrics).slice(0, 3).map(([key, value]) => (
                                  <div key={key}>
                                    {key}: {typeof value === 'number' ? value.toFixed(2) : value}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </TooltipProvider>
              </div>
            </div>
          ))}
        </div>

        {currentPosition && (
          <div className="text-xs text-muted-foreground text-center pt-2 border-t">
            Currently processing: {new Date(currentPosition).toLocaleDateString()}
          </div>
        )}
      </div>
    </Card>
  );
};
