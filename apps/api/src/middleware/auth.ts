import type { Context, Next } from "hono";
import { createClient } from "@supabase/supabase-js";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    userRole: "teacher" | "student";
  }
}

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);

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
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  // Role is stored in user metadata set at registration
  const role = user.user_metadata?.["role"] as "teacher" | "student" | undefined;
  if (!role) {
    return c.json({ error: "User role not found" }, 403);
  }

  c.set("userId", user.id);
  c.set("userRole", role);

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
