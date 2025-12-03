#!/usr/bin/env python3
"""
S&P 500 Global Radar Swarm
===========================
Deploys 500 DeepSeek agents to analyze every S&P 500 component simultaneously.

Uses the SwarmOrchestrator for massive parallel execution and the Synthesizer
for hierarchical MapReduce consolidation of findings.

Usage:
    python scripts/sp500_radar_swarm.py --mode sector      # Analyze 11 sector ETFs (quick)
    python scripts/sp500_radar_swarm.py --mode sp500       # Analyze all 500+ components
    python scripts/sp500_radar_swarm.py --mode custom AAPL MSFT GOOGL  # Custom symbols

Output:
    Writes comprehensive radar report to data/radar_reports/
"""

import os
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime
from typing import List, Dict

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.swarm import run_swarm_sync
from engine.swarm.synthesizer import synthesize_findings

# ============================================================================
# Symbol Lists
# ============================================================================

SECTOR_ETFS = [
    'XLF',  # Financials
    'XLK',  # Technology
    'XLV',  # Healthcare
    'XLE',  # Energy
    'XLC',  # Communications
    'XLI',  # Industrials
    'XLP',  # Consumer Staples
    'XLY',  # Consumer Discretionary
    'XLB',  # Materials
    'XLRE', # Real Estate
    'XLU',  # Utilities
]

# Top 100 S&P 500 by market cap (for medium scan)
SP500_TOP_100 = [
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B', 'UNH', 'LLY',
    'JPM', 'XOM', 'V', 'AVGO', 'JNJ', 'PG', 'MA', 'HD', 'MRK', 'COST',
    'ABBV', 'CVX', 'CRM', 'AMD', 'PEP', 'NFLX', 'KO', 'ADBE', 'WMT', 'TMO',
    'BAC', 'MCD', 'CSCO', 'ACN', 'LIN', 'ABT', 'ORCL', 'DHR', 'INTC', 'VZ',
    'DIS', 'CMCSA', 'PM', 'INTU', 'NKE', 'TXN', 'WFC', 'NOW', 'BMY', 'QCOM',
    'UPS', 'COP', 'NEE', 'HON', 'AMGN', 'RTX', 'SPGI', 'MS', 'T', 'LOW',
    'IBM', 'ELV', 'DE', 'CAT', 'BA', 'GE', 'SYK', 'BLK', 'ISRG', 'PLD',
    'AMAT', 'BKNG', 'LMT', 'ADP', 'MDLZ', 'GILD', 'ADI', 'MMC', 'VRTX', 'TJX',
    'CVS', 'AXP', 'SCHW', 'CI', 'GS', 'MO', 'REGN', 'ETN', 'PGR', 'CB',
    'ZTS', 'SO', 'LRCX', 'C', 'BDX', 'DUK', 'CME', 'BSX', 'SLB', 'PANW',
]

# ============================================================================
# Analysis Prompts
# ============================================================================

REGIME_ANALYST_PROMPT = """You are a Quantitative Regime Analyst specialized in market microstructure.

Analyze the trading characteristics of {symbol} ({sector}) and provide:

1. **Regime Classification:**
   - Is this asset currently in a STABLE, FRAGILE, or SPECULATIVE regime?
   - What's the approximate volatility percentile (low/medium/high)?

2. **Risk Factors:**
   - Key downside risks specific to this asset
   - Correlation to broader market moves
   - Liquidity concerns (if any)

3. **Momentum Signal:**
   - Current trend direction (bullish/bearish/neutral)
   - Strength of trend (weak/moderate/strong)

4. **Actionable Insight:**
   - One specific, actionable observation

Be concise. Focus on what matters for a portfolio manager.
Output in structured format with clear headers."""

SECTOR_ANALYST_PROMPT = """You are a Sector Strategist analyzing {symbol} ETF.

Provide sector-level analysis:

1. **Sector Regime:**
   - Current sector health (strong/neutral/weak)
   - Relative strength vs S&P 500

2. **Top Risks:**
   - Primary macro risk affecting this sector
   - Key company-specific risks within sector

3. **Rotation Signal:**
   - Is money flowing INTO or OUT OF this sector?
   - Conviction level (low/medium/high)

4. **Key Holdings Alert:**
   - Any major holdings showing concerning patterns?

Be direct. No fluff. What would you tell the CIO?"""

# ============================================================================
# Radar Functions
# ============================================================================

