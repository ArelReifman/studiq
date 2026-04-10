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

// ─── Profiles (extends Supabase auth.users) ───────────────────────────────────

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // matches auth.users.id
  role: userRoleEnum("role").notNull(),
  full_name: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  avatar_url: text("avatar_url"),
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
  },
  (t) => [index("idx_students_teacher_id").on(t.teacher_id)]
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
  },
  (t) => [
    index("idx_lesson_sessions_student_id").on(t.student_id),
    index("idx_lesson_sessions_teacher_id").on(t.teacher_id),
    index("idx_lesson_sessions_status").on(t.status),
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

// ─── Relations ────────────────────────────────────────────────────────────────

export const profilesRelations = relations(profiles, ({ one }) => ({
  teacher: one(teachers, { fields: [profiles.id], references: [teachers.id] }),
  student: one(students, { fields: [profiles.id], references: [students.id] }),
}));

export const teachersRelations = relations(teachers, ({ one, many }) => ({
  profile: one(profiles, { fields: [teachers.id], references: [profiles.id] }),
  students: many(students),
  lessons: many(lessonSessions),
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
    homework_items: many(homeworkItems),
    todo_items: many(todoItems),
  })
);
