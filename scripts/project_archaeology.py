#!/usr/bin/env python3
"""
Project Archaeology Framework
==============================
Parses conversation history to extract the TRUE state of a project.

Reads BOTH user and assistant messages to find:
- Architectural pivots
- Key decisions
- What to focus on
- What to ignore (noise)
- Synthesized understandings

Usage:
    python scripts/project_archaeology.py [--days 3] [--output report.md]

This creates a reusable framework for any project cleanup.
"""

import json
import os
import re
import argparse
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple

# =============================================================================
# Configuration
# =============================================================================

# Keywords that indicate pivotal moments
PIVOT_KEYWORDS = [
    # User frustration/direction
    "pivot", "abandon", "stop doing", "ignore", "focus on", "backward",
    "actually", "real", "should be", "wrong", "not what", "frustrated",
    "confused", "chaos", "noise", "off-track", "distracted",
    # Direction changes
    "let's", "we should", "from now on", "going forward", "the plan is",
    "forget about", "don't need", "waste of time",
]

# Keywords in assistant messages that indicate synthesized understanding
SYNTHESIS_KEYWORDS = [
    "so the architecture is", "here's what we're building", "the focus is",
    "to summarize", "the clear path", "what we're doing", "the actual",
    "i understand now", "the pivot", "the direction", "what's working",
    "what's broken", "noise to ignore", "do not", "prohibition",
]

# Keywords indicating decisions
DECISION_KEYWORDS = [
    "decision:", "decided to", "we're going with", "the approach is",
    "implemented", "built", "created", "added", "removed", "deprecated",
    "superseded", "replaced with",
]


@dataclass
class Message:
    """A single message from a conversation."""
    role: str  # 'user' or 'assistant'
    content: str
    timestamp: Optional[datetime] = None
    file_source: str = ""


@dataclass
class PivotalMoment:
    """A pivotal moment extracted from conversations."""
    quote: str
    role: str
    keyword_matched: str
    context: str  # surrounding messages
    file_source: str
    importance: str = "medium"  # low, medium, high, critical


@dataclass
class ProjectState:
    """Synthesized project state from archaeology."""
    current_focus: List[str] = field(default_factory=list)
    prohibitions: List[str] = field(default_factory=list)
    noise_files: List[str] = field(default_factory=list)
    key_decisions: List[str] = field(default_factory=list)
    pivotal_moments: List[PivotalMoment] = field(default_factory=list)
    architecture_summary: str = ""
    assistant_syntheses: List[str] = field(default_factory=list)


# =============================================================================
# Conversation Parsing
# =============================================================================

def find_conversation_files(project_path: str, days: int = 3) -> List[Path]:
    """Find all conversation JSONL files from the last N days."""
    # Claude Code stores conversations in ~/.claude/projects/-path-to-project/
    project_path = os.path.abspath(project_path)
    encoded_path = project_path.replace("/", "-")
    if encoded_path.startswith("-"):
        encoded_path = encoded_path  # keep leading dash

    claude_projects = Path.home() / ".claude" / "projects"
    project_dir = claude_projects / encoded_path

    if not project_dir.exists():
        # Try finding it
        for d in claude_projects.iterdir():
            if project_path.split("/")[-1] in d.name:
                project_dir = d
                break

    if not project_dir.exists():
        print(f"Could not find conversation directory for {project_path}")
        return []

    cutoff = datetime.now() - timedelta(days=days)
    files = []

    for f in project_dir.glob("*.jsonl"):
        # Skip agent files (sub-conversations)
        if f.name.startswith("agent-"):
            continue

        mtime = datetime.fromtimestamp(f.stat().st_mtime)
        size = f.stat().st_size

        # Only substantial conversations (>100KB)
        if mtime > cutoff and size > 100_000:
            files.append((mtime, f))

    # Sort by modification time, newest first
    files.sort(reverse=True)
    return [f for _, f in files]


