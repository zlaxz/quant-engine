/**
 * Pattern Miner summarization utilities
 * Aggregate backtest runs and memory for pattern detection
 */

import type { BacktestRun } from '@/types/backtest';

export interface MemoryNote {
  id: string;
  content: string;
  memory_type: string;
  importance: string;
  tags: string[];
  run_id?: string | null;
  created_at: string;
  source: string;
  archived?: boolean;
}

/**
 * Build aggregated summary of runs grouped by strategy and regime
 */
export function buildRunsAggregate(runs: BacktestRun[]): string {
  if (runs.length === 0) {
    return 'No runs available for analysis.';
  }

  // Group by strategy
  const byStrategy = runs.reduce((acc, run) => {
    const key = run.strategy_key;
    if (!acc[key]) acc[key] = [];
    acc[key].push(run);
    return acc;
  }, {} as Record<string, BacktestRun[]>);

  const sections: string[] = [];

  sections.push(`Total Runs Analyzed: ${runs.length}`);
  sections.push(`Strategies Covered: ${Object.keys(byStrategy).length}`);
  sections.push('');

  // For each strategy, compute aggregate metrics
  for (const [strategyKey, strategyRuns] of Object.entries(byStrategy)) {
    sections.push(`## Strategy: ${strategyKey}`);
    sections.push(`Runs: ${strategyRuns.length}`);

    const cagrs = strategyRuns.map(r => r.metrics?.cagr || 0);
    const sharpes = strategyRuns.map(r => r.metrics?.sharpe || 0);
    const maxDDs = strategyRuns.map(r => r.metrics?.max_drawdown || 0);
    const winRates = strategyRuns.map(r => r.metrics?.win_rate || 0);

    const medianCAGR = median(cagrs);
    const medianSharpe = median(sharpes);
    const medianMaxDD = median(maxDDs);
    const medianWinRate = median(winRates);

    sections.push(`  Median CAGR: ${(medianCAGR * 100).toFixed(2)}%`);
    sections.push(`  Median Sharpe: ${medianSharpe.toFixed(2)}`);
    sections.push(`  Median Max DD: ${(medianMaxDD * 100).toFixed(2)}%`);
    sections.push(`  Median Win Rate: ${(medianWinRate * 100).toFixed(1)}%`);

    // Failure frequency
    const failures = strategyRuns.filter(r => (r.metrics?.cagr || 0) <= 0).length;
    const failureRate = (failures / strategyRuns.length) * 100;
    sections.push(`  Failure Rate: ${failureRate.toFixed(1)}% (${failures}/${strategyRuns.length} runs with CAGR ≤ 0)`);

    // Regime breakdown (simple year-based grouping)
    const byYear = strategyRuns.reduce((acc, run) => {
      const startYear = run.params?.startDate?.slice(0, 4) || 'unknown';
      if (!acc[startYear]) acc[startYear] = [];
      acc[startYear].push(run);
      return acc;
    }, {} as Record<string, BacktestRun[]>);

    if (Object.keys(byYear).length > 1) {
      sections.push(`  Regime Breakdown:`);
      for (const [year, yearRuns] of Object.entries(byYear).sort()) {
        const avgCAGR = yearRuns.reduce((sum, r) => sum + (r.metrics?.cagr || 0), 0) / yearRuns.length;
        sections.push(`    ${year}: ${yearRuns.length} runs, avg CAGR ${(avgCAGR * 100).toFixed(2)}%`);
      }
    }

    sections.push('');
  }

  return sections.join('\n');
}

/**
 * Build memory summary prioritizing rules, warnings, and high-importance items
 */
export function buildRelevantMemory(notes: MemoryNote[], strategyKeys: string[]): string {
  if (notes.length === 0) {
    return 'No relevant memory notes found.';
  }

  // Prioritize rules and warnings with high/critical importance
  const prioritized = notes
    .filter(n => !n.archived) // Exclude archived
    .sort((a, b) => {
      // Sort by importance and type
      const importanceOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const typeOrder = { rule: 0, warning: 1, insight: 2, todo: 3, bug: 4, profile_change: 5 };
      
      const aImportance = importanceOrder[a.importance as keyof typeof importanceOrder] ?? 4;
      const bImportance = importanceOrder[b.importance as keyof typeof importanceOrder] ?? 4;
      
      if (aImportance !== bImportance) return aImportance - bImportance;
      
      const aType = typeOrder[a.memory_type as keyof typeof typeOrder] ?? 6;
      const bType = typeOrder[b.memory_type as keyof typeof typeOrder] ?? 6;
      
      return aType - bType;
    })
    .slice(0, 15); // Limit to top 15

  const sections: string[] = [];
  
  sections.push(`Total Memory Notes: ${notes.length} (showing top ${prioritized.length})`);
  sections.push('');

  // Group by type
  const byType = prioritized.reduce((acc, note) => {
    const type = note.memory_type || 'insight';
    if (!acc[type]) acc[type] = [];
    acc[type].push(note);
    return acc;
  }, {} as Record<string, MemoryNote[]>);

  for (const [type, typeNotes] of Object.entries(byType)) {
    const emoji = type === 'rule' ? '📏' : type === 'warning' ? '⚠️' : type === 'bug' ? '🐛' : '💡';
    sections.push(`## ${emoji} ${type.toUpperCase()} (${typeNotes.length})`);
    
    for (const note of typeNotes) {
      const importance = note.importance === 'critical' ? '🔴' : note.importance === 'high' ? '🟠' : '';
      const tags = note.tags && note.tags.length > 0 ? ` [${note.tags.join(', ')}]` : '';
      const runLink = note.run_id ? ` (run-linked)` : '';
      
      sections.push(`${importance} ${note.content.slice(0, 150)}${note.content.length > 150 ? '...' : ''}${tags}${runLink}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * Calculate median of numeric array
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
