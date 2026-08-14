-- Retry checklist for repeat lessons.
--
-- When a teacher marks a lesson "חזרה" (repeat) and triggers retry
-- generation, the new lesson now duplicates the predecessor's material and
-- exercises rather than having the AI invent new ones. The teacher's
-- free-text review note is instead parsed into a short checklist of
-- actionable items, stored here. NULL for every non-retry lesson, and NULL
-- for retries where the teacher left no review note.

ALTER TABLE lesson_sessions
  ADD COLUMN IF NOT EXISTS retry_checklist jsonb;
