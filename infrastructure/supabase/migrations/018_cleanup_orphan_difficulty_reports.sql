-- 018_cleanup_orphan_difficulty_reports.sql
-- One-time cleanup: difficulty_reports.source_id is a polymorphic reference
-- (points to homework_items.id or todo_items.id depending on source_type)
-- and has no FK, so prior lesson deletions left orphan rows that the
-- teacher kept seeing in "recent struggles". The DELETE /lessons/:id
-- handler now wipes them up front; this migration removes the rows that
-- were already orphaned before the fix.

DELETE FROM difficulty_reports
WHERE
  (source_type = 'homework' AND NOT EXISTS (
    SELECT 1 FROM homework_items WHERE id = difficulty_reports.source_id
  ))
  OR
  (source_type = 'todo' AND NOT EXISTS (
    SELECT 1 FROM todo_items WHERE id = difficulty_reports.source_id
  ));
