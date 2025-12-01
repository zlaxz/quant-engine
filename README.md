# Quant Engine

**A general-purpose quantitative research workbench for ANY trading strategy**

---

## What Is This?

Desktop app for quantitative trading research. Works for momentum, mean reversion, pairs trading, options, ML models, futures, crypto - **any quantitative strategy**.

**Tech Stack:** Electron + React + Python
**AI Models:** Gemini 3 Pro + Claude Code + DeepSeek
**Status:** Production-ready (as of 2025-12-01)

---

## Quick Start

```bash
# Install
npm install
pip install -r python/requirements.txt

# Run
npm run electron:dev

# Build
npm run electron:build
```

---

## Key Features

✅ **Generic Visualization System** - 8 chart types, data tables, metrics dashboards
✅ **Multi-Model AI** - Gemini (reasoning) + Claude Code (execution) + DeepSeek (parallel)
✅ **Data-Driven** - Pass your data in directives, no hardcoded assumptions
✅ **Real-Time** - Charts/tables update live as analysis runs
✅ **Flexible** - Works for ANY quant strategy, not locked to specific paradigm

---

## Documentation

**Start Here:**
- **ARCHITECTURE.md** - System overview and current capabilities
- **SESSION_STATE.md** - Current project state and recent changes
- **CLAUDE.md** - Developer guidance

**Technical Details:**
- `.claude/docs/` - Comprehensive technical documentation
- `src/prompts/chiefQuantPrompt.ts` - AI system prompt
- `src/components/charts/README.md` - Visualization component docs

---

## Architecture

**3 Layers:** React frontend → Electron main → Python backend
**3 AI Models:** Gemini 3 Pro → Claude Code → DeepSeek agents
**Dynamic UI:** Data-driven directives control charts/tables/metrics in real-time

See **ARCHITECTURE.md** for complete details.

---

Built for flexible quantitative research | **No hardcoded paradigms**
