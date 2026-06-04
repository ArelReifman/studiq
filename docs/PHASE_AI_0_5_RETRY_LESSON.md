# Phase AI-0.5 — Generate Retry Lesson After `repeat`

> **Status:** planning document (revised for safety). No code has been written
> yet. This describes the intended behaviour and the design decisions agreed
> before implementation. It is a **prerequisite** to the broader Phase AI-1 and
> should ship first.

---

## 0. Safety constraints (hard rules — do not violate)

This change must be **purely additive and isolated**. The top priority is **not
breaking any existing logic**. The following are hard constraints, agreed before
any code:

1. **Do not change existing behaviour** unless a constraint below explicitly
   requires it.
2. **Do not touch `learning-map.ts`** — the recovery / mastery logic stays the
   single source of truth, untouched.
3. **No schema change. No migration.**
4. **Do not change auth / RLS / GRANT.**
5. **Do not change `next_level` / `next_topic` behaviour** (the review path at
   `lessons.ts` that flips failed→completed + marks the lesson completed stays
   byte-for-byte identical).
6. **Do not change upload / Telegram logic.**
7. **Do not start broad AI-1.**
8. **No automatic retry generation** — the retry lesson is created **only** when
   the teacher manually clicks "Generate retry lesson".
9. **`repeat` alone must keep behaving exactly as today** — it stores the
   decision + runs the AI-profile refresh, and **does not** change any lesson
   status. No archiving happens on `repeat` by itself.
10. **The old lesson is never marked `completed`.** It is archived **only**
    during a successful retry creation, never before.
11. **The backend must prevent duplicate active retry lessons** — a frontend
    disable is not sufficient; an API-level guard is required.
12. **If any step is found unsafe during implementation, stop and explain
    before changing code.**

### Isolation map — what each existing path keeps doing

| Existing path | After AI-0.5 |
|---------------|--------------|
| `PATCH /lessons/:id/review` with `repeat` | **unchanged** — no status flip, profile refresh runs |
| `PATCH /lessons/:id/review` with `next_level` / `next_topic` | **unchanged** — flips failed→completed, marks lesson completed |
| `learning-map.ts` recovery / `computeStatus` | **unchanged** — not edited at all |
| `POST /lessons/create` idempotency guard | **unchanged** |
| `POST /lessons/generate` without `retry_of_lesson_id` | **unchanged** — legacy behaviour preserved |
| Upload / Telegram / auth / RLS | **unchanged** |

The **only** new write paths are: (a) an optional `retry_of_lesson_id` branch in
`POST /lessons/generate`, and (b) a new CTA in the review modal. Everything else
is read-only reuse.

---

## 1. Problem

When a student fails work, the loop is currently **broken at the `repeat`
decision**:

- A student fails tasks → `homework_items` / `todo_items` flip to `status='failed'`.
- A `difficulty_report` is created; `weak_topics` / `total_failures` update.
- The Learning Map derives the topic as `struggling`.
- The teacher reviews the lesson and selects one of three decisions
  (`repeat` / `next_level` / `next_topic`).
- `next_level` and `next_topic` **close the loop** — they flip failed tasks to
  completed, mark the lesson `completed`, and resolve difficulty reports.
- **`repeat` is metadata only.** It stores `teacher_decision='repeat'` and
  triggers an AI-profile refresh, but it does **not** create a retry lesson or
  any additional practice. Nothing actionable happens next.

The result: the teacher signals "the student needs another pass," but the system
provides no pass. Both teacher and student are left with no next step. This is
the single highest-value gap to close before AI-1.

---

## 2. Product behaviour

Two-step, **teacher-triggered** (never automatic):

1. The teacher reviews a lesson and selects **`repeat`**, then saves.
   (Unchanged from today — no lesson status flip, AI profile refresh runs.)
2. After a successful `repeat` review, a CTA appears:
   **"צור שיעור תרגול חוזר"** (Generate retry lesson).
3. The teacher clicks the CTA **manually**.
4. The system, in one flow/transaction:
   - **archives** the previous active lesson, and
   - **creates a new active retry lesson** for the same student / course / topic,
     with an AI prompt enriched by the failure context.

