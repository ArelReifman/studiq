import { eq, and, gte, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  studentAiProfiles,
  difficultyReports,
  lessonSessions,
  studentReports,
  profiles,
  students,
} from "../../db/schema.js";
import { callClaude } from "./claude.js";
import { buildReportPrompt } from "./prompts.js";

const ReportSchema = z.object({
  summary: z.string(),
  ai_recommendations: z.object({
    focus_topics: z.array(z.string()),
    suggested_difficulty: z.enum(["easier", "same", "harder"]),
    notes: z.string(),
  }),
});

export async function generateReport(studentId: string, teacherId: string) {
  const periodEnd = new Date();
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - 7);

  const periodStartStr = periodStart.toISOString().split("T")[0]!;
  const periodEndStr = periodEnd.toISOString().split("T")[0]!;

  const [aiProfile, difficulties, completedLessons, studentRow] =
    await Promise.all([
      db
        .select()
        .from(studentAiProfiles)
        .where(eq(studentAiProfiles.student_id, studentId))
        .limit(1)
        .then((r) => r[0]),

      db
        .select({ topic_tags: difficultyReports.topic_tags })
        .from(difficultyReports)
        .where(
          and(
            eq(difficultyReports.student_id, studentId),
            gte(difficultyReports.created_at, periodStart)
          )
        ),

      db
        .select()
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.student_id, studentId),
            eq(lessonSessions.status, "completed"),
            gte(lessonSessions.completed_at!, periodStart)
          )
        ),

      db
        .select({ full_name: profiles.full_name })
        .from(students)
        .innerJoin(profiles, eq(profiles.id, students.id))
        .where(eq(students.id, studentId))
        .limit(1)
        .then((r) => r[0]),
    ]);

  if (!studentRow) throw new Error("Student not found");

  // Count topic frequency
  const topicCounts = new Map<string, number>();
  for (const d of difficulties) {
    for (const tag of d.topic_tags) {
      topicCounts.set(tag, (topicCounts.get(tag) ?? 0) + 1);
    }
  }
  const topDifficultTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([topic]) => topic);

  const completionRate = aiProfile
    ? Number(aiProfile.avg_completion_rate)
    : 0;

  const prompt = buildReportPrompt({
    studentName: studentRow.full_name,
    periodStart: periodStartStr,
    periodEnd: periodEndStr,
    totalLessons: completedLessons.length,
    completionRate,
    difficultyCount: difficulties.length,
    topDifficultTopics,
    aiSummary: aiProfile?.ai_summary ?? null,
  });

  const generated = await callClaude(prompt, (text) => {
    const parsed = JSON.parse(text);
    return ReportSchema.parse(parsed);
  });

  const [report] = await db
    .insert(studentReports)
    .values({
      student_id: studentId,
      teacher_id: teacherId,
      period_start: periodStartStr,
      period_end: periodEndStr,
      summary: generated.summary,
      completion_rate: completionRate.toFixed(2),
      difficulty_count: difficulties.length,
      ai_recommendations: generated.ai_recommendations,
    })
    .returning();

  return report;
}
