<div align="center">

# Studiq

**An AI-powered personalization engine for tutors. The AI learns your teaching style and applies it per student.**

Built solo &nbsp;·&nbsp; [Live](https://studiq-three.vercel.app) &nbsp;·&nbsp; Next.js 15 · Hono · Postgres · Claude

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

### Engineering decisions worth calling out

- **Race-safe approvals** — three writes in one transaction gated on `WHERE status = 'pending'`. Two teachers approving the same user concurrently can't both win. → `routes/approvals.ts`
- **Reactive UI by default** — one Supabase channel, 10 tables, one hook translates events to React Query invalidations. No manual refetch anywhere. → `hooks/use-realtime-sync.ts`
- **Defense-in-depth auth** — HttpOnly JWT + parallel readable `{role, status}` cookie for middleware routing. CSRF via `X-Requested-With`, rate-limited, lifecycle states enforced in middleware. → `middleware/auth.ts`
- **Cold-start friendly DB** — Drizzle behind a `Proxy`, opens on first use; auto-detects Supabase pooler and disables prepared statements. → `db/client.ts`
- **Bilingual** — Hebrew (RTL) and English from one stylesheet, one Vercel project, one cookie scope.

### Stack

Next.js 15 · React 19 · TypeScript · Tailwind v4 · TanStack Query · Hono · Drizzle · Zod · Supabase (Postgres + Auth + Realtime) · Anthropic Claude · pnpm + Turborepo · Vercel

### By the numbers

17 Postgres tables · 10 realtime channels · 23 pages · 16 Zod-validated routes · 5 Claude-powered services

---

<div align="center">

<a href="mailto:arelreifmannn@gmail.com">Arel Reifman</a> · <a href="https://www.linkedin.com/in/arelreifman/">LinkedIn</a> · <a href="https://github.com/ArelReifman">GitHub</a>

</div>
