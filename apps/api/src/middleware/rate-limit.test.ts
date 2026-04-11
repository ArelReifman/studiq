import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { rateLimit } from "./rate-limit.js";

function createTestApp(maxRequests: number, windowMs: number) {
  const app = new Hono();
  app.use("*", rateLimit(maxRequests, windowMs));
  app.get("/test", (c) => c.json({ ok: true }));
  app.post("/test", (c) => c.json({ ok: true }));
  return app;
}

describe("rateLimit middleware", () => {
  it("allows requests under the limit", async () => {
    const app = createTestApp(5, 60_000);

    const res = await app.request("/test", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("blocks requests over the limit with 429", async () => {
    const app = createTestApp(3, 60_000);

    // Send 3 allowed requests
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/test", {
        headers: { "x-forwarded-for": "10.0.0.1" },
      });
      expect(res.status).toBe(200);
    }

    // 4th request should be blocked
    const blocked = await app.request("/test", {
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error).toBe("Too many requests");
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("tracks different IPs separately", async () => {
    const app = createTestApp(2, 60_000);

    // Max out IP A
    for (let i = 0; i < 2; i++) {
      await app.request("/test", {
        headers: { "x-forwarded-for": "10.0.0.1" },
      });
    }

    // IP B should still work
    const res = await app.request("/test", {
      headers: { "x-forwarded-for": "10.0.0.2" },
    });
    expect(res.status).toBe(200);
  });

  it("uses first IP from x-forwarded-for chain", async () => {
    const app = createTestApp(2, 60_000);

    // Both requests have same client IP (first in chain)
    for (let i = 0; i < 2; i++) {
      await app.request("/test", {
        headers: { "x-forwarded-for": "10.0.0.5, 10.0.0.6" },
      });
    }

    const blocked = await app.request("/test", {
      headers: { "x-forwarded-for": "10.0.0.5, 10.0.0.7" },
    });
    expect(blocked.status).toBe(429);
  });
});
