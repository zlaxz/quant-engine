#!/usr/bin/env python3
"""
Parallel Regime Analysis Swarm
Analyzes multiple ETFs concurrently using multiprocessing.

This is the efficient local version - for DeepSeek API swarm, see deepseek_regime_swarm.py
"""

import json
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime

from engine.analysis.regime_analyzer import analyze_regime_stability


def analyze_single_etf(args: tuple) -> dict:
    """Wrapper for multiprocessing - analyze single ETF."""
    symbol, year = args
    print(f"[SWARM] Analyzing {symbol}...", file=sys.stderr)
    result = analyze_regime_stability(symbol, year)
    print(f"[SWARM] ✓ {symbol} complete - {result.get('dominant_regime', 'Error')}", file=sys.stderr)
    return result


def run_parallel_analysis(symbols: list, year: int = 2024, max_workers: int = 5) -> dict:
    """
    Run regime analysis on multiple ETFs in parallel.

    Args:
        symbols: List of ETF symbols
        year: Year to analyze
        max_workers: Number of parallel processes

    Returns:
        Comprehensive sector fragility report
    """
    print(f"\n{'='*60}", file=sys.stderr)
    print(f"PARALLEL REGIME SWARM - {len(symbols)} ETFs", file=sys.stderr)
    print(f"Year: {year} | Workers: {max_workers}", file=sys.stderr)
    print(f"{'='*60}\n", file=sys.stderr)

    results = []
    errors = []

    # Create task list
    tasks = [(symbol, year) for symbol in symbols]

    # Run in parallel
    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(analyze_single_etf, task): task[0] for task in tasks}

        for future in as_completed(futures):
            symbol = futures[future]
            try:
                result = future.result()
                if 'error' in result:
                    errors.append(result)
                else:
                    results.append(result)
            except Exception as e:
                errors.append({'symbol': symbol, 'error': str(e)})

    # Sort by fragility score (highest risk first)
    results.sort(key=lambda x: x.get('fragility_score', 0), reverse=True)

    # Generate summary report
    report = generate_fragility_report(results, errors, year)

    return report


def generate_fragility_report(results: list, errors: list, year: int) -> dict:
    """Generate comprehensive sector fragility report."""

    if not results:
        return {
            'title': f'Sector Fragility Report - {year}',
            'status': 'FAILED',
            'errors': errors
        }

    # Aggregate statistics
    total_etfs = len(results)
    avg_fragility = sum(r.get('fragility_score', 0) for r in results) / total_etfs
    avg_stability = sum(r.get('stability_score', 0) for r in results) / total_etfs

    # Categorize by fragility
    high_risk = [r for r in results if r.get('fragility_score', 0) > 20]
    moderate_risk = [r for r in results if 10 <= r.get('fragility_score', 0) <= 20]
    low_risk = [r for r in results if r.get('fragility_score', 0) < 10]

    # Regime distribution across all sectors
    regime_counts = {'Stable': 0, 'Fragile/Left-Skew': 0, 'Speculative/Right-Skew': 0}
    for r in results:
        regime = r.get('dominant_regime', 'Unknown')
        if regime in regime_counts:
            regime_counts[regime] += 1

    # Most volatile sectors
    sorted_by_vol = sorted(results, key=lambda x: x.get('summary', {}).get('avg_volatility_pct', 0), reverse=True)

    # Most stable sectors
    sorted_by_stability = sorted(results, key=lambda x: x.get('stability_score', 0), reverse=True)

    report = {
        'title': f'Sector Fragility Report - {year}',
        'generated_at': datetime.now().isoformat(),
        'status': 'SUCCESS',
        'summary': {
            'total_sectors_analyzed': total_etfs,
            'avg_fragility_score': round(avg_fragility, 1),
            'avg_stability_score': round(avg_stability, 1),
            'dominant_market_regime': max(regime_counts, key=regime_counts.get),
            'regime_distribution': regime_counts
        },
        'risk_tiers': {
            'high_risk': [
                {
                    'symbol': r['symbol'],
                    'fragility_score': r['fragility_score'],
                    'dominant_regime': r['dominant_regime'],
                    'avg_skew': r['summary']['avg_skewness'],
                    'avg_vol_pct': r['summary']['avg_volatility_pct']
                }
                for r in high_risk
            ],
            'moderate_risk': [
                {
                    'symbol': r['symbol'],
                    'fragility_score': r['fragility_score'],
                    'dominant_regime': r['dominant_regime']
                }
                for r in moderate_risk
            ],
            'low_risk': [
                {
                    'symbol': r['symbol'],
                    'fragility_score': r['fragility_score'],
                    'dominant_regime': r['dominant_regime']
                }
                for r in low_risk
            ]
        },
        'rankings': {
            'most_volatile': [
                {'symbol': r['symbol'], 'volatility_pct': r['summary']['avg_volatility_pct']}
                for r in sorted_by_vol[:3]
            ],
            'most_stable': [
                {'symbol': r['symbol'], 'stability_score': r['stability_score']}
                for r in sorted_by_stability[:3]
            ],
            'highest_left_skew': [
                {'symbol': r['symbol'], 'avg_skew': r['summary']['avg_skewness']}
                for r in sorted(results, key=lambda x: x.get('summary', {}).get('avg_skewness', 0))[:3]
            ]
        },
        'detailed_results': results,
        'errors': errors if errors else None
    }

    return report


def main():
    # Sector ETFs to analyze
    SECTOR_ETFS = ['XLF', 'XLK', 'XLV', 'XLE', 'XLC', 'XLI', 'XLP', 'XLY', 'XLB', 'XLRE']

    report = run_parallel_analysis(SECTOR_ETFS, year=2024, max_workers=5)

    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
