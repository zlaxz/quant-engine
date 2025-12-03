#!/usr/bin/env python3
"""
Session Memory Extractor
========================
Parses Claude Code JSONL session files and extracts:
1. All user messages and requests
2. All architecture decisions made
3. All code files created/modified
4. All UI components promised
5. Key learnings and insights

Usage:
    python scripts/extract_session_memories.py <jsonl_file>
"""

import json
import sys
import re
from pathlib import Path
from datetime import datetime
from collections import defaultdict

def extract_memories(jsonl_path: str) -> dict:
    """Extract all memories from a JSONL session file."""

    memories = {
        "user_messages": [],
        "architecture_decisions": [],
        "files_modified": [],
        "ui_promises": [],
        "code_created": [],
        "key_learnings": [],
        "tool_calls": defaultdict(int),
        "errors_encountered": [],
        "migrations_created": [],
        "python_files": [],
        "typescript_files": [],
    }

    with open(jsonl_path, 'r') as f:
        for line_num, line in enumerate(f, 1):
            try:
                entry = json.loads(line.strip())
                process_entry(entry, memories)
            except json.JSONDecodeError as e:
                print(f"Warning: Could not parse line {line_num}: {e}")

    return memories

def process_entry(entry: dict, memories: dict):
    """Process a single JSONL entry."""

    msg_type = entry.get("type")

    # User messages
    if msg_type == "user":
        content = entry.get("message", {}).get("content", "")
        if isinstance(content, str) and len(content) > 10:
            memories["user_messages"].append({
                "content": content[:500],  # Truncate long messages
                "timestamp": entry.get("timestamp", "")
            })

    # Assistant messages with tool calls
    if msg_type == "assistant":
        message = entry.get("message", {})
        content = message.get("content", [])

        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    # Tool use
                    if block.get("type") == "tool_use":
                        tool_name = block.get("name", "unknown")
                        memories["tool_calls"][tool_name] += 1

                        # Track file modifications
                        if tool_name in ["Edit", "Write"]:
                            tool_input = block.get("input", {})
                            file_path = tool_input.get("file_path", "")
                            if file_path:
                                memories["files_modified"].append(file_path)

                                # Categorize by type
                                if file_path.endswith(".sql"):
                                    memories["migrations_created"].append(file_path)
                                elif file_path.endswith(".py"):
                                    memories["python_files"].append(file_path)
                                elif file_path.endswith(".tsx") or file_path.endswith(".ts"):
                                    memories["typescript_files"].append(file_path)

                    # Text content - look for architecture decisions
                    if block.get("type") == "text":
                        text = block.get("text", "")

                        # Look for architecture patterns
                        arch_patterns = [
                            r"(?:architecture|design|pattern).*?:",
                            r"(?:goal-seeking|mission|daemon)",
                            r"(?:red.?team|audit)",
                            r"(?:swarm|agent)",
                        ]
                        for pattern in arch_patterns:
                            if re.search(pattern, text, re.IGNORECASE):
                                # Extract surrounding context
                                matches = re.findall(r'.{0,100}' + pattern + r'.{0,200}', text, re.IGNORECASE)
                                for match in matches[:2]:  # Limit matches
                                    memories["architecture_decisions"].append(match.strip())

                        # Look for UI promises
                        ui_patterns = [
                            r"(?:build|create|add|implement).*?(?:ui|component|panel|dashboard|control)",
                            r"(?:mission.?control|progress.?bar|status.?display)",
                        ]
                        for pattern in ui_patterns:
                            if re.search(pattern, text, re.IGNORECASE):
                                matches = re.findall(r'.{0,50}' + pattern + r'.{0,100}', text, re.IGNORECASE)
                                for match in matches[:2]:
                                    memories["ui_promises"].append(match.strip())

