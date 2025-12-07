#!/usr/bin/env python3
"""
PlaybookBuilder: Strategy Aggregation and Playbook Generation
==============================================================

Aggregates validated strategies into an executable playbook for production.

Three-Set Validation Framework:
1. Discovery Set - where strategies are found
2. Validation Set - independent validation
3. Walk-Forward Set - out-of-sample forward testing

Only strategies that SURVIVE all three sets make it to the playbook.

Usage:
    builder = PlaybookBuilder(validation_results)
    survivors = builder.filter_survivors(min_sharpe=0.5)
    allocation = builder.calculate_allocation(survivors, method="risk_parity")
    playbook = builder.build_playbook()
    builder.export_playbook("/path/to/playbook.json")
    print(builder.generate_report())
"""

import json
import logging
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Literal, Optional, Tuple, Any
from collections import defaultdict

import numpy as np
import pandas as pd

logger = logging.getLogger("AlphaFactory.PlaybookBuilder")


class NumpyEncoder(json.JSONEncoder):
    """JSON encoder that handles numpy types."""
    def default(self, obj):
        if isinstance(obj, (np.integer, np.floating)):
            return float(obj) if isinstance(obj, np.floating) else int(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class ValidatedStrategy:
    """
    Strategy that has been validated across all three sets.

    Attributes:
        factor_name: Human-readable factor name
        factor_formula: Mathematical expression for the factor
        entry_threshold: Signal threshold to enter position
        exit_threshold: Signal threshold to exit position
        direction: 'long' or 'short' bias
        structure: Option structure definition (dict from StructureDNA)
        discovery_sharpe: Sharpe ratio on discovery set
        validation_sharpe: Sharpe ratio on validation set
        walkforward_sharpe: Sharpe ratio on walk-forward set
        discovery_return: Total return on discovery set
        validation_return: Total return on validation set
        walkforward_return: Total return on walk-forward set
        discovery_dd: Max drawdown on discovery set
        validation_dd: Max drawdown on validation set
        walkforward_dd: Max drawdown on walk-forward set
        n_trades: Total number of trades across all sets
        win_rate: Fraction of winning trades
        profit_factor: Gross profit / gross loss
        avg_trade_return: Average return per trade
        correlation_to_spy: Correlation to SPY returns
        metadata: Additional strategy metadata
    """
    factor_name: str
    factor_formula: str
    entry_threshold: float
    exit_threshold: float
    direction: str
    structure: Dict[str, Any]

    # Performance across three sets
    discovery_sharpe: float
    validation_sharpe: float
    walkforward_sharpe: float

    discovery_return: float
    validation_return: float
    walkforward_return: float

    discovery_dd: float
    validation_dd: float
    walkforward_dd: float

    # Trade statistics
    n_trades: int
    win_rate: float
    profit_factor: float
    avg_trade_return: float

    # Risk metrics
    correlation_to_spy: float

    # Optional metadata
    metadata: Dict[str, Any] = None

    @property
    def avg_sharpe(self) -> float:
        """Average Sharpe across all three sets."""
        return np.mean([
            self.discovery_sharpe,
            self.validation_sharpe,
            self.walkforward_sharpe
        ])

    @property
    def max_drawdown(self) -> float:
        """Worst drawdown across all three sets."""
        return max([
            abs(self.discovery_dd),
            abs(self.validation_dd),
            abs(self.walkforward_dd)
        ])

    @property
    def sharpe_stability(self) -> float:
        """
        How stable is Sharpe across sets?
        Lower is better. < 0.3 is stable.
        """
        sharpes = [
            self.discovery_sharpe,
            self.validation_sharpe,
            self.walkforward_sharpe
        ]
        return np.std(sharpes) / (np.mean(sharpes) + 1e-6)

    @property
    def degradation(self) -> float:
        """
        Performance degradation from discovery to walk-forward.
        Positive = degraded, Negative = improved
        """
        return (self.discovery_sharpe - self.walkforward_sharpe) / (abs(self.discovery_sharpe) + 1e-6)


@dataclass
class PlaybookMetrics:
    """Combined portfolio metrics for the playbook."""
    expected_sharpe: float
    expected_return: float
    expected_volatility: float
    max_correlation: float  # Highest pairwise correlation
    avg_correlation: float  # Average pairwise correlation
    diversification_ratio: float  # Sum of individual vols / portfolio vol
    n_strategies: int
    total_trades_per_year: float


# ============================================================================
# PLAYBOOK BUILDER
# ============================================================================

class PlaybookBuilder:
    """
    Aggregates validated strategies into an executable playbook.

    The playbook is a JSON file that can be loaded in production to execute
    strategies that have survived rigorous three-set validation.
    """

    def __init__(
        self,
        validation_results: List[Tuple[str, Any]],
        min_sharpe: float = 0.5,
        max_drawdown: float = 0.30,
        min_trades: int = 10,
        max_correlation: float = 0.80
    ):
        """
        Initialize PlaybookBuilder.

        Args:
            validation_results: List of (strategy_id, ValidationResult) tuples
            min_sharpe: Minimum average Sharpe to survive
            max_drawdown: Maximum drawdown threshold
            min_trades: Minimum number of trades required
            max_correlation: Maximum correlation between strategies
        """
        self.validation_results = validation_results
        self.min_sharpe = min_sharpe
        self.max_drawdown = max_drawdown
        self.min_trades = min_trades
        self.max_correlation = max_correlation

        self.survivors: List[ValidatedStrategy] = []
        self.allocation: Dict[str, float] = {}
        self.playbook: Optional[Dict] = None

        logger.info(
            f"PlaybookBuilder initialized with {len(validation_results)} strategies"
        )

    def filter_survivors(
        self,
        min_sharpe: Optional[float] = None,
        max_drawdown: Optional[float] = None,
        min_trades: Optional[int] = None,
        max_correlation: Optional[float] = None
    ) -> List[ValidatedStrategy]:
        """
        Filter strategies that survive all three validation sets.

        Survival criteria:
        1. Positive Sharpe in ALL three sets (discovery, validation, walk-forward)
        2. Average Sharpe > min_sharpe
        3. Max drawdown < max_drawdown across all sets
        4. At least min_trades executed
        5. Not highly correlated with existing survivors

        Args:
            min_sharpe: Override default minimum Sharpe
            max_drawdown: Override default max drawdown
            min_trades: Override default min trades
            max_correlation: Override default max correlation

        Returns:
            List of ValidatedStrategy objects that passed all filters
        """
        min_sharpe = min_sharpe or self.min_sharpe
        max_drawdown = max_drawdown or self.max_drawdown
        min_trades = min_trades or self.min_trades
        max_correlation = max_correlation or self.max_correlation

        survivors = []
        rejected = defaultdict(list)

        for strategy_id, result in self.validation_results:
            # Extract metrics from validation result
            # This assumes result is a dict with the three-set structure
            try:
                strategy = self._extract_validated_strategy(strategy_id, result)
            except Exception as e:
                logger.warning(f"Failed to extract strategy {strategy_id}: {e}")
                rejected["extraction_error"].append(strategy_id)
                continue

            # Filter 1: All three sets must have positive Sharpe
            if (strategy.discovery_sharpe <= 0 or
                strategy.validation_sharpe <= 0 or
                strategy.walkforward_sharpe <= 0):
                rejected["negative_sharpe"].append(strategy_id)
                logger.debug(
                    f"{strategy_id} rejected: negative Sharpe in at least one set"
                )
                continue

            # Filter 2: Average Sharpe threshold
            if strategy.avg_sharpe < min_sharpe:
                rejected["low_avg_sharpe"].append(strategy_id)
                logger.debug(
                    f"{strategy_id} rejected: avg Sharpe {strategy.avg_sharpe:.2f} < {min_sharpe}"
                )
                continue

            # Filter 3: Max drawdown threshold
            if strategy.max_drawdown > max_drawdown:
                rejected["high_drawdown"].append(strategy_id)
                logger.debug(
                    f"{strategy_id} rejected: max DD {strategy.max_drawdown:.2%} > {max_drawdown:.2%}"
                )
                continue

            # Filter 4: Minimum trades
            if strategy.n_trades < min_trades:
                rejected["too_few_trades"].append(strategy_id)
                logger.debug(
                    f"{strategy_id} rejected: only {strategy.n_trades} trades < {min_trades}"
                )
                continue

            # Filter 5: Correlation check (avoid redundant strategies)
            if self._is_highly_correlated(strategy, survivors, max_correlation):
                rejected["high_correlation"].append(strategy_id)
                logger.debug(
                    f"{strategy_id} rejected: highly correlated with existing survivor"
                )
                continue

            # Survived all filters
            survivors.append(strategy)
            logger.info(
                f"{strategy_id} SURVIVED: "
                f"Sharpe={strategy.avg_sharpe:.2f}, "
                f"DD={strategy.max_drawdown:.2%}, "
                f"Trades={strategy.n_trades}"
            )

        # Log rejection summary
        total_rejected = sum(len(v) for v in rejected.values())
        logger.info(
            f"\nSurvival Report: {len(survivors)}/{len(self.validation_results)} strategies passed"
        )
        for reason, strategies in rejected.items():
            logger.info(f"  Rejected for {reason}: {len(strategies)}")

        self.survivors = survivors
        return survivors

    def _extract_validated_strategy(
        self,
        strategy_id: str,
        result: Any
    ) -> ValidatedStrategy:
        """
        Extract ValidatedStrategy from validation result.

        This assumes the result has the structure from the three-set validator.
        Adjust field names as needed based on actual validator output.
        """
        # Handle dict or object result
        if isinstance(result, dict):
            data = result
        else:
            data = asdict(result) if hasattr(result, '__dataclass_fields__') else result.__dict__

        # Extract three-set metrics
        discovery = data.get('discovery_metrics', {})
        validation = data.get('validation_metrics', {})
        walkforward = data.get('walkforward_metrics', {})

        # Extract strategy definition
        strategy_def = data.get('strategy', {})

        return ValidatedStrategy(
            factor_name=strategy_def.get('factor_name', strategy_id),
            factor_formula=strategy_def.get('factor_formula', ''),
            entry_threshold=strategy_def.get('entry_threshold', 0.0),
            exit_threshold=strategy_def.get('exit_threshold', 0.0),
            direction=strategy_def.get('direction', 'long'),
            structure=strategy_def.get('structure', {}),

            discovery_sharpe=discovery.get('sharpe_ratio', 0.0),
            validation_sharpe=validation.get('sharpe_ratio', 0.0),
            walkforward_sharpe=walkforward.get('sharpe_ratio', 0.0),

            discovery_return=discovery.get('total_return', 0.0),
            validation_return=validation.get('total_return', 0.0),
            walkforward_return=walkforward.get('total_return', 0.0),

            discovery_dd=discovery.get('max_drawdown', 0.0),
            validation_dd=validation.get('max_drawdown', 0.0),
            walkforward_dd=walkforward.get('max_drawdown', 0.0),

            n_trades=data.get('total_trades', 0),
            win_rate=data.get('win_rate', 0.0),
            profit_factor=data.get('profit_factor', 1.0),
            avg_trade_return=data.get('avg_trade_return', 0.0),
            correlation_to_spy=data.get('correlation_to_spy', 0.0),

            metadata=data.get('metadata', {})
        )

    def _is_highly_correlated(
        self,
        candidate: ValidatedStrategy,
        existing: List[ValidatedStrategy],
        threshold: float
    ) -> bool:
        """
        Check if candidate is highly correlated with any existing strategy.

        For now, uses a simple heuristic based on factor formula and structure.
        In production, you'd want to compute actual return correlations.
        """
        if not existing:
            return False

        for survivor in existing:
            # Simple heuristic: same factor formula = highly correlated
            if candidate.factor_formula == survivor.factor_formula:
                return True

            # Same structure type with similar entry thresholds
            if (candidate.structure.get('type') == survivor.structure.get('type') and
                abs(candidate.entry_threshold - survivor.entry_threshold) < 0.1):
                # Use correlation_to_spy as proxy for cross-correlation
                # Better: compute actual correlation from returns
                if candidate.correlation_to_spy > threshold:
                    return True

        return False

    def calculate_allocation(
        self,
        strategies: Optional[List[ValidatedStrategy]] = None,
        method: Literal["equal", "sharpe_weighted", "risk_parity"] = "equal"
    ) -> Dict[str, float]:
        """
        Calculate portfolio weights for each strategy.

        Args:
            strategies: List of strategies to allocate (uses survivors if None)
            method: Allocation method
                - equal: 1/N allocation
                - sharpe_weighted: Weight by average Sharpe
                - risk_parity: Weight by inverse volatility

        Returns:
            Dict mapping strategy factor_name to weight (sums to 1.0)
        """
        strategies = strategies or self.survivors
        if not strategies:
            logger.warning("No strategies to allocate")
            return {}

        weights = {}

        if method == "equal":
            # Simple 1/N
            weight = 1.0 / len(strategies)
            weights = {s.factor_name: weight for s in strategies}

        elif method == "sharpe_weighted":
            # Weight proportional to average Sharpe
            sharpes = np.array([s.avg_sharpe for s in strategies])
            sharpes = np.maximum(sharpes, 0)  # Ensure non-negative
            total_sharpe = sharpes.sum()

            if total_sharpe > 0:
                for i, strat in enumerate(strategies):
                    weights[strat.factor_name] = sharpes[i] / total_sharpe
            else:
                # Fallback to equal weight
                weight = 1.0 / len(strategies)
                weights = {s.factor_name: weight for s in strategies}

        elif method == "risk_parity":
            # Weight by inverse volatility (approximated from returns)
            # For options strategies, use max_drawdown as risk proxy
            risks = np.array([s.max_drawdown for s in strategies])

            inv_risks = 1.0 / np.maximum(np.abs(risks), 0.01)
            total_inv_risk = inv_risks.sum()

            for i, strat in enumerate(strategies):
                weights[strat.factor_name] = inv_risks[i] / total_inv_risk

        else:
            raise ValueError(f"Unknown allocation method: {method}")

        # Normalize to ensure sum = 1.0
        total = sum(weights.values())
        if total > 0:
            weights = {k: v/total for k, v in weights.items()}

        self.allocation = weights
        logger.info(f"Calculated {method} allocation for {len(weights)} strategies")

        return weights

    def calculate_portfolio_metrics(
        self,
        strategies: Optional[List[ValidatedStrategy]] = None,
        allocation: Optional[Dict[str, float]] = None
    ) -> PlaybookMetrics:
        """
        Calculate combined portfolio-level metrics.

        Args:
            strategies: List of strategies (uses survivors if None)
            allocation: Weight allocation (uses self.allocation if None)

        Returns:
            PlaybookMetrics with portfolio-level statistics
        """
        strategies = strategies or self.survivors
        allocation = allocation or self.allocation

        if not strategies or not allocation:
            raise ValueError("Must have strategies and allocation to calculate metrics")

        # Build weight array aligned with strategies
        weights = np.array([allocation.get(s.factor_name, 0.0) for s in strategies])

        # Average Sharpe (weighted)
        sharpes = np.array([s.avg_sharpe for s in strategies])
        expected_sharpe = np.dot(weights, sharpes)

        # Average return (weighted)
        # Use walk-forward returns as most conservative estimate
        returns = np.array([s.walkforward_return for s in strategies])
        expected_return = np.dot(weights, returns)

        # Estimate portfolio volatility (simplified - assumes independence)
        # In production, compute from actual return correlations
        vols = np.array([np.abs(s.walkforward_return / (s.walkforward_sharpe + 1e-6)) for s in strategies])
        expected_volatility = np.sqrt(np.dot(weights**2, vols**2))

        # Correlation metrics
        correlations = [s.correlation_to_spy for s in strategies]
        max_correlation = max(correlations) if correlations else 0.0
        avg_correlation = np.mean(correlations) if correlations else 0.0

        # Diversification ratio
        weighted_vol_sum = np.dot(weights, vols)
        diversification_ratio = weighted_vol_sum / (expected_volatility + 1e-6)

        # Trade frequency
        total_trades = sum(s.n_trades for s in strategies)
        # Assume 3-year backtest (1 year per set)
        total_trades_per_year = total_trades / 3.0

        return PlaybookMetrics(
            expected_sharpe=expected_sharpe,
            expected_return=expected_return,
            expected_volatility=expected_volatility,
            max_correlation=max_correlation,
            avg_correlation=avg_correlation,
            diversification_ratio=diversification_ratio,
            n_strategies=len(strategies),
            total_trades_per_year=total_trades_per_year
        )

    def build_playbook(
        self,
        strategies: Optional[List[ValidatedStrategy]] = None,
        allocation: Optional[Dict[str, float]] = None,
        method: str = "equal"
    ) -> Dict:
        """
        Build complete playbook JSON.

        Returns playbook structure:
        {
            "version": "1.0",
            "generated_at": "2025-12-06T12:00:00",
            "validation_framework": "three_set_interleaved",
            "filters": {...},
            "strategies": [...],
            "allocation": {...},
            "combined_metrics": {...}
        }

        Args:
            strategies: List of strategies (uses survivors if None)
            allocation: Allocation weights (calculates if None)
            method: Allocation method if allocation is None

        Returns:
            Complete playbook dictionary
        """
        strategies = strategies or self.survivors

        if not strategies:
            strategies = self.filter_survivors()

        if allocation is None:
            allocation = self.calculate_allocation(strategies, method=method)

        # Calculate portfolio metrics
        metrics = self.calculate_portfolio_metrics(strategies, allocation)

        # Build playbook
        playbook = {
            "version": "1.0",
            "generated_at": datetime.now().isoformat(),
            "validation_framework": "three_set_interleaved",

            "filters": {
                "min_sharpe": self.min_sharpe,
                "max_drawdown": self.max_drawdown,
                "min_trades": self.min_trades,
                "max_correlation": self.max_correlation
            },

            "strategies": [
                self._serialize_strategy(s) for s in strategies
            ],

            "allocation": allocation,

            "combined_metrics": asdict(metrics)
        }

        self.playbook = playbook
        logger.info(f"Built playbook with {len(strategies)} strategies")

        return playbook

    def _serialize_strategy(self, strategy: ValidatedStrategy) -> Dict:
        """Convert ValidatedStrategy to JSON-serializable dict."""
        return {
            "factor_name": strategy.factor_name,
            "factor_formula": strategy.factor_formula,
            "entry_threshold": strategy.entry_threshold,
            "exit_threshold": strategy.exit_threshold,
            "direction": strategy.direction,
            "structure": strategy.structure,

            "performance": {
                "discovery": {
                    "sharpe": strategy.discovery_sharpe,
                    "return": strategy.discovery_return,
                    "drawdown": strategy.discovery_dd
                },
                "validation": {
                    "sharpe": strategy.validation_sharpe,
                    "return": strategy.validation_return,
                    "drawdown": strategy.validation_dd
                },
                "walkforward": {
                    "sharpe": strategy.walkforward_sharpe,
                    "return": strategy.walkforward_return,
                    "drawdown": strategy.walkforward_dd
                },
                "avg_sharpe": strategy.avg_sharpe,
                "max_drawdown": strategy.max_drawdown,
                "sharpe_stability": strategy.sharpe_stability,
                "degradation": strategy.degradation
            },

            "trade_stats": {
                "n_trades": strategy.n_trades,
                "win_rate": strategy.win_rate,
                "profit_factor": strategy.profit_factor,
                "avg_trade_return": strategy.avg_trade_return
            },

            "risk": {
                "correlation_to_spy": strategy.correlation_to_spy
            },

            "metadata": strategy.metadata or {}
        }

    def export_playbook(self, path: str) -> None:
        """
        Save playbook to JSON file.

        Args:
            path: Output file path
        """
        if self.playbook is None:
            logger.warning("No playbook built yet, building now...")
            self.build_playbook()

        output_path = Path(path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, 'w') as f:
            json.dump(self.playbook, f, indent=2, cls=NumpyEncoder)

        logger.info(f"Playbook exported to {output_path}")

    def generate_report(self) -> str:
        """
        Generate human-readable validation report.

        Returns:
            Formatted report string
        """
        if not self.survivors:
            return "No surviving strategies to report."

        if not self.allocation:
            self.calculate_allocation()

        metrics = self.calculate_portfolio_metrics()

        lines = []
        lines.append("=" * 80)
        lines.append("FACTOR STRATEGY PLAYBOOK REPORT")
        lines.append("=" * 80)
        lines.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        lines.append(f"Validation: Three-Set Interleaved (Discovery/Validation/Walk-Forward)")
        lines.append("")

        lines.append(f"SURVIVING STRATEGIES: {len(self.survivors)} of {len(self.validation_results)} tested")
        lines.append("-" * 80)
        lines.append(f"{'Strategy':<15} {'Factor':<25} {'Disc':<6} {'Valid':<6} {'WF':<6} {'Trades':<7}")
        lines.append("-" * 80)

        for strat in self.survivors:
            # Truncate factor name if too long
            factor_display = strat.factor_name[:23] + ".." if len(strat.factor_name) > 25 else strat.factor_name
            lines.append(
                f"{strat.factor_name[:15]:<15} "
                f"{factor_display:<25} "
                f"{strat.discovery_sharpe:>6.2f} "
                f"{strat.validation_sharpe:>6.2f} "
                f"{strat.walkforward_sharpe:>6.2f} "
                f"{strat.n_trades:>7}"
            )

        lines.append("")
        lines.append("PORTFOLIO ALLOCATION")
        lines.append("-" * 80)

        for factor_name, weight in sorted(self.allocation.items(), key=lambda x: -x[1]):
            lines.append(f"{factor_name:<40} {weight:>6.1%}")

        lines.append("")
        lines.append("COMBINED PORTFOLIO METRICS")
        lines.append("-" * 80)
        lines.append(f"Expected Sharpe Ratio:        {metrics.expected_sharpe:>8.2f}")
        lines.append(f"Expected Annual Return:       {metrics.expected_return:>8.1%}")
        lines.append(f"Expected Volatility:          {metrics.expected_volatility:>8.1%}")
        lines.append(f"Max Correlation (to SPY):     {metrics.max_correlation:>8.2f}")
        lines.append(f"Avg Correlation (to SPY):     {metrics.avg_correlation:>8.2f}")
        lines.append(f"Diversification Ratio:        {metrics.diversification_ratio:>8.2f}")
        lines.append(f"Number of Strategies:         {metrics.n_strategies:>8}")
        lines.append(f"Total Trades per Year:        {metrics.total_trades_per_year:>8.0f}")
        lines.append("")

        lines.append("STRATEGY DETAILS")
        lines.append("-" * 80)

        for strat in self.survivors:
            lines.append(f"\n{strat.factor_name}")
            lines.append(f"  Formula: {strat.factor_formula}")
            lines.append(f"  Entry: {strat.entry_threshold:.2f} | Exit: {strat.exit_threshold:.2f} | Direction: {strat.direction}")
            lines.append(f"  Structure: {strat.structure.get('type', 'unknown')}")
            lines.append(f"  Sharpe: Disc={strat.discovery_sharpe:.2f} / Valid={strat.validation_sharpe:.2f} / WF={strat.walkforward_sharpe:.2f} (Avg={strat.avg_sharpe:.2f})")
            lines.append(f"  Drawdown: {strat.max_drawdown:.1%} | Win Rate: {strat.win_rate:.1%} | Trades: {strat.n_trades}")
            lines.append(f"  Stability: {strat.sharpe_stability:.2f} | Degradation: {strat.degradation:.1%}")

        lines.append("")
        lines.append("=" * 80)

        return "\n".join(lines)


# ============================================================================
# MAIN - EXAMPLE USAGE
# ============================================================================

def main():
    """Example usage of PlaybookBuilder."""

    # Mock validation results (in production, these come from validator)
    mock_results = [
        ("strat_01", {
            "strategy": {
                "factor_name": "ret_range_50_xle",
                "factor_formula": "ret_range_50 * xle_ratio",
                "entry_threshold": 1.5,
                "exit_threshold": -0.5,
                "direction": "long",
                "structure": {"type": "short_strangle", "dte": 30}
            },
            "discovery_metrics": {"sharpe_ratio": 1.20, "total_return": 0.15, "max_drawdown": -0.08},
            "validation_metrics": {"sharpe_ratio": 0.95, "total_return": 0.12, "max_drawdown": -0.10},
            "walkforward_metrics": {"sharpe_ratio": 1.05, "total_return": 0.14, "max_drawdown": -0.09},
            "total_trades": 45,
            "win_rate": 0.62,
            "profit_factor": 1.8,
            "avg_trade_return": 0.003,
            "correlation_to_spy": 0.25
        }),
        ("strat_02", {
            "strategy": {
                "factor_name": "entropy_zscore",
                "factor_formula": "entropy_delta_5 / entropy_vol_20",
                "entry_threshold": 2.0,
                "exit_threshold": 0.0,
                "direction": "short",
                "structure": {"type": "iron_condor", "dte": 45}
            },
            "discovery_metrics": {"sharpe_ratio": 0.85, "total_return": 0.10, "max_drawdown": -0.12},
            "validation_metrics": {"sharpe_ratio": 0.72, "total_return": 0.08, "max_drawdown": -0.15},
            "walkforward_metrics": {"sharpe_ratio": 0.90, "total_return": 0.11, "max_drawdown": -0.11},
            "total_trades": 32,
            "win_rate": 0.75,
            "profit_factor": 2.1,
            "avg_trade_return": 0.003,
            "correlation_to_spy": -0.15
        }),
        ("strat_03", {
            "strategy": {
                "factor_name": "failed_strategy",
                "factor_formula": "random_noise",
                "entry_threshold": 1.0,
                "exit_threshold": -1.0,
                "direction": "long",
                "structure": {"type": "straddle", "dte": 20}
            },
            "discovery_metrics": {"sharpe_ratio": 1.50, "total_return": 0.20, "max_drawdown": -0.05},
            "validation_metrics": {"sharpe_ratio": -0.30, "total_return": -0.05, "max_drawdown": -0.25},
            "walkforward_metrics": {"sharpe_ratio": -0.50, "total_return": -0.08, "max_drawdown": -0.30},
            "total_trades": 50,
            "win_rate": 0.40,
            "profit_factor": 0.8,
            "avg_trade_return": -0.002,
            "correlation_to_spy": 0.60
        })
    ]

    # Build playbook
    builder = PlaybookBuilder(mock_results)

    # Filter survivors
    survivors = builder.filter_survivors(min_sharpe=0.5, max_drawdown=0.30)

    # Calculate allocation
    allocation = builder.calculate_allocation(method="risk_parity")

    # Build and export playbook
    playbook = builder.build_playbook()
    builder.export_playbook("/tmp/factor_playbook.json")

    # Generate report
    print(builder.generate_report())


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    main()
