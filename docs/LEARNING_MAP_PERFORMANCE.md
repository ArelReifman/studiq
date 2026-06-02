# Learning Map — Performance Tracking

> **Status:** living document. Tracks Learning Map performance work and phased
> optimizations. Updated as each phase lands.

## 1. Purpose

This file tracks **performance work** on the Learning Map: observed latency
baselines, completed optimization phases, planned phases, and a template for
documenting each future phase. It is a chronological log of *how* the map is
made faster — not a description of *what* the map computes.

For the behavioural / data / API contract, see
[`LEARNING_MAP_CONTRACT.md`](./LEARNING_MAP_CONTRACT.md).

---

## 2. Relationship to `LEARNING_MAP_CONTRACT.md`

- **`LEARNING_MAP_CONTRACT.md` is the binding behaviour / data / invalidation
  contract.** It is the source of truth for *what* the map must do.
- **This performance file must not contradict or weaken that contract.** It only
  describes *how* we make the same behaviour faster.
- **Any optimization must preserve the invalidation rules in §4 (Mutation impact
  matrix) and §5 (Required React Query invalidations) of the contract.** Caching,
  deferral, or request-reduction work may change *when* data is fetched, but must
  never cause the map to display stale data after a mutation that the contract
  says invalidates `["learning-map"]` (or the related resource caches).

> **Rule of thumb:** if a performance change makes a mutation's result appear
> later than the contract requires, the change is wrong — revisit it.

---

## 3. Current baseline symptoms

Observed network timings (production-like, cold/warm mix). These are the numbers
we are optimizing against.

| Request | Baseline | Notes |
|---------|----------|-------|
| `GET /learning-map` | ~4–5.5s | dominant blocker on first paint; sequential backend DB queries + per-request auth tax |
| `GET /exam-date` | ~2–3s | teacher map only; not required for first paint |
| `GET /learning-resources` | ~1.3s (after Phase 1) | now fetched once per course/student scope instead of per topic |
| Layout calls (`students` / `courses` / `*/count`) | ~1–3s | global layout queries; each pays the per-request auth round-trip |
| Topic switching | no repeated `learning-resources` fetches (after Phase 1) | client-side filtering only; cache hit on topic change |

---

## 4. Completed — Phase 1

**Phase name:** ResourcesSection cache key optimization

- **Commit:** `6fbc469` — `fix: avoid resource refetch on topic switch`
- **File changed:** `apps/web/src/components/learning-resources/resources-section.tsx`
- **Change:** removed `topic_id` from the `learning-resources` React Query key.
  The `queryFn` already fetches course/student-scoped resources without sending
  `topic_id` to the API; `topic_id` is used only for local client-side subtree
  filtering (`visibleResources`).
- **Result:** switching parent topics in the Learning Map no longer refetches
  `/learning-resources`. The full course/student scope is fetched once and shared
  across all topics from cache; per-topic filtering happens client-side.
- **Contract compliance:** unchanged. The delete/upload mutations still invalidate
  the `["learning-resources"]` prefix (prefix invalidation is independent of
  `topic_id`), so §4/§5 invalidation semantics are preserved.
- **Status:** deployed / verified (CI run `26723473652` — success).

---

## 5. Planned phases

Ordered, but not all are committed-to yet. Each is expanded using the template in
§6 when it is picked up.

- **Phase 2A — Frontend perceived-performance improvement.** *(implemented — see §7)*
  Make the map *feel* faster before the network completes via a loading
  skeleton that mirrors the map layout.

- **Phase 2B — Reduce non-critical initial requests.**
  Defer or gate requests that are not needed for first paint:
  `/exam-date`, `/learning-resources`, and the student page's `/lessons`
  (currently fired on mount despite being needed only on a "continue" click).

- **Phase 2C — Optimize `GET /learning-map` backend.** *(implemented — see §8)*
  Parallelize the independent sequential DB queries in
  `apps/api/src/routes/learning-map.ts`, combine the ownership + active-courses
  lookups, and verify indexes on the filtered columns. No behaviour change —
  same response, fewer serial round-trips.

- **Phase 2D — Auth / global latency investigation (investigation only).**
  Investigate the per-request `supabase.auth.getUser()` round-trip + profile DB
  query in `apps/api/src/middleware/auth.ts`, which taxes **every** endpoint.
  Security-sensitive and broad — **investigation and proposal only**, no code
  changes under this phase without separate explicit approval.

