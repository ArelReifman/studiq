-- Course exam dates + per-topic target dates.
-- The teacher sets exam_date on a course (e.g. 2026-08-05). Each topic
-- optionally has its own target_date — "by when the student should be in
-- shape on this topic" — and falls back to the course exam_date if NULL.
-- The student-facing UI uses these to drive a countdown hero, urgency
-- badges on topic cards, and exam-aware lesson recommendations.

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS exam_date timestamptz;

ALTER TABLE course_topics
  ADD COLUMN IF NOT EXISTS target_date date;
