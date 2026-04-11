import { Hono } from "hono";
import { cors } from "hono/cors";
import { prettyJSON } from "hono/pretty-json";
import { handle } from "hono/vercel";

import { authRoutes } from "../src/routes/auth.js";
import { onboardingRoutes } from "../src/routes/onboarding.js";
import { lessonRoutes } from "../src/routes/lessons.js";
import { homeworkRoutes } from "../src/routes/homework.js";
import { todoRoutes } from "../src/routes/todos.js";
import { difficultyRoutes } from "../src/routes/difficulties.js";
import { studentRoutes } from "../src/routes/students.js";
import { aiFeedbackRoutes } from "../src/routes/ai-feedback.js";
import { reportRoutes } from "../src/routes/reports.js";

const app = new Hono().basePath("/api");

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

export default handle(app);
