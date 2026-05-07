-- Per-student exam date overrides.
-- The course-level exam_date (migration 019) is the default. Real-world tutors
-- have students taking the same course at different universities or different
-- exam slots (mo'ed alef vs bet), so the deadline that drives the student's
-- countdown UI must be settable per-student. This table is the override.
--
-- Lookup precedence in the learning map:
--   student_course_exam_dates.exam_date  →  courses.exam_date  →  null

CREATE TABLE IF NOT EXISTS student_course_exam_dates (
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id  uuid NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
  exam_date  timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_scee_course_id
  ON student_course_exam_dates(course_id);

ALTER TABLE student_course_exam_dates ENABLE ROW LEVEL SECURITY;

-- A row is visible/writable to the teacher who owns the student. Mirrors the
-- pattern used elsewhere (the student is the join key to teacher_id).
DO $$ BEGIN
  CREATE POLICY "scee_select_teacher" ON student_course_exam_dates
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM students s
              WHERE s.id = student_id AND s.teacher_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "scee_insert_teacher" ON student_course_exam_dates
    FOR INSERT WITH CHECK (
      EXISTS (SELECT 1 FROM students s
              WHERE s.id = student_id AND s.teacher_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "scee_update_teacher" ON student_course_exam_dates
    FOR UPDATE USING (
      EXISTS (SELECT 1 FROM students s
              WHERE s.id = student_id AND s.teacher_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "scee_delete_teacher" ON student_course_exam_dates
    FOR DELETE USING (
      EXISTS (SELECT 1 FROM students s
              WHERE s.id = student_id AND s.teacher_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Students should be able to read their own override too — the learning-map
-- endpoint runs with the student's auth context when they open their map.
DO $$ BEGIN
  CREATE POLICY "scee_select_self" ON student_course_exam_dates
    FOR SELECT USING (student_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
