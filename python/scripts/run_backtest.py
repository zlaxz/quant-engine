#!/usr/bin/env python3
"""
Phase 5: Backtest Discovered Equations

Tests the PySR-discovered equation with regime conditioning.
Compares: raw equation, regime-filtered, and buy-and-hold.

Usage:
    python scripts/run_backtest.py \
        --features /path/to/SPY/mtf_features.parquet \
        --math-results /path/to/SPY/math_swarm_results.json \
        --regime-assignments /path/to/SPY/regime_assignments.parquet
"""

import os
import sys
import json
import argparse
import logging
from pathlib import Path
from datetime import datetime

import numpy as np
import pandas as pd

# Add engine to path
sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('Backtest')


def compute_equation_signal(df: pd.DataFrame, equation: str, feature_map: dict) -> pd.Series:
    """
    Compute the discovered equation as a trading signal.

    Returns: Series of signal values
    """
    # Reverse the feature map (safe_name -> original_name to original_name -> safe_name)
    reverse_map = {v: k for k, v in feature_map.items()}

    # Create local variables for equation evaluation
    local_vars = {}
    for original_name, safe_name in reverse_map.items():
        if original_name in df.columns:
            local_vars[safe_name] = df[original_name].values

    # Add numpy functions
    local_vars['abs'] = np.abs
    local_vars['log'] = np.log
    local_vars['exp'] = np.exp
    local_vars['sqrt'] = np.sqrt
    local_vars['sign'] = np.sign

    # Evaluate equation
    try:
        signal = eval(equation, {"__builtins__": {}}, local_vars)
        return pd.Series(signal, index=df.index)
    except Exception as e:
        logger.error(f"Failed to evaluate equation: {e}")
        raise


def run_backtest(
    features_path: str,
    math_results_path: str,
    regime_path: str = None,
    skip_regimes: list = None,
    holding_period: int = 5,
    output_dir: str = None
) -> dict:
    """
    Backtest the discovered equation.

    Returns dict with performance metrics.
    """
    logger.info(f"\n{'='*60}")
    logger.info("PHASE 5: BACKTEST")
    logger.info(f"{'='*60}")

    # Load math swarm results
    logger.info("Loading Math Swarm results...")
    with open(math_results_path, 'r') as f:
        math_results = json.load(f)

    equation = math_results['best_equation_raw']
    feature_map = math_results['feature_mapping']
    logger.info(f"Equation: {equation}")

    # Load features
    logger.info(f"Loading features from {features_path}...")
    df = pd.read_parquet(features_path)
    df = df.sort_values('timestamp').reset_index(drop=True)
    logger.info(f"Loaded {len(df):,} rows")

    # Load regime assignments if available
    if regime_path and Path(regime_path).exists():
        logger.info("Loading regime assignments...")
        regime_df = pd.read_parquet(regime_path)
        # Join on index (both should be aligned after sort)
        # Handle length mismatch by using the shorter length
        min_len = min(len(df), len(regime_df))
        df = df.iloc[:min_len].copy()
        df['regime'] = regime_df['regime'].values[:min_len]
        df['regime_confidence'] = regime_df['regime_confidence'].values[:min_len]
    else:
        df['regime'] = 0  # Default to single regime
        df['regime_confidence'] = 1.0

    # Compute forward returns (actual outcomes)
    df['forward_return'] = df['close'].shift(-holding_period) / df['close'] - 1

    # Compute equation signal
    logger.info("Computing equation signal...")
    df['signal'] = compute_equation_signal(df, equation, feature_map)

    # Normalize signal to z-score for comparison
    signal_mean = df['signal'].mean()
    signal_std = df['signal'].std()
    df['signal_zscore'] = (df['signal'] - signal_mean) / signal_std

    # Generate trading positions
    # Long when signal > 0, flat when signal <= 0
    df['position_raw'] = (df['signal'] > 0).astype(int)

    # Regime-filtered position (skip bad regimes)
    skip_regimes = skip_regimes or [1]  # Default skip regime 1
    df['position_filtered'] = df['position_raw'].copy()
    for regime in skip_regimes:
        df.loc[df['regime'] == regime, 'position_filtered'] = 0

    # Calculate returns for each strategy
    df['return_bh'] = df['forward_return']  # Buy and hold
    df['return_raw'] = df['position_raw'] * df['forward_return']  # Raw signal
    df['return_filtered'] = df['position_filtered'] * df['forward_return']  # Regime filtered

    # Remove NaN rows (last N rows have no forward return)
    df_valid = df.dropna(subset=['forward_return']).copy()

    logger.info(f"Valid trading days: {len(df_valid):,}")

    # Calculate performance metrics
    def calc_metrics(returns: pd.Series, name: str) -> dict:
        """Calculate performance metrics for a return series."""
        # Compound returns
        cumulative = (1 + returns).cumprod()
        total_return = cumulative.iloc[-1] - 1

        # Annualize (assuming 5-day holding period)
        periods_per_year = 252 / holding_period
        n_periods = len(returns)
        years = n_periods / periods_per_year

        annual_return = (1 + total_return) ** (1 / years) - 1 if years > 0 else 0
        annual_vol = returns.std() * np.sqrt(periods_per_year)
        sharpe = annual_return / annual_vol if annual_vol > 0 else 0

        # Drawdown
        running_max = cumulative.cummax()
        drawdown = (cumulative - running_max) / running_max
        max_drawdown = drawdown.min()

        # Win rate
        win_rate = (returns > 0).mean()

        # Profit factor
        gains = returns[returns > 0].sum()
        losses = abs(returns[returns < 0].sum())
        profit_factor = gains / losses if losses > 0 else np.inf

        return {
            'name': name,
            'total_return_pct': round(total_return * 100, 2),
            'annual_return_pct': round(annual_return * 100, 2),
            'annual_volatility_pct': round(annual_vol * 100, 2),
            'sharpe_ratio': round(sharpe, 2),
            'max_drawdown_pct': round(max_drawdown * 100, 2),
            'win_rate_pct': round(win_rate * 100, 1),
            'profit_factor': round(profit_factor, 2),
            'n_trades': int((returns != 0).sum())
        }

    # Calculate metrics for each strategy
    metrics_bh = calc_metrics(df_valid['return_bh'], 'Buy & Hold')
    metrics_raw = calc_metrics(df_valid['return_raw'], 'Raw Signal')
    metrics_filtered = calc_metrics(df_valid['return_filtered'], 'Regime Filtered')

    # Display results
    logger.info(f"\n{'='*60}")
    logger.info("BACKTEST RESULTS")
    logger.info(f"{'='*60}")

    for m in [metrics_bh, metrics_raw, metrics_filtered]:
        logger.info(f"\n{m['name']}:")
        logger.info(f"  Total Return: {m['total_return_pct']:+.1f}%")
        logger.info(f"  Annual Return: {m['annual_return_pct']:+.1f}%")
        logger.info(f"  Annual Vol: {m['annual_volatility_pct']:.1f}%")
        logger.info(f"  Sharpe Ratio: {m['sharpe_ratio']:.2f}")
        logger.info(f"  Max Drawdown: {m['max_drawdown_pct']:.1f}%")
        logger.info(f"  Win Rate: {m['win_rate_pct']:.1f}%")
        logger.info(f"  Profit Factor: {m['profit_factor']:.2f}")

    # Regime breakdown for filtered strategy
    logger.info(f"\n{'='*60}")
    logger.info("REGIME BREAKDOWN (Filtered Strategy)")
    logger.info(f"{'='*60}")

    for regime in sorted(df_valid['regime'].unique()):
        regime_mask = df_valid['regime'] == regime
        regime_returns = df_valid.loc[regime_mask, 'return_filtered']

        if regime in skip_regimes:
            logger.info(f"\nRegime {regime}: SKIPPED ({regime_mask.sum()} days)")
        else:
            regime_metrics = calc_metrics(regime_returns, f"Regime {regime}")
            logger.info(f"\nRegime {regime}: ({regime_mask.sum()} days)")
            logger.info(f"  Return: {regime_metrics['total_return_pct']:+.1f}%")
            logger.info(f"  Sharpe: {regime_metrics['sharpe_ratio']:.2f}")
            logger.info(f"  Win Rate: {regime_metrics['win_rate_pct']:.1f}%")

    # Build results dict
    results = {
        'timestamp': datetime.now().isoformat(),
        'equation': equation,
        'holding_period_days': holding_period,
        'skip_regimes': skip_regimes,
        'n_trading_days': len(df_valid),
        'metrics': {
            'buy_and_hold': metrics_bh,
            'raw_signal': metrics_raw,
            'regime_filtered': metrics_filtered
        }
    }

    # Save results
    if output_dir:
        out_path = Path(output_dir)
    else:
        out_path = Path(features_path).parent

    results_path = out_path / 'backtest_results.json'
    with open(results_path, 'w') as f:
        json.dump(results, f, indent=2)
    logger.info(f"\nResults saved to: {results_path}")

    # Save equity curves
    equity_df = pd.DataFrame({
        'timestamp': df_valid['timestamp'] if 'timestamp' in df_valid.columns else df_valid.index,
        'buy_hold_equity': (1 + df_valid['return_bh']).cumprod(),
        'raw_signal_equity': (1 + df_valid['return_raw']).cumprod(),
        'filtered_equity': (1 + df_valid['return_filtered']).cumprod(),
        'regime': df_valid['regime']
    })
    equity_path = out_path / 'equity_curves.parquet'
    equity_df.to_parquet(equity_path, index=False)
    logger.info(f"Equity curves saved to: {equity_path}")

    return results


