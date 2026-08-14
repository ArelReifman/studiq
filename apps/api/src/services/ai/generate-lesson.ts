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
import { callClaudeTool, type ToolInputSchema } from "./claude.js";
import {
  buildLessonGenerationPrompt,
  buildRetryChecklistPrompt,
  truncate,
} from "./prompts.js";

// Cap titles sent into the retry checklist prompt context. Descriptions/
// reflection are already capped inside buildRetryChecklistPrompt; titles are
// not, so bound them here (120 chars incl. ellipsis) to avoid prompt-token
// inflation from a pathologically long title. Applies only to the prompt
// context, never to the cloned DB rows (those copy the title verbatim).
const RETRY_TITLE_CAP = 120;

// Phase 1A — regular lesson generation runs on Sonnet for real pedagogical
// depth. 8192 tokens so a full lesson (4–6 homework items with descriptions +
// 3–5 todos) is never truncated, while still bounding latency/cost.
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

// JSON-Schema mirror of GeneratedLessonSchema for the Anthropic tool. It guides
// the model's structured output; GeneratedLessonSchema (Zod, above) remains the
// single source of truth for VALIDATION of the returned tool input.
const LESSON_TOOL_INPUT_SCHEMA: ToolInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "homework_items", "todo_items"],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    homework_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "order_index"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          order_index: { type: "number" },
        },
      },
    },
    todo_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "order_index"],
        properties: {
          title: { type: "string" },
          order_index: { type: "number" },
        },
      },
    },
  },
};

// Retry lessons duplicate the predecessor's content; the only thing the AI
// still generates for a retry is the teacher's review note turned into a
// short checklist. Small/cheap call — default Haiku model, small token budget.
const ChecklistSchema = z.object({
  items: z.array(z.string().min(1).max(300)).min(1).max(8),
});

const CHECKLIST_TOOL_INPUT_SCHEMA: ToolInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: { type: "string" },
    },
  },
};

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
   * When set, this generation is a *retry* of a previous (failed) lesson.
   * generateLesson then, in order:
   *   1. duplicates the predecessor's material (material_url/material_name)
   *      and exercises (homework/todo titles+descriptions, reset to pending
   *      with no files) verbatim — no LLM call for the lesson content itself;
   *   2. if the teacher left a review note, makes one small AI call turning
   *      that note into a short checklist (`retry_checklist`), using the
   *      failed tasks / linked difficulty reports / student reflection as
   *      secondary grounding (text only — the student's uploaded solution
   *      file is never read);
   *   3. archives the predecessor and enforces the one-active-lesson invariant
   *      inside the same insert transaction (concurrency-safe idempotency);
   *   4. tags ai_generation_context with { mode: "retry", content_mode:
   *      "duplicate", retry_of_lesson_id }.
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

interface RetryCloneResult {
  material_url: string | null;
  material_name: string | null;
  title: string;
  description: string | null;
  lessonLevel: "base" | "medium" | "exam" | null;
  homeworkItems: Array<{
    title: string;
    description: string | null;
    order_index: number;
  }>;
  todoItems: Array<{
    title: string;
    description: string | null;
    order_index: number;
  }>;
  retryChecklist: Array<{ text: string; done: boolean }> | null;
}

/**
 * Builds the retry clone: predecessor material + exercises copied verbatim,
 * plus (only when the teacher left a review note) a small AI call turning
 * that note into a checklist. No lesson-authoring LLM call happens here.
 */
