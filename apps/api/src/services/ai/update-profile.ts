import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  homeworkItems,
  todoItems,
  difficultyReports,
  studentAiProfiles,
  studentCourseAiProfiles,
  profiles,
  students,
  lessonSessions,
  studentInsights,
} from "../../db/schema.js";
import { callClaude } from "./claude.js";
import { buildProfileUpdatePrompt } from "./prompts.js";
import { sanitizeHebrewText } from "./sanitize-text.js";
import { generateNextSessionBriefing } from "./generate-briefing.js";

// Sonnet instead of the default Haiku — same reasoning as the report
// generator: this text is read directly by the teacher (and via the
// briefing card, informs how they run the next session), so phrasing
// quality matters more than the small extra cost per call.
const PROFILE_MODEL = "claude-sonnet-4-6";

const ProfileUpdateSchema = z.object({
  ai_summary: z.string(),
  strong_topics: z.array(z.string()),
  weak_topics: z.array(z.string()),
  learning_style: z.enum([
    "visual",
    "step_by_step",
    "example_first",
    "theory_first",
    "unknown",
  ]),
});

export async function updateStudentProfile(
  studentId: string,
  lessonId: string,
  lessonTitle: string
): Promise<void> {
  const [hw, todos, profile, studentRow, lessonRow, insights] = await Promise.all([
    db
      .select()
      .from(homeworkItems)
      .where(eq(homeworkItems.lesson_id, lessonId)),
    db.select().from(todoItems).where(eq(todoItems.lesson_id, lessonId)),
    db
      .select()
      .from(studentAiProfiles)
      .where(eq(studentAiProfiles.student_id, studentId))
      .limit(1)
      .then((r) => r[0]),
    // Pull background_note alongside the name — fed to Claude as static context
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
    // Fetch reflection + teacher review so Claude learns from both sides
    db
      .select({
        student_reflection: lessonSessions.student_reflection,
        teacher_review_note: lessonSessions.teacher_review_note,
        teacher_decision: lessonSessions.teacher_decision,
        course_id: lessonSessions.course_id,
      })
      .from(lessonSessions)
      .where(eq(lessonSessions.id, lessonId))
      .limit(1)
      .then((r) => r[0]),
    // Recent teacher insights — newest first, weighted heavier in the prompt
    db
      .select({
        content: studentInsights.content,
        created_at: studentInsights.created_at,
      })
      .from(studentInsights)
      .where(eq(studentInsights.student_id, studentId))
      .orderBy(desc(studentInsights.created_at))
      .limit(10),
  ]);

  if (!profile || !studentRow) return;

  const allItems = [...hw, ...todos];
  const completedCount = allItems.filter((i) => i.status === "completed").length;
  const failedCount = allItems.filter((i) => i.status === "failed").length;
  const totalCount = allItems.length;

  // Collect topics from failed items via difficulty_reports
  const failedIds = [...hw, ...todos]
    .filter((i) => i.status === "failed")
    .map((i) => i.id);

  let failedTopics: string[] = [];
  if (failedIds.length > 0) {
    const reports = await db
      .select({ topic_tags: difficultyReports.topic_tags })
      .from(difficultyReports)
      .where(eq(difficultyReports.student_id, studentId));

    failedTopics = Array.from(
      new Set(reports.flatMap((r) => r.topic_tags))
    );
  }

  const completionRate =
    totalCount > 0 ? completedCount / totalCount : 0;

  const prompt = buildProfileUpdatePrompt({
    studentName: studentRow.full_name,
    currentSummary: profile.ai_summary,
    lessonTitle,
    completedCount,
    failedCount,
    failedTopics,
    studentReflection: lessonRow?.student_reflection ?? null,
    teacherReviewNote: lessonRow?.teacher_review_note ?? null,
    teacherDecision: lessonRow?.teacher_decision ?? null,
    backgroundNote: studentRow.background_note ?? null,
    insights: insights.map((i) => ({
      content: i.content,
      created_at: i.created_at.toISOString(),
    })),
  });

  try {
    const rawUpdated = await callClaude(
      prompt,
      (text) => {
        const parsed = JSON.parse(text);
        return ProfileUpdateSchema.parse(parsed);
      },
      { model: PROFILE_MODEL }
    );

    // Deterministic safety net: strip em-dashes/markdown the model may have
    // used despite the prompt's instructions not to.
    const updated = {
      ai_summary: sanitizeHebrewText(rawUpdated.ai_summary),
      strong_topics: rawUpdated.strong_topics.map(sanitizeHebrewText),
      weak_topics: rawUpdated.weak_topics.map(sanitizeHebrewText),
      learning_style: rawUpdated.learning_style,
    };

    // Recalculate rolling average completion rate
    const prevTotal = profile.total_lessons;
    const newAvg =
      prevTotal === 0
        ? completionRate
        : (Number(profile.avg_completion_rate) * prevTotal + completionRate) /
          (prevTotal + 1);

    await db
      .update(studentAiProfiles)
      .set({
        ai_summary: updated.ai_summary,
        strong_topics: updated.strong_topics,
        weak_topics: updated.weak_topics,
        learning_style: updated.learning_style,
        avg_completion_rate: newAvg.toFixed(2),
        total_homework: profile.total_homework + allItems.length,
        // Increment lesson count here so manually-created lessons are counted
        // too (AI-generated lessons already increment this in generate-lesson.ts).
        total_lessons: profile.total_lessons + 1,
        updated_at: new Date(),
      })
      .where(eq(studentAiProfiles.student_id, studentId));

    const courseId = lessonRow?.course_id ?? null;

    // Additive: also keep a per-course profile alongside the global row
    // above, for the teacher's per-course view. Course-less lessons have
    // nothing to scope this to — the global row already covers them.
    if (courseId) {
      const [existingCourseProfile] = await db
        .select({
          total_lessons: studentCourseAiProfiles.total_lessons,
          total_homework: studentCourseAiProfiles.total_homework,
          total_failures: studentCourseAiProfiles.total_failures,
          avg_completion_rate: studentCourseAiProfiles.avg_completion_rate,
        })
        .from(studentCourseAiProfiles)
        .where(
          and(
            eq(studentCourseAiProfiles.student_id, studentId),
            eq(studentCourseAiProfiles.course_id, courseId)
          )
        )
        .limit(1);

      const prevCourseTotal = existingCourseProfile?.total_lessons ?? 0;
      const newCourseAvg =
        prevCourseTotal === 0
          ? completionRate
          : (Number(existingCourseProfile?.avg_completion_rate ?? 0) * prevCourseTotal +
              completionRate) /
            (prevCourseTotal + 1);

      await db
        .insert(studentCourseAiProfiles)
        .values({
          student_id: studentId,
          course_id: courseId,
          ai_summary: updated.ai_summary,
          strong_topics: updated.strong_topics,
          weak_topics: updated.weak_topics,
          avg_completion_rate: newCourseAvg.toFixed(2),
          total_homework: (existingCourseProfile?.total_homework ?? 0) + allItems.length,
          total_lessons: prevCourseTotal + 1,
          total_failures: (existingCourseProfile?.total_failures ?? 0) + failedCount,
          updated_at: new Date(),
        })
        .onConflictDoUpdate({
          target: [studentCourseAiProfiles.student_id, studentCourseAiProfiles.course_id],
          set: {
            ai_summary: updated.ai_summary,
            strong_topics: updated.strong_topics,
            weak_topics: updated.weak_topics,
            avg_completion_rate: newCourseAvg.toFixed(2),
            total_homework: (existingCourseProfile?.total_homework ?? 0) + allItems.length,
            total_lessons: prevCourseTotal + 1,
            total_failures: (existingCourseProfile?.total_failures ?? 0) + failedCount,
            updated_at: new Date(),
          },
        });
    }

    // Fire-and-forget: refresh the pre-session briefing so the teacher sees
    // the latest "where we stopped / what to focus on" before the next lesson.
    generateNextSessionBriefing(studentId, courseId).catch((err) =>
      console.error("[briefing] generation failed:", err)
    );
  } catch (err) {
    console.error("Failed to update student AI profile:", err);
  }
}