def main():
    parser = argparse.ArgumentParser(description='Backtest Discovered Equations')
    parser.add_argument('--features', type=str, required=True,
                        help='Path to MTF features parquet')
    parser.add_argument('--math-results', type=str, required=True,
                        help='Path to math_swarm_results.json')
    parser.add_argument('--regime-assignments', type=str,
                        help='Path to regime_assignments.parquet')
    parser.add_argument('--skip-regimes', type=int, nargs='+', default=[1],
                        help='Regimes to skip (default: 1)')
    parser.add_argument('--holding-period', type=int, default=5,
                        help='Holding period in days')
    parser.add_argument('--output', type=str,
                        help='Output directory')

    args = parser.parse_args()

    results = run_backtest(
        features_path=args.features,
        math_results_path=args.math_results,
        regime_path=args.regime_assignments,
        skip_regimes=args.skip_regimes,
        holding_period=args.holding_period,
        output_dir=args.output
    )

    # Summary
    raw = results['metrics']['raw_signal']
    filt = results['metrics']['regime_filtered']
    bh = results['metrics']['buy_and_hold']

    print(f"\n{'='*60}")
    print("STRATEGY COMPARISON")
    print(f"{'='*60}")
    print(f"                    Annual Return    Sharpe    Max DD")
    print(f"Buy & Hold:         {bh['annual_return_pct']:+6.1f}%        {bh['sharpe_ratio']:5.2f}    {bh['max_drawdown_pct']:6.1f}%")
    print(f"Raw Signal:         {raw['annual_return_pct']:+6.1f}%        {raw['sharpe_ratio']:5.2f}    {raw['max_drawdown_pct']:6.1f}%")
    print(f"Regime Filtered:    {filt['annual_return_pct']:+6.1f}%        {filt['sharpe_ratio']:5.2f}    {filt['max_drawdown_pct']:6.1f}%")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