async function buildRetryClone(
  predId: string,
  studentId: string
): Promise<RetryCloneResult> {
  // ── Wave 1: independent reads, in parallel ──────────────────────────────
  // predecessor row (title/description/reflection/note/level/material), the
  // FAILED homework + todos (id/title/description — checklist context only),
  // and ALL previous tasks (any status, ordered by order_index) — these are
  // the clone source for the new lesson's exercises.
  const [predRow, failedHw, failedTd, prevHw, prevTd] = await Promise.all([
    db
      .select({
        title: lessonSessions.title,
        description: lessonSessions.description,
        student_reflection: lessonSessions.student_reflection,
        teacher_review_note: lessonSessions.teacher_review_note,
        lesson_level: lessonSessions.lesson_level,
        material_url: lessonSessions.material_url,
        material_name: lessonSessions.material_name,
      })
      .from(lessonSessions)
      .where(eq(lessonSessions.id, predId))
      .limit(1)
      .then((r) => r[0]),
    db
      .select({
        id: homeworkItems.id,
        title: homeworkItems.title,
        description: homeworkItems.description,
      })
      .from(homeworkItems)
      .where(
        and(
          eq(homeworkItems.lesson_id, predId),
          eq(homeworkItems.status, "failed")
        )
      ),
    db
      .select({
        id: todoItems.id,
        title: todoItems.title,
        description: todoItems.description,
      })
      .from(todoItems)
      .where(
        and(eq(todoItems.lesson_id, predId), eq(todoItems.status, "failed"))
      ),
    db
      .select({
        title: homeworkItems.title,
        description: homeworkItems.description,
        order_index: homeworkItems.order_index,
      })
      .from(homeworkItems)
      .where(eq(homeworkItems.lesson_id, predId))
      .orderBy(homeworkItems.order_index),
    db
      .select({
        title: todoItems.title,
        description: todoItems.description,
        order_index: todoItems.order_index,
      })
      .from(todoItems)
      .where(eq(todoItems.lesson_id, predId))
      .orderBy(todoItems.order_index),
  ]);

  // ── Wave 2: linked difficulty reports — depends on the failed task ids ──
  // Match by source_id AND source_type (homework ids only against homework
  // reports, todo ids only against todo reports) — do not rely on source_id
  // uniqueness alone. Skipped entirely when there are no failed task ids
  // (never issues an `IN ()`).
  const failedHwIds = failedHw.map((h) => h.id);
  const failedTdIds = failedTd.map((t) => t.id);
  let linkedDiffs: Array<{
    description: string | null;
    topic_tags: string[];
    teacher_note: string | null;
  }> = [];
  const diffConds = [];
  if (failedHwIds.length > 0) {
    diffConds.push(
      and(
        eq(difficultyReports.source_type, "homework"),
        inArray(difficultyReports.source_id, failedHwIds)
      )
    );
  }
  if (failedTdIds.length > 0) {
    diffConds.push(
      and(
        eq(difficultyReports.source_type, "todo"),
        inArray(difficultyReports.source_id, failedTdIds)
      )
    );
  }
  if (diffConds.length > 0) {
    linkedDiffs = await db
      .select({
        description: difficultyReports.description,
        topic_tags: difficultyReports.topic_tags,
        teacher_note: difficultyReports.teacher_note,
      })
      .from(difficultyReports)
      .where(diffConds.length === 1 ? diffConds[0] : or(...diffConds));
  }

  const teacherReviewNote = predRow?.teacher_review_note ?? null;

  // Only spend an AI call when there's actually a note to parse — nothing to
  // turn into a checklist otherwise.
  let retryChecklist: Array<{ text: string; done: boolean }> | null = null;
  if (teacherReviewNote?.trim()) {
    const checklistPrompt = buildRetryChecklistPrompt({
      teacherReviewNote,
      failedTasks: [
        ...failedHw.map((h) => ({
          title: truncate(h.title, RETRY_TITLE_CAP),
          description: h.description,
        })),
        ...failedTd.map((t) => ({
          title: truncate(t.title, RETRY_TITLE_CAP),
          description: t.description,
        })),
      ],
      linkedDifficulties: linkedDiffs.map((d) => ({
        description: d.description,
        topicTags: d.topic_tags,
        teacherNote: d.teacher_note,
      })),
      studentReflection: predRow?.student_reflection ?? null,
    });

    const checklistResult = await callClaudeTool(
      checklistPrompt,
      (input) => ChecklistSchema.parse(input),
      {
        maxTokens: 512,
        flow: "lesson_retry_checklist",
        tool: {
          name: "emit_checklist",
          description:
            "Return the checklist items parsed from the teacher's review note.",
          inputSchema: CHECKLIST_TOOL_INPUT_SCHEMA,
        },
      }
    );
    retryChecklist = checklistResult.items.map((text) => ({
      text,
      done: false,
    }));
  }

  return {
    material_url: predRow?.material_url ?? null,
    material_name: predRow?.material_name ?? null,
    // When the predecessor row is missing (deleted / race), fall back to a
    // clearly-labeled placeholder rather than throwing — mirrors the prior
    // "predRow may be absent" tolerance.
    title: predRow?.title ?? "שיעור חוזר",
    description: predRow?.description ?? null,
    lessonLevel: predRow?.lesson_level ?? null,
    homeworkItems: prevHw.map((h) => ({
      title: h.title,
      description: h.description,
      order_index: h.order_index,
    })),
    todoItems: prevTd.map((t) => ({
      title: t.title,
      description: t.description,
      order_index: t.order_index,
    })),
    retryChecklist,
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

  // 1c. Retry clone (duplicate predecessor content + checklist-only AI call)
  // — only when this is a retry. Non-retry generation is untouched below.
  const retryClone = opts?.retryOfLessonId
    ? await buildRetryClone(opts.retryOfLessonId, studentId)
    : null;

  // 2. For non-retry generation, build the prompt and call Sonnet exactly as
  // before. Retries skip this entirely — their content is the clone above.
  const generated = retryClone
    ? null
    : await callClaudeTool(
        buildLessonGenerationPrompt({
          studentName: studentRow.full_name,
          profile: aiProfile as any,
          recentDifficulties: recentDifficulties as any,
          teacherFeedback: pendingFeedback as any,
          teacherStyleSummary: teacherRow?.teaching_style_summary ?? null,
          similarLessons: [], // Phase 2: add vector retrieval here
          learningMap,
        }),
        (input) => GeneratedLessonSchema.parse(input),
        {
          model: LESSON_MODEL,
          maxTokens: LESSON_MAX_TOKENS,
          flow: "lesson_regular",
          tool: {
            name: "emit_lesson",
            description:
              "Return the generated lesson. Put each field's content verbatim into the structured input — do NOT JSON-encode or escape values yourself; math/LaTeX and multi-line text are passed as plain strings.",
            inputSchema: LESSON_TOOL_INPUT_SCHEMA,
          },
        }
      );

  const newTitle = retryClone ? retryClone.title : generated!.title;
  const newDescription = retryClone
    ? retryClone.description
    : generated!.description;
  const newHomeworkItems = retryClone
    ? retryClone.homeworkItems
    : generated!.homework_items;
  // todo_items from regular generation carry no description (unchanged from
  // before); retry clones preserve whatever description the predecessor's
  // todo item had.
  const newTodoItems: Array<{
    title: string;
    description: string | null;
    order_index: number;
  }> = retryClone
    ? retryClone.todoItems
    : generated!.todo_items.map((item) => ({ ...item, description: null }));

  // 3. Persist in a transaction
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
    // Traceability of retries. Stored in the existing jsonb column (no schema
    // change). Not indexed; for lineage only.
    ...(opts?.retryOfLessonId
      ? {
          mode: "retry",
          content_mode: "duplicate",
          retry_of_lesson_id: opts.retryOfLessonId,
        }
      : {}),
  };

  const { lesson, created } = await db.transaction(async (tx) => {
    // Retry path: archive the predecessor and enforce the one-active-lesson
    // invariant atomically with the insert.
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
        title: newTitle,
        description: newDescription,
        ai_generated: true,
        status: "active",
        ai_generation_context: contextSnapshot,
        // Anchor to the Learning Map so the lesson is visible on the map and
        // counts toward the topic (LEARNING_MAP_CONTRACT.md §3). NULL stays
        // backward-compatible for legacy/unanchored generation.
        course_id: opts?.courseId ?? null,
        topic_id: opts?.topicId ?? null,
        // Retry stays at the predecessor's level (null today — no code path
        // writes lesson_level yet).
        lesson_level: retryClone?.lessonLevel ?? null,
        // Retry lesson's material is the predecessor's, duplicated as-is.
        material_url: retryClone?.material_url ?? null,
        material_name: retryClone?.material_name ?? null,
        retry_checklist: retryClone?.retryChecklist ?? null,
      })
      .returning();

    if (!newLesson) throw new Error("Failed to create lesson");

    if (newHomeworkItems.length > 0) {
      await tx.insert(homeworkItems).values(
        newHomeworkItems.map((item) => ({
          lesson_id: newLesson.id,
          student_id: studentId,
          title: item.title,
          description: item.description,
          order_index: item.order_index,
          // Retry clones reset progress — the student attempts the exercise
          // fresh. status/file fields default (pending, no files) either way.
        }))
      );
    }

    if (newTodoItems.length > 0) {
      await tx.insert(todoItems).values(
        newTodoItems.map((item) => ({
          lesson_id: newLesson.id,
          student_id: studentId,
          title: item.title,
          description: item.description,
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

  // 4. Update AI profile lesson count — only when we actually created a new
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
