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

- **Phase 2D-A — Region / infrastructure alignment (deployed / verified — see §9).**
  Global API latency caused by a Vercel↔Supabase region mismatch (functions were
  in `fra1`/Frankfurt, DB+Auth in `ap-northeast-1`/Tokyo). Infra/config only — no
  code, no auth, no schema. **Done:** Vercel function region moved
  `fra1 → hnd1` (Tokyo); measured ~4–5× global latency reduction.

- **Phase 2D-B — Auth / per-request latency investigation (investigation only).**
  Investigate the per-request `supabase.auth.getUser()` round-trip + profile DB
  query in `apps/api/src/middleware/auth.ts`, which taxes **every** endpoint.
  Security-sensitive and broad — **investigation and proposal only**, no code
  changes under this phase without separate explicit approval. Do only **after**
  2D-A, since region alignment may shrink this tax on its own.

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
  single route. This is the subject of Phase 2D-A (region) / 2D-B (auth).

---

## 9. Phase 2D-A — Vercel ↔ Supabase region alignment (deployed / verified)

- **Phase name:** Region/infrastructure alignment (Vercel function region).
- **Goal:** Reduce the per-request global API latency that affects *every*
  authenticated endpoint (not just `/learning-map`) by running the Vercel
  serverless function in the region closest to the Supabase DB + Auth, instead
  of on the opposite side of the planet.
- **Problem:** Every authenticated request makes serial cross-region round-trips
  (`supabase.auth.getUser()` → `profiles` query → route queries). With the
  function and the database thousands of km apart, each round-trip pays a large
  fixed RTT, which compounds across the several serial hops per request.
- **Verified findings (manual, from dashboards — confirmed by Arel):**
  - **Supabase project region:** `ap-northeast-1` — Northeast Asia / **Tokyo**.
    (Also independently confirmed by the pooler host
    `aws-1-ap-northeast-1.pooler.supabase.com`.) Supabase Auth (GoTrue) lives in
    the same project region → also Tokyo.
  - **Vercel Function Region (before this phase):** `fra1` — Europe /
    **Frankfurt**.
  - **Confirmed mismatch:** functions in `fra1` (Frankfurt) vs DB+Auth in
    `ap-northeast-1` (Tokyo) — roughly **9,000 km / ~230–260 ms RTT** per
    round-trip, multiplied by the serial auth + profile + route hops.
  - **Repo config:** no function region is set anywhere in the repo
    (`vercel.json` has no `regions`/`functions`; no `preferredRegion`/`runtime`
    in `apps/web/src/app/api/[...path]/route.ts`; none in `next.config.ts`). The
    `fra1` selection lives only in the Vercel dashboard project settings.
- **Change (applied — see "Applied change" below):** in the **Vercel
  dashboard** (Project → Settings → Functions → Region), the function region was
  moved from `fra1` to the closest region to Tokyo — **`hnd1` (Tokyo)**.
  (Nearest alternatives, had `hnd1` been unavailable, would have been `icn1`
  Seoul or `sin1` Singapore.) Dashboard-only; **no repo/code/`vercel.json`
  edit.**
- **Scope:** Infra/config only. No code, no auth, no DB schema, no RLS/GRANT, no
  frontend, no React Query, no learning-map logic. Contract §4/§5 invalidation
  is untouched (this changes *where* code runs, not *what* it does or *when*
  caches invalidate).
- **Pre-change checklist:**
  - Confirm `hnd1` (Tokyo) is offered for this Vercel plan; if not, pick the
    nearest available APAC region.
  - Note the current region (`fra1`) so rollback is exact.
  - Confirm the change applies on the next deployment (region changes take
    effect on redeploy) and that the cron (`/api/cron/sync-calendar`) is
    unaffected.
- **Post-change test plan:**
  - Redeploy, confirm Vercel **Ready**.
  - Verify the new region via the `x-vercel-id` response header on
    `/api/health` (prefix should reflect the new region, e.g. `hnd1::…`).
  - Re-measure the same endpoints in the Network panel: `GET /learning-map`,
    `students`, `courses`, `student details`, `*/count`. Expect a broad drop
    across all of them (the tax is global, so the win is global).
  - Smoke-test auth-gated flows (student map, teacher map, login) to confirm no
    functional regression.
