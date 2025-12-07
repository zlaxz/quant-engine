#!/usr/bin/env python3
"""
Swarm Audit & Fix - Launch parallel DeepSeek auditor_fixer agents for test suite
Each agent audits a test file for bugs, then immediately fixes them.
"""

import subprocess
import sys
import os
import json
from datetime import datetime
from concurrent.futures import ProcessPoolExecutor, as_completed

# Test files to audit and fix
TEST_FILES = [
    "/Users/zstoc/GitHub/quant-engine/python/tests/test_force_validation.py",
    "/Users/zstoc/GitHub/quant-engine/python/tests/test_causal_validation.py",
    "/Users/zstoc/GitHub/quant-engine/python/tests/test_regime_backtest.py",
    "/Users/zstoc/GitHub/quant-engine/python/tests/test_fano_sanity.py",
]

# Audit+Fix task template for each test file
AUDIT_FIX_TASK = """AUDIT AND FIX this quant test file for bugs.

FILE: {file_path}

PHASE 1 - AUDIT (find bugs):
Check for these common test issues:
1. Assertions that are too strict (will fail on valid edge cases)
2. Assertions that are too loose (will pass even if code is broken)
3. Missing edge case handling (empty arrays, NaN, division by zero)
4. Incorrect test logic (wrong comparisons, off-by-one errors)
5. Tests that don't actually test anything meaningful
6. Drawdown logic errors (max_drawdown is NEGATIVE, so `abs()` is often wrong)
7. Threshold comparisons that should be inclusive (< vs <=)

PHASE 2 - FIX (repair bugs):
For each bug found, use edit_file to fix it:
1. Include 3-5 lines of context to make old_string unique
2. Make MINIMAL changes - only fix the specific bug
3. Add helpful error messages to assertions

PRIORITY ORDER:
1. CRITICAL: Tests that will always fail or always pass
2. HIGH: Logic errors in assertions
3. MEDIUM: Missing edge case handling
4. LOW: Assertion message improvements

Report format at end:
## Summary
[number of issues found and fixed]

## Issues Fixed
- [file:line] [description of fix]

## Issues NOT Fixed
- [reason if any issues couldn't be fixed]
"""


def run_auditor_fixer(file_path: str) -> dict:
    """Run a single DeepSeek auditor_fixer agent on a test file"""
    file_name = os.path.basename(file_path)
    task = AUDIT_FIX_TASK.format(file_path=file_path)

    print(f"[{file_name}] Starting auditor_fixer agent...", file=sys.stderr)

    try:
        result = subprocess.run(
            [
                sys.executable,
                os.path.join(os.path.dirname(__file__), 'deepseek_agent.py'),
                task,
                'auditor_fixer',  # Use auditor_fixer agent type
                '--model', 'deepseek-chat'  # Will auto-switch to reasoner for audit phase
            ],
            capture_output=True,
            text=True,
            timeout=600,  # 10 minute timeout per agent (audit+fix takes longer)
            env={**os.environ, 'DEEPSEEK_API_KEY': os.environ.get('DEEPSEEK_API_KEY', '')}
        )

        output = result.stdout if result.stdout else result.stderr
        print(f"[{file_name}] Completed", file=sys.stderr)

        # Check if fixes were applied
        fixes_applied = 'Successfully edited' in output or '[FIX COMPLETE]' in output

        return {
            'file': file_path,
            'file_name': file_name,
            'status': 'fixed' if fixes_applied else 'audited',
            'output': output,
            'stderr': result.stderr
        }
    except subprocess.TimeoutExpired:
        print(f"[{file_name}] TIMEOUT", file=sys.stderr)
        return {
            'file': file_path,
            'file_name': file_name,
            'status': 'timeout',
            'output': 'Agent timed out after 10 minutes',
            'stderr': ''
        }
    except Exception as e:
        print(f"[{file_name}] ERROR: {str(e)}", file=sys.stderr)
        return {
            'file': file_path,
            'file_name': file_name,
            'status': 'error',
            'output': str(e),
            'stderr': ''
        }


