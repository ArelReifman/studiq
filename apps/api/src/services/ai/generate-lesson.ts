import { eq, and, desc, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  students,
  profiles,
  studentAiProfiles,
  difficultyReports,
  teacherAiFeedback,
  lessonSessions,
  homeworkItems,
  todoItems,
  teachers,
  courses,
  courseTopics,
  learningResources,
} from "../../db/schema.js";
import { callClaude } from "./claude.js";
import {
  buildLessonGenerationPrompt,
  type LessonRetryContext,
} from "./prompts.js";

// Phase 1A — lesson + retry generation runs on Sonnet for real pedagogical
// depth. Shared by both flows for now (regular and retry use the same model and
// token budget). 8192 tokens replaces the old 2048 default so a full lesson
// (4–6 homework items with descriptions + 3–5 todos) is never truncated, while
// still bounding latency/cost. All other AI flows keep the Haiku default.
const LESSON_MODEL = "claude-sonnet-4-6";
const LESSON_MAX_TOKENS = 8192;

const GeneratedLessonSchema = z.object({
  title: z.string(),
  description: z.string(),
  homework_items: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      order_index: z.number(),
    })
  ),
  todo_items: z.array(
    z.object({
      title: z.string(),
      order_index: z.number(),
    })
  ),
});

/**
 * Optional Learning Map anchoring. When provided, the generated lesson is
 * persisted with course_id/topic_id (so it shows up on the map and counts
 * toward the topic) and the prompt is enriched with course/topic context.
 * When omitted, generation behaves exactly as before (legacy, map-invisible).
 */
export interface GenerateLessonOpts {
  courseId: string;
  topicId: string | null;
  /**
   * Phase AI-0.5 — when set, this generation is a *retry* of a previous
   * (failed) lesson. generateLesson then, in order:
   *   1. enriches the prompt with the predecessor's failed-task titles +
   *      teacher review note (text only — the student's solution file is
   *      never read),
   *   2. archives the predecessor and enforces the one-active-lesson invariant
   *      inside the same insert transaction (concurrency-safe idempotency),
   *   3. tags ai_generation_context with { mode: "retry", retry_of_lesson_id }.
   * Ownership and active-course validation of the predecessor are the caller's
   * responsibility (the POST /lessons/generate route) before this runs.
   */
  retryOfLessonId?: string | null;
}

/**
 * Fetches a compact slice of Learning Map context for the prompt: course name,
 * current topic, its prerequisite names, and up to 5 relevant study-material
 * titles. Resources are read server-side only — titles/descriptions feed the
 * prompt, never the API response, and file URLs/paths are never touched here.
 */
async function fetchLearningMapContext(
  teacherId: string,
  opts: GenerateLessonOpts
) {
  const [courseRow, topicRow, resources] = await Promise.all([
    db
      .select({ name: courses.name })
      .from(courses)
      .where(eq(courses.id, opts.courseId))
      .limit(1)
      .then((r) => r[0]),
    opts.topicId
      ? db
          .select({
            name: courseTopics.name,
            description: courseTopics.description,
            prerequisite_topic_ids: courseTopics.prerequisite_topic_ids,
          })
          .from(courseTopics)
          .where(eq(courseTopics.id, opts.topicId))
          .limit(1)
          .then((r) => r[0])
      : Promise.resolve(undefined),
    // Shared/course-level materials for this teacher+course, optionally
    // narrowed to the topic. student_id IS NULL keeps per-student materials
    // out. Titles only, capped at 5 — keeps the prompt cheap.
    db
      .select({
        title: learningResources.title,
        description: learningResources.description,
      })
      .from(learningResources)
      .where(
        and(
          eq(learningResources.teacher_id, teacherId),
          eq(learningResources.course_id, opts.courseId),
          isNull(learningResources.student_id),
          opts.topicId
            ? or(
                eq(learningResources.topic_id, opts.topicId),
                isNull(learningResources.topic_id)
              )
            : isNull(learningResources.topic_id)
        )
      )
      .orderBy(desc(learningResources.created_at))
      .limit(5),
  ]);

  if (!courseRow) return null;

  let prerequisiteNames: string[] = [];
  const prereqIds = topicRow?.prerequisite_topic_ids ?? [];
  if (prereqIds.length > 0) {
    const prereqRows = await db
      .select({ name: courseTopics.name })
      .from(courseTopics)
      .where(inArray(courseTopics.id, prereqIds));
    prerequisiteNames = prereqRows.map((r) => r.name);
  }

  return {
    courseName: courseRow.name,
    topicName: topicRow?.name ?? null,
    topicDescription: topicRow?.description ?? null,
    prerequisiteNames,
    resources: resources.map((r) => ({
      title: r.title,
      description: r.description,
    })),
  };
}

