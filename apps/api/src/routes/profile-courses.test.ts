import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

// Mutable impersonation context so individual tests can switch the logged-in
// user (to prove cross-student isolation). Declared via vi.hoisted so the
// hoisted vi.mock factory can read it.
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
import { profileRoutes } from "./profile.js";
import {
  profiles,
  teachers,
  students,
  courses,
  studentCourses,
} from "../db/schema.js";

const TEACHER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

async function seedStudent(studentId: string, primaryCourseId: string | null) {
  await testDb.insert(profiles).values({
    id: studentId,
    role: "student",
    full_name: "Test Student",
    email: `${studentId}@test.dev`,
  });
  await testDb.insert(students).values({
    id: studentId,
    teacher_id: TEACHER_ID,
    primary_course_id: primaryCourseId,
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

describe("GET /profile/courses", () => {
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

  it("returns all active enrollments of the logged-in student", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    const courseB = randomUUID();
    await seedCourse(courseA, "Course A");
    await seedCourse(courseB, "Course B");
    await seedStudent(sid, courseA); // primary = A
    await enroll(sid, courseA, true);
    await enroll(sid, courseB, true);

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await profileRoutes.request("/courses");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; is_primary: boolean }>;

    expect(body).toHaveLength(2);
    const ids = body.map((c) => c.id).sort();
    expect(ids).toEqual([courseA, courseB].sort());
    expect(body.find((c) => c.id === courseA)?.is_primary).toBe(true);
    expect(body.find((c) => c.id === courseB)?.is_primary).toBe(false);
  });

  it("excludes archived (inactive) enrollments", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    const courseB = randomUUID();
    await seedCourse(courseA, "Active");
    await seedCourse(courseB, "Archived");
    await seedStudent(sid, courseA);
    await enroll(sid, courseA, true);
    await enroll(sid, courseB, false);

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await profileRoutes.request("/courses");
    const body = (await res.json()) as Array<{ id: string }>;

    expect(body).toHaveLength(1);
    expect(body[0]!.id).toBe(courseA);
  });

  it("returns [] for a student with no active courses", async () => {
    const sid = randomUUID();
    await seedStudent(sid, null);

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await profileRoutes.request("/courses");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  it("never leaks another student's courses (scoped to caller id)", async () => {
    const studentA = randomUUID();
    const studentB = randomUUID();
    const courseA = randomUUID();
    const courseB = randomUUID();
    await seedCourse(courseA, "A only");
    await seedCourse(courseB, "B only");
    await seedStudent(studentA, courseA);
    await seedStudent(studentB, courseB);
    await enroll(studentA, courseA, true);
    await enroll(studentB, courseB, true);

    // Logged in as A — must only see A's course, never B's.
    ctx.USER_ID = studentA;
    ctx.ROLE = "student";
    const res = await profileRoutes.request("/courses");
    const body = (await res.json()) as Array<{ id: string }>;

    expect(body).toHaveLength(1);
    expect(body[0]!.id).toBe(courseA);
  });
});
