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
from datetime import datetime

DEEPSEEK_API_KEY = os.environ.get('DEEPSEEK_API_KEY')

# Global repair tracking - collects all edit_file operations for reporting
REPAIR_LOG = []
DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'

# Agent prompts
AGENT_PROMPTS = {
    'analyst': 'You are a data analyst. Analyze thoroughly and provide specific insights.',
    'reviewer': 'You are a code reviewer. Find bugs, suggest improvements, cite line numbers.',
    'researcher': 'You are a researcher. Investigate thoroughly and provide evidence.',
    'coder': 'You are a coder. Write clean, tested code following best practices.',
    'fixer': '''You are a bug fixer. Your job is to FIX bugs by EDITING FILES, not just reporting them.

You have 6 tool calls. Use them in READ→EDIT pairs:
- Call 1: read_file to see the code
- Call 2: edit_file to make the fix
- Call 3: read_file to verify (if needed)
- Call 4: edit_file for second fix (if needed)
- Calls 5-6: Additional read/edit if needed

CRITICAL RULES:
1. You MUST call edit_file to actually fix the code. Recommendations alone = FAILURE.
2. edit_file requires UNIQUE old_string - copy 3-5 lines of surrounding context
3. Make MINIMAL changes - only what the task describes
4. After your edit, report SUCCESS or FAILURE with details

Example edit_file call:
{
  "path": "/path/to/file.py",
  "old_string": "    # existing comment\\n    problematic_line = something\\n    next_line = other",
  "new_string": "    # existing comment\\n    # FIX: Added guard for edge case\\n    if edge_case:\\n        return safe_value\\n    fixed_line = something\\n    next_line = other"
}''',
    'auditor_fixer': '''You are an AUDIT-AND-FIX agent. You audit code for bugs, then FIX them immediately.

PHASE 1 - AUDIT (calls 1-3):
1. Read the file
2. Search for specific bug patterns (division by zero, NaN handling, empty arrays)
3. Note each issue with line numbers

PHASE 2 - FIX (calls 4-10):
For each bug found:
1. Use edit_file with UNIQUE old_string (copy 3-5 lines of context)
2. Make MINIMAL changes - only fix the bug
3. Read to verify if needed

BUG PATTERNS TO CHECK:
- Division by zero (division without checking denominator)
- Empty array operations (np.mean, np.std, etc. on empty)
- NaN propagation (missing np.isfinite checks)
- Log domain errors (log of zero or negative)
- Bounds violations (probabilities outside [0,1])
- Type mismatches (mixing int/float unsafely)

FINAL REPORT must include:
- Issues found (with line numbers)
- Issues fixed (with what was changed)
- Issues NOT fixed (and why)

Recommendations alone = FAILURE. You MUST use edit_file to fix bugs.''',
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
            "name": "edit_file",
            "description": "Edit a file by replacing old_string with new_string. The old_string must be UNIQUE in the file - include enough context (surrounding lines) to make it unique. Always read the file first to verify the exact string to replace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file to edit (absolute path)"},
                    "old_string": {"type": "string", "description": "The exact string to replace (must be unique in file, include context lines if needed)"},
                    "new_string": {"type": "string", "description": "The new string to insert in place of old_string"}
                },
                "required": ["path", "old_string", "new_string"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write content to a file (creates or overwrites). Use sparingly - prefer edit_file for modifications.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file to write (absolute path)"},
                    "content": {"type": "string", "description": "Complete content to write to the file"}
                },
                "required": ["path", "content"]
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

# FIX_ONLY_TOOLS - Only edit_file available during fix phase
# This forces the model to use edit_file instead of wasting iterations on search_code
FIX_ONLY_TOOLS = [AGENT_TOOLS[1]]  # edit_file only

