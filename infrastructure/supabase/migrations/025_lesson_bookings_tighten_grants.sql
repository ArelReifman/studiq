-- 025_lesson_bookings_tighten_grants.sql
-- Documents a production privilege hardening already applied manually in
-- Supabase. Running this file again is a no-op (REVOKE/GRANT are idempotent
-- against the desired state).
--
-- Context
--   `lesson_bookings` is the only table the browser observes via Supabase
--   Realtime (postgres_changes). Realtime requires the subscribing role
--   (`authenticated`) to hold `GRANT SELECT` on the table AND pass RLS, or
--   events are silently dropped. The earlier publication audit also
--   revealed that `authenticated` had been holding INSERT/UPDATE/DELETE/
--   TRUNCATE/TRIGGER/REFERENCES — none of which any browser code uses.
--
-- What this migration locks in
--   • `anon` loses all access to the table — the browser is anon only
--     during signup/login and must never touch bookings directly.
--   • `authenticated` keeps `SELECT` only. RLS SELECT policies still
--     constrain which rows each user can read:
--       bookings_select_teacher  USING (teacher_id = auth.uid())
--       bookings_select_student  USING (student_id = auth.uid())
--   • `authenticated` loses TRUNCATE (which bypasses RLS in PostgreSQL —
--     any logged-in user could otherwise wipe the entire table),
--     TRIGGER, REFERENCES, and the write privileges (INSERT/UPDATE/DELETE).
--     None of those are reachable from browser code; all writes go through
--     `apps/api` using `service_role`, which bypasses GRANTs and RLS.
--
-- Why this is safe to re-apply
--   The backend connects with `service_role` via Drizzle/Postgres directly
--   (see apps/api/src/db/client.ts). `service_role` is unaffected by any
--   GRANT/REVOKE on `public.*` tables — it bypasses them.

BEGIN;

-- Remove all access for the unauthenticated browser role.
REVOKE ALL ON public.lesson_bookings FROM anon;

-- Strip everything except SELECT from authenticated. Realtime needs SELECT
-- to deliver postgres_changes events filtered by RLS.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.lesson_bookings
  FROM authenticated;

-- Re-grant SELECT explicitly — idempotent, and guards against future
-- migrations that REVOKE ALL before this one runs.
GRANT SELECT ON public.lesson_bookings TO authenticated;

COMMIT;
