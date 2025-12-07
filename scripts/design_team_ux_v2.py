#!/usr/bin/env python3
"""
UX Design Team v2 - Multi-round debate with Reasoner + Chat

Key Insight from Zach:
- DISCOVERY/BACKTESTING: Narrative storytelling (flexible, not a rigid game)
- LIVE TRADING: Crystal clear, crisp, informative (NO gamification, understand WHAT + WHY)

Uses:
- deepseek-reasoner for creative ideation
- deepseek-chat for critique/refinement
- Multiple passes with iteration

Agents:
- agent_a: UX Designer (ADHD-focused)
- agent_b: Narrative Designer (storytelling for discovery, NOT games)
- agent_c: Trading UX Specialist (clarity for live trading)
- agent_d: Educational Designer (understanding concepts)
- agent_e: Technical Architect (React/Electron/JARVIS)
"""

import sys
import os
import asyncio
import json
from pathlib import Path
from datetime import datetime

sys.path.insert(0, os.path.expanduser("~/.claude/scripts"))
from team_orchestrator import Team

PROJECT_ID = "quant-engine-ux-v2"
OUTPUT_DIR = "/Users/zstoc/GitHub/quant-engine/.working"

# Research findings to feed to agents
RESEARCH_FINDINGS = """
## Trading Platform UX Research (2024-2025)

### Industry Best Practices
- Global online trading platform market: $10.15B in 2024, growing to $16.71B by 2032
- Key principle: Seamless, not overcomplicated experience
- Coinbase success: Simplicity - not cluttered with unnecessary options
- Robinhood: Clean, minimalist, mobile-first, educational resources integrated
- Thinkorswim: Feature-rich but overwhelming for beginners
- Tastytrade: Bold colors, game-like feel, but intuitive order entry

### ADHD-Friendly Design Principles
- External memory systems: "Free up mental energy, reduce background anxiety"
- Visual progress: Checkmarks, timelines, gentle gamification for motivation
- Time blindness: Never cover the device clock, remind users of time spent
- Auto-save: Seamless resume capability after distraction
- Low distraction: Uncluttered layouts, engagement features that don't overwhelm
- Task prioritization: AI can reduce decision fatigue by showing "what to work on next"

### Gamification Stats (for Discovery mode)
- 48% increase in user engagement with gamified platforms
- 22% boost in customer retention
- Habitica model: Daily tasks as RPG quests, leveling up
- Narrative frameworks: Give users sense of purpose and progression
- BUT: 71% of users abandon apps within 90 days - must be meaningful, not gimmicky

### Trading Platform Comparison
- Thinkorswim: Advanced charting, complex, steep learning curve
- Tastytrade: Simplified options focus, intuitive order entry
- Common issue: Both have steep learning curves for beginners
- Key insight: Tom Sosnoff founded BOTH - understood options traders need power + usability
"""

# The vision with Zach's clarification
VISION = """
## User Vision (Zach)

**Who I am**: ADHD user who wants to see cool shit happen and have a mode that prints money.
I BARELY understand half the concepts - this needs to be educational, not just shiny lights.
The visual is for UNDERSTANDING what's going on, not decoration.

**CRITICAL DISTINCTION**:

### Discovery/Backtesting Mode
- NARRATIVE STORYTELLING: Claude weaves a story around the work
- NOT a rigid game - flexible, exploratory, educational
- Make it engaging but don't trap me in game mechanics
- Visualize the journey of discovery, not points/levels
- Help me understand WHY patterns matter, not just that they exist

### Live Trading Mode
- CRYSTAL CLEAR: No gamification, no playfulness
- I need to know WHAT is happening at all times
- I need to know WHY it is happening at all times
- Visually informative but serious - real money is at stake
- Safety first: Kill switches, confirmations, risk visualization
- Understanding over entertainment

**Two Main Paths**:
1. Active Trading - real money, real positions, clear and crisp
2. Discovery Testing - research mode, narrative-driven, exploratory

**JARVIS Concept**:
- Claude works in CLI terminal doing the actual work
- UI is an "observatory" that displays what Claude is doing in real-time
- Collaborative work environment where Claude updates visualizations
- Communication system for Claude to visually walk me through every process

**Automation Goals**:
- FULLY AUTOMATIC from the beginning
- Obvious human override and kill switches
- Start with micro positions (1 contract) to test
- Build full scope over time
"""

