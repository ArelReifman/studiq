-- ─── Enable RLS on all tables ─────────────────────────────────────────────────

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE todo_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE difficulty_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_ai_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_context_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_ai_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_reports ENABLE ROW LEVEL SECURITY;

-- ─── Helper function: get current user role ───────────────────────────────────

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ─── Helper function: get teacher_id for current student ──────────────────────

CREATE OR REPLACE FUNCTION get_my_teacher_id()
RETURNS UUID AS $$
  SELECT teacher_id FROM students WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ─── Profiles ─────────────────────────────────────────────────────────────────

-- Users can read their own profile
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (id = auth.uid());

-- Teachers can read profiles of their students
CREATE POLICY "profiles_select_teacher_students" ON profiles
  FOR SELECT USING (
    get_my_role() = 'teacher' AND
    id IN (SELECT id FROM students WHERE teacher_id = auth.uid())
  );

-- Users can update their own profile
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- ─── Teachers ─────────────────────────────────────────────────────────────────

CREATE POLICY "teachers_select_own" ON teachers
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "teachers_update_own" ON teachers
  FOR UPDATE USING (id = auth.uid());

-- ─── Students ─────────────────────────────────────────────────────────────────

-- Students see their own row
CREATE POLICY "students_select_own" ON students
  FOR SELECT USING (id = auth.uid());

-- Students update their own row (for onboarding)
CREATE POLICY "students_update_own" ON students
  FOR UPDATE USING (id = auth.uid());

-- Teachers see & manage their own students
CREATE POLICY "students_select_teacher" ON students
  FOR SELECT USING (teacher_id = auth.uid());

CREATE POLICY "students_insert_teacher" ON students
  FOR INSERT WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "students_update_teacher" ON students
  FOR UPDATE USING (teacher_id = auth.uid());

-- ─── Student Topics ───────────────────────────────────────────────────────────

CREATE POLICY "topics_select_student" ON student_topics
  FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "topics_insert_student" ON student_topics
  FOR INSERT WITH CHECK (student_id = auth.uid());

CREATE POLICY "topics_select_teacher" ON student_topics
  FOR SELECT USING (
    student_id IN (SELECT id FROM students WHERE teacher_id = auth.uid())
  );

-- ─── Lesson Sessions ──────────────────────────────────────────────────────────

CREATE POLICY "lessons_select_student" ON lesson_sessions
  FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "lessons_select_teacher" ON lesson_sessions
  FOR SELECT USING (teacher_id = auth.uid());

CREATE POLICY "lessons_insert_teacher" ON lesson_sessions
  FOR INSERT WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "lessons_update_teacher" ON lesson_sessions
  FOR UPDATE USING (teacher_id = auth.uid());

-- ─── Homework Items ───────────────────────────────────────────────────────────

CREATE POLICY "homework_select_student" ON homework_items
  FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "homework_update_student" ON homework_items
  FOR UPDATE USING (student_id = auth.uid());

CREATE POLICY "homework_select_teacher" ON homework_items
  FOR SELECT USING (
    student_id IN (SELECT id FROM students WHERE teacher_id = auth.uid())
  );

CREATE POLICY "homework_insert_teacher" ON homework_items
  FOR INSERT WITH CHECK (
    student_id IN (SELECT id FROM students WHERE teacher_id = auth.uid())
  );

-- ─── Todo Items ───────────────────────────────────────────────────────────────

CREATE POLICY "todos_select_student" ON todo_items
  FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "todos_update_student" ON todo_items
  FOR UPDATE USING (student_id = auth.uid());

CREATE POLICY "todos_select_teacher" ON todo_items
  FOR SELECT USING (
    student_id IN (SELECT id FROM students WHERE teacher_id = auth.uid())
  );

CREATE POLICY "todos_insert_teacher" ON todo_items
  FOR INSERT WITH CHECK (
    student_id IN (SELECT id FROM students WHERE teacher_id = auth.uid())
  );

-- ─── Difficulty Reports ───────────────────────────────────────────────────────

CREATE POLICY "difficulties_select_student" ON difficulty_reports
  FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "difficulties_select_teacher" ON difficulty_reports
  FOR SELECT USING (teacher_id = auth.uid());

CREATE POLICY "difficulties_insert_student" ON difficulty_reports
  FOR INSERT WITH CHECK (student_id = auth.uid());

CREATE POLICY "difficulties_update_teacher" ON difficulty_reports
  FOR UPDATE USING (teacher_id = auth.uid());

-- ─── Student AI Profiles ──────────────────────────────────────────────────────

CREATE POLICY "ai_profile_select_student" ON student_ai_profiles
  FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "ai_profile_select_teacher" ON student_ai_profiles
  FOR SELECT USING (
    student_id IN (SELECT id FROM students WHERE teacher_id = auth.uid())
  );

-- ─── AI Context Vectors ───────────────────────────────────────────────────────
-- Only accessible server-side via service role — no client-facing policies needed

-- ─── Teacher AI Feedback ──────────────────────────────────────────────────────

CREATE POLICY "ai_feedback_select_teacher" ON teacher_ai_feedback
  FOR SELECT USING (teacher_id = auth.uid());

CREATE POLICY "ai_feedback_insert_teacher" ON teacher_ai_feedback
  FOR INSERT WITH CHECK (teacher_id = auth.uid());

-- ─── Student Reports ──────────────────────────────────────────────────────────

CREATE POLICY "reports_select_student" ON student_reports
  FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "reports_select_teacher" ON student_reports
  FOR SELECT USING (teacher_id = auth.uid());

CREATE POLICY "reports_insert_teacher" ON student_reports
  FOR INSERT WITH CHECK (teacher_id = auth.uid());
