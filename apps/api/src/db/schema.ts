import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  vector,
  date,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", ["teacher", "student"]);
export const profileStatusEnum = pgEnum("profile_status", [
  "pending",
  "approved",
  "rejected",
]);
export const topicSourceEnum = pgEnum("topic_source", [
  "initial_choice",
  "ai_inferred",
  "teacher_added",
]);
export const lessonStatusEnum = pgEnum("lesson_status", [
  "active",
  "completed",
  "archived",
]);
export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "completed",
  "failed",
]);
export const difficultySourceEnum = pgEnum("difficulty_source", [
  "homework",
  "todo",
  "manual",
]);
export const learningStyleEnum = pgEnum("learning_style", [
  "visual",
  "step_by_step",
  "example_first",
  "theory_first",
  "unknown",
]);
export const feedbackTypeEnum = pgEnum("feedback_type", [
  "lesson_quality",
  "difficulty_level",
  "topic_relevance",
  "general",
]);
export const feedbackSentimentEnum = pgEnum("feedback_sentiment", [
  "positive",
  "negative",
  "neutral",
]);
export const vectorTypeEnum = pgEnum("vector_type", [
  "lesson_summary",
  "difficulty_pattern",
  "teacher_feedback",
  "topic_interest",
]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "pending",
  "approved",
  "rejected",
  "cancel_requested",
  "cancelled",
]);
// Whether the lesson actually happened. Null = not marked yet.
export const lessonAttendanceEnum = pgEnum("lesson_attendance", [
  "attended",
  "no_show",
]);
export const dayOfWeekEnum = pgEnum("day_of_week", [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);
export const auditEventEnum = pgEnum("audit_event", [
  "auth.login_failed",
  "auth.register_failed",
  "auth.password_reset_requested",
  "authz.forbidden",
  "approvals.student_approved",
  "approvals.student_rejected",
  "rate_limit.blocked",
]);

export const lessonLevelEnum = pgEnum("lesson_level", [
  "base", // foundational exercises — build understanding
  "medium", // applied exercises — deepen concept
  "exam", // exam-style exercises — full picture
]);

// Teacher's verdict after reviewing the student's submitted solution.
// repeat      → same topic, same level — student needs more practice
// next_level  → same topic, harder level (base→medium→exam)
// next_topic  → student mastered this topic, move to next in syllabus
export const teacherDecisionEnum = pgEnum("teacher_decision", [
  "repeat",
  "next_level",
  "next_topic",
]);

// ─── Profiles (extends Supabase auth.users) ───────────────────────────────────

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // matches auth.users.id
  role: userRoleEnum("role").notNull(),
  full_name: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  avatar_url: text("avatar_url"),
  // Approval gate: existing rows default to 'approved' so live users keep working.
  // New self-service registrations land as 'pending' until a teacher approves them.
  status: profileStatusEnum("status").notNull().default("approved"),
  approved_at: timestamp("approved_at", { withTimezone: true }),
  approved_by: uuid("approved_by"),
  rejected_at: timestamp("rejected_at", { withTimezone: true }),
  // Optional self-described context surfaced to the teacher during review.
  signup_note: text("signup_note"),
  // Course the student picked during self-signup. Surfaced to the teacher
  // on the approvals page, and copied to students.primary_course_id on
  // approve so the learning map populates right away.
  signup_course_id: uuid("signup_course_id"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Teachers ─────────────────────────────────────────────────────────────────

export const teachers = pgTable("teachers", {
  id: uuid("id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  bio: text("bio"),
  subjects: text("subjects").array().notNull().default([]),
  // AI-accumulated teaching style — updated by Claude after every few feedbacks
  teaching_style_summary: text("teaching_style_summary"),
  teaching_feedback_count: integer("teaching_feedback_count").notNull().default(0),
});

// ─── Students ─────────────────────────────────────────────────────────────────

export const students = pgTable(
  "students",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => profiles.id, { onDelete: "cascade" }),
    teacher_id: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id),
    onboarded_at: timestamp("onboarded_at", { withTimezone: true }),
    grade_level: text("grade_level"),
    notes: text("notes"),
    invite_token: text("invite_token").unique(), // used for registration link
    // ── Teacher-curated long-form context (fed to AI) ──────────────────────
    // background_note: static context the teacher captures at onboarding —
    //   "has dyslexia", "anxious in exams", "supportive family". Rarely changes.
    // (What evolves over time — insights — lives in studentInsights table
    //  so each insight has its own timestamp and can be added/removed.)
    background_note: text("background_note"),
    // Course assigned at signup (or by the teacher on approval). Lets the
    // learning map default to a sensible course when the student has no
    // lessons yet — without this, a freshly-approved student lands on a
    // 404 because the existing logic requires at least one lesson.
    primary_course_id: uuid("primary_course_id"),
  },
  (t) => [index("idx_students_teacher_id").on(t.teacher_id)]
);

