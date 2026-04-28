<div align="center">

# Studiq

**A multi-tenant tutoring platform. Teachers manage their students, the AI writes the lessons, and every screen updates live.**

[Live](https://studiq-three.vercel.app) &nbsp;·&nbsp; Next.js 15 · Hono · Postgres · Claude

</div>

---

End-to-end production system, built solo. A teacher signs up, gets a roster of approved students, sees their progress in real time, and every lesson the AI authors is conditioned on that specific student's history. Hebrew (RTL) and English from one codebase, one Vercel project, one cookie scope.

### By the numbers

| | |
|---|---|
| **Postgres tables** | 17 (`profiles`, `students`, `lessons`, `tasks`, `reports`, `bookings`, `difficulties`, `feedback`, …) |
| **Realtime channels** | 10 tables streamed via Supabase WebSocket — every dashboard updates without refresh |
| **Pages** | 23 (App Router, RSC + client islands) |
| **API surface** | 16 route modules, every payload Zod-validated, all role-gated |
| **Locales** | Hebrew (RTL) + English from one stylesheet |
| **Lifecycle states** | `pending → approved → rejected`, enforced in middleware |
| **Deploy** | 1 origin, 1 cookie scope, 1 push to `main` |

### Domain model

```
   profiles ─┬─▶ teachers ──┬─▶ courses ──▶ topics
             │              │
             └─▶ students ──┴─▶ lesson_sessions ──▶ homework_items
                  │                                ▶ todo_items
                  ├─▶ student_ai_profiles
                  ├─▶ student_reports
                  ├─▶ difficulty_reports ───▶ teacher (review queue)
                  └─▶ lesson_bookings ─────▶ teacher_availability
```

A teacher owns many students, every student carries a live AI profile + history, and every action a student takes (a failed task, a flagged difficulty, a saved reflection) feeds the next lesson the AI generates.

### Architecture

```
   Next.js 15 (web)  ──HttpOnly JWT──▶  Hono API  ──▶  Postgres + Drizzle
        │                                  │             ▲
        │ readable cookie                  ├──▶  Claude  │
        │ {role, status}                   └──▶  Telegram│
        │                                                │
        └──── Supabase Realtime ◀────WebSocket───────────┘
              (10 tables → useQuery cache invalidation, no refresh)
```

A push to a Postgres table flows through Supabase Realtime, hits a hook on the client, and invalidates the React Query cache for the affected entity. The teacher's dashboard reflects a student's submission within a second.

### Engineering highlights

#### Race-safe approvals
Three writes (`status` flip, `students` insert, `student_ai_profiles` insert) inside one transaction. The status flip uses `WHERE status = 'pending'`, so two teachers approving the same user concurrently can't both win. Loser sees `409`. Idempotent inserts let a retry resume after a partial failure.
→ `apps/api/src/routes/approvals.ts`

#### Live UI on top of an authoritative DB
A single `useRealtimeSync` hook subscribes to 10 tables on one Supabase channel and translates each event into a React Query invalidation. No manual refetch loops anywhere in the codebase; every dashboard, badge, and counter is reactive by default.
→ `apps/web/src/hooks/use-realtime-sync.ts`

#### Defense-in-depth auth
HttpOnly cookie for the JWT (XSS-resistant) plus a parallel readable cookie carrying `{role, status}` so middleware can route without a round-trip. Every state-changing request gated by `X-Requested-With` (CSRF). 20 req/min/IP on auth. A `pending` user can hit `/auth/me` and `/auth/logout` and nothing else.
→ `apps/api/src/middleware/auth.ts`

#### Cold-start friendly DB client
Drizzle wrapped in a `Proxy` — connection opens on first use, not on module import. Tests can import the client without a live database. Auto-detects Supabase pooler URLs (port 6543) and disables prepared statements, which break under PgBouncer transaction mode.
→ `apps/api/src/db/client.ts`

#### Notifications without yet-another-SaaS
A 30-line helper hits the Telegram Bot API. Awaited so Vercel's serverless function doesn't suspend the promise; error-swallowing so a Telegram outage can't break registration. User-supplied text is HTML-escaped before going on the wire.
→ `apps/api/src/lib/notify.ts`

### Stack

| | |
|---|---|
| Web | Next.js 15 (App Router), React 19, Tailwind v4, TanStack Query |
| API | Hono on Node 22, Zod, Drizzle ORM |
| DB / Auth / Realtime | Supabase (Postgres + Auth + WebSocket subscriptions) |
| AI | Anthropic Claude (lesson generation, analysis, feedback loop) |
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
