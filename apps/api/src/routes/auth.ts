import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { db } from "../db/client.js";
import {
  profiles,
  teachers,
  students,
  studentInvites,
  studentAiProfiles,
} from "../db/schema.js";
import { authMiddleware } from "../middleware/auth.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1),
  role: z.enum(["teacher", "student"]),
  teacher_invite_token: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

function getAdminClient() {
  return createClient(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_SERVICE_ROLE_KEY"]!
  );
}

export const authRoutes = new Hono()
  .post("/register", zValidator("json", registerSchema), async (c) => {
    const body = c.req.valid("json");
    const supabase = getAdminClient();

    // If student, validate invite token
    let invite: typeof studentInvites.$inferSelect | undefined;
    if (body.role === "student") {
      if (!body.teacher_invite_token) {
        return c.json({ error: "Invite token required for students" }, 400);
      }
      const [found] = await db
        .select()
        .from(studentInvites)
        .where(
          and(
            eq(studentInvites.token, body.teacher_invite_token),
            isNull(studentInvites.used_at)
          )
        )
        .limit(1);

      if (!found) {
        return c.json({ error: "Invalid or already-used invite token" }, 400);
      }
      invite = found;
    }

    // Create Supabase auth user
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email: body.email,
        password: body.password,
        user_metadata: { role: body.role, full_name: body.full_name },
        email_confirm: true,
      });

    if (authError || !authData.user) {
      return c.json({ error: authError?.message ?? "Registration failed" }, 400);
    }

    const userId = authData.user.id;

    if (body.role === "teacher") {
      // Insert profile + teacher row
      await db.transaction(async (tx) => {
        await tx.insert(profiles).values({
          id: userId,
          role: body.role,
          full_name: body.full_name,
          email: body.email,
        });
        await tx.insert(teachers).values({ id: userId });
      });
    } else {
      // Student path: invite is guaranteed set here
      const inv = invite!;
      try {
        await db.transaction(async (tx) => {
          await tx.insert(profiles).values({
            id: userId,
            role: "student",
            full_name: body.full_name || inv.full_name,
            email: body.email,
          });
          await tx.insert(students).values({
            id: userId,
            teacher_id: inv.teacher_id,
            grade_level: inv.grade_level,
            notes: inv.notes,
          });
          await tx.insert(studentAiProfiles).values({
            student_id: userId,
          });
          await tx
            .update(studentInvites)
            .set({ used_at: new Date() })
            .where(eq(studentInvites.token, inv.token));
        });
      } catch (err) {
        // Roll back the auth user if DB insert fails
        await supabase.auth.admin.deleteUser(userId);
        return c.json(
          { error: (err as Error).message ?? "Failed to register student" },
          500
        );
      }
    }

    return c.json({ message: "Registered successfully" }, 201);
  })

  // Public lookup of invite details by token (for register page prefill)
  .get("/invite/:token", async (c) => {
    const token = c.req.param("token");
    const [invite] = await db
      .select({
        token: studentInvites.token,
        full_name: studentInvites.full_name,
        grade_level: studentInvites.grade_level,
        used_at: studentInvites.used_at,
      })
      .from(studentInvites)
      .where(eq(studentInvites.token, token))
      .limit(1);

    if (!invite) return c.json({ error: "Invite not found" }, 404);
    if (invite.used_at)
      return c.json({ error: "Invite already used" }, 410);

    return c.json({
      token: invite.token,
      full_name: invite.full_name,
      grade_level: invite.grade_level,
    });
  })

  .post("/login", zValidator("json", loginSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    const supabase = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_ANON_KEY"]!
    );

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    return c.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        role: data.user.user_metadata?.["role"],
        full_name: data.user.user_metadata?.["full_name"],
      },
    });
  })

  .get("/me", authMiddleware, async (c) => {
    const userId = c.get("userId");
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    return c.json({ userId, role: c.get("userRole"), profile });
  });
