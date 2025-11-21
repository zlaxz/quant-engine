# Local Development Setup

To use the file browser and code tools with your local `rotation-engine` directory, you need to run edge functions locally.

## Quick Start

### 1. Start Local Supabase Stack
```bash
# This starts local database + edge functions
supabase start
```

### 2. Update .env for Local Development
Uncomment these lines in `.env`:
```bash
VITE_SUPABASE_URL="http://localhost:54321"
VITE_SUPABASE_PUBLISHABLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
```

### 3. Start Frontend
```bash
npm run dev
```

Now the file browser will work with your local `rotation-engine` directory!

---

## Why This Is Needed

**Problem**: Edge functions run on Supabase's servers (not your machine), so they can't access your local files.

**Solution**: Running `supabase start` creates a local Supabase instance where edge functions can access your local filesystem.

---

## Alternative: Functions-Only Mode

If you don't want the full local stack:

```bash
# Set the secret for local functions
supabase secrets set ROTATION_ENGINE_ROOT="/Users/zstoc/rotation-engine"

# Run just edge functions locally
supabase functions serve --env-file .env
```

Then update `.env` as above to point to `http://localhost:54321`.

---

## Switching Back to Production

To use remote Supabase (production):

1. Comment out the local URL lines in `.env`
2. Make sure the production lines are active:
   ```bash
   VITE_SUPABASE_URL="https://ynaqtawyynqikfyranda.supabase.co"
   VITE_SUPABASE_PUBLISHABLE_KEY="eyJ..."
   ```
3. Restart your dev server

**Note**: With production Supabase, file browser won't work (it can't access your local machine).

---

## Troubleshooting

### Error: "readdir '/rotation-engine': readdir '/rotation-engine'"
- You're using remote Supabase with file commands
- Switch to local development mode (see above)

### Error: "Connection refused"
- Make sure `supabase start` is running
- Check that port 54321 isn't blocked

### Edge functions not updating
```bash
# Restart local Supabase
supabase stop
supabase start
```
