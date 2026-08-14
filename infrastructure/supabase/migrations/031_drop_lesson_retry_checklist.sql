-- Revert migration 030. The retry checklist ended up modeled wrong: it was a
-- teacher-only tracker, but it should be real student-facing tasks (todo
-- items the student marks done/stuck, like any other task) instead. Those
-- items are now appended directly to todo_items — no separate column needed.

ALTER TABLE lesson_sessions
  DROP COLUMN IF EXISTS retry_checklist;
