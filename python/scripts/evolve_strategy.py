#!/usr/bin/env python3
"""
Evolutionary Strategy Forge
============================
Uses DeepSeek Swarm to mutate strategy code in parallel.

Unleashes 10-50 agents to genetically mutate a strategy file,
looking for optimizations you haven't thought of.

Usage:
    python scripts/evolve_strategy.py path/to/strategy.py --pop 20

Output:
    Saves mutated candidates to data/evolution_candidates/
"""

import os
import sys
import argparse
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.swarm import run_swarm_sync

# ============================================================================
# Evolution Prompt Template
# ============================================================================

EVOLUTION_PROMPT = """
You are an expert Quantitative Strategist specializing in Python algorithm optimization.
Your goal is to MUTATE the provided strategy code to potentially improve its Sharpe Ratio.

**Directives:**
1. Analyze the logic: identifying entry, exit, and risk management.
2. Apply ONE specific mutation type: {mutation_type}
3. Maintain valid Python syntax. The code MUST compile.
4. Keep the same class structure and interface.
5. Return ONLY the full Python code. No markdown, no explanation.

**Important:**
- Do NOT wrap code in markdown code blocks
- Output only raw Python code
- Preserve all imports and class definitions
- Make meaningful changes, not cosmetic ones
"""

MUTATION_TYPES = [
    "Make entry more aggressive (earlier signal, lower threshold)",
    "Make entry more conservative (require confirmation, higher threshold)",
    "Tighten risk management (smaller stops, stricter position limits)",
    "Loosen risk management (wider stops, let winners run longer)",
    "Add a volume filter (avoid low liquidity periods)",
    "Add a volatility filter (avoid high VIX environments)",
    "Switch trend detection method (EMA to SMA, or add MACD)",
    "Optimize exit logic for profit taking (trailing stops, targets)",
    "Reduce trading frequency (filter noise, avoid overtrading)",
    "Increase trading frequency (scalping mode, faster signals)",
    "Add regime detection (behave differently in different markets)",
    "Add mean reversion component to trend strategy",
    "Add momentum component to mean reversion strategy",
    "Optimize position sizing based on volatility",
    "Add correlation filter (avoid crowded trades)",
]


def evolve(strategy_path: str, population_size: int = 10, concurrency: int = 20):
    """
    Run genetic evolution on a strategy file.

    Args:
        strategy_path: Path to the strategy Python file
        population_size: Number of mutant variants to generate
        concurrency: Max concurrent API requests
    """
    print(f"Initializing Evolution for: {strategy_path}")

    strategy_file = Path(strategy_path)
    if not strategy_file.exists():
        print(f"Error: Strategy file not found: {strategy_path}")
        sys.exit(1)

    with open(strategy_file, 'r') as f:
        original_code = f.read()

    print(f"Original strategy: {len(original_code)} chars, {original_code.count(chr(10))} lines")

    # Create tasks for each mutation
    tasks = []
    for i in range(population_size):
        # Round-robin mutation types
        mutation = MUTATION_TYPES[i % len(MUTATION_TYPES)]

        tasks.append({
            "id": f"mutant_{i+1:02d}",
            "system": EVOLUTION_PROMPT.format(mutation_type=mutation),
            "user": f"Here is the strategy code to mutate:\n\n{original_code}",
            "model": "deepseek-chat",  # Chat is better for code generation
            "temperature": 0.7  # High temp for diversity
        })

    print(f"Launching swarm of {population_size} mutation agents...")
    results = run_swarm_sync(tasks, concurrency=concurrency)

    # Save candidates
    output_dir = PROJECT_ROOT / "data" / "evolution_candidates"
    output_dir.mkdir(parents=True, exist_ok=True)

    success_count = 0
    for r in results:
        if r['status'] == 'success':
            content = r['content']

            # Basic sanity check: does it look like python?
            if "class " in content or "def " in content:
                # Strip markdown blocks if present
                clean_code = content
                if "```python" in clean_code:
                    clean_code = clean_code.split("```python", 1)[-1]
                if "```" in clean_code:
                    clean_code = clean_code.split("```")[0]
                clean_code = clean_code.strip()

                # Verify it compiles
                try:
                    compile(clean_code, '<string>', 'exec')

                    filename = output_dir / f"{strategy_file.stem}_{r['id']}.py"
                    with open(filename, 'w') as f:
                        f.write(f"# Mutant: {r['id']}\n")
                        f.write(f"# Mutation applied by DeepSeek evolution\n\n")
                        f.write(clean_code)

                    success_count += 1
                    print(f"  Saved: {filename.name}")

                except SyntaxError as e:
                    print(f"  Mutant {r['id']}: Invalid syntax - {e}")
            else:
                print(f"  Mutant {r['id']}: Malformed (no class/def found)")
        else:
            print(f"  Mutant {r['id']}: Failed - {r.get('error', 'Unknown error')}")

    print(f"\nEvolution Complete: {success_count}/{population_size} candidates saved")
    print(f"Output directory: {output_dir}")
    print("\nNext Step: Run backtests on candidates to find survivors.")

    return success_count


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Evolve a trading strategy using DeepSeek swarm"
    )
    parser.add_argument(
        "strategy_path",
        help="Path to strategy .py file to mutate"
    )
    parser.add_argument(
        "--pop", type=int, default=10,
        help="Population size (number of mutants, default: 10)"
    )
    parser.add_argument(
        "--concurrency", type=int, default=20,
        help="Max concurrent API requests (default: 20)"
    )

    args = parser.parse_args()
    evolve(args.strategy_path, args.pop, args.concurrency)
