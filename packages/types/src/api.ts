import type { TaskStatus, FeedbackType, FeedbackSentiment } from "./database.js";

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface RegisterRequest {
  email: string;
  password: string;
  full_name: string;
  role: "teacher" | "student";
  teacher_invite_token?: string; // required when role=student
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  user: {
    id: string;
    email: string;
    role: "teacher" | "student";
    full_name: string;
  };
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

export interface CompleteOnboardingRequest {
  topics: string[];
  grade_level?: string;
}

// ─── Lessons ─────────────────────────────────────────────────────────────────

export interface GenerateLessonRequest {
  student_id: string;
}

export interface UpdateLessonStatusRequest {
  status: "completed" | "archived";
}

// ─── Homework / Todo ──────────────────────────────────────────────────────────

export interface MarkTaskRequest {
  status: TaskStatus;
}

export interface MarkTaskResponse {
  item: { id: string; status: TaskStatus; marked_at: string };
  difficulty_report?: { id: string } | null;
}

// ─── Difficulty Reports ───────────────────────────────────────────────────────

export interface UpdateDifficultyRequest {
  teacher_note?: string;
  reviewed?: boolean;
}

// ─── Students (teacher-facing) ────────────────────────────────────────────────

export interface InviteStudentRequest {
  email: string;
  full_name: string;
  grade_level?: string;
}

export interface InviteStudentResponse {
  invite_token: string;
  student_id: string;
}

// ─── AI Feedback ─────────────────────────────────────────────────────────────

export interface CreateAiFeedbackRequest {
  student_id: string;
  feedback_type: FeedbackType;
  sentiment?: FeedbackSentiment;
  content: string;
  source_lesson_id?: string;
}

// ─── Generic ──────────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  code?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}
