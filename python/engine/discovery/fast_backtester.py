#!/usr/bin/env python3
"""
Fast Backtester: Vectorized Options Strategy Backtesting

Instead of simulating trades one by one, this backtester uses pre-computed
payoff surfaces for near-instant backtesting:

    1. Load payoff surface (pre-computed daily returns)
    2. Load regime assignments
    3. Filter to entry conditions (regime, IV, VIX)
    4. Apply exit logic vectorized
    5. Compute performance metrics

Backtesting 1000 structures takes seconds instead of hours.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .structure_dna import (
    StructureDNA,
    StructureType,
    DTEBucket,
    DeltaBucket,
    estimate_slippage_cost,
    get_payoff_surface_keys_for_dna,
)
from .payoff_surface_builder import PayoffSurfaceLookup

logger = logging.getLogger("AlphaFactory.FastBacktester")


# ============================================================================
# BACKTEST RESULT
# ============================================================================

@dataclass
class BacktestResult:
    """Results from backtesting a single structure."""
    dna: StructureDNA

    # Return metrics
    total_return: float
    ann_return: float
    ann_volatility: float
    sharpe_ratio: float
    sortino_ratio: float

    # Risk metrics
    max_drawdown: float
    max_drawdown_duration: int  # days
    calmar_ratio: float

    # Trade metrics
    n_trades: int
    n_days_in_market: int
    win_rate: float
    profit_factor: float
    avg_trade_return: float

    # Distribution
    skewness: float
    kurtosis: float
    tail_ratio: float  # 95th / 5th percentile

    # Regime breakdown
    returns_by_regime: Dict[int, float]

    # Raw data
    daily_returns: Optional[pd.Series] = None
    equity_curve: Optional[pd.Series] = None

    def to_dict(self) -> Dict:
        """Serialize to dictionary (excluding large arrays)."""
        return {
            'structure_type': self.dna.structure_type.value,
            'dte_bucket': self.dna.dte_bucket.value,
            'delta_bucket': self.dna.delta_bucket.value,
            'entry_regimes': self.dna.entry_regimes,
            'total_return': self.total_return,
            'ann_return': self.ann_return,
            'ann_volatility': self.ann_volatility,
            'sharpe_ratio': self.sharpe_ratio,
            'sortino_ratio': self.sortino_ratio,
            'max_drawdown': self.max_drawdown,
            'max_drawdown_duration': self.max_drawdown_duration,
            'calmar_ratio': self.calmar_ratio,
            'n_trades': self.n_trades,
            'n_days_in_market': self.n_days_in_market,
            'win_rate': self.win_rate,
            'profit_factor': self.profit_factor,
            'avg_trade_return': self.avg_trade_return,
            'skewness': self.skewness,
            'kurtosis': self.kurtosis,
            'tail_ratio': self.tail_ratio,
            'returns_by_regime': self.returns_by_regime,
        }


# ============================================================================
# FAST BACKTESTER
# ============================================================================

class FastBacktester:
    """
    Vectorized backtester using pre-computed payoff surfaces.

    Usage:
        backtester = FastBacktester(surface_path, regime_path)
        result = backtester.backtest(dna)
    """

    def __init__(
        self,
        surface_path: Path,
        regime_path: Path,
        vix_path: Optional[Path] = None,
        iv_rank_path: Optional[Path] = None,
    ):
        """
        Initialize backtester.

        Args:
            surface_path: Path to payoff surface parquet
            regime_path: Path to regime assignments parquet
            vix_path: Optional path to VIX data
            iv_rank_path: Optional path to IV rank data
        """
        self.surface_path = Path(surface_path)
        self.regime_path = Path(regime_path)

        # Load payoff surface
        logger.info(f"Loading payoff surface from {surface_path}")
        self.lookup = PayoffSurfaceLookup.from_parquet(surface_path)

        # Load regimes
        logger.info(f"Loading regimes from {regime_path}")
        self.regimes = self._load_regimes(regime_path)

        # Load optional data
        self.vix = self._load_vix(vix_path) if vix_path else None
        self.iv_rank = self._load_iv_rank(iv_rank_path) if iv_rank_path else None

        # Align dates
        self.trading_dates = self.lookup.wide.index.intersection(self.regimes.index)
        logger.info(f"Aligned {len(self.trading_dates)} trading dates")

    def _load_regimes(self, path: Path) -> pd.Series:
        """Load regime assignments."""
        df = pd.read_parquet(path)
        df['date'] = pd.to_datetime(df.get('timestamp', df.get('date')))
        df = df.set_index('date')['regime']
        return df

    def _load_vix(self, path: Path) -> Optional[pd.Series]:
        """Load VIX data."""
        try:
            df = pd.read_parquet(path)
            df['date'] = pd.to_datetime(df.get('timestamp', df.get('date')))
            df = df.set_index('date')
            return df.get('close', df.get('vix'))
        except Exception as e:
            logger.warning(f"Could not load VIX: {e}")
            return None

    def _load_iv_rank(self, path: Path) -> Optional[pd.Series]:
        """Load IV rank data."""
        try:
            df = pd.read_parquet(path)
            df['date'] = pd.to_datetime(df.get('timestamp', df.get('date')))
            df = df.set_index('date')
            return df.get('iv_rank')
        except Exception as e:
            logger.warning(f"Could not load IV rank: {e}")
            return None

    def _get_entry_mask(self, dna: StructureDNA) -> pd.Series:
        """
        Get boolean mask for valid entry dates.

        Applies:
        - Regime filter
        - VIX filter (if configured)
        - IV rank filter (if configured)
        """
        # Start with all dates
        mask = pd.Series(True, index=self.trading_dates)

        # Regime filter
        regime_vals = self.regimes.reindex(self.trading_dates)
        mask &= regime_vals.isin(dna.entry_regimes)

        # VIX filter
        if self.vix is not None:
            vix_vals = self.vix.reindex(self.trading_dates)
            mask &= (vix_vals >= dna.min_vix) & (vix_vals <= dna.max_vix)

        # IV rank filter
        if self.iv_rank is not None:
            ivr_vals = self.iv_rank.reindex(self.trading_dates)
            mask &= (ivr_vals >= dna.min_iv_rank) & (ivr_vals <= dna.max_iv_rank)

        return mask.fillna(False)

    def _get_structure_returns(
        self,
        dna: StructureDNA,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> pd.Series:
        """
        Get raw daily returns for a structure.

        Handles multi-leg structures by combining returns.
        """
        keys = get_payoff_surface_keys_for_dna(dna)

        # Get returns for each key
        returns_list = []
        for key in keys:
            try:
                ret = self.lookup.get_returns(key, start_date, end_date)
                returns_list.append(ret)
            except KeyError:
                # Key not in surface - use fallback
                logger.debug(f"Key not found: {key}")
                continue

        if not returns_list:
            return pd.Series(dtype=float)

        # Combine returns (for multi-leg structures)
        # Simple average for now - could weight by delta
        combined = pd.concat(returns_list, axis=1).mean(axis=1)
        return combined

    def _apply_exit_logic(
        self,
        returns: pd.Series,
        entry_mask: pd.Series,
        dna: StructureDNA
    ) -> pd.Series:
        """
        Apply exit logic to raw returns.

        Simulates:
        - Profit target exits
        - Stop loss exits
        - Regime change exits

        Returns adjusted return series.
        """
        # Align to common dates
        common_dates = returns.index.intersection(entry_mask.index)
        returns = returns.reindex(common_dates)
        entry_mask = entry_mask.reindex(common_dates)

        # Start with no position
        in_position = False
        trade_return = 0.0
        adjusted_returns = []

        for date in common_dates:
            daily_ret = returns.get(date, 0.0)
            can_enter = entry_mask.get(date, False)

            if not in_position:
                if can_enter and not np.isnan(daily_ret):
                    # Enter position
                    in_position = True
                    trade_return = daily_ret
                    adjusted_returns.append(daily_ret)
                else:
                    adjusted_returns.append(0.0)
            else:
                if np.isnan(daily_ret):
                    # No data - exit
                    in_position = False
                    trade_return = 0.0
                    adjusted_returns.append(0.0)
                else:
                    trade_return += daily_ret

                    # Check profit target
                    if trade_return >= dna.profit_target_pct:
                        adjusted_returns.append(daily_ret)
                        in_position = False
                        trade_return = 0.0
                    # Check stop loss
                    elif trade_return <= -dna.stop_loss_pct:
                        adjusted_returns.append(daily_ret)
                        in_position = False
                        trade_return = 0.0
                    # Check regime exit
                    elif dna.regime_exit and not can_enter:
                        adjusted_returns.append(daily_ret)
                        in_position = False
                        trade_return = 0.0
                    else:
                        adjusted_returns.append(daily_ret)

        return pd.Series(adjusted_returns, index=common_dates)

    def _count_trades(self, returns: pd.Series) -> int:
        """Count number of distinct trades (entries after flat periods)."""
        # A trade starts when we go from 0 to non-zero return
        non_zero = returns != 0
        trade_starts = non_zero & (~non_zero.shift(1).fillna(False))
        return int(trade_starts.sum())

    def _compute_metrics(
        self,
        returns: pd.Series,
        dna: StructureDNA
    ) -> BacktestResult:
        """Compute all performance metrics from return series."""

        if len(returns) < 20 or returns.std() == 0:
            # Insufficient data
            return BacktestResult(
                dna=dna,
                total_return=0.0,
                ann_return=0.0,
                ann_volatility=0.0,
                sharpe_ratio=0.0,
                sortino_ratio=0.0,
                max_drawdown=0.0,
                max_drawdown_duration=0,
                calmar_ratio=0.0,
                n_trades=0,
                n_days_in_market=0,
                win_rate=0.0,
                profit_factor=0.0,
                avg_trade_return=0.0,
                skewness=0.0,
                kurtosis=0.0,
                tail_ratio=0.0,
                returns_by_regime={},
            )

        # Remove NaN
        returns = returns.dropna()

        # Basic returns
        total_return = (1 + returns).prod() - 1
        n_days = len(returns)
        ann_factor = 252 / n_days
        ann_return = (1 + total_return) ** ann_factor - 1
        ann_vol = returns.std() * np.sqrt(252)

        # Sharpe
        sharpe = ann_return / ann_vol if ann_vol > 0 else 0.0

        # Sortino (downside deviation)
        neg_returns = returns[returns < 0]
        downside_vol = neg_returns.std() * np.sqrt(252) if len(neg_returns) > 0 else ann_vol
        sortino = ann_return / downside_vol if downside_vol > 0 else 0.0

        # Drawdown
        cum_returns = (1 + returns).cumprod()
        rolling_max = cum_returns.expanding().max()
        drawdown = (cum_returns - rolling_max) / rolling_max
        max_dd = abs(drawdown.min()) if len(drawdown) > 0 else 0.0

        # Max drawdown duration
        underwater = drawdown < 0
        if underwater.any():
            underwater_periods = underwater.astype(int).groupby(
                (~underwater).cumsum()
            ).cumsum()
            max_dd_duration = int(underwater_periods.max())
        else:
            max_dd_duration = 0

        # Calmar
        calmar = ann_return / max_dd if max_dd > 0 else 0.0

        # Trade metrics
        n_trades = self._count_trades(returns)
        n_days_in_market = int((returns != 0).sum())

        non_zero_returns = returns[returns != 0]
        win_rate = (non_zero_returns > 0).mean() if len(non_zero_returns) > 0 else 0.0

        # Profit factor
        gains = non_zero_returns[non_zero_returns > 0].sum()
        losses = abs(non_zero_returns[non_zero_returns < 0].sum())
        profit_factor = gains / losses if losses > 0 else 0.0

        avg_trade_return = non_zero_returns.mean() if len(non_zero_returns) > 0 else 0.0

        # Distribution
        skewness = returns.skew() if len(returns) > 2 else 0.0
        kurtosis = returns.kurtosis() if len(returns) > 3 else 0.0

        # Tail ratio
        p95 = returns.quantile(0.95) if len(returns) > 0 else 0.0
        p05 = returns.quantile(0.05) if len(returns) > 0 else 0.0
        tail_ratio = abs(p95 / p05) if p05 != 0 else 0.0

        # Regime breakdown
        returns_by_regime = {}
        regime_aligned = self.regimes.reindex(returns.index)
        for regime in [0, 1, 2, 3]:
            regime_mask = regime_aligned == regime
            regime_returns = returns[regime_mask]
            if len(regime_returns) > 0:
                returns_by_regime[regime] = (1 + regime_returns).prod() - 1
            else:
                returns_by_regime[regime] = 0.0

        # Equity curve
        equity = (1 + returns).cumprod()

        return BacktestResult(
            dna=dna,
            total_return=total_return,
            ann_return=ann_return,
            ann_volatility=ann_vol,
            sharpe_ratio=sharpe,
            sortino_ratio=sortino,
            max_drawdown=max_dd,
            max_drawdown_duration=max_dd_duration,
            calmar_ratio=calmar,
            n_trades=n_trades,
            n_days_in_market=n_days_in_market,
            win_rate=win_rate,
            profit_factor=profit_factor,
            avg_trade_return=avg_trade_return,
            skewness=skewness,
            kurtosis=kurtosis,
            tail_ratio=tail_ratio,
            returns_by_regime=returns_by_regime,
            daily_returns=returns,
            equity_curve=equity,
        )

    def backtest(
        self,
        dna: StructureDNA,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        include_slippage: bool = True
    ) -> BacktestResult:
        """
        Backtest a single structure DNA.

        Args:
            dna: Structure DNA to backtest
            start_date: Start of backtest period
            end_date: End of backtest period
            include_slippage: Whether to subtract slippage costs

        Returns:
            BacktestResult with all metrics
        """
        # Get raw structure returns
        raw_returns = self._get_structure_returns(dna, start_date, end_date)

        if len(raw_returns) == 0:
            logger.warning(f"No returns for {dna.structure_type.value}")
            return self._compute_metrics(pd.Series(dtype=float), dna)

        # Get entry mask
        entry_mask = self._get_entry_mask(dna)

        # Apply exit logic
        returns = self._apply_exit_logic(raw_returns, entry_mask, dna)

        # Subtract slippage (as % of return)
        if include_slippage:
            slippage_pct = dna.estimated_slippage
            # Apply slippage on entry days only
            entry_days = (returns != 0) & (returns.shift(1) == 0)
            returns = returns - (entry_days * slippage_pct)

        # Compute metrics
        return self._compute_metrics(returns, dna)

    def backtest_population(
        self,
        population: List[StructureDNA],
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        include_slippage: bool = True
    ) -> List[BacktestResult]:
        """
        Backtest entire population.

        Args:
            population: List of DNA structures
            start_date: Start of backtest period
            end_date: End of backtest period
            include_slippage: Whether to subtract slippage

        Returns:
            List of BacktestResults
        """
        results = []
        for i, dna in enumerate(population):
            result = self.backtest(dna, start_date, end_date, include_slippage)
            results.append(result)

            if (i + 1) % 10 == 0:
                logger.info(f"Backtested {i + 1}/{len(population)} structures")

        return results

    def rank_population(
        self,
        results: List[BacktestResult],
        sort_by: str = 'sharpe_ratio'
    ) -> pd.DataFrame:
        """
        Rank backtested population by metric.

        Args:
            results: List of BacktestResults
            sort_by: Metric to sort by

        Returns:
            DataFrame sorted by metric
        """
        records = [r.to_dict() for r in results]
        df = pd.DataFrame(records)
        return df.sort_values(sort_by, ascending=False)


# ============================================================================
# SLIPPAGE-AWARE FITNESS
# ============================================================================

def compute_fitness(
    result: BacktestResult,
    sharpe_weight: float = 0.4,
    sortino_weight: float = 0.2,
    calmar_weight: float = 0.2,
    win_rate_weight: float = 0.1,
    complexity_penalty: float = 0.02
) -> float:
    """
    Compute fitness score for genetic algorithm.

    Higher is better. Incorporates:
    - Risk-adjusted returns (Sharpe, Sortino, Calmar)
    - Win rate for consistency
    - Complexity penalty (more legs = more slippage risk)

    Args:
        result: BacktestResult from backtester
        sharpe_weight: Weight for Sharpe ratio
        sortino_weight: Weight for Sortino ratio
        calmar_weight: Weight for Calmar ratio
        win_rate_weight: Weight for win rate
        complexity_penalty: Penalty per leg

    Returns:
        Fitness score (higher is better)
    """
    # Weighted combination of metrics
    fitness = (
        sharpe_weight * result.sharpe_ratio +
        sortino_weight * result.sortino_ratio +
        calmar_weight * result.calmar_ratio +
        win_rate_weight * (result.win_rate - 0.5) * 2  # Center at 0.5
    )

    # Complexity penalty
    n_legs = result.dna.n_legs
    fitness -= complexity_penalty * n_legs

    # Bonus for positive skew (tail hedge value)
    if result.skewness > 1:
        fitness += 0.1 * result.skewness

    # Penalty for excessive drawdown
    if result.max_drawdown > 0.5:
        fitness -= 0.5 * (result.max_drawdown - 0.5)

    return fitness


# ============================================================================
# CLI
# ============================================================================

if __name__ == '__main__':
    import argparse
    from .structure_dna import create_initial_population, format_dna

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    parser = argparse.ArgumentParser(description='Fast options backtester')
    parser.add_argument('--surface', type=str, required=True,
                        help='Path to payoff surface parquet')
    parser.add_argument('--regimes', type=str, required=True,
                        help='Path to regime assignments parquet')
    parser.add_argument('--n-structures', type=int, default=20,
                        help='Number of structures to test')

    args = parser.parse_args()

    # Initialize backtester
    backtester = FastBacktester(
        surface_path=Path(args.surface),
        regime_path=Path(args.regimes)
    )

    # Create test population
    population = create_initial_population(args.n_structures)

    # Backtest
    print("\n=== Backtesting Population ===\n")
    results = backtester.backtest_population(population)

    # Rank by fitness
    for result in results:
        result.dna.fitness_score = compute_fitness(result)

    results.sort(key=lambda r: r.dna.fitness_score, reverse=True)

    print("\n=== Top 10 Structures ===\n")
    for i, result in enumerate(results[:10]):
        print(f"{i+1}. {format_dna(result.dna)}")
        print(f"   Sharpe: {result.sharpe_ratio:.2f} | "
              f"Win: {result.win_rate:.1%} | "
              f"MaxDD: {result.max_drawdown:.1%} | "
              f"Trades: {result.n_trades}")
        print()
