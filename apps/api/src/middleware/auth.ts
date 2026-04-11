import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { createClient } from "@supabase/supabase-js";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    userRole: "teacher" | "student";
  }
}

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
