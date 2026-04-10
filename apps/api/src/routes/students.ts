import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { db } from "../db/client.js";
import {
  students,
  studentInvites,
  profiles,
  studentAiProfiles,
  studentReports,
  lessonSessions,
  homeworkItems,
  todoItems,
} from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const inviteSchema = z.object({
  full_name: z.string().min(1),
  grade_level: z.string().optional(),
  notes: z.string().optional(),
});

export const studentRoutes = new Hono()
  .use(authMiddleware)
  .use(requireRole("teacher"))

  // GET /students — teacher's roster
  .get("/", async (c) => {
    const teacherId = c.get("userId");

    const roster = await db
      .select({
        id: students.id,
        teacher_id: students.teacher_id,
        onboarded_at: students.onboarded_at,
        grade_level: students.grade_level,
        notes: students.notes,
        full_name: profiles.full_name,
        email: profiles.email,
        avatar_url: profiles.avatar_url,
        ai_summary: studentAiProfiles.ai_summary,
        avg_completion_rate: studentAiProfiles.avg_completion_rate,
        weak_topics: studentAiProfiles.weak_topics,
      })
      .from(students)
      .innerJoin(profiles, eq(profiles.id, students.id))
      .leftJoin(
        studentAiProfiles,
        eq(studentAiProfiles.student_id, students.id)
      )
      .where(eq(students.teacher_id, teacherId));

    return c.json(roster);
  })

  // GET /students/:id — student detail
  .get("/:id", async (c) => {
    const teacherId = c.get("userId");
    const studentId = c.req.param("id");

    const [student] = await db
      .select({
        id: students.id,
        teacher_id: students.teacher_id,
        onboarded_at: students.onboarded_at,
        grade_level: students.grade_level,
        notes: students.notes,
        full_name: profiles.full_name,
        email: profiles.email,
      })
      .from(students)
      .innerJoin(profiles, eq(profiles.id, students.id))
      .where(
        and(eq(students.id, studentId), eq(students.teacher_id, teacherId))
      )
      .limit(1);

    if (!student) return c.json({ error: "Student not found" }, 404);

    return c.json(student);
  })

  // GET /students/:id/profile — AI profile + stats
  .get("/:id/profile", async (c) => {
    const teacherId = c.get("userId");
    const studentId = c.req.param("id");

    // Verify ownership
    const [owner] = await db
      .select({ id: students.id })
      .from(students)
      .where(
        and(eq(students.id, studentId), eq(students.teacher_id, teacherId))
      )
      .limit(1);

    if (!owner) return c.json({ error: "Student not found" }, 404);

    const [aiProfile] = await db
      .select()
      .from(studentAiProfiles)
      .where(eq(studentAiProfiles.student_id, studentId))
      .limit(1);

    return c.json(aiProfile ?? null);
  })

  // GET /students/:id/report — latest report
  .get("/:id/report", async (c) => {
    const teacherId = c.get("userId");
    const studentId = c.req.param("id");

    const [owner] = await db
      .select({ id: students.id })
      .from(students)
      .where(
        and(eq(students.id, studentId), eq(students.teacher_id, teacherId))
      )
      .limit(1);

    if (!owner) return c.json({ error: "Student not found" }, 404);

    const [report] = await db
      .select()
      .from(studentReports)
      .where(eq(studentReports.student_id, studentId))
      .orderBy(studentReports.generated_at)
      .limit(1);

    return c.json(report ?? null);
  })

  // PATCH /students/:id/notes
  .patch(
    "/:id/notes",
    zValidator("json", z.object({ notes: z.string() })),
    async (c) => {
      const teacherId = c.get("userId");
      const studentId = c.req.param("id");
      const { notes } = c.req.valid("json");

      const [updated] = await db
        .update(students)
        .set({ notes })
        .where(
          and(eq(students.id, studentId), eq(students.teacher_id, teacherId))
        )
        .returning();

      if (!updated) return c.json({ error: "Student not found" }, 404);
      return c.json(updated);
    }
  )

  // DELETE /students/:id — remove a student entirely
  .delete("/:id", async (c) => {
    const teacherId = c.get("userId");
    const studentId = c.req.param("id");

    // Verify ownership
    const [student] = await db
      .select({ id: students.id })
      .from(students)
      .where(
        and(eq(students.id, studentId), eq(students.teacher_id, teacherId))
      )
      .limit(1);

    if (!student) return c.json({ error: "Student not found" }, 404);

    // Delete student row (cascades to profile via FK, which cascades lessons, homework, etc.)
    await db.delete(students).where(eq(students.id, studentId));
    await db.delete(profiles).where(eq(profiles.id, studentId));

    // Delete the Supabase auth user too
    try {
      const supabase = createClient(
        process.env["SUPABASE_URL"]!,
        process.env["SUPABASE_SERVICE_ROLE_KEY"]!
      );
      await supabase.auth.admin.deleteUser(studentId);
    } catch {
      // Auth user may already be gone — that's fine
    }

    return c.json({ message: "Student deleted" });
  })

  // POST /students/invite — create a pending invite token (no auth user yet)
  // The student will use the token to register with their own email+password.
  .post("/invite", zValidator("json", inviteSchema), async (c) => {
    const teacherId = c.get("userId");
    const body = c.req.valid("json");

    const token = crypto.randomUUID();

    const [invite] = await db
      .insert(studentInvites)
      .values({
        token,
        teacher_id: teacherId,
        full_name: body.full_name,
        grade_level: body.grade_level,
        notes: body.notes,
      })
      .returning();

    const inviteUrl = `${process.env["NEXT_PUBLIC_APP_URL"]}/register?token=${token}`;

    return c.json({
      invite_token: invite!.token,
      invite_url: inviteUrl,
      full_name: invite!.full_name,
    });
  });