Why teacher-triggered and not automatic: keeps teacher control, avoids burning
AI calls on every `repeat`, and lets the teacher explain face-to-face first when
they prefer to. The CTA delivers real value without deciding for the teacher.

### CTA placement — resolves a conflict with current modal behaviour

**Current behaviour to preserve:** `lesson-review-modal.tsx` calls `onClose()`
inside the mutation's `onSuccess`, so the modal **closes automatically** after a
successful review. The original draft said "the modal shows a CTA after a
successful repeat" — that contradicts the auto-close.

**Resolution (chosen):** when `decision === "repeat"`, **keep the modal open**
after a successful save instead of closing it, and swap the action row for the
CTA. Concretely: branch `onSuccess` so that for `repeat` it does **not** call
`onClose()` but flips local state to reveal the CTA; for `next_level` /
`next_topic` it closes exactly as today (**their behaviour is unchanged**). The
change is confined to the `repeat` branch only.

> Alternative (rejected for now): close the modal and surface the CTA as a badge
> on the lesson card. More files touched, more state to thread — deferred.

---

## 3. Technical approach

- Extend the body of `POST /lessons/generate` with an optional
  `retry_of_lesson_id: uuid`.
- When present:
  - **Validate** the old lesson exists and belongs to the same teacher **and**
    student (ownership check, same pattern as the other lesson routes).
  - **Validate the anchor is still live** — the old lesson's `course_id` must be
    one of the student's **active** courses (`student_courses.is_active`), and
    the `topic_id` (if any) must still exist. If the course is no longer active,
    return a clear error instead of anchoring the retry to an archived course
    (which would make the new lesson **invisible on the map**, since the map only
    renders active courses). This is a new validation, but it only guards the new
    retry branch — no existing path changes.
  - **Reuse** the old lesson's `course_id` / `topic_id` as the retry anchor
    (an explicit `topic_id` in the request, if sent, still wins).
  - **Duplicate-active guard (required).** Inside the same transaction, after
    archiving, re-check for an existing `active` lesson on
    `(student, course, topic)` — if one already exists, **return it** instead of
    inserting a second. This mirrors the idempotency guard already on
    `POST /lessons/create` and makes the retry branch safe under concurrency
    (double-click, two tabs, network retry). A frontend disable alone is **not**
    sufficient. See §4.
  - **Archive** the old lesson (`status='archived'`) in the **same
    flow/transaction** that creates the retry lesson — the archive is coupled to
    retry creation, so it only happens when a replacement is actually made.
  - Build a `retryContext` and pass it into `generateLesson` →
    `buildLessonGenerationPrompt`.
- **Generate a new full `lesson_session`** (not extra homework on the old
  lesson, not a separate "practice set" object). This reuses the entire existing
  `generateLesson` infrastructure and lets the Learning Map handle it naturally.
- **Store retry metadata in `ai_generation_context`** (an existing `jsonb`
  column) as `{ mode: "retry", retry_of_lesson_id }`. **No schema migration.**
  *Conscious trade-off:* `jsonb` is not indexed, so "find all retries of lesson
  X" is not an efficient query. Acceptable for this phase (traceability only); a
  queryable column is deferred until a retry-history feature actually needs it.

The existing idempotency guard lives only on `POST /lessons/create` (manual
creation), **not** on `POST /lessons/generate`, so retry generation is not
blocked at the API level. The one-active-lesson invariant is preserved
deliberately by archiving the predecessor **plus** the in-transaction
duplicate-active guard above (see §4), not by relying on the frontend.

---

## 4. Active-lesson invariant

**Rule:** exactly one `active` lesson per `(student, course, topic)`.

- **Do not** mark the old failed lesson `completed`.
- **Archive** the old lesson **only when the retry is actually created**, in the
  same transaction. If the teacher never clicks the CTA, the old lesson stays
  `active` and visible — nothing breaks.
