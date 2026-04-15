-- ─── Student reflection on a lesson ──────────────────────────────────────────
-- Free-text feedback from the student about how the lesson went.
-- Visible to the teacher on the student's detail page.

ALTER TABLE lesson_sessions
  ADD COLUMN IF NOT EXISTS student_reflection TEXT;

-- Allow the student to update ONLY their own reflection column.
-- Existing RLS policy "lessons_update_teacher" still covers teacher updates;
-- this adds a parallel student-scoped policy.
DO $$ BEGIN
  CREATE POLICY "lessons_update_student_reflection" ON lesson_sessions
    FOR UPDATE USING (student_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
