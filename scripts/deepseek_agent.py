#!/usr/bin/env python3
"""
Direct DeepSeek Agent - Bypasses Electron, calls API directly
Usage: python deepseek_agent.py "task description" [agent_type]
"""

import sys
import os
import json
import subprocess
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

DEEPSEEK_API_KEY = os.environ.get('DEEPSEEK_API_KEY')
DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'

# Agent prompts
AGENT_PROMPTS = {
    'analyst': 'You are a data analyst. Analyze thoroughly and provide specific insights.',
    'reviewer': 'You are a code reviewer. Find bugs, suggest improvements, cite line numbers.',
    'researcher': 'You are a researcher. Investigate thoroughly and provide evidence.',
    'coder': 'You are a coder. Write clean, tested code following best practices.',
}

# Tool definitions for DeepSeek agents - CRITICAL FOR FILE ACCESS
AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the contents of a file. Use this to examine code, configuration, or data files.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file to read (absolute path)"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_directory",
            "description": "List contents of a directory to explore the codebase structure.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to directory (absolute path)"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_code",
            "description": "Search for patterns in code files using grep.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Search pattern (supports regex)"},
                    "path": {"type": "string", "description": "Directory to search in (optional)"}
                },
                "required": ["pattern"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_data",
            "description": "Execute high-performance SQL against the SPY market data lake. Use this to aggregate price, volume, or volatility data instantly.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {
                        "type": "string",
                        "description": "DuckDB SQL query (e.g., 'SELECT avg(close) FROM stock_data WHERE date > 2024-01-01')"
                    }
                },
                "required": ["sql"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_backtest",
            "description": "Run a full backtest simulation for a specific strategy profile. Returns performance metrics (CAGR, Sharpe, Drawdown).",
            "parameters": {
                "type": "object",
                "properties": {
                    "profile_name": {
                        "type": "string", 
                        "description": "Strategy profile to test (e.g., 'mission_1', 'profile_1')",
                        "enum": ["mission_1", "profile_1", "profile_2", "profile_3", "profile_4", "profile_5", "profile_6"]
                    },
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD)"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD)"},
                    "initial_capital": {"type": "number", "description": "Starting capital (default: 100000)"}
                },
                "required": ["profile_name"]
            }
        }
    }
]

def call_deepseek(messages: list, max_tokens: int = 4000, tools: list = None, model: str = 'deepseek-chat') -> dict:
    """Direct HTTP call to DeepSeek API using curl (avoids SSL issues)"""
    if not DEEPSEEK_API_KEY:
        return {'error': 'DEEPSEEK_API_KEY not set in environment'}

    payload_dict = {
        'model': model,
        'messages': messages,
        'temperature': 0.3,
        'max_tokens': max_tokens
    }

    # Add tools if provided (CRITICAL for file access)
    # NOTE: V3.2 reasoner DOES support tools (new capability!)
    if tools:
        payload_dict['tools'] = tools
        payload_dict['tool_choice'] = 'auto'

    payload = json.dumps(payload_dict)

    try:
        result = subprocess.run([
            'curl', '-s', DEEPSEEK_URL,
            '-H', 'Content-Type: application/json',
            '-H', f'Authorization: Bearer {DEEPSEEK_API_KEY}',
            '-d', payload
        ], capture_output=True, text=True, timeout=600)  # 10 minute timeout

        if result.returncode != 0:
            return {'error': f'curl failed: {result.stderr}'}

        return json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        return {'error': 'Request timed out after 600 seconds (DeepSeek API did not respond)'}
    except json.JSONDecodeError as e:
        return {'error': f'Invalid JSON response: {e}'}
    except Exception as e:
        return {'error': str(e)}

