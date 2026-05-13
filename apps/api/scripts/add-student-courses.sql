-- Migration: add student_courses join table + backfill from primary_course_id
-- Safe to run multiple times (IF NOT EXISTS / ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS student_courses (
  student_id  uuid        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id   uuid        NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
  added_at    timestamptz NOT NULL DEFAULT now(),
  is_active   boolean     NOT NULL DEFAULT true,
  CONSTRAINT  student_courses_pkey UNIQUE (student_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_student_courses_student_id ON student_courses(student_id);

-- Backfill: seed one row per student who already has a primary_course_id.
-- ON CONFLICT DO NOTHING makes this idempotent.
INSERT INTO student_courses (student_id, course_id)
SELECT id, primary_course_id
FROM students
WHERE primary_course_id IS NOT NULL
ON CONFLICT DO NOTHING;
