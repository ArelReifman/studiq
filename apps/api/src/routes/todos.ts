import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  todoItems,
  difficultyReports,
  students,
  studentAiProfiles,
} from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { tagDifficulty } from "../services/ai/tag-difficulty.js";
import { uuidParamSchema } from "../lib/validators.js";

const lessonIdRequiredQuery = z.object({ lesson_id: z.string().uuid() });

export const todoRoutes = new Hono()
  .use(authMiddleware)

  .get("/", zValidator("query", lessonIdRequiredQuery), async (c) => {
    const userId = c.get("userId");
    const role = c.get("userRole");
    const lessonId = c.req.valid("query").lesson_id;

    const whereClause =
      role === "student"
        ? and(
            eq(todoItems.lesson_id, lessonId),
            eq(todoItems.student_id, userId)
          )
        : eq(todoItems.lesson_id, lessonId);

    const items = await db
      .select()
      .from(todoItems)
      .where(whereClause)
      .orderBy(todoItems.order_index);

    return c.json(items);
  })

  .patch(
    "/:id/mark",
    requireRole("student"),
    zValidator("param", uuidParamSchema),
    zValidator("json", z.object({ status: z.enum(["completed", "failed"]) })),
    async (c) => {
      const studentId = c.get("userId");
      const itemId = c.req.valid("param").id;
      const { status } = c.req.valid("json");
      const now = new Date();

      const [updated] = await db
        .update(todoItems)
        .set({ status, marked_at: now })
        .where(
          and(eq(todoItems.id, itemId), eq(todoItems.student_id, studentId))
        )
        .returning();

      if (!updated) return c.json({ error: "Todo item not found" }, 404);

      let difficultyReport = null;

      if (status === "failed") {
        const [student] = await db
          .select({ teacher_id: students.teacher_id })
          .from(students)
          .where(eq(students.id, studentId))
          .limit(1);

        if (!student) return c.json({ error: "Student not found" }, 500);

        const [report] = await db
          .insert(difficultyReports)
          .values({
            student_id: studentId,
            teacher_id: student.teacher_id,
            source_type: "todo",
            source_id: itemId,
            topic_tags: [],
            description: `Failed todo: ${updated.title}`,
          })
          .returning();

        difficultyReport = report;

        if (report) {
          tagDifficulty(report.id, updated.title, updated.description ?? "")
            .then(async (tags) => {
              await db
                .update(difficultyReports)
                .set({ topic_tags: tags })
                .where(eq(difficultyReports.id, report.id));

              const [profile] = await db
                .select()
                .from(studentAiProfiles)
                .where(eq(studentAiProfiles.student_id, studentId))
                .limit(1);

              if (profile) {
                const mergedWeak = Array.from(
                  new Set([...profile.weak_topics, ...tags])
                );
                await db
                  .update(studentAiProfiles)
                  .set({
                    weak_topics: mergedWeak,
                    total_failures: profile.total_failures + 1,
                    updated_at: new Date(),
                  })
                  .where(eq(studentAiProfiles.student_id, studentId));
              }
            })
            .catch(console.error);
        }
      }

      return c.json({
        item: { id: updated.id, status: updated.status, marked_at: updated.marked_at },
        difficulty_report: difficultyReport ? { id: difficultyReport.id } : null,
      });
    }
  );
