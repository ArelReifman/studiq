import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  homeworkItems,
  todoItems,
  difficultyReports,
  studentAiProfiles,
  profiles,
  students,
} from "../../db/schema.js";
import { callClaude } from "./claude.js";
import { buildProfileUpdatePrompt } from "./prompts.js";

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
  const [hw, todos, profile, studentRow] = await Promise.all([
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
    db
      .select({ full_name: profiles.full_name })
      .from(students)
      .innerJoin(profiles, eq(profiles.id, students.id))
      .where(eq(students.id, studentId))
      .limit(1)
      .then((r) => r[0]),
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
  });

  try {
    const updated = await callClaude(prompt, (text) => {
      const parsed = JSON.parse(text);
      return ProfileUpdateSchema.parse(parsed);
    });

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
        updated_at: new Date(),
      })
      .where(eq(studentAiProfiles.student_id, studentId));
  } catch (err) {
    console.error("Failed to update student AI profile:", err);
  }
}
