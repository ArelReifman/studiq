-- Create the uploads bucket used for lesson materials and homework attachments.
-- Public so generated `getPublicUrl` links work without auth — but RLS on the
-- objects table still governs INSERT/UPDATE/DELETE.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'uploads',
  'uploads',
  true,
  52428800, -- 50 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Teachers can write lesson materials under `lessons/{teacherId}/…`
DO $$ BEGIN
  CREATE POLICY "uploads_teacher_lesson_write" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'uploads'
      AND name LIKE 'lessons/' || auth.uid()::text || '/%'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "uploads_teacher_lesson_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
      bucket_id = 'uploads'
      AND name LIKE 'lessons/' || auth.uid()::text || '/%'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "uploads_teacher_lesson_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id = 'uploads'
      AND name LIKE 'lessons/' || auth.uid()::text || '/%'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Students can write homework attachments under `homework/{studentId}/…`
DO $$ BEGIN
  CREATE POLICY "uploads_student_homework_write" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'uploads'
      AND name LIKE 'homework/' || auth.uid()::text || '/%'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "uploads_student_homework_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
      bucket_id = 'uploads'
      AND name LIKE 'homework/' || auth.uid()::text || '/%'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "uploads_student_homework_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id = 'uploads'
      AND name LIKE 'homework/' || auth.uid()::text || '/%'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Everyone with the URL can read (bucket is public anyway; this doc-policies it)
DO $$ BEGIN
  CREATE POLICY "uploads_public_read" ON storage.objects
    FOR SELECT TO anon, authenticated
    USING (bucket_id = 'uploads');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
