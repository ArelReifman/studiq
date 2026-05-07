-- 020_promote_failed_tasks_on_approved_lessons.sql
-- Backfill: when the teacher already approved a lesson with
-- next_level / next_topic, the failed tasks should read as completed —
-- the offline conversation between teacher and student already resolved
-- them. The lesson-review handler now does this automatically; this
-- migration catches the rows that were approved before the fix.

UPDATE homework_items hi
SET status = 'completed'
FROM lesson_sessions ls
WHERE hi.lesson_id = ls.id
  AND hi.status = 'failed'
  AND ls.teacher_decision IN ('next_level', 'next_topic');

UPDATE todo_items ti
SET status = 'completed'
FROM lesson_sessions ls
WHERE ti.lesson_id = ls.id
  AND ti.status = 'failed'
  AND ls.teacher_decision IN ('next_level', 'next_topic');
