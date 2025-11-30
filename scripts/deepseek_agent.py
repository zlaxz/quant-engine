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
    }
]

def call_deepseek(messages: list, max_tokens: int = 4000, tools: list = None) -> dict:
    """Direct HTTP call to DeepSeek API using curl (avoids SSL issues)"""
    if not DEEPSEEK_API_KEY:
        return {'error': 'DEEPSEEK_API_KEY not set in environment'}

    payload_dict = {
        'model': 'deepseek-chat',
        'messages': messages,
        'temperature': 0.3,
        'max_tokens': max_tokens
    }

    # Add tools if provided (CRITICAL for file access)
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
                # Truncate very long files
                if len(content) > 50000:
                    return content[:50000] + f"\n\n[Truncated - file is {len(content)} bytes]"
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
                ['grep', '-r', '-n', pattern, search_path],
                capture_output=True,
                text=True,
                timeout=30
            )
            return result.stdout if result.stdout else 'No matches found'

        else:
            return f"Error: Unknown tool {tool_name}"

    except Exception as e:
        return f"Error executing {tool_name}: {str(e)}"


def run_agent(task: str, agent_type: str = 'analyst', context: str = None) -> str:
    """Run a DeepSeek agent with FULL TOOL ACCESS using agentic loop"""

    system_prompt = AGENT_PROMPTS.get(agent_type.lower(), AGENT_PROMPTS['analyst'])

    # CRITICAL: Emphasize tool usage
    system_prompt += """

IMPORTANT: You have FULL TOOL ACCESS. Before answering, USE YOUR TOOLS:
- read_file: Read any file you need to examine
- list_directory: Explore codebase structure
- search_code: Find patterns in code

DO NOT make assumptions. READ THE ACTUAL CODE using your tools, then provide analysis based on what you ACTUALLY SAW."""

    user_message = task
    if context:
        user_message = f"{task}\n\n## Context:\n{context}"

    messages = [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': user_message}
    ]

    print(f"[DeepSeek Agent] Type: {agent_type}", file=sys.stderr)
    print(f"[DeepSeek Agent] Task: {task[:100]}...", file=sys.stderr)

    # AGENTIC LOOP - iterate until agent gives final answer (no more tool calls)
    MAX_ITERATIONS = 20  # Increased for thorough audits
    iteration = 0
    total_tokens = 0

    while iteration < MAX_ITERATIONS:
        iteration += 1
        print(f"[DeepSeek Agent] Iteration {iteration}/{MAX_ITERATIONS}...", file=sys.stderr)

        result = call_deepseek(messages, tools=AGENT_TOOLS)

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
    if len(sys.argv) < 2:
        print("Usage: python deepseek_agent.py 'task' [agent_type] [context]")
        print("Agent types: analyst, reviewer, researcher, coder")
        sys.exit(1)

    task = sys.argv[1]
    agent_type = sys.argv[2] if len(sys.argv) > 2 else 'analyst'
    context = sys.argv[3] if len(sys.argv) > 3 else None

    result = run_agent(task, agent_type, context)
    print(result)
