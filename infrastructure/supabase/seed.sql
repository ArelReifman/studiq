-- Dev seed data
-- Run AFTER migrations, against a local Supabase instance

-- Note: auth.users rows must be created via Supabase Auth API.
-- This seed only shows the shape of data to insert after auth users exist.

-- Example teacher (replace UUIDs with real auth.users IDs)
-- INSERT INTO profiles (id, role, full_name, email) VALUES
--   ('00000000-0000-0000-0000-000000000001', 'teacher', 'David Cohen', 'teacher@dev.local');

-- INSERT INTO teachers (id, subjects) VALUES
--   ('00000000-0000-0000-0000-000000000001', ARRAY['Mathematics', 'Physics']);

-- Example student
-- INSERT INTO profiles (id, role, full_name, email) VALUES
--   ('00000000-0000-0000-0000-000000000002', 'student', 'Sarah Levi', 'student@dev.local');

-- INSERT INTO students (id, teacher_id, grade_level, invite_token) VALUES
--   ('00000000-0000-0000-0000-000000000002',
--    '00000000-0000-0000-0000-000000000001',
--    'Grade 9',
--    'dev-invite-token-123');

-- INSERT INTO student_ai_profiles (student_id) VALUES
--   ('00000000-0000-0000-0000-000000000002');
