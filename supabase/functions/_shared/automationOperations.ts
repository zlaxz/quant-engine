/**
 * Automation Operations - Batch backtesting, parameter sweeps, regression testing
 * Phase 5: Workflow Automation
 */

interface ParamGrid {
  [key: string]: (string | number | boolean)[];
}

interface BacktestConfig {
  strategyKey: string;
  params: Record<string, any>;
  startDate: string;
  endDate: string;
  capital: number;
}

interface BacktestResult {
  id: string;
  params: Record<string, any>;
  metrics: {
    cagr: number;
    sharpe: number;
    max_drawdown: number;
    win_rate: number;
    total_trades: number;
  };
  status: string;
  error?: string;
}

/**
 * Generate all combinations from parameter grid
 */
function generateParamCombinations(grid: ParamGrid): Record<string, any>[] {
  const keys = Object.keys(grid);
  if (keys.length === 0) return [{}];

  const combinations: Record<string, any>[] = [];
  
  function recurse(index: number, current: Record<string, any>) {
    if (index === keys.length) {
      // CRITICAL: Create a copy to avoid all combinations referencing the same object
      combinations.push({ ...current });
      return;
    }
    
    const key = keys[index];
    const values = grid[key];
    
    for (const value of values) {
      recurse(index + 1, { ...current, [key]: value });
    }
  }
  
  recurse(0, {});
  return combinations;
}

/**
 * Generate parameter sweep values
 */
function generateSweepValues(start: number, end: number, step: number): number[] {
  // Validation
  if (step <= 0) {
    throw new Error('Step must be positive');
  }
  if (start > end) {
    throw new Error('Start must be less than or equal to end');
  }
  
  const values: number[] = [];
  for (let val = start; val <= end + 0.0001; val += step) {
    values.push(Math.round(val * 100000) / 100000); // Round to 5 decimals
  }
  return values;
}

/**
 * Run batch backtest with parameter grid
 */
