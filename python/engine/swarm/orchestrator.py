#!/usr/bin/env python3
"""
Swarm Orchestrator - Async DeepSeek Hive Mind Engine
=====================================================
Manages massive-scale DeepSeek swarms using async I/O.
Zero process overhead. 100% network bound.

This is the core engine that allows you to fire 50-500 requests
at once without crashing your machine.

Usage:
    from engine.swarm import run_swarm_sync

    tasks = [
        {"id": "agent_1", "system": "...", "user": "..."},
        {"id": "agent_2", "system": "...", "user": "..."},
    ]

    results = run_swarm_sync(tasks, concurrency=50)
"""

import asyncio
import aiohttp
import os
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

# DeepSeek API Configuration
DEEPSEEK_API_KEY = os.environ.get('DEEPSEEK_API_KEY')
DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'


class SwarmOrchestrator:
    """
    Manages massive-scale DeepSeek swarms using async I/O.
    Zero process overhead. 100% network bound.
    """

    def __init__(self, concurrency: int = 50, timeout: int = 300):
        """
        Initialize the Swarm Orchestrator.

        Args:
            concurrency: Maximum concurrent requests (default 50, max ~500)
            timeout: Request timeout in seconds (default 300 for reasoning models)
        """
        self.concurrency = concurrency
        self.timeout = timeout
        self.semaphore = asyncio.Semaphore(concurrency)

        if not DEEPSEEK_API_KEY:
            raise ValueError(
                "DEEPSEEK_API_KEY environment variable is required. "
                "Get your key at https://platform.deepseek.com/"
            )

    async def _dispatch_agent(
        self, session: aiohttp.ClientSession, task: Dict
    ) -> Dict:
        """
        Runs a single agent task asynchronously.

        Args:
            session: aiohttp session for connection pooling
            task: Dict with id, system, user, model, temperature

        Returns:
            Dict with id, status, content, reasoning, usage
        """
        async with self.semaphore:
            task_id = task.get('id', 'unknown')
            system_prompt = task.get(
                'system', "You are a helpful quantitative research assistant."
            )
            user_prompt = task.get('user', "")
            model = task.get('model', 'deepseek-reasoner')  # Default to R1
            temperature = task.get('temperature', 0.0)

            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "temperature": temperature,
                "stream": False
            }

            try:
                async with session.post(
                    DEEPSEEK_URL,
                    headers={
                        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                        "Content-Type": "application/json"
                    },
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=self.timeout)
                ) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"Agent {task_id} failed: API {response.status}")
                        return {
                            "id": task_id,
                            "status": "failed",
                            "error": f"API {response.status}: {error_text}"
                        }

                    data = await response.json()

                    # Handle DeepSeek response format
                    choice = data['choices'][0]
                    content = choice['message']['content']

                    # Capture reasoning chain if available (DeepSeek R1 feature)
                    reasoning = choice['message'].get('reasoning_content', None)

                    logger.info(f"Agent {task_id} completed successfully")
                    return {
                        "id": task_id,
                        "status": "success",
                        "content": content,
                        "reasoning": reasoning,
                        "model": model,
                        "usage": data.get('usage', {})
                    }

            except asyncio.TimeoutError:
                logger.error(f"Agent {task_id} timed out after {self.timeout}s")
                return {
                    "id": task_id,
                    "status": "failed",
                    "error": f"Timeout after {self.timeout}s"
                }
            except Exception as e:
                logger.error(f"Agent {task_id} exception: {e}")
                return {"id": task_id, "status": "failed", "error": str(e)}

    async def run_swarm(self, tasks: List[Dict]) -> List[Dict]:
        """
        Execute a list of tasks in parallel with throttled concurrency.

        Args:
            tasks: List of task dicts, each with:
                - id: Unique identifier for the task
                - system: System prompt
                - user: User prompt
                - model: (optional) deepseek-reasoner or deepseek-chat
                - temperature: (optional) 0.0-1.0

        Returns:
            List of result dicts with id, status, content, reasoning, usage
        """
        logger.info(f"Launching swarm of {len(tasks)} agents (concurrency={self.concurrency})")

        connector = aiohttp.TCPConnector(limit=self.concurrency)
        async with aiohttp.ClientSession(connector=connector) as session:
            futures = [self._dispatch_agent(session, task) for task in tasks]
            results = await asyncio.gather(*futures)

        success_count = sum(1 for r in results if r['status'] == 'success')
        logger.info(f"Swarm complete: {success_count}/{len(tasks)} successful")

        return results


def run_swarm_sync(tasks: List[Dict], concurrency: int = 50, timeout: int = 300) -> List[Dict]:
    """
    Synchronous wrapper for SwarmOrchestrator.run_swarm().

    This is the main entry point for non-async code.

    Args:
        tasks: List of task dicts (see SwarmOrchestrator.run_swarm)
        concurrency: Max concurrent requests (default 50)
        timeout: Request timeout in seconds (default 300)

    Returns:
        List of result dicts

    Example:
        tasks = [
            {"id": "math", "system": "Calculator", "user": "2+2"},
            {"id": "poet", "system": "Poet", "user": "Write haiku"},
        ]
        results = run_swarm_sync(tasks)
    """
    orchestrator = SwarmOrchestrator(concurrency=concurrency, timeout=timeout)
    return asyncio.run(orchestrator.run_swarm(tasks))