- **Applied change (dashboard):** Vercel Function Region changed
  **`fra1` (Frankfurt) → `hnd1` (Tokyo, Japan / Northeast — `ap-northeast-1`)**,
  now co-located with the Supabase project region (`ap-northeast-1` / Tokyo,
  unchanged). Dashboard-only — no repo/code/`vercel.json` change.
- **Measured before/after (production, after redeploy):**

  | Endpoint | Before (`fra1`) | After (`hnd1`) |
  |----------|-----------------|----------------|
  | `GET /learning-map` | ~5.23s | **~0.93s** |
  | student details | ~4.60s | **~0.80s** |
  | `courses` | ~3.86s | **~0.89s** |
  | `students` | ~4.22s | **~1.08s** |
  | `*/count` | ~4.07s | **~0.91–1.13s** |
  | `exam-date` | ~2.20s | **~0.62s** |
  | `learning-resources` | (n/a captured) | **~1.61s** |

  Roughly a **4–5× reduction** across the board.
- **Result:** **global** API latency dropped dramatically — confirming the
  dominant bottleneck was the Vercel↔Supabase region mismatch, not any single
  route's logic. Because almost every authenticated route calls Supabase
  Auth (`getUser`) + the DB, this win is **system-wide**, not Learning-Map
  specific: every authenticated endpoint that was paying the cross-region tax
  benefits.
- **Risks:** Low and already realized. Infra/config, fully reversible, no
  code/auth/data surface. Mild caveat: end users far from Tokyo see a slightly
  longer client→function leg, but since DB latency dominates, aligning the
  function to the DB is a clear net win (borne out by the measurements above).
- **Rollback plan:** revert the Vercel dashboard Function Region back to `fra1`
  and redeploy. Instant, no data/auth/schema impact, no repo change to revert.
- **Status:** **deployed / verified.** Region changed to `hnd1` in the Vercel
  dashboard, redeployed, and re-measured — confirmed ~4–5× global latency
  reduction. Supabase remains `ap-northeast-1` / Tokyo.

---

## 10. Post-region global baseline (after Phase 2D-A)

System-wide network timings captured **after** the `fra1 → hnd1` region
alignment. This is the new reference baseline against which any further
performance work (Phase 2E onward) is measured. Numbers are per-screen,
production, warm/cold mix.

| Screen | Request | Timing |
|--------|---------|--------|
| Dashboard | `requests` | ~1.98s |
| Dashboard | `students` | ~1.63s |
| Dashboard | `*/count` | ~1.57s |
| Students | `students` | ~1.33s |
| Students | `*/count` | ~1.29–1.49s |
| Student profile | `insights` / `details` / `profile` / `lessons` | ~0.94–0.98s |
| Learning Map | `learning-map` | ~1.30s |
| Learning Map | `courses` | ~1.56s |
| Learning Map | `exam-date` | ~895ms |
| Learning Map | `learning-resources` | ~1.12s |
| Approvals | `approvals` | ~1.62s |
| Approvals | `requests` | ~2.07s |
| Courses | route / data | ~339–652ms |
| Schedule | `status` | ~1.40s |
| Schedule | `availability` | ~1.63s |
| Schedule | `requests` | ~1.89s |
| Upload / resource flow | `create` | ~896ms |
| Upload / resource flow | `sign` | ~1.48s |
| Upload / resource flow | PDF upload | ~2.65s |
| Upload / resource flow | `confirm` | ~1.06s |

- **Conclusion:** most API calls are now around **~0.5s–1.5s** — a healthy
  baseline after region alignment.
- **Remaining future candidates (not urgent):**
  - `requests` around **~2s** (Dashboard ~1.98s, Approvals ~2.07s, Schedule
    ~1.89s).
  - `availability` around **~1.6s** (Schedule).
  These are tracked as future candidates only; they are **not** scheduled for
  Phase 2E and are not on the Learning Map critical path.

### 10.1 UX/cache fix — Approvals auto-refresh

Not a numbered performance phase — a targeted cache/UX bugfix logged here for
history.

- **Commit:** `d643489` — `fix: refresh approvals list on mount`.
- **Problem:** the sidebar approvals badge updated live, but the main Approvals
  list could show a stale empty state until a manual refresh / re-navigation.
