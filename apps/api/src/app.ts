import { Hono } from "hono";
import { cors } from "hono/cors";
import { prettyJSON } from "hono/pretty-json";

import { authRoutes } from "./routes/auth.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { lessonRoutes } from "./routes/lessons.js";
import { homeworkRoutes } from "./routes/homework.js";
import { todoRoutes } from "./routes/todos.js";
import { difficultyRoutes } from "./routes/difficulties.js";
import { studentRoutes } from "./routes/students.js";
import { aiFeedbackRoutes } from "./routes/ai-feedback.js";
import { reportRoutes } from "./routes/reports.js";

export function createApp(basePath = "") {
  const app = new Hono().basePath(basePath);

  app.use(
    "*",
    cors({
      origin: process.env["NEXT_PUBLIC_APP_URL"] ?? "*",
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    })
  );
  app.use("*", prettyJSON());

  app.route("/auth", authRoutes);
  app.route("/onboarding", onboardingRoutes);
  app.route("/lessons", lessonRoutes);
  app.route("/homework", homeworkRoutes);
  app.route("/todos", todoRoutes);
  app.route("/difficulties", difficultyRoutes);
  app.route("/students", studentRoutes);
  app.route("/ai-feedback", aiFeedbackRoutes);
  app.route("/reports", reportRoutes);

  app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));
  app.notFound((c) => c.json({ error: "Not found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}