// ─── Student Insights (append-only learning notes from the teacher) ──────────
//
// Each row captures one observation the teacher discovered while teaching
// this student — e.g. "responds well to visual diagrams", "20-min sessions
// work better than 45". Append-only so the AI sees how understanding of the
// student evolved over time. Recent insights weigh more heavily in prompts.

export const studentInsights = pgTable(
  "student_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    teacher_id: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_student_insights_student_id").on(t.student_id),
    index("idx_student_insights_created_at").on(t.created_at),
  ]
);

// ─── Student Invites (pending — student not yet registered) ───────────────────

export const studentInvites = pgTable(
  "student_invites",
  {
    token: text("token").primaryKey(),
    teacher_id: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id, { onDelete: "cascade" }),
    full_name: text("full_name").notNull(),
    grade_level: text("grade_level"),
    notes: text("notes"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    used_at: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("idx_student_invites_teacher").on(t.teacher_id)]
);

// ─── Student Topics ───────────────────────────────────────────────────────────

export const studentTopics = pgTable(
  "student_topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    source: topicSourceEnum("source").notNull(),
    weight: numeric("weight", { precision: 4, scale: 2 })
      .notNull()
      .default("1.0"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_student_topics_student_id").on(t.student_id)]
);

// ─── Courses (teacher-defined syllabi, reused across students) ───────────────

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teacher_id: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // When the student takes the course exam. Drives the countdown hero
    // and exam-aware recommendations on the learning map.
    exam_date: timestamp("exam_date", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_courses_teacher_id").on(t.teacher_id)]
);

// ─── Course Topics (the learning map) ─────────────────────────────────────────

export const courseTopics = pgTable(
  "course_topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    course_id: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // `true` → foundational topic that other topics depend on
    is_shared: boolean("is_shared").notNull().default(false),
    // topic UUIDs that must be mastered before this one
    prerequisite_topic_ids: uuid("prerequisite_topic_ids")
      .array()
      .notNull()
      .default([]),
    order_index: integer("order_index").notNull().default(0),
    parent_topic_id: uuid("parent_topic_id"),  // NULL = top-level; FK wired via migration
    // Teacher-controlled lock: students cannot enter the topic while true.
    // Independent of `prerequisite_topic_ids` — both can lock; either one
    // is enough to keep the topic gated. Defaults to locked so new
    // topics stay hidden until the teacher actively unlocks them.
    is_locked: boolean("is_locked").notNull().default(true),
    // Optional per-topic deadline. Falls back to the course's exam_date when
    // NULL. Lets the teacher say "topic 1 should be solid by week 4 even
    // though the exam is later" so urgency reflects mid-semester quizzes.
    target_date: date("target_date"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_course_topics_course_id").on(t.course_id),
    index("idx_course_topics_parent_id").on(t.parent_topic_id),
  ]
);

// ─── Student → Course memberships ─────────────────────────────────────────────
// Join table: which courses a student is enrolled in.
// primary_course_id on students remains as the "active/default" course for
// backward-compatible fallback in GCal and learning-map resolution.
export const studentCourses = pgTable(
  "student_courses",
  {
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    course_id: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    added_at: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    is_active: boolean("is_active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("student_courses_pkey").on(t.student_id, t.course_id),
    index("idx_student_courses_student_id").on(t.student_id),
  ]
);

// ─── Per-student exam date overrides ─────────────────────────────────────────
// Override row keyed by (student_id, course_id). When present, takes priority
// over courses.exam_date in the learning-map computation. This is what lets
// the teacher set "Yuval has the exam on Aug 5, but Daniel on Aug 12" without
// duplicating the course.
export const studentCourseExamDates = pgTable(
  "student_course_exam_dates",
  {
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    course_id: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    exam_date: timestamp("exam_date", { withTimezone: true }).notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite primary key — drizzle expects this via a pgTable extra.
    // Using a unique index on (student, course) is functionally equivalent
    // and keeps the schema declaration simple.
    uniqueIndex("scee_pkey").on(t.student_id, t.course_id),
    index("idx_scee_course_id").on(t.course_id),
  ]
);

// ─── Lesson Sessions ──────────────────────────────────────────────────────────

export const lessonSessions = pgTable(
  "lesson_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    teacher_id: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id),
    title: text("title").notNull(),
    description: text("description"),
    ai_generated: boolean("ai_generated").notNull().default(true),
    status: lessonStatusEnum("status").notNull().default("active"),
    generated_at: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    ai_generation_context: jsonb("ai_generation_context"),
    material_url: text("material_url"),
    material_name: text("material_name"),
    // Student's uploaded solution (PDF / image). Independent of the
    // teacher's material above — same lesson, different file.
    student_solution_url: text("student_solution_url"),
    student_solution_name: text("student_solution_name"),
    student_reflection: text("student_reflection"),
    // ── Teacher review ───────────────────────────────────────────────────────
    // Filled in by the teacher after inspecting the student's submitted solution.
    // teacher_review_note: what the teacher observed in the submission
    // teacher_decision:    what happens next (repeat / next_level / next_topic)
    // This data is fed into the AI so it learns the teacher's grading standards.
    teacher_review_note: text("teacher_review_note"),
    teacher_decision: teacherDecisionEnum("teacher_decision"),
    teacher_reviewed_at: timestamp("teacher_reviewed_at", { withTimezone: true }),
    // Optional links — lessons without these still work exactly as before.
    course_id: uuid("course_id").references(() => courses.id, {
      onDelete: "set null",
    }),
    topic_id: uuid("topic_id").references(() => courseTopics.id, {
      onDelete: "set null",
    }),
    lesson_level: lessonLevelEnum("lesson_level"),
  },
  (t) => [
    index("idx_lesson_sessions_student_id").on(t.student_id),
    index("idx_lesson_sessions_teacher_id").on(t.teacher_id),
    index("idx_lesson_sessions_status").on(t.status),
    index("idx_lesson_sessions_course_id").on(t.course_id),
    index("idx_lesson_sessions_topic_id").on(t.topic_id),
  ]
);

// ─── Homework Items ───────────────────────────────────────────────────────────

export const homeworkItems = pgTable(
  "homework_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lesson_id: uuid("lesson_id")
      .notNull()
      .references(() => lessonSessions.id, { onDelete: "cascade" }),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id),
    title: text("title").notNull(),
    description: text("description"),
    order_index: integer("order_index").notNull().default(0),
    status: taskStatusEnum("status").notNull().default("pending"),
    file_url: text("file_url"),
    file_name: text("file_name"),
    marked_at: timestamp("marked_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_homework_items_lesson_id").on(t.lesson_id),
    index("idx_homework_items_student_id").on(t.student_id),
  ]
);

