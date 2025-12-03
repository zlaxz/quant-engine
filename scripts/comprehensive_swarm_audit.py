#!/usr/bin/env python3
"""
Comprehensive 50-Agent Swarm Audit
Analyzes quant-engine from every angle to identify improvements

Usage:
    export DEEPSEEK_API_KEY="sk-..."
    python scripts/comprehensive_swarm_audit.py
"""

import os
import sys
import json
import subprocess
import concurrent.futures
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
RESULTS_DIR = PROJECT_ROOT / ".claude" / "swarm-audit-results"
DEEPSEEK_API_KEY = os.environ.get('DEEPSEEK_API_KEY')

# Import the agent runner
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
from deepseek_agent import run_agent

# ============================================================================
# 50 AGENT DEFINITIONS - Organized by Domain
# ============================================================================

AGENTS = [
    # -------------------------------------------------------------------------
    # CODE QUALITY (10 agents)
    # -------------------------------------------------------------------------
    {
        "id": "cq-01-typescript-safety",
        "type": "reviewer",
        "model": "deepseek-chat",
        "domain": "code-quality",
        "task": """Review TypeScript type safety in the quant-engine project.

Focus on:
1. Files in src/electron/ - check for 'any' types, missing generics
2. Files in src/types/ - are type definitions complete?
3. IPC handler type safety between main/renderer
4. Look for runtime type errors waiting to happen

Start by reading src/types/electron.d.ts and then examining key handlers.
Report: List of type safety issues with file:line references and fixes."""
    },
    {
        "id": "cq-02-react-patterns",
        "type": "reviewer",
        "model": "deepseek-chat",
        "domain": "code-quality",
        "task": """Review React component patterns in src/components/.

Focus on:
1. Unnecessary re-renders (missing memo, useMemo, useCallback)
2. State management anti-patterns
3. Effect dependencies issues
4. Component composition problems
5. Error boundary coverage

List directory src/components/ first, then examine key components.
Report: Specific issues with code references and recommended fixes."""
    },
    {
        "id": "cq-03-python-quality",
        "type": "reviewer",
        "model": "deepseek-chat",
        "domain": "code-quality",
        "task": """Review Python code quality in python/engine/.

Focus on:
1. Exception handling (bare except:, swallowed exceptions)
2. Type hints coverage
3. Docstring quality
4. Code duplication
5. Function complexity

Explore python/engine/ structure first, then examine key modules.
Report: Issues with file:line references, severity, and fixes."""
    },
    {
        "id": "cq-04-error-handling",
        "type": "reviewer",
        "model": "deepseek-chat",
        "domain": "code-quality",
        "task": """Audit error handling across the entire codebase.

Focus on:
1. Electron IPC handlers - are errors properly caught and returned?
2. Python API routes - are exceptions logged and returned correctly?
3. React components - are errors handled gracefully?
4. LLM API calls - are rate limits and failures handled?

Search for try/catch patterns and evaluate quality.
Report: Error handling gaps with severity and fixes."""
    },
    {
        "id": "cq-05-memory-leaks",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "code-quality",
        "task": """Hunt for memory leaks in the application.

Focus on:
1. Event listener cleanup in Electron
2. React component unmount cleanup
3. Subscription cleanup (IPC listeners)
4. WebSocket/stream cleanup
5. Python resource management

Search for addEventListener, useEffect, and subprocess patterns.
Report: Potential memory leak locations with fixes."""
    },
    {
        "id": "cq-06-performance",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "code-quality",
        "task": """Identify performance bottlenecks.

Focus on:
1. React render performance (large lists, frequent updates)
2. Python computation efficiency (loops, data processing)
3. IPC serialization overhead
4. Database query efficiency
5. API call batching opportunities

Report: Performance issues with impact assessment and optimization strategies."""
    },
    {
        "id": "cq-07-security",
        "type": "reviewer",
        "model": "deepseek-chat",
        "domain": "code-quality",
        "task": """Security audit of the quant-engine.

Focus on:
1. API key handling (exposure, storage)
2. Input validation (SQL injection, command injection)
3. Electron security (nodeIntegration, contextIsolation)
4. CORS and network security
5. File system access controls

Read electron main.ts and preload.ts security settings.
Report: Security vulnerabilities with severity and fixes."""
    },
    {
        "id": "cq-08-test-coverage",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "code-quality",
        "task": """Assess test coverage and testing gaps.

Focus on:
1. What testing framework is configured?
2. Which critical components lack tests?
3. What integration tests are missing?
4. Are there any test files at all?

Search for test files, jest config, pytest config.
Report: Testing gaps with prioritized recommendations."""
    },
    {
        "id": "cq-09-dead-code",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "code-quality",
        "task": """Find dead code and unused exports.

Focus on:
1. Unused functions and classes
2. Unreachable code branches
3. Unused imports
4. Deprecated code still present
5. Commented-out code blocks

Use search_code to find patterns.
Report: Dead code locations that can be safely removed."""
    },
    {
        "id": "cq-10-documentation",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "code-quality",
        "task": """Assess documentation quality.

Focus on:
1. Are complex functions documented?
2. Is the architecture documented?
3. Are API endpoints documented?
4. Is the Python engine documented?
5. Is setup/installation documented?

Read README.md, ARCHITECTURE.md, and key source files.
Report: Documentation gaps with priority."""
    },

    # -------------------------------------------------------------------------
    # ARCHITECTURE (8 agents)
    # -------------------------------------------------------------------------
    {
        "id": "arch-01-electron-ipc",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "architecture",
        "task": """Analyze Electron IPC architecture.

Focus on:
1. IPC channel naming conventions
2. Handler registration patterns
3. Bi-directional communication patterns
4. Streaming vs request/response patterns
5. Type safety across the bridge

Read src/electron/preload.ts and ipc-handlers/.
Report: Architecture issues and improvements for IPC system."""
    },
    {
        "id": "arch-02-state-management",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "architecture",
        "task": """Analyze React state management architecture.

Focus on:
1. How is global state managed?
2. What state should be centralized vs local?
3. Are there prop drilling issues?
4. Is there state synchronization across components?
5. How is server state (API data) managed?

Read key components and identify state patterns.
Report: State management improvements."""
    },
    {
        "id": "arch-03-python-engine",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "architecture",
        "task": """Analyze Python engine architecture.

Focus on:
1. Module organization in python/engine/
2. Separation of concerns
3. Data flow through the engine
4. API design patterns
5. Configuration management

Explore python/engine/ directory structure and key files.
Report: Engine architecture improvements."""
    },
    {
        "id": "arch-04-data-flow",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "architecture",
        "task": """Map complete data flow through the application.

Trace:
1. User input → React → IPC → Electron → Python → Response
2. Market data flow (loading, caching, serving)
3. LLM request/response flow
4. State synchronization across layers

Report: Data flow diagram (text), bottlenecks, and improvements."""
    },
    {
        "id": "arch-05-api-design",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "architecture",
        "task": """Review API design (internal and external).

Focus on:
1. Python Flask API design (python/engine/api/)
2. IPC API design (preload exposed functions)
3. Supabase API usage patterns
4. LLM API integration patterns

Read API route definitions and handlers.
Report: API design improvements and consistency issues."""
    },
    {
        "id": "arch-06-database",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "architecture",
        "task": """Review database architecture.

Focus on:
1. Local SQLite usage patterns
2. Supabase schema and queries
3. DuckDB integration (if present)
4. Data caching strategies
5. Query performance

Search for database, sqlite, supabase patterns.
Report: Database architecture improvements."""
    },
    {
        "id": "arch-07-memory-system",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "architecture",
        "task": """Analyze the memory/context system architecture.

Focus on:
1. src/electron/memory/ - MemoryDaemon, RecallEngine
2. How memories are extracted and stored
3. How context is retrieved and used
4. Embedding generation patterns
5. Memory retrieval efficiency

Report: Memory system improvements for better context handling."""
    },
    {
        "id": "arch-08-multi-model",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "architecture",
        "task": """Review multi-model LLM integration architecture.

Focus on:
1. src/config/models.ts - model tier system
2. How different models are selected for tasks
3. Fallback handling between models
4. Cost optimization patterns
5. Tool calling integration

Read model config and LLM client code.
Report: Multi-model architecture improvements."""
    },

    # -------------------------------------------------------------------------
    # QUANTITATIVE STRATEGY (12 agents)
    # -------------------------------------------------------------------------
    {
        "id": "quant-01-backtest-bias",
        "type": "analyst",
        "model": "deepseek-reasoner",
        "domain": "quant-strategy",
        "task": """CRITICAL: Analyze backtesting methodology for look-ahead bias.

This is the most important review. Look-ahead bias destroys strategies.

Focus on:
1. How are signals generated? Is future data accidentally used?
2. How are entry/exit points determined? Any peeking?
3. How is training/test data split for ML models?
4. Are indicators calculated with proper rolling windows?
5. Is data alignment correct (no off-by-one errors)?

Think step-by-step about each potential bias source.
Report: Any detected look-ahead bias with specific code references."""
    },
    {
        "id": "quant-02-survivorship-bias",
        "type": "analyst",
        "model": "deepseek-reasoner",
        "domain": "quant-strategy",
        "task": """Analyze for survivorship bias in the system.

Focus on:
1. Does the data include delisted/bankrupt stocks?
2. How is the universe of tradeable symbols determined?
3. Are splits and dividends handled correctly?
4. Is there point-in-time data handling?
5. How is missing data handled?

Reason through the data loading and universe selection logic.
Report: Survivorship bias risks and mitigations needed."""
    },
    {
        "id": "quant-03-overfitting",
        "type": "analyst",
        "model": "deepseek-reasoner",
        "domain": "quant-strategy",
        "task": """Assess overfitting risk in strategy development.

Focus on:
1. How many parameters are being optimized?
2. Is there proper out-of-sample testing?
3. Is there walk-forward analysis?
4. Are there multiple testing corrections?
5. What is the degrees-of-freedom per parameter?

Reason about statistical validity of any strategy optimization.
Report: Overfitting risks and recommended validation protocols."""
    },
    {
        "id": "quant-04-risk-management",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "quant-strategy",
        "task": """Review risk management implementation.

Focus on:
1. Position sizing logic
2. Stop-loss implementation
3. Portfolio-level risk limits
4. Correlation handling
5. Drawdown controls
6. Volatility-based position sizing

Search for risk, position_size, stop_loss patterns.
Report: Risk management gaps and improvements."""
    },
    {
        "id": "quant-05-execution-model",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "quant-strategy",
        "task": """Review trade execution modeling.

Focus on:
1. How is slippage modeled?
2. How are transaction costs handled?
3. Is market impact considered?
4. Are bid-ask spreads modeled?
5. Is execution timing realistic?

Report: Execution model realism and improvements."""
    },
    {
        "id": "quant-06-options-pricing",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "quant-strategy",
        "task": """Review options pricing implementation.

Focus on:
1. Black-Scholes or other pricing models
2. Volatility surface handling
3. Greeks calculations
4. Early exercise modeling
5. Interest rate handling

Search for options, black_scholes, greeks patterns.
Report: Options pricing accuracy and improvements."""
    },
    {
        "id": "quant-07-signal-generation",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "quant-strategy",
        "task": """Review signal generation logic.

Focus on:
1. What indicators/features are used?
2. How are signals combined?
3. Is there signal decay handling?
4. How is signal strength normalized?
5. Are there regime-specific signals?

Report: Signal generation improvements."""
    },
    {
        "id": "quant-08-data-quality",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "quant-strategy",
        "task": """Assess market data quality handling.

Focus on:
1. How is bad data detected?
2. How are outliers handled?
3. How are gaps filled?
4. How are corporate actions adjusted?
5. Is data validated before use?

Report: Data quality issues and validation improvements."""
    },
    {
        "id": "quant-09-regime-detection",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "quant-strategy",
        "task": """Review market regime detection.

Focus on:
1. How are regimes defined?
2. What features drive regime classification?
3. How stable is regime detection?
4. How quickly are regime changes detected?
5. Are different strategies used per regime?

Report: Regime detection improvements."""
    },
    {
        "id": "quant-10-performance-metrics",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "quant-strategy",
        "task": """Review performance metrics calculation.

Focus on:
1. Sharpe ratio calculation (is it annualized correctly?)
2. Sortino, Calmar, other ratios
3. Drawdown calculations
4. Win rate and profit factor
5. Risk-adjusted returns

Report: Metrics calculation correctness and additional metrics needed."""
    },
    {
        "id": "quant-11-ml-methodology",
        "type": "analyst",
        "model": "deepseek-reasoner",
        "domain": "quant-strategy",
        "task": """Review machine learning methodology (if present).

Focus on:
1. Feature engineering soundness
2. Train/validation/test splits
3. Cross-validation approach (time series aware?)
4. Model selection criteria
5. Hyperparameter tuning methodology
6. Feature importance analysis

Reason about ML best practices for financial time series.
Report: ML methodology issues and improvements."""
    },
    {
        "id": "quant-12-reproducibility",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "quant-strategy",
        "task": """Assess research reproducibility.

Focus on:
1. Are random seeds set?
2. Is environment versioned?
3. Are data versions tracked?
4. Are results logged systematically?
5. Can past experiments be reproduced?

Report: Reproducibility gaps and improvements."""
    },

    # -------------------------------------------------------------------------
    # TRADING SYSTEMS (8 agents)
    # -------------------------------------------------------------------------
    {
        "id": "trade-01-order-flow",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "trading-systems",
        "task": """Review order flow and execution logic.

Focus on:
1. How are orders generated?
2. How are orders validated?
3. Order state management
4. Partial fill handling
5. Order cancellation logic

Report: Order flow issues and improvements."""
    },
    {
        "id": "trade-02-position-tracking",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "trading-systems",
        "task": """Review position tracking accuracy.

Focus on:
1. How are positions updated?
2. Is there reconciliation logic?
3. How are P&L calculated?
4. Are there position limit checks?
5. Multi-asset position handling

Report: Position tracking issues."""
    },
    {
        "id": "trade-03-pnl-calculation",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "trading-systems",
        "task": """Review P&L calculation correctness.

Focus on:
1. Realized vs unrealized P&L
2. Currency handling (if applicable)
3. Fee deduction
4. Mark-to-market logic
5. P&L attribution

Report: P&L calculation issues."""
    },
    {
        "id": "trade-04-margin-handling",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "trading-systems",
        "task": """Review margin and capital handling.

Focus on:
1. Margin requirement calculations
2. Buying power tracking
3. Margin call handling
4. Cash management
5. Leverage limits

Report: Margin handling issues."""
    },
    {
        "id": "trade-05-edge-cases",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "trading-systems",
        "task": """Hunt for edge case handling issues.

Focus on:
1. Market close/open handling
2. Holidays and half-days
3. Stock splits during position
4. Dividend events
5. Trading halts

Report: Edge cases not handled."""
    },
    {
        "id": "trade-06-data-integrity",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "trading-systems",
        "task": """Review data integrity safeguards.

Focus on:
1. How is data validated on load?
2. Are checksums used?
3. How is corruption detected?
4. Are there data quality alerts?
5. Backup and recovery

Report: Data integrity improvements needed."""
    },
    {
        "id": "trade-07-latency",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "trading-systems",
        "task": """Assess latency in the trading pipeline.

Focus on:
1. Data ingestion latency
2. Signal calculation latency
3. Order generation latency
4. IPC/API latency
5. Database query latency

Report: Latency hotspots and optimizations."""
    },
    {
        "id": "trade-08-audit-trail",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "trading-systems",
        "task": """Review audit trail and logging.

Focus on:
1. Are all trades logged?
2. Are decisions traceable?
3. Is there timestamp accuracy?
4. Can trades be reconstructed?
5. Regulatory compliance considerations

Report: Audit trail gaps."""
    },

    # -------------------------------------------------------------------------
    # UI/UX (6 agents)
    # -------------------------------------------------------------------------
    {
        "id": "ux-01-dashboard",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "ui-ux",
        "task": """Review dashboard usability.

Focus on:
1. Information hierarchy
2. Key metrics visibility
3. Navigation patterns
4. Data density
5. Visual clarity

Read src/components/dashboard/ files.
Report: Dashboard UX improvements."""
    },
    {
        "id": "ux-02-visualizations",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "ui-ux",
        "task": """Review data visualization effectiveness.

Focus on:
1. Chart types appropriate for data?
2. Color usage and accessibility
3. Interactivity and drill-down
4. Legend and label clarity
5. Responsive behavior

Report: Visualization improvements."""
    },
    {
        "id": "ux-03-error-messaging",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "ui-ux",
        "task": """Review error messaging UX.

Focus on:
1. Are errors user-friendly?
2. Are errors actionable?
3. Is error state recovery clear?
4. Are there loading/error states?
5. Toast/notification patterns

Report: Error messaging improvements."""
    },
    {
        "id": "ux-04-loading-states",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "ui-ux",
        "task": """Review loading state handling.

Focus on:
1. Are loading indicators present?
2. Are there skeleton loaders?
3. Is progress communicated?
4. Are timeouts handled?
5. Perceived performance

Report: Loading state improvements."""
    },
    {
        "id": "ux-05-forms-inputs",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "ui-ux",
        "task": """Review forms and input handling.

Focus on:
1. Input validation
2. Error messaging per field
3. Keyboard navigation
4. Autosave/recovery
5. Form submission feedback

Report: Form UX improvements."""
    },
    {
        "id": "ux-06-accessibility",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "ui-ux",
        "task": """Assess accessibility compliance.

Focus on:
1. Keyboard navigation
2. Screen reader support
3. Color contrast
4. Focus indicators
5. ARIA labels

Report: Accessibility issues and fixes."""
    },

    # -------------------------------------------------------------------------
    # INFRASTRUCTURE (6 agents)
    # -------------------------------------------------------------------------
    {
        "id": "infra-01-build",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "infrastructure",
        "task": """Review build system.

Focus on:
1. Vite configuration optimization
2. Build time improvements
3. Bundle size analysis
4. Code splitting
5. Tree shaking effectiveness

Read vite.config.ts files.
Report: Build improvements."""
    },
    {
        "id": "infra-02-dependencies",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "infrastructure",
        "task": """Audit dependencies.

Focus on:
1. Outdated packages
2. Security vulnerabilities
3. Unused dependencies
4. Duplicate packages
5. Bundle size impact

Read package.json and requirements.txt.
Report: Dependency issues and updates needed."""
    },
    {
        "id": "infra-03-environment",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "infrastructure",
        "task": """Review environment configuration.

Focus on:
1. .env handling
2. Environment validation
3. Secrets management
4. Config per environment
5. Default values

Read .env.example and config files.
Report: Environment configuration improvements."""
    },
    {
        "id": "infra-04-logging",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "infrastructure",
        "task": """Review logging and monitoring.

Focus on:
1. Logging levels and structure
2. Error tracking
3. Performance monitoring
4. Usage analytics
5. Debug capabilities

Report: Logging/monitoring improvements."""
    },
    {
        "id": "infra-05-deployment",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "infrastructure",
        "task": """Assess deployment readiness.

Focus on:
1. Electron packaging (electron-builder.json)
2. Cross-platform builds
3. Auto-update mechanism
4. Code signing
5. Distribution strategy

Read electron-builder.json.
Report: Deployment improvements."""
    },
    {
        "id": "infra-06-dev-experience",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "infrastructure",
        "task": """Review developer experience.

Focus on:
1. Setup documentation
2. Hot reload quality
3. Debug tooling
4. Linting/formatting
5. Pre-commit hooks

Report: Developer experience improvements."""
    }
]


