import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

// Mutable impersonation context so tests can switch between students/teacher.
const ctx = vi.hoisted(() => ({
  USER_ID: "" as string,
  ROLE: "student" as "student" | "teacher",
}));

// Route db → in-memory pglite.
vi.mock("../db/client.js", async () => {
  const mod = await import("../test/pglite-db.js");
  return { db: mod.testDb };
});

// Impersonate whoever ctx points at; requireRole is a pass-through.
vi.mock("../middleware/auth.js", () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set("userId", ctx.USER_ID);
    c.set("userRole", ctx.ROLE);
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
  studentCourses,
  lessonSessions,
} from "../db/schema.js";

const TEACHER_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

async function seedStudent(studentId: string) {
  await testDb.insert(profiles).values({
    id: studentId,
    role: "student",
    full_name: "Test Student",
    email: `${studentId}@test.dev`,
  });
  await testDb.insert(students).values({
    id: studentId,
    teacher_id: TEACHER_ID,
    primary_course_id: null,
  });
}

async function seedCourse(courseId: string, name: string) {
  await testDb
    .insert(courses)
    .values({ id: courseId, teacher_id: TEACHER_ID, name });
}

async function enroll(studentId: string, courseId: string, isActive: boolean) {
  await testDb
    .insert(studentCourses)
    .values({ student_id: studentId, course_id: courseId, is_active: isActive });
}

async function seedLesson(
  studentId: string,
  courseId: string | null
): Promise<string> {
  const id = randomUUID();
  await testDb.insert(lessonSessions).values({
    id,
    student_id: studentId,
    teacher_id: TEACHER_ID,
    title: "Lesson",
    course_id: courseId,
  });
  return id;
}

describe("GET /lessons course_id filtering", () => {
  beforeAll(async () => {
    await initTestDb();
    await testDb.insert(profiles).values({
      id: TEACHER_ID,
      role: "teacher",
      full_name: "Teacher",
      email: "teacher@test.dev",
    });
    await testDb.insert(teachers).values({ id: TEACHER_ID });
  });

  it("regression: WITHOUT course_id returns exactly all the student's lessons (no implicit scoping)", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    const courseB = randomUUID();
    await seedCourse(courseA, "A");
    await seedCourse(courseB, "B");
    await seedStudent(sid);
    await enroll(sid, courseA, true);
    await enroll(sid, courseB, true);
    const lA = await seedLesson(sid, courseA);
    const lB = await seedLesson(sid, courseB);
    const lNull = await seedLesson(sid, null);

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await lessonRoutes.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;

    // Same as pre-change behaviour: every lesson the student owns, including
    // both courses and the null-course lesson.
    expect(body.map((l) => l.id).sort()).toEqual([lA, lB, lNull].sort());
  });

  it("WITH enrolled course_id returns that course's lessons plus null-course lessons (excludes other course only)", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    const courseB = randomUUID();
    await seedCourse(courseA, "A");
    await seedCourse(courseB, "B");
    await seedStudent(sid);
    await enroll(sid, courseA, true);
    await enroll(sid, courseB, true);
    const lA = await seedLesson(sid, courseA);
    await seedLesson(sid, courseB);
    const lNull = await seedLesson(sid, null);

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await lessonRoutes.request(`/?course_id=${courseA}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;

    // Legacy pre-course-model lessons (course_id IS NULL) must still surface
    // when scoping to a course — only lessons under a DIFFERENT real course
    // are excluded.
    expect(body.map((l) => l.id).sort()).toEqual([lA, lNull].sort());
  });

  it("WITH course_id the student is not enrolled in → 403", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    const otherCourse = randomUUID();
    await seedCourse(courseA, "A");
    await seedCourse(otherCourse, "Other");
    await seedStudent(sid);
    await enroll(sid, courseA, true);

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await lessonRoutes.request(`/?course_id=${otherCourse}`);
    expect(res.status).toBe(403);
  });

  it("WITH course_id enrolled but inactive (archived) → 403", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    await seedCourse(courseA, "A");
    await seedStudent(sid);
    await enroll(sid, courseA, false); // archived

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await lessonRoutes.request(`/?course_id=${courseA}`);
    expect(res.status).toBe(403);
  });

  it("WITH another student's course_id → 403 (no cross-student access)", async () => {
    const studentA = randomUUID();
    const studentB = randomUUID();
    const courseB = randomUUID();
    await seedCourse(courseB, "B's course");
    await seedStudent(studentA);
    await seedStudent(studentB);
    await enroll(studentB, courseB, true); // only B is enrolled

    // Logged in as A, asking for B's course.
    ctx.USER_ID = studentA;
    ctx.ROLE = "student";
    const res = await lessonRoutes.request(`/?course_id=${courseB}`);
    expect(res.status).toBe(403);
  });

  it("teacher branch WITHOUT course_id: unchanged, student_id alone scopes to all their lessons", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    const courseB = randomUUID();
    await seedCourse(courseA, "A");
    await seedCourse(courseB, "B");
    await seedStudent(sid);
    const lA = await seedLesson(sid, courseA);
    const lB = await seedLesson(sid, courseB);

    ctx.USER_ID = TEACHER_ID;
    ctx.ROLE = "teacher";

    const res = await lessonRoutes.request(`/?student_id=${sid}`);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((l) => l.id).sort()).toEqual([lA, lB].sort());
  });

  it("teacher branch WITH course_id + student_id (enrolled): scopes to that course plus null-course lessons", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    const courseB = randomUUID();
    await seedCourse(courseA, "A");
    await seedCourse(courseB, "B");
    await seedStudent(sid);
    await enroll(sid, courseA, true);
    const lA = await seedLesson(sid, courseA);
    await seedLesson(sid, courseB);
    const lNull = await seedLesson(sid, null);

    ctx.USER_ID = TEACHER_ID;
    ctx.ROLE = "teacher";

    const res = await lessonRoutes.request(
      `/?student_id=${sid}&course_id=${courseA}`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((l) => l.id).sort()).toEqual([lA, lNull].sort());
  });

  it("teacher branch WITH course_id + student_id (not enrolled) → 403", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    await seedCourse(courseA, "A");
    await seedStudent(sid);
    await seedLesson(sid, courseA);

    ctx.USER_ID = TEACHER_ID;
    ctx.ROLE = "teacher";

    const res = await lessonRoutes.request(
      `/?student_id=${sid}&course_id=${courseA}`
    );
    expect(res.status).toBe(403);
  });

  it("teacher branch WITH course_id but WITHOUT student_id: ambiguous, course_id ignored (returns lessons across courses/students)", async () => {
    const sid1 = randomUUID();
    const sid2 = randomUUID();
    const courseA = randomUUID();
    const courseB = randomUUID();
    await seedCourse(courseA, "A");
    await seedCourse(courseB, "B");
    await seedStudent(sid1);
    await seedStudent(sid2);
    const lA = await seedLesson(sid1, courseA);
    const lB = await seedLesson(sid2, courseB);

    ctx.USER_ID = TEACHER_ID;
    ctx.ROLE = "teacher";

    const res = await lessonRoutes.request(`/?course_id=${courseA}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    // Unscoped teacher-wide query — other tests in this file share the same
    // in-memory DB and TEACHER_ID, so assert a superset rather than equality.
    const ids = body.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining([lA, lB]));
  });
});
