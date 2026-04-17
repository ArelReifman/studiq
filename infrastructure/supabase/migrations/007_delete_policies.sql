-- Add DELETE RLS policies so tables aren't wide-open to client deletes.
-- The API uses a direct postgres connection (bypasses RLS), so these are
-- purely a defence-in-depth layer: if anyone ever hits Supabase directly
-- with a user JWT, they can only delete rows they own.

-- Teacher can delete their own lesson + its children (cascade handles children)
DO $$ BEGIN
  CREATE POLICY "lessons_delete_teacher" ON lesson_sessions
    FOR DELETE USING (teacher_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Teacher can delete any homework tied to a lesson they own
DO $$ BEGIN
  CREATE POLICY "homework_delete_teacher" ON homework_items
    FOR DELETE USING (
      EXISTS (
        SELECT 1 FROM lesson_sessions l
        WHERE l.id = lesson_id AND l.teacher_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "todos_delete_teacher" ON todo_items
    FOR DELETE USING (
      EXISTS (
        SELECT 1 FROM lesson_sessions l
        WHERE l.id = lesson_id AND l.teacher_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Teacher can delete their students (API enforces cascading cleanup already)
DO $$ BEGIN
  CREATE POLICY "students_delete_teacher" ON students
    FOR DELETE USING (teacher_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Teacher can delete their own availability slots
DO $$ BEGIN
  CREATE POLICY "availability_delete_teacher" ON teacher_availability
    FOR DELETE USING (teacher_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Student can cancel their own bookings; teacher can cancel their own
DO $$ BEGIN
  CREATE POLICY "bookings_delete_student" ON lesson_bookings
    FOR DELETE USING (student_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "bookings_delete_teacher" ON lesson_bookings
    FOR DELETE USING (teacher_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Teacher can delete their own AI feedback entries
DO $$ BEGIN
  CREATE POLICY "ai_feedback_delete_teacher" ON teacher_ai_feedback
    FOR DELETE USING (teacher_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
