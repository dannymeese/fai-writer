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

If Docker isn't available, the UI still works in guest mode, but registration will warn that the database is unavailable.

## Database Maintenance

### Keeping the Project Working

**IMPORTANT**: After making changes to `prisma/schema.prisma`, you must:

1. **Apply schema changes to the database:**
   ```bash
   npx prisma db push
   ```
   This syncs your Prisma schema with the database. Use `--accept-data-loss` if you're okay with losing data during development.

2. **Regenerate the Prisma client:**
   ```bash
   npx prisma generate
   ```
   This updates the TypeScript types and client methods. The build script (`npm run build`) runs this automatically, but during development you may need to run it manually.

3. **Restart the dev server** after schema changes:
   ```bash
   # Stop the server (Ctrl+C), then:
   npm run dev
   ```

### Common Issues

**500 Internal Server Error when using Prisma models:**
- **Cause**: Prisma client is out of sync with the schema or database tables don't exist.
- **Fix**: Run `npx prisma db push` followed by `npx prisma generate`, then restart the dev server.

**"Cannot find module '@prisma/client'" or type errors:**
- **Cause**: Prisma client hasn't been generated.
- **Fix**: Run `npx prisma generate`.

**Migration errors:**
- If `prisma migrate dev` fails due to shadow database permissions, use `prisma db push` instead for development.
- For production, ensure the database user has CREATE DATABASE permissions for shadow databases, or use `prisma migrate deploy`.

### Schema Changes Workflow

1. Edit `prisma/schema.prisma`
2. Run `npx prisma db push` to apply changes
3. Run `npx prisma generate` to update the client (or restart dev server which will do this)
4. Restart the dev server if it's running
5. Test your changes

### Production Deployments

For production (Cloudways), use migrations instead of `db push`:
```bash
npx prisma migrate deploy
```

This applies pending migrations without creating a shadow database.

## Cloudways notes

- Use a Node 20+ application with build command `npm run build` and start command `npm run start`.
- Provision a MySQL database inside the same Cloudways app. Update `DATABASE_URL` with the credentials they provide.
- Set `NEXTAUTH_URL` and all other secrets inside the Cloudways environment variables UI.

## LLM prompt guardrails

The `compose` API route injects the provided system prompt to ensure there are no em dashes, en dashes, or AI writing tells.

