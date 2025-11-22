/**
 * Autonomous Research Loop Orchestration
 * 
 * Combines all agent modes (Auditor, Pattern Miner, Curator, Experiment Director, Risk Officer)
 * to produce comprehensive research reports.
 */

import type { BacktestRun, BacktestParams } from '@/types/backtest';

export interface KeyRunSelection {
  bestSharpe: BacktestRun | null;
  worstDrawdown: BacktestRun | null;
  mostRecent: BacktestRun | null;
  outliers: BacktestRun[];
}

/**
 * Select 3-5 representative runs from a larger set
 * Picks best Sharpe, worst MaxDD, most recent, and outliers
 */
export function selectKeyRuns(runs: BacktestRun[]): BacktestRun[] {
  if (runs.length === 0) return [];
  if (runs.length <= 5) return runs;

  const selected = new Set<BacktestRun>();

  // Best Sharpe ratio
  const validSharpeRuns = runs.filter(r => r.metrics?.sharpe != null);
  if (validSharpeRuns.length > 0) {
    const bestSharpe = validSharpeRuns.reduce((best, run) => 
      (run.metrics.sharpe > (best.metrics?.sharpe || -Infinity)) ? run : best
    );
    selected.add(bestSharpe);
  }

  // Worst max drawdown (highest absolute value)
  const validDDRuns = runs.filter(r => r.metrics?.max_drawdown != null);
  if (validDDRuns.length > 0) {
    const worstDD = validDDRuns.reduce((worst, run) =>
      (Math.abs(run.metrics.max_drawdown) > Math.abs(worst.metrics?.max_drawdown || 0)) ? run : worst
    );
    selected.add(worstDD);
  }

  // Most recent
  const sortedByDate = [...runs].sort((a, b) => 
    new Date(b.completed_at || b.started_at || 0).getTime() - 
    new Date(a.completed_at || a.started_at || 0).getTime()
  );
  if (sortedByDate[0]) {
    selected.add(sortedByDate[0]);
  }

  // Add outliers (extreme CAGR or very low win rate)
  const validCAGRRuns = runs.filter(r => r.metrics?.cagr != null);
  if (validCAGRRuns.length > 0) {
    // Highest CAGR
    const highestCAGR = validCAGRRuns.reduce((max, run) =>
      (run.metrics.cagr > (max.metrics?.cagr || -Infinity)) ? run : max
    );
    if (selected.size < 5) selected.add(highestCAGR);

    // Lowest CAGR (if negative)
    const lowestCAGR = validCAGRRuns.reduce((min, run) =>
      (run.metrics.cagr < (min.metrics?.cagr || Infinity)) ? run : min
    );
    if (selected.size < 5 && lowestCAGR.metrics.cagr < 0) {
      selected.add(lowestCAGR);
    }
  }

  // Add low win rate runs if space available
  const validWinRateRuns = runs.filter(r => r.metrics?.win_rate != null && r.metrics.win_rate < 0.4);
  if (selected.size < 5 && validWinRateRuns.length > 0) {
    selected.add(validWinRateRuns[0]);
  }

  return Array.from(selected).slice(0, 5);
}

/**
 * Build a portfolio summary of runs for LLM context
 */
