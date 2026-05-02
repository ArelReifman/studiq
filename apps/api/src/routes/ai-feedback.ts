import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  teacherAiFeedback,
  students,
  teachers,
  difficultyReports,
  lessonSessions,
} from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { callClaude } from "../services/ai/claude.js";
import { buildTeacherStyleUpdatePrompt } from "../services/ai/prompts.js";
import { studentIdQuerySchema } from "../lib/validators.js";

// Update teacher style every N feedback submissions
const STYLE_UPDATE_INTERVAL = 3;

const createFeedbackSchema = z.object({
  student_id: z.string().uuid(),
  feedback_type: z.enum([
    "lesson_quality",
    "difficulty_level",
    "topic_relevance",
    "general",
  ]),
  sentiment: z.enum(["positive", "negative", "neutral"]).optional(),
  content: z.string().min(1),
  source_lesson_id: z.string().uuid().optional(),
});

export const aiFeedbackRoutes = new Hono()
  .use(authMiddleware)
  .use(requireRole("teacher"))

  .post("/", zValidator("json", createFeedbackSchema), async (c) => {
    const teacherId = c.get("userId");
    const body = c.req.valid("json");

    // Verify student belongs to teacher
    const [student] = await db
      .select({ id: students.id })
      .from(students)
      .where(
        and(
          eq(students.id, body.student_id),
          eq(students.teacher_id, teacherId)
        )
      )
      .limit(1);

    if (!student) return c.json({ error: "Student not found" }, 404);

    const [feedback] = await db
      .insert(teacherAiFeedback)
      .values({ ...body, teacher_id: teacherId })
      .returning();

    // Fire-and-forget: update teacher style profile every N feedbacks
    updateTeacherStyleIfDue(teacherId).catch((err) =>
      console.error("[teacher-style] update failed:", err)
    );

    return c.json(feedback, 201);
  })

  .get("/", zValidator("query", studentIdQuerySchema), async (c) => {
    const teacherId = c.get("userId");
    const studentId = c.req.valid("query").student_id;

    const whereClause = studentId
      ? and(
          eq(teacherAiFeedback.teacher_id, teacherId),
          eq(teacherAiFeedback.student_id, studentId)
        )
      : eq(teacherAiFeedback.teacher_id, teacherId);

    const rows = await db
      .select()
      .from(teacherAiFeedback)
      .where(whereClause)
      .orderBy(desc(teacherAiFeedback.created_at));

    return c.json(rows);
  });

// ─── Background: update teacher teaching style profile ────────────────────────

async function updateTeacherStyleIfDue(teacherId: string): Promise<void> {
  // Fetch teacher row
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

  // Update count first
  await db
    .update(teachers)
    .set({ teaching_feedback_count: newCount })
    .where(eq(teachers.id, teacherId));

  // Only run Claude every N submissions
  if (newCount % STYLE_UPDATE_INTERVAL !== 0) return;

  // Collect all writing sources in parallel
  const [recentFeedbacks, difficultyNotes, manualLessons] = await Promise.all([
    // Explicit feedback submissions
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

    // Notes added to difficulty reports
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
          // Only notes that have actual text
          // Using raw sql would be cleaner but this works:
          eq(difficultyReports.reviewed, true)
        )
      )
      .orderBy(desc(difficultyReports.created_at))
      .limit(10),

    // Manually created lessons (title + description = teacher's own voice)
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
  ]);

  if (recentFeedbacks.length === 0 && difficultyNotes.length === 0) return;

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

  console.log(`[teacher-style] updated profile for teacher ${teacherId} after ${newCount} feedbacks`);
}
