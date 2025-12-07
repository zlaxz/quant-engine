#!/usr/bin/env python3
"""
UX Design Team - 5 agents debate and design the quant-engine UI/UX

Agents:
- agent_a: UX Designer (ADHD-focused, external memory, zero friction)
- agent_b: Gamification Expert (RPG narrator, exploration, progression)
- agent_c: Trading UX Specialist (positions, orders, kill switches, safety)
- agent_d: Educational Designer (explaining concepts, learning by doing)
- agent_e: Technical Architect (React/Electron/JARVIS constraints)

Usage:
    python scripts/design_team_ux.py
"""

import sys
import os
import asyncio
import json
from pathlib import Path

# Add the scripts path for team_orchestrator
sys.path.insert(0, os.path.expanduser("~/.claude/scripts"))
from team_orchestrator import Team

PROJECT_ID = "quant-engine-ux-v2"

# The vision from Zach
VISION = """
## User Vision (Zach)

**Who I am**: ADHD user who wants to see cool shit happen and have a mode that prints money.
I BARELY understand half the concepts - this needs to be educational, not just shiny lights.
The visual is for UNDERSTANDING what's going on, not decoration.

**Two Main Paths**:
1. Active Trading - real money, real positions, kill switches
2. Discovery Testing - research mode, backtesting, finding alpha

**JARVIS Concept**:
- Claude works in CLI terminal doing the actual work
- UI is an "observatory" that displays what Claude is doing in real-time
- Collaborative work environment where Claude updates visualizations while I watch
- Communication system for Claude to visually walk me through every process

**RPG Gamification**:
- Like a role-playing game with Claude as narrator
- We navigate the market physics together
- 3D renderings of market maps highlighting causal effects
- Audio narration possibility to explain things as they happen

**Automation Goals**:
- FULLY AUTOMATIC from the beginning
- Obvious human override and kill switches
- Start with micro positions (1 contract) to test
- Build full scope over time

**Current Tech**:
- React + Electron app (multi-window capable)
- JARVIS event pipeline (emit_ui_event → ClaudeCodeResultWatcher → React)
- Supabase for persistent memory
- DeepSeek for agent swarms
- ThetaData/Schwab for live data (stubs exist)
"""

AGENT_ROLES = {
    "agent_a": {
        "name": "Alex (UX Designer)",
        "focus": """You are the UX Designer specializing in ADHD-friendly interfaces.

Your expertise:
- External memory systems (the UI should remember, not the user)
- Zero-friction workflows (no memorizing, no slash commands, just Cmd+K)
- Visible state (always show what's happening, no hidden modes)
- Interruption survival (can leave and come back without losing context)
- Minimal decision fatigue (smart defaults, few choices)

Your job: Ensure every screen reduces cognitive load, not adds it.
Challenge others if their ideas require memorization or hidden states."""
    },
    "agent_b": {
        "name": "Blake (Gamification Expert)",
        "focus": """You are the Gamification Expert focusing on RPG-style engagement.

Your expertise:
- Narrative design (Claude as dungeon master/narrator)
- Progression systems (leveling up trading skills)
- Exploration mechanics (discovering market physics)
- Achievement systems (milestones, unlocks)
- Emotional engagement through story

Your job: Make this feel like an adventure, not a spreadsheet.
The market is the dungeon. Physics equations are spells. Profits are loot.
Challenge others if their ideas are boring or feel like work."""
    },
    "agent_c": {
        "name": "Casey (Trading UX)",
        "focus": """You are the Trading UX Specialist focusing on safety and execution.

Your expertise:
- Kill switches (panic buttons that WORK)
- Position management (always visible, always interruptible)
- Risk visualization (never hide danger)
- Order entry (fast but safe)
- Regulatory compliance (audit trails, confirmations)

Your job: Ensure nobody loses their shirt due to bad UX.
Every trade should have clear confirmation. Emergency stops must be instant.
Challenge others if their ideas could lead to accidental losses."""
    },
    "agent_d": {
        "name": "Dana (Educational Designer)",
        "focus": """You are the Educational Designer focusing on understanding.

Your expertise:
- Concept visualization (make Greeks intuitive, not scary)
- Learn-by-doing (don't explain, SHOW)
- Progressive disclosure (simple first, complexity on demand)
- Just-in-time learning (explain when relevant, not upfront)
- Metaphor design (physics = market, equations = rules)

Your job: Make someone who "barely understands half the concepts" feel empowered.
If Zach can't understand it in 5 seconds, it's too complex.
Challenge others if their ideas require prior knowledge."""
    },
    "agent_e": {
        "name": "Eli (Technical Architect)",
        "focus": """You are the Technical Architect who knows what's buildable.

Your expertise:
- React/Electron architecture (multi-window, IPC)
- JARVIS event pipeline (emit_ui_event → ClaudeCodeResultWatcher → React)
- State management (what lives where)
- Performance (60fps animations, real-time updates)
- Integration constraints (what APIs exist, what's missing)

Your job: Ground the team in reality.
Beautiful ideas are worthless if they can't be built.
Challenge others if their ideas are technically infeasible or would take 6 months."""
    }
}


