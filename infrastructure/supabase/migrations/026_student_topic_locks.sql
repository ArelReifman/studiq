-- Per-student topic lock overrides.
-- course_topics.is_locked (migration 008) is the default lock state for a
-- topic — it applies to every student in the course. Real-world tutors need
-- to open a topic for one specific student without opening it for everyone
-- else in the same course, so this table is the per-student override.
--
-- Lookup precedence in the learning map:
--   student_topic_locks.is_locked  →  course_topics.is_locked
--
-- Server-only table (touched solely via Drizzle / service_role, same as
-- student_course_exam_dates in migration 020) — no GRANTs needed per
-- docs/SUPABASE_DATA_API_GRANTS.md. Policies are added anyway for defense in
-- depth, mirroring 020 exactly.

CREATE TABLE IF NOT EXISTS student_topic_locks (
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  topic_id   uuid NOT NULL REFERENCES course_topics(id) ON DELETE CASCADE,
  is_locked  boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_stl_topic_id
  ON student_topic_locks(topic_id);

ALTER TABLE student_topic_locks ENABLE ROW LEVEL SECURITY;

-- A row is visible/writable to the teacher who owns the student. Mirrors the
-- pattern used in 020_student_course_exam_dates.sql.
DO $$ BEGIN
  CREATE POLICY "stl_select_teacher" ON student_topic_locks
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM students s
              WHERE s.id = student_id AND s.teacher_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "stl_insert_teacher" ON student_topic_locks
    FOR INSERT WITH CHECK (
      EXISTS (SELECT 1 FROM students s
              WHERE s.id = student_id AND s.teacher_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "stl_update_teacher" ON student_topic_locks
    FOR UPDATE USING (
      EXISTS (SELECT 1 FROM students s
              WHERE s.id = student_id AND s.teacher_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "stl_delete_teacher" ON student_topic_locks
    FOR DELETE USING (
      EXISTS (SELECT 1 FROM students s
              WHERE s.id = student_id AND s.teacher_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Students should be able to read their own override too — the learning-map
-- endpoint runs with the student's auth context when they open their map.
DO $$ BEGIN
  CREATE POLICY "stl_select_self" ON student_topic_locks
    FOR SELECT USING (student_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
