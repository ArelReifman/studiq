// ─── Core Auth ───────────────────────────────────────────────────────────────

export type UserRole = "teacher" | "student";

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string;
  email: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Teacher {
  id: string;
  bio: string | null;
  subjects: string[];
}

export interface Student {
  id: string;
  teacher_id: string;
  onboarded_at: string | null;
  grade_level: string | null;
  notes: string | null;
}

// ─── Topics ──────────────────────────────────────────────────────────────────

export type TopicSource = "initial_choice" | "ai_inferred" | "teacher_added";

export interface StudentTopic {
  id: string;
  student_id: string;
  topic: string;
  source: TopicSource;
  weight: number;
  created_at: string;
}

// ─── Courses ─────────────────────────────────────────────────────────────────

export interface Course {
  id: string;
  teacher_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface CourseTopic {
  id: string;
  course_id: string;
  name: string;
  description: string | null;
  is_shared: boolean;
  prerequisite_topic_ids: string[];
  order_index: number;
  created_at: string;
}

export interface CourseWithTopics extends Course {
  topics: CourseTopic[];
}

// ─── Lessons ─────────────────────────────────────────────────────────────────

export type LessonStatus = "active" | "completed" | "archived";
export type LessonLevel = "base" | "medium" | "exam";

export interface LessonSession {
  id: string;
  student_id: string;
  teacher_id: string;
  title: string;
  description: string | null;
  ai_generated: boolean;
  status: LessonStatus;
  generated_at: string;
  completed_at: string | null;
  ai_generation_context: Record<string, unknown> | null;
  material_url: string | null;
  material_name: string | null;
  student_reflection: string | null;
  course_id: string | null;
  topic_id: string | null;
  lesson_level: LessonLevel | null;
}

// ─── Homework & Todos ─────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "completed" | "failed";

export interface HomeworkItem {
  id: string;
  lesson_id: string;
  student_id: string;
  title: string;
  description: string | null;
  order_index: number;
  status: TaskStatus;
  file_url: string | null;
  file_name: string | null;
  marked_at: string | null;
  created_at: string;
}

export interface TodoItem {
  id: string;
  lesson_id: string;
  student_id: string;
  title: string;
  order_index: number;
  status: TaskStatus;
  marked_at: string | null;
  created_at: string;
}

// ─── Difficulty Reports ───────────────────────────────────────────────────────

export type DifficultySource = "homework" | "todo" | "manual";

export interface DifficultyReport {
  id: string;
  student_id: string;
  teacher_id: string;
  source_type: DifficultySource;
  source_id: string;
  topic_tags: string[];
  description: string | null;
  reviewed: boolean;
  teacher_note: string | null;
  created_at: string;
}

// ─── AI Profile ───────────────────────────────────────────────────────────────

export type LearningStyle =
  | "visual"
  | "step_by_step"
  | "example_first"
  | "theory_first"
  | "unknown";

export interface StudentAiProfile {
  id: string;
  student_id: string;
  strong_topics: string[];
  weak_topics: string[];
  learning_style: LearningStyle;
  avg_completion_rate: number;
  total_lessons: number;
  total_homework: number;
  total_failures: number;
  ai_summary: string | null;
  teacher_feedback_summary: string | null;
  updated_at: string;
}

// ─── Teacher AI Feedback ──────────────────────────────────────────────────────

export type FeedbackType =
  | "lesson_quality"
  | "difficulty_level"
  | "topic_relevance"
  | "general";

export type FeedbackSentiment = "positive" | "negative" | "neutral";

export interface TeacherAiFeedback {
  id: string;
  teacher_id: string;
  student_id: string;
  feedback_type: FeedbackType;
  sentiment: FeedbackSentiment | null;
  content: string;
  source_lesson_id: string | null;
  incorporated: boolean;
  created_at: string;
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export interface StudentReport {
  id: string;
  student_id: string;
  teacher_id: string;
  period_start: string;
  period_end: string;
  summary: string | null;
  completion_rate: number | null;
  difficulty_count: number | null;
  ai_recommendations: Record<string, unknown> | null;
  generated_at: string;
}

// ─── Joined / View types ──────────────────────────────────────────────────────

export interface StudentWithProfile extends Student {
  profile: Profile;
  ai_profile: StudentAiProfile | null;
}

export interface LessonWithItems extends LessonSession {
  homework_items: HomeworkItem[];
  todo_items: TodoItem[];
}
