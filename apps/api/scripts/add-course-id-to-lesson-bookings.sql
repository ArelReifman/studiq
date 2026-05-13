-- Migration: add course_id (nullable) to lesson_bookings
-- Safe to run multiple times: IF NOT EXISTS guards both the column and the index.
--
-- Why nullable:
--   Existing rows have no course association yet — NULL is correct, not an error.
--   The column is populated going forward when a teacher creates or edits a lesson.
--   Student-initiated bookings (via the availability-slot flow) will also stay NULL
--   until Phase 2.2 wires up the course selector in LessonFormModal.
--
-- ON DELETE SET NULL:
--   If a course is deleted, the booking row survives; course_id becomes NULL.
--   This is safer than CASCADE (which would delete the booking) or RESTRICT
--   (which would prevent course deletion while bookings reference it).

ALTER TABLE lesson_bookings
  ADD COLUMN IF NOT EXISTS course_id uuid
  REFERENCES courses(id) ON DELETE SET NULL;

-- Index for lookups by course (e.g. future analytics, learning-map joins).
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_course_id
  ON lesson_bookings(course_id);
