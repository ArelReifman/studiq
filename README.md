<div align="center">

# Studiq

**A full stack personalization engine built to scale adaptive lesson planning and student profiling.**

Built solo &nbsp;·&nbsp; [Live](https://studiq-three.vercel.app) &nbsp;·&nbsp; Next.js 15 · Hono · Postgres · Claude

</div>

---

Built out of a real tutoring workflow: the tutor teaches, the AI watches, and every lesson that follows is shaped by both the tutor's style and the student's progress. Two students studying the same subject get different lessons. The more feedback and sessions in the system, the sharper the personalization becomes.

### Adaptive lesson planning and student profiling

Claude is integrated across five coordinated services to capture tutoring patterns, build dynamic student profiles, and generate adaptive content:

| Service | Reads | Produces |
|---|---|---|
| **Style learner** | tutor feedback, notes, manually-authored lessons | `teaching_style_summary` |
| **Profile builder** | completed/failed tasks, flagged difficulties | `student_ai_profile` — topic strengths, gaps, learning style |
| **Difficulty tagger** | a flagged task | topic labels that update the profile |
| **Report writer** | last 7 days of activity | weekly summary + gap-based recommendations |
| **Lesson generator** | teaching style + student profile | tailored lesson, homework, todos |

→ `apps/api/src/services/ai/`

### Feedback-driven workflow

Progress tracking feeds directly into the recommendations loop. Completed and failed tasks, difficulty flags, topic-level tags, and per-student exam dates all accumulate over time — surfacing learning gaps and improving what the AI generates next.

```
   tutor writes feedback / notes / manual lessons
                         │
                         ▼
              [1] teaching_style_summary ──────────┐
                                                    │
   student works, completes tasks, flags difficulty │
                         │                          │
                         ▼                          │
                  [3] tag topics                    │
                         │                          │
                         ▼                          │
              [2] student_ai_profile ───────────────┤
                         │                          │
                         ▼                          ▼
                          [5] generate lesson (personalized)
                         │                          │
                         ▼                          ▼
                    new lesson            [4] weekly report
                         │
                         └──▶ student work ──▶ back to top
```

### Authentication and role-based access control

Two roles — tutor and student — with fully separate workflows, data visibility, and lifecycle states:

- Students self-register (land as **pending**, require tutor approval) or join via invite link (auto-approved, skips queue)
- Tutors manage approvals, assign courses, set per-student exam date overrides, and control topic locking
- HttpOnly JWT + parallel readable `{role, status}` cookie for edge middleware routing
- CSRF via `X-Requested-With`, per-route rate limiting, lifecycle enforcement in middleware

### Engineering highlights

- **Race-safe approvals** — three writes in one transaction gated on `WHERE status = 'pending'`. Two tutors approving the same student concurrently can't both win. → `routes/approvals.ts`
- **Reactive UI** — one Supabase Realtime channel, 10 tables, one hook translates all events to React Query invalidations. No manual refetch anywhere. → `hooks/use-realtime-sync.ts`
- **Per-student exam dates** — student-level override wins over the course default, so students at different universities or on different exam cycles each see their own countdown and urgency signals
- **Cold-start DB** — Drizzle behind a `Proxy`, opens on first use; auto-detects Supabase pooler and disables prepared statements. → `db/client.ts`
- **Bilingual** — Hebrew (RTL) and English from one stylesheet, one Vercel project, one cookie scope

### Stack

Next.js 15 · React 19 · TypeScript · Tailwind v4 · TanStack Query · Hono · Drizzle · Zod · Supabase (Postgres + Auth + Realtime) · Anthropic Claude · pnpm + Turborepo · Vercel

### By the numbers

18 Postgres tables · 10 Realtime channels · 25 pages · 16 Zod-validated routes · 5 Claude-powered services

---

<div align="center">

<a href="mailto:arelreifmannn@gmail.com">Arel Reifman</a> · <a href="https://www.linkedin.com/in/arelreifman/">LinkedIn</a> · <a href="https://github.com/ArelReifman">GitHub</a>

</div>
