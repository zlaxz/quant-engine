#!/usr/bin/env python3
"""
100-Agent Discovery Swarm - TRUE EXPLORATION

Unlike the pre-defined question approach, this gives agents:
1. Open access to the entire codebase and data
2. ONE mission: "Discover opportunities to generate alpha"
3. Different starting seeds so they explore different paths
4. Freedom to follow their curiosity

The magic: 100 independent explorations → emergent discoveries we couldn't pre-specify
"""

import os
import sys
import json
import random
import concurrent.futures
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from deepseek_agent import run_agent

PROJECT_ROOT = "/Users/zstoc/GitHub/quant-engine"

# The ONE mission - intentionally open-ended
DISCOVERY_MISSION = """
## YOUR MISSION: Discover Alpha Opportunities

You are an AI researcher with FULL ACCESS to a quantitative trading system called "quant-engine".
Your job is to EXPLORE freely and DISCOVER opportunities to generate massive financial returns.

### What You Have Access To:

**Codebase:** /Users/zstoc/GitHub/quant-engine/
- `python/engine/features/` - 441 market features (gamma, flow, entropy, regime, etc.)
- `python/engine/ai_native/` - AI pipeline (observers, synthesis, adversarial)
- `python/engine/discovery/` - Swarm engines for feature/equation discovery
- `python/engine/trading/` - Backtesting and execution

**Data:**
- 394 MILLION options rows at /Volumes/VelocityData/velocity_om/massive/options/
- 13 MILLION stock rows at /Volumes/VelocityData/velocity_om/massive/stocks/
- 16 liquid ETFs: SPY, QQQ, IWM, DIA, GLD, SLV, TLT, IEF, HYG, XLF, XLE, XLK, XLV, USO, FXI, EEM

**Tools Available:**
- read_file: Read any code or data file
- search_code: Grep through the codebase
- list_directory: Explore directory structures
- query_data: Run SQL against the market data

### Your Starting Seed
{seed_description}

### Instructions
1. START by exploring your seed area
2. FOLLOW your curiosity - read files, search code, query data
3. THINK about what could generate alpha (profitable trading signals)
4. DISCOVER something the system isn't currently doing, or could do better
5. BE SPECIFIC - cite files, line numbers, data patterns

### Output Format
After exploring, report your discovery:

## Discovery Title
[One line describing what you found]

## What I Explored
[List the files you read, searches you ran, data you queried]

## The Opportunity
[Detailed description of the alpha opportunity you discovered]

## Why This Could Make Money
[The mechanism - WHY would this generate returns?]

## Implementation Sketch
[High-level how to implement this]

## Confidence Level
[High/Medium/Low and why]

## Files Referenced
[List of specific files and line numbers]

BE BOLD. Look for things that aren't obvious. The best discoveries are unexpected.
"""

