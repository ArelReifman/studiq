# Learning Map — Logic Contract

> **Status:** binding design contract.
> Any feature that touches lessons, topics, tasks, courses, reviews, or course
> assignment **must** comply with the rules below. This is documentation only —
> it describes the intended behaviour and the current implementation, and flags
> known gaps as "Future fixes".

The Learning Map is computed on demand by `GET /learning-map`. There is **no
stored progress** — `pct`, `status`, `locked`, and `latest_lesson_id` are all
derived per request from the underlying rows. The frontend never recomputes
progress; it only renders what the API returns.

---

## 1. Core entities

| Entity | Table | Role in the map | Key link |
|--------|-------|-----------------|----------|
| **Course** | `courses` | Root of the map; holds default `exam_date` | `course_id` |
| **Topic** | `course_topics` | Node in the map; hierarchical (`parent_topic_id`), with `prerequisite_topic_ids`, `is_locked`, `target_date` | `topic_id` |
| **Lesson session** | `lesson_sessions` | Learning content tied to a topic; `status ∈ active | completed | archived`; carries `topic_id`, `course_id` | `lesson_id` |
| **Task** (homework / todo) | `homework_items`, `todo_items` | Unit of progress; `status ∈ pending | completed | failed`; belongs to a `lesson_id` | `lesson_id` |
| **Difficulty report** | `difficulty_reports` | Signal for the AI profile; **does not** directly affect progress % | `student_id`, polymorphic `source_id` |
| **Teacher AI feedback** | `teacher_ai_feedback` | Trains the AI tutor; optionally references a lesson via `source_lesson_id` | `student_id`, `source_lesson_id` |
| **Booking (calendar lesson)** | `bookings/teacher-lesson` | Time/calendar event — **fully decoupled from the map** | `student_id`, `teacher_id` |

> **Golden rule:** a "content lesson" (`lesson_sessions`) is **not** the same as a
> "calendar booking" (`bookings`). Only the former is counted by the map. The
> Hebrew word "שיעור" is overloaded across both — keep the UI labels distinct
> ("שיעור חדש" for content, "קביעת פגישה" for calendar).

---

## 2. What counts as progress

### Tasks vs. lessons
- **Has tasks** (`tasks_total > 0`) → progress is driven by tasks only.
- **No tasks** (`tasks_total === 0`) → fall back to completed lessons.

### `pct` formula
```
tasks_total   > 0  → round(tasks_completed   / tasks_total   * 100)
lessons_total > 0  → round(lessons_completed / lessons_total * 100)
otherwise          → 0
```

### `status` derivation
| Status | Condition |
|--------|-----------|
| `struggling` | `tasks_total > 0` AND `tasks_failed > 0` AND `tasks_completed < tasks_total / 2` |
| `mastered` | (tasks) all tasks completed and no failures · (lessons) `lessons_completed === lessons_total` |
| `in_progress` | partial progress (tasks or lessons) |
| `not_started` | no tasks and no completed lessons |

> **Single source of truth:** `computeStatus()` and the `pct` formula live in
> `apps/api/src/routes/learning-map.ts`. The frontend must never recompute them.

---

## 3. Required IDs per flow

| Flow | student_id | teacher_id | course_id | topic_id | lesson_id |
|------|:---:|:---:|:---:|:---:|:---:|
| `GET /learning-map` | required (self / owned by teacher) | — | derived if absent | — | — |
| Create lesson | required | required | required | required | — |
| Open lesson | required | — | — | — | required (`latest_lesson_id`) |
| Delete lesson | — | required (ownership) | — | — | required |
| Review lesson | — | required | preferred | — | required |
| Complete / fail task | required | — | — | via lesson | required |
| Lock / unlock topic | — | required | required | required | — |
| Change student course | required | required | required | — | — |

> **Contract:** every new lesson **must** be saved with both `topic_id` **and**
> `course_id`. A lesson without `course_id` is invisible to the map (it filters
> on both). A lesson without `topic_id` is counted globally but not per topic.

---

## 4. Mutation impact matrix

For each action: does it change map data, and what is the required backend/cache
behaviour?

