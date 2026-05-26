-- Learning Resources — teacher-uploaded study materials (formula sheets,
-- summaries, PDFs, images, …) attached to a course and optionally a topic.
--
-- This table is SERVER-ONLY (Template B from docs/SUPABASE_DATA_API_GRANTS.md):
--   • RLS enabled, no client policies → deny-all to anon/authenticated.
--   • No GRANTs to anon/authenticated.
--   • Not added to supabase_realtime.
-- The API (service_role) bypasses RLS and reads/writes via Drizzle.

CREATE TABLE IF NOT EXISTS public.learning_resources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id      uuid NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  course_id       uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  -- NULL = applies to the whole course; non-NULL = scoped to a topic/subtopic
  topic_id        uuid REFERENCES public.course_topics(id) ON DELETE CASCADE,
  -- Reserved for a future per-student visibility tier (MVP-C). In Phase 1 this
  -- column is always NULL — keeping it here makes the future change additive.
  student_id      uuid REFERENCES public.students(id) ON DELETE CASCADE,
  title           text NOT NULL,
  description     text,
  file_name       text NOT NULL,
  file_url        text NOT NULL,
  storage_path    text NOT NULL,
  file_type       text NOT NULL,
  file_size_bytes integer,
  visibility      text NOT NULL
                  CHECK (visibility IN ('teacher_only','student_visible'))
                  DEFAULT 'teacher_only',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_resources_teacher_id
  ON public.learning_resources(teacher_id);
CREATE INDEX IF NOT EXISTS idx_learning_resources_course_id
  ON public.learning_resources(course_id);
CREATE INDEX IF NOT EXISTS idx_learning_resources_topic_id
  ON public.learning_resources(topic_id);

-- Template B — RLS on, no policies, no GRANTs, no realtime entry.
ALTER TABLE public.learning_resources ENABLE ROW LEVEL SECURITY;

-- ─── Storage RLS — extend bucket 'uploads' to allow teachers under
--     resources/{teacherId}/… (mirrors the existing lessons/ + homework/
--     prefixes from migration 006). Reads stay covered by the existing
--     uploads_public_read policy.

DO $$ BEGIN
  CREATE POLICY "uploads_teacher_resource_write" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'uploads'
      AND name LIKE 'resources/' || auth.uid()::text || '/%'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "uploads_teacher_resource_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
      bucket_id = 'uploads'
      AND name LIKE 'resources/' || auth.uid()::text || '/%'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "uploads_teacher_resource_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id = 'uploads'
      AND name LIKE 'resources/' || auth.uid()::text || '/%'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
