#!/usr/bin/env python3
"""
Repair + Re-Audit Swarm
- Re-runs failed critical audits with smaller scope
- Spawns repair agents to fix identified issues in parallel
"""

import os
import sys
import json
import concurrent.futures
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
RESULTS_DIR = PROJECT_ROOT / ".claude" / "repair-results"

sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
from deepseek_agent import run_agent

# ============================================================================
# RE-AUDIT AGENTS (Failed critical audits with smaller scope)
# ============================================================================

REAUDIT_AGENTS = [
    {
        "id": "reaudit-backtest-bias",
        "type": "analyst",
        "model": "deepseek-reasoner",
        "domain": "reaudit",
        "task": """CRITICAL: Check for look-ahead bias in backtesting.

TARGETED SCOPE - Only check these specific patterns:
1. Read python/engine/trading/simulator.py - check if signals use future data
2. Read python/engine/trading/execution.py - check execution timing
3. Look for any .shift(-1) or accessing future rows

DO NOT read entire codebase. Focus on these 2 files only.

Report: Any look-ahead bias found with line numbers."""
    },
    {
        "id": "reaudit-position-tracking",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "reaudit",
        "task": """Review position tracking accuracy.

TARGETED: Only read python/engine/trading/simulator.py
Look for:
1. How are positions updated on fills?
2. Is there reconciliation logic?
3. Are partial fills handled?

Report: Position tracking issues with line numbers."""
    },
    {
        "id": "reaudit-state-management",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "reaudit",
        "task": """Review React state management.

TARGETED: Only read these files:
1. src/components/backtest/BacktestRunner.tsx (first 100 lines)
2. src/lib/store.ts or similar state file

Look for: Zustand/Redux usage, prop drilling, state sync issues.
Report: State management issues."""
    },
    {
        "id": "reaudit-error-handling",
        "type": "analyst",
        "model": "deepseek-chat",
        "domain": "reaudit",
        "task": """Review error handling patterns.

TARGETED: Only check:
1. src/electron/ipc-handlers/llmClient.ts - are errors caught and returned?
2. python/engine/api/routes.py - are exceptions logged?

Report: Error handling gaps with file:line references."""
    },
]

# ============================================================================
# REPAIR AGENTS (Fix identified issues)
# ============================================================================

REPAIR_AGENTS = [
    # React Performance Fixes
    {
        "id": "fix-react-memo-backtest",
        "type": "coder",
        "model": "deepseek-chat",
        "domain": "repair-react",
        "task": """Fix React performance in BacktestRunner.tsx.

Read: src/components/backtest/BacktestRunner.tsx

Apply these fixes:
1. Wrap component export in React.memo
2. Add useCallback to event handlers (especially toggleRegime)
3. If there are 5+ related useState calls, suggest useReducer refactor

Output: The EXACT code changes needed (old code -> new code format)."""
    },
    {
        "id": "fix-react-memo-quantpanel",
        "type": "coder",
        "model": "deepseek-chat",
        "domain": "repair-react",
        "task": """Fix React performance in QuantPanel.tsx.

Read: src/components/research/QuantPanel.tsx

Apply these fixes:
1. Wrap component export in React.memo
2. Add useCallback to async functions (loadStrategies, etc)
3. Add useMemo for any computed/filtered data

Output: The EXACT code changes needed (old code -> new code format)."""
    },
    {
        "id": "fix-react-cleanup-activityfeed",
        "type": "coder",
        "model": "deepseek-chat",
        "domain": "repair-react",
        "task": """Fix memory leaks in ActivityFeed.tsx.

Read: src/components/research/ActivityFeed.tsx

Look for:
1. useEffect without cleanup functions
2. Event listeners not cleaned up
3. Missing dependency arrays

Output: The EXACT code changes needed for proper cleanup."""
    },

    # Security Fixes
    {
        "id": "fix-security-credentials",
        "type": "coder",
        "model": "deepseek-chat",
        "domain": "repair-security",
        "task": """Fix hardcoded Supabase credentials.

Read: src/electron/main.ts

Find any hardcoded:
- SUPABASE_URL
- SUPABASE_ANON_KEY
- API keys

Output:
1. Code to move to process.env
2. Updates needed for .env.example
3. The exact line changes needed."""
    },

    # Dependency Updates
    {
        "id": "fix-python-deps",
        "type": "coder",
        "model": "deepseek-chat",
        "domain": "repair-deps",
        "task": """Update Python dependencies for security.

Read: python/requirements.txt

Update these minimum versions:
- scipy>=1.14.0 (was 1.0.0 - CRITICAL security)
- xgboost>=2.1.0 (was 0.90 - CRITICAL security)
- scikit-learn>=1.6.0 (was 1.0.0)
- pandas>=2.2.0
- numpy>=2.0.0

Output: The complete updated requirements.txt content."""
    },
    {
        "id": "fix-remove-unused-deps",
        "type": "coder",
        "model": "deepseek-chat",
        "domain": "repair-deps",
        "task": """Identify unused dependencies to remove.

Read: package.json

Check if these are used anywhere in src/:
- @cfworker/json-schema
- embla-carousel-react
- input-otp
- next-themes
- vaul

For each, search for imports. If not found, mark for removal.

Output: npm uninstall command with unused packages."""
    },

    # IPC Fixes
    {
        "id": "fix-ipc-cleanup",
        "type": "coder",
        "model": "deepseek-chat",
        "domain": "repair-ipc",
        "task": """Add IPC event listener cleanup.

Read: src/electron/ipc-handlers/memoryHandlers.ts

Look for:
1. Event listeners registered without cleanup
2. Missing removeListener calls
3. Handlers that could leak memory

Output: Code changes to add proper cleanup patterns."""
    },

    # Execution Model Improvements
    {
        "id": "fix-execution-model-unify",
        "type": "analyst",
        "model": "deepseek-reasoner",
        "domain": "repair-quant",
        "task": """Design unified execution model.

Read these two files:
1. python/engine/trading/execution.py
2. python/engine/trading/simulator.py

Current issue: Two different slippage models exist.

Design a UNIFIED execution model that:
1. Combines best of both approaches
2. Adds partial fill logic
3. Adds time-of-day spread adjustments

Output: Detailed design spec for the unified model."""
    },
]

