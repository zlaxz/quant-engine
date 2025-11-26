import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

interface RegimeDistributionProps {
  data: Array<{
    date: string;
    regime: string;
  }>;
  totalDays?: number;
}

const REGIME_COLORS = {
  LOW_VOL: '#10b981',      // emerald-500
  HIGH_VOL: '#f59e0b',     // amber-500
  CRASH: '#ef4444',        // red-500
  MELT_UP: '#8b5cf6',      // violet-500
  UNKNOWN: '#6b7280',      // gray-500
  UNCLASSIFIED: '#9ca3af', // gray-400
} as const;

const REGIME_LABELS = {
  LOW_VOL: 'Low Vol Grind',
  HIGH_VOL: 'High Vol Oscillation',
  CRASH: 'Crash Acceleration',
  MELT_UP: 'Melt Up',
  UNKNOWN: 'Unknown',
  UNCLASSIFIED: 'Unclassified',
} as const;

export const RegimeDistribution = ({ data, totalDays }: RegimeDistributionProps) => {
  const chartData = useMemo(() => {
    // Count occurrences of each regime
    const counts: Record<string, number> = {};
    
    data.forEach(item => {
      const regime = item.regime || 'UNKNOWN';
      counts[regime] = (counts[regime] || 0) + 1;
    });

    // If totalDays provided, add unclassified
    const classified = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (totalDays && totalDays > classified) {
      counts['UNCLASSIFIED'] = totalDays - classified;
    }

    // Convert to chart format
    return Object.entries(counts)
      .map(([regime, count]) => ({
        name: REGIME_LABELS[regime as keyof typeof REGIME_LABELS] || regime,
        value: count,
        percentage: totalDays ? ((count / totalDays) * 100).toFixed(1) : ((count / classified) * 100).toFixed(1),
        regime: regime,
      }))
      .sort((a, b) => b.value - a.value);
  }, [data, totalDays]);

  const total = useMemo(() => 
    chartData.reduce((sum, item) => sum + item.value, 0),
    [chartData]
  );

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-2">Regime Distribution</h3>
          <p className="text-sm text-muted-foreground">
            Time spent in each market regime
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pie Chart */}
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ percentage }) => `${percentage}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={REGIME_COLORS[entry.regime as keyof typeof REGIME_COLORS] || REGIME_COLORS.UNKNOWN}
                    />
                  ))}
                </Pie>
                <Tooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-background border border-border rounded-lg p-2 shadow-lg">
                          <p className="font-semibold">{data.name}</p>
                          <p className="text-sm">Days: {data.value}</p>
                          <p className="text-sm">Percentage: {data.percentage}%</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Stats Table */}
          <div className="space-y-2">
            <div className="text-sm font-medium mb-3">
              Total Days: {total}
            </div>
            {chartData.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-2">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: REGIME_COLORS[item.regime as keyof typeof REGIME_COLORS] || REGIME_COLORS.UNKNOWN }}
                  />
                  <span className="text-sm">{item.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-mono text-muted-foreground">
                    {item.value} days
                  </span>
                  <span className="text-sm font-semibold min-w-[3rem] text-right">
                    {item.percentage}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Progress indicator if still classifying */}
        {chartData.some(item => item.regime === 'UNCLASSIFIED') && (
          <div className="text-xs text-muted-foreground text-center pt-2 border-t">
            Classification in progress...
          </div>
        )}
      </div>
    </Card>
  );
};