- **Cause:** the approvals list query could mount from stale cache because the
  global `refetchOnMount` default is `false`, so navigating to the page did not
  re-fetch even when newer data existed.
- **Fix:** targeted per-query `refetchOnMount: "always"` + `staleTime: 0` on the
  Approvals page queries (`["approvals-registrations"]`, `["approvals-bookings"]`),
  overriding only those queries — global React Query defaults untouched.
- **Scope:** frontend-only, Approvals page only. No backend / DB / auth / RLS /
  Realtime changes.
- **Status:** **verified in production.**

---

## 11. Phase 2E — Manual content-lesson creation perceived performance

- **Phase name:** Manual content-lesson creation — perceived-performance
  (frontend-only).
- **Goal:** Make manual **content** lesson creation *feel* fast. Today the
  Create-Lesson modal stays open and "busy" for the full network chain; when a
  PDF is attached this is ~6s of a seemingly frozen modal.
- **Problem:**
  - `apps/web/src/components/teacher/create-lesson-modal.tsx` runs its
    `mutationFn` (lines ~129–171) serially: `POST /lessons/create` (~896ms) and,
    if a file is attached, `sign` (~1.48s) + PDF upload (~2.65s) + `confirm`
    (~1.06s). `onClose()` is only called in `onSuccess` (line ~169), so the
    modal blocks until the whole chain resolves.
  - The follow-up refetches are **not** the problem: the `invalidateQueries`
    calls (lines ~165–168) are fire-and-forget (not awaited), so
    `["lessons"]` / `["learning-map"]` / `["students"]` refetch in the
    background and do not block the modal close.
- **Relevant flow (in scope):** `POST /lessons/create` → writes to
  `lesson_sessions` → **affects the Learning Map** (this is the slow,
  map-relevant content flow).
- **Non-relevant flow (out of scope, unchanged):** `POST /bookings/teacher-lesson`
  → writes to `lesson_bookings` → **must not affect the Learning Map**
  (Contract §1). It already closes optimistically (`LessonFormModal`); Phase 2E
  does not touch it. (Verify-only: confirm `LessonFormModal` does **not**
  invalidate `["learning-map"]`; no change expected.)
- **Scope:** Frontend-only, primarily
  `apps/web/src/components/teacher/create-lesson-modal.tsx`.
  **Out of scope (unchanged):** backend, DB/schema, auth, RLS/GRANT, the upload
  rollback semantics, the booking/calendar flow, the AI-generate flow, and the
  Learning Map calculation logic.
- **Planned safe approach:**
  - **No-file path:** allow an optimistic / faster modal close (close in
    `onMutate` instead of waiting for the POST), snapshotting form state and
    surfacing any error via a toast/alert (mirrors the booking flow precedent).
    The POST + invalidations continue in the background; the lesson appears on
    the map once `["learning-map"]` refetches.
  - **File path:** keep the modal **open** (the upload can fail and triggers a
    rollback `DELETE /lessons/:id` — lines ~152–159 — so an early close is
    unsafe), but show clearer staged progress, e.g. "יוצר שיעור…" then
    "מעלה חומר…", so the ~6s reads as progress rather than a frozen modal.
