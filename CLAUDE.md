# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Last Updated:** 2025-12-05

---

## READ FIRST: The Clear Path

**This project is a Market Physics Engine + JARVIS Observatory.**

### 1. Market Physics Engine
Discover causal market mechanics (the "F=ma of markets") using physics, math, and AI swarms.
- Core code: `python/engine/features/` and `python/engine/discovery/`
- Authoritative doc: Obsidian `01-Architecture/MARKET-PHYSICS-ENGINE.md`

### 2. JARVIS UI
The Electron app is an **observatory** displaying Claude Code activity in real-time.
- Work happens in Claude Code terminal, NOT in Electron chat
- UI shows what we're doing via `emit_ui_event()`
- Authoritative doc: Obsidian `01-Architecture/JARVIS-UI-ARCHITECTURE.md`

### 3. AI Swarms
DeepSeek parallel agents for discovery at scale.
- Location: `scripts/deepseek_agent.py`

### Noise to Ignore
Sessions went off-track and added these - NOT the focus:
- `python/engine/trading/*.py` (mean_reversion, gamma_scalping, etc.)
- Old CIO/Gemini chat features
- "Research IDE" framing

**Focus: Physics Engine + JARVIS. That's it.**

---

## Technical Overview

The Electron app infrastructure exists but the primary interaction is via Claude Code terminal.

## Development Commands

```bash
# Install dependencies
npm install
pip install -r python/requirements.txt

# Development (React + Electron with hot reload)
npm run electron:dev

# Build React only (web preview)
npm run build
npm run preview

# Build full Electron app
npm run electron:build

# Lint
npm run lint

# Run Python server standalone (for testing)
cd python && python server.py
```

## Architecture

### Three-Layer Structure

1. **React Frontend** (`src/`) - UI components, chat interface, visualizations
2. **Electron Main Process** (`src/electron/`) - IPC handlers, LLM clients, file system access
3. **Python Backend** (`python/`) - Backtesting engine, data processing, Flask API server

### Key Data Flow

```
React (renderer) <--IPC--> Electron Main <--subprocess--> Python Engine
                                |
                                +--> LLM APIs (Gemini, OpenAI, DeepSeek)
                                +--> Supabase (memory/context storage)
                                +--> Local SQLite (better-sqlite3)
```

### Electron IPC Architecture

All frontend-to-backend communication goes through the preload script (`src/electron/preload.ts`). Key handlers:

- `src/electron/ipc-handlers/llmClient.ts` - LLM streaming, tool calling, agent spawning
- `src/electron/ipc-handlers/fileOperations.ts` - Sandboxed file system access
- `src/electron/ipc-handlers/pythonExecution.ts` - Python script execution
- `src/electron/ipc-handlers/memoryHandlers.ts` - Memory daemon, recall engine
- `src/electron/ipc-handlers/daemonManager.ts` - Background research daemon

### LLM Tool System

Tool definitions: `src/electron/tools/toolDefinitions.ts`
Tool handlers: `src/electron/tools/toolHandlers.ts`

The system uses Gemini 3 function calling. Tools include:
- File operations (read, write, search, list)
- Git operations (status, diff, commit)
- Agent spawning (DeepSeek agents via Python bridge)
- Python execution (backtests, analysis)

### Model Configuration

Centralized in `src/config/models.ts`:
- PRIMARY: Gemini 3 Pro (main conversations, tool use)
- SWARM: DeepSeek Reasoner (parallel agents)
- HELPER: GPT-4o-mini (quick responses)
- MEMORY/EMBEDDING: GPT-4o-mini / text-embedding-3-small

### Python Engine

The `python/` directory contains:
- `server.py` - Flask API server (port 5000)
- `daemon.py` - Background research worker
- `engine/` - Core backtesting and analysis modules
  - `engine/api/routes.py` - API endpoint logic
  - `engine/analysis/` - Market analysis
  - `engine/trading/` - Strategy execution
  - `engine/pricing/` - Options pricing
  - `engine/data/` - Data loading/processing

### Memory System

- `src/electron/memory/MemoryDaemon.ts` - Background memory extraction
- `src/electron/memory/RecallEngine.ts` - Context retrieval from Supabase
- Local SQLite for session cache, Supabase (pgvector) for persistent memory

### Prompts

LLM system prompts: `src/prompts/`
- `chiefQuantPrompt.ts` - Main AI assistant persona
- `sharedContext.ts` - Common context injection

## Build Outputs

- `dist/` - Vite-built React app
- `dist-electron/` - Compiled Electron main process
- `release/` - Packaged app (after `electron:build`)

## Configuration Files

- `vite.config.ts` - React/Vite config
- `vite.config.electron.ts` - Electron main process build
- `vite.config.preload.ts` - Preload script build
- `electron-builder.json` - App packaging config
- `.env` - API keys (not committed)

## Code Patterns

### IPC Handler Registration

```typescript
// In main.ts
registerFileOperationHandlers();
registerLlmHandlers();
// etc.
```

### Tool Execution Pattern

Tools are defined as `FunctionDeclaration[]` and executed via `executeTool()` in toolHandlers.ts. Each tool returns a structured result.

### Streaming LLM Responses

LLM handlers stream responses via IPC channel events. The frontend accumulates chunks in `src/lib/electronClient.ts`.

## Testing

No automated test framework currently configured. Manual testing via:
1. `npm run electron:dev` - Full app testing
2. `python server.py` - API endpoint testing
3. Browser DevTools + Electron DevTools for debugging
