import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { studentReports, students } from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { generateReport } from "../services/ai/generate-report.js";
import { studentIdQuerySchema, uuidParamSchema } from "../lib/validators.js";

export const reportRoutes = new Hono()
  .use(authMiddleware)

  .get("/", zValidator("query", studentIdQuerySchema), async (c) => {
    const userId = c.get("userId");
    const role = c.get("userRole");
    const studentId = c.req.valid("query").student_id;

    let rows;
    if (role === "student") {
      const own = await db
        .select()
        .from(studentReports)
        .where(eq(studentReports.student_id, userId))
        .orderBy(desc(studentReports.generated_at));

      // Defense in depth: ai_recommendations/summary are grounded in the
      // teacher's private notes and reflections the student wrote for the
      // teacher, not for the student to read back. Strip them server-side
      // so they never reach the student's browser, even unrendered — the
      // student page only ever uses student_recommendations.
      rows = own.map((r) => ({ ...r, ai_recommendations: null, summary: null }));
    } else {
      const whereClause = studentId
        ? and(
            eq(studentReports.teacher_id, userId),
            eq(studentReports.student_id, studentId)
          )
        : eq(studentReports.teacher_id, userId);

      rows = await db
        .select()
        .from(studentReports)
        .where(whereClause)
        .orderBy(desc(studentReports.generated_at));
    }

    return c.json(rows);
  })

  .post(
    "/generate",
    requireRole("teacher"),
    zValidator("json", z.object({ student_id: z.string().uuid() })),
    async (c) => {
      const teacherId = c.get("userId");
      const { student_id } = c.req.valid("json");

      const [student] = await db
        .select({ id: students.id })
        .from(students)
        .where(
          and(eq(students.id, student_id), eq(students.teacher_id, teacherId))
        )
        .limit(1);

      if (!student) return c.json({ error: "Student not found" }, 404);

      try {
        const report = await generateReport(student_id, teacherId);
        return c.json(report, 201);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Report generation failed";
        console.error("[generateReport]", err);
        return c.json({ error: msg }, 500);
      }
    }
  )

  .delete(
    "/:id",
    requireRole("teacher"),
    zValidator("param", uuidParamSchema),
    async (c) => {
      const teacherId = c.get("userId");
      const { id } = c.req.valid("param");

      const [deleted] = await db
        .delete(studentReports)
        .where(and(eq(studentReports.id, id), eq(studentReports.teacher_id, teacherId)))
        .returning({ id: studentReports.id });

      if (!deleted) return c.json({ error: "Report not found" }, 404);
      return c.json({ id: deleted.id });
    }
  );
