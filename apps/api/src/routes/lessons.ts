import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  lessonSessions,
  homeworkItems,
  todoItems,
  students,
} from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { generateLesson } from "../services/ai/generate-lesson.js";

export const lessonRoutes = new Hono()
  .use(authMiddleware)

  // GET /lessons — student: own; teacher: filter by student_id
  .get("/", async (c) => {
    const userId = c.get("userId");
    const role = c.get("userRole");
    const studentIdParam = c.req.query("student_id");

    let rows;
    if (role === "student") {
      rows = await db
        .select()
        .from(lessonSessions)
        .where(eq(lessonSessions.student_id, userId))
        .orderBy(desc(lessonSessions.generated_at));
    } else {
      const whereClause = studentIdParam
        ? and(
            eq(lessonSessions.teacher_id, userId),
            eq(lessonSessions.student_id, studentIdParam)
          )
        : eq(lessonSessions.teacher_id, userId);

      rows = await db
        .select()
        .from(lessonSessions)
        .where(whereClause)
        .orderBy(desc(lessonSessions.generated_at));
    }

    return c.json(rows);
  })

  // GET /lessons/:id — lesson detail with homework + todos
  .get("/:id", async (c) => {
    const userId = c.get("userId");
    const role = c.get("userRole");
    const lessonId = c.req.param("id");

    const [lesson] = await db
      .select()
      .from(lessonSessions)
      .where(eq(lessonSessions.id, lessonId))
      .limit(1);

    if (!lesson) return c.json({ error: "Lesson not found" }, 404);

    // Access control
    if (role === "student" && lesson.student_id !== userId) {
      return c.json({ error: "Forbidden" }, 403);
    }
    if (role === "teacher" && lesson.teacher_id !== userId) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const [hw, todos] = await Promise.all([
      db
        .select()
        .from(homeworkItems)
        .where(eq(homeworkItems.lesson_id, lessonId))
        .orderBy(homeworkItems.order_index),
      db
        .select()
        .from(todoItems)
        .where(eq(todoItems.lesson_id, lessonId))
        .orderBy(todoItems.order_index),
    ]);

    return c.json({ ...lesson, homework_items: hw, todo_items: todos });
  })

  // POST /lessons/generate — teacher triggers AI generation for a student
  .post(
    "/generate",
    requireRole("teacher"),
    zValidator("json", z.object({ student_id: z.string().uuid() })),
    async (c) => {
      const teacherId = c.get("userId");
      const { student_id } = c.req.valid("json");

      // Verify student belongs to teacher
      const [student] = await db
        .select({ id: students.id })
        .from(students)
        .where(
          and(eq(students.id, student_id), eq(students.teacher_id, teacherId))
        )
        .limit(1);

      if (!student) return c.json({ error: "Student not found" }, 404);

      const lesson = await generateLesson(student_id, teacherId);
      return c.json(lesson, 201);
    }
  )

  // PATCH /lessons/:id/status
  .patch(
    "/:id/status",
    requireRole("teacher"),
    zValidator(
      "json",
      z.object({ status: z.enum(["completed", "archived"]) })
    ),
    async (c) => {
      const teacherId = c.get("userId");
      const lessonId = c.req.param("id");
      const { status } = c.req.valid("json");

      const [updated] = await db
        .update(lessonSessions)
        .set({
          status,
          completed_at: status === "completed" ? new Date() : null,
        })
        .where(
          and(
            eq(lessonSessions.id, lessonId),
            eq(lessonSessions.teacher_id, teacherId)
          )
        )
        .returning();

      if (!updated) return c.json({ error: "Lesson not found" }, 404);
      return c.json(updated);
    }
  );
