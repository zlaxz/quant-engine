#!/usr/bin/env python3
"""
Swarm Synthesizer - MapReduce for AI Agent Output
==================================================
Collapses N agent reports into 1 actionable executive summary.

The Problem: 50 agents generate 50 pages of output. Reading them all
makes YOU the bottleneck.

The Solution: Hierarchical synthesis.
- Layer 1 (Grunts): N DeepSeek agents generate raw findings
- Layer 2 (Officers): Batch findings into chunks, summarize each
- Layer 3 (General): Merge summaries into executive brief

Usage:
    from engine.swarm.synthesizer import synthesize_findings

    # After running a swarm
    results = run_swarm_sync(tasks)
    findings = [r['content'] for r in results if r['status'] == 'success']

    # Collapse 50 reports into 1 memo
    executive_summary = synthesize_findings(findings, topic="Strategy Audit")
"""

import os
import logging
from typing import List, Optional
from .orchestrator import run_swarm_sync

logger = logging.getLogger(__name__)

# Synthesis prompts
OFFICER_PROMPT = """You are a research analyst consolidating findings from multiple junior analysts.

**Your Task:**
Review these {count} reports on "{topic}" and extract:
1. The 3-5 most critical findings (things that could cause real problems)
2. Any consensus views (issues mentioned by multiple analysts)
3. Contradictions or disagreements between analysts
4. Actionable recommendations

**Output Format:**
## Critical Findings
- [finding 1]
- [finding 2]
...

## Consensus Views
- [view 1]
...

## Contradictions
- [if any]

## Recommendations
1. [action 1]
2. [action 2]
...

Be concise. No fluff. Focus on what matters."""

GENERAL_PROMPT = """You are the Chief Research Officer writing an executive brief for the CEO.

**Your Task:**
You have received summaries from {count} research teams analyzing "{topic}".
Write a single executive brief that:

1. Opens with the ONE most important finding (the thing that could hurt us)
2. Lists the top 5 prioritized action items
3. Flags any critical disagreements that need human judgment
4. Ends with a GO/NO-GO recommendation

**Format:**
# Executive Brief: {topic}

## Critical Alert
[The single most important finding]

## Priority Actions
1. [Highest priority]
2. [Second priority]
...

## Requires Human Judgment
- [Any unresolved disagreements]

## Recommendation
[GO / NO-GO / CONDITIONAL with brief rationale]

---
Be direct. No corporate speak. What would you tell your family?"""


def chunk_list(lst: List, chunk_size: int) -> List[List]:
    """Split a list into chunks of specified size."""
    return [lst[i:i + chunk_size] for i in range(0, len(lst), chunk_size)]


def synthesize_findings(
    findings: List[str],
    topic: str,
    chunk_size: int = 10,
    officer_model: str = "deepseek-chat",
    general_model: str = "deepseek-chat",
    concurrency: int = 10
) -> str:
    """
    Collapse N agent findings into 1 executive summary using MapReduce.

    Args:
        findings: List of raw findings/reports from agents
        topic: What these findings are about (e.g., "Strategy XYZ Audit")
        chunk_size: How many findings per "officer" agent (default 10)
        officer_model: Model for mid-level synthesis (default deepseek-chat)
        general_model: Model for final synthesis (default deepseek-chat)
        concurrency: Max concurrent API calls

    Returns:
        Executive summary string
    """
    if not findings:
        return f"# Executive Brief: {topic}\n\nNo findings to synthesize."

    logger.info(f"Synthesizing {len(findings)} findings on '{topic}'")

    # If only a few findings, skip to general
    if len(findings) <= chunk_size:
        logger.info("Few findings - direct synthesis")
        combined = "\n\n---\n\n".join(findings)
        return _run_general(combined, topic, len(findings), general_model)

    # LAYER 2: Officers summarize chunks
    chunks = chunk_list(findings, chunk_size)
    logger.info(f"Layer 2: {len(chunks)} officer agents summarizing chunks")

    officer_tasks = []
    for i, chunk in enumerate(chunks):
        combined_chunk = "\n\n---\n\n".join(chunk)
        officer_tasks.append({
            "id": f"officer_{i+1}",
            "system": OFFICER_PROMPT.format(count=len(chunk), topic=topic),
            "user": f"Here are the {len(chunk)} analyst reports:\n\n{combined_chunk}",
            "model": officer_model,
            "temperature": 0.3
        })

    officer_results = run_swarm_sync(officer_tasks, concurrency=concurrency)

    # Extract successful summaries
    officer_summaries = []
    for r in officer_results:
        if r['status'] == 'success':
            officer_summaries.append(r['content'])
        else:
            logger.warning(f"Officer {r['id']} failed: {r.get('error')}")

    if not officer_summaries:
        return f"# Executive Brief: {topic}\n\nSynthesis failed - all officers failed."

    # LAYER 3: General creates executive brief
    logger.info(f"Layer 3: General synthesizing {len(officer_summaries)} officer reports")
    combined_summaries = "\n\n===\n\n".join(officer_summaries)

    return _run_general(combined_summaries, topic, len(officer_summaries), general_model)


