#!/usr/bin/env python3
"""
50-Agent Improvement Swarm for Quant-Engine
Analyzes every angle for money-making potential improvements
"""

import os
import sys
import json
import concurrent.futures
from datetime import datetime
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))
from deepseek_agent import run_agent

# Project context for all agents
PROJECT_CONTEXT = """
## Quant-Engine: Market Physics Engine

A quantitative trading system that discovers the F=ma of financial markets.

### Architecture (9 Layers):
- Layer 0: Raw Data (394M options rows, 13M stock rows)
- Layer 1: Algorithmic Morphology (skewness, kurtosis, Dip Test)
- Layer 2: Dynamics (dγ/dt, entropy decay, OU estimation)
- Layer 3: Force Calculation (gamma, VPIN, Kyle's λ, MM inventory)
- Layer 4: Causal Inference (WHY shapes form)
- Layer 5: Equation Discovery (PySR symbolic regression)
- Layer 6: Regime Transition Prediction (HMM, CUSUM, BOCPD)
- Layer 7: AI Reasoning (observers, synthesis, adversarial)
- Layer 8: Convexity Expression (optimal options structures)
- Layer 9: Learning (refine equations from outcomes)

### Key Components:
- 441 features computed from market data
- ScoutSwarm: Genetic algorithm for feature selection
- MathSwarm: PySR for equation discovery
- JurySwarm: Regime clustering
- TradeSimulator: Backtesting engine
- AI-Native Pipeline: Observer → Synthesis → Adversarial → Expression

### Data Available:
- /Volumes/VelocityData/velocity_om/massive/stocks/ (13M rows)
- /Volumes/VelocityData/velocity_om/massive/options/ (394M rows)
- 16 liquid symbols: SPY, QQQ, IWM, DIA, GLD, SLV, TLT, etc.

### Current Capabilities:
- Dealer gamma exposure (GEX) calculation
- VPIN (order flow toxicity)
- Kyle's Lambda (price impact)
- HMM regime detection
- Change point detection (CUSUM, BOCPD, PELT)
- Duration/hazard modeling
- Transfer entropy (causality)
- DCC-GARCH correlation dynamics
- Market maker inventory models

### Goal: Find improvements to maximize money-making potential.
"""

