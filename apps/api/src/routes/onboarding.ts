import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { students, studentTopics, studentAiProfiles } from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { generateLesson } from "../services/ai/generate-lesson.js";
import { resolveTopic } from "../services/ai/resolve-topic.js";

// Topics the teacher has pre-defined (could be DB-driven later)
const DEFAULT_TOPICS = [
  "Algebra",
  "Geometry",
  "Calculus",
  "Trigonometry",
  "Statistics",
  "Physics",
  "Chemistry",
  "Biology",
  "Grammar",
  "Writing",
  "Reading Comprehension",
  "Vocabulary",
  "History",
  "Geography",
  "Programming",
  "Data Structures",
  "Problem Solving",
];

export const onboardingRoutes = new Hono()
  .use(authMiddleware)

  .get("/topics", async (c) => {
    return c.json(DEFAULT_TOPICS);
  })

  .post(
    "/complete",
    requireRole("student"),
    zValidator(
      "json",
      z.object({
        topics: z.array(z.string()).min(1).max(10),
        grade_level: z.string().optional(),
      })
    ),
    async (c) => {
      const studentId = c.get("userId");
      const { topics, grade_level } = c.req.valid("json");

      const now = new Date();

      await db.transaction(async (tx) => {
        // Mark as onboarded
        await tx
          .update(students)
          .set({ onboarded_at: now, grade_level })
          .where(eq(students.id, studentId));

        // Insert chosen topics
        await tx.insert(studentTopics).values(
          topics.map((topic) => ({
            student_id: studentId,
            topic,
            source: "initial_choice" as const,
            weight: "1.0",
          }))
        );

        // Initialise AI profile strong/weak topics from choices
        await tx
          .update(studentAiProfiles)
          .set({ strong_topics: topics, updated_at: now })
          .where(eq(studentAiProfiles.student_id, studentId));
      });

      // Trigger first lesson generation asynchronously
      const [student] = await db
        .select({ teacher_id: students.teacher_id })
        .from(students)
        .where(eq(students.id, studentId))
        .limit(1);

      if (student) {
        // Fire and forget — don't block the response. Anchor to the Learning
        // Map when the student already has a course; otherwise fall back to
        // legacy unanchored generation.
        resolveTopic(studentId)
          .then((resolved) =>
            generateLesson(
              studentId,
              student.teacher_id,
              resolved.ok
                ? { courseId: resolved.courseId, topicId: resolved.topicId }
                : undefined
            )
          )
          .catch(console.error);
      }

      return c.json({ message: "Onboarding complete. Your first lesson is being prepared." });
    }
  );
