# AI Personalization Architecture

> **Status:** planning document. No code described here is implemented yet.
> It captures the agreed product contract and the target architecture for making
> StudIQ genuinely learn — from each student and from the teacher's own working
> style — so that future lessons and retry lessons become progressively more
> personalized, accurate, and aligned with the teacher.
>
> This document is the source of truth for the multi-phase AI personalization
> effort. It does **not** authorize any schema change, migration, async work,
> Planner/Critic, RAG, or pgvector. Each phase below ships behind its own branch,
> PR, flag, and tests.

---

## 0. Required reading before any change

| Concern | Document |
|---------|----------|
| Anything touching lessons / topics / tasks / progress | `docs/LEARNING_MAP_CONTRACT.md` |
| Any new Supabase table / Realtime / Data API | `docs/SUPABASE_DATA_API_GRANTS.md` |
| Retry-lesson constraints (text-only, archive, one-active guard) | `docs/PHASE_AI_0_5_RETRY_LESSON.md` |
| Pending `topic_id` threading (read-only; superseded — do **not** apply) | `stash@{0}` |

---

## 1. Current state (grounded in code)

### What the system learns today

| Signal | Source | State quality |
|--------|--------|---------------|
| Task failures | `homework_items` / `todo_items` `status='failed'` (+ `marked_at`) | structured, reliable |
| Difficulty reports | `difficulty_reports` (`description="Failed todo: X"`, AI-guessed `topic_tags`) | weak / generic |
| Teacher verdict | `lesson_sessions.teacher_decision` + `teacher_review_note` | structured + text, strong signal |
| Student reflection | `lesson_sessions.student_reflection` | free text |
| Student profile | `student_ai_profiles`: `weak_topics` / `strong_topics` (free-text arrays, **not** linked to `course_topics.id`), `learning_style` (enum), `ai_summary` (Haiku-rewritten blob) | semi-structured; "memory" is a text blob |
| Teacher insights | `student_insights` (append-only, timestamped) | high-quality free text |
| Teacher style | `teachers.teaching_style_summary` (single free-text blob) + `teaching_feedback_count` | not structured; rewritten every review |

### Key facts verified in the schema

- **`teacher_ai_profiles` does not exist.** Teacher style is a single text column.
- **`ai_context_vectors` (pgvector, 1536 dims) + `vector_type` enum exist but are dead.** `similarLessons` is hardcoded `[]` in `generate-lesson.ts`.
- **`lesson_status` = `active | completed | archived`** — no async states.
- **`student_ai_profiles` is per-student** (`unique(student_id)`), **not** per `(student, course, topic)`.
- **The Learning Map stores no progress** — `pct` / `status` / `locked` / `latest_lesson_id` are derived per request (`LEARNING_MAP_CONTRACT.md` §2). Any new stored state must stay decoupled from that computation.
- All seven AI flows route through one `callClaude`. (Phase 1A adds per-flow model routing + privacy-safe metrics; Phase 1B adds a dedicated retry prompt — both on feature branches, not yet merged.)

---

## 2. Key gaps

1. No structured state per `(student, course, topic)` — only a global per-student profile.
2. No structured misconceptions or method-outcome ("what worked / what failed").
3. No capture of the delta between the AI draft and the teacher's final version → the system never learns from the teacher's manual edits.
4. Teacher style is a single free-text blob, not structured, rewritten on every review.
5. No async generation → synchronous Sonnet blocks (~105s observed).
6. Retrieval sends thin/global context instead of focused, topic-scoped context.

---

## 3. Product Contract

