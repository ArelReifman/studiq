import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { teacherAiFeedback, students } from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

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

    return c.json(feedback, 201);
  })

  .get("/", async (c) => {
    const teacherId = c.get("userId");
    const studentId = c.req.query("student_id");

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
