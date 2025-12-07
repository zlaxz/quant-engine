#!/usr/bin/env python3
"""
Project State Synthesizer

Uses DeepSeek to analyze all recent conversations and memories
to generate a comprehensive project outline.
"""

import os
import sys
import json
from pathlib import Path
from datetime import datetime, timedelta
import openai

DEEPSEEK_API_KEY = os.environ.get('DEEPSEEK_API_KEY')
if not DEEPSEEK_API_KEY:
    print("Error: DEEPSEEK_API_KEY not set", file=sys.stderr)
    sys.exit(1)

client = openai.OpenAI(
    api_key=DEEPSEEK_API_KEY,
    base_url='https://api.deepseek.com'
)

def get_quant_engine_sessions(days: int = 1) -> list[Path]:
    """Find all quant-engine session files from last N days."""
    projects_dir = Path.home() / ".claude" / "projects"
    cutoff = datetime.now() - timedelta(days=days)

    sessions = []
    for jsonl in projects_dir.rglob("*.jsonl"):
        # Skip agent files
        if jsonl.name.startswith("agent-"):
            continue
        if ".working" in str(jsonl):
            continue

        # Must be quant-engine related
        if "quant-engine" not in str(jsonl).lower():
            continue

        # Check modification time
        mtime = datetime.fromtimestamp(jsonl.stat().st_mtime)
        if mtime > cutoff:
            sessions.append(jsonl)

    return sorted(sessions, key=lambda x: x.stat().st_mtime, reverse=True)


def extract_key_content(filepath: Path, max_chars: int = 50000) -> str:
    """Extract key conversation content from a session."""
    messages = []
    try:
        with open(filepath, 'r') as f:
            for line in f:
                try:
                    entry = json.loads(line.strip())
                    msg = entry.get('message', entry)

                    if not isinstance(msg, dict):
                        continue

                    role = msg.get('role', '')
                    content = msg.get('content', '')

                    # Only user and assistant text
                    if role not in ('user', 'assistant'):
                        continue

                    if isinstance(content, str) and content:
                        messages.append(f"[{role}]: {content[:3000]}")
                    elif isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and item.get('type') == 'text':
                                text = item.get('text', '')[:3000]
                                if text:
                                    messages.append(f"[{role}]: {text}")
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        print(f"Error reading {filepath}: {e}", file=sys.stderr)
        return ""

    full_text = "\n\n".join(messages)
    return full_text[:max_chars]


def synthesize_with_deepseek(conversations: list[str]) -> str:
    """Use DeepSeek to synthesize project state."""

    combined = "\n\n=== SESSION BREAK ===\n\n".join(conversations)

    prompt = """You are analyzing Claude Code conversation logs for the quant-engine project.

Your task: Create a COMPREHENSIVE PROJECT STATE DOCUMENT that will help anyone understand:
1. What this project IS (architecture, purpose, components)
2. What has been BUILT (working systems, features)
3. What is BROKEN or incomplete
4. What the VISION is (where it's going)
5. Key DECISIONS that were made
6. Current PRIORITIES

OUTPUT FORMAT:
```markdown
# Quant-Engine Project State
Generated: {date}

## 1. Project Identity
[What is this project? Who is it for? Core purpose?]

## 2. Architecture Overview
[System components, data flow, technology stack]

## 3. Working Systems (GREEN)
[List everything that's functional with brief descriptions]

## 4. Broken/Incomplete (RED)
[List what's not working or needs work]

## 5. Vision & Direction
[Where is this project going? What's the end goal?]

## 6. Key Technical Decisions
[Important choices that were made]

## 7. Immediate Priorities
[What should be done next, in order]

## 8. Critical Files/Locations
[Key files someone needs to know about]
```

Be SPECIFIC. Use actual file paths, component names, and details from the conversations.

CONVERSATIONS:
""" + combined

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=8000
        )
        return response.choices[0].message.content
    except Exception as e:
        return f"Error: {e}"


def main():
    print("Finding quant-engine sessions from last 24 hours...")
    sessions = get_quant_engine_sessions(days=1)

    if not sessions:
        print("No sessions found!")
        return

    print(f"Found {len(sessions)} sessions")

    # Extract content from each session
    conversations = []
    for i, session in enumerate(sessions[:10]):  # Limit to 10 most recent
        print(f"  [{i+1}] Reading {session.name[:40]}...")
        content = extract_key_content(session)
        if content:
            conversations.append(content)

    print(f"\nSynthesizing {len(conversations)} conversations with DeepSeek...")
    result = synthesize_with_deepseek(conversations)

    # Write output
    output_path = Path("/Users/zstoc/GitHub/quant-engine/.working/PROJECT_STATE_SYNTHESIS.md")
    output_path.parent.mkdir(exist_ok=True)

    with open(output_path, 'w') as f:
        f.write(result)

    print(f"\n{'='*60}")
    print(f"SYNTHESIS COMPLETE: {output_path}")
    print(f"{'='*60}")
    print(result)


if __name__ == "__main__":
    main()