| Action | Affects map? | Backend requirement | Cache requirement |
|--------|:---:|---------------------|-------------------|
| Create lesson | yes | persist `topic_id` + `course_id` | invalidate `["learning-map"]` |
| Delete lesson | yes | hard delete; null out `teacher_ai_feedback.source_lesson_id` first (FK has no ON DELETE) | invalidate `["learning-map"]` |
| Review lesson (`next_level`/`next_topic`) | yes | set `lesson.status = "completed"` | invalidate `["learning-map"]` |
| Review lesson (`repeat`) | no status flip | leave `status` as-is | invalidate `["learning-map"]` (failed tasks may change) |
| Complete task | yes | task status → completed | invalidate `["learning-map"]` |
| Fail task | yes | task status → failed | invalidate `["learning-map"]` |
| Delete task | yes | remove task row | invalidate `["learning-map"]` |
| Lock / unlock topic | yes | toggle `is_locked` | invalidate `["learning-map"]` |
| Edit course topics | yes | topic CRUD | invalidate `["learning-map"]` |
| Change `exam_date` / override | yes (deadlines) | upsert override | invalidate `["learning-map"]` |
| Add course to student | yes (map may switch course) | join-table insert | invalidate `["learning-map"]` *(gap — see §10)* |
| Remove course from student | yes | join-table delete | invalidate `["learning-map"]` *(gap — see §10)* |
| AI generate lesson | yes | persist `topic_id` + `course_id` | invalidate `["learning-map"]` *(not yet wired — see §10)* |
| Schedule calendar booking | **no** | none | none — bookings never touch the map |

---

## 5. Required React Query invalidations

`["learning-map"]` is a **prefix**. Invalidating it covers both the student
variant `["learning-map", "self"]` and the teacher variant
`["learning-map", { student_id, course_id }]`.

| Surface (file) | Mutation | Invalidates `["learning-map"]`? |
|----------------|----------|:---:|
| `components/teacher/create-lesson-modal.tsx` | create lesson | ✅ |
| `app/(teacher)/teacher/students/[id]/page.tsx` | delete lesson | ✅ (added in `8ee3e3a`) |
| `components/teacher/lesson-review-modal.tsx` | review lesson | ✅ |
| `components/student/task-item.tsx` | complete / fail task | ✅ |
| `app/(teacher)/teacher/students/[id]/map/page.tsx` | lock/unlock, exam-date | ✅ |
| `app/(teacher)/teacher/courses/[id]/page.tsx` | course topic edits | ✅ |
| `app/(teacher)/teacher/students/[id]/page.tsx` | add / remove course | ❌ **gap** — only invalidates `["students", id]` |

> **Rule:** any mutation that changes a lesson, task, topic, or course
> assignment must call `qc.invalidateQueries({ queryKey: ["learning-map"] })`
> in `onSettled` / `onSuccess`.

---

## 6. Duplicate lesson rules

- **Product rule:** a topic has **one `active` lesson at a time**. Completed
  lessons are retained as history.
- **`latest_lesson_id`** always points to the newest lesson for that
  topic + student (ordered by `generated_at desc`), regardless of status.
- **Clicking "create" when one already exists** should not happen — the UI
  already switches to "open lesson" once `latest_lesson_id` is present
  (the single-action contract, §7).
- **Defense in depth (current):** the UI is the only guard.
- **Defense in depth (future):** `POST /lessons/create` could become idempotent
  per topic — return the existing `active` lesson instead of inserting another
  (see §10). Not yet implemented.

---

## 7. UI rules

Exactly **one primary action per topic**, rendered on the active topic card.
Never show two buttons that both create lessons.

| Button | Shown when | Action |
|--------|-----------|--------|
| **"צור שיעור"** (create lesson) | `lessons_total === 0` (teacher, topic unlocked) | `onCreateLesson(topic_id)` → opens `CreateLessonModal` |
| **"פתח שיעור"** (open lesson) | `lessons_total > 0` AND `latest_lesson_id` present | `onOpenLesson(latest_lesson_id)` → navigate to the lesson |
| **"צפה בשיעורים"** (view lessons) *(future)* | `lessons_total > 1` and a history list is wanted | navigate to a lesson list filtered by `topic_id` |
| Student, no lesson | "start" / "continue" status hint | `onCreateLesson` → dashboard fallback |

Navigation targets (role-aware, built by the page, never guessed):
- Teacher → `/teacher/students/:id/lessons/:lessonId`
- Student → `/student/lessons/:lessonId`

Post-action expectations:
- **After delete:** map refreshes immediately. If the last lesson is gone, the
  action flips from "פתח שיעור" back to "צור שיעור", `pct → 0`,
  `latest_lesson_id → null`.
