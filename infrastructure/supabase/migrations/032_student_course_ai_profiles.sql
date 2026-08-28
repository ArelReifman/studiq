-- 032_student_course_ai_profiles.sql
-- Adds a per-(student, course) AI profile table, additive alongside the
-- existing student_ai_profiles (one row per student, no course dimension).
--
-- student_ai_profiles is read/written from 9+ call sites across lesson
-- generation, homework/todo grading, signup, onboarding, and progress
-- reports — all assuming exactly one row per student. Restructuring that
-- table's unique constraint to (student_id, course_id) would require
-- auditing and rewriting every one of those sites. Instead this table
-- exists purely alongside it: written in addition to (never instead of)
-- the existing global row, read only by the teacher's per-course view.

CREATE TABLE IF NOT EXISTS student_course_ai_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  strong_topics TEXT[] NOT NULL DEFAULT '{}',
  weak_topics TEXT[] NOT NULL DEFAULT '{}',
  ai_summary TEXT,
  next_session_briefing TEXT,
  avg_completion_rate NUMERIC(4,2) NOT NULL DEFAULT 0,
  total_lessons INTEGER NOT NULL DEFAULT 0,
  total_homework INTEGER NOT NULL DEFAULT 0,
  total_failures INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_student_course_ai_profiles_student ON student_course_ai_profiles(student_id);
CREATE INDEX IF NOT EXISTS idx_student_course_ai_profiles_course ON student_course_ai_profiles(course_id);