def summarize_memories(memories: dict) -> str:
    """Create a summary of extracted memories."""

    summary = []
    summary.append("=" * 80)
    summary.append("SESSION MEMORY EXTRACTION REPORT")
    summary.append("=" * 80)
    summary.append("")

    # User messages
    summary.append(f"## USER MESSAGES ({len(memories['user_messages'])} total)")
    summary.append("-" * 40)
    for i, msg in enumerate(memories['user_messages'][:20], 1):
        content = msg['content'].replace('\n', ' ')[:200]
        summary.append(f"{i}. {content}...")
    summary.append("")

    # Files modified
    unique_files = list(set(memories['files_modified']))
    summary.append(f"## FILES MODIFIED ({len(unique_files)} unique)")
    summary.append("-" * 40)

    # Group by type
    summary.append("\n### SQL Migrations:")
    for f in set(memories['migrations_created']):
        summary.append(f"  - {f}")

    summary.append("\n### Python Files:")
    for f in set(memories['python_files']):
        summary.append(f"  - {f}")

    summary.append("\n### TypeScript/React Files:")
    for f in set(memories['typescript_files']):
        summary.append(f"  - {f}")
    summary.append("")

    # Tool calls
    summary.append(f"## TOOL USAGE")
    summary.append("-" * 40)
    for tool, count in sorted(memories['tool_calls'].items(), key=lambda x: -x[1]):
        summary.append(f"  {tool}: {count}")
    summary.append("")

    # Architecture decisions
    summary.append(f"## ARCHITECTURE DECISIONS ({len(memories['architecture_decisions'])} found)")
    summary.append("-" * 40)
    seen = set()
    for decision in memories['architecture_decisions'][:30]:
        clean = decision[:150].replace('\n', ' ')
        if clean not in seen:
            seen.add(clean)
            summary.append(f"  - {clean}")
    summary.append("")

    # UI Promises
    summary.append(f"## UI COMPONENTS PROMISED ({len(memories['ui_promises'])} found)")
    summary.append("-" * 40)
    seen = set()
    for promise in memories['ui_promises'][:20]:
        clean = promise[:150].replace('\n', ' ')
        if clean not in seen:
            seen.add(clean)
            summary.append(f"  - {clean}")
    summary.append("")

    return "\n".join(summary)

def extract_for_supabase(memories: dict) -> list:
    """Extract memories in format suitable for Supabase."""

    supabase_memories = []

    # Key architecture decisions
    if memories['migrations_created']:
        supabase_memories.append({
            "title": "Goal-Seeking Architecture: Database Schema",
            "content": f"Created {len(set(memories['migrations_created']))} SQL migrations for goal-seeking daemon architecture. Tables: missions (target tracking), mission_progress (historical snapshots), red_team_audits (strategy validation), mission_dispatches (swarm tracking). Includes RPC functions: get_active_mission(), check_mission_complete(), update_mission_progress(), record_red_team_audit().",
            "importance": 5,
            "tags": ["architecture", "supabase", "goal-seeking", "daemon"]
        })

    # Python changes
    python_files = list(set(memories['python_files']))
    if 'daemon.py' in str(python_files):
        supabase_memories.append({
            "title": "Goal-Seeking Daemon: Python Implementation",
            "content": "Modified daemon.py with goal-seeking methods: _autonomous_decision_engine() makes strategic swarm dispatch decisions, _dispatch_swarm() sends agents with appropriate focus, _evaluate_mission_progress() updates Supabase with results. Daemon now hunts mathematical targets (Sharpe > X) rather than just keeping pool full.",
            "importance": 5,
            "tags": ["daemon", "python", "goal-seeking", "autonomous"]
        })

    # UI gaps
    if memories['ui_promises']:
        supabase_memories.append({
            "title": "CRITICAL: UI Components NOT Built Despite Promises",
            "content": f"Session promised {len(memories['ui_promises'])} UI components but built ZERO. Missing: Mission Control panel, mission creation form, progress visualization, swarm dispatch history, red team audit results display. Backend infrastructure is useless without UI. This is a critical failure that must be addressed.",
            "importance": 5,
            "tags": ["ui", "missing", "critical", "valence:negative"]
        })

    return supabase_memories

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python extract_session_memories.py <jsonl_file>")
        sys.exit(1)

    jsonl_path = sys.argv[1]

    if not Path(jsonl_path).exists():
        print(f"Error: File not found: {jsonl_path}")
        sys.exit(1)

    print(f"Extracting memories from: {jsonl_path}")
    print(f"File size: {Path(jsonl_path).stat().st_size / 1024 / 1024:.2f} MB")
    print("")

    memories = extract_memories(jsonl_path)
    summary = summarize_memories(memories)
    print(summary)

    # Output Supabase-ready memories
    print("\n" + "=" * 80)
    print("SUPABASE-READY MEMORIES")
    print("=" * 80)
    for mem in extract_for_supabase(memories):
        print(f"\n### {mem['title']}")
        print(f"Importance: {mem['importance']}/5")
        print(f"Tags: {', '.join(mem['tags'])}")
        print(f"Content: {mem['content']}")
