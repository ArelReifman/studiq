# Supabase Data API / Realtime GRANTs

How to create new tables in the `public` schema after Supabase's change to default
GRANT/RLS behavior for the Data API.

> **TL;DR** — Supabase no longer auto-grants Data API access to new `public` tables.
> StudIQ is mostly unaffected because app DB access goes through a direct
> Drizzle/Postgres connection. The one place that *does* depend on table grants is
> the frontend's **Realtime `postgres_changes`** subscription. Any future table the
> browser needs to reach (Realtime or direct Data API) must get **explicit RLS +
> GRANTs**. Server-only tables need nothing beyond RLS.

---

## 1. Current project status

| Surface | Used? | Affected by the GRANT/RLS change? |
| --- | --- | --- |
| `supabase.from("table")` (PostgREST) | **No** — not found anywhere in code | — |
| `/rest/v1/` , `/graphql/v1/` direct calls | **No** — not found | — |
| Drizzle / direct Postgres (Pooler) | **Yes** — primary DB access | **No** — bypasses the Data API entirely |
| `supabase.auth.*` | Yes | No — Auth is separate from the Data API |
| `supabase.storage.*` (bucket `uploads`) | Yes | No — Storage is separate from the Data API |
| `supabase.realtime` `postgres_changes` | Yes — frontend | **Yes** — relies on table `GRANT SELECT` + RLS |

Notes:

- The server (`apps/api`) uses the **`service_role`** key, which **bypasses RLS and
  GRANTs**. Server table reads/writes go through Drizzle (`.from(tableObject)`), i.e.
  direct SQL, not the Data API.
- The browser uses the **`anon`** key for Auth, Storage, and Realtime only — it never
  issues PostgREST table queries.
- **Why Realtime matters:** Supabase Realtime `postgres_changes` enforces the same
  role privileges as the Data API. The subscribing role (`authenticated` / `anon`)
  must hold `GRANT SELECT` on the table **and** pass RLS, or events are silently
  dropped.

---

## 2. Tables currently used by Realtime

The frontend subscribes to `postgres_changes` on these `public` tables
(`apps/web/src/hooks/use-realtime-sync.ts`):

- `lesson_sessions`
- `homework_items`
- `todo_items`
- `students`
- `profiles`
- `student_ai_profiles`
- `difficulty_reports`
- `teacher_availability`
- `lesson_bookings`
- `teacher_ai_feedback`
- `student_reports`

These already work in production, so they retain the grants they received under
Supabase's old auto-grant default. They are **not** at immediate risk — the change is
not retroactive. The risk is **forward-looking**: new tables added to this list will
need explicit grants.

---

## 3. Rule for future public tables

For **every** new table in the `public` schema:

1. **Enable RLS** — always, even for server-only tables (defense in depth).
2. **Add explicit GRANTs** — only for the role(s) that genuinely need access, and
   only the operations they need. Do not rely on Supabase's old auto-grant behavior.
3. **Add RLS policies** — a GRANT without a matching policy still returns nothing;
   both are required for client access.
4. **Add to the `supabase_realtime` publication** — only if the browser needs
   `postgres_changes` events for that table.

If a table is server-only (touched solely via Drizzle / `service_role`), it needs
**only** step 1. No GRANTs, no policies, no publication entry — `service_role`
bypasses RLS, and the absence of policies makes it deny-all to clients.

---

## 4. Migration templates

### A. Browser / Realtime / Data API table

A table the frontend needs to read (e.g. via Realtime) or query directly.

```sql
-- Create the table
CREATE TABLE IF NOT EXISTS public.example_table (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES public.profiles (id),
  created_at  timestamptz NOT NULL DEFAULT now()
  -- ... columns ...
);

-- 1. Enable RLS
ALTER TABLE public.example_table ENABLE ROW LEVEL SECURITY;

-- 2. Explicit GRANTs — grant ONLY what this role needs.
--    Use `authenticated` for logged-in users. Add `anon` ONLY if truly public.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.example_table TO authenticated;
-- GRANT SELECT ON public.example_table TO anon;  -- uncomment only if needed

-- 3. RLS policies — scope rows to the right user. Example: owner-only access.
CREATE POLICY "example_select_own" ON public.example_table
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "example_modify_own" ON public.example_table
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- 4. Realtime publication — ONLY if the browser subscribes to postgres_changes.
ALTER PUBLICATION supabase_realtime ADD TABLE public.example_table;
```

### B. Server-only table

A table touched only by the API (`service_role`) via Drizzle — never by the browser.

```sql
-- Create the table
CREATE TABLE IF NOT EXISTS public.internal_table (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now()
  -- ... columns ...
);

-- Enable RLS with NO policies = deny-all to clients.
-- service_role bypasses RLS, so the API still has full access.
ALTER TABLE public.internal_table ENABLE ROW LEVEL SECURITY;

-- No GRANTs to anon/authenticated.
-- No RLS policies.
-- Not added to supabase_realtime.
```

(See `infrastructure/supabase/migrations/012_audit_logs.sql` for an existing
deny-all, server-only example.)

---

## 5. What NOT to do

- **Do not blindly grant `anon` access.** `anon` is unauthenticated/public. Grant it
  only when the data is genuinely meant for anonymous visitors. Default to
  `authenticated`.
- **Do not expose server-only tables.** If only the API (`service_role`) uses a
  table, give it RLS-with-no-policies — never a GRANT or a publication entry.
- **Do not run blanket GRANTs without RLS.** Granting access to a table that has RLS
  disabled (or no policies) is how data leaks. GRANT and RLS go together: a GRANT
  decides *which operations* a role may attempt; RLS decides *which rows* it sees.
- **Do not rely on the old auto-grant default.** New tables will not get Data API
  access automatically — make grants explicit in the migration.

---

## 6. Checklist for every new table

Before merging a migration that creates a `public` table, answer:

- [ ] **Is it server-only?** (touched only via Drizzle / `service_role`)
      → Template B: RLS on, no GRANTs, no policies, no publication.
- [ ] **Is it used by Realtime?** (frontend subscribes to `postgres_changes`)
      → Add to `supabase_realtime` and grant `SELECT` to the subscribing role.
- [ ] **Is it accessed by the browser / `supabase-js`?** (Realtime or direct Data API)
      → Template A: explicit GRANTs + RLS policies required.
- [ ] **Which role needs which operations?** Enumerate `SELECT` / `INSERT` /
      `UPDATE` / `DELETE` per role (`authenticated`, and `anon` only if justified).
      Grant the minimum.
- [ ] **What RLS policy protects it?** Define the row-scoping rule (e.g. owner-only,
      teacher-of-student) for each operation the role is allowed to perform.
- [ ] **If added to Realtime,** update `apps/web/src/hooks/use-realtime-sync.ts` to
      subscribe, and confirm the GRANT + RLS exist (otherwise events are dropped
      silently).

---

## Related

- `infrastructure/supabase/migrations/002_rls.sql` — base RLS + policies for the
  original schema tables.
- `infrastructure/supabase/migrations/012_audit_logs.sql` — deny-all, server-only
  pattern.
- `infrastructure/supabase/migrations/008_courses_and_topics.sql` — example of
  `ALTER PUBLICATION supabase_realtime ADD TABLE`.
- `apps/web/src/hooks/use-realtime-sync.ts` — the Realtime subscription list.
