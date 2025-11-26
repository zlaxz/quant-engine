import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface DiscoveryFunnelProps {
  ideasGenerated: number;
  beingTested: number;
  showingPromise: number;
  validated: number;
}

const stages = [
  { key: 'ideas', label: 'Ideas Generated', color: 'bg-blue-500' },
  { key: 'testing', label: 'Being Tested', color: 'bg-amber-500' },
  { key: 'promising', label: 'Show Promise', color: 'bg-emerald-500' },
  { key: 'validated', label: 'Validated', color: 'bg-violet-500' },
];

export const DiscoveryFunnel = ({ 
  ideasGenerated, 
  beingTested, 
  showingPromise, 
  validated 
}: DiscoveryFunnelProps) => {
  const values = [ideasGenerated, beingTested, showingPromise, validated];
  const maxValue = Math.max(...values, 1);

  const data = stages.map((stage, idx) => ({
    ...stage,
    value: values[idx],
    percentage: (values[idx] / maxValue) * 100,
  }));

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-2">Discovery Funnel</h3>
          <p className="text-sm text-muted-foreground">
            Strategy conversion through validation pipeline
          </p>
        </div>

        {/* Funnel Bars */}
        <div className="space-y-3">
          {data.map((item, idx) => (
            <div key={item.key} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{item.label}</span>
                <span className="font-mono font-semibold">{item.value}</span>
              </div>
              
              <div className="relative h-10 bg-muted rounded-lg overflow-hidden">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 transition-all duration-500 ease-out",
                    item.color,
                    "flex items-center justify-end pr-3"
                  )}
                  style={{ width: `${item.percentage}%` }}
                >
                  {item.percentage > 15 && (
                    <span className="text-xs font-semibold text-white">
                      {item.percentage.toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>

              {/* Conversion Rate */}
              {idx > 0 && values[idx - 1] > 0 && (
                <div className="text-xs text-muted-foreground text-right">
                  {((item.value / values[idx - 1]) * 100).toFixed(1)}% conversion from previous stage
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Overall Stats */}
        <div className="grid grid-cols-2 gap-4 pt-4 border-t">
          <div className="text-center p-3 bg-muted/20 rounded-lg">
            <div className="text-2xl font-bold">
              {validated > 0 && ideasGenerated > 0 
                ? ((validated / ideasGenerated) * 100).toFixed(1)
                : '0.0'}%
            </div>
            <div className="text-xs text-muted-foreground">
              Ideas → Validated
            </div>
          </div>
          <div className="text-center p-3 bg-muted/20 rounded-lg">
            <div className="text-2xl font-bold">
              {beingTested + showingPromise}
            </div>
            <div className="text-xs text-muted-foreground">
              In Pipeline
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