// ─── Todo Items ───────────────────────────────────────────────────────────────

export const todoItems = pgTable(
  "todo_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lesson_id: uuid("lesson_id")
      .notNull()
      .references(() => lessonSessions.id, { onDelete: "cascade" }),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id),
    title: text("title").notNull(),
    description: text("description"),
    order_index: integer("order_index").notNull().default(0),
    status: taskStatusEnum("status").notNull().default("pending"),
    marked_at: timestamp("marked_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_todo_items_lesson_id").on(t.lesson_id),
    index("idx_todo_items_student_id").on(t.student_id),
  ]
);

// ─── Difficulty Reports ───────────────────────────────────────────────────────

export const difficultyReports = pgTable(
  "difficulty_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id),
    teacher_id: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id),
    source_type: difficultySourceEnum("source_type").notNull(),
    source_id: uuid("source_id").notNull(),
    topic_tags: text("topic_tags").array().notNull().default([]),
    description: text("description"),
    reviewed: boolean("reviewed").notNull().default(false),
    teacher_note: text("teacher_note"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_difficulty_reports_student_id").on(t.student_id),
    index("idx_difficulty_reports_teacher_id").on(t.teacher_id),
    index("idx_difficulty_reports_reviewed").on(t.reviewed),
  ]
);

// ─── Student AI Profiles ──────────────────────────────────────────────────────

