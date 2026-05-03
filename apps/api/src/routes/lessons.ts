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
import { updateStudentProfile } from "../services/ai/update-profile.js";
import { updateTeacherStyleIfDue } from "../services/ai/update-teacher-style.js";
import { createAdminSupabase } from "../lib/supabase.js";
import { studentIdQuerySchema, uuidParamSchema } from "../lib/validators.js";

export const lessonRoutes = new Hono()
  .use(authMiddleware)

  // GET /lessons — student: own; teacher: filter by student_id
  .get("/", zValidator("query", studentIdQuerySchema), async (c) => {
    const userId = c.get("userId");
    const role = c.get("userRole");
    const studentIdParam = c.req.valid("query").student_id;

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
  .get("/:id", zValidator("param", uuidParamSchema), async (c) => {
    const userId = c.get("userId");
    const role = c.get("userRole");
    const lessonId = c.req.valid("param").id;

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

  // POST /lessons/create — teacher manually creates a lesson with homework + todo items
  .post(
    "/create",
    requireRole("teacher"),
    zValidator(
      "json",
      z.object({
        student_id: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        homework: z
          .array(
            z.object({
              title: z.string().min(1).max(200),
              description: z.string().max(1000).optional(),
            })
          )
          .default([]),
        todos: z
          .array(
            z.object({
              title: z.string().min(1).max(200),
              description: z.string().max(1000).optional(),
            })
          )
          .default([]),
        course_id: z.string().uuid().nullable().optional(),
        topic_id: z.string().uuid().nullable().optional(),
        lesson_level: z.enum(["base", "medium", "exam"]).nullable().optional(),
      })
    ),
    async (c) => {
      const teacherId = c.get("userId");
      const {
        student_id,
        title,
        description,
        homework,
        todos,
        course_id,
        topic_id,
        lesson_level,
      } = c.req.valid("json");

      // Verify student belongs to teacher
      const [student] = await db
        .select({ id: students.id })
        .from(students)
        .where(
          and(eq(students.id, student_id), eq(students.teacher_id, teacherId))
        )
        .limit(1);

      if (!student) return c.json({ error: "Student not found" }, 404);

      // Create lesson
      const [lesson] = await db
        .insert(lessonSessions)
        .values({
          student_id,
          teacher_id: teacherId,
          title,
          description: description ?? null,
          ai_generated: false,
          status: "active",
          course_id: course_id ?? null,
          topic_id: topic_id ?? null,
          lesson_level: lesson_level ?? null,
        })
        .returning();

      if (!lesson) return c.json({ error: "Failed to create lesson" }, 500);

      // Insert homework items
      if (homework.length > 0) {
        await db.insert(homeworkItems).values(
          homework.map((hw, i) => ({
            lesson_id: lesson.id,
            student_id,
            title: hw.title,
            description: hw.description ?? null,
            order_index: i,
          }))
        );
      }

      // Insert todo items
      if (todos.length > 0) {
        await db.insert(todoItems).values(
          todos.map((td, i) => ({
            lesson_id: lesson.id,
            student_id,
            title: td.title,
            description: td.description ?? null,
            order_index: i,
          }))
        );
      }

      // Fetch full lesson with items
      const [hw, tds] = await Promise.all([
        db
          .select()
          .from(homeworkItems)
          .where(eq(homeworkItems.lesson_id, lesson.id))
          .orderBy(homeworkItems.order_index),
        db
          .select()
          .from(todoItems)
          .where(eq(todoItems.lesson_id, lesson.id))
          .orderBy(todoItems.order_index),
      ]);

      return c.json(
        { ...lesson, homework_items: hw, todo_items: tds },
        201
      );
    }
  )

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

  // DELETE /lessons/:id — teacher deletes a lesson (cascades to homework/todos)
  .delete("/:id", requireRole("teacher"), zValidator("param", uuidParamSchema), async (c) => {
    const teacherId = c.get("userId");
    const lessonId = c.req.valid("param").id;

    // Verify ownership and read material path before delete
    const [lesson] = await db
      .select({
        id: lessonSessions.id,
        material_name: lessonSessions.material_name,
      })
      .from(lessonSessions)
      .where(
        and(
          eq(lessonSessions.id, lessonId),
          eq(lessonSessions.teacher_id, teacherId)
        )
      )
      .limit(1);

    if (!lesson) return c.json({ error: "Lesson not found" }, 404);

    // Remove storage object if any (best-effort, doesn't block deletion)
    if (lesson.material_name) {
      try {
        const supabase = createAdminSupabase();
        const ext = (lesson.material_name.split(".").pop() || "bin").toLowerCase();
        await supabase.storage
          .from("uploads")
          .remove([`lessons/${teacherId}/${lessonId}.${ext}`]);
      } catch (err) {
        console.warn("[lessons] failed to remove storage object:", err);
      }
    }

    // DB cascade will clean up homework_items and todo_items via FK ON DELETE CASCADE
    await db
      .delete(lessonSessions)
      .where(eq(lessonSessions.id, lessonId));

    return c.json({ message: "Lesson deleted" });
  })

  // PATCH /lessons/:id/reflection — student writes how the lesson went for them
  .patch(
    "/:id/reflection",
    requireRole("student"),
    zValidator("param", uuidParamSchema),
    zValidator(
      "json",
      z.object({ reflection: z.string().max(2000) })
    ),
    async (c) => {
      const studentId = c.get("userId");
      const lessonId = c.req.valid("param").id;
      const { reflection } = c.req.valid("json");

      const trimmed = reflection.trim();

      const [updated] = await db
        .update(lessonSessions)
        .set({ student_reflection: trimmed === "" ? null : trimmed })
        .where(
          and(
            eq(lessonSessions.id, lessonId),
            eq(lessonSessions.student_id, studentId)
          )
        )
        .returning({
          id: lessonSessions.id,
          student_reflection: lessonSessions.student_reflection,
        });

      if (!updated) return c.json({ error: "Lesson not found" }, 404);
      return c.json(updated);
    }
  )

  // PATCH /lessons/:id/review — teacher records verdict after checking submission
  // teacher_review_note: what the teacher observed in the student's solution
  // teacher_decision:    repeat | next_level | next_topic
  // This feeds the AI so it learns the teacher's grading standards over time.
  .patch(
    "/:id/review",
    requireRole("teacher"),
    zValidator("param", uuidParamSchema),
    zValidator(
      "json",
      z.object({
        teacher_review_note: z.string().max(2000).optional(),
        teacher_decision: z.enum(["repeat", "next_level", "next_topic"]),
      })
    ),
    async (c) => {
      const teacherId = c.get("userId");
      const lessonId = c.req.valid("param").id;
      const { teacher_review_note, teacher_decision } = c.req.valid("json");

      const [updated] = await db
        .update(lessonSessions)
        .set({
          teacher_review_note: teacher_review_note?.trim() ?? null,
          teacher_decision,
          teacher_reviewed_at: new Date(),
        })
        .where(
          and(
            eq(lessonSessions.id, lessonId),
            eq(lessonSessions.teacher_id, teacherId)
          )
        )
        .returning();

      if (!updated) return c.json({ error: "Lesson not found" }, 404);

      // Fire-and-forget: refresh student AI profile so the teacher's verdict
      // is immediately incorporated before the next lesson is planned.
      updateStudentProfile(updated.student_id, updated.id, updated.title).catch(
        (err) => console.error("[student-profile] review update failed:", err)
      );

      // Also feed this decision into the teacher's style profile — without
      // this, no teacher style updates would happen now that the freeform
      // feedback form is gone. Throttled internally to every Nth signal.
      updateTeacherStyleIfDue(teacherId).catch((err) =>
        console.error("[teacher-style] review update failed:", err)
      );

      return c.json(updated);
    }
  )

  // PATCH /lessons/:id/status
  .patch(
    "/:id/status",
    requireRole("teacher"),
    zValidator("param", uuidParamSchema),
    zValidator(
      "json",
      z.object({ status: z.enum(["completed", "archived"]) })
    ),
    async (c) => {
      const teacherId = c.get("userId");
      const lessonId = c.req.valid("param").id;
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

      // Fire-and-forget: when a lesson is completed, ask Claude to refresh the
      // student's AI profile (strong/weak topics, learning style, ai_summary)
      // so the next lesson generation reflects what just happened.
      if (status === "completed") {
        updateStudentProfile(updated.student_id, updated.id, updated.title).catch(
          (err) => console.error("[student-profile] update failed:", err)
        );
      }

      return c.json(updated);
    }
  );
