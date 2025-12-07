#!/usr/bin/env python3
"""
MEGA DISCOVERY SWARM - 300 DeepSeek Reasoner Agents
====================================================

Launches 3 parallel swarms of 100 agents each:
1. Factor Discovery (100 agents) - Test different factor formulas
2. Multi-Asset Analysis (100 agents) - Analyze multiple symbols
3. Structure Discovery (100 agents) - Find optimal option structures

Usage:
    python scripts/swarm_300_mega_discovery.py
"""

import asyncio
import aiohttp
import json
import time
import os
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any
import pandas as pd
import numpy as np

# Configuration
DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY')
DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
MODEL = 'deepseek-reasoner'
MAX_CONCURRENT = 50  # Max concurrent API calls (tune based on rate limits)
OUTPUT_DIR = Path('/Volumes/VelocityData/velocity_om/mega_swarm_results')

# Ensure output directory exists
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


async def call_deepseek_async(session: aiohttp.ClientSession, prompt: str, agent_id: str) -> Dict:
    """Make async call to DeepSeek API."""
    headers = {
        'Authorization': f'Bearer {DEEPSEEK_API_KEY}',
        'Content-Type': 'application/json'
    }

    payload = {
        'model': MODEL,
        'messages': [
            {'role': 'system', 'content': 'You are a quantitative finance expert analyzing market data. Be concise and return structured JSON results.'},
            {'role': 'user', 'content': prompt}
        ],
        'max_tokens': 2000,
        'temperature': 0.1
    }

    try:
        async with session.post(DEEPSEEK_URL, headers=headers, json=payload, timeout=120) as response:
            if response.status == 200:
                result = await response.json()
                content = result['choices'][0]['message']['content']
                return {'agent_id': agent_id, 'status': 'success', 'result': content}
            else:
                error = await response.text()
                return {'agent_id': agent_id, 'status': 'error', 'error': f'HTTP {response.status}: {error}'}
    except asyncio.TimeoutError:
        return {'agent_id': agent_id, 'status': 'timeout', 'error': 'Request timed out'}
    except Exception as e:
        return {'agent_id': agent_id, 'status': 'error', 'error': str(e)}


async def run_swarm(name: str, prompts: List[Dict], semaphore: asyncio.Semaphore) -> List[Dict]:
    """Run a swarm of agents with rate limiting."""
    print(f"\n{'='*60}")
    print(f"LAUNCHING {name.upper()} SWARM - {len(prompts)} agents")
    print(f"{'='*60}")

    results = []
    start_time = time.time()

    async with aiohttp.ClientSession() as session:
        async def limited_call(prompt_data):
            async with semaphore:
                result = await call_deepseek_async(session, prompt_data['prompt'], prompt_data['id'])
                result['metadata'] = prompt_data.get('metadata', {})
                return result

        tasks = [limited_call(p) for p in prompts]

        # Process with progress
        completed = 0
        for coro in asyncio.as_completed(tasks):
            result = await coro
            results.append(result)
            completed += 1
            if completed % 10 == 0:
                elapsed = time.time() - start_time
                rate = completed / elapsed
                print(f"  [{name}] {completed}/{len(prompts)} complete ({rate:.1f} agents/sec)")

    elapsed = time.time() - start_time
    success = sum(1 for r in results if r['status'] == 'success')
    print(f"  [{name}] COMPLETE: {success}/{len(prompts)} successful in {elapsed:.1f}s")

    return results


def generate_factor_discovery_prompts(features_df: pd.DataFrame, n_agents: int = 100) -> List[Dict]:
    """Generate prompts for Factor Discovery swarm."""
    prompts = []

    # Get numeric columns that could be factors
    numeric_cols = features_df.select_dtypes(include=[np.number]).columns.tolist()
    exclude = ['open', 'high', 'low', 'close', 'volume', 'timestamp']
    factor_cols = [c for c in numeric_cols if c not in exclude][:n_agents]

    for i, col in enumerate(factor_cols):
        # Calculate basic stats for the factor
        factor_data = features_df[col].dropna()
        stats = {
            'mean': float(factor_data.mean()),
            'std': float(factor_data.std()),
            'min': float(factor_data.min()),
            'max': float(factor_data.max()),
            'skew': float(factor_data.skew()) if len(factor_data) > 2 else 0,
        }

        prompt = f"""Analyze this factor for SPY options trading:

Factor Name: {col}
Statistics: {json.dumps(stats, indent=2)}

Tasks:
1. What market dynamic does this factor likely capture?
2. What direction should we trade? (above/below threshold)
3. What option structure would benefit from this factor?
4. What entry threshold would you suggest (in z-score terms)?
5. What is the expected holding period?

Return JSON with keys: market_dynamic, direction, structure, threshold_zscore, holding_days, confidence (0-1)"""

        prompts.append({
            'id': f'factor_{i:03d}_{col}',
            'prompt': prompt,
            'metadata': {'factor': col, 'stats': stats}
        })

    return prompts


