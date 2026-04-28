<div align="center">

# Studiq

**One teacher, twenty students, a personalised lesson per student per day.**

[Live](https://studiq-three.vercel.app) &nbsp;·&nbsp; Next.js 15 · Hono · Postgres · Claude

</div>

---

An AI-tutor platform built solo. Teachers approve student accounts, the AI authors lessons conditioned on each student's history, and difficulties feed back into the next lesson. One Vercel project, one cookie scope, ships in Hebrew and English.

### By the numbers

| | |
|---|---|
| **Pages** | 23 (App Router, RSC + client islands) |
| **API surface** | 16 route modules, every payload Zod-validated |
| **Locales** | Hebrew (RTL) + English, single stylesheet |
| **Auth states** | `pending → approved → rejected`, gated in middleware |
| **Deploy** | 1 origin, 1 cookie scope, 1 push to `main` |

### Architecture

```
   Next.js 15 (web)  ──HttpOnly JWT──▶  Hono API (Zod · CSRF · rate-limit)
        │                                       │
   readable cookie                              ├──▶  Postgres + Drizzle
   {role, status}                               ├──▶  Claude (lesson author)
        │                                       └──▶  Telegram (teacher push)
        ▼
   middleware.ts decides where you land
```

### Things I'd defend in an interview

#### Race-safe approvals
Three writes (`status` flip, `students` insert, `student_ai_profiles` insert) inside one transaction. The status flip uses `WHERE status = 'pending'`, so two teachers approving the same user concurrently can't both win. Loser sees `409`. Idempotent inserts let a retry resume after a partial failure.
→ `apps/api/src/routes/approvals.ts`

#### Defense-in-depth auth
HttpOnly cookie for the JWT (XSS-resistant) plus a parallel readable cookie carrying `{role, status}` so middleware can route without a round-trip. Every state-changing request gated by `X-Requested-With` (CSRF). 20 req/min/IP on auth. Pending users can hit `/auth/me` and `/auth/logout` and nothing else.
→ `apps/api/src/middleware/auth.ts`

#### Cold-start friendly DB client
Drizzle wrapped in a `Proxy` — connection opens on first use, not on module import. Tests can import the client without a live database. Auto-detects Supabase pooler URLs (port 6543) and disables prepared statements, which break under PgBouncer transaction mode.
→ `apps/api/src/db/client.ts`

#### No-SaaS notifications
A 30-line helper hits the Telegram Bot API. Awaited so Vercel's serverless function doesn't suspend the promise; error-swallowing so a Telegram outage can't break registration. User-supplied text is HTML-escaped before going on the wire.
→ `apps/api/src/lib/notify.ts`

#### One stylesheet, both directions
`dir` set once on `<html>` from the locale cookie, inherits everywhere. Tailwind `start` / `end` / `rtl:` utilities. Translation lookup falls back locale → English → key, so a missing string never blanks the UI.
→ `apps/web/src/i18n/index.ts`

### Stack

| | |
|---|---|
| Web | Next.js 15 (App Router), React 19, Tailwind v4 |
| API | Hono on Node 22, Zod, Drizzle |
| DB / Auth | Supabase (Postgres + Auth) |
| AI | Anthropic Claude (lesson generation + analysis) |
| Push | Telegram Bot API |
| Infra | pnpm workspaces, Turborepo, Vercel |

### Run locally

```bash
pnpm install
cp .env.example .env       # DATABASE_URL · SUPABASE_* · ANTHROPIC_API_KEY · TELEGRAM_* (optional)
pnpm --filter @studiq/api db:migrate
pnpm dev
```

`http://localhost:3002` (web) · `:3003` (API)

---

<div align="center">

Built by <a href="mailto:arelreifmannn@gmail.com">Arel Reifman</a>

</div>
