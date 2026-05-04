-- 016_topic_manual_lock.sql
-- Replaces the implicit "topic is locked when prerequisites aren't mastered"
-- model with an explicit teacher-controlled flag. Teachers click to
-- lock/unlock each topic; students see the result.

ALTER TABLE course_topics
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;
