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
3. Generate Prisma client and run migrations:
   ```bash
   npx prisma db push
   ```
4. Start the dev server:
   ```bash
   npm run dev
   ```

## Cloudways notes

- Use a Node 20+ application with build command `npm run build` and start command `npm run start`.
- Provision a MySQL database inside the same Cloudways app. Update `DATABASE_URL` with the credentials they provide.
- Set `NEXTAUTH_URL` and all other secrets inside the Cloudways environment variables UI.

## LLM prompt guardrails

The `compose` API route injects the provided system prompt to ensure there are no em dashes, en dashes, or AI writing tells.