---

## 6. Future phase template

Every future phase entry must include all of the following fields.

### Phase N — <name>

- **Phase name:** short label.
- **Goal:** the user-visible or measured outcome we want.
- **Problem:** what is slow today and why (with the responsible file/line where known).
- **Scope:** exactly what is in and out of scope (frontend-only? backend-only? which files?).
- **Files touched:** explicit list of files.
- **Exact changes:** precise description of the edits (before/after snippets where useful).
- **Before network behavior:** measured/expected request pattern and timings before the change.
- **After network behavior:** expected request pattern and timings after the change.
- **Test plan:** typecheck/build, manual QA steps, what to watch in the network panel.
- **Risks:** correctness, cache/staleness (must check against contract §4/§5), regression surface.
- **Rollback plan:** how to revert safely (single commit revert? feature flag?).
- **Status:** planned / in progress / deployed / verified / reverted.

---

## 7. Phase 2A — Learning Map loading skeleton

- **Phase name:** Learning Map loading skeleton (perceived-performance).
- **Goal:** Make the Learning Map *feel* responsive immediately by showing a
  visual skeleton that mirrors the map layout while `GET /learning-map` is in
  flight, instead of a blank stage with a small centered "loading…" text.
- **Problem:** During load, both map pages rendered only a tiny centered text
  (`map.loading` / `map.loadingMap`) over an empty stage for the full
  ~4–5.5s `GET /learning-map` round-trip, so the page looked frozen/blank.
- **Scope:** Frontend-only, presentational. No data logic, no network, no
  React Query keys, no backend/auth/DB. Error and empty states left unchanged.
- **Files touched:**
  - `apps/web/src/components/learning-map/learning-map-skeleton.tsx` *(new)*
  - `apps/web/src/app/(student)/student/map/page.tsx`
  - `apps/web/src/app/(teacher)/teacher/students/[id]/map/page.tsx`
  - `docs/LEARNING_MAP_PERFORMANCE.md`
- **Exact changes:**
  - Added a presentational `<LearningMapSkeleton />` component (no props, no
    fetch) that renders gray `animate-pulse` placeholders matching the real
    `<LearningMapView>` chrome: topbar + stat chips, side panel, horizontal
    topic-card row, and the detail panel.
  - Student map page: replaced the `isLoading` text block with
    `<LearningMapSkeleton />` wrapped in a `flex-1 min-h-0 flex flex-col`
    container.
  - Teacher map page: same replacement in its `isLoading` block.
  - `error` / empty (`!effectiveCourseId`) states unchanged.
- **Before network behavior:** unchanged — same requests, same timings. (This
  is a perceived-speed change only; it adds **zero** network requests.)
- **After network behavior:** unchanged — identical request pattern and
  timings. Only the loading visual differs.
- **Test plan:**
  - `pnpm typecheck` green.
  - Manual QA: load student map and teacher map; confirm the skeleton appears
    immediately and is swapped cleanly for the real map when data arrives.
  - Confirm error and empty states (course without topics, teacher without
    courses) still show their existing text, not a stuck skeleton.
  - Network panel: confirm no new requests were introduced.
- **Risks:** Very low. Purely visual, isolated in one new component plus two
  `isLoading`-branch swaps. Cannot affect contract §4/§5 invalidation because
  it touches no fetch/cache logic.
- **Rollback plan:** single-commit `git revert` (new component + two branch
  swaps + this doc section). No DB/auth/cache side-effects.
- **Status:** implemented, pending commit.

---

## 8. Phase 2C — Parallelize `GET /learning-map` DB queries

- **Phase name:** `GET /learning-map` query-wave parallelization (backend).
- **Goal:** Cut the `GET /learning-map` server time by collapsing the chain of
  independent sequential DB round-trips into a few parallel batches, without any
  change to the response, the computed values, or the security/404 behaviour.
- **Problem:** The handler in `apps/api/src/routes/learning-map.ts` issued ~7
  DB reads strictly one-after-another, even though most do not depend on each
  other. Against the Supabase IPv4 transaction pooler each round-trip pays fixed
  network + auth overhead, so serializing independent reads multiplies that
  fixed cost. Indexes already exist on every filtered column (verified in
  `apps/api/src/db/schema.ts`), so the bottleneck is round-trip *count*, not
  per-query work.