- On `repeat` alone, the old lesson stays `active` (current behaviour, contract §4).
- **Duplicate prevention is at the API, not the UI.** The in-transaction
  re-check (§3) means a double click / second tab / network retry returns the
  already-created retry instead of inserting a second `active` lesson. The
  frontend still disables the CTA while pending, but correctness does **not**
  depend on it.

### Note on `total_lessons`

`generateLesson` increments `student_ai_profiles.total_lessons`; archiving the
predecessor does **not** decrement it, so each retry adds one to the count. This
is acceptable — a retry is a real lesson the student worked through — but it is a
**known, intentional** effect, not a bug. We do not adjust the counter (doing so
would mean touching the profile-update accounting, which is out of scope).

### Why `completed` is wrong

The Learning Map's active-failure recovery logic (`learning-map.ts`,
`noteSuccess` / `isResolvedFailure`) treats a lesson's `completed_at` as a
**success signal that overturns earlier failures on the same topic**. Marking
the failed lesson `completed` would therefore make the topic jump to `mastered`
even though the student has not yet succeeded — a false positive.

`archived` avoids this: archived lessons are still counted toward topic totals
(so the failed tasks keep the topic `struggling`), but `archived` does **not**
trigger `noteSuccess`. The failure stays real until the student genuinely
succeeds on the retry. No change to `learning-map.ts` is required.

---

## 5. Prompt context

Passed into `buildLessonGenerationPrompt` via a new `retryContext`. **Text only**
— never the uploaded solution file.

Include:

- **Failed task titles** from the old lesson (`homework_items` / `todo_items`
  with `status='failed'`).
- **`teacher_review_note`** of the old lesson.
- **`teacher_decision = repeat`**, framed as "the teacher determined the student
  needs more practice at the same level."
- **`difficulty_reports`** — already fetched inside `generateLesson`
  (`recentDifficulties`), so no new query is needed.

Framing for Claude:

> This is a **retry / practice lesson** on the **same topic at the same level**.
> The student previously struggled with: \[failed task titles]. Teacher's note:
> "\[...]". Produce **alternative** exercises — do not repeat the identical
> tasks; approach the weak points from a different angle with fresh examples.

Explicitly **out of prompt:** the student's uploaded solution file is not read.

---

## 6. Files likely involved

| File | Change |
|------|--------|
| `apps/api/src/routes/lessons.ts` | `+retry_of_lesson_id` in `/generate` schema; ownership + active-course validation; in-transaction duplicate-active guard; atomic archive of predecessor |
| `apps/api/src/services/ai/generate-lesson.ts` | `retryContext` in `GenerateLessonOpts`; fetch failed tasks + review note |
| `apps/api/src/services/ai/prompts.ts` | retry section in `buildLessonGenerationPrompt` |
| `apps/web/src/components/teacher/lesson-review-modal.tsx` | CTA "צור שיעור תרגול חוזר" after `repeat`; mutation to `/generate` |
| `docs/LEARNING_MAP_CONTRACT.md` | §4 mutation matrix row; §6 duplicate rules; §10.4 update |
| relevant tests | see §8 |

Possibly: `packages/types` for the request field and i18n strings. The Learning
Map view retry button is **optional and deferred** to a later phase.

---

## 7. Out of scope

- No schema migration.
- No RAG / vector retrieval.
- No reading of uploaded solution files by Claude.
- No `learning-map.ts` refactor.
- No practice-only (homework-without-lesson) endpoint yet.
- No automatic retry generation — teacher-triggered only.

---

## 8. Test plan

1. **`repeat` alone does not archive** — the old lesson stays `active`; only
   metadata + AI-profile refresh run (regression on contract §4).
2. **Clicking generate retry archives + creates** — old lesson → `archived`, a
   new `active` lesson is created with the same `topic_id` (Claude mocked).
3. **Old failed lesson still contributes to `struggling`** — after archive, the
   failed tasks are still counted; the topic remains `struggling`.
4. **Retry success allows recovery/mastery later** — completing the new retry
   tasks (later `marked_at`) overturns the old failures via existing recovery
   logic, and the topic can reach `mastered`.
