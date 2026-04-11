import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock database before importing app
vi.mock("./db/client.js", () => ({
  db: {},
}));

// Mock Supabase
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      admin: { createUser: vi.fn(), deleteUser: vi.fn() },
      signInWithPassword: vi.fn(),
      getUser: vi.fn(),
    },
  }),
}));

import { createApp } from "./app.js";

describe("App security", () => {
  const app = createApp();

  describe("Health endpoint", () => {
    it("returns status ok with version and timestamp", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.version).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });
  });

  describe("404 handler", () => {
    it("returns JSON error for unknown routes", async () => {
      const res = await app.request("/nonexistent-route");
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error).toBe("Not found");
    });
  });

  describe("CSRF protection", () => {
    it("blocks POST without X-Requested-With header", async () => {
      const res = await app.request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "a@b.com", password: "12345678" }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Forbidden");
    });

    it("allows POST with X-Requested-With header", async () => {
      const res = await app.request("/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ email: "a@b.com", password: "12345678" }),
      });
      // Should pass CSRF check — will fail at Supabase auth, not at 403
      expect(res.status).not.toBe(403);
    });

    it("allows GET without X-Requested-With header", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
    });
  });

  describe("Security headers", () => {
    it("includes security headers in response", async () => {
      const res = await app.request("/health");

      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    });
  });
});