def execute_tool(tool_name: str, args: dict) -> str:
    """Execute a tool call and return results"""
    try:
        if tool_name == 'read_file':
            path = args.get('path', '')
            if not os.path.exists(path):
                return f"Error: File not found: {path}"
            with open(path, 'r') as f:
                content = f.read()
                # More aggressive truncation to avoid token limits
                if len(content) > 8000:
                    return content[:8000] + f"\n\n[Truncated - file is {len(content)} bytes. Request specific sections if needed.]"
                return content

        elif tool_name == 'list_directory':
            path = args.get('path', '.')
            if not os.path.exists(path):
                return f"Error: Directory not found: {path}"
            items = os.listdir(path)
            return '\n'.join(sorted(items))

        elif tool_name == 'search_code':
            pattern = args.get('pattern', '')
            search_path = args.get('path', '.')
            result = subprocess.run(
                ['grep', '-r', '-n', '-l', pattern, search_path],  # -l for file names only first
                capture_output=True,
                text=True,
                timeout=30
            )
            output = result.stdout if result.stdout else 'No matches found'
            # Limit output to prevent token explosion
            if len(output) > 10000:
                lines = output.split('\n')[:100]
                return '\n'.join(lines) + f"\n\n[Truncated - {len(output)} bytes total. Showing first 100 matches.]"
            return output

        elif tool_name == 'query_data':
            # Lazy import to keep startup fast
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python'))
            try:
                from engine.data.db_manager import engine
                sql = args.get('sql', '')
                if not sql:
                    return "Error: No SQL query provided"

                print(f"  [DataEngine] Executing: {sql}", file=sys.stderr)
                results = engine.query(sql)

                # Truncate if result is massive (prevent token explosion)
                result_str = json.dumps(results, default=str)
                if len(result_str) > 50000:
                    return result_str[:50000] + f"... [Truncated. Total rows: {len(results)}]"
                return result_str
            except ImportError as e:
                return f"Error: Could not import engine.data.db_manager: {str(e)}"
            except Exception as e:
                return f"Error executing query: {str(e)}"

        elif tool_name == 'run_backtest':
            # Lazy import
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python'))
            try:
                import pandas as pd
                import numpy as np
                from datetime import datetime, timedelta
                from engine.trading.simulator import TradeSimulator
                
                profile_name = args.get('profile_name')
                start_str = args.get('start_date', '2022-01-01')
                end_str = args.get('end_date', '2023-12-31')
                initial_capital = float(args.get('initial_capital', 100000.0))
                
                print(f"  [Backtest] Running {profile_name} ({start_str} to {end_str})...", file=sys.stderr)
                
                # 1. Try to get data from DataEngine
                data = pd.DataFrame()
                try:
                    from engine.data.db_manager import engine
                    # Query simplified for generic usage
                    sql = f"SELECT date, close, open, high, low, volume, 20 as vix FROM stock_data WHERE date >= '{start_str}' AND date <= '{end_str}' ORDER BY date"
                    results = engine.query(sql)
                    
                    if results and isinstance(results, list) and 'error' not in results[0]:
                         data = pd.DataFrame(results)
                         if 'date' in data.columns:
                             data['date'] = pd.to_datetime(data['date'])
                except Exception as e:
                    print(f"  [Backtest] Data query failed ({str(e)}). Using synthetic data.", file=sys.stderr)
                
                # 2. Fallback to Synthetic Data if empty
                if data.empty:
                    print("  [Backtest] Generating synthetic SPY data for simulation...", file=sys.stderr)
                    dates = pd.date_range(start=start_str, end=end_str, freq='B') # Business days
                    n = len(dates)
                    # Random walk with drift
                    returns = np.random.normal(0.0005, 0.015, n) # Slight upward drift, 1.5% daily vol
                    price_path = 400 * np.exp(np.cumsum(returns))
                    
                    data = pd.DataFrame({
                        'date': dates,
                        'close': price_path,
                        'vix': np.random.normal(20, 5, n).clip(10, 60) # Mean reverting VIX
                    })
                
                # 3. Run Simulator
                sim = TradeSimulator(initial_capital=initial_capital)
                results = sim.run(data, profile_name)
                
                metrics = results.get('metrics', {})
                
                # Format output for the LLM
                output = [
                    f"## Backtest Results: {profile_name}",
                    f"Period: {start_str} to {end_str}",
                    f"Initial Capital: ${initial_capital:,.0f}",
                    "",
                    "### Key Metrics",
                    f"- Total Return: {metrics.get('total_return', 0):.2%}",
                    f"- Sharpe Ratio: {metrics.get('sharpe', 0):.2f}",
                    f"- Max Drawdown: {metrics.get('max_drawdown', 0):.2%}",
                    f"- Total Trades: {metrics.get('total_trades', 0)}",
                    "",
                    "### Execution Log (Last 5 Trades)",
                ]
                
                trades = results.get('trades', [])
                if trades:
                    # Sort by exit date
                    trades_df = pd.DataFrame(trades)
                    if not trades_df.empty and 'exit_date' in trades_df.columns:
                        recent = trades_df.sort_values('exit_date', ascending=False).head(5)
                        for _, t in recent.iterrows():
                            pnl = t.get('pnl', 0)
                            output.append(f"- {t['exit_date']}: PnL ${pnl:,.2f} ({t.get('reason', 'N/A')})")
                else:
                    output.append("- No trades executed.")
                    
                return "\n".join(output)

            except ImportError as e:
                return f"Error: Missing dependencies for backtest: {str(e)}"
            except Exception as e:
                import traceback
                return f"Error running backtest: {str(e)}\n{traceback.format_exc()}"

        else:
            return f"Error: Unknown tool {tool_name}"

    except Exception as e:
        return f"Error executing {tool_name}: {str(e)}"


