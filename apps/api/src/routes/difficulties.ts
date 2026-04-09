import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { difficultyReports, students, profiles } from "../db/schema.js";
import { authMiddleware } from "../middleware/auth.js";

export const difficultyRoutes = new Hono()
  .use(authMiddleware)

  // GET /difficulties — teacher: all for their students; student: their own
  .get("/", async (c) => {
    const userId = c.get("userId");
    const role = c.get("userRole");
    const studentIdParam = c.req.query("student_id");

    let rows;
    if (role === "student") {
      rows = await db
        .select()
        .from(difficultyReports)
        .where(eq(difficultyReports.student_id, userId))
        .orderBy(desc(difficultyReports.created_at));
    } else {
      const whereClause =
        studentIdParam
          ? and(
              eq(difficultyReports.teacher_id, userId),
              eq(difficultyReports.student_id, studentIdParam)
            )
          : eq(difficultyReports.teacher_id, userId);

      rows = await db
        .select({
          id: difficultyReports.id,
          student_id: difficultyReports.student_id,
          student_name: profiles.full_name,
          source_type: difficultyReports.source_type,
          source_id: difficultyReports.source_id,
          topic_tags: difficultyReports.topic_tags,
          description: difficultyReports.description,
          reviewed: difficultyReports.reviewed,
          teacher_note: difficultyReports.teacher_note,
          created_at: difficultyReports.created_at,
        })
        .from(difficultyReports)
        .innerJoin(profiles, eq(profiles.id, difficultyReports.student_id))
        .where(whereClause)
        .orderBy(desc(difficultyReports.created_at));
    }

    return c.json(rows);
  })

  // GET /difficulties/:id
  .get("/:id", async (c) => {
    const userId = c.get("userId");
    const role = c.get("userRole");
    const reportId = c.req.param("id");

    const [report] = await db
      .select()
      .from(difficultyReports)
      .where(eq(difficultyReports.id, reportId))
      .limit(1);

    if (!report) return c.json({ error: "Report not found" }, 404);

    if (role === "student" && report.student_id !== userId) {
      return c.json({ error: "Forbidden" }, 403);
    }
    if (role === "teacher" && report.teacher_id !== userId) {
      return c.json({ error: "Forbidden" }, 403);
    }

    return c.json(report);
  })

  // PATCH /difficulties/:id — teacher adds note, marks reviewed
  .patch(
    "/:id",
    zValidator(
      "json",
      z.object({
        teacher_note: z.string().optional(),
        reviewed: z.boolean().optional(),
      })
    ),
    async (c) => {
      const userId = c.get("userId");
      const role = c.get("userRole");
      const reportId = c.req.param("id");
      const body = c.req.valid("json");

      if (role !== "teacher") return c.json({ error: "Forbidden" }, 403);

      const [updated] = await db
        .update(difficultyReports)
        .set(body)
        .where(
          and(
            eq(difficultyReports.id, reportId),
            eq(difficultyReports.teacher_id, userId)
          )
        )
        .returning();

      if (!updated) return c.json({ error: "Report not found" }, 404);
      return c.json(updated);
    }
  );
