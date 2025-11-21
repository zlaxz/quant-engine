# Electron Desktop App Setup

The Quant Chat Workbench can run as an Electron desktop app for seamless local file access and Python execution.

## Benefits of Desktop App

- **No bridge server needed** - Direct local filesystem access
- **Direct Python execution** - No HTTP bridge, no localhost server
- **Lower latency** - Direct API calls to LLMs (optional)
- **Keep existing infrastructure** - Database still via Supabase edge functions

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure API keys:**
   
   Create a `.env` file in the project root:
   ```bash
   # LLM API Keys (required)
   GEMINI_API_KEY=your_gemini_key
   OPENAI_API_KEY=your_openai_key
   DEEPSEEK_API_KEY=your_deepseek_key
   
   # Rotation Engine Path (required)
   ROTATION_ENGINE_ROOT=/Users/zstoc/rotation-engine
   
   # Supabase (already configured)
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_key
   ```

3. **Customize Python execution:**
   
   Edit `src/electron/ipc-handlers/pythonExecution.ts` lines 20-30 to match your rotation-engine CLI:
   ```typescript
   const cmd = [
     'python3',
     'run_backtest.py',  // Your actual script
     '--strategy', params.strategyKey,
     '--start', params.startDate,
     '--end', params.endDate,
     '--capital', params.capital.toString(),
   ];
   ```

## Running the App

### Development Mode

```bash
npm run electron:dev
```

This starts:
1. Vite dev server on http://localhost:5173
2. Electron app that loads the dev server

### Production Build

```bash
npm run electron:build
```

This creates:
- Mac: `.dmg` and `.zip` in `release/`
- Linux: `.AppImage` and `.deb` in `release/`
- Windows: `.exe` installer in `release/`

## Architecture

### Hybrid Approach

The app uses a smart routing layer (`src/lib/electronClient.ts`):

**Via Electron IPC (local):**
- File operations (`readFile`, `writeFile`, `deleteFile`, `listDir`, `searchCode`)
- Python execution (`runBacktest`)
- Optional: Direct LLM calls for lower latency

**Via Supabase Edge Functions (remote):**
- Database operations (workspaces, sessions, messages)
- Memory operations (create, search, update, archive)
- Report operations (save, list, retrieve)
- Any backend logic that doesn't need local filesystem

### How It Works

```
Frontend Component
    ↓
electronClient.ts (routing layer)
    ↓
    ├─→ window.electron.* (if Electron)
    │       ↓
    │   IPC Handler (main process)
    │       ↓
    │   Direct fs/child_process
    │
    └─→ supabase.functions.invoke() (if web or fallback)
            ↓
        Supabase Edge Function
```

## File Structure

```
src/electron/
├── main.ts                 # Electron main process entry
├── preload.ts              # IPC bridge (exposes window.electron)
└── ipc-handlers/
    ├── fileOperations.ts   # fs operations with path validation
    ├── pythonExecution.ts  # child_process spawn for backtests
    └── llmClient.ts        # Direct API calls to Gemini/OpenAI/DeepSeek

src/lib/
└── electronClient.ts       # Hybrid routing layer (IPC or edge functions)
```

## Security

- **Path validation** - All file operations check paths are within `ROTATION_ENGINE_ROOT`
- **No directory traversal** - Cannot access files outside rotation-engine
- **API keys server-side** - Never exposed to renderer process
- **Context isolation** - Renderer process sandboxed, IPC via preload script

## Troubleshooting

### "Cannot find module 'electron'"

Ensure you've installed dependencies:
```bash
npm install
```

### Python execution fails

Check `pythonExecution.ts` matches your rotation-engine CLI:
- Verify script path (`run_backtest.py`)
- Verify argument names (`--strategy`, `--start`, etc.)
- Test command manually in terminal first

### API calls fail

Ensure API keys are set in `.env`:
```bash
echo $GEMINI_API_KEY
echo $OPENAI_API_KEY
echo $DEEPSEEK_API_KEY
```

### File operations fail

Verify `ROTATION_ENGINE_ROOT` in `.env` points to correct directory:
```bash
ls $ROTATION_ENGINE_ROOT
```

## Web App Fallback

The same codebase works as a web app - simply run:
```bash
npm run dev
```

The routing layer (`electronClient.ts`) detects non-Electron environment and routes all operations through Supabase edge functions instead.

## Next Steps

1. **Test local operations** - Verify file reading, Python execution work
2. **Configure API keys** - Add to `.env` for direct LLM calls
3. **Customize Python CLI** - Match your rotation-engine interface
4. **Package for distribution** - Build `.dmg`/`.exe` for easy installation
