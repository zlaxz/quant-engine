#!/usr/bin/env python3
"""
Swarm Test Script
=================
Quick test to verify the DeepSeek swarm orchestrator is working.

Usage:
    cd python/
    python scripts/test_swarm.py

Requires:
    DEEPSEEK_API_KEY environment variable
"""

import sys
import os
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.swarm import run_swarm_sync


def test_swarm():
    """Run a simple swarm test with 3 agents."""
    print("=" * 60)
    print("SWARM TEST - DeepSeek Parallel Agent Execution")
    print("=" * 60)

    # Check for API key
    if not os.environ.get('DEEPSEEK_API_KEY'):
        print("\nError: DEEPSEEK_API_KEY environment variable not set")
        print("Get your key at https://platform.deepseek.com/")
        sys.exit(1)

    print("\nInitializing test swarm with 3 agents...")

    tasks = [
        {
            "id": "agent_math",
            "system": "You are a calculator. Return only the numeric answer.",
            "user": "Calculate 123 * 456",
            "model": "deepseek-chat",
            "temperature": 0.0
        },
        {
            "id": "agent_poet",
            "system": "You are a poet. Write only the haiku, nothing else.",
            "user": "Write a haiku about algorithmic trading.",
            "model": "deepseek-chat",
            "temperature": 0.7
        },
        {
            "id": "agent_analyst",
            "system": "You are a risk analyst. Be concise.",
            "user": "What's the main risk of a momentum strategy in 3 sentences?",
            "model": "deepseek-chat",
            "temperature": 0.3
        }
    ]

    print(f"Dispatching {len(tasks)} agents to DeepSeek...")
    print("-" * 40)

    try:
        results = run_swarm_sync(tasks, concurrency=10)
    except ValueError as e:
        print(f"\nConfiguration Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nSwarm Error: {e}")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("SWARM RESULTS")
    print("=" * 60)

    success_count = 0
    total_tokens = 0

    for r in results:
        print(f"\n--- Agent: {r['id']} ---")
        print(f"Status: {r['status'].upper()}")

        if r['status'] == 'success':
            success_count += 1
            usage = r.get('usage', {})
            tokens = usage.get('total_tokens', 0)
            total_tokens += tokens

            print(f"Model: {r.get('model', 'unknown')}")
            print(f"Tokens: {tokens}")
            print(f"Response:\n{r['content']}")

            if r.get('reasoning'):
                print(f"(Has reasoning chain: {len(r['reasoning'])} chars)")
        else:
            print(f"Error: {r.get('error', 'Unknown error')}")

    print("\n" + "=" * 60)
    print(f"SUMMARY: {success_count}/{len(tasks)} agents succeeded")
    print(f"Total tokens used: {total_tokens}")
    print("=" * 60)

    if success_count == len(tasks):
        print("\nSwarm test PASSED - All agents operational")
        return True
    else:
        print("\nSwarm test FAILED - Some agents did not respond")
        return False


if __name__ == "__main__":
    success = test_swarm()
    sys.exit(0 if success else 1)
