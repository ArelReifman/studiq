import { describe, it, expect, beforeAll, vi } from "vitest";

// Stable UUIDs for the seeded fixtures. Declared via vi.hoisted so the
// vi.mock factories below (which are hoisted above imports) can reference them.
const ids = vi.hoisted(() => ({
  STUDENT_ID: "11111111-1111-1111-1111-111111111111",
  TEACHER_ID: "22222222-2222-2222-2222-222222222222",
  COURSE_ID: "33333333-3333-3333-3333-333333333333",
}));

// Point the route's db at the in-memory pglite instance.
vi.mock("../db/client.js", async () => {
  const mod = await import("../test/pglite-db.js");
  return { db: mod.testDb };
});

// Bypass Supabase auth: inject the seeded student as the caller.
vi.mock("../middleware/auth.js", () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set("userId", ids.STUDENT_ID);
    c.set("userRole", "student");
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

import { initTestDb, testDb } from "../test/pglite-db.js";
import { learningMapRoutes } from "./learning-map.js";
import {
  profiles,
  teachers,
  students,
  courses,
  studentCourses,
  lessonSessions,
} from "../db/schema.js";

describe("GET /learning-map — archived-course fallback regression", () => {
  beforeAll(async () => {
    await initTestDb();

    // Teacher + student identities.
    await testDb.insert(profiles).values([
      {
        id: ids.TEACHER_ID,
        role: "teacher",
        full_name: "Test Teacher",
        email: "teacher@test.dev",
      },
      {
        id: ids.STUDENT_ID,
        role: "student",
        full_name: "Test Student",
        email: "student@test.dev",
      },
    ]);
    await testDb.insert(teachers).values({ id: ids.TEACHER_ID });
    await testDb.insert(students).values({
      id: ids.STUDENT_ID,
      teacher_id: ids.TEACHER_ID,
      // No active default course — primary must NOT resurrect an archived one.
      primary_course_id: null,
    });

    // A course that has been ARCHIVED for this student...
    await testDb.insert(courses).values({
      id: ids.COURSE_ID,
      teacher_id: ids.TEACHER_ID,
      name: "Discrete Math 2",
    });
    await testDb.insert(studentCourses).values({
      student_id: ids.STUDENT_ID,
      course_id: ids.COURSE_ID,
      is_active: false, // archived
    });

    // ...but an OLD lesson still references it. The buggy code used this to
    // infer the course and resurfaced the archived map.
    await testDb.insert(lessonSessions).values({
      student_id: ids.STUDENT_ID,
      teacher_id: ids.TEACHER_ID,
      course_id: ids.COURSE_ID,
      title: "Old lesson on an archived course",
    });
  });

  it("does not fall back to an archived course inferred from old lessons", async () => {
    // Student fetches their map with no course_id — the dangerous path.
    const res = await learningMapRoutes.request("/");

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("No course found for student");
  });
});