# 50 Improvement-Focused Questions
IMPROVEMENT_QUESTIONS = [
    # === ALPHA DISCOVERY (10 agents) ===
    {
        "id": "ALPHA_01",
        "category": "Alpha Discovery",
        "question": "What alpha signals from OPTIONS FLOW are we NOT capturing? Analyze the 394M options rows - what patterns in volume, open interest changes, or unusual activity could predict price moves that we're missing?",
        "files": ["python/engine/features/flow.py", "python/engine/features/gamma_calc.py"]
    },
    {
        "id": "ALPHA_02",
        "category": "Alpha Discovery",
        "question": "How can we extract MORE signal from the volatility surface? We have full options chains - what term structure patterns, skew dynamics, or butterfly spreads predict regime changes?",
        "files": ["python/engine/features/gamma_calc.py", "python/engine/features/morphology.py"]
    },
    {
        "id": "ALPHA_03",
        "category": "Alpha Discovery",
        "question": "What CROSS-ASSET signals are we missing? With 16 liquid ETFs (SPY, QQQ, GLD, TLT, etc.), what correlation breakdowns, lead-lag relationships, or rotation signals could we exploit?",
        "files": ["python/engine/features/correlation.py", "python/engine/features/sector_regime.py"]
    },
    {
        "id": "ALPHA_04",
        "category": "Alpha Discovery",
        "question": "How can TRANSFER ENTROPY reveal tradeable causality? Which assets lead others? How can we use information flow to predict moves BEFORE they happen?",
        "files": ["python/engine/features/entropy.py"]
    },
    {
        "id": "ALPHA_05",
        "category": "Alpha Discovery",
        "question": "What INTRADAY patterns could we capture? Our data is daily but options have intraday dynamics. What end-of-day, open imbalance, or time-of-day effects could we model?",
        "files": ["python/engine/features/raw_features.py"]
    },
    {
        "id": "ALPHA_06",
        "category": "Alpha Discovery",
        "question": "How can we profit from OPTION EXPIRATION dynamics? Pin risk, gamma squeeze into expiry, max pain effects - what mechanical forces around expiration are tradeable?",
        "files": ["python/engine/features/gamma_calc.py", "python/engine/features/mm_inventory.py"]
    },
    {
        "id": "ALPHA_07",
        "category": "Alpha Discovery",
        "question": "What SENTIMENT signals could we derive from options? Put/call ratios, skew changes, unusual volume - how can options positioning reveal crowd sentiment extremes?",
        "files": ["python/engine/features/flow.py", "python/engine/features/mm_inventory.py"]
    },
    {
        "id": "ALPHA_08",
        "category": "Alpha Discovery",
        "question": "How can we detect INSTITUTIONAL FLOW vs retail? Large block trades, delta-hedged positions, spread trades - what footprints reveal smart money positioning?",
        "files": ["python/engine/features/flow.py"]
    },
    {
        "id": "ALPHA_09",
        "category": "Alpha Discovery",
        "question": "What VOLATILITY ARBITRAGE opportunities exist? VIX vs realized vol, term structure trades, variance swaps - how can we systematically harvest vol premium?",
        "files": ["python/engine/features/domain_features.py", "python/engine/features/dynamics.py"]
    },
    {
        "id": "ALPHA_10",
        "category": "Alpha Discovery",
        "question": "How can we exploit MEAN REVERSION in dealer gamma? When GEX is extreme, dealers must hedge - what systematic mean reversion strategy captures this?",
        "files": ["python/engine/features/gamma_calc.py", "python/engine/features/mm_inventory.py"]
    },

    # === MARKET PHYSICS EXPANSION (8 agents) ===
    {
        "id": "PHYS_01",
        "category": "Market Physics",
        "question": "What additional FORCES should we model? Beyond gamma, flow, correlation - what other mechanical forces move markets? Leverage? Margin calls? ETF rebalancing?",
        "files": ["python/engine/ai_native/force_aggregator.py"]
    },
    {
        "id": "PHYS_02",
        "category": "Market Physics",
        "question": "How can we better model DEALER BEHAVIOR? Market makers have inventory limits, risk constraints, end-of-day flattening. What dealer mechanics are we missing?",
        "files": ["python/engine/features/mm_inventory.py", "python/engine/features/gamma_calc.py"]
    },
    {
        "id": "PHYS_03",
        "category": "Market Physics",
        "question": "What SECOND-ORDER EFFECTS matter? We track dγ/dt - what about d²γ/dt²? Acceleration of forces? Jerk? What higher-order dynamics predict reversals?",
        "files": ["python/engine/features/dynamics.py"]
    },
    {
        "id": "PHYS_04",
        "category": "Market Physics",
        "question": "How can we model LIQUIDITY as a force? Order book depth, bid-ask spreads, market impact - how does liquidity create or dampen price moves?",
        "files": ["python/engine/features/flow.py", "python/engine/features/mm_inventory.py"]
    },
    {
        "id": "PHYS_05",
        "category": "Market Physics",
        "question": "What FEEDBACK LOOPS exist in market mechanics? Gamma squeeze → more buying → more gamma. How can we detect and trade these reflexive dynamics?",
        "files": ["python/engine/features/gamma_calc.py", "python/engine/features/dynamics.py"]
    },
    {
        "id": "PHYS_06",
        "category": "Market Physics",
        "question": "How can we model CROWDING risk? When everyone is positioned the same way, exits become correlated. What crowding metrics predict violent reversals?",
        "files": ["python/engine/features/correlation.py", "python/engine/features/mm_inventory.py"]
    },
    {
        "id": "PHYS_07",
        "category": "Market Physics",
        "question": "What STRUCTURAL BREAKS matter most? CUSUM detects changes - but which regime transitions are most tradeable? What's the physics of regime change?",
        "files": ["python/engine/features/change_point.py", "python/engine/features/regime.py"]
    },
    {
        "id": "PHYS_08",
        "category": "Market Physics",
        "question": "How can we model VANNA and CHARM flows? Second-order Greeks create mechanical buying/selling. What strategies exploit these flows?",
        "files": ["python/engine/features/gamma_calc.py"]
    },

    # === TRADING STRATEGY IDEAS (8 agents) ===
    {
        "id": "STRAT_01",
        "category": "Trading Strategy",
        "question": "What OPTIONS STRUCTURES best express each regime? Straddles for volatility, butterflies for range-bound, backspreads for breakouts - design regime-specific playbook.",
        "files": ["python/engine/ai_native/expression.py", "python/engine/features/regime.py"]
    },
    {
        "id": "STRAT_02",
        "category": "Trading Strategy",
        "question": "How can we build a GAMMA SCALPING strategy? When to be long gamma and scalp? When to sell gamma and collect theta? What regime signals the switch?",
        "files": ["python/engine/features/gamma_calc.py", "python/engine/trading/simulator.py"]
    },
    {
        "id": "STRAT_03",
        "category": "Trading Strategy",
        "question": "What VOLATILITY HARVESTING strategies work? Selling vol premium is profitable but risky. How can we time entries, size positions, and manage tail risk?",
        "files": ["python/engine/features/domain_features.py", "python/engine/trading/risk_manager.py"]
    },
    {
        "id": "STRAT_04",
        "category": "Trading Strategy",
        "question": "How can we trade REGIME TRANSITIONS? The moment of regime change is most profitable. What entry timing, position structure, and exit rules work best?",
        "files": ["python/engine/features/change_point.py", "python/engine/features/duration.py"]
    },
    {
        "id": "STRAT_05",
        "category": "Trading Strategy",
        "question": "What CALENDAR SPREAD strategies exploit term structure? Rolling, diagonal spreads, time spread arbitrage - how can we systematically trade the term structure?",
        "files": ["python/engine/features/gamma_calc.py", "python/engine/features/domain_features.py"]
    },
    {
        "id": "STRAT_06",
        "category": "Trading Strategy",
        "question": "How can we trade the GAMMA FLIP level? When market crosses from positive to negative dealer gamma, dynamics change. What strategy captures this transition?",
        "files": ["python/engine/features/gamma_calc.py"]
    },
    {
        "id": "STRAT_07",
        "category": "Trading Strategy",
        "question": "What TAIL HEDGING strategies are cost-effective? How can we protect against black swans without bleeding theta? OTM puts, VIX calls, or dynamic hedging?",
        "files": ["python/engine/trading/risk_manager.py", "python/engine/features/correlation.py"]
    },
    {
        "id": "STRAT_08",
        "category": "Trading Strategy",
        "question": "How can we build a MEAN REVERSION strategy using market physics? When forces are extreme, mean reversion is mechanical. Design the entry/exit/sizing rules.",
        "files": ["python/engine/features/mm_inventory.py", "python/engine/features/dynamics.py"]
    },

    # === ARCHITECTURE ENHANCEMENT (6 agents) ===
    {
        "id": "ARCH_01",
        "category": "Architecture",
        "question": "How can we make the pipeline REAL-TIME capable? Currently batch processing. What architecture changes enable sub-second signal generation?",
        "files": ["python/engine/features/raw_features.py", "python/server.py"]
    },
    {
        "id": "ARCH_02",
        "category": "Architecture",
        "question": "How can we PARALLELIZE feature computation? 441 features across 16 symbols - what's the optimal parallel architecture for maximum throughput?",
        "files": ["python/scripts/main_harvest.py", "python/engine/features/raw_features.py"]
    },
    {
        "id": "ARCH_03",
        "category": "Architecture",
        "question": "What CACHING strategy would speed up backtesting? Feature caching, intermediate results, incremental computation - how do we avoid recomputing everything?",
        "files": ["python/engine/trading/simulator.py", "python/engine/discovery/swarm_engine.py"]
    },
    {
        "id": "ARCH_04",
        "category": "Architecture",
        "question": "How should we structure the LIVE TRADING pipeline? From signal generation to order execution - what's the optimal architecture for production trading?",
        "files": ["python/engine/trading/execution.py", "python/daemon.py"]
    },
    {
        "id": "ARCH_05",
        "category": "Architecture",
        "question": "How can we improve the EQUATION DISCOVERY pipeline? PySR finds equations but slowly. What preprocessing, feature engineering, or search strategies speed this up?",
        "files": ["python/engine/discovery/swarm_engine.py"]
    },
    {
        "id": "ARCH_06",
        "category": "Architecture",
        "question": "What MONITORING and ALERTING should we add? Signal degradation, regime changes, risk limits - what real-time monitoring ensures we catch problems early?",
        "files": ["python/daemon.py", "python/engine/trading/risk_manager.py"]
    },

    # === AI CAPABILITY BOOST (6 agents) ===
    {
        "id": "AI_01",
        "category": "AI Enhancement",
        "question": "How can the AI SYNTHESIS be smarter? Currently combines observer outputs. What reasoning patterns, chain-of-thought, or ensemble methods improve thesis quality?",
        "files": ["python/engine/ai_native/synthesis.py", "python/engine/ai_native/observers.py"]
    },
    {
        "id": "AI_02",
        "category": "AI Enhancement",
        "question": "What new OBSERVERS should we add? 23 observers exist. What market phenomena aren't being observed? News sentiment? Social media? Alternative data?",
        "files": ["python/engine/ai_native/observers.py"]
    },
    {
        "id": "AI_03",
        "category": "AI Enhancement",
        "question": "How can the ADVERSARIAL agent be more effective? It challenges theses but may be too weak. What attack vectors should it use to stress-test predictions?",
        "files": ["python/engine/ai_native/adversarial.py"]
    },
    {
        "id": "AI_04",
        "category": "AI Enhancement",
        "question": "How can the LEARNING agent improve faster? It refines equations from outcomes. What active learning, online updates, or feedback loops accelerate improvement?",
        "files": ["python/engine/ai_native/learning.py"]
    },
    {
        "id": "AI_05",
        "category": "AI Enhancement",
        "question": "How can we use LLMs for STRATEGY GENERATION? Can we prompt LLMs to hypothesize new trading strategies, then validate with backtests? What prompting works?",
        "files": ["python/engine/ai_native/synthesis.py"]
    },
    {
        "id": "AI_06",
        "category": "AI Enhancement",
        "question": "How can MULTI-AGENT debate improve predictions? Agents with different priors debating to consensus. What agent architectures produce better forecasts?",
        "files": ["python/engine/ai_native/adversarial.py", "python/engine/swarm/orchestrator.py"]
    },

    # === DATA UTILIZATION (6 agents) ===
    {
        "id": "DATA_01",
        "category": "Data Utilization",
        "question": "What UNTAPPED PATTERNS exist in the 394M options rows? We compute GEX and VPIN - what other patterns in this massive dataset could generate alpha?",
        "files": ["python/engine/features/gamma_calc.py", "python/engine/features/flow.py"]
    },
    {
        "id": "DATA_02",
        "category": "Data Utilization",
        "question": "How can we better use OPTIONS GREEKS history? Delta, gamma, vega, theta over time - what patterns in Greeks evolution predict future moves?",
        "files": ["python/engine/features/gamma_calc.py"]
    },
    {
        "id": "DATA_03",
        "category": "Data Utilization",
        "question": "What OPEN INTEREST patterns are predictive? OI changes by strike, expiry, put/call - what positioning changes forecast price direction?",
        "files": ["python/engine/features/flow.py", "python/engine/features/gamma_calc.py"]
    },
    {
        "id": "DATA_04",
        "category": "Data Utilization",
        "question": "How can we use IMPLIED VOLATILITY surface more effectively? IV by strike and expiry creates a surface - what surface dynamics predict vol moves?",
        "files": ["python/engine/features/morphology.py", "python/engine/features/domain_features.py"]
    },
    {
        "id": "DATA_05",
        "category": "Data Utilization",
        "question": "What ALTERNATIVE DATA could we integrate? FRED economic data, earnings calendars, Fed meetings - what external data improves regime prediction?",
        "files": ["python/engine/features/regime.py"]
    },
    {
        "id": "DATA_06",
        "category": "Data Utilization",
        "question": "How can we extract MORE from cross-symbol relationships? 16 ETFs covering equities, bonds, commodities, volatility - what intermarket signals matter?",
        "files": ["python/engine/features/correlation.py", "python/engine/features/sector_regime.py"]
    },

    # === RISK/SIZING OPTIMIZATION (4 agents) ===
    {
        "id": "RISK_01",
        "category": "Risk Management",
        "question": "How should we implement KELLY CRITERION for options? Kelly assumes known probabilities - how do we estimate win rate and payoff for optimal sizing?",
        "files": ["python/engine/trading/risk_manager.py"]
    },
    {
        "id": "RISK_02",
        "category": "Risk Management",
        "question": "What DYNAMIC POSITION SIZING works best? Scale with conviction? Scale with volatility? What position sizing maximizes risk-adjusted returns?",
        "files": ["python/engine/trading/risk_manager.py", "python/engine/trading/simulator.py"]
    },
    {
        "id": "RISK_03",
        "category": "Risk Management",
        "question": "How should we manage PORTFOLIO GREEKS? Net delta, gamma, vega, theta across all positions - what targets and rebalancing rules work best?",
        "files": ["python/engine/trading/risk_manager.py", "python/engine/features/gamma_calc.py"]
    },
    {
        "id": "RISK_04",
        "category": "Risk Management",
        "question": "What DRAWDOWN CONTROLS should we implement? Max drawdown limits, volatility scaling, regime-based exposure - how do we survive tail events?",
        "files": ["python/engine/trading/risk_manager.py"]
    },

    # === COMPETITIVE EDGE ANALYSIS (2 agents) ===
    {
        "id": "EDGE_01",
        "category": "Competitive Edge",
        "question": "What UNIQUE EDGE does this system have vs quant funds? They have more data, faster execution, more capital. Where can we win? Niche strategies? Longer horizons?",
        "files": ["python/engine/ai_native/force_aggregator.py"]
    },
    {
        "id": "EDGE_02",
        "category": "Competitive Edge",
        "question": "What would make this system WORLD-CLASS? Compare to Renaissance, Two Sigma, Citadel. What capabilities would put us in their league? What's the gap?",
        "files": ["python/engine/discovery/swarm_engine.py", "python/engine/ai_native/pipeline.py"]
    },
]