# 100 different starting seeds - each agent starts exploration from a different place
# This ensures diverse exploration paths leading to diverse discoveries
EXPLORATION_SEEDS = [
    # === CODE EXPLORATION SEEDS (40) ===
    ("CODE", "python/engine/features/gamma_calc.py", "Start by reading the gamma calculation code. What opportunities exist in dealer gamma dynamics?"),
    ("CODE", "python/engine/features/flow.py", "Start by reading the order flow code (VPIN, Kyle's lambda). What flow signals are underutilized?"),
    ("CODE", "python/engine/features/entropy.py", "Start by reading the entropy code. How can information theory generate alpha?"),
    ("CODE", "python/engine/features/correlation.py", "Start by reading correlation dynamics code. What correlation patterns are tradeable?"),
    ("CODE", "python/engine/features/regime.py", "Start by reading the HMM regime code. How can regime detection be improved or exploited?"),
    ("CODE", "python/engine/features/change_point.py", "Start by reading change point detection. What regime transitions are most profitable?"),
    ("CODE", "python/engine/features/duration.py", "Start by reading duration/hazard modeling. Can we predict how long regimes last?"),
    ("CODE", "python/engine/features/morphology.py", "Start by reading shape analysis code. What distribution shapes predict moves?"),
    ("CODE", "python/engine/features/dynamics.py", "Start by reading dynamics code. What time derivatives matter for trading?"),
    ("CODE", "python/engine/features/mm_inventory.py", "Start by reading market maker inventory code. How can we exploit MM positioning?"),
    ("CODE", "python/engine/ai_native/force_aggregator.py", "Start by reading the force aggregator. How are market forces combined? What's missing?"),
    ("CODE", "python/engine/ai_native/observers.py", "Start by reading the AI observers. What market phenomena aren't being observed?"),
    ("CODE", "python/engine/ai_native/synthesis.py", "Start by reading the AI synthesis. How can thesis generation be improved?"),
    ("CODE", "python/engine/ai_native/adversarial.py", "Start by reading adversarial code. How can we stress-test predictions better?"),
    ("CODE", "python/engine/ai_native/expression.py", "Start by reading expression code. How are trades structured? What's optimal?"),
    ("CODE", "python/engine/ai_native/learning.py", "Start by reading the learning code. How does the system improve over time?"),
    ("CODE", "python/engine/discovery/swarm_engine.py", "Start by reading the swarm engine. How can swarm intelligence be enhanced?"),
    ("CODE", "python/engine/discovery/structure_miner.py", "Start by reading structure mining. What patterns are being mined?"),
    ("CODE", "python/engine/discovery/fast_backtester.py", "Start by reading the backtester. What backtesting improvements would help?"),
    ("CODE", "python/engine/trading/simulator.py", "Start by reading the trade simulator. What execution improvements are possible?"),
    ("CODE", "python/engine/features/raw_features.py", "Start by reading raw features. What basic features are computed?"),
    ("CODE", "python/engine/features/domain_features.py", "Start by reading domain features. What domain knowledge is encoded?"),
    ("CODE", "python/engine/data/db_manager.py", "Start by reading the data manager. How is data accessed? What's inefficient?"),
    ("CODE", "python/server.py", "Start by reading the server. How does the system run? What's the architecture?"),
    ("CODE", "python/daemon.py", "Start by reading the daemon. What background processes run?"),
    ("CODE", "src/electron/tools/toolDefinitions.ts", "Start by reading tool definitions. What tools exist? What's missing?"),
    ("CODE", "src/electron/tools/toolHandlers.ts", "Start by reading tool handlers. How are tools executed?"),
    ("CODE", "src/prompts/chiefQuantPrompt.ts", "Start by reading the AI prompt. How is the AI instructed?"),
    ("CODE", "python/engine/ui_bridge.py", "Start by reading the UI bridge. How does Python communicate with the UI?"),
    ("CODE", "python/engine/portfolio/", "Explore the portfolio directory. What portfolio management exists?"),
    ("CODE", "python/sigma_agent/", "Explore the sigma agent directory. What does this agent do?"),
    ("CODE", "scripts/deepseek_agent.py", "Read the DeepSeek agent code. How can agents be improved?"),
    ("CODE", "scripts/improvement_swarm.py", "Read the improvement swarm. What improvements were already identified?"),
    ("CODE", "HANDOFF.md", "Read the handoff document. What's the current state? What's incomplete?"),
    ("CODE", "SWARM_1000_PLAN.md", "Read the swarm plan. What's the vision? What's not implemented?"),
    ("CODE", "python/engine/features/", "List the features directory. What features exist? What's missing?"),
    ("CODE", "python/engine/ai_native/", "List the AI native directory. What's the AI architecture?"),
    ("CODE", "python/engine/discovery/", "List the discovery directory. What discovery mechanisms exist?"),
    ("CODE", "python/engine/trading/", "List the trading directory. What trading infrastructure exists?"),
    ("CODE", "python/scripts/", "List the scripts directory. What can be run?"),

    # === CONCEPT EXPLORATION SEEDS (30) ===
    ("CONCEPT", "gamma_exposure", "Explore how dealer gamma exposure is calculated and used. Search for 'gamma', 'GEX', 'dealer'. What gamma-based alpha exists?"),
    ("CONCEPT", "volatility_surface", "Explore volatility surface analysis. Search for 'vol', 'surface', 'skew', 'smile'. What vol surface patterns generate alpha?"),
    ("CONCEPT", "order_flow", "Explore order flow analysis. Search for 'VPIN', 'flow', 'toxicity', 'kyle'. What flow signals are predictive?"),
    ("CONCEPT", "regime_detection", "Explore regime detection. Search for 'regime', 'HMM', 'state'. How can regime transitions be traded?"),
    ("CONCEPT", "market_maker", "Explore market maker modeling. Search for 'inventory', 'dealer', 'MM'. How can we exploit MM behavior?"),
    ("CONCEPT", "entropy", "Explore information theory. Search for 'entropy', 'information', 'transfer'. What information patterns matter?"),
    ("CONCEPT", "correlation", "Explore correlation dynamics. Search for 'correlation', 'DCC', 'GARCH'. What correlation patterns are tradeable?"),
    ("CONCEPT", "change_point", "Explore change point detection. Search for 'CUSUM', 'BOCPD', 'PELT'. When do regimes change?"),
    ("CONCEPT", "greeks", "Explore options Greeks. Search for 'delta', 'gamma', 'vanna', 'charm'. How do Greeks create trading opportunities?"),
    ("CONCEPT", "mean_reversion", "Explore mean reversion. Search for 'reversion', 'OU', 'half-life'. What mean reverts and when?"),
    ("CONCEPT", "momentum", "Explore momentum. Search for 'momentum', 'trend', 'velocity'. What momentum signals work?"),
    ("CONCEPT", "seasonality", "Explore seasonality. Search for 'season', 'month', 'day', 'OpEx'. What calendar patterns exist?"),
    ("CONCEPT", "tail_risk", "Explore tail risk. Search for 'tail', 'crash', 'drawdown'. How can we protect against or profit from tails?"),
    ("CONCEPT", "liquidity", "Explore liquidity. Search for 'liquidity', 'spread', 'depth'. How does liquidity affect returns?"),
    ("CONCEPT", "cross_asset", "Explore cross-asset relationships. Search for the 16 ETF symbols. What cross-asset signals exist?"),
    ("CONCEPT", "positioning", "Explore market positioning. Search for 'position', 'open interest', 'OI'. What positioning extremes are tradeable?"),
    ("CONCEPT", "expiration", "Explore options expiration. Search for 'expir', 'OpEx', 'pin'. What expiration dynamics are tradeable?"),
    ("CONCEPT", "term_structure", "Explore term structure. Search for 'term', 'calendar', 'spread'. What term structure patterns matter?"),
    ("CONCEPT", "backtest", "Explore backtesting. Search for 'backtest', 'simulate', 'PnL'. What backtesting improvements are needed?"),
    ("CONCEPT", "risk", "Explore risk management. Search for 'risk', 'drawdown', 'Kelly'. How should positions be sized?"),
    ("CONCEPT", "execution", "Explore trade execution. Search for 'execute', 'slippage', 'fill'. How can execution be improved?"),
    ("CONCEPT", "feature_selection", "Explore feature selection. Search for 'feature', 'select', 'importance'. Which features matter most?"),
    ("CONCEPT", "equation_discovery", "Explore equation discovery. Search for 'PySR', 'equation', 'symbolic'. Can we find market laws?"),
    ("CONCEPT", "neural", "Explore neural network approaches. Search for 'neural', 'ML', 'model'. What ML could help?"),
    ("CONCEPT", "causality", "Explore causal relationships. Search for 'causal', 'granger', 'lead'. What causes what?"),
    ("CONCEPT", "microstructure", "Explore market microstructure. Search for 'micro', 'tick', 'quote'. What microstructure signals exist?"),
    ("CONCEPT", "sentiment", "Explore sentiment. Search for 'sentiment', 'put/call', 'fear'. What sentiment signals work?"),
    ("CONCEPT", "arbitrage", "Explore arbitrage. Search for 'arbitrage', 'mispricing'. What arbitrage opportunities exist?"),
    ("CONCEPT", "hedge", "Explore hedging. Search for 'hedge', 'delta neutral'. How should positions be hedged?"),
    ("CONCEPT", "portfolio", "Explore portfolio construction. Search for 'portfolio', 'allocation'. How should capital be allocated?"),

    # === DATA EXPLORATION SEEDS (20) ===
    ("DATA", "options_volume", "Query the options data for volume patterns. What volume anomalies predict price moves?"),
    ("DATA", "open_interest", "Query the options data for open interest patterns. What OI changes are predictive?"),
    ("DATA", "implied_vol", "Query the options data for implied volatility patterns. What IV patterns generate alpha?"),
    ("DATA", "price_returns", "Query the stock data for return patterns. What return patterns are exploitable?"),
    ("DATA", "volume_price", "Query the relationship between volume and price. When does volume predict direction?"),
    ("DATA", "cross_asset_corr", "Query cross-asset correlations across the 16 ETFs. What correlation patterns matter?"),
    ("DATA", "volatility_regimes", "Query for volatility regime patterns. How does vol regime affect returns?"),
    ("DATA", "options_greeks", "Query options Greeks data. What Greeks patterns predict moves?"),
    ("DATA", "strike_distribution", "Query the distribution of options activity by strike. Where is activity concentrated?"),
    ("DATA", "expiry_patterns", "Query patterns around options expiration. What OpEx effects exist?"),
    ("DATA", "intraday_patterns", "Query for time-of-day patterns if available. What intraday effects exist?"),
    ("DATA", "weekly_patterns", "Query for day-of-week patterns. What weekly seasonality exists?"),
    ("DATA", "monthly_patterns", "Query for month-of-year patterns. What monthly seasonality exists?"),
    ("DATA", "vix_relationship", "Query the relationship between VIX and other assets. When does VIX predict moves?"),
    ("DATA", "sector_rotation", "Query sector ETFs for rotation patterns. What rotation signals work?"),
    ("DATA", "bond_equity", "Query bond-equity relationships (TLT, IEF vs SPY). When do correlations break?"),
    ("DATA", "commodity_signals", "Query commodity ETFs (GLD, SLV, USO). What commodity patterns predict equity moves?"),
    ("DATA", "em_contagion", "Query emerging market ETFs (FXI, EEM). When does EM stress spread?"),
    ("DATA", "put_call_ratio", "Query put/call ratios. What ratio extremes are tradeable?"),
    ("DATA", "gamma_levels", "Query gamma exposure by strike level. Where are gamma concentrations?"),

    # === WILD CARD SEEDS (10) - Completely open-ended ===
    ("WILD", "contrarian", "Find something EVERYONE is doing wrong in quantitative finance. What conventional wisdom is broken?"),
    ("WILD", "hidden_gem", "Find a feature or capability in this codebase that's underutilized. What's the hidden gem?"),
    ("WILD", "simplify", "Find something overcomplicated that could be simplified. What complexity is unnecessary?"),
    ("WILD", "combine", "Find two things that should be combined but aren't. What synergies are missing?"),
    ("WILD", "physics", "Apply physics thinking to markets. What physics principles aren't being used?"),
    ("WILD", "information", "Apply information theory thinking. What information is being wasted?"),
    ("WILD", "game_theory", "Apply game theory thinking. What game-theoretic insights are missing?"),
    ("WILD", "network", "Apply network/graph thinking. What network effects aren't being modeled?"),
    ("WILD", "behavioral", "Apply behavioral finance thinking. What behavioral biases can be exploited?"),
    ("WILD", "meta", "Think about thinking. How can the PROCESS of discovery be improved?"),
]