export const studentAiProfiles = pgTable("student_ai_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  student_id: uuid("student_id")
    .notNull()
    .unique()
    .references(() => students.id, { onDelete: "cascade" }),
  strong_topics: text("strong_topics").array().notNull().default([]),
  weak_topics: text("weak_topics").array().notNull().default([]),
  learning_style: learningStyleEnum("learning_style")
    .notNull()
    .default("unknown"),
  avg_completion_rate: numeric("avg_completion_rate", {
    precision: 4,
    scale: 2,
  })
    .notNull()
    .default("0"),
  total_lessons: integer("total_lessons").notNull().default(0),
  total_homework: integer("total_homework").notNull().default(0),
  total_failures: integer("total_failures").notNull().default(0),
  ai_summary: text("ai_summary"),
  teacher_feedback_summary: text("teacher_feedback_summary"),
  // Generated by Claude after each lesson review — short Hebrew briefing the
  // teacher reads before the next session ("where we stopped, what to focus on").
  next_session_briefing: text("next_session_briefing"),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── AI Context Vectors ───────────────────────────────────────────────────────

export const aiContextVectors = pgTable(
  "ai_context_vectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    vector_type: vectorTypeEnum("vector_type").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_ai_context_vectors_student_id").on(t.student_id)]
);

// ─── Teacher AI Feedback ──────────────────────────────────────────────────────

export const teacherAiFeedback = pgTable(
  "teacher_ai_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teacher_id: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id),
    feedback_type: feedbackTypeEnum("feedback_type").notNull(),
    sentiment: feedbackSentimentEnum("sentiment"),
    content: text("content").notNull(),
    source_lesson_id: uuid("source_lesson_id").references(
      () => lessonSessions.id
    ),
    incorporated: boolean("incorporated").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_teacher_ai_feedback_student_id").on(t.student_id),
    index("idx_teacher_ai_feedback_incorporated").on(t.incorporated),
  ]
);

// ─── Student Reports ──────────────────────────────────────────────────────────

export const studentReports = pgTable(
  "student_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id),
    teacher_id: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id),
    period_start: date("period_start").notNull(),
    period_end: date("period_end").notNull(),
    summary: text("summary"),
    completion_rate: numeric("completion_rate", { precision: 4, scale: 2 }),
    difficulty_count: integer("difficulty_count"),
    ai_recommendations: jsonb("ai_recommendations"),
    generated_at: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_student_reports_student_id").on(t.student_id),
    index("idx_student_reports_teacher_id").on(t.teacher_id),
  ]
);

// ─── Teacher Availability Slots ──────────────────────────────────────────────

// Per-date availability slots. Teacher creates a slot for a specific date+time.
// `day_of_week` is kept nullable for legacy recurring slots, but new code uses `date`.
export const teacherAvailability = pgTable(
  "teacher_availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teacher_id: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id, { onDelete: "cascade" }),
    // New per-date model: this is the canonical field.
    date: date("date"),
    // Legacy: kept nullable so existing rows still work; new rows use `date`.
    day_of_week: dayOfWeekEnum("day_of_week"),
    start_time: text("start_time").notNull(), // "09:00" (HH:mm)
    end_time: text("end_time").notNull(), // "10:00" (HH:mm)
    is_active: boolean("is_active").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_teacher_availability_teacher_id").on(t.teacher_id),
    index("idx_teacher_availability_date").on(t.date),
  ]
);

// ─── Lesson Bookings ─────────────────────────────────────────────────────────

export const lessonBookings = pgTable(
  "lesson_bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    teacher_id: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id),
    availability_id: uuid("availability_id")
      .references(() => teacherAvailability.id),
    date: date("date").notNull(), // "2026-04-15"
    start_time: text("start_time").notNull(), // "09:00"
    end_time: text("end_time").notNull(), // "10:00"
    status: bookingStatusEnum("status").notNull().default("pending"),
    student_note: text("student_note"),
    teacher_note: text("teacher_note"),
    gcal_event_id: text("gcal_event_id"), // Google Calendar event ID, set on approval
    attendance: lessonAttendanceEnum("attendance"), // Null until teacher marks
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_lesson_bookings_student_id").on(t.student_id),
    index("idx_lesson_bookings_teacher_id").on(t.teacher_id),
    index("idx_lesson_bookings_status").on(t.status),
    index("idx_lesson_bookings_date").on(t.date),
  ]
);

// ─── Teacher Google OAuth tokens ─────────────────────────────────────────────
// One row per teacher — upserted each time they reconnect Google Calendar.

