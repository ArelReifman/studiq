import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { profiles } from "../db/schema.js";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    userRole: "teacher" | "student";
    userStatus: "pending" | "approved" | "rejected";
  }
}

/**
 * Routes that an authenticated user is allowed to hit even when their
 * profile is in 'pending' state. Keeps the surface area small: the user
 * can ONLY check their own status and log out — nothing else.
 */
const PENDING_ALLOWED_PATHS = new Set<string>([
  "/auth/me",
  "/auth/logout",
]);

export async function authMiddleware(c: Context, next: Next) {
  // Try Bearer header first, then fall back to HttpOnly cookie
  const authHeader = c.req.header("Authorization");
  let token: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else {
    token = getCookie(c, "studiq-token");
  }

  if (!token) {
    return c.json({ error: "Missing or invalid authorization" }, 401);
  }

  const supabase = createClient(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_ANON_KEY"]!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    console.warn(`[AUTH] Invalid/expired token on ${c.req.method} ${c.req.path}`);
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  // Role is stored in user metadata set at registration
  const role = user.user_metadata?.["role"] as "teacher" | "student" | undefined;
  if (!role) {
    return c.json({ error: "User role not found" }, 403);
  }

  // Status gate — protects the entire API surface from unapproved accounts.
  // We always read the profile so a freshly-approved user picks up access
  // immediately on their next request, without re-issuing tokens.
  const [profile] = await db
    .select({ status: profiles.status })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  // No profile row means the registration trip was incomplete — refuse safely.
  if (!profile) {
    return c.json({ error: "Profile not found" }, 403);
  }

  if (profile.status === "rejected") {
    return c.json({ error: "Account access denied", status: "rejected" }, 403);
  }

  if (profile.status === "pending" && !PENDING_ALLOWED_PATHS.has(c.req.path)) {
    return c.json({ error: "Account pending approval", status: "pending" }, 403);
  }

  c.set("userId", user.id);
  c.set("userRole", role);
  c.set("userStatus", profile.status);

  await next();
}

export function requireRole(role: "teacher" | "student") {
  return async (c: Context, next: Next) => {
    if (c.get("userRole") !== role) {
      return c.json({ error: "Forbidden: insufficient role" }, 403);
    }
    await next();
  };
}
