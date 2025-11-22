// Experiment planning helpers for Experiment Director mode

import type { BacktestRun, BacktestParams, BacktestMetrics } from '@/types/backtest';

interface MemoryNote {
  id: string;
  workspace_id: string;
  content: string;
  source: string;
  tags: string[];
  created_at: string;
  run_id: string | null;
  metadata: Record<string, any>;
  memory_type: string;
  importance: string;
  archived: boolean;
}

/**
 * Build a summary of recent backtest runs for experiment planning
 * Groups by strategy, highlights regime coverage gaps
 */
export function buildExperimentRunSummary(runs: BacktestRun[]): string {
  if (runs.length === 0) {
    return "No completed runs available for analysis.";
  }

  // Group runs by strategy
  const byStrategy = new Map<string, BacktestRun[]>();
  for (const run of runs) {
    if (!byStrategy.has(run.strategy_key)) {
      byStrategy.set(run.strategy_key, []);
    }
    byStrategy.get(run.strategy_key)!.push(run);
  }

  let summary = `=== BACKTEST RUN SUMMARY ===\n\n`;
  summary += `Total Runs: ${runs.length}\n`;
  summary += `Unique Strategies: ${byStrategy.size}\n\n`;

  // Analyze each strategy
  for (const [strategyKey, strategyRuns] of byStrategy.entries()) {
    summary += `## ${strategyKey.toUpperCase()}\n`;
    summary += `Runs: ${strategyRuns.length}\n\n`;

    // Extract date ranges
    const dateRanges: { start: string; end: string }[] = [];
    const metrics: (BacktestMetrics | null)[] = [];

    for (const run of strategyRuns) {
      if (run.params?.startDate && run.params?.endDate) {
        dateRanges.push({ start: run.params.startDate, end: run.params.endDate });
      }
      metrics.push(run.metrics);
    }

    // Date coverage analysis
    if (dateRanges.length > 0) {
      const startDates = dateRanges.map(r => new Date(r.start).getFullYear()).sort();
      const endDates = dateRanges.map(r => new Date(r.end).getFullYear()).sort();
      const minYear = Math.min(...startDates);
      const maxYear = Math.max(...endDates);

      summary += `**Date Coverage**:\n`;
      summary += `  Earliest: ${minYear}\n`;
      summary += `  Latest: ${maxYear}\n`;
      summary += `  Years tested: ${startDates.join(', ')}\n`;

      // Identify potential gaps
      const allYears = new Set(startDates.concat(endDates));
      const gaps: number[] = [];
      for (let year = minYear; year <= maxYear; year++) {
        if (!allYears.has(year)) {
          gaps.push(year);
        }
      }
      if (gaps.length > 0) {
        summary += `  **Potential Gaps**: ${gaps.join(', ')}\n`;
      }
      summary += '\n';
    }

    // Metrics summary
    if (metrics.length > 0) {
      const validCAGR = metrics.filter(m => m?.cagr !== undefined && m?.cagr !== null).map(m => m!.cagr);
      const validSharpe = metrics.filter(m => m?.sharpe !== undefined && m?.sharpe !== null).map(m => m!.sharpe);
      const validMaxDD = metrics.filter(m => m?.max_drawdown !== undefined && m?.max_drawdown !== null).map(m => m!.max_drawdown);

      if (validCAGR.length > 0) {
        const medianCAGR = validCAGR.sort((a, b) => a - b)[Math.floor(validCAGR.length / 2)];
        summary += `**Typical CAGR**: ${(medianCAGR * 100).toFixed(1)}%\n`;
      }
      if (validSharpe.length > 0) {
        const medianSharpe = validSharpe.sort((a, b) => a - b)[Math.floor(validSharpe.length / 2)];
        summary += `**Typical Sharpe**: ${medianSharpe.toFixed(2)}\n`;
      }
      if (validMaxDD.length > 0) {
        const medianMaxDD = validMaxDD.sort((a, b) => a - b)[Math.floor(validMaxDD.length / 2)];
        summary += `**Typical Max DD**: ${(medianMaxDD * 100).toFixed(1)}%\n`;
      }
      summary += '\n';
    }

    summary += '---\n\n';
  }

  // Regime coverage analysis
  summary += `## REGIME COVERAGE NOTES\n\n`;
  
  const allYears = new Set<number>();
  for (const run of runs) {
    if (run.params?.startDate && run.params?.endDate) {
      const startYear = new Date(run.params.startDate).getFullYear();
      const endYear = new Date(run.params.endDate).getFullYear();
      for (let year = startYear; year <= endYear; year++) {
        allYears.add(year);
      }
    }
  }

  const currentYear = new Date().getFullYear();
  const yearsArray = Array.from(allYears).sort();

  summary += `Years with data: ${yearsArray.join(', ')}\n\n`;

  // Highlight key regime periods not covered
  const keyRegimes = [
    { period: '2018', description: 'Late bull, vol compression' },
    { period: '2020-03', description: 'COVID crash' },
    { period: '2022', description: 'Fed tightening, bear market' },
    { period: '2023-2024', description: 'AI boom, rate uncertainty' },
  ];

  summary += `**Key Regime Periods to Consider**:\n`;
  for (const regime of keyRegimes) {
    summary += `- ${regime.period}: ${regime.description}\n`;
  }

  return summary;
}

