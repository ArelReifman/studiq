-- Extend activity_event_type with two more student-driven signals: saving a
-- lesson reflection, and uploading a solution file. Same append-only,
-- server-only activity_events table from migration 027 — no new table, no
-- change to existing rows, no RLS/grant changes needed.
--
-- ALTER TYPE ... ADD VALUE cannot run inside the same transaction block as a
-- statement that uses the new value, but this file only adds the values —
-- nothing else — so it's safe to run as-is.

ALTER TYPE activity_event_type ADD VALUE IF NOT EXISTS 'lesson.reflection_saved';
ALTER TYPE activity_event_type ADD VALUE IF NOT EXISTS 'lesson.solution_uploaded';
