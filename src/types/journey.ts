export type ResearchStage = 
  | 'idle'              // No active research
  | 'regime_mapping'    // Analyzing/classifying market regimes
  | 'strategy_discovery'// Swarm discovering strategies
  | 'backtesting'       // Running backtests
  | 'tuning'            // Parameter optimization
  | 'analysis'          // Agent modes (audit, patterns, risk)
  | 'portfolio'         // Portfolio construction/symphony
  | 'conclusion';       // Final synthesis

export type VisualizationType = 
  | 'regime_timeline'
  | 'regime_distribution'
  | 'data_coverage'
  | 'discovery_matrix'
  | 'discovery_funnel'
  | 'swarm_grid'
  | 'performance_heatmap'
  | 'equity_curve_overlay'
  | 'parameter_sensitivity'
  | 'backtest_queue'
  | 'symphony'
  | 'greeks_dashboard'
  | 'allocation_sankey'
  | 'scenario_simulator';

export type FocusArea = 'center' | 'right' | 'modal' | 'hidden';

export interface ProgressState {
  percent: number;
  message?: string;
}

export interface DisplayDirective {
  type: 'stage' | 'display' | 'hide' | 'progress' | 'focus';
  value: string;
  params?: Record<string, string>;
}

export interface VisualizationState {
  currentStage: ResearchStage;
  activeVisualizations: VisualizationType[];
  progress: ProgressState;
  focusArea: FocusArea;
  operationStartTime?: number;
  currentOperation?: string;
}

export interface ResearchJourney {
  id: string;
  workspace_id: string;
  title: string;
  hypothesis?: string;
  current_stage: ResearchStage;
  stage_progress: number;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
  updated_at: string;
  concluded_at?: string;
  conclusion_summary?: string;
}

export interface JourneyStageHistory {
  id: string;
  journey_id: string;
  stage: ResearchStage;
  action_type: string;
  action_summary?: string;
  artifact_type?: string;
  artifact_id?: string;
  created_at: string;
}

export interface RegimeClassification {
  id: string;
  workspace_id: string;
  journey_id?: string;
  date: string;
  regime: string;
  confidence: number;
  metrics?: Record<string, any>;
  created_at: string;
}

export interface StrategyCandidate {
  id: string;
  workspace_id: string;
  journey_id?: string;
  strategy_name: string;
  target_regime: string;
  status: 'testing' | 'promising' | 'validated' | 'rejected';
  confidence?: number;
  discovery_metadata?: Record<string, any>;
  created_at: string;
  validated_at?: string;
}

export interface PortfolioSnapshot {
  id: string;
  workspace_id: string;
  journey_id?: string;
  snapshot_time: string;
  current_regime: string;
  allocations: Record<string, number>;
  greeks: {
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
  };
  pnl?: number;
  risk_metrics?: Record<string, any>;
}
