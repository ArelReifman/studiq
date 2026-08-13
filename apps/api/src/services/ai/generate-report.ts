import { eq, and, gte, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  studentAiProfiles,
  difficultyReports,
  lessonSessions,
  studentReports,
  studentInsights,
  profiles,
  students,
} from "../../db/schema.js";
import { callClaude } from "./claude.js";
import { buildReportPrompt } from "./prompts.js";
import { sanitizeHebrewText } from "./sanitize-text.js";
import { getLearningMap, flattenLearningMapTopics } from "../learning-map.js";

// Sonnet instead of the default Haiku — reports are read directly by
// teachers and students, and the extra cost buys noticeably more natural
// Hebrew phrasing than the fast/cheap default model produces.
const REPORT_MODEL = "claude-sonnet-4-6";

const ReportSchema = z.object({
  summary: z.string(),
  ai_recommendations: z.object({
    improve: z.array(z.string()),
    maintain: z.array(z.string()),
    suggested_difficulty: z.enum(["easier", "same", "harder"]),
  }),
  student_notes: z.object({
    improve: z.array(z.string()),
    maintain: z.array(z.string()),
  }),
});

/**
 * Pairs each topic name with the model's one-sentence note for it, matching
 * by position. Falls back to the bare topic name when the model returned a
 * different count than requested, so the student never sees a blank line.
 */
function pairTopicsWithNotes(topics: string[], notes: string[]): string[] {
  return topics.map((topic, i) => notes[i] ?? topic);
}

export async function generateReport(studentId: string, teacherId: string) {
  const periodEnd = new Date();
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - 7);

  const periodStartStr = periodStart.toISOString().split("T")[0]!;
  const periodEndStr = periodEnd.toISOString().split("T")[0]!;

  const [aiProfile, difficulties, completedLessons, studentRow, insights, previousReportRows] =
    await Promise.all([
      db
        .select()
        .from(studentAiProfiles)
        .where(eq(studentAiProfiles.student_id, studentId))
        .limit(1)
        .then((r) => r[0]),

      db
        .select({
          topic_tags: difficultyReports.topic_tags,
          description: difficultyReports.description,
          teacher_note: difficultyReports.teacher_note,
        })
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
        .select({
          full_name: profiles.full_name,
          background_note: students.background_note,
          primary_course_id: students.primary_course_id,
        })
        .from(students)
        .innerJoin(profiles, eq(profiles.id, students.id))
        .where(eq(students.id, studentId))
        .limit(1)
        .then((r) => r[0]),

      db
        .select({ content: studentInsights.content, created_at: studentInsights.created_at })
        .from(studentInsights)
        .where(
          and(
            eq(studentInsights.student_id, studentId),
            gte(studentInsights.created_at, periodStart)
          )
        )
        .orderBy(desc(studentInsights.created_at)),

      db
        .select({
          period_end: studentReports.period_end,
          completion_rate: studentReports.completion_rate,
          ai_recommendations: studentReports.ai_recommendations,
        })
        .from(studentReports)
        .where(eq(studentReports.student_id, studentId))
        .orderBy(desc(studentReports.generated_at))
        .limit(3),
    ]);

  if (!studentRow) throw new Error("Student not found");

  const completionRate = aiProfile ? Number(aiProfile.avg_completion_rate) : 0;

  // Learning-map snapshot for the student's active course, if any — feeds
  // both the teacher prompt (status breakdown) and the student-safe
  // recommendations below (topic names only, no LLM).
  const learningMap = studentRow.primary_course_id
    ? await getLearningMap(studentRow.primary_course_id, studentId)
    : null;

  const flatTopics = learningMap ? flattenLearningMapTopics(learningMap.topics) : [];
  const visibleTopics = flatTopics.filter((t) => !t.locked);
  const masteredTopics = visibleTopics
    .filter((t) => t.stats.status === "mastered")
    .map((t) => t.name);
  const strugglingTopics = visibleTopics
    .filter((t) => t.stats.status === "struggling")
    .map((t) => t.name);
  const inProgressTopics = visibleTopics
    .filter((t) => t.stats.status === "in_progress")
    .map((t) => t.name);

  const studentImproveTopics = [...strugglingTopics, ...inProgressTopics];
  const studentMaintainTopics = masteredTopics;

  const prompt = buildReportPrompt({
    studentName: studentRow.full_name,
    periodStart: periodStartStr,
    periodEnd: periodEndStr,
    totalLessons: completedLessons.length,
    completionRate,
    difficultyCount: difficulties.length,
    difficulties: difficulties.map((d) => ({
      topicTags: d.topic_tags,
      description: d.description,
      teacherNote: d.teacher_note,
    })),
    lessonReviews: completedLessons.map((l) => ({
      title: l.title,
      teacherDecision: l.teacher_decision,
      teacherReviewNote: l.teacher_review_note,
      studentReflection: l.student_reflection,
    })),
    insights: insights.map((i) => ({ content: i.content, created_at: i.created_at.toISOString() })),
    backgroundNote: studentRow.background_note,
    aiSummary: aiProfile?.ai_summary ?? null,
    learningMap: learningMap ? { masteredTopics, strugglingTopics, inProgressTopics } : null,
    previousReports: previousReportRows.map((r) => ({
      periodEnd: r.period_end,
      completionRate: r.completion_rate !== null ? Number(r.completion_rate) : null,
      improve: (r.ai_recommendations as { improve?: string[] } | null)?.improve ?? [],
    })),
    studentTopics: { improve: studentImproveTopics, maintain: studentMaintainTopics },
  });

  const rawGenerated = await callClaude(
    prompt,
    (text) => {
      const parsed = JSON.parse(text);
      return ReportSchema.parse(parsed);
    },
    { model: REPORT_MODEL }
  );

  // Deterministic safety net: the prompt forbids em-dashes/markdown, but a
  // fast model doesn't always comply perfectly. Strip stragglers.
  const generated = {
    summary: sanitizeHebrewText(rawGenerated.summary),
    ai_recommendations: {
      improve: rawGenerated.ai_recommendations.improve.map(sanitizeHebrewText),
      maintain: rawGenerated.ai_recommendations.maintain.map(sanitizeHebrewText),
      suggested_difficulty: rawGenerated.ai_recommendations.suggested_difficulty,
    },
    student_notes: {
      improve: rawGenerated.student_notes.improve.map(sanitizeHebrewText),
      maintain: rawGenerated.student_notes.maintain.map(sanitizeHebrewText),
    },
  };

  // Student-safe recommendations — topics are sourced purely from the
  // learning map's own (recovery-aware) status, no LLM involved there. Each
  // topic is then paired with a one-sentence teaching note the model wrote
  // specifically for the student (second person, no private teacher
  // commentary quoted) — falls back to the bare topic name if the model's
  // response didn't line up 1:1 with what was asked for.
  const studentRecommendations = {
    improve: pairTopicsWithNotes(studentImproveTopics, generated.student_notes.improve),
    maintain: pairTopicsWithNotes(studentMaintainTopics, generated.student_notes.maintain),
  };

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
      student_recommendations: studentRecommendations,
    })
    .returning();

  return report;
}