def create_agent_task(seed_idx: int) -> tuple:
    """Create a task for an agent with its assigned seed"""
    seed_type, seed_target, seed_description = EXPLORATION_SEEDS[seed_idx % len(EXPLORATION_SEEDS)]

    full_seed = f"""
Starting Point: {seed_type}
Target: {seed_target}
Guidance: {seed_description}
"""

    task = DISCOVERY_MISSION.format(seed_description=full_seed)

    # Assign model: reasoner for WILD and every 4th agent, chat for others
    if seed_type == "WILD" or seed_idx % 4 == 0:
        model = "deepseek-reasoner"
    else:
        model = "deepseek-chat"

    return (f"DISC_{seed_idx:03d}", seed_type, seed_target, model, task)


def run_discovery_agent(agent_data: tuple) -> dict:
    """Run a single discovery agent"""
    agent_id, seed_type, seed_target, model, task = agent_data

    print(f"[Discovery] {agent_id} starting ({model}): {seed_type}/{seed_target}", file=sys.stderr)

    try:
        result = run_agent(task, agent_type='researcher', model=model)
        return {
            "id": agent_id,
            "seed_type": seed_type,
            "seed_target": seed_target,
            "model": model,
            "result": result,
            "status": "success"
        }
    except Exception as e:
        return {
            "id": agent_id,
            "seed_type": seed_type,
            "seed_target": seed_target,
            "model": model,
            "result": str(e),
            "status": "error"
        }


