# Quant Chat Workbench - Setup Guide

## Phase 1: Complete ✅

This scaffold includes:
- Three-panel layout (Workspaces/Sessions | Chat | Context/Quant/Memory)
- Database schema ready to deploy
- Supabase client configured
- Professional dark theme with trading terminal aesthetics

---

## 🔧 Setup Steps

### 1. Configure Environment Variables

Create a `.env.local` file in your project root:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

**Where to find these values:**
1. Go to your Supabase project dashboard
2. Click on **Settings** (gear icon) → **API**
3. Copy the **Project URL** → paste as `VITE_SUPABASE_URL`
4. Copy the **anon/public key** → paste as `VITE_SUPABASE_ANON_KEY`

---

### 2. Run Database Schema

**Option A: Using SQL Editor (Recommended)**
1. Open your Supabase dashboard
2. Go to **SQL Editor** (left sidebar)
3. Click **New Query**
4. Copy the entire contents of `database-schema.sql`
5. Paste and click **Run**

**Option B: Using Supabase CLI**
```bash
supabase db execute --file database-schema.sql
```

---

### 3. Verify Installation

After running the schema, check that these tables exist:
- ✅ `workspaces` (with 1 default workspace)
- ✅ `chat_sessions`
- ✅ `messages`
- ✅ `strategies`
- ✅ `backtest_runs`
- ✅ `memory_notes`

You can verify in Supabase Dashboard → **Table Editor**

---

### 4. Start Development

```bash
npm install
npm run dev
```

The app should now load with:
- Left panel showing the default workspace
- Empty chat sessions list
- Static chat area (Phase 1 - no LLM integration yet)
- Tabbed right panel (Context/Quant/Memory)

---

## 📋 What's Working Now

- ✅ Database schema with all core tables
- ✅ Workspace selector (loads from DB)
- ✅ Chat session list (loads from DB)
- ✅ Three-panel responsive layout
- ✅ Professional quant-focused design system

## 🚧 What's Next (Phase 2+)

- ⏳ LLM integration for chat
- ⏳ Message persistence
- ⏳ Strategy management UI
- ⏳ Backtest execution & visualization
- ⏳ Memory notes CRUD
- ⏳ Real-time updates

---

## 🎨 Design Tokens

The app uses a professional trading terminal theme:
- **Primary**: Teal/Cyan for key actions
- **Accent**: Bright cyan for highlights
- **Success**: Green for positive metrics
- **Warning**: Amber for alerts
- **Fonts**: Inter (UI), JetBrains Mono (data/code)

All colors are defined in `src/index.css` and `tailwind.config.ts`.

---

## 📁 Project Structure

```
src/
├── components/
│   ├── layout/
│   │   └── MainLayout.tsx       # Three-panel container
│   ├── workspace/
│   │   └── WorkspaceSelector.tsx
│   ├── chat/
│   │   ├── ChatSessionList.tsx
│   │   └── ChatArea.tsx
│   └── panels/
│       └── RightPanel.tsx       # Context/Quant/Memory tabs
├── integrations/
│   └── supabase/
│       └── client.ts            # Supabase client
└── pages/
    └── Index.tsx                # Main page
```

---

## 🐛 Troubleshooting

**"Failed to load workspaces"**
- Check that you've created `.env.local` with correct credentials
- Verify the database schema was executed successfully
- Check browser console for specific error messages

**"No workspace"**
- Run the database schema again (it includes sample data)
- Or manually insert a workspace in Supabase Table Editor

**Build errors**
- Run `npm install` to ensure all dependencies are installed
- Check that Node.js version is 18+

---

## 📚 Database Schema Summary

### Tables Overview

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `workspaces` | Organize sessions & strategies | name, default_system_prompt |
| `chat_sessions` | Individual conversations | workspace_id, title, metadata |
| `messages` | Chat message history | session_id, role, content |
| `strategies` | Trading strategy definitions | key, name, config |
| `backtest_runs` | Strategy backtest results | strategy_key, metrics, equity_curve |
| `memory_notes` | Persistent workspace notes | workspace_id, content, tags |

See `database-schema.sql` for complete table definitions with constraints and indexes.
