#!/usr/bin/env python3
"""
Swarm Review - Launch 12 parallel DeepSeek-reasoner agents to review the entire app
"""

import subprocess
import sys
import os
import json
from datetime import datetime
from concurrent.futures import ProcessPoolExecutor, as_completed

# Add parent directory to path
sys.path.insert(0, os.path.dirname(__file__))

# Review assignments for 12 agents
REVIEW_TASKS = [
    {
        "id": "1_ui_bridge",
        "name": "UI Bridge Architecture",
        "task": """Review the Python→React UI Bridge system for improvements.

Files to analyze:
- /Users/zstoc/GitHub/quant-engine/python/engine/ui_bridge.py

Focus on:
1. Event emission patterns - are they efficient?
2. Error handling - what happens if file write fails?
3. Session ID management - potential issues?
4. Rate limiting - could events overwhelm the UI?
5. Type safety between Python and TypeScript
6. Missing visualization types we should add"""
    },
    {
        "id": "2_chart_renderers",
        "name": "Chart Renderers",
        "task": """Review the React chart rendering system for improvements.

Files to analyze:
- /Users/zstoc/GitHub/quant-engine/src/components/charts/GenericChart.tsx

Focus on:
1. Error boundaries - do charts fail gracefully?
2. Performance - any unnecessary re-renders?
3. Accessibility - keyboard navigation, screen readers?
4. Responsive design - do charts scale well?
5. Color contrast and theming
6. Missing chart configurations users might need"""
    },
    {
        "id": "3_chart_types",
        "name": "Type System",
        "task": """Review the TypeScript type definitions for completeness and correctness.

Files to analyze:
- /Users/zstoc/GitHub/quant-engine/src/components/charts/types.ts

Focus on:
1. Type safety - are all properties properly typed?
2. Optional vs required - are defaults sensible?
3. Union types - are all chart types covered?
4. Extensibility - easy to add new chart types?
5. Documentation - are complex types well-documented?
6. Export patterns - anything missing from exports?"""
    },
    {
        "id": "4_jarvis_handler",
        "name": "JARVIS Event Handler",
        "task": """Review the React-side JARVIS event handling for improvements.

Files to analyze:
- /Users/zstoc/GitHub/quant-engine/src/components/jarvis/JarvisEventHandler.tsx

Focus on:
1. Event queue management - FIFO ordering preserved?
2. Memory leaks - are event listeners cleaned up?
3. Race conditions - concurrent event handling safe?
4. State management - React state updates batched properly?
5. Error recovery - what if an event is malformed?
6. Extensibility - easy to add new event types?"""
    },
    {
        "id": "5_ipc_architecture",
        "name": "IPC Architecture",
        "task": """Review the Electron IPC architecture for security and performance.

Files to analyze:
- /Users/zstoc/GitHub/quant-engine/src/electron/preload.ts

Focus on:
1. Context isolation - is sensitive data protected?
2. Input validation - are IPC arguments validated?
3. Channel naming - consistent and discoverable?
4. Error propagation - do errors bubble up correctly?
5. Performance - any blocking operations on main thread?
6. Security - any privilege escalation risks?"""
    },
    {
        "id": "6_visualization_context",
        "name": "Visualization Context",
        "task": """Review the React context for visualization state management.

Files to analyze:
- /Users/zstoc/GitHub/quant-engine/src/contexts/VisualizationContext.tsx

Focus on:
1. State shape - is it normalized and efficient?
2. Re-render optimization - unnecessary re-renders?
3. Context splitting - should it be split into smaller contexts?
4. Persistence - should state survive page refresh?
5. Type safety - are context values properly typed?
6. Default values - are they sensible?"""
    },
    {
        "id": "7_dual_purpose_panel",
        "name": "Dual Purpose Panel",
        "task": """Review the main visualization panel component for improvements.

Files to analyze:
- /Users/zstoc/GitHub/quant-engine/src/components/visualizations/DualPurposePanel.tsx

Focus on:
1. Tab switching - is state preserved correctly?
2. Auto-return timer - is 30s the right default?
3. Component lazy loading - should tabs be lazy loaded?
4. Popout functionality - any edge cases?
5. Memory management - are artifacts cleaned up?
6. Animation/transitions - could be smoother?"""
    },
    {
        "id": "8_sonner_toasts",
        "name": "Toast Notification System",
        "task": """Review the toast notification system for UX improvements.

Files to analyze:
- /Users/zstoc/GitHub/quant-engine/src/components/ui/sonner.tsx

Focus on:
1. Toast stacking - does it handle many toasts?
2. Duration settings - are timeouts appropriate?
3. Dismissibility - can users dismiss when needed?
4. Styling - do toasts match the theme?
5. Actions - can toasts have action buttons?
6. Accessibility - screen reader announcements?"""
    },
    {
        "id": "9_demo_script",
        "name": "Demo Script Quality",
        "task": """Review the JARVIS demo script for completeness and quality.

Files to analyze:
- /Users/zstoc/GitHub/quant-engine/python/scripts/demo_jarvis.py

Focus on:
1. Coverage - does it demo all visualization types?
2. Error handling - what if a function fails?
3. Timing - are delays appropriate for visual feedback?
4. Documentation - is usage clear?
5. Extensibility - easy to add new demos?
6. Real data examples - should it use actual market data?"""
    },
    {
        "id": "10_claude_watcher",
        "name": "Claude Code Watcher",
        "task": """Review the file watcher that bridges Python events to React.

Files to analyze:
- /Users/zstoc/GitHub/quant-engine/src/electron/ipc-handlers/claudeCodeWatcher.ts

Focus on:
1. File watching efficiency - polling vs events?
2. Race conditions - file read while being written?
3. Error recovery - what if file is corrupted JSON?
4. Cleanup - are processed files always deleted?
5. Queue management - event ordering preserved?
6. Performance - any bottlenecks with many events?"""
    },
    {
        "id": "11_gauge_waterfall",
        "name": "New Chart Renderers",
        "task": """Review the newly added chart renderers for bugs and improvements.

Look for GaugeRenderer, WaterfallRenderer, TreemapRenderer, PayoffRenderer in:
- /Users/zstoc/GitHub/quant-engine/src/components/charts/GenericChart.tsx

Focus on:
1. Gauge SVG - are arcs calculated correctly?
2. Waterfall - is cumulative calculation correct?
3. Treemap - does flattening preserve hierarchy info?
4. Payoff - is options math (intrinsic value) correct?
5. Edge cases - empty data, negative values, NaN?
6. Animations - should values animate on change?"""
    },
    {
        "id": "12_overall_architecture",
        "name": "Overall Architecture",
        "task": """Review the overall Python→Electron→React architecture for improvements.

Consider the full flow:
1. Python ui_bridge.py emits events to /tmp/claude-code-results/
2. Electron claudeCodeWatcher.ts watches and processes files
3. IPC sends events to React via jarvis:event channel
4. React JarvisEventHandler.tsx dispatches to appropriate components
5. GenericChart.tsx renders visualizations

Focus on:
1. Coupling - are components too tightly coupled?
2. Testability - is each layer independently testable?
3. Extensibility - how hard to add new features?
4. Performance - any bottlenecks in the pipeline?
5. Error handling - do errors propagate correctly?
6. Alternative architectures - WebSocket, shared memory?"""
    },
]


