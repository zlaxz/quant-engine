import { useState } from 'react';
import { ScenarioSimulation } from '@/types/api-contract';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';

interface ScenarioSimulatorProps {
  data: ScenarioSimulation;
}

export function ScenarioSimulator({ data }: ScenarioSimulatorProps) {
  const [selectedIndex, setSelectedIndex] = useState(2); // Default to Flat (0%)
  const selectedScenario = data.scenarios[selectedIndex];

  const getIcon = (move_pct: number) => {
    if (move_pct < 0) return <TrendingDown className="w-5 h-5 text-destructive" />;
    if (move_pct > 0) return <TrendingUp className="w-5 h-5 text-success" />;
    return <Minus className="w-5 h-5 text-muted-foreground" />;
  };

  const getPnlColor = (pnl: number) => {
    if (pnl > 0) return 'text-success';
    if (pnl < 0) return 'text-destructive';
    return 'text-muted-foreground';
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>Scenario Simulator</span>
          <span className="text-sm font-normal text-muted-foreground">The "What If" Engine</span>
        </CardTitle>
        <CardDescription>
          Interactive slider to explore how market moves affect your P&L
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Selection Display */}
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Market Move</p>
              <div className="flex items-center gap-2">
                {getIcon(selectedScenario.move_pct)}
                <span className="text-2xl font-bold">{selectedScenario.desc}</span>
              </div>
            </div>
            <div className="text-right space-y-1">
              <p className="text-sm text-muted-foreground">Projected P&L</p>
              <p className={`text-3xl font-bold ${getPnlColor(selectedScenario.projected_pnl)}`}>
                {selectedScenario.projected_pnl >= 0 ? '+' : ''}${selectedScenario.projected_pnl.toFixed(2)}
              </p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Current Price:</span>
              <span className="ml-2 font-mono">${data.current_price.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Scenario Price:</span>
              <span className="ml-2 font-mono">${selectedScenario.price.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Slider */}
        <div className="space-y-4">
          <Slider
            value={[selectedIndex]}
            onValueChange={([value]) => setSelectedIndex(value)}
            min={0}
            max={data.scenarios.length - 1}
            step={1}
            className="w-full"
          />
          
          {/* Scenario Labels */}
          <div className="flex justify-between text-xs text-muted-foreground">
            {data.scenarios.map((scenario, idx) => (
              <button
                key={idx}
                onClick={() => setSelectedIndex(idx)}
                className={`transition-colors hover:text-foreground ${
                  idx === selectedIndex ? 'text-foreground font-medium' : ''
                }`}
              >
                {scenario.move_pct >= 0 ? '+' : ''}{(scenario.move_pct * 100).toFixed(0)}%
              </button>
            ))}
          </div>
        </div>

        {/* Scenarios Table */}
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Scenario</th>
                <th className="px-4 py-2 text-right font-medium">Price</th>
                <th className="px-4 py-2 text-right font-medium">P&L</th>
              </tr>
            </thead>
            <tbody>
              {data.scenarios.map((scenario, idx) => (
                <tr
                  key={idx}
                  onClick={() => setSelectedIndex(idx)}
                  className={`cursor-pointer transition-colors hover:bg-muted/30 ${
                    idx === selectedIndex ? 'bg-accent' : ''
                  }`}
                >
                  <td className="px-4 py-3 flex items-center gap-2">
                    {getIcon(scenario.move_pct)}
                    <span>{scenario.desc}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">${scenario.price.toFixed(2)}</td>
                  <td className={`px-4 py-3 text-right font-mono font-medium ${getPnlColor(scenario.projected_pnl)}`}>
                    {scenario.projected_pnl >= 0 ? '+' : ''}${scenario.projected_pnl.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Explanation */}
        <div className="rounded-lg bg-primary/5 border border-primary/20 p-4">
          <p className="text-sm leading-relaxed text-foreground/90">
            <span className="font-semibold">Chief Quant explains:</span> {data.explanation}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