export function buildRunPortfolioSummary(runs: BacktestRun[]): string {
  if (runs.length === 0) {
    return 'No completed runs available.';
  }

  // Group by strategy
  const byStrategy = new Map<string, BacktestRun[]>();
  for (const run of runs) {
    const key = run.strategy_key;
    if (!byStrategy.has(key)) {
      byStrategy.set(key, []);
    }
    byStrategy.get(key)!.push(run);
  }

  // Calculate aggregate metrics
  const validCAGR = runs.filter(r => r.metrics?.cagr != null).map(r => r.metrics.cagr);
  const validSharpe = runs.filter(r => r.metrics?.sharpe != null).map(r => r.metrics.sharpe);
  const validDD = runs.filter(r => r.metrics?.max_drawdown != null).map(r => r.metrics.max_drawdown);
  const validWinRate = runs.filter(r => r.metrics?.win_rate != null).map(r => r.metrics.win_rate);

  const median = (arr: number[]) => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };

  // Detect regime coverage from date ranges
  const dateRanges = runs
    .filter((r): r is typeof r & { params: BacktestParams } => 
      r.params && typeof r.params === 'object' && 'startDate' in r.params && 'endDate' in r.params
    )
    .map(r => ({
      start: r.params.startDate,
      end: r.params.endDate
    }));

  const uniqueYears = new Set<number>();
  for (const range of dateRanges) {
    try {
      const startYear = new Date(range.start).getFullYear();
      const endYear = new Date(range.end).getFullYear();
      for (let y = startYear; y <= endYear; y++) {
        uniqueYears.add(y);
      }
    } catch {
      // Skip invalid dates
    }
  }

  // Build summary text
  let summary = `## Run Portfolio Summary\n\n`;
  summary += `**Total Runs**: ${runs.length}\n`;
  summary += `**Strategies**: ${byStrategy.size}\n\n`;

  // Strategy breakdown
  summary += `### By Strategy:\n`;
  for (const [strategy, stratRuns] of byStrategy.entries()) {
    const stratMedianCAGR = median(stratRuns.filter(r => r.metrics?.cagr != null).map(r => r.metrics.cagr));
    const stratMedianSharpe = median(stratRuns.filter(r => r.metrics?.sharpe != null).map(r => r.metrics.sharpe));
    summary += `- **${strategy}**: ${stratRuns.length} runs`;
    if (stratMedianCAGR !== null) summary += `, median CAGR: ${(stratMedianCAGR * 100).toFixed(1)}%`;
    if (stratMedianSharpe !== null) summary += `, median Sharpe: ${stratMedianSharpe.toFixed(2)}`;
    summary += `\n`;
  }

  // Aggregate metrics
  summary += `\n### Aggregate Metrics:\n`;
  if (validCAGR.length > 0) {
    summary += `- **CAGR**: median ${(median(validCAGR)! * 100).toFixed(1)}%, range [${(Math.min(...validCAGR) * 100).toFixed(1)}%, ${(Math.max(...validCAGR) * 100).toFixed(1)}%]\n`;
  }
  if (validSharpe.length > 0) {
    summary += `- **Sharpe**: median ${median(validSharpe)!.toFixed(2)}, range [${Math.min(...validSharpe).toFixed(2)}, ${Math.max(...validSharpe).toFixed(2)}]\n`;
  }
  if (validDD.length > 0) {
    summary += `- **Max Drawdown**: median ${(median(validDD)! * 100).toFixed(1)}%, worst ${(Math.min(...validDD) * 100).toFixed(1)}%\n`;
  }
  if (validWinRate.length > 0) {
    summary += `- **Win Rate**: median ${(median(validWinRate)! * 100).toFixed(1)}%\n`;
  }

  // Regime coverage
  if (uniqueYears.size > 0) {
    const years = Array.from(uniqueYears).sort();
    summary += `\n### Regime Coverage:\n`;
    summary += `- Years tested: ${years.join(', ')}\n`;
    
    // Identify gaps
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const missingYears = [];
    for (let y = minYear; y <= maxYear; y++) {
      if (!uniqueYears.has(y)) missingYears.push(y);
    }
    if (missingYears.length > 0) {
      summary += `- **Coverage gaps**: ${missingYears.join(', ')}\n`;
    }
  }

  // Biggest wins/losses
  if (validCAGR.length > 0) {
    const bestRun = runs.find(r => r.metrics?.cagr === Math.max(...validCAGR));
    const worstRun = runs.find(r => r.metrics?.cagr === Math.min(...validCAGR));
    summary += `\n### Extremes:\n`;
    if (bestRun) {
      summary += `- **Best performance**: ${bestRun.strategy_key} with ${(bestRun.metrics.cagr * 100).toFixed(1)}% CAGR\n`;
    }
    if (worstRun && worstRun.metrics.cagr < 0) {
      summary += `- **Worst performance**: ${worstRun.strategy_key} with ${(worstRun.metrics.cagr * 100).toFixed(1)}% CAGR\n`;
    }
  }

  return summary;
}

/**
 * Assemble inputs from all agent modes into a single analysis context
 */
export function assembleAgentInputs(
  runSummary: string,
  auditResults: string[],
  patternSummary: string,
  memorySummary: string,
  riskSummary: string,
  experimentSummary: string
): string {
  let analysis = `# Autonomous Research Analysis Input\n\n`;

  // Portfolio overview
  analysis += `## Run Portfolio\n\n${runSummary}\n\n`;

  // Key run audits
  if (auditResults.length > 0) {
    analysis += `## Key Run Audits\n\n`;
    auditResults.forEach((audit, i) => {
      analysis += `### Run ${i + 1} Audit\n\n${audit}\n\n`;
    });
  }

  // Pattern mining
  if (patternSummary.trim()) {
    analysis += `## Pattern Mining Results\n\n${patternSummary}\n\n`;
  }

  // Memory curation
  if (memorySummary.trim()) {
    analysis += `## Memory Curation\n\n${memorySummary}\n\n`;
  }

  // Risk review
  if (riskSummary.trim()) {
    analysis += `## Risk Assessment\n\n${riskSummary}\n\n`;
  }

  // Experiment suggestions
  if (experimentSummary.trim()) {
    analysis += `## Experiment Proposals\n\n${experimentSummary}\n\n`;
  }

  return analysis;
}