def run_single_review(task_info: dict) -> dict:
    """Run a single DeepSeek reviewer agent"""
    task_id = task_info['id']
    task_name = task_info['name']
    task = task_info['task']

    print(f"[{task_id}] Starting: {task_name}", file=sys.stderr)

    try:
        result = subprocess.run(
            [
                sys.executable,
                os.path.join(os.path.dirname(__file__), 'deepseek_agent.py'),
                task,
                'reviewer',
                '--model', 'deepseek-reasoner'
            ],
            capture_output=True,
            text=True,
            timeout=600,  # 10 minute timeout per agent
            env={**os.environ, 'DEEPSEEK_API_KEY': os.environ.get('DEEPSEEK_API_KEY', '')}
        )

        output = result.stdout if result.stdout else result.stderr
        print(f"[{task_id}] Completed: {task_name}", file=sys.stderr)

        return {
            'id': task_id,
            'name': task_name,
            'status': 'success',
            'output': output,
            'stderr': result.stderr
        }
    except subprocess.TimeoutExpired:
        print(f"[{task_id}] TIMEOUT: {task_name}", file=sys.stderr)
        return {
            'id': task_id,
            'name': task_name,
            'status': 'timeout',
            'output': 'Agent timed out after 10 minutes',
            'stderr': ''
        }
    except Exception as e:
        print(f"[{task_id}] ERROR: {task_name} - {str(e)}", file=sys.stderr)
        return {
            'id': task_id,
            'name': task_name,
            'status': 'error',
            'output': str(e),
            'stderr': ''
        }


