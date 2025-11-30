# Forgetaboutit Writer — Project Handoff

This document is the “what I wish I knew” guide for whoever inherits this repo. It captures the system’s moving parts, conventions, and trade‑offs so you can ship confidently without reverse‑engineering everything.

---

## 1. High-level purpose

- **Product**: A luxury copy studio for Forgetaboutit.ai customers. Users describe what to write, set tone/constraints, and receive branded output that never uses em/en dashes or AI tells.
- **Usage modes**:
  - **Guest**: Anyone can compose immediately. Optional 5-output cap enforced via `ENFORCE_GUEST_LIMIT` envs.
  - **Authenticated**: Google OAuth + optional email/password (when a DB is available). Auth users can save “styles” (documents) to revisit later.

---

## 2. Tech stack

| Layer | Details |
| --- | --- |
| UI | Next.js 15 (App Router, TypeScript), Tailwind CSS |
| State | Mostly client-side React state inside `WriterWorkspace`. |
| Auth | NextAuth (Google provider always, credentials only when MySQL reachable). |
| Data | Prisma ORM (MySQL target, Cloudways deployment). Prisma is optional; app still runs read-only without DB. |
| AI | OpenAI `responses.create` using `gpt-5.1`. |
| Export | `docx` package to stream `.docx` downloads. |

---

## 3. Important files

| Path | Purpose |
| --- | --- |
| `src/app/page.tsx` | Server component deciding guest vs authenticated experience, preloading saved docs. |
| `src/components/panels/WriterWorkspace.tsx` | Main client workspace: header, conversation history, compose bar, brief controls, toast. |
| `src/components/forms/ComposeBar.tsx` | Textarea + wrench icon + send button anchored to the bottom of the viewport. |
| `src/components/modals/SettingsSheet.tsx` | Brief controls popover; slides from the wrench anchor, no page dimming. |
| `src/components/panels/OutputPanel.tsx` | Chat-style conversation UI showing “You” prompt and “Forgetaboutit” response boxes. |
| `src/components/shared/SiteHeader.tsx` / `SiteFooter.tsx` | Exact clones of forgetaboutit.ai branding (logo, CTA, footer nav + newsletter). |
| `src/lib/validators.ts` | Zod schemas used by brief controls and API routes; defines optional settings. |
| `src/lib/auth.ts` | Central NextAuth config; toggles Prisma adapter/providers based on DB availability. |
| `src/lib/prisma.ts` | Safe Prisma initialization. Returns `null` when `DATABASE_URL` is missing so guests can still use the app. |
| `src/app/api/*` | Server routes for auth, registration, composing, exporting, saving documents, etc. |
| `prisma/schema.prisma` | Schema for Cloudways MySQL (User, Document, Account, Session, VerificationToken). Document now stores prompt + setting fields. |

---

## 4. Conversation flow

1. User types prompt, optionally tweaks brief controls (character/word length first, then market tier, grade level, benchmark, avoid words).
2. Compose sends `prompt` + `settings` to `/api/compose`.
3. API:
   - Validates via `composeRequestSchema`.
   - Builds directive list and calls OpenAI `gpt-5.1` with the system prompt (no AI tells, no dashes, no redundancy).
   - If authenticated and Prisma available, stores the resulting document with prompt/setting metadata.
4. Client receives response:
   - Adds a right-aligned “You” bubble (prompt, `Edit & Resend`).
   - Adds a left-aligned “Forgetaboutit” bubble with actions (Copy, Download `.docx`, Save style).
   - `Edit & Resend` rehydrates both the textarea and brief controls from the saved settings.

Outputs persist in state indefinitely for guests; auth users also persist to DB.

---

## 5. Auth & guest behavior

- **Guest limit**:
  - Backend flag: `ENFORCE_GUEST_LIMIT` (default `"false"`).
  - Frontend flag: `NEXT_PUBLIC_ENFORCE_GUEST_LIMIT`.
  - When enabled, guests can submit 5 prompts per day (tracked via `guest_outputs` cookie) before seeing the register gate.
- **Header CTA**: Guests see “Register free / Sign in”. Auth users see `SignOutButton`.
- **Prisma fallback**: If `DATABASE_URL` is missing or misconfigured, `src/lib/prisma.ts` returns `null`. All API routes check `prisma` before querying. When `null`, credentials signup/login and document persistence are disabled, but compose still works.
- **NextAuth**:
  - Google provider always available (requires `GOOGLE_CLIENT_ID/SECRET`).
  - Credentials provider + Prisma adapter only initialize when `prisma` exists.
  - Session strategy is `database` when DB exists, `jwt` otherwise.

---

## 6. Database schema (Document model)

```prisma
model Document {
  id              String   @id @default(cuid())
  title           String
  content         String
  tone            String?
  prompt          String?
  characterLength Int?
  wordLength      Int?
  gradeLevel      String?
  benchmark       String?
  avoidWords      String?
  owner           User     @relation(fields: [ownerId], references: [id])
  ownerId         String
  createdAt       DateTime @default(now())
}
```

Run `npx prisma db push` whenever this schema changes before deploying.

---

## 7. API endpoints

| Route | Notes |
| --- | --- |
| `POST /api/compose` | Core business logic. Accepts prompt + settings, enforces guest limits, talks to OpenAI, optionally stores document. Returns document ID, timestamp, prompt, merged settings. |
| `POST /api/export` | Accepts `{ title, content }`, returns `.docx` as `Uint8Array`. |
| `GET/POST /api/documents` | Auth-only. `GET` returns last 25 docs for the user. `POST` saves style snapshots (title/content/prompt/settings). Guarded by `prisma` existence. |
| `POST /api/register` | Manual signup. Returns 503 if DB disabled. |
| `GET/POST /api/auth/[...nextauth]` | NextAuth route handler. |

Each route checks `auth()` (server-side NextAuth) where relevant, and respects the Prisma fallback.

---

## 8. Environment variables (see `env.example`)

- `DATABASE_URL` – Cloudways MySQL DSN (`mysql://USER:PASSWORD@HOST:PORT/DB`).
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL`.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- `OPENAI_API_KEY`.
- `ENFORCE_GUEST_LIMIT`, `NEXT_PUBLIC_ENFORCE_GUEST_LIMIT` – set to `"true"` to re-enable the 5-output cap.

---

## 9. Scripts / commands

| Command | Description |
| --- | --- |
| `npm run dev` | Next dev server (used for local testing). |
| `npm run build` | `prisma generate` + `next build`. Run before deploying. |
| `npm run lint` | Next.js ESLint. |
| `npx prisma db push` | Apply schema to the MySQL database. Required after changing `prisma/schema.prisma`. |

---

## 10. Deployment notes

- Target: Cloudways Node app.
- Build command: `npm run build`.
- Start command: `npm run start`.
- Ensure env vars configured via Cloudways panel.
- Remember to push Prisma schema before the first deploy or when Document columns change.

---

## 11. Known quirks / TODOs

- No schema migrations tracked—`db push` is manual. Consider generating SQL migrations if you need version history.
- Saved documents default to 5 most recent (see `page.tsx`). Adjust `take` if you need a longer history.
- When guest limit is off, the register gate is hidden entirely; toggling the env vars will show/hide the UI.
- The docx export is synchronous; for very large documents you may want to stream or offload to a worker.

---

With this context you should be able to work on Forgetaboutit Writer confidently. If you add major features (e.g., multi-user chat, analytics), update this document so the next person inherits the breadcrumbs. Happy shipping! 🚀