async def setup_team(team: Team):
    """Assign roles to all agents."""
    print("\n🎭 Setting up design team...\n")

    for agent_id, role in AGENT_ROLES.items():
        team.assign(agent_id, role["focus"], name=role["name"])
        print(f"  ✓ {role['name']} assigned")

    # Share the vision with everyone
    team.share("vision", VISION, added_by="zach")
    print("\n  📋 Shared vision with team")


async def run_design_round(team: Team, round_num: int, prompt: str) -> dict:
    """Run a round where all agents respond to a prompt."""
    print(f"\n{'='*60}")
    print(f"ROUND {round_num}: {prompt[:50]}...")
    print(f"{'='*60}\n")

    results = {}

    for agent_id in AGENT_ROLES.keys():
        role = AGENT_ROLES[agent_id]
        print(f"\n💭 {role['name']} thinking...")

        result = await team.work(
            agent_id=agent_id,
            task=prompt,
            model="deepseek-chat",
            include_memory=True,
            include_project_context=True,
            tools=["read_file", "list_directory"],
            working_dir="/Users/zstoc/GitHub/quant-engine"
        )

        results[agent_id] = result
        print(f"\n📝 {role['name']}:\n{result[:500]}...")

        # Store as finding
        team.remember(agent_id, "round_output", f"Round {round_num}: {result[:1000]}")

    return results


async def run_synthesis(team: Team, round_results: list) -> str:
    """Have agent_a synthesize all rounds into a coherent design doc."""
    print(f"\n{'='*60}")
    print("SYNTHESIS: Creating unified design document...")
    print(f"{'='*60}\n")

    # Collect all outputs
    all_outputs = []
    for i, results in enumerate(round_results):
        all_outputs.append(f"\n## Round {i+1} Outputs:\n")
        for agent_id, output in results.items():
            name = AGENT_ROLES[agent_id]["name"]
            all_outputs.append(f"\n### {name}:\n{output}\n")

    synthesis_prompt = f"""
You are the lead synthesizer. Your team has completed {len(round_results)} rounds of design discussion.

Here is everything they said:
{''.join(all_outputs)}

Your task:
1. Synthesize this into a SINGLE coherent UX design document
2. Resolve any conflicts between agents (explain why you chose one approach)
3. Create an actionable specification that developers can build from

Output format:
# Quant Engine UX Design Spec v2

## 1. Core Philosophy
(What principles guide every decision)

## 2. Information Architecture
(What screens exist, how they connect)

## 3. Screen Specifications
(For each screen: purpose, components, interactions)

## 4. JARVIS Communication Protocol
(How Claude talks to the UI, event types, visualization patterns)

## 5. Safety & Kill Switches
(How we prevent catastrophic losses)

## 6. Gamification Layer
(RPG elements, progression, narrative)

## 7. Educational Overlays
(How we teach concepts in-context)

## 8. Technical Implementation Notes
(Key constraints, architecture decisions)

## 9. Open Questions
(What still needs user input)

Make it comprehensive but readable. This is the blueprint.
"""

    result = await team.work(
        agent_id="agent_a",
        task=synthesis_prompt,
        model="deepseek-chat",
        include_memory=True,
        include_project_context=True,
        tools=["write_file"],
        working_dir="/Users/zstoc/GitHub/quant-engine"
    )

    return result


async def main():
    print("""
╔═══════════════════════════════════════════════════════════════╗
║         QUANT ENGINE UX DESIGN TEAM                           ║
║         5 DeepSeek Agents Designing Together                  ║
╚═══════════════════════════════════════════════════════════════╝
    """)

    team = Team(PROJECT_ID)

    # Setup
    await setup_team(team)

    # Round 1: Initial Ideas
    round1 = await run_design_round(team, 1, """
Based on the vision shared, propose your initial ideas for the UX.

Consider:
- The two paths (Active Trading vs Discovery Testing)
- The JARVIS concept (Claude working in CLI, UI as observatory)
- Your specific expertise area

Output your top 3-5 ideas with rationale. Be specific, not vague.
""")

    # Round 2: Critique and Build
    round2 = await run_design_round(team, 2, """
Review what other agents proposed in Round 1 (in project context).

For each other agent's ideas:
1. What do you LOVE about it?
2. What concerns you from your expertise area?
3. How would you improve it?

Then propose 2-3 NEW ideas that address the gaps you see.
""")

    # Round 3: Converge on Screens
    round3 = await run_design_round(team, 3, """
Now let's get concrete. Based on Rounds 1 and 2, propose:

1. What are the EXACT screens/windows we need?
2. For each screen, what components are on it?
3. How does the user flow between screens?
4. What JARVIS events trigger what visualizations?

Be specific enough that a developer could start building tomorrow.
Use your expertise to detail YOUR area deeply.
""")

    # Synthesis
    design_doc = await run_synthesis(team, [round1, round2, round3])

    # Save the design doc
    output_path = "/Users/zstoc/GitHub/quant-engine/.working/UX_DESIGN_SPEC_v2.md"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        f.write(design_doc)

    print(f"\n\n✅ Design spec saved to: {output_path}")
    print("\n" + "="*60)
    print("DESIGN DOC PREVIEW:")
    print("="*60)
    print(design_doc[:2000] + "...\n")

    # Show team status
    status = team.status()
    print("\n📊 Final Team Status:")
    for agent in status["agents"]:
        print(f"  {agent['name']}: {agent['status']}")


if __name__ == "__main__":
    asyncio.run(main())