def get_symbol_sector(symbol: str) -> str:
    """Map symbol to sector (simplified mapping for major stocks)."""
    sector_map = {
        'XLF': 'Financials', 'XLK': 'Technology', 'XLV': 'Healthcare',
        'XLE': 'Energy', 'XLC': 'Communications', 'XLI': 'Industrials',
        'XLP': 'Consumer Staples', 'XLY': 'Consumer Discretionary',
        'XLB': 'Materials', 'XLRE': 'Real Estate', 'XLU': 'Utilities',
        # Tech
        'AAPL': 'Technology', 'MSFT': 'Technology', 'GOOGL': 'Technology',
        'NVDA': 'Technology', 'META': 'Technology', 'AVGO': 'Technology',
        'AMD': 'Technology', 'INTC': 'Technology', 'CSCO': 'Technology',
        'ORCL': 'Technology', 'CRM': 'Technology', 'ADBE': 'Technology',
        'NOW': 'Technology', 'INTU': 'Technology', 'TXN': 'Technology',
        'QCOM': 'Technology', 'AMAT': 'Technology', 'ADI': 'Technology',
        'LRCX': 'Technology', 'PANW': 'Technology',
        # Financials
        'JPM': 'Financials', 'BAC': 'Financials', 'WFC': 'Financials',
        'GS': 'Financials', 'MS': 'Financials', 'BLK': 'Financials',
        'SCHW': 'Financials', 'AXP': 'Financials', 'C': 'Financials',
        'V': 'Financials', 'MA': 'Financials', 'SPGI': 'Financials',
        # Healthcare
        'UNH': 'Healthcare', 'LLY': 'Healthcare', 'JNJ': 'Healthcare',
        'MRK': 'Healthcare', 'ABBV': 'Healthcare', 'PFE': 'Healthcare',
        'TMO': 'Healthcare', 'ABT': 'Healthcare', 'DHR': 'Healthcare',
        'BMY': 'Healthcare', 'AMGN': 'Healthcare', 'GILD': 'Healthcare',
        'VRTX': 'Healthcare', 'REGN': 'Healthcare', 'SYK': 'Healthcare',
        'ISRG': 'Healthcare', 'ZTS': 'Healthcare', 'BDX': 'Healthcare',
        'BSX': 'Healthcare', 'ELV': 'Healthcare', 'CI': 'Healthcare',
        'CVS': 'Healthcare',
        # Consumer
        'AMZN': 'Consumer Discretionary', 'TSLA': 'Consumer Discretionary',
        'HD': 'Consumer Discretionary', 'MCD': 'Consumer Discretionary',
        'NKE': 'Consumer Discretionary', 'LOW': 'Consumer Discretionary',
        'BKNG': 'Consumer Discretionary', 'TJX': 'Consumer Discretionary',
        'PG': 'Consumer Staples', 'KO': 'Consumer Staples',
        'PEP': 'Consumer Staples', 'COST': 'Consumer Staples',
        'WMT': 'Consumer Staples', 'PM': 'Consumer Staples',
        'MO': 'Consumer Staples', 'MDLZ': 'Consumer Staples',
        # Energy
        'XOM': 'Energy', 'CVX': 'Energy', 'COP': 'Energy', 'SLB': 'Energy',
        # Industrial
        'HON': 'Industrials', 'UPS': 'Industrials', 'CAT': 'Industrials',
        'BA': 'Industrials', 'GE': 'Industrials', 'RTX': 'Industrials',
        'LMT': 'Industrials', 'DE': 'Industrials', 'ETN': 'Industrials',
        'ADP': 'Industrials', 'MMC': 'Industrials',
        # Communications
        'NFLX': 'Communications', 'DIS': 'Communications',
        'CMCSA': 'Communications', 'T': 'Communications', 'VZ': 'Communications',
        # Utilities
        'NEE': 'Utilities', 'SO': 'Utilities', 'DUK': 'Utilities',
        # Real Estate
        'PLD': 'Real Estate',
        # Materials
        'LIN': 'Materials',
    }
    return sector_map.get(symbol, 'Unknown')


def run_radar_swarm(
    symbols: List[str],
    mode: str = 'sector',
    concurrency: int = 50,
    model: str = 'deepseek-chat'
) -> Dict:
    """
    Deploy radar swarm to analyze symbols.

    Args:
        symbols: List of symbols to analyze
        mode: 'sector' (ETFs) or 'stock' (individual stocks)
        concurrency: Max concurrent API requests
        model: DeepSeek model to use

    Returns:
        Comprehensive radar report
    """
    print(f"\n{'='*60}")
    print(f"S&P 500 GLOBAL RADAR")
    print(f"{'='*60}")
    print(f"Mode: {mode.upper()}")
    print(f"Symbols: {len(symbols)}")
    print(f"Concurrency: {concurrency}")
    print(f"Model: {model}")
    print(f"{'='*60}\n")

    # Build tasks
    tasks = []
    for symbol in symbols:
        sector = get_symbol_sector(symbol)
        is_etf = symbol.startswith('XL') or symbol in ['SPY', 'QQQ', 'IWM']

        prompt = SECTOR_ANALYST_PROMPT if is_etf else REGIME_ANALYST_PROMPT
        prompt = prompt.format(symbol=symbol, sector=sector)

        tasks.append({
            'id': symbol,
            'system': prompt,
            'user': f"Analyze {symbol} as of today. Provide your assessment.",
            'model': model,
            'temperature': 0.3  # Moderate for analytical work
        })

    print(f"Dispatching {len(tasks)} agents to DeepSeek...")
    results = run_swarm_sync(tasks, concurrency=concurrency)

    # Separate successes and failures
    successful = []
    failed = []
    for r in results:
        if r['status'] == 'success':
            successful.append({
                'symbol': r['id'],
                'sector': get_symbol_sector(r['id']),
                'analysis': r['content']
            })
        else:
            failed.append({
                'symbol': r['id'],
                'error': r.get('error', 'Unknown')
            })

    print(f"\nSwarm complete: {len(successful)}/{len(tasks)} successful")

    # Synthesize findings into executive summary
    print(f"\nRunning MapReduce synthesis on {len(successful)} findings...")
    findings = [f"## {s['symbol']} ({s['sector']})\n{s['analysis']}" for s in successful]

    executive_summary = synthesize_findings(
        findings=findings,
        topic=f"S&P 500 Market Radar ({mode.title()} Mode)",
        chunk_size=10,
        concurrency=concurrency
    )

    # Build final report
    report = {
        'title': f'S&P 500 Global Radar Report',
        'mode': mode,
        'generated_at': datetime.now().isoformat(),
        'summary': {
            'symbols_analyzed': len(symbols),
            'successful': len(successful),
            'failed': len(failed)
        },
        'executive_summary': executive_summary,
        'by_sector': group_by_sector(successful),
        'detailed_findings': successful,
        'errors': failed if failed else None
    }

    return report


