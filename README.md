# Forgetaboutit Writer

AI-assisted luxury copy studio tailored for Cloudways deployments.

## Tech stack

- Next.js App Router (TypeScript)
- Tailwind CSS for styling
- NextAuth (Google OAuth + email credentials)
- Prisma ORM targeting Cloudways MySQL
- OpenAI API (configurable) for drafting copy

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `env.example` to `.env` and fill in credentials.
3. (Optional but recommended) Start a local MySQL instance via Docker so registration/saved styles work:
   ```bash
   docker compose up -d
   ```
   This uses `docker-compose.yml` (MySQL 8.0 on `localhost:3307` with the `fw_user/fw_pass` credentials that match `DATABASE_URL`). Ensure Docker Desktop is running before executing the command.
4. Generate Prisma client and run migrations:
   ```bash
   npx prisma db push
   ```
5. Start the dev server:
   ```bash
   npm run dev
   ```

If Docker isn’t available, the UI still works in guest mode, but registration will warn that the database is unavailable.

## Cloudways notes

- Use a Node 20+ application with build command `npm run build` and start command `npm run start`.
- Provision a MySQL database inside the same Cloudways app. Update `DATABASE_URL` with the credentials they provide.
- Set `NEXTAUTH_URL` and all other secrets inside the Cloudways environment variables UI.

## LLM prompt guardrails

The `compose` API route injects the provided system prompt to ensure there are no em dashes, en dashes, or AI writing tells.

