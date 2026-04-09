import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  students,
  profiles,
  studentAiProfiles,
  studentReports,
  lessonSessions,
  homeworkItems,
  todoItems,
} from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const inviteSchema = z.object({
  email: z.string().email(),
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

  // POST /students/invite — create placeholder student + invite token
  .post("/invite", zValidator("json", inviteSchema), async (c) => {
    const teacherId = c.get("userId");
    const body = c.req.valid("json");

    const inviteToken = crypto.randomUUID();

    // Create a placeholder profile for the student (will be linked at registration)
    const [newProfile] = await db
      .insert(profiles)
      .values({
        id: crypto.randomUUID(),
        role: "student",
        full_name: body.full_name,
        email: body.email,
      })
      .returning();

    const [newStudent] = await db
      .insert(students)
      .values({
        id: newProfile!.id,
        teacher_id: teacherId,
        grade_level: body.grade_level,
        notes: body.notes,
        invite_token: inviteToken,
      })
      .returning();

    // Create initial AI profile
    await db.insert(studentAiProfiles).values({
      student_id: newProfile!.id,
    });

    const inviteUrl = `${process.env["NEXT_PUBLIC_APP_URL"]}/register?token=${inviteToken}`;

    return c.json({
      student_id: newStudent!.id,
      invite_token: inviteToken,
      invite_url: inviteUrl,
    });
  });
