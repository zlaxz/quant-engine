#!/usr/bin/env python3
"""
Project Cleanup Framework
=========================
Complete framework for cleaning up a project's documentation.

This script:
1. Runs archaeology on conversations
2. Extracts key decisions and pivots
3. Generates a cleanup plan
4. Outputs templates filled with extracted data

Usage:
    python scripts/project_cleanup_framework.py --project . --days 3

For other projects, copy this script and adjust paths.
"""

import os
import sys
from pathlib import Path
from datetime import datetime

# Add the scripts directory to path
sys.path.insert(0, str(Path(__file__).parent))

from project_archaeology import (
    run_archaeology,
    find_conversation_files,
    parse_conversation,
    find_pivotal_moments,
    extract_assistant_syntheses,
    ProjectState
)


def analyze_project_structure(project_path: str) -> dict:
    """Analyze what exists in the project."""
    project = Path(project_path)

    structure = {
        "scripts": [],
        "python_modules": {},
        "key_files": [],
        "docs": [],
        "noise_candidates": [],
    }

    # Find scripts
    for pattern in ["scripts/*.py", "python/scripts/*.py"]:
        for f in project.glob(pattern):
            if not f.name.startswith("__"):
                structure["scripts"].append(str(f.relative_to(project)))

    # Find Python modules
    for module_dir in ["python/engine/features", "python/engine/discovery",
                       "python/engine/ai_native", "python/engine/trading"]:
        module_path = project / module_dir
        if module_path.exists():
            modules = [f.name for f in module_path.glob("*.py")
                      if not f.name.startswith("__")]
            structure["python_modules"][module_dir] = modules

    # Find key documentation files
    for doc in ["HANDOFF.md", "SESSION_STATE.md", "README.md",
                ".claude/CLAUDE.md", "CLAUDE.md"]:
        if (project / doc).exists():
            structure["docs"].append(doc)

    return structure


def generate_cleanup_plan(state: ProjectState, structure: dict) -> str:
    """Generate a cleanup plan based on archaeology findings."""

    plan = []
    plan.append("# Project Cleanup Plan")
    plan.append(f"\n**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    plan.append("")

    # Summary of findings
    plan.append("## Archaeology Summary")
    plan.append(f"- **Critical pivots found:** {len([m for m in state.pivotal_moments if m.importance == 'critical'])}")
    plan.append(f"- **Key decisions found:** {len([m for m in state.pivotal_moments if m.importance == 'high'])}")
    plan.append(f"- **Noise files identified:** {len(state.noise_files)}")
    plan.append("")

    # Top critical pivots
    critical = [m for m in state.pivotal_moments if m.importance == 'critical'][:5]
    if critical:
        plan.append("## Critical Pivots to Document")
        plan.append("")
        for m in critical:
            plan.append(f"### From {m.role.upper()}")
            plan.append(f"> {m.quote[:300]}...")
            plan.append("")

    # Documents to update
    plan.append("## Documents to Update")
    plan.append("")
    for doc in structure["docs"]:
        plan.append(f"- [ ] `{doc}`")
    plan.append("- [ ] Obsidian entry point (if exists)")
    plan.append("")

    # Noise files to mark
    if state.noise_files:
        plan.append("## Files to Mark as Noise")
        plan.append("")
        for f in state.noise_files[:10]:
            plan.append(f"- [ ] `{f}`")
        plan.append("")

    # Prohibitions to add
    if state.prohibitions:
        plan.append("## Prohibitions to Add to CLAUDE.md")
        plan.append("")
        for p in state.prohibitions[:10]:
            plan.append(f"- {p}")
        plan.append("")

    # Steps
    plan.append("## Cleanup Steps")
    plan.append("")
    plan.append("### 1. Verify Understanding")
    plan.append("Present findings to user and confirm:")
    plan.append("- Is the pivot/architecture correct?")
    plan.append("- What else should be prohibited?")
    plan.append("- What other noise exists?")
    plan.append("")
    plan.append("### 2. Update CLAUDE.md")
    plan.append("Use template at `scripts/templates/CLAUDE_MD_TEMPLATE.md`")
    plan.append("- Add STOP section at top")
    plan.append("- Add prohibitions table")
    plan.append("- Add noise list")
    plan.append("- Add current focus")
    plan.append("")
    plan.append("### 3. Update HANDOFF.md")
    plan.append("Use template at `scripts/templates/HANDOFF_TEMPLATE.md`")
    plan.append("- Clear path section")
    plan.append("- What's working")
    plan.append("- What's next")
    plan.append("- Noise to ignore")
    plan.append("")
    plan.append("### 4. Update Obsidian (if used)")
    plan.append("- Entry point document")
    plan.append("- Mark superseded docs")
    plan.append("- Add decision/learning doc")
    plan.append("")
    plan.append("### 5. Create Prevention Mechanisms")
    plan.append("- [ ] Generate project catalog")
    plan.append("- [ ] Set up session-start hook (optional)")
    plan.append("- [ ] Document the cleanup in learnings")

    return "\n".join(plan)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Project Cleanup Framework")
    parser.add_argument("--project", type=str, default=".", help="Project path")
    parser.add_argument("--days", type=int, default=3, help="Days to look back")
    parser.add_argument("--output-dir", type=str, default=".working",
                       help="Output directory for reports")

    args = parser.parse_args()

    project = os.path.abspath(args.project)
    output_dir = Path(project) / args.output_dir
    output_dir.mkdir(exist_ok=True)

    print("=" * 60)
    print("PROJECT CLEANUP FRAMEWORK")
    print("=" * 60)
    print(f"\nProject: {project}")
    print(f"Looking back: {args.days} days")
    print("")

    # Step 1: Analyze structure
    print("Step 1: Analyzing project structure...")
    structure = analyze_project_structure(project)
    print(f"  Found {len(structure['scripts'])} scripts")
    print(f"  Found {len(structure['docs'])} doc files")
    print("")

    # Step 2: Run archaeology
    print("Step 2: Running archaeology on conversations...")
    state = run_archaeology(project, args.days)
    print("")

    # Step 3: Generate cleanup plan
    print("Step 3: Generating cleanup plan...")
    plan = generate_cleanup_plan(state, structure)

    plan_path = output_dir / "CLEANUP_PLAN.md"
    with open(plan_path, 'w') as f:
        f.write(plan)
    print(f"  Plan written to {plan_path}")
    print("")

    # Step 4: Generate archaeology report
    archaeology_path = output_dir / "ARCHAEOLOGY_REPORT.md"
    from project_archaeology import generate_report
    generate_report(state, str(archaeology_path))
    print("")

    print("=" * 60)
    print("FRAMEWORK COMPLETE")
    print("=" * 60)
    print("")
    print("Next steps:")
    print(f"1. Review {plan_path}")
    print(f"2. Review {archaeology_path}")
    print("3. Verify findings with user")
    print("4. Execute cleanup plan")
    print("")
    print("Templates available at:")
    print("  scripts/templates/CLAUDE_MD_TEMPLATE.md")
    print("  scripts/templates/HANDOFF_TEMPLATE.md")


if __name__ == "__main__":
    main()