AGENT_ROLES = {
    "agent_a": {
        "name": "Alex (UX Lead)",
        "focus": """You are the UX Lead specializing in ADHD-friendly interfaces.

Your expertise:
- External memory systems (UI remembers so user doesn't have to)
- Zero-friction workflows (Cmd+K, no memorization)
- Visible state (always show what's happening)
- Interruption survival (context preserved across sessions)
- Minimal decision fatigue (smart defaults)

CRITICAL RESPONSIBILITY: Ensure the TWO MODES feel completely different:
- Discovery = Exploratory, narrative, engaging
- Trading = Clear, crisp, serious, safe

You are the final arbiter of UX decisions."""
    },
    "agent_b": {
        "name": "Blake (Narrative Designer)",
        "focus": """You are the Narrative Designer for DISCOVERY MODE ONLY.

Your expertise:
- Storytelling that makes data exploration engaging
- Claude as narrator explaining what's being discovered
- Visualizing the journey of research, not gamifying it
- Making complex market physics intuitive through metaphor
- Progress through understanding, not points/levels

CRITICAL CONSTRAINT: You do NOT touch Trading Mode.
Your narratives must be flexible - user isn't "playing a game",
they're exploring with Claude as a guide who tells the story of what's found.

Examples of good narrative:
- "We're now looking at how gamma exposure shifted last Tuesday..."
- "This pattern reminds me of what happened in March 2020..."
- "Notice how the skew is telling us something about dealer positioning..."

NOT acceptable:
- "Quest complete! +50 XP!"
- "Level up! You've unlocked the Gamma Module!"
- Rigid game mechanics that trap the user"""
    },
    "agent_c": {
        "name": "Casey (Trading UX)",
        "focus": """You are the Trading UX Specialist for LIVE TRADING MODE ONLY.

Your expertise:
- Kill switches that ALWAYS work instantly
- Position visibility (never hidden, always current)
- Risk visualization (danger is OBVIOUS)
- Order entry (fast but confirmed)
- Audit trails (everything is logged)

CRITICAL PRINCIPLES:
1. WHAT is happening - always visible, always clear
2. WHY it's happening - context for every action/position
3. NO gamification - this is real money, treat it seriously
4. Clarity over beauty - if it's unclear, it's wrong
5. Interruptible - any action can be stopped/reversed

The user said: "that should actually be very clear and crisp while still
being visually informative, i always want to know what is going on and WHY"

Your screens should answer at a glance:
- What positions do I have?
- Why do I have them?
- What is my risk?
- How do I get out if needed?
- What is the system doing right now?"""
    },
    "agent_d": {
        "name": "Dana (Educational Designer)",
        "focus": """You are the Educational Designer for both modes.

Your expertise:
- Making Greeks intuitive (not scary formulas)
- Progressive disclosure (simple first, detail on demand)
- Just-in-time learning (explain when relevant)
- Visual explanations over text
- Market physics as intuitive concepts

CRITICAL INSIGHT: Zach said "I BARELY understand half the concepts"

Your job:
- In Discovery: Explain what Claude found and why it matters
- In Trading: Explain why a position exists and what the risk means

You bridge the gap between "data the system sees" and "understanding the user needs".

Good education:
- "This is dealer gamma - when it's positive, dealers are hedging in ways that stabilize price"
- [Visual showing flow arrows]

Bad education:
- "Gamma = ∂²V/∂S² represents the rate of change of delta"
- Long text explanations that require reading"""
    },
    "agent_e": {
        "name": "Eli (Tech Architect)",
        "focus": """You are the Technical Architect who knows what's buildable.

Your expertise:
- React/Electron multi-window architecture
- JARVIS event pipeline (emit_ui_event → ClaudeCodeResultWatcher → React)
- State management patterns
- Performance (60fps, real-time updates)
- What APIs exist vs what's missing

CRITICAL CONSTRAINTS:
- JARVIS events come FROM Python scripts running in Claude Code
- UI is an OBSERVER, not the driver
- Multi-window for 4 monitors must work
- Real-time updates without lag

You ground ideas in reality. If something would take 6 months, say so.
If something is easy, say so. Propose alternatives when ideas are infeasible.

Current stack:
- React + TypeScript
- Electron (multi-window capable)
- Supabase (memory/state)
- Python backend (Flask API)
- JARVIS bridge (emit_ui_event writes JSON, watcher reads it)"""
    }
}