def call_deepseek(messages: list, max_tokens: int = 4000, tools: list = None, model: str = 'deepseek-chat', tool_choice: str = 'auto') -> dict:
    """Direct HTTP call to DeepSeek API using curl (avoids SSL issues)

    Args:
        messages: Conversation history
        max_tokens: Max tokens to generate
        tools: List of tool definitions
        model: Model to use
        tool_choice: 'auto' (model decides) or 'required' (FORCE tool call)
                     CRITICAL: DeepSeek's 'auto' mode is BROKEN - it always returns text.
                     Use 'required' to force the model to actually call tools.
    """
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
        # 'required' forces model to call tools, 'auto' lets it skip (but auto is BROKEN)
        # Per vLLM forums: "tool_choice: auto always returns text, required works"
        payload_dict['tool_choice'] = tool_choice

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

        elif tool_name == 'edit_file':
            path = args.get('path', '')
            old_string = args.get('old_string', '')
            new_string = args.get('new_string', '')

            if not os.path.exists(path):
                REPAIR_LOG.append({
                    'file': path,
                    'status': 'FAILED',
                    'error': 'File not found',
                    'timestamp': datetime.now().isoformat()
                })
                return f"Error: File not found: {path}"
            if not old_string:
                REPAIR_LOG.append({
                    'file': path,
                    'status': 'FAILED',
                    'error': 'old_string is required',
                    'timestamp': datetime.now().isoformat()
                })
                return "Error: old_string is required"

            with open(path, 'r') as f:
                content = f.read()

            # Check uniqueness - must occur exactly once
            count = content.count(old_string)
            if count == 0:
                REPAIR_LOG.append({
                    'file': path,
                    'status': 'FAILED',
                    'error': 'old_string not found in file',
                    'old_string_preview': old_string[:100] + '...' if len(old_string) > 100 else old_string,
                    'timestamp': datetime.now().isoformat()
                })
                return f"Error: old_string not found in file. Make sure you copied it exactly (including whitespace)."
            if count > 1:
                REPAIR_LOG.append({
                    'file': path,
                    'status': 'FAILED',
                    'error': f'old_string appears {count} times',
                    'timestamp': datetime.now().isoformat()
                })
                return f"Error: old_string appears {count} times. Include more context to make it unique."

            # Perform replacement
            new_content = content.replace(old_string, new_string)

            with open(path, 'w') as f:
                f.write(new_content)

            # Log successful repair
            REPAIR_LOG.append({
                'file': path,
                'status': 'SUCCESS',
                'old_chars': len(old_string),
                'new_chars': len(new_string),
                'old_string_preview': old_string[:100] + '...' if len(old_string) > 100 else old_string,
                'new_string_preview': new_string[:100] + '...' if len(new_string) > 100 else new_string,
                'timestamp': datetime.now().isoformat()
            })

            return f"Successfully edited {path}. Replaced {len(old_string)} chars with {len(new_string)} chars."

        elif tool_name == 'write_file':
            path = args.get('path', '')
            content = args.get('content', '')

            if not path:
                return "Error: path is required"

            # Create directory if needed
            directory = os.path.dirname(path)
            if directory and not os.path.exists(directory):
                os.makedirs(directory, exist_ok=True)

            with open(path, 'w') as f:
                f.write(content)

            return f"Successfully wrote {len(content)} chars to {path}"

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
    # auditor_fixer: 10 tool calls (3 audit + 7 fix), fixer: 6 tool calls, others: 3
    agent_lower = agent_type.lower()
    is_auditor_fixer = agent_lower == 'auditor_fixer'
    is_fixer = agent_lower == 'fixer'
    if is_auditor_fixer:
        MAX_ITERATIONS = 12  # 10 tools + nudge + final
        NUDGE_AT = 11
    elif is_fixer:
        MAX_ITERATIONS = 8   # 6 tools + nudge + final
        NUDGE_AT = 7
    else:
        MAX_ITERATIONS = 6   # 3 tools + nudge + 2
        NUDGE_AT = 4
    iteration = 0
    total_tokens = 0

    while iteration < MAX_ITERATIONS:
        iteration += 1

        # PHASE-BASED TOOL_CHOICE - The key to making DeepSeek actually call edit_file
        # Per vLLM forums: "tool_choice: auto is BROKEN, required works"
        # - fixer: ALWAYS use 'required' - they MUST call edit_file
        # - auditor_fixer: iterations 1-3 = 'auto' (audit/read), iterations 4+ = 'required' (fix/edit)
        # - others: 'auto' (default for read-only audit agents)
        if is_fixer:
            current_tool_choice = 'required'  # Fixer MUST call edit_file
        elif is_auditor_fixer:
            if iteration <= 3:
                current_tool_choice = 'auto'  # Audit phase: read/search
            else:
                current_tool_choice = 'required'  # Fix phase: FORCE edit_file
        else:
            current_tool_choice = 'auto'  # Default for analysts/reviewers

        # PHASE-BASED MODEL SELECTION - Combine model strengths
        # - auditor_fixer: iterations 1-3 = deepseek-reasoner (better reasoning for finding bugs)
        #                  iterations 4+ = deepseek-chat (better tool execution for fixing)
        # - others: use whatever model was passed in
        if is_auditor_fixer:
            if iteration <= 3:
                current_model = 'deepseek-reasoner'  # Superior logical analysis for audit
            else:
                current_model = 'deepseek-chat'  # Reliable tool execution for fixes
        else:
            current_model = model  # Use the model parameter for other agent types

        # Log will show tools after selection
        tools_desc = "FIX_ONLY" if (is_auditor_fixer and iteration > 3) else "ALL"
        print(f"[DeepSeek Agent] Iteration {iteration}/{MAX_ITERATIONS} (fixer={is_fixer}, model={current_model}, tools={tools_desc}, tool_choice={current_tool_choice})...", file=sys.stderr)

        # PHASE TRANSITION NUDGE for auditor_fixer - tell it audit is done, now FIX
        if is_auditor_fixer and iteration == 4:
            messages.append({
                'role': 'user',
                'content': 'PHASE TRANSITION: Audit phase is COMPLETE. You have analyzed the code. NOW you must FIX the bugs using edit_file. Call edit_file with the exact old_string and new_string to apply fixes. Do NOT search_code or read_file anymore - use edit_file NOW.'
            })

        # Forceful nudge - time to write final report
        if iteration == NUDGE_AT:
            messages.append({
                'role': 'user',
                'content': 'STOP. You have made 3 tool calls. NO MORE TOOL CALLS ALLOWED. Write your complete audit report NOW using the format: ## Summary, ## Findings (CRITICAL/HIGH/MEDIUM/LOW), ## Recommendations. Do not call any more tools.'
            })

        # PHASE-BASED TOOL SELECTION - Restrict tools during fix phase
        # auditor_fixer iteration > 3: Only edit_file available (no search_code distractions)
        if is_auditor_fixer and iteration > 3:
            current_tools = FIX_ONLY_TOOLS  # Force edit_file only
        else:
            current_tools = AGENT_TOOLS

        result = call_deepseek(messages, tools=current_tools, model=current_model, tool_choice=current_tool_choice)

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
            fix_succeeded = False
            for tool_call in tool_calls:
                if tool_call.get('type') != 'function':
                    continue

                func = tool_call.get('function', {})
                tool_name = func.get('name')
                tool_args = json.loads(func.get('arguments', '{}'))

                print(f"[DeepSeek Agent]   → {tool_name}({json.dumps(tool_args)[:50]}...)", file=sys.stderr)

                # Execute tool
                tool_result = execute_tool(tool_name, tool_args)

                # Track successful edit_file in fix phase
                if tool_name == 'edit_file' and 'Successfully edited' in tool_result:
                    fix_succeeded = True

                # Add tool result to conversation
                messages.append({
                    'role': 'tool',
                    'tool_call_id': tool_call.get('id'),
                    'content': tool_result
                })

            # EARLY EXIT: If we're in fix phase and edit succeeded, we're done!
            print(f"[DeepSeek Agent] DEBUG: Early exit check: is_auditor_fixer={is_auditor_fixer}, iteration={iteration}, fix_succeeded={fix_succeeded}", file=sys.stderr)
            if is_auditor_fixer and iteration > 3 and fix_succeeded:
                print(f"[DeepSeek Agent] Fix applied successfully! Exiting fix phase.", file=sys.stderr)
                return f"[FIX COMPLETE] Successfully applied fix in iteration {iteration}. Tokens: {total_tokens}"
        else:
            # No tool calls - final answer
            content = message.get('content', '')
            print(f"[DeepSeek Agent] Success! Tokens: {total_tokens}, Iterations: {iteration}", file=sys.stderr)
            return content

    # Max iterations reached
    return f"[MAX ITERATIONS REACHED after {MAX_ITERATIONS} iterations]\n\nPartial result from last iteration:\n{message.get('content', 'No content')}"


