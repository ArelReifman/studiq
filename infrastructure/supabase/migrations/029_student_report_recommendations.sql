-- Student-safe recommendations for progress reports.
--
-- ai_recommendations (existing column) is teacher-only content — grounded in
-- private signals like the teacher's own review notes and the student's
-- reflections, phrased about the student for the teacher to read.
--
-- student_recommendations is a separate, purely structural derivation (no
-- LLM, no private notes) computed from the learning-map topic status at
-- generation time, so it's safe to show the student directly: which topics
-- are mastered / approved to move on ("maintain") vs. still struggling /
-- in progress ("improve"). Same table, same RLS as the existing columns —
-- policies already scope rows by student_id/teacher_id (migration 002).

ALTER TABLE student_reports
  ADD COLUMN IF NOT EXISTS student_recommendations jsonb;
