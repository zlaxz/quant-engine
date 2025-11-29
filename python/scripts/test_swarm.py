#!/usr/bin/env python3
import sys
import os

# Add src to path
sys.path.append(os.getcwd())

from src.infrastructure.direct_swarm import DirectSwarm

def test_swarm():
    print("Initializing Swarm...")
    swarm = DirectSwarm()
    
    tasks = [
        {"id": "agent_math", "system": "You are a calculator.", "user": "Calculate 123 * 456"},
        {"id": "agent_poet", "system": "You are a poet.", "user": "Write a haiku about Python."},
        {"id": "agent_coder", "system": "You are a coder.", "user": "Print 'Hello World' in C++"}
    ]
    
    print(f"Dispatching {len(tasks)} agents to DeepSeek...")
    results = swarm.run_parallel(tasks)
    
    print("\n--- SWARM RESULTS ---")
    for r in results:
        print(f"ID: {r['id']}")
        print(f"STATUS: {r['status']}")
        if r['status'] == 'SUCCESS':
            print(f"USAGE: {r['usage']}")
            print(f"CONTENT: {r['content'][:50]}...") # Truncate for display
        else:
            print(f"ERROR: {r.get('error')}")
        print("-" * 20)

if __name__ == "__main__":
    test_swarm()
