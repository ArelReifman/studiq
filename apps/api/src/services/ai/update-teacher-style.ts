/**
 * Updates the teacher's accumulated "teaching style" profile by calling
 * Claude with the most recent signals — explicit feedback, difficulty
 * notes, manually-created lesson titles/descriptions, and (the strongest
 * signal) the teacher's own review decisions on submitted solutions.
 *
 * Called every Nth feedback/review event to keep cost bounded. Each call
 * site bumps the counter, and the actual Claude round-trip only fires
 * when (count % STYLE_UPDATE_INTERVAL === 0).
 *
 * Extracted from ai-feedback.ts so the lesson-review handler can also
 * trigger it — without that, the new flow (no more freeform feedback
 * form) would never refresh the teacher style profile.
 */
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  teachers,
  teacherAiFeedback,
  difficultyReports,
  lessonSessions,
} from "../../db/schema.js";
import { callClaude } from "./claude.js";
import { buildTeacherStyleUpdatePrompt } from "./prompts.js";

// Run Claude every Nth signal — keeps token usage bounded while still
// reacting to recent decisions within a few reviews.
const STYLE_UPDATE_INTERVAL = 3;

export async function updateTeacherStyleIfDue(teacherId: string): Promise<void> {
  const [teacher] = await db
    .select({
      teaching_style_summary: teachers.teaching_style_summary,
      teaching_feedback_count: teachers.teaching_feedback_count,
    })
    .from(teachers)
    .where(eq(teachers.id, teacherId))
    .limit(1);

  if (!teacher) return;

  const newCount = teacher.teaching_feedback_count + 1;

  // Bump counter immediately so concurrent calls don't double-fire Claude.
  await db
    .update(teachers)
    .set({ teaching_feedback_count: newCount })
    .where(eq(teachers.id, teacherId));

  if (newCount % STYLE_UPDATE_INTERVAL !== 0) return;

  const [recentFeedbacks, difficultyNotes, manualLessons, recentDecisions] =
    await Promise.all([
      db
        .select({
          feedback_type: teacherAiFeedback.feedback_type,
          content: teacherAiFeedback.content,
          sentiment: teacherAiFeedback.sentiment,
          created_at: teacherAiFeedback.created_at,
        })
        .from(teacherAiFeedback)
        .where(eq(teacherAiFeedback.teacher_id, teacherId))
        .orderBy(desc(teacherAiFeedback.created_at))
        .limit(15),

      db
        .select({
          teacher_note: difficultyReports.teacher_note,
          topic_tags: difficultyReports.topic_tags,
          created_at: difficultyReports.created_at,
        })
        .from(difficultyReports)
        .where(
          and(
            eq(difficultyReports.teacher_id, teacherId),
            eq(difficultyReports.reviewed, true)
          )
        )
        .orderBy(desc(difficultyReports.created_at))
        .limit(10),

      db
        .select({
          title: lessonSessions.title,
          description: lessonSessions.description,
          created_at: lessonSessions.generated_at,
        })
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.teacher_id, teacherId),
            eq(lessonSessions.ai_generated, false)
          )
        )
        .orderBy(desc(lessonSessions.generated_at))
        .limit(10),

      db
        .select({
          title: lessonSessions.title,
          teacher_decision: lessonSessions.teacher_decision,
          teacher_review_note: lessonSessions.teacher_review_note,
          teacher_reviewed_at: lessonSessions.teacher_reviewed_at,
        })
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.teacher_id, teacherId),
            isNotNull(lessonSessions.teacher_decision)
          )
        )
        .orderBy(desc(lessonSessions.teacher_reviewed_at))
        .limit(15),
    ]);

  if (
    recentFeedbacks.length === 0 &&
    difficultyNotes.length === 0 &&
    recentDecisions.length === 0
  ) {
    return;
  }

  const prompt = buildTeacherStyleUpdatePrompt({
    currentSummary: teacher.teaching_style_summary,
    feedbacks: recentFeedbacks.map((f) => ({
      ...f,
      created_at: f.created_at.toISOString(),
    })),
    difficultyNotes: difficultyNotes
      .filter((d) => d.teacher_note)
      .map((d) => ({
        note: d.teacher_note!,
        topics: d.topic_tags,
        created_at: d.created_at.toISOString(),
      })),
    manualLessons: manualLessons.map((l) => ({
      title: l.title,
      description: l.description ?? "",
    })),
    recentDecisions: recentDecisions
      .filter((d) => d.teacher_decision)
      .map((d) => ({
        lessonTitle: d.title,
        decision: d.teacher_decision!,
        note: d.teacher_review_note ?? null,
        reviewed_at: d.teacher_reviewed_at?.toISOString() ?? "",
      })),
    totalFeedbackCount: newCount,
  });

  const parsed = await callClaude(prompt, (text) => {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("no JSON in response");
    return JSON.parse(jsonMatch[0]) as {
      teaching_style_summary: string;
      key_patterns: string[];
    };
  }).catch((err) => {
    console.error("[teacher-style] Claude parse failed:", err);
    return null;
  });

  if (!parsed) return;

  await db
    .update(teachers)
    .set({ teaching_style_summary: parsed.teaching_style_summary })
    .where(eq(teachers.id, teacherId));

  console.log(
    `[teacher-style] updated profile for teacher ${teacherId} after ${newCount} signals`
  );
}