def compile_results(results: list) -> str:
    """Compile all audit+fix results into a report"""
    output = []
    output.append("=" * 80)
    output.append("QUANT ENGINE TEST SUITE AUDIT & FIX REPORT")
    output.append(f"Generated: {datetime.now().isoformat()}")
    output.append(f"Files: {len(results)} test files")
    output.append(f"Agent Type: auditor_fixer (audit + fix in one pass)")
    output.append("=" * 80)
    output.append("")

    # Summary stats
    fixed = sum(1 for r in results if r['status'] == 'fixed')
    audited = sum(1 for r in results if r['status'] == 'audited')
    timeout = sum(1 for r in results if r['status'] == 'timeout')
    error = sum(1 for r in results if r['status'] == 'error')

    output.append(f"## Summary: {fixed} fixed, {audited} audited only, {timeout} timed out, {error} errors")
    output.append("")

    # Quick status per file
    output.append("### File Status")
    for result in results:
        status_icon = {
            'fixed': '✅',
            'audited': '📋',
            'timeout': '⏱️',
            'error': '❌'
        }.get(result['status'], '?')
        output.append(f"{status_icon} {result['file_name']}: {result['status']}")
    output.append("")

    # Detailed output per file
    output.append("=" * 80)
    output.append("## DETAILED OUTPUT")
    output.append("=" * 80)

    for result in results:
        output.append("")
        output.append("-" * 80)
        output.append(f"## {result['file_name']}")
        output.append(f"Status: {result['status']}")
        output.append("-" * 80)
        output.append("")
        output.append(result.get('output', 'No output'))
        output.append("")

    return '\n'.join(output)


def main():
    """Run auditor_fixer agents in parallel on all test files"""
    print("=" * 60, file=sys.stderr)
    print("QUANT ENGINE TEST SUITE AUDIT & FIX", file=sys.stderr)
    print(f"Launching {len(TEST_FILES)} DeepSeek auditor_fixer agents", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    # Check API key
    if not os.environ.get('DEEPSEEK_API_KEY'):
        print("ERROR: DEEPSEEK_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    results = []

    # Run agents in parallel (max 2 concurrent - auditor_fixer uses more tokens)
    with ProcessPoolExecutor(max_workers=2) as executor:
        futures = {executor.submit(run_auditor_fixer, f): f for f in TEST_FILES}

        for future in as_completed(futures):
            file_path = futures[future]
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                results.append({
                    'file': file_path,
                    'file_name': os.path.basename(file_path),
                    'status': 'error',
                    'output': str(e),
                    'stderr': ''
                })

    # Sort results by filename
    results.sort(key=lambda x: x['file_name'])

    # Compile and output
    report = compile_results(results)

    # Save to file
    report_path = os.path.join(
        os.path.dirname(__file__),
        'reports',
        f'test_audit_fix_{datetime.now().strftime("%Y%m%d_%H%M%S")}.md'
    )
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, 'w') as f:
        f.write(report)

    print(f"\nReport saved to: {report_path}", file=sys.stderr)
    print(report)

    # Run pytest to verify fixes
    print("\n" + "=" * 60, file=sys.stderr)
    print("RUNNING PYTEST TO VERIFY FIXES", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    pytest_result = subprocess.run(
        [sys.executable, '-m', 'pytest', 'python/tests/', '-v', '--tb=short'],
        capture_output=True,
        text=True,
        cwd=os.path.dirname(os.path.dirname(__file__))
    )

    print(pytest_result.stdout)
    if pytest_result.returncode != 0:
        print(f"\nPytest failed with return code {pytest_result.returncode}", file=sys.stderr)
        print(pytest_result.stderr, file=sys.stderr)


if __name__ == '__main__':
    main()