ALL_AGENTS = REAUDIT_AGENTS + REPAIR_AGENTS


def run_single_agent(agent_config: dict) -> dict:
    """Run a single agent and return results"""
    agent_id = agent_config['id']
    print(f"[SWARM] Starting: {agent_id}")

    try:
        context = f"""PROJECT ROOT: {PROJECT_ROOT}
You are a repair/audit agent. Be concise and specific.
Focus ONLY on the files mentioned in your task.
Provide exact line numbers and code changes."""

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


def run_repair_swarm(max_workers: int = 15):
    """Run all repair agents in parallel"""
    print(f"\n{'='*70}")
    print(f"REPAIR + RE-AUDIT SWARM")
    print(f"Re-audits: {len(REAUDIT_AGENTS)} | Repairs: {len(REPAIR_AGENTS)}")
    print(f"Total: {len(ALL_AGENTS)} agents | Workers: {max_workers}")
    print(f"{'='*70}\n")

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    results = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_agent = {
            executor.submit(run_single_agent, agent): agent
            for agent in ALL_AGENTS
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
    combined_file = RESULTS_DIR / f"repair_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(combined_file, 'w') as f:
        json.dump(results, f, indent=2)

    # Generate repair report
    report = generate_repair_report(results)
    report_file = RESULTS_DIR / "REPAIR_REPORT.md"
    with open(report_file, 'w') as f:
        f.write(report)

    print(f"\n{'='*70}")
    print("REPAIR SWARM COMPLETE")
    print(f"Results: {RESULTS_DIR}")
    print(f"Report: {report_file}")
    print(f"{'='*70}")

    return results


def generate_repair_report(results: list) -> str:
    """Generate repair action report"""
    report = f"""# Repair + Re-Audit Report
Generated: {datetime.now().isoformat()}

## Summary
- Re-audits: {len([r for r in results if r['domain'] == 'reaudit'])}
- Repairs: {len([r for r in results if r['domain'].startswith('repair')])}
- Success: {len([r for r in results if r['status'] == 'success'])}
- Errors: {len([r for r in results if r['status'] != 'success'])}

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
                report += f"**ERROR**: {agent.get('error', 'Unknown')}\n\n"
            report += "---\n\n"

    return report


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--workers', type=int, default=15)
    args = parser.parse_args()

    run_repair_swarm(max_workers=args.workers)
