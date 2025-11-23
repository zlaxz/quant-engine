/**
 * Overfitting Detection System
 *
 * Analyzes backtest results for overfitting signals and creates warnings.
 * Implements Bailey & López de Prado methodologies.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

interface BacktestRun {
  id: string;
  workspace_id: string;
  strategy_key: string;
  params: Record<string, any>;
  metrics: {
    sharpe: number;
    cagr: number;
    max_drawdown: number;
    total_trades: number;
    win_rate: number;
  };
  statistical_validity?: StatisticalValidity;
  regime_id?: number;
}

interface StatisticalValidity {
  n_trades: number;
  t_statistic: number;
  p_value: number;
  deflated_sharpe?: number;
  pbo_score?: number;
  walk_forward_efficiency?: number;
  parameter_sensitivity?: 'low' | 'medium' | 'high';
  passes_multiple_testing: boolean;
  passes_walk_forward: boolean;
  passes_pbo: boolean;
  overall_valid: boolean;
}

interface OverfittingWarning {
  strategy_name: string;
  approach_description: string;
  failure_type: string;
  warning_message: string;
  do_not_repeat: string;
  evidence_detail: string;
  in_sample_sharpe: number;
  out_of_sample_sharpe?: number;
  pbo_score?: number;
  deflated_sharpe?: number;
  walk_forward_efficiency?: number;
}

export class OverfittingDetector {
  constructor(
    private supabase: SupabaseClient,
    private openaiClient: OpenAI | null
  ) {}

  /**
   * Analyze backtest run for overfitting and create warnings
   */
  async analyzeRun(run: BacktestRun): Promise<OverfittingWarning[]> {
    const warnings: OverfittingWarning[] = [];
    const sv = run.statistical_validity;

    if (!sv) {
      console.warn(`[OverfittingDetector] No statistical_validity for run ${run.id}`);
      return warnings;
    }

    // Check 1: Probability of Backtest Overfitting
    if (sv.pbo_score && sv.pbo_score > 0.25) {
      warnings.push({
        strategy_name: run.strategy_key,
        approach_description: JSON.stringify(run.params),
        failure_type: 'data_snooping',
        warning_message: `HIGH PBO: ${(sv.pbo_score * 100).toFixed(0)}% probability this strategy is overfit to historical data`,
        do_not_repeat: `Do not deploy ${run.strategy_key} with these parameters without regime-specific validation`,
        evidence_detail: `PBO score: ${sv.pbo_score.toFixed(3)} (threshold: 0.25). This indicates the strategy likely exploits noise rather than signal.`,
        in_sample_sharpe: run.metrics.sharpe,
        pbo_score: sv.pbo_score,
      });
    }

    // Check 2: Walk-Forward Validation Failure
    if (sv.walk_forward_efficiency && sv.walk_forward_efficiency < 0.5) {
      warnings.push({
        strategy_name: run.strategy_key,
        approach_description: JSON.stringify(run.params),
        failure_type: 'walk_forward_failure',
        warning_message: `POOR OUT-OF-SAMPLE: Walk-forward efficiency ${sv.walk_forward_efficiency.toFixed(2)} indicates strategy degrades significantly on unseen data`,
        do_not_repeat: `This parameter set does not generalize. Test with walk-forward before trusting any backtest.`,
        evidence_detail: `WFE: ${sv.walk_forward_efficiency.toFixed(2)} (threshold: 0.50). Out-of-sample Sharpe is less than half of in-sample.`,
        in_sample_sharpe: run.metrics.sharpe,
        walk_forward_efficiency: sv.walk_forward_efficiency,
      });
    }

    // Check 3: Insufficient Sample Size
    if (sv.n_trades < 30) {
      warnings.push({
        strategy_name: run.strategy_key,
        approach_description: JSON.stringify(run.params),
        failure_type: 'insufficient_sample',
        warning_message: `INSUFFICIENT SAMPLE: Only ${sv.n_trades} trades (minimum: 30). Results not statistically meaningful.`,
        do_not_repeat: `Never trust metrics from < 30 trades. Extend backtest period or reduce strategy frequency.`,
        evidence_detail: `Sample size: ${sv.n_trades} (central limit theorem requires >= 30)`,
        in_sample_sharpe: run.metrics.sharpe,
      });
    }

    // Check 4: Multiple Testing Without Correction
    if (!sv.passes_multiple_testing) {
      warnings.push({
        strategy_name: run.strategy_key,
        approach_description: JSON.stringify(run.params),
        failure_type: 'multiple_testing',
        warning_message: `MULTIPLE TESTING FAILURE: t-statistic ${sv.t_statistic.toFixed(2)} insufficient for number of variations tested`,
        do_not_repeat: `Use deflated Sharpe ratio. Require t-stat > 3.0 when testing multiple parameter combinations.`,
        evidence_detail: `t-statistic: ${sv.t_statistic.toFixed(2)}, DSR: ${sv.deflated_sharpe?.toFixed(2) || 'N/A'}`,
        in_sample_sharpe: run.metrics.sharpe,
        deflated_sharpe: sv.deflated_sharpe,
      });
    }

    // Check 5: High Parameter Sensitivity
    if (sv.parameter_sensitivity === 'high') {
      warnings.push({
        strategy_name: run.strategy_key,
        approach_description: JSON.stringify(run.params),
        failure_type: 'parameter_sensitivity',
        warning_message: `PARAMETER SENSITIVE: Performance degrades >30% with ±10% parameter changes. Likely curve-fit.`,
        do_not_repeat: `Robust strategies work across parameter ranges. This fragility indicates overfitting.`,
        evidence_detail: `Parameter sensitivity classified as HIGH. Small changes destroy performance.`,
        in_sample_sharpe: run.metrics.sharpe,
      });
    }

    // Save warnings to database
    if (warnings.length > 0) {
      await this.saveWarnings(warnings, run);
    }

    return warnings;
  }

  /**
   * Save overfitting warnings to database
   */
  private async saveWarnings(warnings: OverfittingWarning[], run: BacktestRun): Promise<void> {
    // Generate embedding for strategy approach
    let strategyEmbedding: number[] | null = null;
    if (this.openaiClient) {
      try {
        const description = `${run.strategy_key} ${JSON.stringify(run.params)}`;
        const response = await this.openaiClient.embeddings.create({
          model: 'text-embedding-3-small',
          input: description,
        });
        strategyEmbedding = response.data[0]?.embedding || null;
      } catch (error) {
        console.error('[OverfittingDetector] Failed to generate strategy embedding:', error);
      }
    }

    // Insert warnings
    const records = warnings.map((w) => ({
      workspace_id: run.workspace_id,
      run_id: run.id,
      strategy_name: w.strategy_name,
      approach_description: w.approach_description,
      failure_type: w.failure_type,
      warning_message: w.warning_message,
      do_not_repeat: w.do_not_repeat,
      evidence_detail: w.evidence_detail,
      in_sample_sharpe: w.in_sample_sharpe,
      out_of_sample_sharpe: w.out_of_sample_sharpe,
      pbo_score: w.pbo_score,
      deflated_sharpe: w.deflated_sharpe,
      walk_forward_efficiency: w.walk_forward_efficiency,
      strategy_embedding: strategyEmbedding,
    }));

    const { error } = await this.supabase.from('overfitting_warnings').insert(records);

    if (error) {
      console.error('[OverfittingDetector] Failed to save warnings:', error);
    } else {
      console.log(`[OverfittingDetector] Saved ${warnings.length} warnings for run ${run.id.slice(0, 8)}`);
    }
  }

  /**
   * Check if similar approach has failed before
   */
  async checkSimilarFailures(strategyDescription: string, workspaceId: string): Promise<any[]> {
    if (!this.openaiClient) {
      console.warn('[OverfittingDetector] OpenAI client not available, skipping similarity check');
      return [];
    }

    try {
      // Generate embedding for proposed approach
      const response = await this.openaiClient.embeddings.create({
        model: 'text-embedding-3-small',
        input: strategyDescription,
      });

      const embedding = response.data[0]?.embedding;
      if (!embedding) return [];

      // Query for similar failed approaches
      const { data, error } = await this.supabase.rpc('find_similar_warnings', {
        match_workspace_id: workspaceId,
        strategy_embedding: embedding,
        threshold: 0.7,
      });

      if (error) {
        console.error('[OverfittingDetector] Error querying similar failures:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[OverfittingDetector] Error in checkSimilarFailures:', error);
      return [];
    }
  }
}