def write_repair_report(task: str, agent_type: str, model: str):
    """Write a structured JSON repair report if any edits were attempted."""
    if not REPAIR_LOG:
        return None  # No edits attempted, no report needed

    # Create reports directory
    reports_dir = os.path.join(os.path.dirname(__file__), 'reports')
    os.makedirs(reports_dir, exist_ok=True)

    # Generate unique filename with timestamp
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    # Extract bug ID from task if present (e.g., "FIX ENT_R8_5" -> "ENT_R8_5")
    bug_id = 'unknown'
    if 'FIX' in task:
        parts = task.split()
        for i, part in enumerate(parts):
            if part == 'FIX' and i + 1 < len(parts):
                bug_id = parts[i + 1].rstrip(':')
                break

    filename = f"repair_{bug_id}_{timestamp}.json"
    filepath = os.path.join(reports_dir, filename)

    # Calculate summary stats
    successes = sum(1 for r in REPAIR_LOG if r['status'] == 'SUCCESS')
    failures = sum(1 for r in REPAIR_LOG if r['status'] == 'FAILED')

    report = {
        'timestamp': datetime.now().isoformat(),
        'task': task,
        'agent_type': agent_type,
        'model': model,
        'summary': {
            'total_edits': len(REPAIR_LOG),
            'successes': successes,
            'failures': failures,
            'status': 'COMPLETE' if successes > 0 and failures == 0 else 'PARTIAL' if successes > 0 else 'FAILED'
        },
        'edits': REPAIR_LOG
    }

    with open(filepath, 'w') as f:
        json.dump(report, f, indent=2)

    print(f"[DeepSeek Agent] Repair report written to: {filepath}", file=sys.stderr)
    return filepath


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='DeepSeek Agent Runner')
    parser.add_argument('task', help='Task description')
    parser.add_argument('agent_type', nargs='?', default='analyst',
                       choices=['analyst', 'reviewer', 'researcher', 'coder', 'fixer', 'auditor_fixer'],
                       help='Agent type (default: analyst)')
    parser.add_argument('context', nargs='?', default=None,
                       help='Additional context')
    parser.add_argument('--model', default='deepseek-chat',
                       choices=['deepseek-chat', 'deepseek-reasoner'],
                       help='Model to use: deepseek-chat (tools+action) or deepseek-reasoner (pure logic)')

    args = parser.parse_args()

    # Auto-route model based on agent type
    # - fixer/auditor_fixer: deepseek-chat (better at following tool-calling instructions)
    # - analyst/reviewer/researcher: deepseek-reasoner (deeper reasoning)
    if args.agent_type in ('fixer', 'auditor_fixer') and args.model == 'deepseek-reasoner':
        print(f"[DeepSeek Agent] Note: Overriding model to deepseek-chat for {args.agent_type} agent (better tool execution)", file=sys.stderr)
        args.model = 'deepseek-chat'

    result = run_agent(args.task, args.agent_type, args.context, model=args.model)
    print(result)

    # Write repair report for fixer agents
    if args.agent_type in ('fixer', 'auditor_fixer'):
        write_repair_report(args.task, args.agent_type, args.model)