def group_by_sector(findings: List[Dict]) -> Dict[str, List]:
    """Group findings by sector."""
    sectors = {}
    for f in findings:
        sector = f['sector']
        if sector not in sectors:
            sectors[sector] = []
        sectors[sector].append({
            'symbol': f['symbol'],
            'analysis': f['analysis'][:500] + '...' if len(f['analysis']) > 500 else f['analysis']
        })
    return sectors


def save_report(report: Dict, mode: str) -> Path:
    """Save report to disk."""
    output_dir = PROJECT_ROOT / 'data' / 'radar_reports'
    output_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = output_dir / f'radar_{mode}_{timestamp}.json'

    with open(filename, 'w') as f:
        json.dump(report, f, indent=2)

    # Also save markdown version
    md_filename = output_dir / f'radar_{mode}_{timestamp}.md'
    with open(md_filename, 'w') as f:
        f.write(f"# {report['title']}\n\n")
        f.write(f"**Generated:** {report['generated_at']}\n")
        f.write(f"**Mode:** {report['mode']}\n\n")
        f.write(f"---\n\n")
        f.write(f"## Executive Summary\n\n")
        f.write(report['executive_summary'])
        f.write(f"\n\n---\n\n")
        f.write(f"## Analysis by Sector\n\n")
        for sector, items in report.get('by_sector', {}).items():
            f.write(f"### {sector}\n\n")
            for item in items:
                f.write(f"**{item['symbol']}:** {item['analysis'][:300]}...\n\n")

    print(f"\nReport saved to: {filename}")
    print(f"Markdown saved to: {md_filename}")

    return filename


def main():
    parser = argparse.ArgumentParser(
        description="S&P 500 Global Radar - Massive parallel market analysis"
    )
    parser.add_argument(
        '--mode',
        choices=['sector', 'top100', 'sp500', 'custom'],
        default='sector',
        help="Analysis mode (default: sector)"
    )
    parser.add_argument(
        'symbols',
        nargs='*',
        help="Custom symbols (only used with --mode custom)"
    )
    parser.add_argument(
        '--concurrency',
        type=int,
        default=50,
        help="Max concurrent API requests (default: 50)"
    )
    parser.add_argument(
        '--model',
        default='deepseek-chat',
        help="DeepSeek model (default: deepseek-chat)"
    )

    args = parser.parse_args()

    # Select symbols based on mode
    if args.mode == 'sector':
        symbols = SECTOR_ETFS
    elif args.mode == 'top100':
        symbols = SP500_TOP_100
    elif args.mode == 'sp500':
        # Full S&P 500 would be loaded from file/API
        # For now, use top 100 as placeholder
        print("Full S&P 500 mode - using top 100 as demonstration")
        symbols = SP500_TOP_100
    elif args.mode == 'custom':
        if not args.symbols:
            print("Error: Custom mode requires symbols")
            sys.exit(1)
        symbols = args.symbols
    else:
        symbols = SECTOR_ETFS

    # Check for API key
    if not os.environ.get('DEEPSEEK_API_KEY'):
        print("Error: DEEPSEEK_API_KEY environment variable required")
        sys.exit(1)

    # Run radar
    report = run_radar_swarm(
        symbols=symbols,
        mode=args.mode,
        concurrency=args.concurrency,
        model=args.model
    )

    # Save report
    save_report(report, args.mode)

    # Print executive summary
    print("\n" + "="*60)
    print("EXECUTIVE SUMMARY")
    print("="*60)
    print(report['executive_summary'])


if __name__ == '__main__':
    main()
