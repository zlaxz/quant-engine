#!/usr/bin/env python3
"""
Swarm Fix - Launch parallel DeepSeek fixer agents to repair bugs
"""

import subprocess
import sys
import os
import json
from datetime import datetime
from concurrent.futures import ProcessPoolExecutor, as_completed

# Add parent directory to path
sys.path.insert(0, os.path.dirname(__file__))

# Fix tasks for the fixer agents - each task targets ONE specific bug
FIX_TASKS = [
    {
        "id": "FIX_001",
        "name": "DualPurposePanel Timer Infinite Loop",
        "priority": "CRITICAL",
        "task": """FIX the infinite loop bug in DualPurposePanel.tsx

FILE: /Users/zstoc/GitHub/quant-engine/src/components/visualizations/DualPurposePanel.tsx

BUG: The autoReturnTimer is included in the useEffect dependency array, causing an infinite loop.
When the timer updates state, the effect re-runs, creating a new timer, which updates state again.

SOLUTION: Remove autoReturnTimer from the dependency array. The timer should only be reset when
mode, activeArtifact, or activeTab changes - NOT when the timer reference changes.

Look for a useEffect that has [mode, activeArtifact, activeTab, autoReturnTimer] and remove autoReturnTimer from that array.

Make MINIMAL changes - only fix this specific bug."""
    },
    {
        "id": "FIX_002",
        "name": "UI Bridge Error Handling",
        "priority": "CRITICAL",
        "task": """FIX missing error handling in ui_bridge.py file writes

FILE: /Users/zstoc/GitHub/quant-engine/python/engine/ui_bridge.py

BUG: The emit_ui_event function writes files without try/catch. If the write fails (permissions,
disk space, etc.), it fails silently.

SOLUTION: Wrap the file write in a try/except block. On error, print to stderr and return False.

Find the `with open(filepath, 'w') as f:` block and wrap it in error handling.

Make MINIMAL changes - only add the try/except around the file write."""
    },
    {
        "id": "FIX_003",
        "name": "VisualizationContext useMemo",
        "priority": "HIGH",
        "task": """FIX missing useMemo in VisualizationContext.tsx

FILE: /Users/zstoc/GitHub/quant-engine/src/contexts/VisualizationContext.tsx

BUG: The context value object { currentView, setView, resetToDefault } is created new on every render,
causing all consumers to re-render unnecessarily.

SOLUTION: Wrap the context value in useMemo:
1. Import useMemo from React if not already imported
2. Replace the value prop with: useMemo(() => ({ currentView, setView, resetToDefault }), [currentView, setView, resetToDefault])

Make MINIMAL changes - only add useMemo around the value object."""
    },
    {
        "id": "FIX_004",
        "name": "Toast Max Visible Limit",
        "priority": "CRITICAL",
        "task": """FIX unlimited toasts in sonner.tsx

FILE: /Users/zstoc/GitHub/quant-engine/src/components/ui/sonner.tsx

BUG: No toast limit - unlimited toasts could overwhelm the UI.

SOLUTION: Add visibleToasts={5} prop to the Toaster component to limit to 5 visible toasts.

Find the <Toaster component and add visibleToasts={5} as a prop.

Make MINIMAL changes - only add the visibleToasts prop."""
    },
    {
        "id": "FIX_005",
        "name": "Demo Script Error Handling",
        "priority": "HIGH",
        "task": """FIX missing error handling in demo_jarvis.py

FILE: /Users/zstoc/GitHub/quant-engine/python/scripts/demo_jarvis.py

BUG: No try/except blocks. If any emit call fails, the entire demo crashes.

SOLUTION: Add try/except around the main demo logic. Also add if __name__ == "__main__": guard.

Find the demo_sequence() function and wrap the body in try/except.
At the bottom, wrap the demo_sequence() call in if __name__ == "__main__":

Make MINIMAL changes - just add error handling wrapper and main guard."""
    },
    {
        "id": "FIX_006",
        "name": "GenericChart Error Boundary",
        "priority": "CRITICAL",
        "task": """ADD React Error Boundary wrapper to GenericChart.tsx

FILE: /Users/zstoc/GitHub/quant-engine/src/components/charts/GenericChart.tsx

BUG: No error boundary - chart errors can crash the entire application.

SOLUTION: Add a simple error boundary. At the top of the file (after imports), add:

class ChartErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  state = { hasError: false, error: undefined };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full text-red-500 p-4">
          <div>Chart Error: {this.state.error?.message || 'Unknown error'}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

Then wrap the main chart render in <ChartErrorBoundary>...</ChartErrorBoundary>

Make sure React is imported properly for the class component."""
    },
]