def parse_conversation(file_path: Path) -> List[Message]:
    """Parse a JSONL conversation file into messages."""
    messages = []

    with open(file_path, 'r') as f:
        for line in f:
            try:
                msg = json.loads(line)
                role = msg.get('type')

                if role not in ['user', 'assistant']:
                    continue

                # Extract content
                content = msg.get('message', {})
                if isinstance(content, dict):
                    content = content.get('content', '')
                if isinstance(content, list):
                    # Handle content blocks
                    texts = []
                    for block in content:
                        if isinstance(block, dict):
                            if 'text' in block:
                                texts.append(block['text'])
                    content = ' '.join(texts)

                if not isinstance(content, str) or len(content) < 20:
                    continue

                # Skip system/continuation messages
                if 'Session End Protocol' in content:
                    continue
                if 'being continued from a previous' in content and len(content) > 5000:
                    # This is a summary, might be useful but mark it
                    pass

                messages.append(Message(
                    role=role,
                    content=content,
                    file_source=file_path.name
                ))

            except json.JSONDecodeError:
                continue

    return messages


# =============================================================================
# Pivotal Moment Extraction
# =============================================================================

def find_pivotal_moments(messages: List[Message]) -> List[PivotalMoment]:
    """Find pivotal moments in conversations."""
    moments = []

    for i, msg in enumerate(messages):
        content_lower = msg.content.lower()

        # Check for pivot keywords
        for keyword in PIVOT_KEYWORDS:
            if keyword in content_lower:
                # Get context (surrounding messages)
                context_start = max(0, i - 2)
                context_end = min(len(messages), i + 3)
                context = "\n".join([
                    f"[{m.role.upper()}]: {m.content[:200]}..."
                    for m in messages[context_start:context_end]
                ])

                # Extract the relevant snippet
                # Find sentence containing keyword
                sentences = re.split(r'[.!?]\s+', msg.content)
                quote = ""
                for s in sentences:
                    if keyword in s.lower():
                        quote = s.strip()[:500]
                        break

                if not quote:
                    quote = msg.content[:500]

                # Determine importance
                importance = "medium"
                if any(k in content_lower for k in ["abandon", "pivot", "wrong", "backward"]):
                    importance = "critical"
                elif any(k in content_lower for k in ["focus on", "the plan is", "going forward"]):
                    importance = "high"

                moments.append(PivotalMoment(
                    quote=quote,
                    role=msg.role,
                    keyword_matched=keyword,
                    context=context,
                    file_source=msg.file_source,
                    importance=importance
                ))
                break  # One moment per message

        # Check for synthesis keywords (assistant only)
        if msg.role == 'assistant':
            for keyword in SYNTHESIS_KEYWORDS:
                if keyword in content_lower:
                    quote = msg.content[:800]
                    moments.append(PivotalMoment(
                        quote=quote,
                        role=msg.role,
                        keyword_matched=keyword,
                        context="",
                        file_source=msg.file_source,
                        importance="high"
                    ))
                    break

    return moments


def extract_assistant_syntheses(messages: List[Message]) -> List[str]:
    """Extract assistant's synthesized understandings."""
    syntheses = []

    patterns = [
        r"(?:so |to summarize|here's what|the (?:clear |actual )?(?:path|focus|architecture) is)[:\s]+([^.]+\.(?:[^.]+\.)?)",
        r"(?:we're building|the system is|this project is)[:\s]+([^.]+\.(?:[^.]+\.)?)",
        r"(?:noise to ignore|do not|prohibitions?)[:\s]+([^.]+\.(?:[^.]+\.)?)",
    ]

    for msg in messages:
        if msg.role != 'assistant':
            continue

        for pattern in patterns:
            matches = re.findall(pattern, msg.content.lower())
            for match in matches:
                if len(match) > 50:
                    syntheses.append(match.strip())

    return syntheses[:20]  # Limit


def extract_noise_files(messages: List[Message]) -> List[str]:
    """Extract files mentioned as noise/ignore."""
    noise_files = []

    noise_patterns = [
        r"(?:noise|ignore|don't use|off-track|wrong)[:\s]+[`\"]?([a-zA-Z0-9_/]+\.py)[`\"]?",
        r"([a-zA-Z0-9_/]+\.py)[`\"]?\s*(?:#\s*)?(?:noise|ignore)",
    ]

    for msg in messages:
        content = msg.content
        for pattern in noise_patterns:
            matches = re.findall(pattern, content, re.IGNORECASE)
            noise_files.extend(matches)

    return list(set(noise_files))