async def run_phase(team: Team, phase_name: str, prompt: str, model: str = "deepseek-chat") -> dict:
    """Run a phase where all agents respond."""
    print(f"\n{'='*70}")
    print(f"PHASE: {phase_name}")
    print(f"Model: {model}")
    print(f"{'='*70}\n")

    results = {}
    for agent_id, role in AGENT_ROLES.items():
        print(f"\n{'─'*50}")
        print(f"  {role['name']} thinking...")

        try:
            result = await team.work(
                agent_id=agent_id,
                task=prompt,
                model=model,
                include_memory=True,
                include_project_context=True,
                tools=["read_file", "list_directory", "search_code"],
                working_dir="/Users/zstoc/GitHub/quant-engine"
            )
            results[agent_id] = result
            # Show first 600 chars
            preview = result[:600].replace('\n', '\n    ')
            print(f"    {preview}...")
            team.remember(agent_id, "phase_output", f"{phase_name}: {result[:2000]}")
        except Exception as e:
            print(f"    ERROR: {e}")
            results[agent_id] = f"Error: {e}"

    return results


async def run_critique(team: Team, round_num: int, prior_outputs: dict) -> dict:
    """Agents critique each other's work."""
    print(f"\n{'='*70}")
    print(f"CRITIQUE ROUND {round_num}")
    print(f"{'='*70}\n")

    # Format prior outputs for context
    context = "\n\n".join([
        f"### {AGENT_ROLES[aid]['name']}:\n{output}"
        for aid, output in prior_outputs.items()
    ])

    results = {}
    for agent_id, role in AGENT_ROLES.items():
        print(f"\n{'─'*50}")
        print(f"  {role['name']} critiquing...")

        prompt = f"""Review what the other agents proposed:

{context}

Your task:
1. What do you AGREE with from others?
2. What CONCERNS you from your expertise?
3. What would you CHANGE or ADD?

Be constructive but honest. If something won't work, say why.
Focus on your area of expertise."""

        try:
            result = await team.work(
                agent_id=agent_id,
                task=prompt,
                model="deepseek-chat",  # Chat for critique
                include_memory=True,
                include_project_context=True,
                tools=None,  # No tools for critique
                working_dir="/Users/zstoc/GitHub/quant-engine"
            )
            results[agent_id] = result
            preview = result[:400].replace('\n', '\n    ')
            print(f"    {preview}...")
        except Exception as e:
            print(f"    ERROR: {e}")
            results[agent_id] = f"Error: {e}"

    return results


async def synthesize(team: Team, all_phases: list) -> str:
    """Synthesize everything into final spec."""
    print(f"\n{'='*70}")
    print("FINAL SYNTHESIS")
    print(f"{'='*70}\n")

    # Compile all outputs
    full_context = []
    for i, (phase_name, outputs) in enumerate(all_phases):
        full_context.append(f"\n## {phase_name}\n")
        for agent_id, output in outputs.items():
            name = AGENT_ROLES[agent_id]["name"]
            full_context.append(f"\n### {name}:\n{output}\n")

    synthesis_prompt = f"""You are synthesizing a full UX design specification.

The team has gone through multiple rounds of ideation and critique:
{''.join(full_context)}

Create the FINAL specification document with these sections:

# Quant Engine UX Design Specification

## 1. Core Philosophy
- The two-mode distinction (Discovery vs Trading)
- ADHD-friendly principles applied
- How Claude and UI work together

## 2. Discovery Mode (Narrative-Driven Research)
- Screen layout and components
- How Claude narrates discoveries
- Visualization types for exploration
- How user interacts with findings

## 3. Trading Mode (Clear & Crisp Execution)
- Screen layout and components
- Position visibility requirements
- Kill switches and safety
- Risk visualization
- Why-tracking for every position

## 4. JARVIS Communication Protocol
- Event types from Python → UI
- How Claude updates visualizations
- Real-time update patterns

## 5. Educational Layer
- How concepts are explained
- Visual explanations vs text
- Just-in-time learning triggers

## 6. Technical Implementation
- Component architecture
- State management approach
- Multi-window coordination
- Performance requirements

## 7. Resolved Debates
- Key decisions made and why
- Trade-offs acknowledged

## 8. Open Questions for Zach
- Things that need user input

Make this a document that developers can actually build from.
Be specific about components, layouts, and interactions.
"""

    result = await team.work(
        agent_id="agent_a",  # UX Lead synthesizes
        task=synthesis_prompt,
        model="deepseek-reasoner",  # Reasoner for synthesis
        include_memory=True,
        include_project_context=True,
        tools=["write_file"],
        working_dir="/Users/zstoc/GitHub/quant-engine"
    )

    return result


