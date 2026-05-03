/**
 * Generates a short Hebrew "pre-session briefing" for the teacher to read
 * before the next lesson with a student. Stored on student_ai_profiles.
 *
 * Triggered fire-and-forget after each lesson review/profile update so the
 * briefing is always fresh by the time the teacher opens the student page.
 *
 * Cheap call (~$0.01 per run) — small focused prompt, short output.
 */
import { eq, desc } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  studentAiProfiles,
  profiles,
  students,
  lessonSessions,
  studentInsights,
} from "../../db/schema.js";
import { callClaude } from "./claude.js";
import { buildBriefingPrompt } from "./prompts.js";

export async function generateNextSessionBriefing(
  studentId: string
): Promise<void> {
  const [profile, studentRow, lastLesson, insights] = await Promise.all([
    db
      .select()
      .from(studentAiProfiles)
      .where(eq(studentAiProfiles.student_id, studentId))
      .limit(1)
      .then((r) => r[0]),
    db
      .select({
        full_name: profiles.full_name,
        background_note: students.background_note,
      })
      .from(students)
      .innerJoin(profiles, eq(profiles.id, students.id))
      .where(eq(students.id, studentId))
      .limit(1)
      .then((r) => r[0]),
    // Most recent lesson — its review + reflection are the strongest signal
    db
      .select({
        title: lessonSessions.title,
        student_reflection: lessonSessions.student_reflection,
        teacher_review_note: lessonSessions.teacher_review_note,
        teacher_decision: lessonSessions.teacher_decision,
      })
      .from(lessonSessions)
      .where(eq(lessonSessions.student_id, studentId))
      .orderBy(desc(lessonSessions.generated_at))
      .limit(1)
      .then((r) => r[0]),
    db
      .select({ content: studentInsights.content })
      .from(studentInsights)
      .where(eq(studentInsights.student_id, studentId))
      .orderBy(desc(studentInsights.created_at))
      .limit(5),
  ]);

  if (!profile || !studentRow || !lastLesson) return;

  const prompt = buildBriefingPrompt({
    studentName: studentRow.full_name,
    lastLessonTitle: lastLesson.title,
    lastDecision: lastLesson.teacher_decision,
    lastReviewNote: lastLesson.teacher_review_note,
    studentReflection: lastLesson.student_reflection,
    weakTopics: profile.weak_topics,
    strongTopics: profile.strong_topics,
    aiSummary: profile.ai_summary,
    backgroundNote: studentRow.background_note,
    recentInsights: insights.map((i) => ({ content: i.content })),
  });

  const parsed = await callClaude(prompt, (text) => {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("no JSON in response");
    return JSON.parse(jsonMatch[0]) as { briefing: string };
  }).catch((err) => {
    console.error("[briefing] Claude parse failed:", err);
    return null;
  });

  if (!parsed?.briefing) return;

  await db
    .update(studentAiProfiles)
    .set({
      next_session_briefing: parsed.briefing,
      updated_at: new Date(),
    })
    .where(eq(studentAiProfiles.student_id, studentId));
}