1. **The system proposes; the teacher decides.** No automatic action ever reaches the student.
2. **Every inference carries evidence + confidence + last_updated.** No claim without evidence.
3. **Pattern ≠ event.** An insight becomes "active" only above an occurrence threshold.
4. **Structured leads, free text complements.** `ai_summary` is a derived layer, not the source of truth.
5. **Student Learning State is an AI memory — not a source of truth for the map.** The Learning Map keeps computing `pct` / `status` / `locked` on demand; the new state never feeds them.
6. **The teacher sees and controls everything the system "believes":** approve / reject / edit / "do not use this method again".
7. **`next_level` / `next_topic` behavior is unchanged.** The student's uploaded solution file is never sent to Claude (text only).
8. **Teacher-style learning is cumulative only** — never updated from a single change.

### Decisions that require teacher approval

| Decision | Requires approval? |
|----------|:---:|
| Lesson name | Yes — AI proposes 3–5, teacher picks/edits |
| Difficulty level | Yes — AI proposes, teacher confirms |
| Lesson goal | Yes — shown before generation / at review |
| Topic transition | Yes, always — never automatic (today's `next_topic` is already manual) |
| Teaching method | Yes — proposed in the draft, replaceable |

---

## 4. Proposed Student Learning State

> **Not implemented yet — proposed design.** `student_topic_state` does **not**
> exist in the schema today. The only student-level memory that exists now is the
> per-student `student_ai_profiles` (§1).

New **server-only** table `student_topic_state`, keyed `(student_id, course_id, topic_id)`:

| Column | Type | Content |
|--------|------|---------|
| `mastery_level` | enum / numeric | not_started / struggling / developing / proficient (+ confidence) |
| `recurring_misconceptions` | jsonb[] | `{text, occurrences, first_seen, last_seen, confidence, status:active/resolved}` |
| `strengths` | jsonb[] | `{concept, evidence_count}` |
| `failed_task_refs` | uuid[] | failed task ids (refs, not content) |
| `successful_methods` | jsonb[] | `{method, worked_count, last_used}` |
| `failed_methods` | jsonb[] | `{method, failed_count, last_used}` |
| `recent_progress` | jsonb | summary of the last N lessons |
| `summary` | text | secondary free-text summary |
| `evidence` | jsonb | pointers to lesson/task ids that support the state |
| `confidence` | numeric | overall 0–1 |
| `updated_at` | timestamptz | |

Storage policy: **Template B (server-only)** — RLS enabled, no GRANTs / policies / publication. Reached only through the API (Drizzle / `service_role`). The teacher insights screen reads via endpoints, not the Data API.

---

## 5. Proposed Teacher Style State

> **Not implemented yet — proposed design.** `teacher_style_state` does **not**
> exist. Today the teacher's style is the single `teachers.teaching_style_summary`
> free-text column (§1).

Replace the single free-text blob with a structured, server-only table `teacher_style_state`:

- `structure_prefs` jsonb — example-first vs theory-first; task length; "when to advance".
- `tone_terms` jsonb — recurring terminology, tone.
- `edit_patterns` jsonb — `{what: removed/added/difficulty_changed/method_changed, count}`.
- `naming_style` jsonb — patterns in the names the teacher chooses.
- `summary` text (secondary) · `confidence` · `signals_count` · `updated_at`.

Teacher learning stays **separate** from student learning and updates **only above a threshold** of repeated signals — never from a single edit.

---

## 6. Full data flow

```
student completes tasks → marks failed/completed (+ marked_at)
  → [Analyzer] after review: analyzes performance / failures / review_note /
      reflection / teacher edits → structured signals only
  → update student_topic_state (occurrence counts, confidence, methods)
  → update teacher_style_state (cumulative, only above threshold)

teacher clicks "generate" / "retry"
  → [Retrieval] pulls focused context (NOT the whole student page)
  → [Planner]  → plan: goal, primary failure point, method, task order, difficulty
                 (excludes already-failed methods)
  → [Generator] → content per the plan only (Sonnet, async)
  → [Critic]   → checks fit / repetition / level / relevance / JSON
  → ready_for_review → teacher sees draft + 3–5 name suggestions + goal + level
  → teacher approve/edit → store final + delta (ai_draft ↔ final)
  → next lesson's results flow back into the Analyzer
```

---

## 7. Component split: Analyzer / Planner / Generator / Critic

> **Not implemented yet — target design.** Today there is a single
> `generateLesson` and no separate components. Analyzer, Planner, the
> Generator-as-plan-writer, and Critic below are the proposed split, not current
> code.

- **Analyzer** (Haiku, async after review): input = performance, failures, `teacher_review_note`, `student_reflection`, the teacher's edit delta. Output = **structured signals only** (misconceptions, method_outcome, mastery_delta). Never writes a lesson.
- **Planner** (Sonnet or Haiku): input = `student_topic_state` + Learning Map + `teacher_style_state`. Output = a **structured plan** (goal, primary_failure, method, task_order, difficulty); excludes `failed_methods`.
- **Generator** (Sonnet, 8192 tokens): receives the plan **only** and writes content into the existing JSON schema. This is today's `generateLesson`, narrowed to "write to a plan".
- **Critic** (Haiku, optional gate): before showing the teacher — matches feedback? repeats prior content? fits the level? all tasks relevant? valid JSON? Returns pass/fail + reasons; failure → regenerate (bounded) or flag for the teacher.

---

## 8. Retrieval strategy

Pull **only** for `(student, course, topic)`: the topic's `student_topic_state`; the last 1–2 lessons on that topic (title + description + task list); `failed_task_refs` + their descriptions; `difficulty_reports` matched by `source_id` of those tasks; `successful_methods` / `failed_methods`; the latest `teacher_review_note`; Learning Map prerequisites; top-K `student_insights`. **Never** the whole student page or full history.

**Ranking** (weighted): `topic_match` (highest) → `repeated_failure` → `teacher_priority` (note / decision) → `recency` → `evidence_confidence`. Cut to a token budget with a per-source cap.

---

## 9. Learning from the teacher's edits

For each AI generation, store `ai_draft` (the generated JSON snapshot) and `final` (after the teacher's edits) → compute the delta: what was removed / added / difficulty changed / method changed / which name was chosen from the suggestions. The delta accumulates into `teacher_style_state.edit_patterns`. **Profile updates only above a threshold** (e.g. a pattern recurring across ≥3 edits) — never from a single edit. Draft storage: the existing `ai_generation_context` jsonb column, or a dedicated `lesson_drafts` table.

---

## 10. Async architecture

> **Not implemented yet — proposed design.** Generation is **synchronous** today;
> `lesson_generation_jobs`, the async states, and the job endpoints do not exist.
> `lesson_status` is only `active | completed | archived` (§1).

Sonnet generation ~105s → the teacher must not wait in a blocking modal. States: `queued → generating → ready_for_review → approved | failed`.

- **Recommendation:** a dedicated `lesson_generation_jobs` table (server-only) rather than polluting `lesson_sessions` (so the map's lesson counts are not affected — the lesson row is created only on approval, or in a non-counting state).
- **Trigger:** `POST /lessons/generate` returns immediately with a `job_id` (202) and kicks off a background job.
- **Status to the browser:** start with **polling** `GET /lessons/jobs/:id` (simple, no grants). Future upgrade: add the table to Realtime (Template A) for push.
- `@vercel/functions waitUntil` is already used (Telegram), but a ~105s job is better run as a Vercel Background Function / cron-drainer than inside a single request.

---

## 11. Does this need new schema?

**Yes — but staged, and not in the first step.** The prompt layer (Phases 1B/1C) improves relevance with **no** schema change. The new layers require:

- `student_topic_state` (new, server-only)
- `teacher_style_state` (new, server-only)
- `lesson_generation_jobs` (new, server-only) — for async
- optional: a `generation_status` column for async, and `lesson_drafts` / reuse of `ai_generation_context`.

All are **Template B** (RLS on, no GRANTs) per `SUPABASE_DATA_API_GRANTS.md`.

---

## 12. RAG / pgvector — now or later?

**Not now.** Relational data is focused enough (student + course + topic + failed tasks + methods). pgvector earns its place only when there is a large volume of **unstructured** history where semantic similarity helps (e.g. "find similar lessons across courses"). The `ai_context_vectors` table already exists and is dormant — leave it.

**Adoption trigger:** when relational retrieval demonstrably misses relevant context that lives only in free text, and there is a critical mass of lessons. Until then — relational only.

---

## 13. Proposed API endpoints

- `POST /lessons/generate` → `202 {job_id}` (async; keeps `retry_of_lesson_id`).
- `GET /lessons/jobs/:id` → `{status, lesson_id?, error?}` (polling).
- `POST /lessons/jobs/:id/approve` → creates/activates the final `lesson_session` + stores the delta.
- `GET /students/:id/topic-state?course&topic` → insights screen.
- `PATCH /student-topic-state/:id` → approve / reject / edit / "do not use this method".
- `GET /teacher/style-state` + `PATCH` → view / correct teacher style.

---

## 14. Background job strategy

A cron-based drainer (a cron already exists in the project) or a Vercel Background Function: the request writes a `queued` job → the drainer pulls it → `generating` → Analyzer/Planner/Generator/Critic → `ready_for_review`. Each step writes its status. Per-attempt timeout; bounded max retries.

---

## 15. Idempotency & failure recovery

- **Idempotency:** key on `(student, course, topic, retry_of_lesson_id)` — an existing active job is returned instead of creating a second (mirrors the existing retry guard).
- **Recovery:** a `generating` job past its timeout → `failed` with a reason; manual retry allowed. Critic failure → bounded regenerate, then flag for the teacher. No lesson is created if generation fails (as today).

---

## 16. Privacy & security risks

- All new tables are **server-only** (RLS on, no grants) — no Data API exposure.
- **Do not** log content / names / ids (same policy as Phase 1A metrics); the state stores refs (ids), not sensitive content where avoidable.
- The student's solution file never enters the prompt (text only).
- Edit deltas are stored server-side only; the insights screen is behind teacher auth + student ownership (like the `learning-map` 404-for-non-owner rule).

---

## 17. Quality metrics

**Product:** retry success rate · reduction in repeated mistakes · mastery recovery · teacher acceptance rate (drafts approved without edits) · teacher edit rate · time-to-complete.

**Technical (on top of Phase 1A metrics):** `claude_ms` / `call_ms` per stage (analyzer / planner / generator / critic) · regenerate rate · Critic pass rate · job failure rate.

---

## 18. Phased implementation (small commits)

| Phase | Scope | Schema? |
|-------|-------|:---:|
| **1B** (done, on branch) | Dedicated feedback-focused retry prompt | No |
| **1C** | Enrich retry context from existing data: failed-task descriptions, difficulty_reports by `source_id`, `student_reflection`, previous lesson content, `student_insights`; per-source length caps; tests | No |
| **2A** | `student_topic_state` table + Analyzer writing structured signals after review; Planner reads it | Yes |
| **2B** | Explicit Planner (structured plan) + inject `failed_methods` as a hard constraint | No (uses 2A) |
| **2C** | Teacher-style learning — `teacher_style_state` + capture `ai_draft ↔ final` delta | Yes |
| **2D** | Critic (quality gate) behind a flag | Maybe |
| **2E** | Async — `lesson_generation_jobs` + polling + non-blocking UX + 3–5 name suggestions for approval | Yes |

Each phase: its own branch + PR, behind a flag, with tests; rollback by flag.

---

## 19. Decision log / current direction

1. Save this architecture document (this file).
2. Implement **Phase 1C only** (prompt context enrichment from existing data — no schema).
3. Run a Preview test and judge whether relevance improves materially.
4. **Only if structured memory is still missing**, start `student_topic_state` + Analyzer (Phase 2A).

This staged approach validates how much quality the existing relational data can deliver — through better prompting alone — before committing to any new schema, async infrastructure, Planner/Critic, RAG, or pgvector.
