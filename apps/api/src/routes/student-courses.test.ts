import { describe, it, expect, beforeAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

// One fixed teacher for the whole file; the auth mock impersonates them.
// Declared via vi.hoisted so the hoisted vi.mock factory can read it.
const ctx = vi.hoisted(() => ({
  TEACHER_ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
}));

// Point the routes' db at the in-memory pglite instance.
vi.mock("../db/client.js", async () => {
  const mod = await import("../test/pglite-db.js");
  return { db: mod.testDb };
});

// studentRoutes uses authMiddleware + requireRole("teacher"); impersonate the
// fixed teacher and make requireRole a pass-through.
vi.mock("../middleware/auth.js", () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set("userId", ctx.TEACHER_ID);
    c.set("userRole", "teacher");
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

import { initTestDb, testDb } from "../test/pglite-db.js";
import { studentRoutes } from "./students.js";
import {
  profiles,
  teachers,
  students,
  courses,
  studentCourses,
} from "../db/schema.js";

// ── Seed helpers — each test uses unique ids so the shared DB needs no reset ──
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

async function seedCourse(courseId: string, name: string) {
  await testDb
    .insert(courses)
    .values({ id: courseId, teacher_id: ctx.TEACHER_ID, name });
}

async function enroll(studentId: string, courseId: string, isActive: boolean) {
  await testDb
    .insert(studentCourses)
    .values({ student_id: studentId, course_id: courseId, is_active: isActive });
}

async function getStudentCourseRow(studentId: string, courseId: string) {
  return testDb
    .select()
    .from(studentCourses)
    .where(
      and(
        eq(studentCourses.student_id, studentId),
        eq(studentCourses.course_id, courseId)
      )
    );
}

async function getPrimary(studentId: string) {
  const [row] = await testDb
    .select({ primary: students.primary_course_id })
    .from(students)
    .where(eq(students.id, studentId));
  return row?.primary ?? null;
}

describe("student courses — active/archive/reactivate stability", () => {
  beforeAll(async () => {
    await initTestDb();
    await testDb.insert(profiles).values({
      id: ctx.TEACHER_ID,
      role: "teacher",
      full_name: "Test Teacher",
      email: "teacher-sc@test.dev",
    });
    await testDb.insert(teachers).values({ id: ctx.TEACHER_ID });
  });

  it("1. returns all active courses from GET /students/:id", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    const courseB = randomUUID();
    await seedCourse(courseA, "Course A");
    await seedCourse(courseB, "Course B");
    await seedStudent(sid, courseA);
    await enroll(sid, courseA, true);
    await enroll(sid, courseB, true);

    const res = await studentRoutes.request(`/${sid}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { courses: { id: string }[] };

    expect(body.courses).toHaveLength(2);
    const returnedIds = body.courses.map((c) => c.id).sort();
    expect(returnedIds).toEqual([courseA, courseB].sort());
  });

  it("2. archiving the primary course moves primary to the other active course", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    const courseB = randomUUID();
    await seedCourse(courseA, "Course A");
    await seedCourse(courseB, "Course B");
    await seedStudent(sid, courseA); // primary = A
    await enroll(sid, courseA, true);
    await enroll(sid, courseB, true);

    const res = await studentRoutes.request(`/${sid}/courses/${courseA}/archive`, {
      method: "PATCH",
    });
    expect(res.status).toBe(200);

    expect(await getPrimary(sid)).toBe(courseB);
    const [rowA] = await getStudentCourseRow(sid, courseA);
    const [rowB] = await getStudentCourseRow(sid, courseB);
    expect(rowA?.is_active).toBe(false);
    expect(rowB?.is_active).toBe(true);
  });

  it("3. archiving the only active course nulls primary_course_id", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    await seedCourse(courseA, "Course A");
    await seedStudent(sid, courseA); // primary = A, only course
    await enroll(sid, courseA, true);

    const res = await studentRoutes.request(`/${sid}/courses/${courseA}/archive`, {
      method: "PATCH",
    });
    expect(res.status).toBe(200);

    expect(await getPrimary(sid)).toBeNull();
    const [rowA] = await getStudentCourseRow(sid, courseA);
    expect(rowA?.is_active).toBe(false);
  });

  it("4. re-adding an archived course reactivates the row without duplicating", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    await seedCourse(courseA, "Course A");
    await seedStudent(sid, null);
    await enroll(sid, courseA, false); // archived

    const res = await studentRoutes.request(`/${sid}/courses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course_id: courseA }),
    });
    expect(res.status).toBe(200);

    const rows = await getStudentCourseRow(sid, courseA);
    expect(rows).toHaveLength(1); // no duplicate
    expect(rows[0]?.is_active).toBe(true); // reactivated
  });
});