def run_discovery_swarm(n_agents: int = 100, max_workers: int = 25):
    """Run the discovery swarm

    Args:
        n_agents: Number of discovery agents to run
        max_workers: Parallel worker count
    """

    # Create agent tasks
    agents = [create_agent_task(i) for i in range(n_agents)]

    chat_count = sum(1 for a in agents if a[3] == "deepseek-chat")
    reasoner_count = sum(1 for a in agents if a[3] == "deepseek-reasoner")

    print(f"\n{'='*60}")
    print(f"DISCOVERY SWARM - TRUE EXPLORATION")
    print(f"{'='*60}")
    print(f"Agents: {n_agents}")
    print(f"  - deepseek-chat: {chat_count}")
    print(f"  - deepseek-reasoner: {reasoner_count}")
    print(f"Workers: {max_workers}")
    print(f"Estimated cost: ~${n_agents * 0.05:.2f}")
    print(f"{'='*60}\n")

    start_time = datetime.now()
    results = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_agent = {
            executor.submit(run_discovery_agent, a): a
            for a in agents
        }

        completed = 0
        for future in concurrent.futures.as_completed(future_to_agent):
            completed += 1
            try:
                result = future.result()
                results.append(result)
                status = "OK" if result["status"] == "success" else "ERR"
                print(f"[{completed}/{n_agents}] [{status}] {result['id']}: {result['seed_type']}/{result['seed_target'][:30]}", file=sys.stderr)
            except Exception as e:
                agent = future_to_agent[future]
                print(f"[{completed}/{n_agents}] [EXC] {agent[0]}: {e}", file=sys.stderr)

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()

    # Save results
    output_dir = Path(__file__).parent / "reports"
    output_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = output_dir / f"discovery_swarm_{timestamp}.json"

    report = {
        "timestamp": timestamp,
        "duration_seconds": duration,
        "n_agents": n_agents,
        "successful": sum(1 for r in results if r["status"] == "success"),
        "failed": sum(1 for r in results if r["status"] == "error"),
        "results": results
    }

    with open(output_file, 'w') as f:
        json.dump(report, f, indent=2)

    print(f"\n{'='*60}")
    print(f"DISCOVERY COMPLETE")
    print(f"Duration: {duration:.1f}s ({duration/60:.1f} min)")
    print(f"Success: {report['successful']}/{n_agents}")
    print(f"Results: {output_file}")
    print(f"{'='*60}\n")

    # Generate discovery summary
    summary_file = output_dir / f"discovery_summary_{timestamp}.md"
    summary = generate_discovery_summary(report)
    with open(summary_file, 'w') as f:
        f.write(summary)
    print(f"Summary: {summary_file}")

    return report