def _run_general(content: str, topic: str, count: int, model: str) -> str:
    """Run the general (final synthesis) agent."""
    general_task = [{
        "id": "general",
        "system": GENERAL_PROMPT.format(count=count, topic=topic),
        "user": f"Here are the team summaries:\n\n{content}",
        "model": model,
        "temperature": 0.2
    }]

    results = run_swarm_sync(general_task, concurrency=1)

    if results[0]['status'] == 'success':
        return results[0]['content']
    else:
        logger.error(f"General synthesis failed: {results[0].get('error')}")
        return f"# Executive Brief: {topic}\n\nFinal synthesis failed: {results[0].get('error')}"


def synthesize_with_reasoning(
    findings: List[str],
    topic: str,
    chunk_size: int = 5
) -> dict:
    """
    Like synthesize_findings but uses deepseek-reasoner and returns
    both the summary and the reasoning chains.

    Returns:
        {
            "summary": "...",
            "officer_reasoning": [...],
            "general_reasoning": "..."
        }
    """
    if not findings:
        return {
            "summary": f"# Executive Brief: {topic}\n\nNo findings.",
            "officer_reasoning": [],
            "general_reasoning": None
        }

    chunks = chunk_list(findings, chunk_size)
    logger.info(f"Synthesizing {len(findings)} findings with reasoning chains")

    # Officers with reasoning
    officer_tasks = []
    for i, chunk in enumerate(chunks):
        combined_chunk = "\n\n---\n\n".join(chunk)
        officer_tasks.append({
            "id": f"officer_{i+1}",
            "system": OFFICER_PROMPT.format(count=len(chunk), topic=topic),
            "user": f"Analyze these reports:\n\n{combined_chunk}",
            "model": "deepseek-reasoner",
            "temperature": 0.0
        })

    officer_results = run_swarm_sync(officer_tasks, concurrency=10)

    officer_summaries = []
    officer_reasoning = []
    for r in officer_results:
        if r['status'] == 'success':
            officer_summaries.append(r['content'])
            if r.get('reasoning'):
                officer_reasoning.append({
                    "id": r['id'],
                    "reasoning": r['reasoning']
                })

    # General with reasoning
    combined = "\n\n===\n\n".join(officer_summaries)
    general_task = [{
        "id": "general",
        "system": GENERAL_PROMPT.format(count=len(officer_summaries), topic=topic),
        "user": f"Synthesize:\n\n{combined}",
        "model": "deepseek-reasoner",
        "temperature": 0.0
    }]

    general_result = run_swarm_sync(general_task, concurrency=1)[0]

    return {
        "summary": general_result.get('content', 'Synthesis failed'),
        "officer_reasoning": officer_reasoning,
        "general_reasoning": general_result.get('reasoning')
    }
