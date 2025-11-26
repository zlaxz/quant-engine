/**
 * TypeScript interfaces for QuantOS API Contract (v1.1)
 * These define the JSON data structures that visualizations consume
 */

// 1. Regime Heatmap
export interface RegimeData {
  date: string;
  regime_key: string;
  display_name: string;
  color_code: string;
  confidence: number;
  metrics: {
    vix: number;
    trend_score: number;
    description: string;
  };
}

export interface RegimeHeatmapData {
  data: RegimeData[];
}

// 2. Strategy Card
export interface StrategyCard {
  id: string;
  name: string;
  class: string;
  level: number;
  badges: string[];
  stats: {
    sharpe: number;
    win_rate: number;
    max_drawdown: number;
    annual_return: number;
  };
  description: string;
  best_regime: string;
}

export interface StrategyCardCollection {
  strategies: StrategyCard[];
}

// 3. Backtest Equity Curve
export interface EquityCurvePoint {
  timestamp: string;
  equity: number;
  drawdown_pct: number;
  active_trades: number;
  event?: {
    type: 'ENTRY' | 'EXIT' | 'ADJUSTMENT';
    symbol: string;
    description: string;
  };
}

export interface BacktestEquityCurve {
  run_id: string;
  time_series: EquityCurvePoint[];
}

// 4. Discovery Matrix
export interface DiscoveryCell {
  regime: string;
  status: 'CONQUERED' | 'EXPLORING' | 'UNTOUCHED';
  best_strategy_id: string | null;
  coverage_pct: number;
}

export interface DiscoveryMatrix {
  matrix: DiscoveryCell[];
}

// 5. Trade Explanation
export interface TradeLogicStep {
  step: number;
  check: string;
  result: 'PASS' | 'FAIL';
  detail: string;
}

export interface TradeExplanation {
  trade_id: string;
  action: 'ENTRY' | 'EXIT' | 'ADJUSTMENT';
  timestamp: string;
  logic_chain: TradeLogicStep[];
  plain_english: string;
}

// 6. Trade Anatomy
export interface PayoffZone {
  range: [number, number];
  type: 'LOSS' | 'PROFIT';
  color: string;
}

export interface TradeAnatomy {
  trade_id: string;
  symbol: string;
  type: string;
  current_spot: number;
  break_even: number;
  max_profit: number | string;
  max_loss: number | string;
  probability_of_profit: number;
  days_to_expiration: number;
  zones: PayoffZone[];
  analogy: string;
}

// 7. Greeks Cockpit
export interface GreekMetric {
  name: 'Delta' | 'Gamma' | 'Vega' | 'Theta';
  value: number;
  unit: string;
  analogy: string;
  status: 'OK' | 'WARNING' | 'DANGER';
  message: string;
}

export interface GreeksCockpit {
  timestamp: string;
  metrics: GreekMetric[];
}

// 8. Scenario Simulator
export interface Scenario {
  move_pct: number;
  price: number;
  projected_pnl: number;
  desc: string;
}

export interface ScenarioSimulation {
  type: 'scenario_simulation';
  current_price: number;
  scenarios: Scenario[];
  explanation: string;
}

// Additional types for artifact display
export type ArtifactType = 
  | 'annotated_code' 
  | 'configuration' 
  | 'research_report' 
  | 'analysis_script';

export interface Artifact {
  type: ArtifactType;
  title: string;
  content: string;
  language?: string; // for syntax highlighting
  annotations?: {
    line: number;
    text: string;
  }[];
}
