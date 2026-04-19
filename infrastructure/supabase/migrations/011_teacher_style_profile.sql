-- Migration 011: teacher teaching style profile
-- Adds a rolling AI-written summary of how this teacher prefers to structure
-- lessons. Updated by Claude after every few feedback submissions.

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS teaching_style_summary  text,
  ADD COLUMN IF NOT EXISTS teaching_feedback_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN teachers.teaching_style_summary IS
  'Claude-written narrative of this teacher''s preferred lesson structure, '
  'vocabulary, difficulty calibration, and pedagogical patterns. '
  'Injected into every lesson generation prompt for this teacher.';
COMMENT ON COLUMN teachers.teaching_feedback_count IS
  'Total feedback submissions processed into teaching_style_summary.';
