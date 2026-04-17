-- Courses + topic map (the teacher's reusable syllabus per course).
-- Lessons optionally link to a course + topic; existing lessons remain valid.

-- ─── Enum: lesson difficulty level ───────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE lesson_level AS ENUM ('base', 'medium', 'exam');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Courses ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_courses_teacher_id ON courses(teacher_id);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "courses_select_teacher" ON courses
    FOR SELECT USING (teacher_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "courses_insert_teacher" ON courses
    FOR INSERT WITH CHECK (teacher_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "courses_update_teacher" ON courses
    FOR UPDATE USING (teacher_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "courses_delete_teacher" ON courses
    FOR DELETE USING (teacher_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Course Topics ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS course_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_shared boolean NOT NULL DEFAULT false,
  prerequisite_topic_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_topics_course_id ON course_topics(course_id);

ALTER TABLE course_topics ENABLE ROW LEVEL SECURITY;

-- A topic is visible to whoever can see its parent course
DO $$ BEGIN
  CREATE POLICY "course_topics_select" ON course_topics
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM courses c WHERE c.id = course_id AND c.teacher_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "course_topics_insert" ON course_topics
    FOR INSERT WITH CHECK (
      EXISTS (SELECT 1 FROM courses c WHERE c.id = course_id AND c.teacher_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "course_topics_update" ON course_topics
    FOR UPDATE USING (
      EXISTS (SELECT 1 FROM courses c WHERE c.id = course_id AND c.teacher_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "course_topics_delete" ON course_topics
    FOR DELETE USING (
      EXISTS (SELECT 1 FROM courses c WHERE c.id = course_id AND c.teacher_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Optional linkage from lesson_sessions to course + topic ─────────────────

ALTER TABLE lesson_sessions
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES courses(id) ON DELETE SET NULL;

ALTER TABLE lesson_sessions
  ADD COLUMN IF NOT EXISTS topic_id uuid REFERENCES course_topics(id) ON DELETE SET NULL;

ALTER TABLE lesson_sessions
  ADD COLUMN IF NOT EXISTS lesson_level lesson_level;

CREATE INDEX IF NOT EXISTS idx_lesson_sessions_course_id ON lesson_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_lesson_sessions_topic_id ON lesson_sessions(topic_id);

-- ─── Realtime publication: include new tables ────────────────────────────────

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE courses;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE course_topics;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL;
END $$;
