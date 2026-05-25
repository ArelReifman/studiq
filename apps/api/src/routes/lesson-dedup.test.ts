import { describe, it, expect, beforeAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const ctx = vi.hoisted(() => ({
  TEACHER_ID: "cccccccc-cccc-cccc-cccc-cccccccccccc",
}));

vi.mock("../db/client.js", async () => {
  const mod = await import("../test/pglite-db.js");
  return { db: mod.testDb };
});

vi.mock("../middleware/auth.js", () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set("userId", ctx.TEACHER_ID);
    c.set("userRole", "teacher");
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

import { initTestDb, testDb } from "../test/pglite-db.js";
import { lessonRoutes } from "./lessons.js";
import {
  profiles,
  teachers,
  students,
  courses,
  courseTopics,
  studentCourses,
  lessonSessions,
} from "../db/schema.js";

async function seedStudent(studentId: string) {
  await testDb.insert(profiles).values({
    id: studentId,
    role: "student",
    full_name: "Test Student",
    email: `${studentId}@test.dev`,
  });
  await testDb.insert(students).values({
    id: studentId,
    teacher_id: ctx.TEACHER_ID,
    primary_course_id: null,
  });
}

async function seedCourse(studentId: string, courseId: string) {
  await testDb
    .insert(courses)
    .values({ id: courseId, teacher_id: ctx.TEACHER_ID, name: "Course" });
  await testDb
    .insert(studentCourses)
    .values({ student_id: studentId, course_id: courseId, is_active: true });
}

async function seedTopic(courseId: string, topicId: string) {
  await testDb
    .insert(courseTopics)
    .values({ id: topicId, course_id: courseId, name: "Topic" });
}

async function postCreate(
  studentId: string,
  courseId: string,
  topicId: string | null
) {
  return lessonRoutes.request("/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      student_id: studentId,
      title: "Lesson",
      course_id: courseId,
      topic_id: topicId,
    }),
  });
}

describe("POST /lessons/create — duplicate active lesson guard", () => {
  beforeAll(async () => {
    await initTestDb();
    await testDb.insert(profiles).values({
      id: ctx.TEACHER_ID,
      role: "teacher",
      full_name: "Test Teacher",
      email: "teacher-dedup@test.dev",
    });
    await testDb.insert(teachers).values({ id: ctx.TEACHER_ID });
  });

  it("1. returns the existing active lesson instead of creating a duplicate", async () => {
    const sid = randomUUID();
    const cid = randomUUID();
    const tid = randomUUID();
    await seedStudent(sid);
    await seedCourse(sid, cid);
    await seedTopic(cid, tid);

    const first = await postCreate(sid, cid, tid);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { id: string };

    const second = await postCreate(sid, cid, tid);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      id: string;
      homework_items: unknown[];
      todo_items: unknown[];
    };

    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody).toHaveProperty("homework_items");
    expect(secondBody).toHaveProperty("todo_items");

    const active = await testDb
      .select()
      .from(lessonSessions)
      .where(
        and(
          eq(lessonSessions.student_id, sid),
          eq(lessonSessions.course_id, cid),
          eq(lessonSessions.topic_id, tid),
          eq(lessonSessions.status, "active")
        )
      );
    expect(active).toHaveLength(1);
  });

  it("2. a completed lesson does not block creating a new active one", async () => {
    const sid = randomUUID();
    const cid = randomUUID();
    const tid = randomUUID();
    await seedStudent(sid);
    await seedCourse(sid, cid);
    await seedTopic(cid, tid);

    const first = await postCreate(sid, cid, tid);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { id: string };

    // Complete the first lesson.
    await testDb
      .update(lessonSessions)
      .set({ status: "completed" })
      .where(eq(lessonSessions.id, firstBody.id));

    // A new create should now produce a fresh active lesson.
    const second = await postCreate(sid, cid, tid);
    expect(second.status).toBe(201);

    const rows = await testDb
      .select()
      .from(lessonSessions)
      .where(
        and(
          eq(lessonSessions.student_id, sid),
          eq(lessonSessions.course_id, cid),
          eq(lessonSessions.topic_id, tid)
        )
      );
    expect(rows).toHaveLength(2); // total
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
  });

  it("3. dedup does not apply when topic_id is null", async () => {
    const sid = randomUUID();
    const cid = randomUUID();
    await seedStudent(sid);
    await seedCourse(sid, cid);

    const first = await postCreate(sid, cid, null);
    expect(first.status).toBe(201);
    const second = await postCreate(sid, cid, null);
    expect(second.status).toBe(201);

    const rows = await testDb
      .select()
      .from(lessonSessions)
      .where(
        and(
          eq(lessonSessions.student_id, sid),
          eq(lessonSessions.course_id, cid)
        )
      );
    expect(rows).toHaveLength(2);
  });
});
