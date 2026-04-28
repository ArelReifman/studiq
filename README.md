<div align="center">

# Studiq

**An AI-native tutoring platform that turns one-to-many teaching into one-to-one.**

[Live demo](https://studiq-three.vercel.app) &nbsp;·&nbsp; Built with Next.js 15, Hono, Supabase, and Claude

</div>

---

## The problem

Private tutors spend more time preparing than teaching. Every student needs material calibrated to their level, their gaps, their pace, and their last lesson. A teacher with twenty students can either standardise lessons (and lose the value of being private) or burn out re-creating worksheets every night.

## The idea

Studiq lets a teacher run a personal "AI co-pilot" per student. The teacher manages the syllabus and approves accounts; the AI authors the actual lessons, conditioned on each student's profile, weak topics, recent reflections, and the teacher's feedback. Students get a focused dashboard with a single active lesson plus practice tasks. Difficulties are surfaced back to the teacher in real time so the next lesson learns from the last.

The product runs in Hebrew (RTL) and English, with the same codebase serving both directions correctly.

## How it works at a glance

```
                ┌───────────────────────────────────────────────┐
                │                Next.js 15 (web)               │
                │  Teacher dashboard · Student dashboard        │
                │  Approvals · Learning map · Profile · i18n    │
                └────────────────────┬──────────────────────────┘
                                     │ HttpOnly cookie auth (JWT)
                                     ▼
                ┌───────────────────────────────────────────────┐
                │           Hono API (single-origin)            │
                │  Zod validation · CSRF gate · rate limit      │
                │  Status middleware blocks pending users       │
                └───┬───────────────┬──────────────────┬────────┘
                    │               │                  │
                    ▼               ▼                  ▼
              Supabase auth   Postgres + Drizzle   Anthropic Claude
              (status enum,    (lessons, tasks,    (lesson generator,
              role metadata)   reports, AI profile) feedback loop)
                    │
                    ▼
              Telegram bot — push notifications to the teacher
              when a student requests access
```

Everything runs on a single Vercel project. The API is mounted as a Next.js route handler, so there is one origin, one cookie domain, and no cross-site dance.

## What I'm proud of

A few engineering choices I'd happily defend in an interview.

#### Approval flow that survives concurrency

The teacher's approval action does three writes (flip `status`, create `students`, create `student_ai_profiles`) inside a transaction. The status flip uses `WHERE status = 'pending'`, so two teachers approving the same user simultaneously can't both succeed; the loser sees a `409`. Idempotent inserts let a retry after a partial failure resume cleanly.
> `apps/api/src/routes/approvals.ts`

#### Defense-in-depth auth

The token lives in an HttpOnly cookie (XSS-resistant), and a parallel readable cookie carries `{role, status}` so Next.js middleware can route correctly without an extra round trip. Every state-changing request is gated by a custom `X-Requested-With` header (CSRF). Every payload passes Zod. Auth endpoints are rate-limited to 20/min per IP. A `pending` user can hit `/auth/me` and `/auth/logout` and nothing else.
> `apps/api/src/middleware/auth.ts`, `apps/web/src/middleware.ts`

#### Notifications without yet-another-SaaS

The teacher gets a real-time push the moment a student registers, without signing up for SendGrid, Twilio, or Resend. A 30-line helper posts to the Telegram Bot API; user-supplied text is HTML-escaped before going on the wire. Env-gated, error-swallowing — the notification can never break the registration request.
> `apps/api/src/lib/notify.ts`

#### Cold-start friendly DB client

Drizzle is wrapped in a `Proxy` so the connection is opened on first use, not at module import. That keeps Vercel cold starts fast and lets the test runner import the client without a live DB. The client also auto-detects Supabase pooler URLs (port 6543) and disables prepared statements, which would otherwise break under PgBouncer transaction mode.
> `apps/api/src/db/client.ts`

#### One i18n source of truth

Direction (`dir`) is set once on the root `<html>` element from the locale cookie and inherits down. Components don't carry hardcoded `dir` attributes. Strings live in two flat JSON files with `{name}`-style interpolation; missing keys fall back to English, and finally to the key itself, so the UI never blanks out on a typo.
> `apps/web/src/i18n/index.ts`

#### Learning map as a single component, two roles

The same React component renders the teacher's "where is this student stuck?" view and the student's "what's my path?" view. Role flag controls labels, AI recommendation strip, and CTAs; everything else is shared. Status colours and progress rings are pure functions of the data.
> `apps/web/src/components/learning-map/learning-map-view.tsx`

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 (App Router), React 19 | Server components for the layout shell, client components where state lives |
| Styling | Tailwind v4, Plus Jakarta Sans | RTL-aware utilities (`start`/`end`, `rtl:`) so one stylesheet serves both directions |
| API | Hono on Node | Tiny, fast, mounts cleanly inside Next's `/api/*` |
| ORM | Drizzle | Type-safe SQL, painless transactions, easy to read at the call site |
| DB | Supabase Postgres | Auth, row-level security, realtime subscriptions in one place |
| AI | Claude (Anthropic) | Lesson generation conditioned on student profile + teacher feedback |
| Notifications | Telegram Bot API | Free, push-to-pocket, no extra signup |
| Auth | Supabase Auth + JWT | Status field on `profiles` is the single source of truth gated in middleware |
| Infra | pnpm + Turborepo + Vercel | One deploy, one URL, one cookie scope |

## Project structure

```
apps/
  web/   Next.js app — pages grouped by role: (auth) (teacher) (student)
  api/   Hono routes:
           auth        login / register / forgot password
           approvals   teacher review queue
           profile     self-service name / email / password
           lessons     active lesson + history per role
           difficulties student-flagged blockers, surfaced per-student
           learning-map stats engine for the topic graph
           reports / feedback / bookings / availability / courses
packages/
  types/ Shared TS types — both apps import the same shapes
infrastructure/
  supabase/ Migrations + seed
```

## Running locally

Requires Node ≥ 22 and pnpm ≥ 10.

```bash
pnpm install
cp .env.example .env   # fill: DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY,
                       #       SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY,
                       #       TELEGRAM_BOT_TOKEN (optional), TELEGRAM_CHAT_ID (optional)
pnpm --filter @studiq/api db:migrate
pnpm dev
```

Web runs on `http://localhost:3002`, API on `:3003`.

> **Pooler URLs:** Supabase's direct connection is IPv6-only. On IPv4 (home ISP, most CI), use the **Transaction Pooler**: `postgres.<ref>:<pw>@aws-<region>.pooler.supabase.com:6543/postgres`. The DB client detects port `6543` and disables prepared statements automatically.

## Tests

```bash
pnpm test                            # full suite
pnpm --filter @studiq/api test:watch # API watch mode
pnpm test:coverage                   # coverage report
```

## Deployment

A push to `main` triggers a Vercel build. Web and API ship as one project — the API mounts under `/api/*` inside the Next.js app, so there is no separate service to keep alive and no cross-origin auth.

---

<div align="center">

Built by <a href="mailto:arelreifmannn@gmail.com">Arel Reifman</a>

</div>
