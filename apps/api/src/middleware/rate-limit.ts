import type { Context, Next } from "hono";
import { Redis } from "@upstash/redis";
import { audit } from "../lib/audit.js";

// ─── Backend selection ────────────────────────────────────────────────────────
// Production (multi-instance Vercel): use Upstash Redis for a counter shared
// across all serverless instances. Local dev / when not configured: fall back
// to a per-process Map. The fallback is identical to the original impl, so
// removing the env vars degrades to single-instance behavior — no crash.

const redisUrl = process.env["UPSTASH_REDIS_REST_URL"];
const redisToken = process.env["UPSTASH_REDIS_REST_TOKEN"];
const redis =
  redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

// ─── In-memory fallback ───────────────────────────────────────────────────────
const buckets = new Map<string, { count: number; resetAt: number }>();
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

interface CheckResult {
  allowed: boolean;
  count: number;
  retryAfterSec: number;
}

async function checkRedis(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<CheckResult> {
  // INCR is atomic. On the first hit in a window we set TTL; subsequent hits
  // just increment. Pipelining keeps this to one round-trip.
  const windowSec = Math.ceil(windowMs / 1000);
  const pipeline = redis!.pipeline();
  pipeline.incr(key);
  pipeline.ttl(key);
  const [count, ttl] = (await pipeline.exec()) as [number, number];

  // -1 = key exists with no TTL (shouldn't happen, but defensive); -2 = missing
  if (ttl < 0) {
    await redis!.expire(key, windowSec);
  }

  const retryAfterSec = ttl > 0 ? ttl : windowSec;
  return {
    allowed: count <= maxRequests,
    count,
    retryAfterSec,
  };
}

function checkMemory(
  key: string,
  maxRequests: number,
  windowMs: number
): CheckResult {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || entry.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, count: 1, retryAfterSec: Math.ceil(windowMs / 1000) };
  }

  entry.count++;
  return {
    allowed: entry.count <= maxRequests,
    count: entry.count,
    retryAfterSec: Math.ceil((entry.resetAt - now) / 1000),
  };
}

export function rateLimit(maxRequests: number, windowMs: number) {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId") as string | undefined;
    const subject = userId ?? getClientIp(c);
    // Bucket key includes the limit so different middlewares (e.g. /auth at
    // 20/min vs global at 200/min) don't share a counter.
    const key = `ratelimit:${maxRequests}:${windowMs}:${subject}`;

    let result: CheckResult;
    try {
      result = redis
        ? await checkRedis(key, maxRequests, windowMs)
        : checkMemory(key, maxRequests, windowMs);
    } catch (err) {
      // Redis flake must NEVER lock users out. Fail open and log.
      console.error("[RATE-LIMIT] Redis check failed, allowing request:", err);
      await next();
      return;
    }

    if (!result.allowed) {
      console.warn(
        `[RATE-LIMIT] Blocked ${subject} on ${c.req.method} ${c.req.path} (${result.count}/${maxRequests})`
      );
      // Audit only on the first block in the window to avoid log spam.
      if (result.count === maxRequests + 1) {
        await audit(c, {
          event: "rate_limit.blocked",
          detail: { limit: maxRequests, window_ms: windowMs, count: result.count },
        });
      }
      c.header("Retry-After", String(result.retryAfterSec));
      return c.json({ error: "Too many requests" }, 429);
    }

    await next();
  };
}
