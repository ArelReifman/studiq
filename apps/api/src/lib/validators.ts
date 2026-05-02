import { z } from "zod";

// Common reusable schemas for validating path & query params across routes.
// Postgres rejects malformed UUIDs with a raw error — validating up-front turns
// those into clean 400s and prevents wasted DB round-trips.

export const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

export const studentIdQuerySchema = z.object({
  student_id: z.string().uuid().optional(),
});

export const lessonIdQuerySchema = z.object({
  lesson_id: z.string().uuid().optional(),
});

export const learningMapQuerySchema = z.object({
  course_id: z.string().uuid().optional(),
  student_id: z.string().uuid().optional(),
});

export const userIdParamSchema = z.object({
  userId: z.string().uuid(),
});

export const courseTopicParamSchema = z.object({
  courseId: z.string().uuid(),
  topicId: z.string().uuid(),
});