- **After review (`next_level`/`next_topic`):** the lesson becomes `completed`,
  topic progress rises. `repeat` does **not** mark completed.

---

## 8. Edge cases

| # | Case | Expected behaviour |
|---|------|--------------------|
| 1 | Lesson without `topic_id` | counted globally, not per topic; does not set `latest_lesson_id` |
| 2 | Lesson without `course_id` | invisible to the map — **must be prevented at creation** |
| 3 | Brand-new student (zero activity) | Option B: lock everything, unlock only the first root topic (+ first child); per-request, never written to DB |
| 4 | Delete the only lesson in a topic | `lessons_total → 0`, `pct → 0`, `latest_lesson_id → null`, button → "צור שיעור" |
| 5 | Multiple lessons in a topic | `latest_lesson_id` = newest; "פתח שיעור" opens it |
| 6 | Manual lock + unmet prerequisite | `locked = is_locked OR prerequisite_not_mastered` (either source locks) |
| 7 | Per-student exam-date override | overrides `course.exam_date`; `effective_deadline = topic.target_date ?? exam` |
| 8 | Switching a student's active course | map must re-derive; requires invalidation (see §10) |
| 9 | Teacher without ownership of the student | `GET /learning-map` returns 404 |
| 10 | Delete a task that changed the ratio | `pct` / `status` recomputed; requires invalidation |
| 11 | Parent topic with children | lessons attach to a leaf (sub-topic), not the parent |
| 12 | Delete a lesson that has AI feedback | `teacher_ai_feedback.source_lesson_id` is nulled first, then the lesson is deleted (FK would otherwise block — fixed in `97238e1`) |
| 13 | `archived` lessons | currently counted by the map (no status filter) — see §10 for the robustness gap |

---

## 9. Implementation checklist

**Backend — source of truth for calculation:**
- `apps/api/src/routes/learning-map.ts` — `computeStatus`, `pct`, `locked`, `latest_lesson_id`, Option B
- `apps/api/src/routes/lessons.ts` — create/delete/review; persist `topic_id` + `course_id`; mark `completed`; null `source_lesson_id` before delete
- `packages/types/src/database.ts` — `LearningMapTopic`, `TopicStats` (the type contract)

**Frontend — invalidation + UI:**
- `apps/web/src/app/(teacher)/teacher/students/[id]/page.tsx` — delete, add/remove course
- `apps/web/src/components/teacher/create-lesson-modal.tsx` — create
- `apps/web/src/components/teacher/lesson-review-modal.tsx` — review
- `apps/web/src/components/student/task-item.tsx` — tasks
- `apps/web/src/components/learning-map/learning-map-view.tsx` — single-action rule
- `apps/web/src/app/(teacher|student)/.../map/page.tsx` — role-aware `onOpenLesson`

---

## 10. Future fixes

Ordered by priority. None of these are required for current correctness except
where noted.

1. **Faster refresh after delete.** Invalidation already works; consider an
   optimistic update of the map (mirroring the lessons-list optimistic update)
   so the topic action flips instantly instead of after the refetch round-trip.

2. **Invalidate `["learning-map"]` on add/remove student course.**
   `app/(teacher)/teacher/students/[id]/page.tsx` currently invalidates only
   `["students", id]`. Changing a student's course set can change the inferred
   map course, leaving it stale. (Matrix gap in §4/§5.)

3. **Backend duplicate prevention.** Make `POST /lessons/create` idempotent per
   `(student_id, topic_id)` for `active` lessons — return the existing one
   instead of inserting a second. The UI already prevents this in the happy
   path; this closes the API-level hole (§6).

4. **AI lesson generation from a Learning Map topic.** Wire the existing
   `POST /lessons/generate` (already accepts an optional `topic_id` in the
   stashed change) to a Learning Map button so AI lessons attach to the topic.
   Must also invalidate `["learning-map"]` on success (§4).

5. **Status filtering robustness (optional).** Decide whether `archived` lessons
   should count toward `lessons_total`. If not, add a status filter to the
   map's lesson query so archived lessons are excluded (§8 case 13).

6. **Unify list vs. map filters.** `GET /lessons` filters by `teacher_id`
   (no course); `GET /learning-map` filters by `course_id` (no teacher). Align
   the filtering contract so the two surfaces can never disagree on counts.