async def main():
    print("""
╔═══════════════════════════════════════════════════════════════════════╗
║         QUANT ENGINE UX DESIGN TEAM v2                                 ║
║         Multi-Round: Reasoner Ideation + Chat Critique                 ║
╚═══════════════════════════════════════════════════════════════════════╝
    """)

    team = Team(PROJECT_ID)

    # Share context with team
    print("\n📋 Sharing research and vision with team...")
    team.share("research", RESEARCH_FINDINGS, added_by="claude")
    team.share("vision", VISION, added_by="zach")

    # Assign roles
    print("\n🎭 Assigning roles...")
    for agent_id, role in AGENT_ROLES.items():
        team.assign(agent_id, role["focus"], name=role["name"])
        print(f"  ✓ {role['name']}")

    all_phases = []

    # Phase 1: Reasoner Ideation - Big Picture
    phase1 = await run_phase(
        team,
        "Phase 1: Big Picture Ideation",
        """Using the research and vision shared with you, propose your initial ideas.

Focus on:
1. The TWO-MODE distinction (Discovery = narrative, Trading = clarity)
2. What screens/windows are needed?
3. How does your expertise area apply?

Think BIG first. Be creative. We'll refine later.
Output 3-5 concrete ideas with rationale.""",
        model="deepseek-reasoner"  # Reasoner for creative ideation
    )
    all_phases.append(("Phase 1: Big Picture", phase1))

    # Phase 2: Chat Critique
    critique1 = await run_critique(team, 1, phase1)
    all_phases.append(("Critique Round 1", critique1))

    # Phase 3: Reasoner - Screen Designs
    phase3 = await run_phase(
        team,
        "Phase 3: Screen Specifications",
        """Based on Phase 1 and the critique, now get SPECIFIC about screens.

For YOUR area of expertise, define:
1. What exact screens/windows exist?
2. What components are on each screen?
3. What JARVIS events trigger what visualizations?
4. How does information flow?

Be specific enough that a developer could start building.

Remember:
- Discovery Mode: Narrative, exploratory, Claude tells the story
- Trading Mode: Crystal clear, WHAT and WHY always visible""",
        model="deepseek-reasoner"
    )
    all_phases.append(("Phase 3: Screen Specs", phase3))

    # Phase 4: Chat Refinement
    critique2 = await run_critique(team, 2, phase3)
    all_phases.append(("Critique Round 2", critique2))

    # Phase 5: Reasoner - Deep Dive
    phase5 = await run_phase(
        team,
        "Phase 5: Deep Dive Your Area",
        """Final deep dive into YOUR specific area.

Address any concerns from Critique Round 2.
Provide FINAL recommendations for your expertise area.

Be concrete:
- Exact component names
- Data that flows through them
- User interactions
- Edge cases handled""",
        model="deepseek-chat"  # Chat for refinement
    )
    all_phases.append(("Phase 5: Final Recommendations", phase5))

    # Synthesis
    final_spec = await synthesize(team, all_phases)

    # Save outputs
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # Save final spec
    spec_path = f"{OUTPUT_DIR}/UX_DESIGN_SPEC_{timestamp}.md"
    with open(spec_path, "w") as f:
        f.write(final_spec)
    print(f"\n✅ Final spec saved: {spec_path}")

    # Save all phases for reference
    phases_path = f"{OUTPUT_DIR}/UX_DESIGN_PHASES_{timestamp}.json"
    with open(phases_path, "w") as f:
        json.dump(all_phases, f, indent=2, default=str)
    print(f"✅ All phases saved: {phases_path}")

    # Print preview
    print(f"\n{'='*70}")
    print("FINAL SPEC PREVIEW:")
    print(f"{'='*70}")
    print(final_spec[:3000] + "...\n")

    # Team status
    status = team.status()
    print("\n📊 Team Status:")
    for agent in status["agents"]:
        print(f"  {agent['name']}: {agent['status']}")


if __name__ == "__main__":
    asyncio.run(main())