export const teacherGoogleTokens = pgTable("teacher_google_tokens", {
  teacher_id: uuid("teacher_id")
    .primaryKey()
    .references(() => teachers.id, { onDelete: "cascade" }),
  access_token: text("access_token").notNull(),
  refresh_token: text("refresh_token").notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Audit log ────────────────────────────────────────────────────────────────
// Append-only security event log. Captures who did what, when, and from where.
// Writes are best-effort: a failed insert must NEVER block the underlying request.

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event: auditEventEnum("event").notNull(),
    actor_id: uuid("actor_id"), // user performing the action (nullable for unauth events)
    target_id: uuid("target_id"), // user/resource affected
    actor_email: text("actor_email"), // captured at time of event for traceability
    ip: text("ip"),
    path: text("path"),
    method: text("method"),
    detail: jsonb("detail"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_audit_logs_event").on(t.event),
    index("idx_audit_logs_actor_id").on(t.actor_id),
    index("idx_audit_logs_created_at").on(t.created_at),
  ]
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const profilesRelations = relations(profiles, ({ one }) => ({
  teacher: one(teachers, { fields: [profiles.id], references: [teachers.id] }),
  student: one(students, { fields: [profiles.id], references: [students.id] }),
}));

export const teachersRelations = relations(teachers, ({ one, many }) => ({
  profile: one(profiles, { fields: [teachers.id], references: [profiles.id] }),
  students: many(students),
  lessons: many(lessonSessions),
  availability: many(teacherAvailability),
  bookings: many(lessonBookings),
}));

export const studentsRelations = relations(students, ({ one, many }) => ({
  profile: one(profiles, { fields: [students.id], references: [profiles.id] }),
  teacher: one(teachers, {
    fields: [students.teacher_id],
    references: [teachers.id],
  }),
  topics: many(studentTopics),
  lessons: many(lessonSessions),
  homework_items: many(homeworkItems),
  todo_items: many(todoItems),
  difficulty_reports: many(difficultyReports),
  ai_profile: one(studentAiProfiles, {
    fields: [students.id],
    references: [studentAiProfiles.student_id],
  }),
  ai_vectors: many(aiContextVectors),
  reports: many(studentReports),
  bookings: many(lessonBookings),
  courses: many(studentCourses),
}));

export const studentCoursesRelations = relations(studentCourses, ({ one }) => ({
  student: one(students, {
    fields: [studentCourses.student_id],
    references: [students.id],
  }),
  course: one(courses, {
    fields: [studentCourses.course_id],
    references: [courses.id],
  }),
}));

export const lessonSessionsRelations = relations(
  lessonSessions,
  ({ one, many }) => ({
    student: one(students, {
      fields: [lessonSessions.student_id],
      references: [students.id],
    }),
    teacher: one(teachers, {
      fields: [lessonSessions.teacher_id],
      references: [teachers.id],
    }),
    course: one(courses, {
      fields: [lessonSessions.course_id],
      references: [courses.id],
    }),
    topic: one(courseTopics, {
      fields: [lessonSessions.topic_id],
      references: [courseTopics.id],
    }),
    homework_items: many(homeworkItems),
    todo_items: many(todoItems),
  })
);

export const coursesRelations = relations(courses, ({ one, many }) => ({
  teacher: one(teachers, {
    fields: [courses.teacher_id],
    references: [teachers.id],
  }),
  topics: many(courseTopics),
  lessons: many(lessonSessions),
}));

export const courseTopicsRelations = relations(courseTopics, ({ one, many }) => ({
  course: one(courses, {
    fields: [courseTopics.course_id],
    references: [courses.id],
  }),
  lessons: many(lessonSessions),
}));

export const teacherAvailabilityRelations = relations(
  teacherAvailability,
  ({ one }) => ({
    teacher: one(teachers, {
      fields: [teacherAvailability.teacher_id],
      references: [teachers.id],
    }),
  })
);

export const lessonBookingsRelations = relations(
  lessonBookings,
  ({ one }) => ({
    student: one(students, {
      fields: [lessonBookings.student_id],
      references: [students.id],
    }),
    teacher: one(teachers, {
      fields: [lessonBookings.teacher_id],
      references: [teachers.id],
    }),
    availability: one(teacherAvailability, {
      fields: [lessonBookings.availability_id],
      references: [teacherAvailability.id],
    }),
  })
);