def generate_discovery_summary(report: dict) -> str:
    """Generate human-readable discovery summary"""
    lines = []
    lines.append("# Discovery Swarm Results")
    lines.append(f"\nGenerated: {report['timestamp']}")
    lines.append(f"Duration: {report['duration_seconds']/60:.1f} minutes")
    lines.append(f"Success: {report['successful']}/{report['n_agents']}")
    lines.append("")

    # Group by seed type
    by_type = {}
    for r in report['results']:
        t = r['seed_type']
        if t not in by_type:
            by_type[t] = []
        if r['status'] == 'success':
            by_type[t].append(r)

    for seed_type in ['CODE', 'CONCEPT', 'DATA', 'WILD']:
        if seed_type in by_type:
            lines.append(f"\n## {seed_type} Discoveries ({len(by_type[seed_type])})\n")
            for r in by_type[seed_type]:
                lines.append(f"### {r['id']}: {r['seed_target']}")
                lines.append(f"Model: {r['model']}")
                lines.append("")
                # First 1000 chars of result
                preview = r['result'][:1500] if len(r['result']) > 1500 else r['result']
                lines.append(preview)
                lines.append("\n---\n")

    return '\n'.join(lines)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run discovery swarm")
    parser.add_argument("--agents", type=int, default=100, help="Number of agents")
    parser.add_argument("--workers", type=int, default=25, help="Parallel workers")
    parser.add_argument("--single", type=int, default=None, help="Run single agent by seed index")
    parser.add_argument("--list-seeds", action="store_true", help="List all seeds")

    args = parser.parse_args()

    if args.list_seeds:
        for i, (t, target, desc) in enumerate(EXPLORATION_SEEDS):
            print(f"[{i:3d}] {t:8s} {target[:40]:40s} {desc[:50]}...")
    elif args.single is not None:
        agent = create_agent_task(args.single)
        result = run_discovery_agent(agent)
        print(json.dumps(result, indent=2))
    else:
        run_discovery_swarm(n_agents=args.agents, max_workers=args.workers)
