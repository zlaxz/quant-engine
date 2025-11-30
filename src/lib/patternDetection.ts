import { PersonalPattern } from "@/components/research/ContextualEducationOverlay";

interface BacktestRun {
  id: string;
  strategy_key: string;
  metrics: any;
  started_at: string;
  status: string;
  notes?: string;
  params?: any;
}

interface PatternDetectionResult {
  pattern: PersonalPattern | null;
  confidence: number;
}

/**
 * Analyzes backtest history to detect repeated failure patterns
 */
export class PatternDetector {
  /**
   * Detect if user is repeating a known mistake pattern
   */
  static async detectPattern(
    recentRuns: BacktestRun[],
    currentContext: string
  ): Promise<PatternDetectionResult> {
    if (recentRuns.length < 3) {
      return { pattern: null, confidence: 0 };
    }

    // Check for walk-forward validation missing pattern
    const walkForwardPattern = this.detectMissingWalkForward(
      recentRuns,
      currentContext
    );
    if (walkForwardPattern) return walkForwardPattern;

    // Check for overfitting pattern (high in-sample, low out-of-sample)
    const overfittingPattern = this.detectOverfitting(
      recentRuns,
      currentContext
    );
    if (overfittingPattern) return overfittingPattern;

    // Check for repeated parameter mistakes
    const parameterPattern = this.detectParameterMistakes(
      recentRuns,
      currentContext
    );
    if (parameterPattern) return parameterPattern;

    return { pattern: null, confidence: 0 };
  }

  private static detectMissingWalkForward(
    runs: BacktestRun[],
    context: string
  ): PatternDetectionResult | null {
    const failedRuns = runs.filter(
      (run) =>
        run.status === "completed" &&
        run.metrics?.sharpe_ratio &&
        run.metrics.sharpe_ratio < 0.5 &&
        !this.hasWalkForwardValidation(run)
    );

    if (failedRuns.length >= 3 && context.toLowerCase().includes("backtest")) {
      const failures = failedRuns.slice(0, 3).map((run) => ({
        date: run.started_at,
        runId: run.id,
        strategyName: run.strategy_key,
        degradation: this.calculateDegradation(run),
        details: "Missing walk-forward validation",
      }));

      return {
        pattern: {
          id: `pattern_${Date.now()}`,
          patternType: "MISSING_VALIDATION",
          title: "You keep forgetting walk-forward validation",
          description:
            "Walk-forward validation tests strategy on unseen data periods to prevent overfitting. Without it, backtest results are unreliable.",
          occurrences: failedRuns.length,
          lastOccurrence: failedRuns[0].started_at,
          failures,
          recommendation:
            "Add --walk-forward flag to your backtest command, or configure walk_forward_periods in strategy params. Test on at least 3 forward periods.",
          severity: "high",
        },
        confidence: 0.85,
      };
    }

    return null;
  }

  private static detectOverfitting(
    runs: BacktestRun[],
    context: string
  ): PatternDetectionResult | null {
    const overfitRuns = runs.filter((run) => {
      if (!run.metrics) return false;
      const inSample = run.metrics.in_sample_sharpe || 0;
      const outSample = run.metrics.out_sample_sharpe || 0;
      return inSample > 1.5 && outSample < 0.5;
    });

    if (overfitRuns.length >= 2 && context.toLowerCase().includes("strategy")) {
      const failures = overfitRuns.slice(0, 3).map((run) => ({
        date: run.started_at,
        runId: run.id,
        strategyName: run.strategy_key,
        degradation: this.calculateDegradation(run),
        details: `In-sample: ${run.metrics.in_sample_sharpe?.toFixed(2)}, Out-sample: ${run.metrics.out_sample_sharpe?.toFixed(2)}`,
      }));

      return {
        pattern: {
          id: `pattern_${Date.now()}`,
          patternType: "OVERFITTING",
          title: "Your strategies are overfitting to historical data",
          description:
            "High in-sample performance but poor out-of-sample results indicates curve-fitting to past data. Strategy won't generalize to new market conditions.",
          occurrences: overfitRuns.length,
          lastOccurrence: overfitRuns[0].started_at,
          failures,
          recommendation:
            "Use simpler models with fewer parameters. Increase regularization. Test on multiple time periods. Focus on structural edge, not parameter optimization.",
          severity: "high",
        },
        confidence: 0.9,
      };
    }

    return null;
  }

  private static detectParameterMistakes(
    runs: BacktestRun[],
    _context: string
  ): PatternDetectionResult | null {
    // Check for repeated use of risky parameter values
    const riskyParams = runs.filter((run) => {
      if (!run.params) return false;
      return (
        run.params.max_position_size > 1.0 || // Over-leveraged
        run.params.stop_loss === undefined || // No stop loss
        run.params.max_drawdown === undefined // No drawdown limit
      );
    });

    if (riskyParams.length >= 2) {
      const failures = riskyParams.slice(0, 3).map((run) => ({
        date: run.started_at,
        runId: run.id,
        strategyName: run.strategy_key,
        degradation: Math.abs(run.metrics?.max_drawdown || 50),
        details: this.identifyRiskyParam(run),
      }));

      return {
        pattern: {
          id: `pattern_${Date.now()}`,
          patternType: "RISKY_PARAMS",
          title: "You're using unsafe risk parameters repeatedly",
          description:
            "Missing stop losses or position limits leads to catastrophic drawdowns. Risk management is not optional.",
          occurrences: riskyParams.length,
          lastOccurrence: riskyParams[0].started_at,
          failures,
          recommendation:
            "Always set max_position_size ≤ 0.1 (10% of capital), stop_loss (e.g., -2%), and max_drawdown (e.g., -15%). Risk management protects capital.",
          severity: "high",
        },
        confidence: 0.8,
      };
    }

    return null;
  }

  private static hasWalkForwardValidation(run: BacktestRun): boolean {
    return (
      run.params?.walk_forward_periods > 0 ||
      run.notes?.toLowerCase().includes("walk-forward") ||
      false
    );
  }

  private static calculateDegradation(run: BacktestRun): number {
    if (!run.metrics) return 0;
    const inSample = run.metrics.in_sample_sharpe || 0;
    const outSample = run.metrics.out_sample_sharpe || 0;
    if (inSample === 0) return 0;
    return Math.round(((outSample - inSample) / inSample) * 100);
  }

  private static identifyRiskyParam(run: BacktestRun): string {
    if (!run.params) return "Missing risk parameters";
    if (run.params.max_position_size > 1.0)
      return "Position size > 100% (over-leveraged)";
    if (run.params.stop_loss === undefined) return "No stop loss defined";
    if (run.params.max_drawdown === undefined) return "No drawdown limit";
    return "Unsafe risk configuration";
  }
}
