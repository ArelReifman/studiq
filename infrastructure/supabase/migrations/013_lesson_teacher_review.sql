-- Migration 013: teacher review fields on lesson_sessions
-- Adds teacher_review_note, teacher_decision, teacher_reviewed_at so the
-- teacher can record their verdict after inspecting a student's submission.
-- The AI reads these fields to learn the teacher's grading standards and
-- suggest when a student is ready to advance.

-- Enum: what the teacher decided after reviewing
CREATE TYPE teacher_decision AS ENUM (
  'repeat',       -- same topic, same level — student needs more practice
  'next_level',   -- same topic, harder level (base → medium → exam)
  'next_topic'    -- mastered — move to next topic in the syllabus
);

ALTER TABLE lesson_sessions
  ADD COLUMN IF NOT EXISTS teacher_review_note  text,
  ADD COLUMN IF NOT EXISTS teacher_decision     teacher_decision,
  ADD COLUMN IF NOT EXISTS teacher_reviewed_at  timestamptz;
