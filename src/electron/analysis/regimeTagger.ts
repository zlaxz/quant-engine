/**
 * Regime Tagger System
 *
 * Automatically tags backtest runs with regime context based on date range and market conditions.
 * Enables regime-specific recall and analysis.
 */

import { SupabaseClient } from '@supabase/supabase-js';

interface RegimeContext {
  primary_regime: number; // 1-6
  regime_name: string;
  temporal_context: {
    date_range: [string, string];
    vix_regime: 'low' | 'normal' | 'high' | 'extreme';
    vix_range: [number, number];
    vix_avg: number;
    market_phase?: 'expansion' | 'contraction' | 'crash' | 'recovery';
  };
  confidence: number; // 0-1
}

const REGIME_NAMES = [
  '',
  'Trend Up (vol compression)',
  'Trend Down (vol expansion)',
  'Vol Compression / Pinned',
  'Vol Expansion / Breaking Vol',
  'Choppy / Mean-Reverting',
  'Event / Catalyst',
];

export class RegimeTagger {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Tag backtest run with regime context
   */
  async tagRun(runId: string, startDate: string, endDate: string): Promise<RegimeContext | null> {
    try {
      // Detect regime from date range and market data
      const regime = await this.detectRegime(startDate, endDate);

      if (!regime) {
        console.warn(`[RegimeTagger] Could not detect regime for ${startDate} to ${endDate}`);
        return null;
      }

      // Update backtest_runs with regime context
      const { error } = await this.supabase
        .from('backtest_runs')
        .update({
          regime_id: regime.primary_regime,
          regime_context: regime,
        })
        .eq('id', runId);

      if (error) {
        console.error('[RegimeTagger] Failed to update run with regime:', error);
        return null;
      }

      console.log(`[RegimeTagger] Tagged run ${runId.slice(0, 8)} as Regime ${regime.primary_regime}`);
      return regime;
    } catch (error) {
      console.error('[RegimeTagger] Error tagging run:', error);
      return null;
    }
  }

  /**
   * Detect regime from date range
   *
   * This is a simplified implementation.  In production, you'd query actual VIX/SPX data.
   */
  private async detectRegime(startDate: string, endDate: string): Promise<RegimeContext | null> {
    // For now, use date-based heuristics (replace with actual market data queries)
    const start = new Date(startDate);

    // Known regime periods (simplified - replace with actual data)
    const knownRegimes = [
      {
        start: new Date('2020-02-01'),
        end: new Date('2020-04-30'),
        regime: 4,
        vix_avg: 57,
        market_phase: 'crash' as const,
      },
      {
        start: new Date('2020-05-01'),
        end: new Date('2020-12-31'),
        regime: 1,
        vix_avg: 28,
        market_phase: 'recovery' as const,
      },
      {
        start: new Date('2021-01-01'),
        end: new Date('2021-12-31'),
        regime: 1,
        vix_avg: 19,
        market_phase: 'expansion' as const,
      },
      {
        start: new Date('2022-01-01'),
        end: new Date('2022-12-31'),
        regime: 2,
        vix_avg: 25,
        market_phase: 'contraction' as const,
      },
    ];

    // Find matching regime
    for (const period of knownRegimes) {
      if (start >= period.start && start <= period.end) {
        return {
          primary_regime: period.regime,
          regime_name: REGIME_NAMES[period.regime],
          temporal_context: {
            date_range: [startDate, endDate],
            vix_regime: this.classifyVixRegime(period.vix_avg),
            vix_range: [period.vix_avg - 5, period.vix_avg + 5],
            vix_avg: period.vix_avg,
            market_phase: period.market_phase,
          },
          confidence: 0.8, // Medium confidence for date-based heuristic
        };
      }
    }

    // Default to choppy regime if unknown
    return {
      primary_regime: 5,
      regime_name: REGIME_NAMES[5],
      temporal_context: {
        date_range: [startDate, endDate],
        vix_regime: 'normal',
        vix_range: [15, 25],
        vix_avg: 20,
      },
      confidence: 0.3, // Low confidence - default assumption
    };
  }

  private classifyVixRegime(vixAvg: number): 'low' | 'normal' | 'high' | 'extreme' {
    if (vixAvg < 15) return 'low';
    if (vixAvg < 20) return 'normal';
    if (vixAvg < 30) return 'high';
    return 'extreme';
  }

  /**
   * Batch tag multiple runs
   */
  async batchTagRuns(runIds: string[]): Promise<void> {
    console.log(`[RegimeTagger] Tagging ${runIds.length} runs...`);

    for (const runId of runIds) {
      // Get run details
      const { data: run } = await this.supabase
        .from('backtest_runs')
        .select('params')
        .eq('id', runId)
        .single();

      if (run && run.params?.startDate && run.params?.endDate) {
        await this.tagRun(runId, run.params.startDate, run.params.endDate);
      }
    }
  }
}
