-- 017_lock_all_topics_by_default.sql
-- Teacher decided every topic should start gated. New topics default to
-- locked, and every topic that already exists in the DB is flipped to
-- locked too — so the teacher walks through their courses and unlocks
-- one at a time as students are ready.

ALTER TABLE course_topics
  ALTER COLUMN is_locked SET DEFAULT TRUE;

UPDATE course_topics SET is_locked = TRUE;
