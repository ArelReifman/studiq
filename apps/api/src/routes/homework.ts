import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  homeworkItems,
  difficultyReports,
  students,
  studentAiProfiles,
} from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { tagDifficulty } from "../services/ai/tag-difficulty.js";
import { uuidParamSchema } from "../lib/validators.js";

// "pending" is the undo path — student tapped completed/failed by mistake
// and wants to revert. We then also clean up any difficulty_report we
// created on a previous "failed" mark so the AI signals don't linger.
const markSchema = z.object({
  status: z.enum(["completed", "failed", "pending"]),
});

const lessonIdRequiredQuery = z.object({ lesson_id: z.string().uuid() });

export const homeworkRoutes = new Hono()
  .use(authMiddleware)

  // GET /homework?lesson_id=
  .get("/", zValidator("query", lessonIdRequiredQuery), async (c) => {
    const userId = c.get("userId");
    const role = c.get("userRole");
    const lessonId = c.req.valid("query").lesson_id;

    const whereClause =
      role === "student"
        ? and(
            eq(homeworkItems.lesson_id, lessonId),
            eq(homeworkItems.student_id, userId)
          )
        : eq(homeworkItems.lesson_id, lessonId);

    const items = await db
      .select()
      .from(homeworkItems)
      .where(whereClause)
      .orderBy(homeworkItems.order_index);

    return c.json(items);
  })

  // PATCH /homework/:id/mark — the critical route
  .patch(
    "/:id/mark",
    requireRole("student"),
    zValidator("param", uuidParamSchema),
    zValidator("json", markSchema),
    async (c) => {
      const studentId = c.get("userId");
      const itemId = c.req.valid("param").id;
      const { status } = c.req.valid("json");
      const now = new Date();

      // Update homework item (verify ownership via student_id). When
      // reverting to pending we clear marked_at too so the timeline is
      // truthful — the item is back to untouched.
      const [updated] = await db
        .update(homeworkItems)
        .set({
          status,
          marked_at: status === "pending" ? null : now,
        })
        .where(
          and(
            eq(homeworkItems.id, itemId),
            eq(homeworkItems.student_id, studentId)
          )
        )
        .returning();

      if (!updated) return c.json({ error: "Homework item not found" }, 404);

      // Undo path: drop any difficulty_reports tied to this item so the
      // AI doesn't keep treating the failure as real signal.
      if (status === "pending") {
        await db
          .delete(difficultyReports)
          .where(
            and(
              eq(difficultyReports.source_type, "homework"),
              eq(difficultyReports.source_id, itemId)
            )
          );
        return c.json({
          item: {
            id: updated.id,
            status: updated.status,
            marked_at: updated.marked_at,
          },
          difficulty_report: null,
        });
      }

      let difficultyReport = null;

      if (status === "failed") {
        // 1. Get teacher_id for this student
        const [student] = await db
          .select({ teacher_id: students.teacher_id })
          .from(students)
          .where(eq(students.id, studentId))
          .limit(1);

        if (!student) return c.json({ error: "Student not found" }, 500);

        // 2. Create difficulty report immediately
        const [report] = await db
          .insert(difficultyReports)
          .values({
            student_id: studentId,
            teacher_id: student.teacher_id,
            source_type: "homework",
            source_id: itemId,
            topic_tags: [],
            description: `Failed: ${updated.title}`,
          })
          .returning();

        difficultyReport = report;

        // 3. Tag difficulty with AI (async — don't block response)
        if (report) {
          tagDifficulty(report.id, updated.title, updated.description ?? "")
            .then(async (tags) => {
              await db
                .update(difficultyReports)
                .set({ topic_tags: tags })
                .where(eq(difficultyReports.id, report.id));

              // Update AI profile weak topics
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
        difficulty_report: difficultyReport
          ? { id: difficultyReport.id }
          : null,
      });
    }
  );
