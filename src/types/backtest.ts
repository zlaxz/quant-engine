/**
 * Shared TypeScript types for backtest system
 * These types ensure consistency between frontend, backend, and external engine
 */

/**
 * Backtest execution parameters
 * Sent to backtest-run edge function and external engine
 */
export interface BacktestParams {
  startDate: string;        // 'YYYY-MM-DD' format
  endDate: string;          // 'YYYY-MM-DD' format
  capital: number;          // Starting capital in USD
  profileConfig?: Record<string, any>;  // Optional rotation-engine profile config (future use)
}

/**
 * Backtest performance metrics
 * Returned by external engine and stored in backtest_runs.metrics
 */
export interface BacktestMetrics {
  cagr: number;                      // Compound Annual Growth Rate (e.g., 0.18 = 18%)
  sharpe: number;                    // Sharpe Ratio
  max_drawdown: number;              // Maximum Drawdown (e.g., -0.095 = -9.5%)
  win_rate: number;                  // Win Rate (e.g., 0.62 = 62%)
  total_trades: number;              // Total number of trades executed
  avg_trade_duration_days?: number;  // Average trade duration in days (optional)
  [key: string]: any;                // Allow future metric extensions
}

/**
 * Single point in equity curve time series
 */
export interface EquityPoint {
  date: string;   // 'YYYY-MM-DD' format
  value: number;  // Portfolio value in USD
}

/**
 * Complete backtest run record
 * Matches backtest_runs table schema in Supabase
 */
export interface BacktestRun {
  id: string;
  session_id: string | null;
  strategy_key: string;
  params: BacktestParams;
  status: 'pending' | 'running' | 'completed' | 'failed';
  metrics: BacktestMetrics | null;
  equity_curve: EquityPoint[] | null;
  engine_source: 'external' | 'stub' | 'stub_fallback' | null;
  label?: string | null;
  notes?: string | null;
  tags?: string[] | null;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
  raw_results_url?: string | null;
}

/**
 * Request body for backtest-run edge function
 */
export interface BacktestRequest {
  sessionId: string;
  strategyKey: string;
  params: BacktestParams;
}

/**
 * Response from external backtest engine
 * Contract: POST /run-backtest endpoint
 */
export interface ExternalEngineResponse {
  metrics: BacktestMetrics;
  equity_curve: EquityPoint[];
}

/**
 * Response from backtest-run edge function
 */
export interface BacktestResponse {
  runId: string;
  status: string;
  metrics?: BacktestMetrics;
  equity_curve?: EquityPoint[];
  engine_source?: string;
  error?: string;
}
