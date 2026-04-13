import { Hono } from "hono";
import { cors } from "hono/cors";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";

import { authRoutes } from "./routes/auth.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { lessonRoutes } from "./routes/lessons.js";
import { homeworkRoutes } from "./routes/homework.js";
import { todoRoutes } from "./routes/todos.js";
import { difficultyRoutes } from "./routes/difficulties.js";
import { studentRoutes } from "./routes/students.js";
import { aiFeedbackRoutes } from "./routes/ai-feedback.js";
import { reportRoutes } from "./routes/reports.js";
import { availabilityRoutes } from "./routes/availability.js";
import { bookingRoutes } from "./routes/bookings.js";
import { uploadRoutes } from "./routes/upload.js";
import { rateLimit } from "./middleware/rate-limit.js";

export function createApp(basePath = "") {
  const app = new Hono().basePath(basePath);

  // --- Security headers ---
  app.use("*", secureHeaders());

  // --- CORS — allow app origin + localhost dev variants ---
  const allowedOrigins = [
    process.env["NEXT_PUBLIC_APP_URL"],
    "http://localhost:3000",
    "http://localhost:3002",
  ].filter(Boolean) as string[];

  app.use(
    "*",
    cors({
      origin: (origin) => allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
      allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    })
  );
  app.use("*", prettyJSON());

  // --- CSRF protection — require X-Requested-With on state-changing methods ---
  // Skip for same-origin Vercel serverless (no Origin header = server-to-server)
  app.use("*", async (c, next) => {
    if (["POST", "PATCH", "DELETE", "PUT"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      const isSameOrigin = !origin; // Vercel API route calls have no Origin
      if (!isSameOrigin && c.req.header("x-requested-with") !== "XMLHttpRequest") {
        return c.json({ error: "Forbidden" }, 403);
      }
    }
    await next();
  });

  // Rate limit auth routes: 20 requests per minute per IP
  app.use("/auth/*", rateLimit(20, 60 * 1000));
  app.route("/auth", authRoutes);
  app.route("/onboarding", onboardingRoutes);
  app.route("/lessons", lessonRoutes);
  app.route("/homework", homeworkRoutes);
  app.route("/todos", todoRoutes);
  app.route("/difficulties", difficultyRoutes);
  app.route("/students", studentRoutes);
  app.route("/ai-feedback", aiFeedbackRoutes);
  app.route("/reports", reportRoutes);
  app.route("/availability", availabilityRoutes);
  app.route("/bookings", bookingRoutes);
  app.route("/upload", uploadRoutes);

  app.get("/health", (c) => c.json({ status: "ok", version: "1.0.1", timestamp: new Date().toISOString() }));
  app.notFound((c) => c.json({ error: "Not found" }, 404));
  app.onError((err, c) => {
    console.error(`[ERROR] ${c.req.method} ${c.req.path}:`, err.message, err.stack);
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}