/**
 * Rewrites ai_summary/strong_topics/weak_topics in the current Hebrew/
 * ben-adam style, WITHOUT touching total_lessons/avg_completion_rate/
 * total_homework — those are event-driven counters owned by
 * updateStudentProfile and must not be double-incremented here.
 *
 * For backfilling profiles that were generated before a prompt/style change
 * (e.g. the English-language profiles that existed before the Hebrew
 * rewrite) — not part of the normal per-lesson update flow.
 *
 * Returns false when there's nothing to rewrite (no profile / no existing
 * summary) or no lesson exists yet to give the prompt context.
 */
export async function refreshProfileLanguage(studentId: string): Promise<boolean> {
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
    db
      .select({
        id: lessonSessions.id,
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
      .select({ content: studentInsights.content, created_at: studentInsights.created_at })
      .from(studentInsights)
      .where(eq(studentInsights.student_id, studentId))
      .orderBy(desc(studentInsights.created_at))
      .limit(10),
  ]);

  if (!profile || !studentRow || !profile.ai_summary) return false;

  let completedCount = 0;
  let failedCount = 0;
  let failedTopics: string[] = [];
  if (lastLesson) {
    const [hw, todos] = await Promise.all([
      db.select().from(homeworkItems).where(eq(homeworkItems.lesson_id, lastLesson.id)),
      db.select().from(todoItems).where(eq(todoItems.lesson_id, lastLesson.id)),
    ]);
    const allItems = [...hw, ...todos];
    completedCount = allItems.filter((i) => i.status === "completed").length;
    failedCount = allItems.filter((i) => i.status === "failed").length;
    const failedIds = allItems.filter((i) => i.status === "failed").map((i) => i.id);
    if (failedIds.length > 0) {
      const reports = await db
        .select({ topic_tags: difficultyReports.topic_tags })
        .from(difficultyReports)
        .where(eq(difficultyReports.student_id, studentId));
      failedTopics = Array.from(new Set(reports.flatMap((r) => r.topic_tags)));
    }
  }

  const prompt = buildProfileUpdatePrompt({
    studentName: studentRow.full_name,
    currentSummary: profile.ai_summary,
    lessonTitle: lastLesson?.title ?? "",
    completedCount,
    failedCount,
    failedTopics,
    studentReflection: lastLesson?.student_reflection ?? null,
    teacherReviewNote: lastLesson?.teacher_review_note ?? null,
    teacherDecision: lastLesson?.teacher_decision ?? null,
    backgroundNote: studentRow.background_note ?? null,
    insights: insights.map((i) => ({
      content: i.content,
      created_at: i.created_at.toISOString(),
    })),
  });

  const rawUpdated = await callClaude(
    prompt,
    (text) => {
      const parsed = JSON.parse(text);
      return ProfileUpdateSchema.parse(parsed);
    },
    { model: PROFILE_MODEL }
  );

  const updated = {
    ai_summary: sanitizeHebrewText(rawUpdated.ai_summary),
    strong_topics: rawUpdated.strong_topics.map(sanitizeHebrewText),
    weak_topics: rawUpdated.weak_topics.map(sanitizeHebrewText),
    learning_style: rawUpdated.learning_style,
  };

  await db
    .update(studentAiProfiles)
    .set({
      ai_summary: updated.ai_summary,
      strong_topics: updated.strong_topics,
      weak_topics: updated.weak_topics,
      learning_style: updated.learning_style,
      updated_at: new Date(),
    })
    .where(eq(studentAiProfiles.student_id, studentId));

  await generateNextSessionBriefing(studentId).catch((err) =>
    console.error("[briefing] refresh failed:", err)
  );

  return true;
}