def run_single_agent(question_data: dict) -> dict:
    """Run a single improvement agent"""
    q_id = question_data["id"]
    category = question_data["category"]
    question = question_data["question"]
    files = question_data.get("files", [])

    # Build context with file paths
    file_context = "\n".join([f"- {f}" for f in files])

    full_task = f"""## Improvement Analysis: {q_id}
Category: {category}

## Question
{question}

## Relevant Files
{file_context}

## Instructions
1. Read the relevant files to understand current implementation
2. Think deeply about the question from a MONEY-MAKING perspective
3. Provide SPECIFIC, ACTIONABLE improvements
4. Include concrete implementation suggestions
5. Estimate potential impact (high/medium/low)

{PROJECT_CONTEXT}

## Output Format
### Summary (1-2 sentences)
### Key Improvements (bullet points with specifics)
### Implementation Suggestions (code patterns or architecture)
### Estimated Impact (high/medium/low with reasoning)
"""

    print(f"[Swarm] Starting {q_id}: {category}", file=sys.stderr)

    try:
        result = run_agent(full_task, agent_type='researcher', model='deepseek-chat')
        return {
            "id": q_id,
            "category": category,
            "question": question,
            "result": result,
            "status": "success"
        }
    except Exception as e:
        return {
            "id": q_id,
            "category": category,
            "question": question,
            "result": str(e),
            "status": "error"
        }

