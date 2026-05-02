/**
 * Teacher approvals — review pending student registrations and approve/reject.
 *
 * SECURITY MODEL
 * - All endpoints require an authenticated teacher (role gate).
 * - Approving a student creates the `students` row pointing at the approving
 *   teacher, plus an empty `student_ai_profiles` row. This is done atomically
 *   inside a Drizzle transaction so a partial state can never be observed.
 * - Race condition: if two teachers approve the same student simultaneously,
 *   the second transaction sees status != 'pending' and aborts with 409.
 * - Rejected accounts are kept (not deleted) so the same email cannot
 *   re-register cheaply, and so an audit trail exists.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { profiles, students, studentAiProfiles } from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { userIdParamSchema } from "../lib/validators.js";
import { audit } from "../lib/audit.js";

const approveSchema = z.object({
  grade_level: z.string().max(20).optional(),
  notes: z.string().max(1000).optional(),
});

export const approvalsRoutes = new Hono()
  .use("*", authMiddleware)
  .use("*", requireRole("teacher"))

  // GET /approvals — list pending students
  .get("/", async (c) => {
    const pending = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        full_name: profiles.full_name,
        signup_note: profiles.signup_note,
        created_at: profiles.created_at,
      })
      .from(profiles)
      .where(eq(profiles.status, "pending"))
      .orderBy(desc(profiles.created_at));

    return c.json({ pending });
  })

  // GET /approvals/count — quick badge count for the dashboard nav
  .get("/count", async (c) => {
    const rows = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.status, "pending"));
    return c.json({ count: rows.length });
  })

  // POST /approvals/:userId/approve — assign student to this teacher
  .post(
    "/:userId/approve",
    zValidator("param", userIdParamSchema),
    zValidator("json", approveSchema),
    async (c) => {
      const userId = c.req.valid("param").userId;
      const teacherId = c.get("userId");
      const body = c.req.valid("json");
      const now = new Date();

      // Pre-flight: confirm the target is a pending student before opening
      // a transaction. Cheaper than rolling back, and avoids a misleading 500.
      const [target] = await db
        .select({ status: profiles.status, role: profiles.role })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);

      if (!target) return c.json({ error: "User not found" }, 404);
      if (target.role !== "student") return c.json({ error: "User is not a student" }, 400);
      if (target.status === "approved") return c.json({ error: "Already approved" }, 409);
      if (target.status === "rejected") return c.json({ error: "Account was rejected" }, 409);

      try {
        await db.transaction(async (tx) => {
          // Atomic guard: only flip pending → approved. The status='pending'
          // predicate prevents two teachers from double-approving.
          const updated = await tx
            .update(profiles)
            .set({
              status: "approved",
              approved_at: now,
              approved_by: teacherId,
              updated_at: now,
            })
            .where(and(eq(profiles.id, userId), eq(profiles.status, "pending")))
            .returning({ id: profiles.id });

          if (updated.length === 0) {
            // Lost the race — another teacher approved/rejected in the meantime.
            throw new Error("RACE_LOST");
          }

          // Idempotent inserts so a retry after partial failure stays safe.
          const existingStudent = await tx
            .select({ id: students.id })
            .from(students)
            .where(eq(students.id, userId))
            .limit(1);

          if (existingStudent.length === 0) {
            await tx.insert(students).values({
              id: userId,
              teacher_id: teacherId,
              grade_level: body.grade_level ?? null,
              notes: body.notes ?? null,
            });
            await tx.insert(studentAiProfiles).values({ student_id: userId });
          }
        });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === "RACE_LOST") return c.json({ error: "Status changed concurrently" }, 409);
        console.error("[APPROVALS] approve failed:", err);
        return c.json({ error: "Failed to approve" }, 500);
      }

      await audit(c, {
        event: "approvals.student_approved",
        target_id: userId,
        detail: { grade_level: body.grade_level, has_notes: !!body.notes },
      });

      return c.json({ message: "Approved", userId });
    }
  )

  // POST /approvals/:userId/reject — mark account as rejected
  .post("/:userId/reject", zValidator("param", userIdParamSchema), async (c) => {
    const userId = c.req.valid("param").userId;
    const now = new Date();

    const updated = await db
      .update(profiles)
      .set({ status: "rejected", rejected_at: now, updated_at: now })
      .where(eq(profiles.id, userId))
      .returning({ id: profiles.id });

    if (updated.length === 0) {
      return c.json({ error: "User not found" }, 404);
    }

    await audit(c, {
      event: "approvals.student_rejected",
      target_id: userId,
    });

    return c.json({ message: "Rejected", userId });
  });
