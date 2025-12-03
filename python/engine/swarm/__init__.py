"""
Hive Mind Swarm Module
======================
Massive-scale parallel agent execution using DeepSeek API.

Components:
- SwarmOrchestrator: Async engine for 50-500 concurrent requests
- run_swarm_sync: Synchronous wrapper for easy integration

Usage:
    from engine.swarm import run_swarm_sync

    tasks = [
        {"id": "agent_1", "system": "You are a quant.", "user": "Analyze this..."},
        {"id": "agent_2", "system": "You are a risk manager.", "user": "Review this..."},
    ]

    results = run_swarm_sync(tasks, concurrency=50)
"""

from .orchestrator import SwarmOrchestrator, run_swarm_sync

__all__ = ['SwarmOrchestrator', 'run_swarm_sync']
