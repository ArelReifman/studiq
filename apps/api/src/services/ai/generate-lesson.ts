import { eq, and, desc } from "drizzle-orm";
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

export async function generateLesson(studentId: string, teacherId: string) {
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

  // 2. Build prompt
  const prompt = buildLessonGenerationPrompt({
    studentName: studentRow.full_name,
    profile: aiProfile as any,
    recentDifficulties: recentDifficulties as any,
    teacherFeedback: pendingFeedback as any,
    teacherStyleSummary: teacherRow?.teaching_style_summary ?? null,
    similarLessons: [], // Phase 2: add vector retrieval here
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
