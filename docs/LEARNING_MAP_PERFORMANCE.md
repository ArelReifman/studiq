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

- **Phase 2C — Optimize `GET /learning-map` backend.**
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
