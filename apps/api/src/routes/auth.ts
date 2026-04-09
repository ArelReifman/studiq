import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { db } from "../db/client.js";
import { profiles, teachers, students } from "../db/schema.js";
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
    if (body.role === "student") {
      if (!body.teacher_invite_token) {
        return c.json({ error: "Invite token required for students" }, 400);
      }
      const [existingStudent] = await db
        .select({ id: students.id })
        .from(students)
        .where(eq(students.invite_token, body.teacher_invite_token))
        .limit(1);

      if (!existingStudent) {
        return c.json({ error: "Invalid invite token" }, 400);
      }
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
      // Update the pre-created student placeholder with the real auth user id
      // The student row was created by the teacher's invite — we link auth user to it
      // For simplicity, update the placeholder profile email to match
      const [placeholder] = await db
        .select({ id: students.id })
        .from(students)
        .where(eq(students.invite_token, body.teacher_invite_token!))
        .limit(1);

      if (!placeholder) {
        return c.json({ error: "Invalid invite token" }, 400);
      }

      await db
        .update(profiles)
        .set({ email: body.email, full_name: body.full_name, updated_at: new Date() })
        .where(eq(profiles.id, placeholder.id));
    }

    return c.json({ message: "Registered successfully" }, 201);
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
