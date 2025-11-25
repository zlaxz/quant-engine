/**
 * Risk Summarization Utilities
 * 
 * Helpers for building risk-focused summaries of runs and memory for the Risk Officer.
 */

import type { BacktestRun } from '@/types/backtest';
import type { MemoryNote } from '@/types/memory';

export type { MemoryNote };

/**
 * Build risk-focused run summary
 * 
 * Aggregates runs to identify:
 * - Extreme drawdowns
 * - Worst-performing runs
 * - Regime-specific failures
 * - Win/loss asymmetry
 */
export function buildRiskRunSummary(runs: BacktestRun[]): string {
  if (runs.length === 0) {
    return "No completed runs available for risk analysis.";
  }

  // Group by strategy
  const byStrategy = new Map<string, BacktestRun[]>();
  for (const run of runs) {
    const key = run.strategy_key;
    if (!byStrategy.has(key)) byStrategy.set(key, []);
    byStrategy.get(key)!.push(run);
  }

  const sections: string[] = [];

  // Overall statistics
  const allDrawdowns = runs
    .map(r => r.metrics?.max_drawdown)
    .filter((dd): dd is number => typeof dd === 'number');
  const allSharpes = runs
    .map(r => r.metrics?.sharpe)
    .filter((s): s is number => typeof s === 'number');
  const allCAGRs = runs
    .map(r => r.metrics?.cagr)
    .filter((c): c is number => typeof c === 'number');

  if (allDrawdowns.length > 0) {
    const maxDD = Math.max(...allDrawdowns);
    const medianDD = median(allDrawdowns);
    sections.push(`**Overall Drawdown Risk**: Max DD = ${(maxDD * 100).toFixed(1)}%, Median DD = ${(medianDD * 100).toFixed(1)}%`);
  }

  if (allSharpes.length > 0) {
    const minSharpe = Math.min(...allSharpes);
    const medianSharpe = median(allSharpes);
    sections.push(`**Sharpe Distribution**: Min = ${minSharpe.toFixed(2)}, Median = ${medianSharpe.toFixed(2)}`);
  }

  // Identify worst runs
  const worstRuns = runs
    .filter(r => r.metrics?.cagr !== undefined)
    .sort((a, b) => (a.metrics!.cagr || 0) - (b.metrics!.cagr || 0))
    .slice(0, 5);

  if (worstRuns.length > 0) {
    sections.push(`\n**Worst Runs**:`);
    worstRuns.forEach(r => {
      const cagr = ((r.metrics?.cagr || 0) * 100).toFixed(1);
      const dd = ((r.metrics?.max_drawdown || 0) * 100).toFixed(1);
      const dateRange = r.params?.startDate && r.params?.endDate 
        ? `${r.params.startDate} to ${r.params.endDate}`
        : 'unknown period';
      sections.push(`  - ${r.strategy_key} (${dateRange}): CAGR ${cagr}%, DD ${dd}%`);
    });
  }

  // Per-strategy risk profile
  sections.push(`\n**Per-Strategy Risk Profile**:`);
  byStrategy.forEach((stratRuns, stratKey) => {
    const dds = stratRuns
      .map(r => r.metrics?.max_drawdown)
      .filter((dd): dd is number => typeof dd === 'number');
    const sharpes = stratRuns
      .map(r => r.metrics?.sharpe)
      .filter((s): s is number => typeof s === 'number');
    const cagrs = stratRuns
      .map(r => r.metrics?.cagr)
      .filter((c): c is number => typeof c === 'number');

    const maxDD = dds.length > 0 ? Math.max(...dds) : 0;
    const medianSharpe = sharpes.length > 0 ? median(sharpes) : 0;
    const winRate = cagrs.filter(c => c > 0).length / Math.max(cagrs.length, 1);

    sections.push(`  - **${stratKey}** (${stratRuns.length} runs):`);
    sections.push(`    - Max DD: ${(maxDD * 100).toFixed(1)}%`);
    sections.push(`    - Median Sharpe: ${medianSharpe.toFixed(2)}`);
    sections.push(`    - Win Rate: ${(winRate * 100).toFixed(0)}%`);

    // Identify dangerous regimes
    const failedRuns = stratRuns.filter(r => (r.metrics?.cagr || 0) < 0);
    if (failedRuns.length > 0) {
      const regimes = failedRuns.map(r => {
        const start = r.params?.startDate || 'unknown';
        const end = r.params?.endDate || 'unknown';
        return `${start} to ${end}`;
      });
      sections.push(`    - Failed in: ${regimes.join(', ')}`);
    }
  });

  // Regime exposure gaps
  const allDates = runs
    .flatMap(r => [r.params?.startDate, r.params?.endDate])
    .filter((d): d is string => typeof d === 'string')
    .sort();
  
  if (allDates.length >= 2) {
    const earliest = allDates[0];
    const latest = allDates[allDates.length - 1];
    sections.push(`\n**Regime Coverage**: ${earliest} to ${latest}`);
    
    // Check for gaps (simplified heuristic)
    const years = new Set(allDates.map(d => d.substring(0, 4)));
    const yearGaps: string[] = [];
    const currentYear = new Date().getFullYear();
    for (let y = parseInt(earliest.substring(0, 4)); y <= Math.min(parseInt(latest.substring(0, 4)), currentYear); y++) {
      if (!years.has(y.toString())) {
        yearGaps.push(y.toString());
      }
    }
    if (yearGaps.length > 0) {
      sections.push(`**WARNING**: No runs covering years: ${yearGaps.join(', ')}`);
    }
  }

  return sections.join('\n');
}

/**
 * Build risk-focused memory summary
 * 
 * Prioritizes high/critical rules and warnings
 */
export function buildRiskMemorySummary(notes: MemoryNote[]): string {
  if (notes.length === 0) {
    return "No memory rules or warnings available.";
  }

  // Filter for risk-relevant notes
  const riskNotes = notes.filter(n => 
    (n.memory_type === 'rule' || n.memory_type === 'warning') &&
    (n.importance === 'high' || n.importance === 'critical')
  );

  if (riskNotes.length === 0) {
    return "No high-priority rules or warnings in memory.";
  }

  const sections: string[] = ['**High-Priority Rules & Warnings**:'];

  // Group by importance
  const critical = riskNotes.filter(n => n.importance === 'critical');
  const high = riskNotes.filter(n => n.importance === 'high');

  if (critical.length > 0) {
    sections.push('\n**CRITICAL**:');
    critical.forEach(n => {
      const tags = n.tags || [];
      const tagsStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
      const typeLabel = n.memory_type === 'rule' ? 'Rule' : 'Warning';
      sections.push(`  - ${typeLabel}${tagsStr}: ${n.content.substring(0, 200)}${n.content.length > 200 ? '...' : ''}`);
    });
  }

  if (high.length > 0) {
    sections.push('\n**HIGH**:');
    high.slice(0, 10).forEach(n => {
      const tags = n.tags || [];
      const tagsStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
      const typeLabel = n.memory_type === 'rule' ? 'Rule' : 'Warning';
      sections.push(`  - ${typeLabel}${tagsStr}: ${n.content.substring(0, 150)}${n.content.length > 150 ? '...' : ''}`);
    });
  }

  return sections.join('\n');
}

/**
 * Calculate median of number array
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