def compile_results(results: list) -> str:
    """Compile all agent results into a single improvement list"""
    output = []
    output.append("=" * 80)
    output.append("QUANT ENGINE IMPROVEMENT SUGGESTIONS")
    output.append(f"Generated: {datetime.now().isoformat()}")
    output.append(f"Agents: {len(results)} DeepSeek-reasoner reviewers")
    output.append("=" * 80)
    output.append("")

    # Summary stats
    success = sum(1 for r in results if r['status'] == 'success')
    timeout = sum(1 for r in results if r['status'] == 'timeout')
    error = sum(1 for r in results if r['status'] == 'error')

    output.append(f"## Summary: {success} succeeded, {timeout} timed out, {error} errors")
    output.append("")

    # Collect all findings by severity
    critical = []
    high = []
    medium = []
    low = []

    for result in results:
        output.append("-" * 80)
        output.append(f"## {result['id']}: {result['name']}")
        output.append(f"Status: {result['status']}")
        output.append("")

        if result['status'] == 'success':
            # Parse the output to extract findings
            agent_output = result['output']
            output.append(agent_output)

            # Try to extract severity-tagged findings
            lines = agent_output.split('\n')
            current_severity = None
            for line in lines:
                line_lower = line.lower()
                if '### critical' in line_lower:
                    current_severity = 'critical'
                elif '### high' in line_lower:
                    current_severity = 'high'
                elif '### medium' in line_lower:
                    current_severity = 'medium'
                elif '### low' in line_lower:
                    current_severity = 'low'
                elif line.strip().startswith('-') and current_severity:
                    finding = f"[{result['name']}] {line.strip()}"
                    if current_severity == 'critical':
                        critical.append(finding)
                    elif current_severity == 'high':
                        high.append(finding)
                    elif current_severity == 'medium':
                        medium.append(finding)
                    elif current_severity == 'low':
                        low.append(finding)
        else:
            output.append(f"Output: {result['output']}")

        output.append("")

    # Add consolidated findings section
    output.append("=" * 80)
    output.append("## CONSOLIDATED FINDINGS BY SEVERITY")
    output.append("=" * 80)
    output.append("")

    if critical:
        output.append("### CRITICAL")
        for f in critical:
            output.append(f)
        output.append("")

    if high:
        output.append("### HIGH")
        for f in high:
            output.append(f)
        output.append("")

    if medium:
        output.append("### MEDIUM")
        for f in medium:
            output.append(f)
        output.append("")

    if low:
        output.append("### LOW")
        for f in low:
            output.append(f)
        output.append("")

    return '\n'.join(output)


def main():
    """Run all review agents in parallel"""
    print("=" * 60, file=sys.stderr)
    print("QUANT ENGINE SWARM REVIEW", file=sys.stderr)
    print(f"Launching {len(REVIEW_TASKS)} DeepSeek-reasoner agents", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    # Check API key
    if not os.environ.get('DEEPSEEK_API_KEY'):
        print("ERROR: DEEPSEEK_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    results = []

    # Run agents in parallel (max 4 concurrent to avoid rate limits)
    with ProcessPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(run_single_review, task): task for task in REVIEW_TASKS}

        for future in as_completed(futures):
            task = futures[future]
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                results.append({
                    'id': task['id'],
                    'name': task['name'],
                    'status': 'error',
                    'output': str(e),
                    'stderr': ''
                })

    # Sort results by ID
    results.sort(key=lambda x: x['id'])

    # Compile and output
    report = compile_results(results)

    # Save to file
    report_path = os.path.join(os.path.dirname(__file__), 'reports', f'swarm_review_{datetime.now().strftime("%Y%m%d_%H%M%S")}.md')
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, 'w') as f:
        f.write(report)

    print(f"\nReport saved to: {report_path}", file=sys.stderr)
    print(report)


if __name__ == '__main__':
    main()