def generate_multi_asset_prompts(n_agents: int = 100) -> List[Dict]:
    """Generate prompts for Multi-Asset swarm."""
    symbols = ['SPY', 'QQQ', 'IWM', 'XLF', 'XLE', 'XLK', 'XLV', 'XLI', 'XLP', 'XLU',
               'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V', 'MA']

    factors = ['momentum_5d', 'momentum_20d', 'volatility_ratio', 'rsi_14', 'macd_signal',
               'volume_trend', 'price_range', 'gap_frequency', 'mean_reversion', 'trend_strength']

    prompts = []
    agent_id = 0

    for symbol in symbols:
        for factor in factors:
            if agent_id >= n_agents:
                break

            prompt = f"""Analyze {symbol} with {factor} factor for options trading:

Symbol: {symbol}
Factor: {factor}

Tasks:
1. How does {factor} typically behave for {symbol}?
2. What is the optimal entry signal for this combination?
3. Which option strategy works best? (straddle, strangle, vertical spread, etc.)
4. What DTE range is optimal?
5. What delta should we target?

Return JSON with keys: behavior, entry_signal, strategy, dte_range, delta_target, edge_estimate"""

            prompts.append({
                'id': f'asset_{agent_id:03d}_{symbol}_{factor}',
                'prompt': prompt,
                'metadata': {'symbol': symbol, 'factor': factor}
            })
            agent_id += 1

        if agent_id >= n_agents:
            break

    return prompts


def generate_structure_discovery_prompts(n_agents: int = 100) -> List[Dict]:
    """Generate prompts for Structure Discovery swarm."""
    structures = [
        'long_call', 'long_put', 'short_call', 'short_put',
        'long_straddle', 'short_straddle', 'long_strangle', 'short_strangle',
        'bull_call_spread', 'bear_put_spread', 'iron_condor', 'iron_butterfly',
        'calendar_spread', 'diagonal_spread', 'ratio_spread', 'backspread'
    ]

    dtes = [7, 14, 21, 30, 45, 60]
    deltas = [10, 20, 25, 30, 40, 50]

    prompts = []
    agent_id = 0

    for structure in structures:
        for dte in dtes:
            if agent_id >= n_agents:
                break

            prompt = f"""Analyze this option structure configuration:

Structure: {structure}
DTE: {dte} days
Market: SPY options

Tasks:
1. What market conditions favor this structure at {dte} DTE?
2. What factor signals should trigger entry?
3. What is the typical profit target (% of max profit)?
4. What is the appropriate stop loss?
5. What is the expected win rate in different volatility regimes?

Return JSON with keys: favorable_conditions, entry_factors, profit_target_pct, stop_loss_pct, win_rate_low_vol, win_rate_high_vol, best_regime"""

            prompts.append({
                'id': f'struct_{agent_id:03d}_{structure}_{dte}d',
                'prompt': prompt,
                'metadata': {'structure': structure, 'dte': dte}
            })
            agent_id += 1

        if agent_id >= n_agents:
            break

    return prompts


async def main():
    """Run all three 100-agent swarms."""
    print("\n" + "="*70)
    print("  MEGA DISCOVERY SWARM - 300 DeepSeek Reasoner Agents")
    print("="*70)
    print(f"  Model: {MODEL}")
    print(f"  Max Concurrent: {MAX_CONCURRENT}")
    print(f"  Output: {OUTPUT_DIR}")
    print("="*70)

    start_time = time.time()

    # Load feature data for Factor Discovery
    features_path = '/Volumes/VelocityData/velocity_om/features/SPY_master_features.parquet'
    print(f"\nLoading features from {features_path}...")
    features_df = pd.read_parquet(features_path)
    print(f"  Loaded {len(features_df)} rows, {len(features_df.columns)} columns")

    # Generate all prompts
    print("\nGenerating prompts for 300 agents...")
    factor_prompts = generate_factor_discovery_prompts(features_df, 100)
    asset_prompts = generate_multi_asset_prompts(100)
    structure_prompts = generate_structure_discovery_prompts(100)

    print(f"  Factor Discovery: {len(factor_prompts)} agents")
    print(f"  Multi-Asset: {len(asset_prompts)} agents")
    print(f"  Structure Discovery: {len(structure_prompts)} agents")

    # Create semaphore for rate limiting
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    # Run all three swarms concurrently
    print("\n" + "="*70)
    print("  LAUNCHING ALL SWARMS CONCURRENTLY")
    print("="*70)

    results = await asyncio.gather(
        run_swarm("Factor Discovery", factor_prompts, semaphore),
        run_swarm("Multi-Asset", asset_prompts, semaphore),
        run_swarm("Structure Discovery", structure_prompts, semaphore)
    )

    factor_results, asset_results, structure_results = results

    # Save results
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    with open(OUTPUT_DIR / f'factor_discovery_{timestamp}.json', 'w') as f:
        json.dump(factor_results, f, indent=2, default=str)

    with open(OUTPUT_DIR / f'multi_asset_{timestamp}.json', 'w') as f:
        json.dump(asset_results, f, indent=2, default=str)

    with open(OUTPUT_DIR / f'structure_discovery_{timestamp}.json', 'w') as f:
        json.dump(structure_results, f, indent=2, default=str)

    # Summary
    elapsed = time.time() - start_time
    total_success = sum(1 for r in factor_results + asset_results + structure_results if r['status'] == 'success')

    print("\n" + "="*70)
    print("  MEGA SWARM COMPLETE")
    print("="*70)
    print(f"  Total agents: 300")
    print(f"  Successful: {total_success}")
    print(f"  Total time: {elapsed:.1f}s ({elapsed/60:.1f} min)")
    print(f"  Rate: {300/elapsed:.1f} agents/sec")
    print(f"  Results saved to: {OUTPUT_DIR}")
    print("="*70)

    return {
        'factor_results': factor_results,
        'asset_results': asset_results,
        'structure_results': structure_results,
        'total_time': elapsed,
        'success_rate': total_success / 300
    }


if __name__ == '__main__':
    asyncio.run(main())
