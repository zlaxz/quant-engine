# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/356d4f16-13c6-49c7-ba84-d79c2277da62

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/356d4f16-13c6-49c7-ba84-d79c2277da62) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## Connecting Your Local Rotation Engine

This project includes code bridge commands (`/open_file`, `/list_dir`, `/search_code`, `/red_team_file`) that can read directly from your local rotation-engine directory.

### Setup Instructions

1. **Copy the example environment file:**
   ```sh
   cp .env.example .env.local
   ```

2. **Set the rotation-engine path in `.env.local`:**
   ```sh
   VITE_ROTATION_ENGINE_ROOT="/Users/zstoc/rotation-engine"
   ```
   Replace with the absolute path to your local rotation-engine directory.

3. **Configure Supabase Edge Functions:**
   
   For local development with Supabase CLI:
   ```sh
   supabase secrets set ROTATION_ENGINE_ROOT="/Users/zstoc/rotation-engine"
   ```

   For deployed edge functions, set the secret in your Supabase project dashboard:
   - Navigate to: Settings → Edge Functions
   - Add secret: `ROTATION_ENGINE_ROOT` with your server path

4. **Test the connection:**
   - `/list_dir path:.` — List root directory
   - `/list_dir path:profiles` — List profiles directory
   - `/open_file path:profiles/skew.py` — Open a specific file
   - `/search_code peakless` — Search across the codebase
   - `/red_team_file path:profiles/skew.py` — Run code audit

### Safety Features

- **Read-only access:** Edge functions can only read files, never write
- **Path validation:** Directory traversal (`..`) and absolute paths are blocked
- **Sandboxed:** Code bridge cannot access files outside the configured root

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/356d4f16-13c6-49c7-ba84-d79c2277da62) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