- **Implemented frontend behavior (Phase 2E):** all changes are confined to
  `apps/web/src/components/teacher/create-lesson-modal.tsx`. No i18n catalog,
  backend, DB, auth, or React Query-key changes.
  - **Shared helpers added:** `buildPayload()` (single source of truth for the
    `/lessons/create` body, used by both paths so they can't drift) and
    `invalidateAfterCreate()` (invalidates `["lessons"]`, `["learning-map"]`,
    `["students"]` — the exact contract §4/§5 set, unchanged).
  - **No-file path (optimistic close):** a new `handleCreate()` submit handler
    snapshots the payload, calls `onClose()` **immediately**, then runs
    `POST /lessons/create` + `invalidateAfterCreate()` in a background
    `void (async …)()`. Because `qc` / `api` / `window` are provider- and
    module-level stable refs, the in-flight promise completes even after the
    modal unmounts. On failure it surfaces `window.alert(err.message)` so the
    create never fails silently. The map updates via the normal
    `["learning-map"]` refetch — **no optimistic map mutation.**
  - **File path (modal stays open):** still routed through `createMutation`.
    The modal stays open through `sign` → upload → `confirm`; the existing
    rollback (`DELETE /lessons/:id` on upload failure) is unchanged. A new
    `uploading` state flips the busy button label from
    `t("createLesson.creating")` ("יוצר…") to `t("upload.uploading")`
    ("מעלה…") when the upload phase begins, giving the staged progress
    feedback. (These two **existing** i18n keys are reused so the bilingual
    catalog is untouched; the intent matches the planned
    "יוצר שיעור…" → "מעלה חומר…".) On success it calls
    `invalidateAfterCreate()` + `onClose()`; `onSettled` resets `uploading`,
    and on failure the inline `createMutation.isError` message stays visible
    because the modal is still open.
- **Booking/calendar flow:** untouched — Phase 2E does not modify
  `LessonFormModal` or any booking key, so bookings remain decoupled from the
  map (Contract §1).
- **Contract compliance:**
  - **Do not** optimistically update the Learning Map itself — the frontend
    never recomputes progress (Contract intro + §2). Only `["learning-map"]`
    invalidation is used, exactly as today.
  - Preserve the `["learning-map"]` invalidation on create (Contract §4/§5,
    create-lesson row) — it remains in `onSuccess`/`onSettled`.
- **Before network behavior:** modal blocks for the full chain — ~0.9s with no
  file, ~6s with a PDF.
- **After network behavior:** identical requests/timings on the wire (no network
  change); only the modal close-timing (no-file) and the in-modal progress
  feedback (file) change. The map still updates via the same invalidation.
- **Test plan:**
  - `pnpm typecheck` (web) — **green** (`tsc --noEmit` clean). Typecheck is
    sufficient here: the change is an isolated client component edit (no route,
    schema, or server-bundle surface), so a full `next build` adds no
    type-coverage beyond `tsc`.
  - Manual QA: create a content lesson **without** a file → modal closes
    immediately, lesson appears on the map after the background refetch.
  - Create a content lesson **with** a PDF → modal stays open, shows
    "יוצר…" then "מעלה…", closes on success; on a forced upload
    failure the rollback still deletes the lesson and an error is surfaced.
  - Force a no-file POST failure → modal already closed, a `window.alert`
    surfaces the error (no silent failure).
  - Confirm the booking/calendar flow and the AI-generate flow are unchanged.
  - Network panel: confirm no new/removed requests, and that `["learning-map"]`
    still refetches after create.
- **Risks:** Low. Frontend-only, isolated to one modal component. Main caveat:
  optimistic close on the no-file path loses typed form state if the POST fails
  — mitigated by snapshot + a clear error alert. No cache/staleness risk
  (invalidation unchanged), so Contract §4/§5 is preserved.
- **Rollback plan:** single-commit `git revert` (one component + these doc
  sections). No DB/auth/cache side-effects.
- **Observed QA (production, commit `ddf6474` Ready on Vercel):**
  - **Test 1 — manual lesson without PDF:** modal closes quickly right after
    submit; lesson created; map updates after refetch; no errors.
    `create ≈ 889ms`, `learning-map refetch ≈ 819ms`,
    `students refetch ≈ 657ms`, `student details ≈ 836ms`.
  - **Test 2 — manual lesson with PDF:** modal stays open through
    creation/upload; progress label changes "יוצר…" → "מעלה…"; modal closes at
    the end; lesson + PDF saved; map updates after refetch; no errors.
    `create ≈ 1.41s`, `sign ≈ 1.67s`, `PDF upload ≈ 2.31s`, `confirm ≈ 1.11s`,
    `lessons refetch ≈ 557–609ms`, `learning-map refetch ≈ 653–922ms`,
    `students / student details ≈ 821–822ms`.
- **Status:** **verified.** Deployed (`ddf6474`), Vercel Ready, CI green, and
  QA-confirmed in production: the no-file path closes the modal immediately
  (perceived-instant) while the POST + invalidations finish in the background,
  and the PDF path keeps the modal open with staged "יוצר…" → "מעלה…" progress.
  Learning Map invalidation preserved; no optimistic map mutation; booking/AI
  flows untouched.

## 12. Phase 2F — Student solution upload over-invalidation / flicker

- **Phase name:** Student lesson-solution upload — reduce redundant refetch /
  flicker (frontend-only).
- **Status:** **verified** (production, commit `2486c03`). See §12.3 for the QA
  result.
- **Problem:** After a student uploads their solution PDF/image on the student
  lesson page, the same `GET /lessons/:id` is refetched several times in quick
  succession (observed ≈ `638ms` / `1.25s` / `1.69s` staggered), and the card /
  lesson view visibly flickers before settling.
- **Root cause:** `lesson-solution-upload.tsx` `upload` `onSuccess` fired **five**
  manual invalidations — `["lessons", lessonId]`, the broad `["lessons"]`
  prefix, `["learning-map"]`, `["students"]`, and `["todos"]`. These overlap
  with the Supabase Realtime `lesson_sessions` echo of the *same* write (the
  client's own write echoes back through its subscription, which itself
  invalidates `["lessons"]` + `["learning-map"]`). The two mechanisms fire at
  staggered times → repeated same-id refetches. The `["todos"]` key and the
  stale comment ("Uploading a solution flips tasks to pending") were also
  factually wrong: `POST /upload/lesson/:id/solution/confirm`
  (`apps/api/src/routes/upload.ts`) updates **only** the `lessonSessions` row
  (`student_solution_url`, `student_solution_name`) — it never touches
  `todo_items` / `homework_items`.
- **Change:** In `apps/web/src/components/student/lesson-solution-upload.tsx`,
  the `upload` `onSuccess` now keeps **only**
  `qc.invalidateQueries({ queryKey: ["lessons", lessonId] })` and replaces the
  stale comment with an accurate one. The broad `["lessons"]`, `["learning-map"]`,
  `["students"]`, and `["todos"]` invalidations were removed.
- **Why teacher visibility is still safe:** the student's `qc.invalidateQueries`
  only mutates the **student's own** React Query cache — it never reaches the
  teacher's browser. The teacher already sees the new solution through their
  **own** Realtime subscription (`use-realtime-sync.ts`, `lesson_sessions`
  listener → `["lessons"]` + `["learning-map"]`), which is unchanged. So dropping
  the student-side broad invalidations has zero effect on what the teacher sees.
- **Not changed:** no backend / DB / migration / auth / RLS / Realtime-hook
  changes. `use-realtime-sync.ts` and `task-item.tsx` untouched. The `remove`
  mutation's invalidations were left as-is (out of scope for this step).
- **Test plan:**
  - Student uploads a solution → card shows the file; confirm only **one**
    `GET /lessons/:id` fires (no staggered duplicates); no flicker.
  - Teacher (separate session) sees the uploaded solution appear via Realtime
    without a manual refresh.
  - Remove solution still works and refreshes the student's view.
- **Rollback plan:** single-commit `git revert` (one component + this doc
  section). No DB/auth/cache side-effects.

### 12.1 Phase 2F follow-up — local anti-flicker UI state

- **Status:** **verified** (production, commit `2486c03`).
- **What the first cut already fixed:** the broad invalidations
  (`["lessons"]` prefix, `["learning-map"]`, `["students"]`, `["todos"]`) were
  removed, collapsing the post-upload cascade from five invalidation sources to
  a single `["lessons", lessonId]` refetch.
- **Remaining (expected) behaviour:** even with only one manual invalidation,
  there are still **two** `GET /lessons/:id` after `confirm` (observed ≈ `613ms`
  + `596ms`). The second one is the **Supabase Realtime `lesson_sessions`
  echo** of the student's own write, which invalidates the `["lessons"]` prefix.
  This is expected from the Realtime architecture and is intentionally **not**
  suppressed (suppressing/debouncing it globally would risk teacher visibility
  and the learning-map live refresh — that listener is the exact mechanism the
  teacher relies on).
- **Why the flicker remained:** `LessonSolutionUpload` renders from the
  `solutionUrl` / `solutionName` **props** (fed by the parent
  `["lessons", lessonId]` query). Between a successful `confirm` and the
  refetch landing, the props still say "no solution", so the card briefly flips
  back to the empty upload state → visible flicker.
- **Local fix (this follow-up):** added a small local component state
  `justUploaded` ({ url, name }) set in the `upload` `onSuccess` from the
  confirm response. Render now uses `effectiveUrl`/`effectiveName =
  prop ?? justUploaded`, so the card shows the uploaded file **immediately** and
  holds it through the background refetch/echo. **Server props win once they
  arrive** (`prop ?? local`), so the real lesson data is always the source of
  truth; the local value only covers the gap. `remove` clears `justUploaded`
  so deletion still follows the server to the empty state.
- **Preserved / not changed:** the required
  `qc.invalidateQueries({ queryKey: ["lessons", lessonId] })` is kept;
  `use-realtime-sync.ts` is intentionally **unchanged** (no global Realtime
  suppression/debounce); no backend / DB / auth / RLS changes; `task-item.tsx`
  and teacher upload flows untouched; error handling
  (`upload.isError` / `remove.isError`) unchanged. Teacher visibility remains
  safe — the change is purely the student's local render state.
- **Test plan:**
  - Upload a solution → during upload shows "uploading"; on `confirm` success
    the uploaded file appears **immediately** with **no** flip back to the
    empty/loading state during the background refetch + Realtime echo.
  - Once the refreshed lesson data arrives, the card uses the real server data.
  - Remove still works and returns the card to the empty state.
  - Teacher (separate session) still sees the solution appear via Realtime.
- **Rollback plan:** single-commit `git revert` (one component + this doc
  subsection). No DB/auth/cache side-effects.

### 12.2 Phase 2F follow-up — instant delete (optimistic local removal)

- **Status:** **verified** (production, commit `2486c03`).
- **Problem:** removing an uploaded solution felt slow. The `remove` mutation
  had no optimistic UI: the card kept showing the file (the `X` button merely
  dimmed via `disabled`) for the full `DELETE /upload/lesson/:id/solution`
  round-trip (~1s) plus the follow-up `["lessons", lessonId]` refetch
  (~`860ms`–`1.6s`) before the file disappeared.
- **Bottleneck:** the blocking request is the `DELETE` itself — the UI waited
  for it (and then the refetch flipping the prop to `null`) before hiding the
  file. No work happens client-side until then, so it reads as a frozen delay.
- **Local fix (this follow-up):** added an `optimisticRemoved` boolean state.
  `remove.onMutate` sets it `true` → the card hides the file **immediately**;
  the existing `DELETE` is still sent unchanged. `effectiveUrl`/`effectiveName`
  now short-circuit to `null` when `optimisticRemoved` is set, so the empty
  upload state shows instantly. The `DELETE` + `["lessons", lessonId]`
  invalidation continue in the background.
- **Rollback on failure:** `remove.onError` sets `optimisticRemoved` back to
  `false`, restoring the file in the UI; the existing `remove.isError` message
  surfaces the error. No data is lost because the server prop (`solutionUrl`)
  was never cleared on failure.
- **Not blocking future uploads:** `upload.onMutate` resets
  `optimisticRemoved` to `false`, so a new upload after a delete is never
  hidden by a stale removal flag.
- **Remove invalidation trimmed (symmetry with upload):** the `remove`
  `onSuccess` previously fired both `["lessons", lessonId]` **and** the broad
  `["lessons"]` prefix. The broad one was redundant — it overlaps
  `["lessons", lessonId]` and duplicate-refetches the mounted detail query (the
  exact issue already fixed on upload), and the only `["lessons"]`-exact list
  queries (`student/dashboard` and `student/map`) return `LessonSession[]` and
  render `status`/`topic_id`/`id` only — they never show
  `student_solution_url`/`name`, so a solution removal doesn't affect them. The
  Realtime `lesson_sessions` echo also already covers any other surface. So
  `remove` now keeps **only** `qc.invalidateQueries({ queryKey: ["lessons", lessonId] })`.
- **Preserved / not changed:** upload/sign/confirm behaviour unchanged; the
  required `qc.invalidateQueries({ queryKey: ["lessons", lessonId] })` is kept
  on both upload and remove; `use-realtime-sync.ts` unchanged; no
  backend / DB / auth / RLS changes; `task-item.tsx` and teacher flows
  untouched.
- **Why teacher visibility stays safe:** the `DELETE` is still sent to the
  backend exactly as before, and the teacher continues to see the removal via
  their **own** Realtime `lesson_sessions` subscription. `optimisticRemoved` is
  purely the student's local render state and never reaches the teacher's
  browser.
- **Test plan:**
  - Click delete → the file disappears **instantly**; no frozen wait.
  - On `DELETE` success the card stays empty after the refetch lands.
  - Simulated `DELETE` failure → the file reappears and an error is shown.
  - Upload again after delete → the new file shows normally (no stale hide).
  - Teacher (separate session) still sees the removal via Realtime.
- **Verification gate:** Phase 2F should be marked **verified** only after
  **both** upload **and** delete are confirmed in production.
- **Rollback plan:** single-commit `git revert` (one component + this doc
  subsection). No DB/auth/cache side-effects.

### 12.3 Phase 2F — QA result (verified in production)

- **Verified on:** commit `2486c03` (Vercel Ready).
- **Result:** **verified in production.** Both the upload anti-flicker (§12.1)
  and the delete optimistic removal (§12.2) behave as intended.
- **Test 1 — upload a solution:** `sign ≈ 1.44s`, `PDF upload ≈ 2.62s`,
  `confirm ≈ 817ms`, lesson refetches after confirm `≈ 807ms` + `≈ 1.56s`.
  Upload succeeded, the file appeared correctly, and the UI **did not** flip
  back to the empty/no-file state during the background refetch.
- **Test 2 — delete the solution:** `DELETE ≈ 1.25s`, lesson refetches after
  delete `≈ 631ms` + `≈ 1.15s`. The file **disappeared immediately**, the
  delete completed, and the file stayed removed after the refetch.
- **Test 3 — teacher visibility:** the teacher sees the correct upload/delete
  state (via their own Realtime subscription).
- **Remaining duplicate `GET /lessons/:id`:** still present (one manual
  `["lessons", lessonId]` invalidation + the Supabase Realtime `lesson_sessions`
  echo of the same write). This is **expected** and **acceptable** — the UI no
  longer flickers, so the second background refetch is invisible to the user.
- **`use-realtime-sync.ts` intentionally not changed:** the global Realtime
  echo was deliberately left untouched (suppressing/debouncing it would risk
  teacher visibility and the learning-map live refresh). The flicker was solved
  purely with local component state on the student side.

## 13. Lesson edit — moving a lesson to *today* felt blocked (UX fix)

- **Status:** **implemented, pending verification** (frontend-only).
- **Bug:** When editing an existing lesson and changing its date to **today**,
  saving could fail and feel as though "scheduling for the same day is blocked".
- **Root cause:** In `apps/web/src/components/teacher/LessonFormModal.tsx`, the
  selected `startTime` carried over from the lesson's original (future) date when
  only the date field was changed. If that carried-over time was already in the
  past relative to the current Israel time, `handleSubmit` rejected the save with
  `pastTimeError` ("time has already passed"). The teacher perceived this as a
  same-day block, even though the validation only ever blocked **past datetimes**,
  never the calendar day itself.
- **Fix (frontend-only):** In the date field's `onChange`, when the new date is
  today (`israelToday`) and the currently-selected `startTime` is already in the
  past (`startTime <= israelNow`, Israel time), reset `startTime` to empty and
  clear any stale `pastTimeError`. The `TimeSelect` dropdown already hides
  past slots via `minTime`, so the teacher is then forced to pick a still-future
  time. Today is allowed whenever the chosen time is in the future.
- **Backend validation unchanged:** the `PATCH /bookings/teacher-lesson` past
  check (`apps/api/src/routes/bookings.ts`) and `isSlotInPastIsrael`
  (`apps/api/src/lib/time.ts`) are **not** touched.
- **Past scheduling is still blocked:** both the frontend submit guard and the
  backend continue to reject any past date/time, including a past time chosen for
  today.
- **Not changed:** no backend / DB / migration / auth changes; Telegram solution
  notification (a separate, still-open bug) untouched.
- **Test plan:**
  - Edit a future lesson → set date to today, pick a future time → saves.
  - Edit a lesson whose original time is now in the past → set date to today →
    the time field resets; after picking a future time it saves.
  - Set date to today and manually pick a time that has already passed → still
    blocked.
  - Set date to tomorrow → unchanged behaviour.
  - Mobile Safari iOS — confirm the reset fires even though the native `min`
    on `<input type="date">` is not reliably enforced.
- **Rollback plan:** single-commit `git revert` (one component + this doc
  section). No backend / DB / auth side-effects.