def run_improvement_swarm(max_workers: int = 10):
    """Run all 50 improvement agents in parallel"""

    print(f"\n{'='*60}")
    print(f"QUANT-ENGINE IMPROVEMENT SWARM")
    print(f"Launching {len(IMPROVEMENT_QUESTIONS)} agents")
    print(f"Max parallel workers: {max_workers}")
    print(f"{'='*60}\n")

    start_time = datetime.now()
    results = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_question = {
            executor.submit(run_single_agent, q): q
            for q in IMPROVEMENT_QUESTIONS
        }

        for future in concurrent.futures.as_completed(future_to_question):
            question = future_to_question[future]
            try:
                result = future.result()
                results.append(result)
                status = "✓" if result["status"] == "success" else "✗"
                print(f"[{status}] {result['id']}: {result['category']}", file=sys.stderr)
            except Exception as e:
                print(f"[✗] {question['id']}: Exception - {e}", file=sys.stderr)
                results.append({
                    "id": question["id"],
                    "category": question["category"],
                    "question": question["question"],
                    "result": str(e),
                    "status": "error"
                })

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()

    # Save results
    output_dir = Path(__file__).parent / "reports"
    output_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = output_dir / f"improvement_swarm_{timestamp}.json"

    report = {
        "timestamp": timestamp,
        "duration_seconds": duration,
        "total_agents": len(IMPROVEMENT_QUESTIONS),
        "successful": sum(1 for r in results if r["status"] == "success"),
        "failed": sum(1 for r in results if r["status"] == "error"),
        "results": results
    }

    with open(output_file, 'w') as f:
        json.dump(report, f, indent=2)

    print(f"\n{'='*60}")
    print(f"SWARM COMPLETE")
    print(f"Duration: {duration:.1f} seconds")
    print(f"Success: {report['successful']}/{report['total_agents']}")
    print(f"Results: {output_file}")
    print(f"{'='*60}\n")

    # Print summary by category
    print("\n## Results by Category\n")
    categories = {}
    for r in results:
        cat = r["category"]
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(r)

    for cat, items in sorted(categories.items()):
        print(f"### {cat} ({len(items)} agents)")
        for item in items:
            status = "✓" if item["status"] == "success" else "✗"
            print(f"  {status} {item['id']}")
        print()

    return report

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run 50-agent improvement swarm")
    parser.add_argument("--workers", type=int, default=10,
                       help="Max parallel workers (default: 10)")
    parser.add_argument("--single", type=str, default=None,
                       help="Run single agent by ID (e.g., ALPHA_01)")

    args = parser.parse_args()

    if args.single:
        # Run single agent for testing
        question = next((q for q in IMPROVEMENT_QUESTIONS if q["id"] == args.single), None)
        if question:
            result = run_single_agent(question)
            print(json.dumps(result, indent=2))
        else:
            print(f"Unknown agent ID: {args.single}")
            print(f"Available: {[q['id'] for q in IMPROVEMENT_QUESTIONS]}")
    else:
        # Run full swarm
        run_improvement_swarm(max_workers=args.workers)
