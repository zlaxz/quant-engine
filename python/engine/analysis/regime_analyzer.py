#!/usr/bin/env python3
"""
Regime Stability Analyzer for ETFs
Calculates rolling skewness/kurtosis and classifies regime types.

Usage:
    python -m engine.analysis.regime_analyzer XLF 2024
"""

import sys
import json
import argparse
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import yfinance as yf
from scipy import stats


def fetch_etf_data(symbol: str, year: int) -> pd.DataFrame:
    """Fetch daily OHLCV data for an ETF for the specified year."""
    start_date = f"{year}-01-01"
    end_date = f"{year}-12-31"

    ticker = yf.Ticker(symbol)
    df = ticker.history(start=start_date, end=end_date)

    if df.empty:
        raise ValueError(f"No data found for {symbol} in {year}")

    # Calculate daily returns
    df['returns'] = df['Close'].pct_change()
    df = df.dropna()

    return df


def calculate_rolling_stats(df: pd.DataFrame, window: int = 30) -> pd.DataFrame:
    """Calculate rolling skewness and kurtosis."""
    result = pd.DataFrame(index=df.index)
    result['returns'] = df['returns']
    result['close'] = df['Close']

    # Rolling statistics
    result['rolling_skew'] = df['returns'].rolling(window=window).apply(
        lambda x: stats.skew(x), raw=True
    )
    result['rolling_kurt'] = df['returns'].rolling(window=window).apply(
        lambda x: stats.kurtosis(x), raw=True
    )

    # Also calculate volatility for context
    result['rolling_vol'] = df['returns'].rolling(window=window).std() * np.sqrt(252)

    return result.dropna()


def classify_regime(skew: float, kurt: float) -> str:
    """
    Classify regime based on skewness and kurtosis.

    Categories:
    - Stable: Low |skew| (<0.5), normal kurtosis (-1 to 1)
    - Fragile/Left-Skew: Negative skew (<-0.5), or high kurtosis with left tail
    - Speculative/Right-Skew: Positive skew (>0.5), or low kurtosis
    """
    if skew < -0.5 or (kurt > 2 and skew < 0):
        return "Fragile/Left-Skew"
    elif skew > 0.5 or (kurt < -0.5 and skew > 0):
        return "Speculative/Right-Skew"
    else:
        return "Stable"


def analyze_regime_stability(symbol: str, year: int = 2024) -> dict:
    """
    Complete regime stability analysis for an ETF.

    Returns:
        dict with analysis results
    """
    try:
        # Fetch data
        df = fetch_etf_data(symbol, year)

        # Calculate rolling stats
        stats_df = calculate_rolling_stats(df, window=30)

        # Summary statistics
        avg_skew = stats_df['rolling_skew'].mean()
        avg_kurt = stats_df['rolling_kurt'].mean()
        avg_vol = stats_df['rolling_vol'].mean()

        # Regime classification for each day
        stats_df['regime'] = stats_df.apply(
            lambda row: classify_regime(row['rolling_skew'], row['rolling_kurt']),
            axis=1
        )

        # Count regime days
        regime_counts = stats_df['regime'].value_counts().to_dict()
        total_days = len(stats_df)

        # Dominant regime
        dominant_regime = stats_df['regime'].mode()[0]

        # Regime stability score (% of days in dominant regime)
        stability_score = regime_counts.get(dominant_regime, 0) / total_days * 100

        # Extreme events
        extreme_left = (stats_df['rolling_skew'] < -1).sum()
        extreme_right = (stats_df['rolling_skew'] > 1).sum()

        # Tail risk (kurtosis > 3)
        fat_tail_days = (stats_df['rolling_kurt'] > 3).sum()

        # Quarterly breakdown
        stats_df['quarter'] = pd.to_datetime(stats_df.index).quarter
        quarterly_regimes = {}
        for q in [1, 2, 3, 4]:
            q_data = stats_df[stats_df['quarter'] == q]
            if not q_data.empty:
                quarterly_regimes[f"Q{q}"] = {
                    'dominant': q_data['regime'].mode()[0] if len(q_data) > 0 else 'Unknown',
                    'avg_skew': round(q_data['rolling_skew'].mean(), 3),
                    'avg_kurt': round(q_data['rolling_kurt'].mean(), 3),
                    'avg_vol': round(q_data['rolling_vol'].mean() * 100, 2)  # As percentage
                }

        result = {
            'symbol': symbol,
            'year': year,
            'trading_days': total_days,
            'dominant_regime': dominant_regime,
            'stability_score': round(stability_score, 1),
            'summary': {
                'avg_skewness': round(avg_skew, 4),
                'avg_kurtosis': round(avg_kurt, 4),
                'avg_volatility_pct': round(avg_vol * 100, 2)
            },
            'regime_distribution': {
                k: {'days': v, 'pct': round(v/total_days*100, 1)}
                for k, v in regime_counts.items()
            },
            'risk_metrics': {
                'extreme_left_skew_days': int(extreme_left),
                'extreme_right_skew_days': int(extreme_right),
                'fat_tail_days': int(fat_tail_days)
            },
            'quarterly_breakdown': quarterly_regimes,
            'fragility_score': round(
                (extreme_left + fat_tail_days) / total_days * 100, 1
            )
        }

        return result

    except Exception as e:
        return {
            'symbol': symbol,
            'year': year,
            'error': str(e),
            'dominant_regime': 'Error',
            'stability_score': 0
        }


def main():
    parser = argparse.ArgumentParser(description='ETF Regime Stability Analyzer')
    parser.add_argument('symbol', help='ETF symbol (e.g., XLF, XLK)')
    parser.add_argument('year', nargs='?', type=int, default=2024, help='Year to analyze')
    parser.add_argument('--json', action='store_true', help='Output as JSON')

    args = parser.parse_args()

    result = analyze_regime_stability(args.symbol, args.year)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"\n{'='*60}")
        print(f"REGIME STABILITY ANALYSIS: {result['symbol']} ({result['year']})")
        print(f"{'='*60}")

        if 'error' in result:
            print(f"ERROR: {result['error']}")
            return

        print(f"\nDominant Regime: {result['dominant_regime']}")
        print(f"Stability Score: {result['stability_score']}%")
        print(f"Fragility Score: {result['fragility_score']}%")

        print(f"\nSummary Statistics (30-day rolling):")
        print(f"  Average Skewness:  {result['summary']['avg_skewness']:+.4f}")
        print(f"  Average Kurtosis:  {result['summary']['avg_kurtosis']:+.4f}")
        print(f"  Average Volatility: {result['summary']['avg_volatility_pct']:.2f}%")

        print(f"\nRegime Distribution:")
        for regime, data in result['regime_distribution'].items():
            print(f"  {regime}: {data['days']} days ({data['pct']}%)")

        print(f"\nRisk Metrics:")
        rm = result['risk_metrics']
        print(f"  Extreme Left-Skew Days:  {rm['extreme_left_skew_days']}")
        print(f"  Extreme Right-Skew Days: {rm['extreme_right_skew_days']}")
        print(f"  Fat Tail Days (kurt>3):  {rm['fat_tail_days']}")

        print(f"\nQuarterly Breakdown:")
        for q, data in result['quarterly_breakdown'].items():
            print(f"  {q}: {data['dominant']} (skew: {data['avg_skew']:+.3f}, vol: {data['avg_vol']:.1f}%)")


if __name__ == '__main__':
    main()