def run_single_agent(agent_config: dict) -> dict:
    """Run a single agent and return results"""
    agent_id = agent_config['id']
    print(f"[SWARM] Starting agent: {agent_id}")

    try:
        context = f"""PROJECT ROOT: {PROJECT_ROOT}
Key directories:
- src/: React frontend and Electron main process
- src/electron/: IPC handlers, LLM clients, memory system
- src/components/: React components
- python/: Python backend engine
- python/engine/: Core backtesting and analysis
- supabase/: Edge functions

Use your tools to read actual code before analyzing."""

        result = run_agent(
            task=agent_config['task'],
            agent_type=agent_config['type'],
            context=context,
            model=agent_config.get('model', 'deepseek-chat')
        )

        return {
            "id": agent_id,
            "domain": agent_config['domain'],
            "status": "success",
            "result": result
        }
    except Exception as e:
        return {
            "id": agent_id,
            "domain": agent_config['domain'],
            "status": "error",
            "error": str(e)
        }


def run_swarm(max_workers: int = 10):
    """Run all agents in parallel"""
    print(f"\n{'='*70}")
    print(f"COMPREHENSIVE QUANT-ENGINE SWARM AUDIT")
    print(f"Agents: {len(AGENTS)} | Workers: {max_workers}")
    print(f"Started: {datetime.now().isoformat()}")
    print(f"{'='*70}\n")

    if not DEEPSEEK_API_KEY:
        print("ERROR: DEEPSEEK_API_KEY not set!")
        sys.exit(1)

    # Create results directory
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    results = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_agent = {
            executor.submit(run_single_agent, agent): agent
            for agent in AGENTS
        }

        for future in concurrent.futures.as_completed(future_to_agent):
            agent = future_to_agent[future]
            try:
                result = future.result()
                results.append(result)

                # Save individual result
                result_file = RESULTS_DIR / f"{result['id']}.json"
                with open(result_file, 'w') as f:
                    json.dump(result, f, indent=2)

                status = "✅" if result['status'] == 'success' else "❌"
                print(f"{status} [{result['domain']}] {result['id']}")

            except Exception as e:
                print(f"❌ Agent {agent['id']} crashed: {e}")
                results.append({
                    "id": agent['id'],
                    "domain": agent['domain'],
                    "status": "crashed",
                    "error": str(e)
                })

    # Save combined results
    combined_file = RESULTS_DIR / f"combined_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(combined_file, 'w') as f:
        json.dump(results, f, indent=2)

    # Print summary
    print(f"\n{'='*70}")
    print("SWARM COMPLETE")
    print(f"{'='*70}")

    by_domain = {}
    for r in results:
        domain = r['domain']
        if domain not in by_domain:
            by_domain[domain] = {'success': 0, 'error': 0}
        by_domain[domain]['success' if r['status'] == 'success' else 'error'] += 1

    for domain, counts in by_domain.items():
        print(f"  {domain}: {counts['success']} success, {counts['error']} errors")

    print(f"\nResults saved to: {RESULTS_DIR}")
    print(f"Combined file: {combined_file}")

    return results


