-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('teacher', 'student');
CREATE TYPE topic_source AS ENUM ('initial_choice', 'ai_inferred', 'teacher_added');
CREATE TYPE lesson_status AS ENUM ('active', 'completed', 'archived');
CREATE TYPE task_status AS ENUM ('pending', 'completed', 'failed');
CREATE TYPE difficulty_source AS ENUM ('homework', 'todo', 'manual');
CREATE TYPE learning_style AS ENUM ('visual', 'step_by_step', 'example_first', 'theory_first', 'unknown');
CREATE TYPE feedback_type AS ENUM ('lesson_quality', 'difficulty_level', 'topic_relevance', 'general');
CREATE TYPE feedback_sentiment AS ENUM ('positive', 'negative', 'neutral');
CREATE TYPE vector_type AS ENUM ('lesson_summary', 'difficulty_pattern', 'teacher_feedback', 'topic_interest');

-- ─── Profiles ─────────────────────────────────────────────────────────────────

CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        user_role NOT NULL,
  full_name   TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Teachers ─────────────────────────────────────────────────────────────────

CREATE TABLE teachers (
  id          UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  bio         TEXT,
  subjects    TEXT[] NOT NULL DEFAULT '{}'
);

-- ─── Students ─────────────────────────────────────────────────────────────────

CREATE TABLE students (
  id              UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  teacher_id      UUID NOT NULL REFERENCES teachers(id),
  onboarded_at    TIMESTAMPTZ,
  grade_level     TEXT,
  notes           TEXT,
  invite_token    TEXT UNIQUE
);

CREATE INDEX idx_students_teacher_id ON students(teacher_id);

-- ─── Student Topics ───────────────────────────────────────────────────────────

CREATE TABLE student_topics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  topic       TEXT NOT NULL,
  source      topic_source NOT NULL,
  weight      NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_student_topics_student_id ON student_topics(student_id);

-- ─── Lesson Sessions ──────────────────────────────────────────────────────────

CREATE TABLE lesson_sessions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id              UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id              UUID NOT NULL REFERENCES teachers(id),
  title                   TEXT NOT NULL,
  description             TEXT,
  ai_generated            BOOLEAN NOT NULL DEFAULT true,
  status                  lesson_status NOT NULL DEFAULT 'active',
  generated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at            TIMESTAMPTZ,
  ai_generation_context   JSONB
);

CREATE INDEX idx_lesson_sessions_student_id ON lesson_sessions(student_id);
CREATE INDEX idx_lesson_sessions_teacher_id ON lesson_sessions(teacher_id);
CREATE INDEX idx_lesson_sessions_status ON lesson_sessions(status);

-- ─── Homework Items ───────────────────────────────────────────────────────────

CREATE TABLE homework_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id     UUID NOT NULL REFERENCES lesson_sessions(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES students(id),
  title         TEXT NOT NULL,
  description   TEXT,
  order_index   INT NOT NULL DEFAULT 0,
  status        task_status NOT NULL DEFAULT 'pending',
  marked_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_homework_items_lesson_id ON homework_items(lesson_id);
CREATE INDEX idx_homework_items_student_id ON homework_items(student_id);

-- ─── Todo Items ───────────────────────────────────────────────────────────────

CREATE TABLE todo_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id     UUID NOT NULL REFERENCES lesson_sessions(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES students(id),
  title         TEXT NOT NULL,
  order_index   INT NOT NULL DEFAULT 0,
  status        task_status NOT NULL DEFAULT 'pending',
  marked_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_todo_items_lesson_id ON todo_items(lesson_id);
CREATE INDEX idx_todo_items_student_id ON todo_items(student_id);

-- ─── Difficulty Reports ───────────────────────────────────────────────────────

CREATE TABLE difficulty_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID NOT NULL REFERENCES students(id),
  teacher_id    UUID NOT NULL REFERENCES teachers(id),
  source_type   difficulty_source NOT NULL,
  source_id     UUID NOT NULL,
  topic_tags    TEXT[] NOT NULL DEFAULT '{}',
  description   TEXT,
  reviewed      BOOLEAN NOT NULL DEFAULT false,
  teacher_note  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_difficulty_reports_student_id ON difficulty_reports(student_id);
CREATE INDEX idx_difficulty_reports_teacher_id ON difficulty_reports(teacher_id);
CREATE INDEX idx_difficulty_reports_reviewed ON difficulty_reports(reviewed);

-- ─── Student AI Profiles ──────────────────────────────────────────────────────

CREATE TABLE student_ai_profiles (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                UUID NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
  strong_topics             TEXT[] NOT NULL DEFAULT '{}',
  weak_topics               TEXT[] NOT NULL DEFAULT '{}',
  learning_style            learning_style NOT NULL DEFAULT 'unknown',
  avg_completion_rate       NUMERIC(4,2) NOT NULL DEFAULT 0,
  total_lessons             INT NOT NULL DEFAULT 0,
  total_homework            INT NOT NULL DEFAULT 0,
  total_failures            INT NOT NULL DEFAULT 0,
  ai_summary                TEXT,
  teacher_feedback_summary  TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── AI Context Vectors ───────────────────────────────────────────────────────

CREATE TABLE ai_context_vectors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  embedding   vector(1536),
  vector_type vector_type NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_context_vectors_student_id ON ai_context_vectors(student_id);
-- IVFFlat index for cosine similarity (create after inserting initial data)
-- CREATE INDEX idx_ai_context_vectors_embedding ON ai_context_vectors
--   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─── Teacher AI Feedback ──────────────────────────────────────────────────────

CREATE TABLE teacher_ai_feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id        UUID NOT NULL REFERENCES teachers(id),
  student_id        UUID NOT NULL REFERENCES students(id),
  feedback_type     feedback_type NOT NULL,
  sentiment         feedback_sentiment,
  content           TEXT NOT NULL,
  source_lesson_id  UUID REFERENCES lesson_sessions(id),
  incorporated      BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_teacher_ai_feedback_student_id ON teacher_ai_feedback(student_id);
CREATE INDEX idx_teacher_ai_feedback_incorporated ON teacher_ai_feedback(incorporated);

-- ─── Student Reports ──────────────────────────────────────────────────────────

CREATE TABLE student_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id          UUID NOT NULL REFERENCES students(id),
  teacher_id          UUID NOT NULL REFERENCES teachers(id),
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  summary             TEXT,
  completion_rate     NUMERIC(4,2),
  difficulty_count    INT,
  ai_recommendations  JSONB,
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_student_reports_student_id ON student_reports(student_id);
CREATE INDEX idx_student_reports_teacher_id ON student_reports(teacher_id);
