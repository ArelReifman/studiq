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

- **Phase 2A — Frontend perceived-performance improvement.**
  Make the map *feel* faster before the network completes (e.g. skeletons,
  optimistic map updates, deferring the resource section render until a topic
  detail is actually opened).

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