/**
 * Build a memory summary focused on rules/insights relevant to experiment planning
 */
export function buildExperimentMemorySummary(notes: MemoryNote[]): string {
  if (notes.length === 0) {
    return "No memory notes available.";
  }

  // Prioritize high/critical rules and warnings
  const priorityNotes = notes
    .filter(n => 
      (n.memory_type === 'rule' || n.memory_type === 'warning') &&
      (n.importance === 'high' || n.importance === 'critical')
    )
    .slice(0, 10);

  // Also include relevant insights
  const insights = notes
    .filter(n => n.memory_type === 'insight' && n.importance === 'high')
    .slice(0, 5);

  const relevantNotes = [...priorityNotes, ...insights];

  if (relevantNotes.length === 0) {
    return "No high-priority rules or insights in memory.";
  }

  let summary = `=== MEMORY EVIDENCE ===\n\n`;

  // Group by type
  const rules = relevantNotes.filter(n => n.memory_type === 'rule');
  const warnings = relevantNotes.filter(n => n.memory_type === 'warning');
  const insightsList = relevantNotes.filter(n => n.memory_type === 'insight');

  if (rules.length > 0) {
    summary += `## RULES\n\n`;
    for (const rule of rules) {
      summary += `- [${rule.importance.toUpperCase()}] ${rule.content.slice(0, 150)}${rule.content.length > 150 ? '...' : ''}\n`;
      if (rule.tags.length > 0) {
        summary += `  Tags: ${rule.tags.join(', ')}\n`;
      }
      summary += '\n';
    }
  }

  if (warnings.length > 0) {
    summary += `## WARNINGS\n\n`;
    for (const warning of warnings) {
      summary += `- [${warning.importance.toUpperCase()}] ${warning.content.slice(0, 150)}${warning.content.length > 150 ? '...' : ''}\n`;
      if (warning.tags.length > 0) {
        summary += `  Tags: ${warning.tags.join(', ')}\n`;
      }
      summary += '\n';
    }
  }

  if (insightsList.length > 0) {
    summary += `## KEY INSIGHTS\n\n`;
    for (const insight of insightsList) {
      summary += `- ${insight.content.slice(0, 150)}${insight.content.length > 150 ? '...' : ''}\n`;
      if (insight.tags.length > 0) {
        summary += `  Tags: ${insight.tags.join(', ')}\n`;
      }
      summary += '\n';
    }
  }

  return summary;
}
