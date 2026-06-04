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
import { buildLessonGenerationPrompt } from "./prompts.js";

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

  // 2. Build prompt
  const prompt = buildLessonGenerationPrompt({
    studentName: studentRow.full_name,
    profile: aiProfile as any,
    recentDifficulties: recentDifficulties as any,
    teacherFeedback: pendingFeedback as any,
    teacherStyleSummary: teacherRow?.teaching_style_summary ?? null,
    similarLessons: [], // Phase 2: add vector retrieval here
    learningMap,
  });

  // 3. Call Claude
  const generated = await callClaude(prompt, (text) => {
    const parsed = JSON.parse(text);
    return GeneratedLessonSchema.parse(parsed);
  });

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
  };

  const lesson = await db.transaction(async (tx) => {
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

    return newLesson;
  });

  // 5. Update AI profile lesson count
  await db
    .update(studentAiProfiles)
    .set({
      total_lessons: aiProfile.total_lessons + 1,
      updated_at: new Date(),
    })
    .where(eq(studentAiProfiles.student_id, studentId));

  return lesson;
}
