#!/usr/bin/env python3
"""
Master Miner - The Production-Grade Backtest Harness.
Moves strategy genomes through the Data -> Physics -> Result pipeline.
API-READY: Adds JSON output formatting for UI.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from scipy import stats
import sys
import os
import json
import logging
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Import from unified engine package
from ..trading.simulator import TradeSimulator
from ..data.loaders import load_spy_data

# These modules may not exist yet - stub definitions
class StrategyGenome:
    """Stub for strategy genome - to be implemented."""
    def __init__(self, config=None):
        self.config = config or {}

class SymbolFactory:
    """Stub for symbol factory - to be implemented."""
    pass

class DriveLoader:
    """Stub for drive loader - replaced by load_spy_data."""
    def load_day(self, symbol: str, date_str: str):
        df = load_spy_data()
        from datetime import datetime
        date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
        day_data = df[df['date'] == date_obj]
        return day_data if not day_data.empty else pd.DataFrame()


# =============================================================================
# Walk-Forward Validation
# =============================================================================

@dataclass
class WalkForwardWindow:
    """A single walk-forward window with in-sample and out-of-sample periods."""
    window_id: int
    train_start: str
    train_end: str
    test_start: str
    test_end: str
    train_sharpe: float = 0.0
    test_sharpe: float = 0.0
    train_return: float = 0.0
    test_return: float = 0.0
    is_valid: bool = False  # True if test performance confirms train


@dataclass
class WalkForwardResult:
    """Results from walk-forward validation."""
    windows: List[WalkForwardWindow]
    aggregate_test_sharpe: float
    aggregate_test_return: float
    consistency_ratio: float  # % of windows where test confirms train
    is_robust: bool  # True if strategy passes walk-forward validation


def generate_walk_forward_windows(
    start_date: str,
    end_date: str,
    train_months: int = 12,
    test_months: int = 3,
    step_months: int = 3,
) -> List[Tuple[str, str, str, str]]:
    """
    Generate walk-forward windows for validation.

    Args:
        start_date: Overall start date (YYYY-MM-DD)
        end_date: Overall end date (YYYY-MM-DD)
        train_months: In-sample training period length
        test_months: Out-of-sample test period length
        step_months: How far to step forward each window

    Returns:
        List of (train_start, train_end, test_start, test_end) tuples
    """
    windows = []
    start = pd.Timestamp(start_date)
    end = pd.Timestamp(end_date)

    current_train_start = start
    window_id = 0

    while True:
        train_end = current_train_start + pd.DateOffset(months=train_months) - pd.Timedelta(days=1)
        test_start = train_end + pd.Timedelta(days=1)
        test_end = test_start + pd.DateOffset(months=test_months) - pd.Timedelta(days=1)

        # Stop if test period would exceed end date
        if test_end > end:
            break

        windows.append((
            current_train_start.strftime('%Y-%m-%d'),
            train_end.strftime('%Y-%m-%d'),
            test_start.strftime('%Y-%m-%d'),
            test_end.strftime('%Y-%m-%d'),
        ))

        # Step forward
        current_train_start = current_train_start + pd.DateOffset(months=step_months)
        window_id += 1

        # Safety limit
        if window_id > 50:
            logger.warning("Walk-forward window limit reached (50)")
            break

    return windows


# =============================================================================
# Multiple Testing Correction
# =============================================================================

@dataclass
class CorrectedResult:
    """Result after multiple testing correction."""
    strategy_id: str
    raw_pvalue: float
    corrected_pvalue: float
    is_significant: bool
    sharpe_ratio: float
    total_return: float


def benjamini_hochberg_correction(
    pvalues: List[float],
    alpha: float = 0.05,
) -> List[Tuple[int, float, bool]]:
    """
    Benjamini-Hochberg procedure for controlling False Discovery Rate.

    More powerful than Bonferroni for testing many hypotheses.

    Args:
        pvalues: List of raw p-values from strategy tests
        alpha: Desired FDR level (default 0.05 = 5%)

    Returns:
        List of (original_index, corrected_pvalue, is_significant) tuples
    """
    n = len(pvalues)
    if n == 0:
        return []

    # Sort p-values and keep track of original indices
    indexed_pvalues = [(i, p) for i, p in enumerate(pvalues)]
    indexed_pvalues.sort(key=lambda x: x[1])

    # Apply BH correction
    results = []
    for rank, (orig_idx, pval) in enumerate(indexed_pvalues, 1):
        # BH critical value: (rank / n) * alpha
        bh_critical = (rank / n) * alpha
        # Adjusted p-value
        adjusted_p = min(pval * n / rank, 1.0)
        is_significant = pval <= bh_critical
        results.append((orig_idx, adjusted_p, is_significant))

    # Sort back to original order
    results.sort(key=lambda x: x[0])
    return results


def bonferroni_correction(
    pvalues: List[float],
    alpha: float = 0.05,
) -> List[Tuple[int, float, bool]]:
    """
    Bonferroni correction - most conservative.

    Args:
        pvalues: List of raw p-values
        alpha: Desired family-wise error rate

    Returns:
        List of (original_index, corrected_pvalue, is_significant) tuples
    """
    n = len(pvalues)
    if n == 0:
        return []

    corrected_alpha = alpha / n
    results = []
    for i, pval in enumerate(pvalues):
        corrected_p = min(pval * n, 1.0)
        is_significant = pval <= corrected_alpha
        results.append((i, corrected_p, is_significant))

    return results


def calculate_strategy_pvalue(
    sharpe_ratio: float,
    n_observations: int,
    null_sharpe: float = 0.0,
) -> float:
    """
    Calculate p-value for a Sharpe ratio being significantly different from null.

    Uses the asymptotic distribution of the Sharpe ratio estimator.

    Args:
        sharpe_ratio: Observed annualized Sharpe ratio
        n_observations: Number of daily observations
        null_sharpe: Null hypothesis Sharpe (default 0)

    Returns:
        Two-tailed p-value
    """
    if n_observations < 30:
        logger.warning(f"Small sample size ({n_observations}) may give unreliable p-value")
        return 1.0

    # Standard error of Sharpe ratio (Lo 2002 approximation)
    # SE ≈ sqrt((1 + 0.5 * SR^2) / n)
    se = np.sqrt((1 + 0.5 * sharpe_ratio**2) / n_observations)

    # Z-statistic
    z = (sharpe_ratio - null_sharpe) / se if se > 0 else 0

    # Two-tailed p-value
    pvalue = 2 * (1 - stats.norm.cdf(abs(z)))
    return pvalue


class MasterMiner:
    def __init__(self, start_date: str, end_date: str, capital: float = 100000.0):
        self.start_date = start_date
        self.end_date = end_date
        self.capital = capital
        self.loader = DriveLoader()
        self.simulator = TradeSimulator(initial_capital=capital)
        self.factory = SymbolFactory()
        
        self.quote_cache = {} 
        self.current_cache_date = None
        
    def _get_quote_cached(self, symbol: str, date_str: str) -> pd.DataFrame:
        if self.current_cache_date != date_str:
            self.quote_cache = {}
            self.current_cache_date = date_str
            
        if symbol not in self.quote_cache:
            if len(self.quote_cache) > 10:
                first_key = next(iter(self.quote_cache))
                del self.quote_cache[first_key]
            
            df = self.loader.load_quotes('SPY', date_str, 
                                        columns=['timestamp', 'bid_price', 'ask_price'],
                                        filters=[('symbol', '==', symbol)])
            self.quote_cache[symbol] = df
            
        return self.quote_cache[symbol]

    def _get_current_quote(self, symbol: str, timestamp: datetime, date_str: str):
        df = self._get_quote_cached(symbol, date_str)
        if df.empty: return None
        relevant = df[df['timestamp'] >= timestamp]
        if relevant.empty: return None
        return relevant.iloc[0]

    def _parse_expiration(self, symbol: str) -> datetime:
        try:
            date_part = symbol[3:9]
            return datetime.strptime(date_part, '%y%m%d')
        except ValueError as e:
            import logging
            logging.error(f"Failed to parse expiration from '{symbol}': {e}")
            raise ValueError(f"Invalid option symbol format: {symbol}") from e

    def run(self, genome: StrategyGenome):
        print(f"--- LAUNCHING MINE: {genome.name} --- ")
        dates = pd.date_range(start=self.start_date, end=self.end_date, freq='D')
        
        for date_obj in dates:
            date_str = date_obj.strftime('%Y-%m-%d')
            print(f"Processing {date_str}...")
            
            try:
                spy_df = self.loader.load_trades('SPY', date_str, columns=['timestamp', 'underlying_price', 'iv'])
            except Exception as e:
                print(f"  [WARN] Failed to load SPY data for {date_str}: {e}")
                continue
            if spy_df.empty: continue
                
            ohlc = spy_df.set_index('timestamp').resample('15min').agg({
                'underlying_price': 'last',
                'iv': 'median'
            }).dropna()
            ohlc.columns = ['close', 'iv_snapshot']
            
            for timestamp, bar in ohlc.iterrows():
                current_spot = bar['close']
                current_iv_decimal = bar['iv_snapshot'] / 100.0 if bar['iv_snapshot'] > 4.0 else bar['iv_snapshot']
                
                # A. MANAGE EXITS
                for trade in list(self.simulator.active_trades):
                    days_held = (timestamp - trade.entry_date).days
                    
                    exp_date = self._parse_expiration(trade.symbol)
                    if timestamp.date() >= exp_date.date():
                         self._execute_expiration(trade, timestamp, current_spot)
                         continue
                    
                    should_exit = False
                    reason = ''
                    if days_held >= genome.exit.get('hold_days', 999):
                        should_exit = True
                        reason = 'time_exit'
                    
                    if should_exit:
                        self._execute_exit(trade, timestamp, reason, date_str)
                        
                # B. MANAGE ENTRIES
                if not self.simulator.active_trades:
                    vix_proxy = current_iv_decimal * 100.0
                    if self._check_trigger(genome, vix_proxy):
                        target_dte = 7
                        target_delta = genome.instrument.get('delta', -0.05)
                        opt_type = genome.instrument.get('type', 'put')
                        exp_date = self.factory.get_expiration(timestamp, target_dte)
                        strike = self.factory.get_strike(current_spot, target_delta, opt_type, 
                                                       iv=current_iv_decimal, dte=target_dte)
                        symbol = self.factory.build_occ('SPY', exp_date, opt_type, strike)
                        action = genome.instrument.get('action', 'buy')
                        direction = 'SHORT' if action == 'sell' else 'LONG'
                        
                        self._execute_entry(symbol, timestamp, direction, genome, date_str)
                        
        return self.simulator.get_results()

    def walk_forward_validate(
        self,
        genome: StrategyGenome,
        train_months: int = 12,
        test_months: int = 3,
        step_months: int = 3,
        min_consistency: float = 0.6,
    ) -> WalkForwardResult:
        """
        Run walk-forward validation on a strategy.

        Instead of testing on the full period (which overfits), this:
        1. Splits data into rolling train/test windows
        2. Runs strategy on each window
        3. Checks if out-of-sample performance confirms in-sample

        Args:
            genome: Strategy to validate
            train_months: In-sample period length
            test_months: Out-of-sample period length
            step_months: Step size for rolling windows
            min_consistency: Minimum ratio of valid windows to be "robust"

        Returns:
            WalkForwardResult with validation details
        """
        windows = generate_walk_forward_windows(
            self.start_date,
            self.end_date,
            train_months,
            test_months,
            step_months,
        )

        if not windows:
            logger.warning("No valid walk-forward windows could be generated")
            return WalkForwardResult(
                windows=[],
                aggregate_test_sharpe=0.0,
                aggregate_test_return=0.0,
                consistency_ratio=0.0,
                is_robust=False,
            )

        results = []
        all_test_returns = []
        valid_count = 0

        for i, (train_start, train_end, test_start, test_end) in enumerate(windows):
            logger.info(f"Walk-forward window {i+1}/{len(windows)}: "
                       f"Train {train_start} to {train_end}, Test {test_start} to {test_end}")

            # Run on training period
            train_miner = MasterMiner(train_start, train_end, self.capital)
            train_results = train_miner.run(genome)
            train_sharpe = self._calculate_sharpe(train_results)
            train_return = self._calculate_return(train_results)

            # Run on test period
            test_miner = MasterMiner(test_start, test_end, self.capital)
            test_results = test_miner.run(genome)
            test_sharpe = self._calculate_sharpe(test_results)
            test_return = self._calculate_return(test_results)

            # Window is valid if:
            # 1. Train Sharpe > 0 (strategy appears profitable in-sample)
            # 2. Test Sharpe > 0 (confirms out-of-sample)
            # 3. Test Sharpe >= 50% of Train Sharpe (not just noise)
            is_valid = (
                train_sharpe > 0 and
                test_sharpe > 0 and
                (test_sharpe >= 0.5 * train_sharpe if train_sharpe > 0 else True)
            )

            if is_valid:
                valid_count += 1

            all_test_returns.append(test_return)

            window_result = WalkForwardWindow(
                window_id=i,
                train_start=train_start,
                train_end=train_end,
                test_start=test_start,
                test_end=test_end,
                train_sharpe=train_sharpe,
                test_sharpe=test_sharpe,
                train_return=train_return,
                test_return=test_return,
                is_valid=is_valid,
            )
            results.append(window_result)

        # Aggregate metrics
        consistency_ratio = valid_count / len(windows) if windows else 0
        aggregate_test_return = sum(all_test_returns)
        test_sharpes = [w.test_sharpe for w in results if w.test_sharpe != 0]
        aggregate_test_sharpe = np.mean(test_sharpes) if test_sharpes else 0.0

        return WalkForwardResult(
            windows=results,
            aggregate_test_sharpe=aggregate_test_sharpe,
            aggregate_test_return=aggregate_test_return,
            consistency_ratio=consistency_ratio,
            is_robust=consistency_ratio >= min_consistency,
        )

    def _calculate_sharpe(self, results: pd.DataFrame) -> float:
        """Calculate annualized Sharpe ratio from backtest results."""
        if results.empty or 'pnl' not in results.columns:
            return 0.0
        pnl = results['pnl']
        if pnl.std() == 0:
            return 0.0
        # Assume daily observations, annualize
        return (pnl.mean() / pnl.std()) * np.sqrt(252)

    def _calculate_return(self, results: pd.DataFrame) -> float:
        """Calculate total return from backtest results."""
        if results.empty or 'pnl' not in results.columns:
            return 0.0
        return results['pnl'].sum()

    def batch_test_with_correction(
        self,
        genomes: List[StrategyGenome],
        correction_method: str = 'benjamini_hochberg',
        alpha: float = 0.05,
    ) -> List[CorrectedResult]:
        """
        Test multiple strategies with multiple testing correction.

        When testing many strategies, some will appear profitable by chance.
        This applies statistical correction to control false discovery rate.

        Args:
            genomes: List of strategies to test
            correction_method: 'benjamini_hochberg' (FDR) or 'bonferroni' (FWER)
            alpha: Significance level (default 0.05)

        Returns:
            List of CorrectedResult with adjusted p-values
        """
        if not genomes:
            return []

        # Run all strategies and collect results
        raw_results = []
        for genome in genomes:
            logger.info(f"Testing strategy: {getattr(genome, 'id', 'unknown')}")
            results = self.run(genome)

            sharpe = self._calculate_sharpe(results)
            total_return = self._calculate_return(results)
            n_obs = len(results) if not results.empty else 0

            # Calculate p-value for this strategy
            pvalue = calculate_strategy_pvalue(sharpe, n_obs)

            raw_results.append({
                'strategy_id': getattr(genome, 'id', f'strategy_{len(raw_results)}'),
                'sharpe': sharpe,
                'return': total_return,
                'pvalue': pvalue,
                'n_obs': n_obs,
            })

            # Reset simulator for next strategy
            self.simulator = TradeSimulator(initial_capital=self.capital)

        # Apply correction
        pvalues = [r['pvalue'] for r in raw_results]

        if correction_method == 'bonferroni':
            corrections = bonferroni_correction(pvalues, alpha)
        else:
            corrections = benjamini_hochberg_correction(pvalues, alpha)

        # Build final results
        corrected_results = []
        for i, (orig_idx, corrected_p, is_sig) in enumerate(corrections):
            r = raw_results[orig_idx]
            corrected_results.append(CorrectedResult(
                strategy_id=r['strategy_id'],
                raw_pvalue=r['pvalue'],
                corrected_pvalue=corrected_p,
                is_significant=is_sig,
                sharpe_ratio=r['sharpe'],
                total_return=r['return'],
            ))

        # Log summary
        sig_count = sum(1 for r in corrected_results if r.is_significant)
        logger.info(f"Multiple testing: {sig_count}/{len(corrected_results)} strategies significant "
                   f"after {correction_method} correction (alpha={alpha})")

        return corrected_results

    def _check_trigger(self, genome, vix_val) -> bool:
        trigger = genome.trigger
        if trigger.get('type') == 'vix_level':
            val = trigger.get('value')
            op = trigger.get('operator')
            if op == '>': return vix_val > val
            if op == '<': return vix_val < val
        return True

    def _execute_entry(self, symbol, timestamp, direction, genome, date_str):
        quote = self._get_current_quote(symbol, timestamp, date_str)
        if quote is None: return
        price = quote.ask_price if direction == 'LONG' else quote.bid_price
        size = genome.sizing.get('value', 1)
        
        trade = self.simulator.enter_trade(symbol, timestamp, price, size, direction, genome.id)
        if trade:
            pass # Trade accepted

    def _execute_exit(self, trade, timestamp, reason, date_str):
        quote = self._get_current_quote(trade.symbol, timestamp, date_str)
        if quote is None: return 
        price = quote.bid_price if trade.direction == 'LONG' else quote.ask_price
        self.simulator.exit_trade(trade, timestamp, price, reason)

    def _execute_expiration(self, trade, timestamp, spot_price):
        try:
            strike = float(trade.symbol[-8:]) / 1000.0
            is_call = 'C' in trade.symbol
            if is_call: intrinsic = max(0.0, spot_price - strike)
            else: intrinsic = max(0.0, strike - spot_price)
            self.simulator.exit_trade(trade, timestamp, intrinsic, 'expiration', vix=0.0)
        except Exception:
            self.simulator.exit_trade(trade, timestamp, 0.0, 'expiration_error', vix=0.0)

    def generate_api_response(self) -> Dict[str, Any]:
        """
        Returns the FULL JSON response for the Frontend:
        {
          "equity_curve": [...],
          "trades": [...],
          "metrics": {...}
        }
        """
        # 1. Equity Curve
        equity_data = []
        
        if not self.simulator.equity_curve:
            return {
                "equity_curve": [{"time": self.start_date, "value": self.capital, "drawdown": 0}],
                "trades": [],
                "metrics": {"total_return": 0, "sharpe": 0, "win_rate": 0}
            }
            
        peak_equity = self.capital
        for point in self.simulator.equity_curve:
            eq = point['equity']
            peak_equity = max(peak_equity, eq)
            dd = (eq - peak_equity) / peak_equity if peak_equity > 0 else 0
            
            equity_data.append({
                "time": point['date'].strftime('%Y-%m-%d %H:%M'),
                "value": round(eq, 2),
                "drawdown": round(dd, 4)
            })
            
        # 2. Trades List
        trades_data = []
        df_trades = self.simulator.get_results()
        if not df_trades.empty:
            for _, row in df_trades.iterrows():
                expl = f"{row['direction']} {row['symbol']} on {row['entry_date']}"
                trades_data.append({
                    "id": f"t_{_}",
                    "symbol": row['symbol'],
                    "type": "Short Put" if "P" in row['symbol'] and row['direction']=="SHORT" else "Long Call",
                    "entry_date": row['entry_date'].strftime('%Y-%m-%d %H:%M'),
                    "exit_date": row['exit_date'].strftime('%Y-%m-%d %H:%M'),
                    "entry_price": round(row['entry_price'], 2),
                    "exit_price": round(row['exit_price'], 2),
                    "pnl": round(row['pnl'], 2),
                    "pnl_percent": round(row['return_pct'] * 100, 2),
                    "status": "closed",
                    "explanation": expl
                })
                
        # 3. Aggregate Metrics
        final_eq = equity_data[-1]['value'] if equity_data else self.capital
        total_ret = (final_eq - self.capital) / self.capital
        win_rate = (df_trades['pnl'] > 0).mean() if not df_trades.empty else 0
        
        return {
            "equity_curve": equity_data,
            "trades": trades_data,
            "metrics": {
                "total_return": round(total_ret * 100, 2),
                "sharpe": 0.0, 
                "win_rate": round(win_rate * 100, 1),
                "max_drawdown": round(min([x['drawdown'] for x in equity_data] or [0]) * 100, 2)
            }
        }