def run_single_fix(task_info: dict) -> dict:
    """Run a single DeepSeek fixer agent"""
    task_id = task_info['id']
    task_name = task_info['name']
    task = task_info['task']
    priority = task_info['priority']

    print(f"[{task_id}] Starting: {task_name} ({priority})", file=sys.stderr)

    try:
        result = subprocess.run(
            [
                sys.executable,
                os.path.join(os.path.dirname(__file__), 'deepseek_agent.py'),
                task,
                'fixer',  # Use fixer agent type
                '--model', 'deepseek-chat'  # Chat model is better for tool execution
            ],
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout per agent
            env={**os.environ, 'DEEPSEEK_API_KEY': os.environ.get('DEEPSEEK_API_KEY', '')}
        )

        output = result.stdout if result.stdout else result.stderr
        print(f"[{task_id}] Completed: {task_name}", file=sys.stderr)

        return {
            'id': task_id,
            'name': task_name,
            'priority': priority,
            'status': 'success',
            'output': output,
            'stderr': result.stderr
        }
    except subprocess.TimeoutExpired:
        print(f"[{task_id}] TIMEOUT: {task_name}", file=sys.stderr)
        return {
            'id': task_id,
            'name': task_name,
            'priority': priority,
            'status': 'timeout',
            'output': 'Agent timed out after 5 minutes',
            'stderr': ''
        }
    except Exception as e:
        print(f"[{task_id}] ERROR: {task_name} - {str(e)}", file=sys.stderr)
        return {
            'id': task_id,
            'name': task_name,
            'priority': priority,
            'status': 'error',
            'output': str(e),
            'stderr': ''
        }


def compile_results(results: list) -> str:
    """Compile all fix results into a report"""
    output = []
    output.append("=" * 80)
    output.append("QUANT ENGINE BUG FIX REPORT")
    output.append(f"Generated: {datetime.now().isoformat()}")
    output.append(f"Agents: {len(results)} DeepSeek fixer agents")
    output.append("=" * 80)
    output.append("")

    # Summary stats
    success = sum(1 for r in results if r['status'] == 'success' and 'Successfully edited' in r.get('output', ''))
    partial = sum(1 for r in results if r['status'] == 'success' and 'Successfully edited' not in r.get('output', ''))
    timeout = sum(1 for r in results if r['status'] == 'timeout')
    error = sum(1 for r in results if r['status'] == 'error')

    output.append(f"## Summary: {success} fixed, {partial} attempted, {timeout} timed out, {error} errors")
    output.append("")

    # Results by priority
    critical_results = [r for r in results if r['priority'] == 'CRITICAL']
    high_results = [r for r in results if r['priority'] == 'HIGH']

    if critical_results:
        output.append("### CRITICAL FIXES")
        for result in critical_results:
            status_icon = "✅" if 'Successfully edited' in result.get('output', '') else "❌"
            output.append(f"{status_icon} {result['id']}: {result['name']}")
            if 'Successfully edited' in result.get('output', ''):
                output.append(f"   FIXED!")
            else:
                output.append(f"   Status: {result['status']}")
        output.append("")

    if high_results:
        output.append("### HIGH PRIORITY FIXES")
        for result in high_results:
            status_icon = "✅" if 'Successfully edited' in result.get('output', '') else "❌"
            output.append(f"{status_icon} {result['id']}: {result['name']}")
            if 'Successfully edited' in result.get('output', ''):
                output.append(f"   FIXED!")
            else:
                output.append(f"   Status: {result['status']}")
        output.append("")

    # Detailed output
    output.append("=" * 80)
    output.append("## DETAILED OUTPUT")
    output.append("=" * 80)

    for result in results:
        output.append("-" * 80)
        output.append(f"## {result['id']}: {result['name']} ({result['priority']})")
        output.append(f"Status: {result['status']}")
        output.append("")
        output.append(result.get('output', 'No output'))
        output.append("")

    return '\n'.join(output)


def main():
    """Run all fix agents in parallel"""
    print("=" * 60, file=sys.stderr)
    print("QUANT ENGINE SWARM FIX", file=sys.stderr)
    print(f"Launching {len(FIX_TASKS)} DeepSeek fixer agents", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    # Check API key
    if not os.environ.get('DEEPSEEK_API_KEY'):
        print("ERROR: DEEPSEEK_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    results = []

    # Run agents in parallel (max 3 concurrent to avoid overwhelming API)
    with ProcessPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(run_single_fix, task): task for task in FIX_TASKS}

        for future in as_completed(futures):
            task = futures[future]
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                results.append({
                    'id': task['id'],
                    'name': task['name'],
                    'priority': task['priority'],
                    'status': 'error',
                    'output': str(e),
                    'stderr': ''
                })

    # Sort results by ID
    results.sort(key=lambda x: x['id'])

    # Compile and output
    report = compile_results(results)

    # Save to file
    report_path = os.path.join(os.path.dirname(__file__), 'reports', f'swarm_fix_{datetime.now().strftime("%Y%m%d_%H%M%S")}.md')
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, 'w') as f:
        f.write(report)

    print(f"\nReport saved to: {report_path}", file=sys.stderr)
    print(report)


if __name__ == '__main__':
    main()