5. **No duplicate active retry lessons (concurrency)** — fire two retry requests
   for the same `(student, course, topic)` (simulating double click / two tabs);
   assert the **API guard** returns the same lesson and only **one** `active`
   lesson exists. This must hold even without the frontend disable.
6. **Prompt includes retry context** — unit test on `buildLessonGenerationPrompt`
   asserting failed task titles + teacher note appear when `retryContext` is set.
7. **Learning Map updates correctly** — `latest_lesson_id` points to the new
   lesson; `pct` reflects the added pending tasks; status stays
   `struggling` / `in_progress`.
8. **Edge: retry on a lesson without `topic_id`** — falls back gracefully to
   `resolveTopic` (course-level), does not crash.
9. **Edge: retry when the anchor course is no longer active** — the old lesson's
   course was archived for the student; assert the endpoint returns a clear error
   and creates **no** lesson (does not produce a map-invisible lesson).
10. **Regression: `next_level` / `next_topic` unchanged** — explicit test that
    the review path still flips failed→completed and marks the lesson completed,
    proving AI-0.5 did not alter it.
11. **Regression: `learning-map.ts` untouched** — existing map/recovery tests
    still pass unmodified.

Extend existing patterns in `lesson-progress.test.ts`, `lesson-dedup.test.ts`,
and `learning-map-recovery.test.ts`.

---

## 9. Risks and rollback

**Risk level: low** (additive + isolated; no migration, no schema, no
`learning-map.ts` change; reuses the existing `generate` pipeline and recovery
logic).

- **Primary risk — AI cost / prompt quality:** contained by the teacher-triggered
  CTA (no automatic generation).
- **Secondary risk — duplicate active retries under concurrency:** mitigated by
  the **in-transaction API guard** (§3/§4), with the frontend disable as a
  second, non-load-bearing layer.
- **Tertiary risk — map-invisible lesson from a stale anchor:** mitigated by the
  active-course validation (§3) that errors instead of creating such a lesson.
- **Residual risk — `repeat` semantics drift:** mitigated by an explicit
  regression test (§8.10) asserting `next_level` / `next_topic` and the `repeat`
  no-status-flip behaviour are unchanged.

**Rollback:** the change is additive and reversible in layers:
1. Hide the CTA in `lesson-review-modal.tsx` → feature is gone from the user's
   side, backend untouched-by-callers.
2. The `retry_of_lesson_id` parameter is optional → `POST /lessons/generate`
   behaves exactly as before when omitted.
3. No data migration to undo; archived lessons can be flipped back to `active`
   manually if ever needed.

---

## 9b. Safe implementation order

Backend-first, tests before UI, so the invariant is proven before anything is
clickable:

1. **Backend, `/generate` retry branch** — add `retry_of_lesson_id`; ownership
   validation; active-course/topic validation; **in-transaction duplicate-active
   guard**; atomic archive of predecessor. (No behaviour change when the param is
   absent.)
2. **`generateLesson` + `prompts.ts`** — `retryContext` (failed task titles +
   teacher note); retry framing in the prompt.
3. **Backend tests** — all of §8, including the concurrency test (§8.5), the
   stale-anchor test (§8.9), and the `next_level`/`next_topic` regression
   (§8.10). **Gate: these must pass before touching the frontend.**
4. **Frontend** — keep the modal open on `repeat`, reveal the CTA, wire the
   mutation, disable while pending. `next_level`/`next_topic` branches untouched.
5. **Docs** — update `LEARNING_MAP_CONTRACT.md` §4/§6/§10.4.

If any step surfaces a conflict with existing behaviour, **stop and escalate**
before proceeding (constraint §0.12).

---

## 10. Recommendation

**Implement Phase AI-0.5 before the broad Phase AI-1.**

- It is the same work already flagged as "remaining" in
  `LEARNING_MAP_CONTRACT.md` §10.4 (wire a button to send `topic_id`).
- It surfaces and resolves the active-lesson invariant in the retry flow that
  any broader AI-1 design would otherwise inherit.
- It is small, low-risk, and closes a visible broken UX loop — immediate value.
- It proves the `topic_id → generate → map` pipeline end-to-end at small scale
  before AI-1 expands on it.
