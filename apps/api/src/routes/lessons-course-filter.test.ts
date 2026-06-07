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

  it("WITH enrolled course_id returns only that course's lessons (excludes other course AND null-course)", async () => {
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
    await seedLesson(sid, null);

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await lessonRoutes.request(`/?course_id=${courseA}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;

    expect(body.map((l) => l.id)).toEqual([lA]);
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

  it("teacher branch is unchanged: course_id is ignored, student_id still scopes", async () => {
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

    // Without course_id.
    const res1 = await lessonRoutes.request(`/?student_id=${sid}`);
    const body1 = (await res1.json()) as Array<{ id: string }>;
    expect(body1.map((l) => l.id).sort()).toEqual([lA, lB].sort());

    // With course_id — teacher branch must ignore it (same result).
    const res2 = await lessonRoutes.request(
      `/?student_id=${sid}&course_id=${courseA}`
    );
    const body2 = (await res2.json()) as Array<{ id: string }>;
    expect(body2.map((l) => l.id).sort()).toEqual([lA, lB].sort());
  });
});
