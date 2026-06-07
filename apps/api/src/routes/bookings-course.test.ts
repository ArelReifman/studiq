import { describe, it, expect, beforeAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

// Mutable impersonation context so tests can switch the logged-in student.
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

// Silence Telegram so tests make no network calls and the message format is
// irrelevant to this suite (course handling never touches the request ping).
vi.mock("../lib/notify.js", () => ({
  notifyTelegramAsync: vi.fn(),
  escapeTelegramHtml: (s: string) => s,
}));

import { initTestDb, testDb } from "../test/pglite-db.js";
import { bookingRoutes } from "./bookings.js";
import {
  profiles,
  teachers,
  students,
  courses,
  studentCourses,
  teacherAvailability,
  lessonBookings,
} from "../db/schema.js";

const TEACHER_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

// Each test gets its own future date so the shared DB and the teacher-level
// time-overlap conflict guard never make tests collide with one another.
let dateCounter = 0;
function nextDate(): string {
  dateCounter += 1;
  return `2099-01-${String(dateCounter).padStart(2, "0")}`;
}

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

async function seedSlot(
  date: string,
  start: string,
  end: string
): Promise<string> {
  const id = randomUUID();
  await testDb.insert(teacherAvailability).values({
    id,
    teacher_id: TEACHER_ID,
    date,
    start_time: start,
    end_time: end,
    is_active: true,
  });
  return id;
}

async function bookingsFor(studentId: string) {
  return testDb
    .select()
    .from(lessonBookings)
    .where(eq(lessonBookings.student_id, studentId));
}

describe("Bookings course_id (Scope 2)", () => {
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

  // ── POST /bookings (single) ────────────────────────────────────────────────

  it("single: with an actively enrolled course_id stores it on the booking", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    await seedCourse(courseA, "A");
    await seedStudent(sid);
    await enroll(sid, courseA, true);
    const slot = await seedSlot(nextDate(), "09:00", "10:00");

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ availability_id: slot, course_id: courseA }),
    });
    expect(res.status).toBe(201);
    const booking = (await res.json()) as { course_id: string | null };
    expect(booking.course_id).toBe(courseA);
  });

  it("single: WITHOUT course_id behaves as before and stores null", async () => {
    const sid = randomUUID();
    await seedStudent(sid);
    const slot = await seedSlot(nextDate(), "11:00", "12:00");

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ availability_id: slot }),
    });
    expect(res.status).toBe(201);
    const booking = (await res.json()) as { course_id: string | null };
    expect(booking.course_id).toBeNull();
  });

  it("single: course the student is NOT enrolled in → 403 and no booking", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    const otherCourse = randomUUID();
    await seedCourse(courseA, "A");
    await seedCourse(otherCourse, "Other");
    await seedStudent(sid);
    await enroll(sid, courseA, true);
    const slot = await seedSlot(nextDate(), "13:00", "14:00");

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ availability_id: slot, course_id: otherCourse }),
    });
    expect(res.status).toBe(403);
    expect(await bookingsFor(sid)).toHaveLength(0);
  });

  it("single: enrolled but inactive (archived) course → 403 and no booking", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    await seedCourse(courseA, "A");
    await seedStudent(sid);
    await enroll(sid, courseA, false); // archived
    const slot = await seedSlot(nextDate(), "14:00", "15:00");

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ availability_id: slot, course_id: courseA }),
    });
    expect(res.status).toBe(403);
    expect(await bookingsFor(sid)).toHaveLength(0);
  });

  it("single: another student's course → 403 and no booking", async () => {
    const studentA = randomUUID();
    const studentB = randomUUID();
    const courseB = randomUUID();
    await seedCourse(courseB, "B");
    await seedStudent(studentA);
    await seedStudent(studentB);
    await enroll(studentB, courseB, true); // only B enrolled
    const slot = await seedSlot(nextDate(), "15:00", "16:00");

    ctx.USER_ID = studentA;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ availability_id: slot, course_id: courseB }),
    });
    expect(res.status).toBe(403);
    expect(await bookingsFor(studentA)).toHaveLength(0);
  });

  // ── POST /bookings/batch ───────────────────────────────────────────────────

  it("batch: with an enrolled course_id stores it on EVERY row", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    await seedCourse(courseA, "A");
    await seedStudent(sid);
    await enroll(sid, courseA, true);
    const date = nextDate();
    const s1 = await seedSlot(date, "09:00", "10:00");
    const s2 = await seedSlot(date, "10:00", "11:00");

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request("/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ availability_ids: [s1, s2], course_id: courseA }),
    });
    expect(res.status).toBe(201);
    const rows = (await res.json()) as Array<{ course_id: string | null }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.course_id === courseA)).toBe(true);
  });

  it("batch: WITHOUT course_id behaves as before and stores null on every row", async () => {
    const sid = randomUUID();
    await seedStudent(sid);
    const date = nextDate();
    const s1 = await seedSlot(date, "12:00", "13:00");
    const s2 = await seedSlot(date, "13:00", "14:00");

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request("/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ availability_ids: [s1, s2] }),
    });
    expect(res.status).toBe(201);
    const rows = (await res.json()) as Array<{ course_id: string | null }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.course_id === null)).toBe(true);
  });

  it("batch: course the student is NOT enrolled in → 403 and no bookings", async () => {
    const sid = randomUUID();
    const otherCourse = randomUUID();
    await seedCourse(otherCourse, "Other");
    await seedStudent(sid);
    const date = nextDate();
    const s1 = await seedSlot(date, "16:00", "17:00");
    const s2 = await seedSlot(date, "17:00", "18:00");

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request("/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ availability_ids: [s1, s2], course_id: otherCourse }),
    });
    expect(res.status).toBe(403);
    expect(await bookingsFor(sid)).toHaveLength(0);
  });
});
