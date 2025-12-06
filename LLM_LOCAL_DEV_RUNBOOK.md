## LLM Local Dev Runbook (start here)

This document is the single source of truth for launching Forgetaboutit Writer on localhost. Follow the steps in order on macOS (Apple Silicon or Intel). All commands assume the repo lives at `/Users/dannymeese/Dropbox (Personal)/VibeHQ/Forgetaboutit-Writer`.

---

### 0. Quick checklist
1. Docker Desktop is installed, running, and allowed to control privileged components.
2. `.env` exists and mirrors `env.example` with valid secrets.
3. `npm install` has been run at least once after pulling changes.

If any item is missing, fix it before proceeding.

---

### 1. Install / verify prerequisites
- **Node.js 20+** (via `nvm`, `fnm`, or `brew install node@20`).
- **npm** (ships with Node 20).
- **Docker Desktop** (https://www.docker.com/products/docker-desktop/). Launch it once and grant all permission prompts so the backend VM can boot.
- (Optional) **Homebrew** for package installs.

Confirm versions:
```bash
node -v
npm -v
docker --version
```

---

### 2. Configure environment variables
```bash
cd /Users/dannymeese/Dropbox\ (Personal)/VibeHQ/Forgetaboutit-Writer
cp env.example .env           # only once
```
Edit `.env` with real secrets:
- `DATABASE_URL` -> `mysql://fw_user:fw_pass@localhost:3307/forgetaboutit_writer`
- `OPENAI_API_KEY`, NextAuth secrets, Stripe keys, etc.

Never commit `.env`.

---

### 3. Prepare the database stack (MySQL + LanguageTool)
1. Ensure Docker Desktop is running (green whale icon).
2. From the repo root run:
   ```bash
   docker compose up -d
   docker compose ps           # verify db on 3307 and LanguageTool on 8010
   ```
3. First run (or after schema changes):
   ```bash
   npx prisma db push
   npx prisma generate
   ```

> **Restart flow**:  
> ```bash
> docker compose down
> docker stop forgetaboutit-writer-languagetool-1 2>/dev/null || true
> docker rm forgetaboutit-writer-languagetool-1 2>/dev/null || true
> docker compose up -d
> ```

---

### 4. Install/update Node dependencies
```bash
npm install
```
Re-run whenever `package.json`/`package-lock.json` changes.

---

### 5. Launch the Next.js dev server
```bash
npm run dev
```
What to expect:
- Prisma client regenerates automatically.
- Next.js listens on `http://localhost:3000`. If busy, it auto-shifts to the next free port (watch the log for `Local: http://localhost:XXXX`).
- Keep this terminal open; use `Ctrl+C` to stop.

Optional health check:
```bash
curl -I http://localhost:3000   # swap port if Next picked a different one
```

---

### 6. Verify the app
1. Visit the reported dev URL in your browser.
2. Sign in (credentials in DB) or run as guest.
3. Generate a doc, toggle the panel, and ensure outputs save.
4. If anything fails:
   ```bash
   docker compose logs db
   docker compose logs languagetool
   npm run lint     # optional
   ```

---

### 7. Daily restart procedure (safe sequence)
```bash
# from repo root
pkill -f "next dev" 2>/dev/null || true   # stop any runaway dev servers
docker compose down                       # stop db + language tool
docker compose up -d                      # bring them back
npm run dev                               # launch Next.js again
open http://localhost:3000                # or whatever port Next reports
```

---

### 8. Shutdown / cleanup
- Stop `npm run dev` with `Ctrl+C`.
- Optionally stop services:
  ```bash
  docker compose down
  ```
- Remove dangling containers if needed:
  ```bash
  docker ps -a
  docker rm <container-id>
  ```

---

### 9. Troubleshooting
| Symptom | Fix |
| --- | --- |
| Docker won’t start | Open Docker.app manually, clear quarantine `sudo xattr -dr com.apple.quarantine /Applications/Docker.app`, reboot if needed. |
| `docker compose up -d` hangs | Run `docker compose down`, `docker stop forgetaboutit-writer-languagetool-1`, retry. |
| Dev server stuck or port stale | `pkill -f "next dev"` then `npm run dev`. |
| Prisma errors | `npx prisma db push && npx prisma generate`, restart dev server. |
| Cannot reach `localhost:3000` | Check logs, confirm port (maybe Next moved to 3002). Use `curl -I http://localhost:PORT`. |

Following this playbook guarantees the local stack (Next.js + MySQL + LanguageTool) runs identically to previous working sessions.
