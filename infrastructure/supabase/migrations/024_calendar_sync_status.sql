-- 024_calendar_sync_status.sql
-- Calendar background-sync infrastructure (Phase 3B-1).
--
-- This migration is purely ADDITIVE — no existing flow writes to these
-- columns yet. The Google Calendar create/update/delete calls in
-- bookings.ts still run inline (awaited) exactly as before. These columns
-- exist so a later phase can move GCal work to a Vercel-Cron-driven worker
-- without another schema change.
--
-- Server-only fields (Template B from docs/SUPABASE_DATA_API_GRANTS.md):
--   lesson_bookings is already server-only (no anon/authenticated GRANTs,
--   not in supabase_realtime publication). These new columns inherit that
--   posture — no additional GRANT/RLS work needed.

ALTER TABLE public.lesson_bookings
  ADD COLUMN IF NOT EXISTS calendar_sync_status text NOT NULL DEFAULT 'not_required'
    CHECK (calendar_sync_status IN ('not_required','pending','synced','failed')),
  ADD COLUMN IF NOT EXISTS calendar_sync_error text,
  ADD COLUMN IF NOT EXISTS calendar_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calendar_next_retry_at timestamptz;

-- Partial index — only rows the worker actually polls.
-- Keeps the index small even as the bookings table grows.
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_calendar_pending
  ON public.lesson_bookings (calendar_next_retry_at NULLS FIRST)
  WHERE calendar_sync_status IN ('pending','failed');
