#!/usr/bin/env python3
"""
Adversarial Red Team Swarm
===========================
Uses DeepSeek Reasoner to attack strategy logic from multiple angles.

Summons the "Red Team" - distinct personas that ruthlessly analyze
your strategy code to find weaknesses before the market does.

Usage:
    python scripts/red_team_swarm.py path/to/strategy.py

Output:
    Writes detailed audit report to {strategy_path}_audit_report.md
"""

import os
import sys
import argparse
from pathlib import Path
from datetime import datetime

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.swarm import run_swarm_sync

# ============================================================================
# Red Team Personas
# ============================================================================

PERSONAS = {
    "liquidity_monster": {
        "name": "Liquidity Monster",
        "icon": "",
        "prompt": """You are a specialist in market microstructure and execution.

Analyze this trading strategy code for LIQUIDITY RISKS:
- What happens if bid-ask spreads widen by 10x during a crisis?
- What if volume disappears and you can't exit?
- Are there any "trapped trader" scenarios where the position becomes illiquid?
- Does the code account for slippage and market impact?
- What happens during market opens/closes when liquidity is thin?

Be ruthless. Find every way this strategy could die from illiquidity."""
    },

    "macro_shock": {
        "name": "Macro Shock Analyst",
        "icon": "",
        "prompt": """You are a Macro Risk Officer who has lived through 2008, 2020, and every crisis.

Analyze this strategy against EXTREME SCENARIOS:
- How does it behave during a 2008-style crash (correlations go to 1)?
- What about a 2020 COVID crash (fastest ever, then fastest recovery)?
- Will the margin call kill it before any recovery can happen?
- Does it assume normal distributions when tails are fat?
- Can it survive a flash crash where prices gap through stops?

Be brutal. Assume the worst-case scenario WILL happen."""
    },

    "overfitting_detective": {
        "name": "Overfitting Detective",
        "icon": "",
        "prompt": """You are a statistician and machine learning expert.

Analyze this strategy for OVERFITTING and CURVE-FITTING:
- Are there magic numbers or specific constants that look "tuned"?
- Does the logic look like it was designed to fit historical data?
- Are there too many parameters relative to the sample size?
- Is there any evidence of data snooping or selection bias?
- Would this strategy work on completely unseen data?

Be skeptical. Assume every impressive backtest is overfit until proven otherwise."""
    },

    "fee_vampire": {
        "name": "Fee Vampire",
        "icon": "",
        "prompt": """You are a cost accountant obsessed with transaction costs.

Analyze this strategy for COST DEATH:
- How many trades does it generate? What's the frequency?
- Calculate rough commission impact (assume $0.50-$1 per contract)
- Calculate slippage impact (assume 1 tick average)
- For options: what about the bid-ask spread (often 5-10% of premium)?
- Does the "alpha" survive after realistic transaction costs?
- Are there any unnecessary round-trips that eat into returns?

Be miserly. A strategy that trades too much is just feeding brokers."""
    },

    "correlation_killer": {
        "name": "Correlation Killer",
        "icon": "",
        "prompt": """You are an expert in portfolio correlation and crowding.

Analyze this strategy for CORRELATION RISKS:
- Is this a crowded trade that everyone else is also running?
- What happens when all similar strategies unwind at once?
- Are there hidden correlations to other risk factors (SPY, VIX, rates)?
- Does this strategy have the same risk profile as other strategies?
- During stress, does everything become correlated anyway?

Be paranoid. In a crisis, the only correlation is 1."""
    },

    "regime_blind": {
        "name": "Regime Blindness Expert",
        "icon": "",
        "prompt": """You are an expert in market regimes and structural changes.

Analyze this strategy for REGIME BLINDNESS:
- Does it assume the market regime is constant?
- What if the Fed changes policy dramatically?
- What if market structure changes (new regulations, new players)?
- Does it work in low-vol AND high-vol environments?
- Has it been tested across different market cycles?

Be prescient. The market of tomorrow is not the market of yesterday."""
    }
}


def red_team_attack(strategy_path: str, concurrency: int = 10):
    """
    Run adversarial red team analysis on a strategy.

    Args:
        strategy_path: Path to the strategy Python file
        concurrency: Max concurrent API requests
    """
    print(f"Initializing Red Team Attack on: {strategy_path}")

    strategy_file = Path(strategy_path)
    if not strategy_file.exists():
        print(f"Error: Strategy file not found: {strategy_path}")
        sys.exit(1)

    with open(strategy_file, 'r') as f:
        code = f.read()

    print(f"Strategy: {len(code)} chars, {code.count(chr(10))} lines")
    print(f"Summoning {len(PERSONAS)} Red Team agents...")

    # Create tasks for each persona
    tasks = []
    for role, persona in PERSONAS.items():
        tasks.append({
            "id": role,
            "system": persona["prompt"] + "\n\nProvide a ruthless, detailed critique. No compliments. Find the flaws.",
            "user": f"Here is the strategy source code to attack:\n\n{code}",
            "model": "deepseek-reasoner",  # Reasoner is best for analytical critique
            "temperature": 0.0  # Zero temp for analytical precision
        })

    print(f"Launching swarm...")
    results = run_swarm_sync(tasks, concurrency=concurrency)

    # Generate Report
    report_path = strategy_file.parent / f"{strategy_file.stem}_audit_report.md"

    with open(report_path, 'w') as f:
        f.write(f"# Red Team Audit Report\n\n")
        f.write(f"**Strategy:** `{strategy_file.name}`\n\n")
        f.write(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        f.write(f"**Agents Deployed:** {len(PERSONAS)}\n\n")
        f.write("---\n\n")

        success_count = 0
        for r in results:
            persona = PERSONAS.get(r['id'], {})
            icon = persona.get('icon', '')
            name = persona.get('name', r['id'].upper())

            if r['status'] == 'success':
                success_count += 1
                f.write(f"## {icon} {name}\n\n")
                f.write(f"### Critique\n\n{r['content']}\n\n")

                # Include reasoning chain if available
                if r.get('reasoning'):
                    f.write(f"<details>\n<summary>View Internal Reasoning Chain</summary>\n\n")
                    f.write(f"```\n{r['reasoning']}\n```\n\n")
                    f.write(f"</details>\n\n")
            else:
                f.write(f"## {icon} {name}\n\n")
                f.write(f"**Agent Failed:** {r.get('error', 'Unknown error')}\n\n")

            f.write("---\n\n")

        # Summary section
        f.write("## Summary\n\n")
        f.write(f"- **Agents Completed:** {success_count}/{len(PERSONAS)}\n")
        f.write(f"- **Report Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n")
        f.write("### Next Steps\n\n")
        f.write("1. Review each critique carefully\n")
        f.write("2. Prioritize issues by severity and likelihood\n")
        f.write("3. Address critical vulnerabilities before live trading\n")
        f.write("4. Consider running White Noise Protocol (sanity_check mode) to detect overfitting\n")

    print(f"\nRed Team Attack Complete: {success_count}/{len(PERSONAS)} agents reported")
    print(f"Audit report written to: {report_path}")

    return report_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run adversarial red team analysis on a trading strategy"
    )
    parser.add_argument(
        "strategy_path",
        help="Path to strategy .py file to audit"
    )
    parser.add_argument(
        "--concurrency", type=int, default=10,
        help="Max concurrent API requests (default: 10)"
    )

    args = parser.parse_args()
    red_team_attack(args.strategy_path, args.concurrency)