def generate_summary_report(results: list) -> str:
    """Generate a markdown summary of all findings"""
    report = f"""# Comprehensive Quant-Engine Audit Report
Generated: {datetime.now().isoformat()}
Total Agents: {len(results)}
Success: {len([r for r in results if r['status'] == 'success'])}
Errors: {len([r for r in results if r['status'] != 'success'])}

---

"""

    # Group by domain
    domains = {}
    for r in results:
        domain = r['domain']
        if domain not in domains:
            domains[domain] = []
        domains[domain].append(r)

    for domain, agents in sorted(domains.items()):
        report += f"\n## {domain.upper().replace('-', ' ')}\n\n"

        for agent in agents:
            report += f"### {agent['id']}\n\n"
            if agent['status'] == 'success':
                report += f"{agent['result']}\n\n"
            else:
                report += f"**ERROR**: {agent.get('error', 'Unknown error')}\n\n"
            report += "---\n\n"

    return report


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument('--workers', type=int, default=10,
                       help='Number of parallel workers (default: 10)')
    parser.add_argument('--generate-report', action='store_true',
                       help='Generate markdown report from existing results')

    args = parser.parse_args()

    if args.generate_report:
        # Load existing results
        combined_files = sorted(RESULTS_DIR.glob('combined_results_*.json'))
        if combined_files:
            with open(combined_files[-1]) as f:
                results = json.load(f)
            report = generate_summary_report(results)
            report_file = RESULTS_DIR / "AUDIT_REPORT.md"
            with open(report_file, 'w') as f:
                f.write(report)
            print(f"Report saved to: {report_file}")
        else:
            print("No results found. Run swarm first.")
    else:
        results = run_swarm(max_workers=args.workers)

        # Auto-generate report
        report = generate_summary_report(results)
        report_file = RESULTS_DIR / "AUDIT_REPORT.md"
        with open(report_file, 'w') as f:
            f.write(report)
        print(f"\nReport saved to: {report_file}")
