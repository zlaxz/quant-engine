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

def call_deepseek(messages: list, max_tokens: int = 4000) -> dict:
    """Direct HTTP call to DeepSeek API using curl (avoids SSL issues)"""
    if not DEEPSEEK_API_KEY:
        return {'error': 'DEEPSEEK_API_KEY not set in environment'}

    payload = json.dumps({
        'model': 'deepseek-chat',
        'messages': messages,
        'temperature': 0.3,
        'max_tokens': max_tokens
    })

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

def run_agent(task: str, agent_type: str = 'analyst', context: str = None) -> str:
    """Run a DeepSeek agent with the given task"""

    system_prompt = AGENT_PROMPTS.get(agent_type.lower(), AGENT_PROMPTS['analyst'])

    user_message = task
    if context:
        user_message = f"{task}\n\n## Context:\n{context}"

    messages = [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': user_message}
    ]

    print(f"[DeepSeek Agent] Type: {agent_type}", file=sys.stderr)
    print(f"[DeepSeek Agent] Task: {task[:100]}...", file=sys.stderr)
    print(f"[DeepSeek Agent] Calling API...", file=sys.stderr)

    result = call_deepseek(messages)

    if 'error' in result:
        return f"ERROR: {result['error']}"

    if 'choices' in result and len(result['choices']) > 0:
        content = result['choices'][0]['message']['content']
        tokens = result.get('usage', {}).get('total_tokens', 'unknown')
        print(f"[DeepSeek Agent] Success! Tokens: {tokens}", file=sys.stderr)
        return content

    return f"ERROR: Unexpected response format: {json.dumps(result)}"

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