export async function runBatchBacktest(
  supabaseClient: any,
  strategyKey: string,
  paramGrid: ParamGrid,
  baseConfig: { startDate: string; endDate: string; capital: number; sessionId?: string }
): Promise<{ success: boolean; results: BacktestResult[]; summary: string }> {
  try {
    // Validation
    if (!strategyKey || strategyKey.trim() === '') {
      return {
        success: false,
        results: [],
        summary: "Strategy key is required"
      };
    }
    
    if (new Date(baseConfig.startDate) >= new Date(baseConfig.endDate)) {
      return {
        success: false,
        results: [],
        summary: "Start date must be before end date"
      };
    }
    
    if (baseConfig.capital <= 0) {
      return {
        success: false,
        results: [],
        summary: "Capital must be positive"
      };
    }
    
    const combinations = generateParamCombinations(paramGrid);
    
    if (combinations.length === 0) {
      return {
        success: false,
        results: [],
        summary: "No parameter combinations generated from grid"
      };
    }

    if (combinations.length > 100) {
      return {
        success: false,
        results: [],
        summary: `Too many combinations (${combinations.length}). Maximum is 100.`
      };
    }

    // Run all backtests in parallel
    const backtestPromises = combinations.map(params =>
      supabaseClient.functions.invoke('backtest-run', {
        body: {
          sessionId: baseConfig.sessionId,
          strategyKey,
          params: {
            ...params,
            startDate: baseConfig.startDate,
            endDate: baseConfig.endDate,
            capital: baseConfig.capital
          }
        }
      })
    );

    const results = await Promise.all(backtestPromises);
    
    // Process results
    const backtestResults: BacktestResult[] = results.map((res, idx) => {
      if (res.error) {
        return {
          id: '',
          params: combinations[idx],
          metrics: { cagr: 0, sharpe: 0, max_drawdown: 0, win_rate: 0, total_trades: 0 },
          status: 'failed',
          error: res.error.message || 'Unknown error'
        };
      }
      
      const data = res.data;
      return {
        id: data.id,
        params: combinations[idx],
        metrics: data.metrics || { cagr: 0, sharpe: 0, max_drawdown: 0, win_rate: 0, total_trades: 0 },
        status: data.status
      };
    });

    // Rank by Sharpe ratio
    const successfulResults = backtestResults.filter(r => r.status === 'completed');
    successfulResults.sort((a, b) => (b.metrics.sharpe || 0) - (a.metrics.sharpe || 0));

    // Generate summary
    const summary = generateBatchSummary(successfulResults, backtestResults, combinations.length);

    return {
      success: true,
      results: backtestResults,
      summary
    };
  } catch (error) {
    return {
      success: false,
      results: [],
      summary: `Batch backtest failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Generate summary of batch backtest results
 */
function generateBatchSummary(
  successfulResults: BacktestResult[], 
  allResults: BacktestResult[],
  totalCombinations: number
): string {
  const failedCount = allResults.filter(r => r.status === 'failed').length;
  
  if (successfulResults.length === 0) {
    return `Completed ${totalCombinations} backtests, but all failed.${failedCount > 0 ? `\n\nFailure examples:\n${allResults.filter(r => r.error).slice(0, 3).map(r => `- ${r.error}`).join('\n')}` : ''}`;
  }

  const top5 = successfulResults.slice(0, Math.min(5, successfulResults.length));
  
  let summary = `Batch Backtest Complete: ${successfulResults.length}/${totalCombinations} successful`;
  if (failedCount > 0) {
    summary += ` (${failedCount} failed)`;
  }
  summary += `\n\nTop ${top5.length} Performers (by Sharpe):\n`;
  
  top5.forEach((r, idx) => {
    const paramsStr = Object.entries(r.params)
      .filter(([key]) => !['startDate', 'endDate', 'capital'].includes(key))
      .map(([key, val]) => `${key}=${val}`)
      .join(', ');
    summary += `${idx + 1}. Sharpe=${r.metrics.sharpe?.toFixed(2) || 'N/A'}, CAGR=${((r.metrics.cagr || 0) * 100).toFixed(1)}%, MDD=${((r.metrics.max_drawdown || 0) * 100).toFixed(1)}% | ${paramsStr}\n`;
  });

  return summary;
}

/**
 * Run parameter sweep for single parameter
 */
export async function runParameterSweep(
  supabaseClient: any,
  strategyKey: string,
  paramName: string,
  start: number,
  end: number,
  step: number,
  baseConfig: { startDate: string; endDate: string; capital: number; sessionId?: string }
): Promise<{ success: boolean; results: BacktestResult[]; summary: string }> {
  try {
    // Validation
    if (!paramName || paramName.trim() === '') {
      return {
        success: false,
        results: [],
        summary: "Parameter name is required"
      };
    }
    
    const values = generateSweepValues(start, end, step);
    
    if (values.length === 0) {
      return {
        success: false,
        results: [],
        summary: "No sweep values generated"
      };
    }

    if (values.length > 50) {
      return {
        success: false,
        results: [],
        summary: `Too many sweep points (${values.length}). Maximum is 50. Try increasing step size.`
      };
    }

    // Create parameter grid with single parameter
    const paramGrid: ParamGrid = { [paramName]: values };
    
    return await runBatchBacktest(supabaseClient, strategyKey, paramGrid, baseConfig);
  } catch (error) {
    return {
      success: false,
      results: [],
      summary: `Parameter sweep failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Run regression test - compare current strategy to historical benchmark
 */
export async function runRegressionTest(
  supabaseClient: any,
  strategyKey: string,
  benchmarkRunId: string,
  currentParams: Record<string, any>,
  baseConfig: { startDate: string; endDate: string; capital: number; sessionId?: string }
): Promise<{ success: boolean; comparison: any; summary: string }> {
  try {
    // Validation
    if (!benchmarkRunId || benchmarkRunId.trim() === '') {
      return {
        success: false,
        comparison: null,
        summary: "Benchmark run ID is required"
      };
    }
    
    // CRITICAL FIX: Use maybeSingle() instead of single() to handle missing benchmark gracefully
    const { data: benchmarkRun, error: fetchError } = await supabaseClient
      .from('backtest_runs')
      .select('*')
      .eq('id', benchmarkRunId)
      .maybeSingle();

    if (fetchError) {
      return {
        success: false,
        comparison: null,
        summary: `Failed to fetch benchmark run: ${fetchError.message}`
      };
    }
    
    if (!benchmarkRun) {
      return {
        success: false,
        comparison: null,
        summary: `Benchmark run with ID ${benchmarkRunId} not found`
      };
    }

    // Run current strategy
    const { data: currentRun, error: runError } = await supabaseClient.functions.invoke('backtest-run', {
      body: {
        sessionId: baseConfig.sessionId,
        strategyKey,
        params: {
          ...currentParams,
          startDate: baseConfig.startDate,
          endDate: baseConfig.endDate,
          capital: baseConfig.capital
        }
      }
    });

    if (runError || !currentRun) {
      return {
        success: false,
        comparison: null,
        summary: `Failed to run current strategy: ${runError?.message || 'Unknown error'}`
      };
    }

    // Compare metrics
    const benchmarkMetrics = benchmarkRun.metrics || {};
    const currentMetrics = currentRun.metrics || {};

    const comparison = {
      benchmark: {
        id: benchmarkRun.id,
        metrics: benchmarkMetrics
      },
      current: {
        id: currentRun.id,
        metrics: currentMetrics
      },
      deltas: {
        cagr: (currentMetrics.cagr || 0) - (benchmarkMetrics.cagr || 0),
        sharpe: (currentMetrics.sharpe || 0) - (benchmarkMetrics.sharpe || 0),
        max_drawdown: (currentMetrics.max_drawdown || 0) - (benchmarkMetrics.max_drawdown || 0),
        win_rate: (currentMetrics.win_rate || 0) - (benchmarkMetrics.win_rate || 0)
      }
    };

    // Generate summary
    const summary = generateRegressionSummary(comparison);

    return {
      success: true,
      comparison,
      summary
    };
  } catch (error) {
    return {
      success: false,
      comparison: null,
      summary: `Regression test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Generate summary of regression test
 */
function generateRegressionSummary(comparison: any): string {
  const { deltas } = comparison;
  
  let summary = `Regression Test Results:\n\n`;
  summary += `CAGR: ${deltas.cagr >= 0 ? '+' : ''}${(deltas.cagr * 100).toFixed(2)}%\n`;
  summary += `Sharpe: ${deltas.sharpe >= 0 ? '+' : ''}${deltas.sharpe.toFixed(2)}\n`;
  summary += `Max Drawdown: ${deltas.max_drawdown >= 0 ? '+' : ''}${(deltas.max_drawdown * 100).toFixed(2)}%\n`;
  summary += `Win Rate: ${deltas.win_rate >= 0 ? '+' : ''}${(deltas.win_rate * 100).toFixed(2)}%\n\n`;
  
  // Detect degradation
  // Note: max_drawdown is negative, so a MORE negative value (larger drawdown) is worse
  const degraded = deltas.sharpe < -0.2 || deltas.cagr < -0.05 || deltas.max_drawdown < -0.05;
  
  if (degraded) {
    summary += `⚠️ WARNING: Performance degradation detected`;
  } else if (deltas.sharpe > 0.2 && deltas.cagr > 0.05 && deltas.max_drawdown > -0.05) {
    summary += `✅ IMPROVEMENT: Significant performance gains`;
  } else {
    summary += `✅ STABLE: Performance within acceptable range`;
  }
  
  return summary;
}

/**
 * Run cross-validation with walk-forward analysis
 */
export async function runCrossValidation(
  supabaseClient: any,
  strategyKey: string,
  params: Record<string, any>,
  config: {
    startDate: string;
    endDate: string;
    capital: number;
    inSampleRatio: number; // e.g., 0.7 for 70% in-sample, 30% out-of-sample
    numFolds: number;
    sessionId?: string;
  }
): Promise<{ success: boolean; folds: any[]; summary: string }> {
  try {
    const { startDate, endDate, inSampleRatio, numFolds } = config;
    
    // Validation
    if (inSampleRatio <= 0 || inSampleRatio >= 1) {
      return {
        success: false,
        folds: [],
        summary: "In-sample ratio must be between 0 and 1 (e.g., 0.7 for 70%)"
      };
    }
    
    if (numFolds < 2) {
      return {
        success: false,
        folds: [],
        summary: "Number of folds must be at least 2"
      };
    }
    
    if (numFolds > 10) {
      return {
        success: false,
        folds: [],
        summary: "Number of folds cannot exceed 10 (too computationally expensive)"
      };
    }
    
    // Calculate date splits
    const start = new Date(startDate);
    const end = new Date(endDate);
    const totalDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const daysPerFold = Math.floor(totalDays / numFolds);
    
    if (daysPerFold < 30) {
      return {
        success: false,
        folds: [],
        summary: `Period too short for ${numFolds} folds. Need at least ${numFolds * 30} days (have ${totalDays} days).`
      };
    }
    
    // Check out-of-sample period is meaningful
    const outOfSampleDays = Math.floor(daysPerFold * (1 - inSampleRatio));
    if (outOfSampleDays < 7) {
      return {
        success: false,
        folds: [],
        summary: `Out-of-sample period too short (${outOfSampleDays} days). Increase fold size or decrease in-sample ratio.`
      };
    }

    const folds: any[] = [];
    
    // Generate folds
    for (let i = 0; i < numFolds; i++) {
      const foldStart = new Date(start.getTime() + i * daysPerFold * 24 * 60 * 60 * 1000);
      // For last fold, use the actual end date to ensure full coverage
      const foldEnd = (i === numFolds - 1) 
        ? end 
        : new Date(foldStart.getTime() + daysPerFold * 24 * 60 * 60 * 1000);
      
      const inSampleDays = Math.floor(daysPerFold * inSampleRatio);
      const inSampleEnd = new Date(foldStart.getTime() + inSampleDays * 24 * 60 * 60 * 1000);
      
      // Run in-sample backtest
      const { data: inSampleRun, error: inError } = await supabaseClient.functions.invoke('backtest-run', {
        body: {
          sessionId: config.sessionId,
          strategyKey,
          params: {
            ...params,
            startDate: foldStart.toISOString().split('T')[0],
            endDate: inSampleEnd.toISOString().split('T')[0],
            capital: config.capital
          }
        }
      });
      
      // Run out-of-sample backtest
      const { data: outSampleRun, error: outError } = await supabaseClient.functions.invoke('backtest-run', {
        body: {
          sessionId: config.sessionId,
          strategyKey,
          params: {
            ...params,
            startDate: inSampleEnd.toISOString().split('T')[0],
            endDate: foldEnd.toISOString().split('T')[0],
            capital: config.capital
          }
        }
      });
      
      folds.push({
        foldNumber: i + 1,
        inSample: {
          startDate: foldStart.toISOString().split('T')[0],
          endDate: inSampleEnd.toISOString().split('T')[0],
          metrics: inSampleRun?.metrics || {},
          error: inError?.message
        },
        outSample: {
          startDate: inSampleEnd.toISOString().split('T')[0],
          endDate: foldEnd.toISOString().split('T')[0],
          metrics: outSampleRun?.metrics || {},
          error: outError?.message
        }
      });
    }

    // Generate summary
    const summary = generateCrossValidationSummary(folds);

    return {
      success: true,
      folds,
      summary
    };
  } catch (error) {
    return {
      success: false,
      folds: [],
      summary: `Cross-validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Generate summary of cross-validation results
 */
function generateCrossValidationSummary(folds: any[]): string {
  let summary = `Cross-Validation Results (${folds.length} folds):\n\n`;
  
  // Calculate average metrics
  let avgInSampleSharpe = 0;
  let avgOutSampleSharpe = 0;
  let successfulFolds = 0;
  
  folds.forEach(fold => {
    if (!fold.inSample.error && !fold.outSample.error) {
      avgInSampleSharpe += fold.inSample.metrics.sharpe || 0;
      avgOutSampleSharpe += fold.outSample.metrics.sharpe || 0;
      successfulFolds++;
    }
  });
  
  if (successfulFolds > 0) {
    avgInSampleSharpe /= successfulFolds;
    avgOutSampleSharpe /= successfulFolds;
    
    summary += `Average In-Sample Sharpe: ${avgInSampleSharpe.toFixed(2)}\n`;
    summary += `Average Out-of-Sample Sharpe: ${avgOutSampleSharpe.toFixed(2)}\n`;
    summary += `Sharpe Degradation: ${((avgOutSampleSharpe - avgInSampleSharpe) / avgInSampleSharpe * 100).toFixed(1)}%\n\n`;
    
    // Detect overfitting
    const degradation = (avgInSampleSharpe - avgOutSampleSharpe) / avgInSampleSharpe;
    
    if (degradation > 0.3) {
      summary += `⚠️ OVERFITTING DETECTED: Out-of-sample performance significantly worse than in-sample`;
    } else if (degradation > 0.15) {
      summary += `⚠️ CAUTION: Moderate performance degradation out-of-sample`;
    } else {
      summary += `✅ ROBUST: Strategy generalizes well to unseen data`;
    }
  } else {
    summary += `All folds failed. Check strategy implementation.`;
  }
  
  return summary;
}
