-- 022_signup_course_id.sql
-- Lets a self-registering student pick a course during signup so their
-- learning map has somewhere to point right after the teacher approves
-- them — without waiting for the first lesson to be created.
--
-- Also adds primary_course_id on students. On approval we copy the value
-- from profiles → students so the public /learning-map endpoint can fall
-- back to it when the student has no lessons yet.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS signup_course_id UUID
    REFERENCES courses(id) ON DELETE SET NULL;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS primary_course_id UUID
    REFERENCES courses(id) ON DELETE SET NULL;
