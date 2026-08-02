<div align="center">

# Studiq

**An AI-powered personalization engine for tutors. The AI learns your teaching style and applies it per student.**

Built solo &nbsp;·&nbsp; [Live](https://studiq-three.vercel.app) &nbsp;·&nbsp; Next.js 15 · Hono · Postgres · Claude

[![CI](https://github.com/ArelReifman/studiq/actions/workflows/ci.yml/badge.svg)](https://github.com/ArelReifman/studiq/actions/workflows/ci.yml)

</div>

---

A tutor approves a student, the AI watches how the tutor teaches *and* how the student learns, and every generated lesson is shaped by both. Two students of the same tutor get different lessons. Two tutors of the same student would too.

### What the AI does

| Loop | Reads | Writes |
|---|---|---|
| **Style learner** | your feedback, notes, manually-authored lessons | `teaching_style_summary` |
| **Profile builder** | completed/failed tasks, tagged difficulties | `student_ai_profile` (strong/weak topics, learning style) |
| **Difficulty tagger** | a flagged task | topic labels |
| **Report writer** | last 7 days of activity | weekly summary + recommendations |
| **Lesson generator** | all of the above | tailored lesson + homework + todos |

→ `apps/api/src/services/ai/`

### The personalization loop

```
   teacher writes feedback / notes / manual lessons
                         │
                         ▼
              [1] teaching_style_summary ──┐
                                           │
   student does work / flags difficulty    │
                         │                 │
                         ▼                 │
                  [3] tag topics           │
                         │                 │
                         ▼                 │
              [2] student_ai_profile ──────┤
                         │                 │
                         ▼                 ▼
                          [5] generate lesson
                         │                 │
                         ▼                 ▼
                    new lesson    [4] weekly report
                         │
                         └──▶ student work ──▶ back to top
```

### Hard problems solved along the way

- **Getting valid JSON out of an LLM, every time** — free-text lesson generation failed intermittently in production on malformed JSON. Fixed in layers: structured tool output so the schema is enforced by the API, a single bounded repair pass for payloads that still arrive broken, routing generation to Sonnet, and longer function timeouts for slow generations. → `services/ai/generate-lesson.ts`
- **Changing a live AI loop without breaking it** — the retry-lesson flow (regenerate a lesson from the teacher's failure feedback) touches lesson status, learning-map recovery, and the review path. It shipped purely additively: a written isolation map of every existing path that must stay byte-identical, an API-level guard against duplicate active retries, and the old lesson archived only after a successful retry is created — never before. → `docs/PHASE_AI_0_5_RETRY_LESSON.md`
- **A 5-second learning map** — first paint was blocked ~4–5.5s by sequential DB queries and a per-request auth round-trip. Backend queries were parallelized and resources moved to one fetch per course/student scope with client-side topic filtering. All of it is bound by a written behaviour contract: any optimization that lets a mutation's result appear later than the contract requires is wrong by definition. → `docs/LEARNING_MAP_CONTRACT.md`, `docs/LEARNING_MAP_PERFORMANCE.md`
- **Multi-course without a rewrite** — student course selection threaded incrementally through bookings, approvals, Telegram notifications, calendar sync, and lesson filtering — each step landing separately with route-level tests (`bookings-course.test.ts`, `lessons-course-filter.test.ts`, `student-courses.test.ts`).

### Engineering decisions worth calling out

- **Race-safe approvals** — three writes in one transaction gated on `WHERE status = 'pending'`. Two teachers approving the same user concurrently can't both win. → `routes/approvals.ts`
- **Reactive UI by default** — one Supabase channel, 11 tables, one hook translates events to React Query invalidations. No manual refetch anywhere. → `hooks/use-realtime-sync.ts`
- **Defense-in-depth auth** — HttpOnly JWT + parallel readable `{role, status}` cookie for middleware routing. CSRF via `X-Requested-With`, rate-limited, lifecycle states enforced in middleware. → `middleware/auth.ts`
- **Production hardening** — CSP assembled at config time with a dynamic `connect-src` (same-origin proxy by default, split API origin when configured), HSTS preload, COOP, and a middleware matcher that lets `robots.txt`/`sitemap.xml` bypass the auth redirect so crawlers see the real files. → `next.config.ts`
- **Docs as guardrails** — risky changes start as a planning doc with hard constraints and an isolation map before any code; performance work is logged per-phase against a binding behaviour contract. → `docs/`
- **Cold-start friendly DB** — Drizzle behind a `Proxy`, opens on first use; auto-detects Supabase pooler and disables prepared statements. → `db/client.ts`
- **Bilingual** — Hebrew (RTL) and English from one stylesheet, one Vercel project, one cookie scope.

### Stack

Next.js 15 · React 19 · TypeScript · Tailwind v4 · TanStack Query · Hono · Drizzle · Zod · Supabase (Postgres + Auth + Realtime) · Anthropic Claude · pnpm + Turborepo · Vercel

### Latest features

- **Retry lessons** — when a student fails, the teacher can generate a new AI lesson built from the failure feedback and the existing learning-map context, with the old lesson archived automatically
- **Usage analytics** — student logins, lesson progress, and learning-map activity tracked and surfaced in a teacher-facing dashboard
- **Per-student topic locks** — teachers can lock or unlock individual topics per student, overriding the course-level progression
- **Students list search & filter** — teachers find students quickly by name, course, or status
- **Multi-course students** — course selection propagates through bookings, approvals, notifications, and calendar sync
- **Per-student exam dates** — teachers can override course exam dates for individual students taking exams at different universities or mo'ed dates

### How this was built

Every commit in this repo carries a `Co-Authored-By: Claude` trailer — that's deliberate, not an accident. AI wrote a lot of this code, and I think that's the least interesting fact about the repo. The interesting part is the process that makes AI-written code safe to ship:

- **Plan before code** — risky changes start as a planning doc with hard constraints and an isolation map of every existing path that must stay byte-identical (see `docs/PHASE_AI_0_5_RETRY_LESSON.md`)
- **Every change is verified** — CI (lint, type check, tests) runs on every push and every PR; features land with route-level tests
- **Small, reviewable steps** — 330+ focused commits with real commit messages, worked through numbered PRs, never a `wip` dump
- **Binding contracts** — the learning map has a written behaviour contract; any optimization that violates it is wrong by definition, no matter how fast it is

AI is the power tool. The architecture, the constraints, and the judgment about what's safe to ship are the engineering.

### By the numbers

27 Postgres tables · 11 realtime-synced tables · 24 pages · 18 Zod-validated routes · 6 Claude-powered services

---

<div align="center">

<a href="mailto:arelreifmannn@gmail.com">Arel Reifman</a> · <a href="https://www.linkedin.com/in/arelreifman/">LinkedIn</a> · <a href="https://github.com/ArelReifman">GitHub</a>

</div>