def extract_prohibitions(messages: List[Message]) -> List[str]:
    """Extract explicit prohibitions."""
    prohibitions = []

    patterns = [
        r"(?:do not|don't|never|stop)[:\s]+([^.!?\n]+)",
        r"(?:prohibition|forbidden|banned)[:\s]+([^.!?\n]+)",
    ]

    for msg in messages:
        if msg.role != 'assistant':
            continue

        for pattern in patterns:
            matches = re.findall(pattern, msg.content, re.IGNORECASE)
            for match in matches:
                if len(match) > 20 and len(match) < 200:
                    prohibitions.append(match.strip())

    return list(set(prohibitions))[:15]


# =============================================================================
# Report Generation
# =============================================================================

def generate_report(state: ProjectState, output_path: Optional[str] = None) -> str:
    """Generate a markdown report of findings."""

    report = []
    report.append("# Project Archaeology Report")
    report.append(f"\n**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"**Pivotal Moments Found:** {len(state.pivotal_moments)}")
    report.append("")

    # Critical moments
    critical = [m for m in state.pivotal_moments if m.importance == "critical"]
    if critical:
        report.append("## Critical Pivots Found")
        report.append("")
        for m in critical[:10]:
            report.append(f"### [{m.role.upper()}] - {m.keyword_matched}")
            report.append(f"> {m.quote[:400]}...")
            report.append(f"\n*Source: {m.file_source}*")
            report.append("")

    # High importance
    high = [m for m in state.pivotal_moments if m.importance == "high"]
    if high:
        report.append("## Key Decisions/Directions")
        report.append("")
        for m in high[:15]:
            report.append(f"### [{m.role.upper()}] - {m.keyword_matched}")
            report.append(f"> {m.quote[:300]}...")
            report.append("")

    # Assistant syntheses
    if state.assistant_syntheses:
        report.append("## Assistant's Synthesized Understanding")
        report.append("")
        for s in state.assistant_syntheses[:10]:
            report.append(f"- {s}")
        report.append("")

    # Noise files
    if state.noise_files:
        report.append("## Files Identified as Noise")
        report.append("")
        for f in state.noise_files:
            report.append(f"- `{f}`")
        report.append("")

    # Prohibitions
    if state.prohibitions:
        report.append("## Extracted Prohibitions")
        report.append("")
        for p in state.prohibitions:
            report.append(f"- {p}")
        report.append("")

    report_text = "\n".join(report)

    if output_path:
        with open(output_path, 'w') as f:
            f.write(report_text)
        print(f"Report written to {output_path}")

    return report_text


# =============================================================================
# Main
# =============================================================================

def run_archaeology(project_path: str, days: int = 3, output: Optional[str] = None) -> ProjectState:
    """Run full archaeology on a project."""

    print(f"Running archaeology on {project_path}")
    print(f"Looking back {days} days")
    print("")

    # Find conversations
    files = find_conversation_files(project_path, days)
    print(f"Found {len(files)} conversation files")

    if not files:
        print("No conversations found!")
        return ProjectState()

    # Parse all conversations
    all_messages = []
    for f in files:
        print(f"  Parsing {f.name} ({f.stat().st_size // 1024}KB)")
        messages = parse_conversation(f)
        all_messages.extend(messages)

    print(f"\nTotal messages: {len(all_messages)}")
    print(f"  User: {len([m for m in all_messages if m.role == 'user'])}")
    print(f"  Assistant: {len([m for m in all_messages if m.role == 'assistant'])}")
    print("")

    # Extract pivotal moments
    moments = find_pivotal_moments(all_messages)
    print(f"Pivotal moments found: {len(moments)}")
    print(f"  Critical: {len([m for m in moments if m.importance == 'critical'])}")
    print(f"  High: {len([m for m in moments if m.importance == 'high'])}")
    print("")

    # Extract other data
    syntheses = extract_assistant_syntheses(all_messages)
    noise_files = extract_noise_files(all_messages)
    prohibitions = extract_prohibitions(all_messages)

    # Build state
    state = ProjectState(
        pivotal_moments=moments,
        assistant_syntheses=syntheses,
        noise_files=noise_files,
        prohibitions=prohibitions,
    )

    # Generate report
    report = generate_report(state, output)
    print("\n" + "="*60)
    print(report)

    return state


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Project Archaeology Framework")
    parser.add_argument("--days", type=int, default=3, help="Days to look back")
    parser.add_argument("--output", type=str, help="Output file for report")
    parser.add_argument("--project", type=str, default=".", help="Project path")

    args = parser.parse_args()

    project = os.path.abspath(args.project)
    run_archaeology(project, args.days, args.output)
