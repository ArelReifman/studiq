import type { Context, Next } from "hono";

// Simple in-memory rate limiter (replace with Redis for multi-instance)
const buckets = new Map<string, { count: number; resetAt: number }>();

// Clean up expired entries every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt < now) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

function getClientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    c.req.header("cf-connecting-ip") ??
    "unknown"
  );
}

export function rateLimit(maxRequests: number, windowMs: number) {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId") as string | undefined;
    const key = userId ?? getClientIp(c);
    const now = Date.now();
    const entry = buckets.get(key);

    if (!entry || entry.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      entry.count++;
      if (entry.count > maxRequests) {
        c.header("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
        return c.json({ error: "Too many requests" }, 429);
      }
    }

    await next();
  };
}
