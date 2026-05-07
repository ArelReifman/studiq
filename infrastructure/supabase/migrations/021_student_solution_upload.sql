-- 021_student_solution_upload.sql
-- Adds a slot for the student's uploaded solution (PDF or image) on
-- each lesson. Sits next to material_url / material_name, mirroring
-- the teacher's lesson material — same direct-to-storage upload flow,
-- different ownership.

ALTER TABLE lesson_sessions
  ADD COLUMN IF NOT EXISTS student_solution_url TEXT,
  ADD COLUMN IF NOT EXISTS student_solution_name TEXT;