- **Scope:** Backend-only, single file (`learning-map.ts`) + this doc.
  **In scope:** reordering independent reads into `Promise.all` waves.
  **Out of scope (unchanged):** response shape, progress/rollup/locked/status
  logic, error semantics & 404s, the teacher-ownership security gate, auth
  middleware, DB schema/migrations, indexes, and all frontend / React Query /
  resources code.
- **Files touched:**
  - `apps/api/src/routes/learning-map.ts`
  - `docs/LEARNING_MAP_PERFORMANCE.md`
- **Exact changes — handler restructured into ordered waves:**
  - **Wave 0 (unchanged, sequential):** teacher-ownership check stays *first*
    and *blocking*. The security gate is neither weakened nor reordered — for a
    teacher we still resolve `studentId` only after confirming ownership.
  - **Wave 1 (`Promise.all`):** the active-course list and the student's
    `primary_course_id` are now fetched together. `primary_course_id` is read
    unconditionally so it can share the round-trip; its value is still only
    *consumed* in the no-`course_id` branch, so eager reading is
    behaviour-neutral. `courseId` resolution / validation (active-set
    membership, primary-vs-oldest fallback, the `No course found` 404) is
    byte-for-byte the same.
  - **Wave 2 (`Promise.all`):** after `courseId` is resolved & validated, the
    four independent reads — course row, per-student exam override, topics, and
    this student's lessons (newest-first) — run in one batch instead of four
    serial reads. The `Course not found` 404, the
    `override ?? course.exam_date` precedence, and the empty-`topics` early
    return are all preserved exactly.
  - **Wave 3 (unchanged, `Promise.all`):** homework + todo reads still run after
    `lessonIds` is known (they genuinely depend on it), and were already
    batched.
- **Before / after handler structure:**

  ```text
  BEFORE (serial)                AFTER (waved)
  ─────────────────────────────  ─────────────────────────────
  await owner (teacher only)     Wave 0: await owner (teacher only)   ← unchanged
  await activeCourses            Wave 1: Promise.all([
  await primaryCourse (cond.)              activeCourses, primaryCourse ])
  await course                   Wave 2: Promise.all([
  await examOverride                       course, examOverride,
  await topics                             topics, lessons ])
  await lessons
  await Promise.all([hw, td])    Wave 3: Promise.all([hw, td])        ← unchanged
  ```

  Round-trips on the critical path drop from ~7 serial to **4** (teacher) /
  **3** (student): Wave 0 (teacher only) → Wave 1 → Wave 2 → Wave 3.
- **Before network behavior:** one `GET /learning-map`, ~5–5.9s observed; server
  time dominated by serial DB round-trips.
- **After network behavior:** identical request/response (same URL, same JSON,
  same status codes). Expected server-time reduction ~0.5–1.5s from fewer serial
  round-trips. The remaining floor is the per-request auth tax (Phase 2D,
  separate, security-sensitive).
- **Test plan:**
  - `pnpm typecheck` (api) — green.
  - `pnpm vitest run` for `learning-map-rollup`, `learning-map-recovery`,
    `learning-map.fallback` — **20/20 passed**.
  - Manual QA: load student map and teacher map; confirm identical data, course
    switching, exam-date precedence, locked/empty/404 paths.
- **Risks:** Low. No logic/branch changed — only the *order* in which
  independent reads are awaited. Eagerly reading `primary_course_id` and the
  lessons list (even when `topics` is later found empty) is harmless: those
  results are simply discarded by the existing early returns. No cache/staleness
  impact, so contract §4/§5 invalidation is untouched (read-path only).
- **Rollback plan:** single-commit `git revert` (one source file + this doc
  section). No schema/auth/cache side-effects.
- **Observed before/after (production, commit `7ecf61a` Ready on Vercel):**
  - `GET /learning-map` **before ≈ 5.90s → after ≈ 5.23s** (modest improvement,
    ~0.6–0.7s, consistent with the ~7→4 serial-round-trip reduction).
- **Status:** **verified — modest improvement.** Deployed (`7ecf61a`), Vercel
  Ready, CI green. The Learning Map is still slow: the remaining bottleneck is
  **global API latency**, not `/learning-map` query serialization. Other,
  unrelated endpoints are similarly slow in the same session
  (`student details ≈ 4.60s`, `courses ≈ 3.86s`, `students ≈ 4.22s`,
  `*/count ≈ 4.07s`), which points at a per-request global tax rather than any
  single route. This is the subject of Phase 2D (investigation only).
