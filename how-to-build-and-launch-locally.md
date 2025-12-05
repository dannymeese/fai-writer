## How to build & launch Forgetaboutit Writer locally

Follow these steps on macOS (Apple Silicon or Intel). Commands assume the project root is `/Users/dannymeese/Dropbox (Personal)/VibeHQ/Forgetaboutit-Writer`.

### 1. Install prerequisites
- **Node.js 20+** (the repo already includes `node_modules`, but install via `nvm`/`fnm`/`brew` if missing).
- **npm** (bundled with Node 20).
- **Docker Desktop** (latest from https://www.docker.com/products/docker-desktop/). Open it once and grant any permission prompts so the backend VM starts.

### 2. Prepare environment variables
1. Copy the example file:
   ```bash
   cp env.example .env
   ```
2. Fill in the secrets inside `.env` (OpenAI key, NextAuth secrets, etc.). The dev server reads this file automatically.

### 3. Start supporting services (MySQL + LanguageTool)
1. Make sure Docker Desktop is running.
2. From the project root, boot the Compose stack:
   ```bash
   docker compose up -d
   ```
   - `db` exposes MySQL 8.0 on `localhost:3307`.
   - `languagetool` exposes LanguageTool on `localhost:8010`.
3. Confirm they are healthy:
   ```bash
   docker compose ps
   ```

### 4. Apply the Prisma schema (first run or after schema changes)
```bash
npx prisma db push
npx prisma generate
```

### 5. Install / update npm packages
```bash
npm install
```

### 6. Launch the Next.js dev server
```bash
npm run dev
```
- Next.js defaults to `http://localhost:3000`, but if that port is busy it will automatically pick the next free port (e.g., `3002`). Watch the terminal output for the exact URL.
- Once the boot log shows `Local: http://localhost:3000` (or similar), open that URL in the browser and sign in/register as needed.

### 7. Verify everything works
1. Visit the reported dev URL in your browser.
2. Create or open a document to confirm the editor loads.
3. Check Docker containers if anything fails (`docker compose logs db`).

### 8. Shut things down when finished
- Stop the dev server with `Ctrl+C`.
- Optionally stop Docker services:
  ```bash
  docker compose down
  ```

With these steps the full stack (Next.js + MySQL + LanguageTool) runs locally and matches the environment we just validated (`docker compose up -d` + `npm run dev` reachable on `http://localhost:3002`). Adjust ports as needed if other apps occupy 3000/3307/8010.



