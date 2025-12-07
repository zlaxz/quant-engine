#!/usr/bin/env python3
"""
100-Agent DeepSeek Swarm: Parallel Alpha Discovery
75 deepseek-chat (fast execution) + 25 deepseek-reasoner (deep analysis)

PURPOSE: Discover how massive parallel AI swarms can generate financial returns
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

PROJECT_ROOT = "/Users/zstoc/GitHub/quant-engine"
DATA_ROOT = "/Volumes/VelocityData/velocity_om/massive"

# Project context - focused on SWARM potential
SWARM_CONTEXT = """
## Quant-Engine: Market Physics Engine

### CRITICAL CONTEXT: The DeepSeek Cost Advantage
- DeepSeek API: $1.68/M tokens (vs $15/M for Sonnet, $75/M for Opus)
- 100 parallel agents = ~$5-10 total cost
- This changes EVERYTHING about what's computationally feasible

### The Question: How can massive parallel AI swarms generate alpha?

### System Architecture (9 Layers):
- Layer 0: Raw Data (394M options rows, 13M stock rows)
- Layer 1: Morphology (skewness, kurtosis, Dip Test)
- Layer 2: Dynamics (dγ/dt, entropy decay)
- Layer 3: Forces (gamma, VPIN, Kyle's λ, MM inventory)
- Layer 4: Causal Inference
- Layer 5: Equation Discovery (PySR)
- Layer 6: Regime Prediction (HMM, CUSUM, BOCPD)
- Layer 7: AI Reasoning (observers, synthesis)
- Layer 8: Convexity Expression
- Layer 9: Learning

### Current Swarm Types:
1. ScoutSwarm: Genetic algorithm feature selection
2. MathSwarm: PySR equation discovery
3. JurySwarm: Ensemble regime classification

### 16 Liquid ETFs Available:
SPY, QQQ, IWM, DIA, GLD, SLV, TLT, IEF, HYG, XLF, XLE, XLK, XLV, USO, FXI, EEM

### Key Question: What becomes possible with 100-1000 parallel AI agents that's impossible with a single agent?
"""

# 100 SWARM OPPORTUNITY QUESTIONS
# Format: (id, category, model, question)
# model: 'chat' for deepseek-chat, 'reasoner' for deepseek-reasoner

SWARM_QUESTIONS = [
    # === PARALLEL ALPHA HUNTING (20 questions - 15 chat, 5 reasoner) ===
    ("ALPHA_01", "Parallel Alpha Hunting", "chat",
     "Design a swarm where 16 agents each analyze a different ETF (SPY, QQQ, etc.) in parallel. What cross-asset signals emerge when 16 specialists report simultaneously? What patterns would a single agent miss?"),
    ("ALPHA_02", "Parallel Alpha Hunting", "chat",
     "Design a 'time-slice swarm' where 10 agents each analyze a different 2-year window of the 20-year data history. What regime patterns emerge across time that a single sequential analysis would miss?"),
    ("ALPHA_03", "Parallel Alpha Hunting", "chat",
     "Create a 'feature tournament' swarm: 50 agents each champion a different feature subset. They compete to predict next-day returns. How do we aggregate their predictions for alpha?"),
    ("ALPHA_04", "Parallel Alpha Hunting", "chat",
     "Design an 'anomaly swarm': 20 agents each monitor for different types of anomalies (volume spikes, gamma imbalances, correlation breaks). How do we aggregate their alerts into tradeable signals?"),
    ("ALPHA_05", "Parallel Alpha Hunting", "chat",
     "Create a 'hypothesis swarm': 30 agents each test a different trading hypothesis (momentum, mean reversion, breakout, fade). What statistical framework combines their findings?"),
    ("ALPHA_06", "Parallel Alpha Hunting", "chat",
     "Design a 'strike-expiry matrix swarm': agents analyze different regions of the options surface in parallel. What vol surface dynamics become visible with parallel analysis?"),
    ("ALPHA_07", "Parallel Alpha Hunting", "chat",
     "Create an 'event swarm': agents monitor different market events (FOMC, earnings, OpEx) in parallel. How can parallel event analysis predict post-event moves?"),
    ("ALPHA_08", "Parallel Alpha Hunting", "chat",
     "Design a 'Greeks swarm': separate agents track delta, gamma, vanna, charm flows. What mechanical trading opportunities emerge from combined Greeks analysis?"),
    ("ALPHA_09", "Parallel Alpha Hunting", "chat",
     "Create a 'correlation breakdown swarm': agents monitor every pair of the 16 ETFs for correlation regime changes. What pairs breaking down signal broader regime shifts?"),
    ("ALPHA_10", "Parallel Alpha Hunting", "chat",
     "Design a 'volatility surface swarm': agents track skew, butterfly, term structure in parallel. What vol surface shape changes predict directional moves?"),
    ("ALPHA_11", "Parallel Alpha Hunting", "chat",
     "Create a 'flow classification swarm': agents classify trade flow as institutional/retail, hedging/speculative, etc. What flow type combinations predict price direction?"),
    ("ALPHA_12", "Parallel Alpha Hunting", "chat",
     "Design a 'microstructure swarm': agents analyze bid-ask spreads, depth, order imbalances across all 16 ETFs. What microstructure signals lead price moves?"),
    ("ALPHA_13", "Parallel Alpha Hunting", "chat",
     "Create an 'entropy swarm': agents compute entropy, transfer entropy, KL divergence across assets. What information flow patterns predict regime changes?"),
    ("ALPHA_14", "Parallel Alpha Hunting", "chat",
     "Design a 'dealer positioning swarm': agents estimate dealer gamma/vanna/charm across strikes. Where are dealers most concentrated? What happens when they must hedge?"),
    ("ALPHA_15", "Parallel Alpha Hunting", "chat",
     "Create a 'max pain swarm': agents track max pain levels across all ETFs/expirations. How often does price gravitate to max pain? Is this tradeable?"),
    ("ALPHA_16", "Parallel Alpha Hunting", "reasoner",
     "DEEP ANALYSIS: What's the theoretical maximum information gain from 100 parallel agents vs 1 sequential agent analyzing the same 394M options rows? Derive the math."),
    ("ALPHA_17", "Parallel Alpha Hunting", "reasoner",
     "DEEP ANALYSIS: Design an optimal 'division of labor' for 100 agents. What's the information-theoretic best way to partition the analysis space?"),
    ("ALPHA_18", "Parallel Alpha Hunting", "reasoner",
     "DEEP ANALYSIS: How can we use swarm consensus to filter false positives? What voting/aggregation schemes reduce noise while preserving signal?"),
    ("ALPHA_19", "Parallel Alpha Hunting", "reasoner",
     "DEEP ANALYSIS: What's the relationship between agent specialization and prediction accuracy? Should agents be specialists or generalists?"),
    ("ALPHA_20", "Parallel Alpha Hunting", "reasoner",
     "DEEP ANALYSIS: Derive the Kelly criterion for a swarm trading system. How do we optimally size positions when signals come from multiple competing agents?"),

    # === STRATEGY DISCOVERY AT SCALE (15 questions - 12 chat, 3 reasoner) ===
    ("STRAT_01", "Strategy Discovery", "chat",
     "Design a 'strategy generation swarm': 50 agents each propose a different options strategy. How do we backtest and rank 50 strategies efficiently?"),
    ("STRAT_02", "Strategy Discovery", "chat",
     "Create a 'parameter optimization swarm': 20 agents each test different parameter sets for a base strategy. How do we avoid overfitting with parallel search?"),
    ("STRAT_03", "Strategy Discovery", "chat",
     "Design a 'regime-strategy mapping swarm': agents find the best strategy for each of the HMM regimes. What's the optimal strategy switch logic?"),
    ("STRAT_04", "Strategy Discovery", "chat",
     "Create a 'strategy mutation swarm': take a working strategy, have 20 agents propose variations. How do we identify improvements vs noise?"),
    ("STRAT_05", "Strategy Discovery", "chat",
     "Design a 'cross-regime strategy swarm': agents design strategies that work across ALL regimes vs specialists. What's the tradeoff?"),
    ("STRAT_06", "Strategy Discovery", "chat",
     "Create a 'options structure swarm': for each market condition, agents propose different options structures (straddles, strangles, spreads, etc.)"),
    ("STRAT_07", "Strategy Discovery", "chat",
     "Design a 'entry timing swarm': given a directional signal, agents explore different entry timing strategies. What timing rules improve Sharpe?"),
    ("STRAT_08", "Strategy Discovery", "chat",
     "Create an 'exit strategy swarm': agents propose different exit rules (trailing stops, time-based, vol-based). What exit rules preserve profits?"),
    ("STRAT_09", "Strategy Discovery", "chat",
     "Design a 'hedge ratio swarm': agents explore different delta hedging frequencies and thresholds. What's the optimal hedge rebalancing?"),
    ("STRAT_10", "Strategy Discovery", "chat",
     "Create a 'roll strategy swarm': agents propose different roll rules for options positions. What roll timing preserves theta?"),
    ("STRAT_11", "Strategy Discovery", "chat",
     "Design a 'vol regime strategy swarm': agents create strategies for low-vol, normal-vol, high-vol regimes. How do we transition between?"),
    ("STRAT_12", "Strategy Discovery", "chat",
     "Create a 'gamma scalping swarm': agents propose different gamma scalping rules. What scalping frequency maximizes gamma profits?"),
    ("STRAT_13", "Strategy Discovery", "reasoner",
     "DEEP ANALYSIS: What's the optimal 'strategy search algorithm' for a swarm? Compare genetic algorithms, gradient-free optimization, Bayesian optimization."),
    ("STRAT_14", "Strategy Discovery", "reasoner",
     "DEEP ANALYSIS: How do we prevent 'strategy overfitting' with parallel search? What validation schemes work for swarm-discovered strategies?"),
    ("STRAT_15", "Strategy Discovery", "reasoner",
     "DEEP ANALYSIS: Design a 'strategy ensemble' that combines multiple swarm-discovered strategies. What portfolio construction maximizes Sharpe?"),

    # === CROSS-ASSET SIGNAL MINING (15 questions - 12 chat, 3 reasoner) ===
    ("CROSS_01", "Cross-Asset Signals", "chat",
     "Each agent monitors one ETF for leading signals to SPY. Which asset leads SPY most reliably? TLT? GLD? FXI?"),
    ("CROSS_02", "Cross-Asset Signals", "chat",
     "Design a 'sector rotation swarm': agents track relative strength of XLF, XLE, XLK, XLV. What rotation signals predict market direction?"),
    ("CROSS_03", "Cross-Asset Signals", "chat",
     "Create a 'safe haven swarm': agents monitor GLD, TLT when SPY weakens. What safe haven flows predict continued weakness vs reversal?"),
    ("CROSS_04", "Cross-Asset Signals", "chat",
     "Design a 'risk-on/risk-off swarm': agents track HYG, IWM, QQQ for risk appetite. What divergences signal regime changes?"),
    ("CROSS_05", "Cross-Asset Signals", "chat",
     "Create a 'commodity swarm': agents monitor USO, GLD, SLV for inflation/deflation signals. What commodity patterns predict equity moves?"),
    ("CROSS_06", "Cross-Asset Signals", "chat",
     "Design a 'EM contagion swarm': agents monitor FXI, EEM for emerging market stress. When does EM weakness spread to US?"),
    ("CROSS_07", "Cross-Asset Signals", "chat",
     "Create a 'bond-equity correlation swarm': agents track TLT-SPY, IEF-SPY correlations. What correlation regime changes are tradeable?"),
    ("CROSS_08", "Cross-Asset Signals", "chat",
     "Design a 'volatility term structure swarm': agents track vol term structures across all ETFs. What term structure inversions predict crashes?"),
    ("CROSS_09", "Cross-Asset Signals", "chat",
     "Create a 'cross-asset momentum swarm': agents compute momentum for each ETF and find which momenta predict others."),
    ("CROSS_10", "Cross-Asset Signals", "chat",
     "Design a 'relative value swarm': agents track relative valuations (P/E proxies via options) across sectors. What relative value signals work?"),
    ("CROSS_11", "Cross-Asset Signals", "chat",
     "Create a 'dispersion swarm': agents track correlation dispersion across ETFs. What dispersion levels predict vol regime changes?"),
    ("CROSS_12", "Cross-Asset Signals", "chat",
     "Design a 'macro factor swarm': agents extract PCA factors from all 16 ETFs. What factor moves predict market direction?"),
    ("CROSS_13", "Cross-Asset Signals", "reasoner",
     "DEEP ANALYSIS: What's the optimal cross-asset signal aggregation method? MLP, ensemble, attention mechanism? Derive the math."),
    ("CROSS_14", "Cross-Asset Signals", "reasoner",
     "DEEP ANALYSIS: How do cross-asset correlations break down during crashes? What 'correlation regime' detection catches this early?"),
    ("CROSS_15", "Cross-Asset Signals", "reasoner",
     "DEEP ANALYSIS: Design a 'Granger causality network' from 16 ETFs using transfer entropy. What causal structure is most stable?"),

    # === REAL-TIME MARKET STATE (10 questions - 8 chat, 2 reasoner) ===
    ("REAL_01", "Real-Time State", "chat",
     "Design a 'market pulse swarm': each agent monitors one dimension of market state (volatility, correlation, flow, gamma). How do we synthesize into one 'pulse'?"),
    ("REAL_02", "Real-Time State", "chat",
     "Create a 'regime probability swarm': agents compute regime probabilities using different methods. How do we aggregate into consensus regime?"),
    ("REAL_03", "Real-Time State", "chat",
     "Design a 'stress indicator swarm': agents monitor different stress indicators (VIX, credit spreads, correlation). What composite stress index works?"),
    ("REAL_04", "Real-Time State", "chat",
     "Create a 'positioning swarm': agents estimate positioning from gamma, flow, OI. What positioning extreme signals reversals?"),
    ("REAL_05", "Real-Time State", "chat",
     "Design a 'liquidity swarm': agents monitor liquidity across all ETFs. What liquidity warnings predict vol spikes?"),
    ("REAL_06", "Real-Time State", "chat",
     "Create a 'momentum swarm': agents track momentum across timeframes (1d, 5d, 20d, 60d). What momentum divergences are tradeable?"),
    ("REAL_07", "Real-Time State", "chat",
     "Design a 'change point swarm': agents run CUSUM, BOCPD, PELT on different features. What consensus change point detection works?"),
    ("REAL_08", "Real-Time State", "chat",
     "Create a 'force equilibrium swarm': agents measure different market forces. When forces are in equilibrium vs imbalanced, what trades work?"),
    ("REAL_09", "Real-Time State", "reasoner",
     "DEEP ANALYSIS: Design an optimal 'market state vector' that captures all relevant information. What dimensionality reduction preserves signal?"),
    ("REAL_10", "Real-Time State", "reasoner",
     "DEEP ANALYSIS: How can swarms detect regime changes faster than single-agent HMM? What parallel detection architecture minimizes lag?"),

    # === MULTI-TIMEFRAME ANALYSIS (10 questions - 8 chat, 2 reasoner) ===
    ("TIME_01", "Multi-Timeframe", "chat",
     "Design a 'timeframe swarm': agents analyze 1-min, 5-min, 15-min, hourly, daily. What timeframe alignment signals strong moves?"),
    ("TIME_02", "Multi-Timeframe", "chat",
     "Create a 'fractal swarm': agents look for self-similar patterns across timeframes. What fractals have predictive power?"),
    ("TIME_03", "Multi-Timeframe", "chat",
     "Design a 'trend-mean reversion swarm': agents identify trend on long timeframe, mean reversion on short. What combination works?"),
    ("TIME_04", "Multi-Timeframe", "chat",
     "Create a 'seasonality swarm': agents analyze day-of-week, month-of-year, OpEx week patterns. What seasonalities survive costs?"),
    ("TIME_05", "Multi-Timeframe", "chat",
     "Design a 'regime duration swarm': agents model how long regimes last at different timeframes. What duration models predict regime end?"),
    ("TIME_06", "Multi-Timeframe", "chat",
     "Create a 'volatility term swarm': agents analyze vol at different horizons. What term structure patterns predict vol moves?"),
    ("TIME_07", "Multi-Timeframe", "chat",
     "Design a 'signal decay swarm': agents measure how quickly signals decay across timeframes. What signal decay profiles are most profitable?"),
    ("TIME_08", "Multi-Timeframe", "chat",
     "Create a 'holding period swarm': agents test different holding periods for each strategy. What optimal holding periods emerge?"),
    ("TIME_09", "Multi-Timeframe", "reasoner",
     "DEEP ANALYSIS: What's the information content of different timeframes? Is 1-minute data worth the noise vs daily?"),
    ("TIME_10", "Multi-Timeframe", "reasoner",
     "DEEP ANALYSIS: Design a 'timeframe attention mechanism' that learns which timeframes matter for each regime."),

    # === OPTIONS STRUCTURE DISCOVERY (10 questions - 8 chat, 2 reasoner) ===
    ("OPT_01", "Options Structure", "chat",
     "Design a 'structure search swarm': agents propose different options structures for each regime. What structures maximize risk-adjusted returns?"),
    ("OPT_02", "Options Structure", "chat",
     "Create a 'strike selection swarm': agents analyze which strikes have best risk/reward for each vol regime."),
    ("OPT_03", "Options Structure", "chat",
     "Design a 'expiry selection swarm': agents compare different DTE ranges. What expiry provides best theta/gamma tradeoff?"),
    ("OPT_04", "Options Structure", "chat",
     "Create a 'spread construction swarm': agents optimize spread widths, ratios, and combinations. What spread parameters work?"),
    ("OPT_05", "Options Structure", "chat",
     "Design a 'vol surface arbitrage swarm': agents hunt for mispriced options across the surface. What mispricing is tradeable?"),
    ("OPT_06", "Options Structure", "chat",
     "Create a 'Greeks target swarm': agents design structures to achieve specific Greeks exposures. What Greeks profiles maximize returns?"),
    ("OPT_07", "Options Structure", "chat",
     "Design a 'calendar/diagonal swarm': agents optimize calendar and diagonal spreads for vol term structure. What structures harvest term premium?"),
    ("OPT_08", "Options Structure", "chat",
     "Create a 'risk reversal swarm': agents analyze when risk reversals (skew trades) are profitable. What skew levels trigger trades?"),
    ("OPT_09", "Options Structure", "reasoner",
     "DEEP ANALYSIS: Derive the optimal options structure for each of the 4 HMM regimes. What's the mathematical basis for structure selection?"),
    ("OPT_10", "Options Structure", "reasoner",
     "DEEP ANALYSIS: Design a 'dynamic structure adjustment' algorithm that morphs positions as regimes change. What adjustment rules preserve capital?"),

    # === RISK/SIZING OPTIMIZATION (5 questions - 4 chat, 1 reasoner) ===
    ("RISK_01", "Risk Optimization", "chat",
     "Design a 'Kelly swarm': agents estimate win rates and payoffs for each strategy. What Kelly fraction is optimal given uncertainty?"),
    ("RISK_02", "Risk Optimization", "chat",
     "Create a 'correlation-aware sizing swarm': agents measure strategy correlations. What portfolio construction minimizes concentration?"),
    ("RISK_03", "Risk Optimization", "chat",
     "Design a 'drawdown control swarm': agents propose different drawdown control rules. What rules minimize drawdowns without killing returns?"),
    ("RISK_04", "Risk Optimization", "chat",
     "Create a 'vol scaling swarm': agents test different vol-scaling rules. What scaling preserves returns while controlling risk?"),
    ("RISK_05", "Risk Optimization", "reasoner",
     "DEEP ANALYSIS: Derive the optimal position sizing for a swarm system with uncertain signal quality. What's the math?"),

    # === SELF-HEALING/ADAPTATION (5 questions - 4 chat, 1 reasoner) ===
    ("ADAPT_01", "Self-Adaptation", "chat",
     "Design a 'strategy health swarm': agents monitor each active strategy's performance. What metrics detect degradation early?"),
    ("ADAPT_02", "Self-Adaptation", "chat",
     "Create a 'strategy rotation swarm': agents propose strategy rotation rules. When should we switch strategies?"),
    ("ADAPT_03", "Self-Adaptation", "chat",
     "Design a 'hyperparameter adaptation swarm': agents propose parameter updates as markets change. What update rules don't overfit?"),
    ("ADAPT_04", "Self-Adaptation", "chat",
     "Create a 'agent performance swarm': agents rate each other's predictions. What peer review improves accuracy?"),
    ("ADAPT_05", "Self-Adaptation", "reasoner",
     "DEEP ANALYSIS: Design a 'meta-learning swarm' that learns how to learn. What meta-parameters control adaptation speed?"),

    # === COMPUTATIONAL ARCHITECTURE (5 questions - 4 chat, 1 reasoner) ===
    ("COMP_01", "Computational", "chat",
     "Design optimal 'agent parallelization': how many agents can run simultaneously without rate limits? What batch sizes work?"),
    ("COMP_02", "Computational", "chat",
     "Create an 'agent communication protocol': how do agents share findings? What pub-sub architecture enables collaboration?"),
    ("COMP_03", "Computational", "chat",
     "Design a 'swarm memory system': agents need shared memory for collaboration. What data structures enable fast coordination?"),
    ("COMP_04", "Computational", "chat",
     "Create an 'agent spawn/kill protocol': when do we create new specialists? When do we kill underperformers?"),
    ("COMP_05", "Computational", "reasoner",
     "DEEP ANALYSIS: What's the optimal swarm size? Derive the relationship between agent count, cost, and marginal information gain."),

    # === MARKET PHYSICS EXPANSION (5 questions - all reasoner for deep thinking) ===
    ("PHYS_01", "Market Physics", "reasoner",
     "DEEP ANALYSIS: Design a swarm that discovers NEW market forces. What mathematical framework lets agents propose and validate new force types?"),
    ("PHYS_02", "Market Physics", "reasoner",
     "DEEP ANALYSIS: How can swarms discover the 'field equations' of markets - the fundamental PDEs governing price dynamics?"),
    ("PHYS_03", "Market Physics", "reasoner",
     "DEEP ANALYSIS: Design a 'causality swarm' that maps the causal structure of markets. What causal discovery algorithm works with parallel agents?"),
    ("PHYS_04", "Market Physics", "reasoner",
     "DEEP ANALYSIS: How can swarms find the 'critical exponents' of market phase transitions? What scaling laws govern regime changes?"),
    ("PHYS_05", "Market Physics", "reasoner",
     "DEEP ANALYSIS: Design a swarm that searches for 'market conservation laws' - quantities that are conserved during price dynamics."),
]

# Verify counts
chat_count = sum(1 for q in SWARM_QUESTIONS if q[2] == 'chat')
reasoner_count = sum(1 for q in SWARM_QUESTIONS if q[2] == 'reasoner')
print(f"Total questions: {len(SWARM_QUESTIONS)}")
print(f"Chat agents: {chat_count}")
print(f"Reasoner agents: {reasoner_count}")

def run_single_agent(question_data: tuple) -> dict:
    """Run a single swarm agent"""
    q_id, category, model_type, question = question_data

    model = 'deepseek-chat' if model_type == 'chat' else 'deepseek-reasoner'

    full_task = f"""## Swarm Opportunity Analysis: {q_id}
Category: {category}
Model: {model}

## Your Mission
{question}

{SWARM_CONTEXT}

## Output Format
### Summary (2-3 sentences)
### Specific Opportunity (what exactly becomes possible with parallel agents)
### Implementation Design (concrete agent architecture)
### Expected Alpha (what returns could this generate)
### Critical Risks (what could go wrong)
### Files to Read (list any files you need to analyze)
"""

    print(f"[Swarm] Starting {q_id}: {category} ({model})", file=sys.stderr)

    try:
        result = run_agent(full_task, agent_type='researcher', model=model)
        return {
            "id": q_id,
            "category": category,
            "model": model,
            "question": question,
            "result": result,
            "status": "success"
        }
    except Exception as e:
        return {
            "id": q_id,
            "category": category,
            "model": model,
            "question": question,
            "result": str(e),
            "status": "error"
        }


def run_swarm_100(max_workers: int = 25, subset: str = None):
    """Run the 100-agent swarm

    Args:
        max_workers: Parallel worker count (25 is safe for rate limits)
        subset: Optional subset - 'chat', 'reasoner', or category prefix
    """

    questions = SWARM_QUESTIONS

    # Filter if subset specified
    if subset:
        if subset == 'chat':
            questions = [q for q in SWARM_QUESTIONS if q[2] == 'chat']
        elif subset == 'reasoner':
            questions = [q for q in SWARM_QUESTIONS if q[2] == 'reasoner']
        else:
            questions = [q for q in SWARM_QUESTIONS if q[0].startswith(subset.upper())]

    print(f"\n{'='*60}")
    print(f"100-AGENT PARALLEL ALPHA DISCOVERY SWARM")
    print(f"Launching {len(questions)} agents")
    print(f"  - deepseek-chat: {sum(1 for q in questions if q[2] == 'chat')}")
    print(f"  - deepseek-reasoner: {sum(1 for q in questions if q[2] == 'reasoner')}")
    print(f"Max parallel workers: {max_workers}")
    print(f"Estimated cost: ~${len(questions) * 0.05:.2f}")
    print(f"{'='*60}\n")

    start_time = datetime.now()
    results = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_question = {
            executor.submit(run_single_agent, q): q
            for q in questions
        }

        completed = 0
        for future in concurrent.futures.as_completed(future_to_question):
            question = future_to_question[future]
            completed += 1
            try:
                result = future.result()
                results.append(result)
                status = "OK" if result["status"] == "success" else "ERR"
                print(f"[{completed}/{len(questions)}] [{status}] {result['id']}: {result['category']}", file=sys.stderr)
            except Exception as e:
                print(f"[{completed}/{len(questions)}] [EXC] {question[0]}: {e}", file=sys.stderr)
                results.append({
                    "id": question[0],
                    "category": question[1],
                    "model": question[2],
                    "question": question[3],
                    "result": str(e),
                    "status": "error"
                })

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()

    # Save results
    output_dir = Path(__file__).parent / "reports"
    output_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = output_dir / f"swarm_100_alpha_{timestamp}.json"

    report = {
        "timestamp": timestamp,
        "duration_seconds": duration,
        "total_agents": len(questions),
        "chat_agents": sum(1 for r in results if r["model"] == "deepseek-chat"),
        "reasoner_agents": sum(1 for r in results if r["model"] == "deepseek-reasoner"),
        "successful": sum(1 for r in results if r["status"] == "success"),
        "failed": sum(1 for r in results if r["status"] == "error"),
        "results": results
    }

    with open(output_file, 'w') as f:
        json.dump(report, f, indent=2)

    print(f"\n{'='*60}")
    print(f"SWARM COMPLETE")
    print(f"Duration: {duration:.1f} seconds ({duration/60:.1f} minutes)")
    print(f"Success: {report['successful']}/{report['total_agents']}")
    print(f"Results: {output_file}")
    print(f"{'='*60}\n")

    # Print summary by category
    print("\n## Results by Category\n")
    categories = {}
    for r in results:
        cat = r["category"]
        if cat not in categories:
            categories[cat] = {"success": 0, "error": 0, "items": []}
        if r["status"] == "success":
            categories[cat]["success"] += 1
        else:
            categories[cat]["error"] += 1
        categories[cat]["items"].append(r)

    for cat, data in sorted(categories.items()):
        print(f"### {cat} ({data['success']}/{data['success'] + data['error']} success)")

    return report


def generate_summary_report(report: dict) -> str:
    """Generate a human-readable summary of findings"""
    output = []
    output.append("=" * 80)
    output.append("100-AGENT PARALLEL ALPHA DISCOVERY - EXECUTIVE SUMMARY")
    output.append(f"Generated: {report['timestamp']}")
    output.append("=" * 80)
    output.append("")

    # Stats
    output.append(f"## Statistics")
    output.append(f"- Total Agents: {report['total_agents']}")
    output.append(f"- Success Rate: {report['successful']}/{report['total_agents']}")
    output.append(f"- Duration: {report['duration_seconds']/60:.1f} minutes")
    output.append(f"- Estimated Cost: ${report['total_agents'] * 0.05:.2f}")
    output.append("")

    # Group by category and extract key findings
    categories = {}
    for r in report['results']:
        cat = r['category']
        if cat not in categories:
            categories[cat] = []
        if r['status'] == 'success':
            categories[cat].append(r)

    for cat, items in sorted(categories.items()):
        output.append(f"## {cat} ({len(items)} agents)")
        output.append("")
        for item in items[:3]:  # Top 3 per category
            output.append(f"### {item['id']}")
            # Extract first 500 chars of result
            result_preview = item['result'][:500] if len(item['result']) > 500 else item['result']
            output.append(result_preview)
            output.append("")
        output.append("---")
        output.append("")

    return '\n'.join(output)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run 100-agent parallel alpha discovery swarm")
    parser.add_argument("--workers", type=int, default=25,
                       help="Max parallel workers (default: 25)")
    parser.add_argument("--subset", type=str, default=None,
                       help="Run subset: 'chat', 'reasoner', or category prefix (e.g., 'ALPHA', 'STRAT')")
    parser.add_argument("--single", type=str, default=None,
                       help="Run single agent by ID (e.g., ALPHA_01)")
    parser.add_argument("--dry-run", action="store_true",
                       help="Print questions without running")

    args = parser.parse_args()

    if args.dry_run:
        print(f"\n100-Agent Swarm Questions (dry run)\n")
        for q in SWARM_QUESTIONS:
            print(f"[{q[0]}] ({q[2]}) {q[1]}")
            print(f"    {q[3][:80]}...")
            print()
    elif args.single:
        # Run single agent for testing
        question = next((q for q in SWARM_QUESTIONS if q[0] == args.single), None)
        if question:
            result = run_single_agent(question)
            print(json.dumps(result, indent=2))
        else:
            print(f"Unknown agent ID: {args.single}")
            print(f"Available: {[q[0] for q in SWARM_QUESTIONS]}")
    else:
        # Run full swarm
        report = run_swarm_100(max_workers=args.workers, subset=args.subset)

        # Generate and save summary
        summary = generate_summary_report(report)
        summary_path = Path(__file__).parent / "reports" / f"swarm_100_summary_{report['timestamp']}.md"
        with open(summary_path, 'w') as f:
            f.write(summary)
        print(f"\nSummary saved: {summary_path}")
