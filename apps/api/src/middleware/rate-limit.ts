import type { Context, Next } from "hono";

// Simple in-memory rate limiter (replace with Redis for multi-instance)
const requests = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests: number, windowMs: number) {
  return async (c: Context, next: Next) => {
    const key = c.get("userId") ?? c.req.header("cf-connecting-ip") ?? "anon";
    const now = Date.now();
    const entry = requests.get(key);

    if (!entry || entry.resetAt < now) {
      requests.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      entry.count++;
      if (entry.count > maxRequests) {
        return c.json({ error: "Too many requests" }, 429);
      }
    }

    await next();
  };
}
