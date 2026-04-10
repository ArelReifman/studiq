-- Migration 003: Student invites table (pending invites not yet registered)
CREATE TABLE IF NOT EXISTS public.student_invites (
  token text PRIMARY KEY,
  teacher_id uuid NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  grade_level text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_student_invites_teacher ON public.student_invites(teacher_id);

ALTER TABLE public.student_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage their own invites"
  ON public.student_invites
  FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

-- Allow anonymous SELECT by token (for the registration page to validate invites)
CREATE POLICY "Anyone can read an invite by token"
  ON public.student_invites
  FOR SELECT
  USING (used_at IS NULL);
