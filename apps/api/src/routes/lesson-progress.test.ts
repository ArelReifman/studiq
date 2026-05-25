import { describe, it, expect, beforeAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

// One fixed teacher; the auth mock impersonates them.
const ctx = vi.hoisted(() => ({
  TEACHER_ID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
}));

// Route db → in-memory pglite.
vi.mock("../db/client.js", async () => {
  const mod = await import("../test/pglite-db.js");
  return { db: mod.testDb };
});

// Impersonate the fixed teacher; requireRole is a pass-through.
vi.mock("../middleware/auth.js", () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set("userId", ctx.TEACHER_ID);
    c.set("userRole", "teacher");
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

// Neutralize the fire-and-forget AI calls the review route triggers so tests
// stay deterministic and make no network calls.
vi.mock("../services/ai/update-profile.js", () => ({
  updateStudentProfile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/ai/update-teacher-style.js", () => ({
  updateTeacherStyleIfDue: vi.fn().mockResolvedValue(undefined),
}));

import { initTestDb, testDb } from "../test/pglite-db.js";
import { lessonRoutes } from "./lessons.js";
import { learningMapRoutes } from "./learning-map.js";
import {
  profiles,
  teachers,
  students,
  courses,
  courseTopics,
  studentCourses,
  lessonSessions,
} from "../db/schema.js";

// ── Seed helpers — unique ids per test, shared DB needs no reset ──
async function seedStudent(studentId: string, primaryCourseId: string | null) {
  await testDb.insert(profiles).values({
    id: studentId,
    role: "student",
    full_name: "Test Student",
    email: `${studentId}@test.dev`,
  });
  await testDb.insert(students).values({
    id: studentId,
    teacher_id: ctx.TEACHER_ID,
    primary_course_id: primaryCourseId,
  });
}

async function seedActiveCourse(studentId: string, courseId: string) {
  await testDb
    .insert(courses)
    .values({ id: courseId, teacher_id: ctx.TEACHER_ID, name: "Course" });
  await testDb
    .insert(studentCourses)
    .values({ student_id: studentId, course_id: courseId, is_active: true });
}

async function seedTopic(courseId: string, topicId: string) {
  await testDb.insert(courseTopics).values({
    id: topicId,
    course_id: courseId,
    name: "Topic",
  });
}

/** A fully-wired student with one active course + one topic. */
async function seedScenario() {
  const sid = randomUUID();
  const cid = randomUUID();
  const tid = randomUUID();
  await seedStudent(sid, cid);
  await seedActiveCourse(sid, cid);
  await seedTopic(cid, tid);
  return { sid, cid, tid };
}

async function createLesson(sid: string, cid: string, tid: string) {
  const res = await lessonRoutes.request("/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      student_id: sid,
      title: "Lesson",
      course_id: cid,
      topic_id: tid,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function getTopicStats(sid: string, cid: string, tid: string) {
  const res = await learningMapRoutes.request(
    `/?student_id=${sid}&course_id=${cid}`
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    topics: { id: string; stats: Record<string, number> }[];
  };
  return body.topics.find((t) => t.id === tid)?.stats;
}

async function lessonStatus(lessonId: string) {
  const [row] = await testDb
    .select({ status: lessonSessions.status })
    .from(lessonSessions)
    .where(eq(lessonSessions.id, lessonId));
  return row?.status ?? null;
}

describe("learning map — lesson/topic progress", () => {
  beforeAll(async () => {
    await initTestDb();
    await testDb.insert(profiles).values({
      id: ctx.TEACHER_ID,
      role: "teacher",
      full_name: "Test Teacher",
      email: "teacher-lp@test.dev",
    });
    await testDb.insert(teachers).values({ id: ctx.TEACHER_ID });
  });

  it("1. creating a lesson with course_id + topic_id increments lessons_total", async () => {
    const { sid, cid, tid } = await seedScenario();
    await createLesson(sid, cid, tid);

    const stats = await getTopicStats(sid, cid, tid);
    expect(stats?.lessons_total).toBe(1);
  });

  it("2. deleting a lesson decreases lessons_total back to 0", async () => {
    const { sid, cid, tid } = await seedScenario();
    const lesson = await createLesson(sid, cid, tid);

    const del = await lessonRoutes.request(`/${lesson.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const stats = await getTopicStats(sid, cid, tid);
    expect(stats?.lessons_total).toBe(0);
  });

  it("3. review next_level marks lesson completed and map reads 100%", async () => {
    const { sid, cid, tid } = await seedScenario();
    const lesson = await createLesson(sid, cid, tid);

    const review = await lessonRoutes.request(`/${lesson.id}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teacher_decision: "next_level" }),
    });
    expect(review.status).toBe(200);

    expect(await lessonStatus(lesson.id)).toBe("completed");

    const stats = await getTopicStats(sid, cid, tid);
    expect(stats?.lessons_completed).toBe(1);
    expect(stats?.pct).toBe(100);
  });

  it("4. review repeat does NOT mark the lesson completed", async () => {
    const { sid, cid, tid } = await seedScenario();
    const lesson = await createLesson(sid, cid, tid);

    const review = await lessonRoutes.request(`/${lesson.id}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teacher_decision: "repeat" }),
    });
    expect(review.status).toBe(200);

    expect(await lessonStatus(lesson.id)).not.toBe("completed");
    expect(await lessonStatus(lesson.id)).toBe("active");
  });
});