export async function generateLesson(
  studentId: string,
  teacherId: string,
  opts?: GenerateLessonOpts
) {
  // 1. Fetch all context in parallel
  const [studentRow, aiProfile, recentDifficulties, pendingFeedback, teacherRow] =
    await Promise.all([
      db
        .select({ full_name: profiles.full_name })
        .from(students)
        .innerJoin(profiles, eq(profiles.id, students.id))
        .where(eq(students.id, studentId))
        .limit(1)
        .then((rows) => rows[0]),

      db
        .select()
        .from(studentAiProfiles)
        .where(eq(studentAiProfiles.student_id, studentId))
        .limit(1)
        .then((rows) => rows[0]),

      db
        .select()
        .from(difficultyReports)
        .where(eq(difficultyReports.student_id, studentId))
        .orderBy(desc(difficultyReports.created_at))
        .limit(10),

      db
        .select()
        .from(teacherAiFeedback)
        .where(
          and(
            eq(teacherAiFeedback.student_id, studentId),
            eq(teacherAiFeedback.incorporated, false)
          )
        )
        .orderBy(desc(teacherAiFeedback.created_at)),

      db
        .select({ teaching_style_summary: teachers.teaching_style_summary })
        .from(teachers)
        .where(eq(teachers.id, teacherId))
        .limit(1)
        .then((rows) => rows[0]),
    ]);

  if (!studentRow || !aiProfile) {
    throw new Error(`Student ${studentId} not found or has no AI profile`);
  }

  // 1b. Learning Map context — only when the caller anchored the lesson.
  const learningMap = opts
    ? await fetchLearningMapContext(teacherId, opts)
    : null;

  // 1c. Retry context (Phase AI-0.5) — only when this is a retry. Pull the
  // predecessor's failed task titles + teacher review note for the prompt.
  // Text only: the student's uploaded solution file is never read.
  let retryContext: LessonRetryContext | null = null;
  // Preserve the predecessor's lesson_level so the retry stays at the SAME
  // level (repeat semantics). NOTE: lesson_level is currently a dormant column
  // — no code path writes it today, so in practice this is null. Carrying it
  // forward makes "same level" truthful the moment levels start being set,
  // with no behaviour change while the column stays null.
  let predLevel: "base" | "medium" | "exam" | null = null;
  if (opts?.retryOfLessonId) {
    const predId = opts.retryOfLessonId;
    const [predRow, failedHw, failedTd] = await Promise.all([
      db
        .select({
          teacher_review_note: lessonSessions.teacher_review_note,
          lesson_level: lessonSessions.lesson_level,
        })
        .from(lessonSessions)
        .where(eq(lessonSessions.id, predId))
        .limit(1)
        .then((r) => r[0]),
      db
        .select({ title: homeworkItems.title })
        .from(homeworkItems)
        .where(
          and(
            eq(homeworkItems.lesson_id, predId),
            eq(homeworkItems.status, "failed")
          )
        ),
      db
        .select({ title: todoItems.title })
        .from(todoItems)
        .where(
          and(
            eq(todoItems.lesson_id, predId),
            eq(todoItems.status, "failed")
          )
        ),
    ]);
    predLevel = predRow?.lesson_level ?? null;
    retryContext = {
      failedTaskTitles: [
        ...failedHw.map((h) => h.title),
        ...failedTd.map((t) => t.title),
      ],
      teacherReviewNote: predRow?.teacher_review_note ?? null,
      lessonLevel: predLevel,
    };
  }

  // 2. Build prompt
  const prompt = buildLessonGenerationPrompt({
    studentName: studentRow.full_name,
    profile: aiProfile as any,
    recentDifficulties: recentDifficulties as any,
    teacherFeedback: pendingFeedback as any,
    teacherStyleSummary: teacherRow?.teaching_style_summary ?? null,
    similarLessons: [], // Phase 2: add vector retrieval here
    learningMap,
    retryContext,
  });

  // 3. Call Claude. Phase 1A: full lesson + retry generation runs on Sonnet
  // (richer pedagogy, larger token budget) while every other AI flow stays on
  // the Haiku default inside callClaude. The flow label drives metrics logging.
  const generated = await callClaude(
    prompt,
    (text) => {
      const parsed = JSON.parse(text);
      return GeneratedLessonSchema.parse(parsed);
    },
    {
      model: LESSON_MODEL,
      maxTokens: LESSON_MAX_TOKENS,
      flow: opts?.retryOfLessonId ? "lesson_retry" : "lesson_regular",
    }
  );

  // 4. Persist in a transaction
  const contextSnapshot = {
    ai_profile_snapshot: {
      weak_topics: aiProfile.weak_topics,
      strong_topics: aiProfile.strong_topics,
      learning_style: aiProfile.learning_style,
    },
    difficulty_count: recentDifficulties.length,
    feedback_count: pendingFeedback.length,
    course_id: opts?.courseId ?? null,
    topic_id: opts?.topicId ?? null,
    // Phase AI-0.5 — traceability of retries. Stored in the existing jsonb
    // column (no schema change). Not indexed; for lineage only.
    ...(opts?.retryOfLessonId
      ? { mode: "retry", retry_of_lesson_id: opts.retryOfLessonId }
      : {}),
  };

  const { lesson, created } = await db.transaction(async (tx) => {
    // Retry path (Phase AI-0.5): archive the predecessor and enforce the
    // one-active-lesson invariant atomically with the insert.
    if (opts?.retryOfLessonId) {
      // Archive the predecessor — only while it is still active. This
      // conditional UPDATE also serializes concurrent retries on the same
      // predecessor row (the second one updates 0 rows).
      await tx
        .update(lessonSessions)
        .set({ status: "archived" })
        .where(
          and(
            eq(lessonSessions.id, opts.retryOfLessonId),
            eq(lessonSessions.status, "active")
          )
        );

      // Duplicate-active guard: after archiving, if an active lesson already
      // exists on (student, course, topic) it was created by a concurrent or
      // already-completed retry — return it instead of inserting a second.
      // This is the API-level idempotency the frontend disable must not be
      // trusted to provide (LEARNING_MAP_CONTRACT.md §6).
      const [existing] = await tx
        .select()
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.student_id, studentId),
            eq(lessonSessions.course_id, opts.courseId),
            opts.topicId
              ? eq(lessonSessions.topic_id, opts.topicId)
              : isNull(lessonSessions.topic_id),
            eq(lessonSessions.status, "active")
          )
        )
        .limit(1);
      if (existing) return { lesson: existing, created: false };
    }

    const [newLesson] = await tx
      .insert(lessonSessions)
      .values({
        student_id: studentId,
        teacher_id: teacherId,
        title: generated.title,
        description: generated.description,
        ai_generated: true,
        status: "active",
        ai_generation_context: contextSnapshot,
        // Anchor to the Learning Map so the lesson is visible on the map and
        // counts toward the topic (LEARNING_MAP_CONTRACT.md §3). NULL stays
        // backward-compatible for legacy/unanchored generation.
        course_id: opts?.courseId ?? null,
        topic_id: opts?.topicId ?? null,
        // Retry stays at the predecessor's level (null today — see predLevel).
        lesson_level: predLevel,
      })
      .returning();

    if (!newLesson) throw new Error("Failed to create lesson");

    if (generated.homework_items.length > 0) {
      await tx.insert(homeworkItems).values(
        generated.homework_items.map((item) => ({
          lesson_id: newLesson.id,
          student_id: studentId,
          title: item.title,
          description: item.description,
          order_index: item.order_index,
        }))
      );
    }

    if (generated.todo_items.length > 0) {
      await tx.insert(todoItems).values(
        generated.todo_items.map((item) => ({
          lesson_id: newLesson.id,
          student_id: studentId,
          title: item.title,
          order_index: item.order_index,
        }))
      );
    }

    // Mark teacher feedback as incorporated
    if (pendingFeedback.length > 0) {
      const feedbackIds = pendingFeedback.map((f) => f.id);
      for (const id of feedbackIds) {
        await tx
          .update(teacherAiFeedback)
          .set({ incorporated: true })
          .where(eq(teacherAiFeedback.id, id));
      }
    }

    return { lesson: newLesson, created: true };
  });

  // 5. Update AI profile lesson count — only when we actually created a new
  // lesson. The idempotent retry return must not double-count.
  if (created) {
    await db
      .update(studentAiProfiles)
      .set({
        total_lessons: aiProfile.total_lessons + 1,
        updated_at: new Date(),
      })
      .where(eq(studentAiProfiles.student_id, studentId));
  }

  return lesson;
}
