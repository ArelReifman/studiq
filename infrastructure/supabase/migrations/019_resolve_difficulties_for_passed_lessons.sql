-- 019_resolve_difficulties_for_passed_lessons.sql
-- Backfill: if a teacher already signed off on a lesson with
-- next_level / next_topic, the difficulty_reports tied to that lesson's
-- items are implicitly resolved. The lesson-review handler now does this
-- automatically for new reviews; this query catches the rows that were
-- approved before the fix landed.

UPDATE difficulty_reports dr
SET reviewed = true
FROM homework_items hi
JOIN lesson_sessions ls ON ls.id = hi.lesson_id
WHERE dr.source_type = 'homework'
  AND dr.source_id = hi.id
  AND ls.teacher_decision IN ('next_level', 'next_topic')
  AND dr.reviewed = false;

UPDATE difficulty_reports dr
SET reviewed = true
FROM todo_items ti
JOIN lesson_sessions ls ON ls.id = ti.lesson_id
WHERE dr.source_type = 'todo'
  AND dr.source_id = ti.id
  AND ls.teacher_decision IN ('next_level', 'next_topic')
  AND dr.reviewed = false;
