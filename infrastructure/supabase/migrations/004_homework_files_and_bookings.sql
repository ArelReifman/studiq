-- ─── Homework file upload columns ────────────────────────────────────────────
ALTER TABLE homework_items ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE homework_items ADD COLUMN IF NOT EXISTS file_name TEXT;

-- ─── Booking / scheduling enums ──────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE day_of_week AS ENUM ('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Teacher availability ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teacher_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  day_of_week day_of_week NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Lesson bookings ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lesson_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  availability_id UUID REFERENCES teacher_availability(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status booking_status NOT NULL DEFAULT 'pending',
  student_note TEXT,
  teacher_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lesson_bookings_student ON lesson_bookings(student_id);
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_teacher ON lesson_bookings(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_availability_teacher ON teacher_availability(teacher_id);

-- ─── Supabase Storage: create uploads bucket ─────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('uploads', 'uploads', true)
ON CONFLICT (id) DO NOTHING;

-- ─── RLS for new tables ──────────────────────────────────────────────────────
ALTER TABLE teacher_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_bookings ENABLE ROW LEVEL SECURITY;

-- Teacher availability: teachers manage their own
CREATE POLICY "teacher_manage_availability" ON teacher_availability
  FOR ALL USING (teacher_id = auth.uid());

-- Students can read their teacher's availability
CREATE POLICY "student_read_availability" ON teacher_availability
  FOR SELECT USING (
    teacher_id IN (
      SELECT teacher_id FROM students WHERE id = auth.uid()
    )
  );

-- Lesson bookings: students see and manage their own
CREATE POLICY "student_manage_bookings" ON lesson_bookings
  FOR ALL USING (student_id = auth.uid());

-- Teachers see and manage bookings for their students
CREATE POLICY "teacher_manage_bookings" ON lesson_bookings
  FOR ALL USING (teacher_id = auth.uid());

-- Storage: students can upload to their own folder
CREATE POLICY "student_upload_homework" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'uploads' AND
    (storage.foldername(name))[1] = 'homework' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );

-- Students can read their own uploads
CREATE POLICY "student_read_own_uploads" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'uploads' AND
    (storage.foldername(name))[1] = 'homework' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );

-- Teachers can read homework uploads from their students
CREATE POLICY "teacher_read_student_uploads" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'uploads' AND
    (storage.foldername(name))[1] = 'homework' AND
    (storage.foldername(name))[2]::uuid IN (
      SELECT id FROM students WHERE teacher_id = auth.uid()
    )
  );

-- Students can delete (replace) their own uploads
CREATE POLICY "student_delete_own_uploads" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'uploads' AND
    (storage.foldername(name))[1] = 'homework' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
