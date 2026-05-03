-- Migration 014: student background + insights
--
-- Adds two pieces of teacher-curated context per student so the AI can
-- personalize generation beyond raw performance numbers:
--
--   students.background_note  — static context (set at onboarding, rarely changes)
--   student_insights          — append-only log of "what helps this student"
--                               (each row timestamped so recent insights
--                                weigh more in AI prompts)

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS background_note text;

CREATE TABLE IF NOT EXISTS student_insights (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id  uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_insights_student_id ON student_insights(student_id);
CREATE INDEX IF NOT EXISTS idx_student_insights_created_at ON student_insights(created_at);

-- Lock down at the row level — same posture as audit_logs (deny-all to
-- public clients; the API uses the service role).
ALTER TABLE student_insights ENABLE ROW LEVEL SECURITY;