def run_agent(task: str, agent_type: str = 'analyst', context: str = None, model: str = 'deepseek-chat') -> str:
    """Run a DeepSeek agent with model selection

    Args:
        task: Task description
        agent_type: Type of agent (analyst, reviewer, researcher, coder)
        context: Additional context
        model: Model to use ('deepseek-chat' or 'deepseek-reasoner' - both support tools)
    """
    is_reasoner = 'reasoner' in model.lower()

    system_prompt = AGENT_PROMPTS.get(agent_type.lower(), AGENT_PROMPTS['analyst'])

    # Force agents to complete quickly - they tend to explore forever
    if is_reasoner:
        system_prompt += """

CRITICAL INSTRUCTION: You have exactly 3 tool calls, then you MUST write your final report.

WORKFLOW:
1. read_file on the PRIMARY file in the task (first tool call)
2. ONE optional search or read for related code (second tool call)
3. ONE more if truly needed (third tool call)
4. STOP. Write your final audit report. NO MORE TOOL CALLS.

After your 3rd tool call, your next response MUST be your complete written analysis - not another tool call.

OUTPUT FORMAT (required):
## Summary
[1-2 sentences]

## Findings
### CRITICAL
- [finding with file:line]

### HIGH
- [finding with file:line]

### MEDIUM
- [finding with file:line]

### LOW
- [finding with file:line]

## Recommendations
[bullet points]"""
    else:
        system_prompt += """

CRITICAL INSTRUCTION: You have exactly 3 tool calls, then you MUST write your final report.

WORKFLOW:
1. read_file on the PRIMARY file in the task
2. ONE optional search or read
3. ONE more if needed
4. STOP. Write your final audit report. NO MORE TOOL CALLS.

OUTPUT FORMAT (required):
## Summary
## Findings (CRITICAL/HIGH/MEDIUM/LOW with file:line)
## Recommendations"""

    user_message = task
    if context:
        user_message = f"{task}\n\n## Context:\n{context}"

    messages = [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': user_message}
    ]

    print(f"[DeepSeek Agent] Type: {agent_type}, Model: {model}, Reasoner: {is_reasoner}", file=sys.stderr)
    print(f"[DeepSeek Agent] Task: {task[:100]}...", file=sys.stderr)

    # UNIFIED AGENTIC LOOP - Both chat and reasoner use tools
    MAX_ITERATIONS = 6  # Hard limit: 3 tool calls + nudge + 2 more chances
    iteration = 0
    total_tokens = 0

    while iteration < MAX_ITERATIONS:
        iteration += 1
        print(f"[DeepSeek Agent] Iteration {iteration}/{MAX_ITERATIONS}...", file=sys.stderr)

        # Forceful nudge after iteration 3 - no more tool calls allowed
        if iteration == 4:
            messages.append({
                'role': 'user',
                'content': 'STOP. You have made 3 tool calls. NO MORE TOOL CALLS ALLOWED. Write your complete audit report NOW using the format: ## Summary, ## Findings (CRITICAL/HIGH/MEDIUM/LOW), ## Recommendations. Do not call any more tools.'
            })

        result = call_deepseek(messages, tools=AGENT_TOOLS, model=model)

        if 'error' in result:
            return f"ERROR: {result['error']}"

        if 'choices' not in result or len(result['choices']) == 0:
            return f"ERROR: Unexpected response format: {json.dumps(result)}"

        choice = result['choices'][0]
        message = choice.get('message', {})
        total_tokens += result.get('usage', {}).get('total_tokens', 0)

        # Check if agent wants to call tools
        tool_calls = message.get('tool_calls', [])

        if tool_calls:
            print(f"[DeepSeek Agent] Tool calls: {len(tool_calls)}", file=sys.stderr)

            # Add assistant message with tool calls
            messages.append(message)

            # Execute each tool call
            for tool_call in tool_calls:
                if tool_call.get('type') != 'function':
                    continue

                func = tool_call.get('function', {})
                tool_name = func.get('name')
                tool_args = json.loads(func.get('arguments', '{}'))

                print(f"[DeepSeek Agent]   → {tool_name}({json.dumps(tool_args)[:50]}...)", file=sys.stderr)

                # Execute tool
                tool_result = execute_tool(tool_name, tool_args)

                # Add tool result to conversation
                messages.append({
                    'role': 'tool',
                    'tool_call_id': tool_call.get('id'),
                    'content': tool_result
                })
        else:
            # No tool calls - final answer
            content = message.get('content', '')
            print(f"[DeepSeek Agent] Success! Tokens: {total_tokens}, Iterations: {iteration}", file=sys.stderr)
            return content

    # Max iterations reached
    return f"[MAX ITERATIONS REACHED after {MAX_ITERATIONS} iterations]\n\nPartial result from last iteration:\n{message.get('content', 'No content')}"

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='DeepSeek Agent Runner')
    parser.add_argument('task', help='Task description')
    parser.add_argument('agent_type', nargs='?', default='analyst',
                       choices=['analyst', 'reviewer', 'researcher', 'coder'],
                       help='Agent type (default: analyst)')
    parser.add_argument('context', nargs='?', default=None,
                       help='Additional context')
    parser.add_argument('--model', default='deepseek-chat',
                       choices=['deepseek-chat', 'deepseek-reasoner'],
                       help='Model to use: deepseek-chat (tools+action) or deepseek-reasoner (pure logic)')

    args = parser.parse_args()

    result = run_agent(args.task, args.agent_type, args.context, model=args.model)
    print(result)
