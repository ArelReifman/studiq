/**
 * Profile self-service — let an authenticated user update their own
 * full_name, email, or password.
 *
 * Security model
 *  - Auth required (any role).
 *  - Email or password changes require the user to re-enter their CURRENT
 *    password. We validate it via Supabase signInWithPassword. This guards
 *    against session hijacking turning into a permanent account takeover.
 *  - full_name alone does not require re-auth (low-risk).
 *  - All Supabase Auth mutations go through the admin client so we don't
 *    bounce the user's session.
 *  - Profile + auth are updated separately. If the auth update succeeds but
 *    the DB update fails, the API returns 500 — no rollback for the auth
 *    side because Supabase doesn't expose transactions across systems.
 *    In practice this means the user might end up with a new email at the
 *    auth layer but the old one in `profiles`. The next request will see
 *    the auth email and they can retry; we accept this rare drift.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { db } from "../db/client.js";
import { profiles } from "../db/schema.js";
import { authMiddleware } from "../middleware/auth.js";

const updateSchema = z
  .object({
    full_name: z.string().min(1).max(120).optional(),
    email: z
      .string()
      .email()
      .transform((s) => s.trim().toLowerCase())
      .optional(),
    new_password: z.string().min(8).max(128).optional(),
    current_password: z.string().optional(),
  })
  .refine(
    (v) => v.full_name || v.email || v.new_password,
    { message: "At least one of full_name, email, new_password is required" }
  );

function getAdminClient() {
  return createClient(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_SERVICE_ROLE_KEY"]!
  );
}

export const profileRoutes = new Hono()
  .use("*", authMiddleware)

  // GET /profile — current user's editable fields
  .get("/", async (c) => {
    const userId = c.get("userId");
    const [profile] = await db
      .select({
        id: profiles.id,
        full_name: profiles.full_name,
        email: profiles.email,
        role: profiles.role,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!profile) return c.json({ error: "Profile not found" }, 404);
    return c.json(profile);
  })

  // PATCH /profile — update full_name / email / password
  .patch("/", zValidator("json", updateSchema), async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const supabase = getAdminClient();

    const wantsSensitive = !!(body.email || body.new_password);

    // Require current password for sensitive changes
    if (wantsSensitive) {
      if (!body.current_password) {
        return c.json(
          { error: "Current password required to change email or password" },
          400
        );
      }

      // Look up the user's email to verify the current password.
      // We use a fresh public client so signInWithPassword doesn't disturb
      // the admin client's auth state.
      const { data: authUser, error: getErr } =
        await supabase.auth.admin.getUserById(userId);
      if (getErr || !authUser.user?.email) {
        console.warn(`[PROFILE] getUserById failed for ${userId}`);
        return c.json({ error: "Verification failed" }, 500);
      }

      const verifyClient = createClient(
        process.env["SUPABASE_URL"]!,
        process.env["SUPABASE_ANON_KEY"]!
      );
      const { error: signInErr } = await verifyClient.auth.signInWithPassword({
        email: authUser.user.email,
        password: body.current_password,
      });
      if (signInErr) {
        return c.json({ error: "Current password is incorrect" }, 401);
      }
      // Sign out the verify client so we don't leak a parallel session.
      await verifyClient.auth.signOut();
    }

    // Fetch current user so we can MERGE metadata (Supabase replaces the whole
    // user_metadata object on update — losing role would break authMiddleware).
    const { data: currentUser, error: fetchErr } =
      await supabase.auth.admin.getUserById(userId);
    if (fetchErr || !currentUser.user) {
      console.warn(`[PROFILE] getUserById failed for ${userId}`);
      return c.json({ error: "Failed to load user" }, 500);
    }

    // Build a single auth-side patch (one round-trip = atomic on Supabase).
    const authPatch: {
      email?: string;
      password?: string;
      user_metadata?: Record<string, unknown>;
    } = {};
    if (body.email) authPatch.email = body.email;
    if (body.new_password) authPatch.password = body.new_password;
    if (body.full_name) {
      authPatch.user_metadata = {
        ...(currentUser.user.user_metadata ?? {}),
        full_name: body.full_name,
      };
    }

    if (Object.keys(authPatch).length > 0) {
      const { error: authErr } = await supabase.auth.admin.updateUserById(
        userId,
        authPatch
      );
      if (authErr) {
        console.warn(`[PROFILE] auth update failed for ${userId}: ${authErr.message}`);
        const msg = authErr.message.toLowerCase();
        if (msg.includes("already") || msg.includes("registered")) {
          return c.json({ error: "Email already in use" }, 409);
        }
        return c.json({ error: authErr.message }, 400);
      }
    }

    // Mirror to profiles table. Password never lives in our DB.
    const dbPatch: { full_name?: string; email?: string; updated_at: Date } = {
      updated_at: new Date(),
    };
    if (body.full_name) dbPatch.full_name = body.full_name;
    if (body.email) dbPatch.email = body.email;

    if (Object.keys(dbPatch).length > 1) {
      await db.update(profiles).set(dbPatch).where(eq(profiles.id, userId));
    }

    return c.json({ message: "Profile updated" });
  });
