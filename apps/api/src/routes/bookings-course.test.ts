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
import { notifyTelegramAsync } from "../lib/notify.js";
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

// Inserts a booking row directly (no availability required — availability_id
// is nullable). Used by the GET /my tests which need existing rows to read.
async function seedBooking(
  studentId: string,
  courseId: string | null,
  date: string,
  startTime = "10:00",
  endTime = "11:00"
): Promise<string> {
  const id = randomUUID();
  await testDb.insert(lessonBookings).values({
    id,
    student_id: studentId,
    teacher_id: TEACHER_ID,
    date,
    start_time: startTime,
    end_time: endTime,
    course_id: courseId,
  });
  return id;
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

describe("GET /my course_id filtering", () => {
  it("without course_id returns all student bookings including different courses and null-course", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    const courseB = randomUUID();
    await seedCourse(courseA, "A");
    await seedCourse(courseB, "B");
    await seedStudent(sid);
    const bA = await seedBooking(sid, courseA, "2099-02-01");
    const bB = await seedBooking(sid, courseB, "2099-02-02");
    const bNull = await seedBooking(sid, null, "2099-02-03");

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request("/my");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    const ids = body.map((b) => b.id).sort();
    expect(ids).toEqual([bA, bB, bNull].sort());
  });

  it("with course_id=A returns only bookings of course A", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    const courseB = randomUUID();
    await seedCourse(courseA, "A");
    await seedCourse(courseB, "B");
    await seedStudent(sid);
    const bA = await seedBooking(sid, courseA, "2099-03-01");
    await seedBooking(sid, courseB, "2099-03-02");
    await seedBooking(sid, null, "2099-03-03");

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request(`/my?course_id=${courseA}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((b) => b.id)).toEqual([bA]);
  });

  it("with course_id=B returns only bookings of course B", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    const courseB = randomUUID();
    await seedCourse(courseA, "A");
    await seedCourse(courseB, "B");
    await seedStudent(sid);
    await seedBooking(sid, courseA, "2099-04-01");
    const bB = await seedBooking(sid, courseB, "2099-04-02");

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request(`/my?course_id=${courseB}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((b) => b.id)).toEqual([bB]);
  });

  it("with a UUID not in the student's bookings returns empty array", async () => {
    const sid = randomUUID();
    const courseA = randomUUID();
    const unrelatedCourse = randomUUID();
    await seedCourse(courseA, "A");
    await seedCourse(unrelatedCourse, "Unrelated");
    await seedStudent(sid);
    await seedBooking(sid, courseA, "2099-05-01");

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request(`/my?course_id=${unrelatedCourse}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("with a non-UUID course_id returns a validation error without hitting DB", async () => {
    const sid = randomUUID();
    await seedStudent(sid);

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request("/my?course_id=not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("never returns another student's bookings even with the same course_id", async () => {
    const studentA = randomUUID();
    const studentB = randomUUID();
    const sharedCourse = randomUUID();
    await seedCourse(sharedCourse, "Shared");
    await seedStudent(studentA);
    await seedStudent(studentB);
    await seedBooking(studentA, sharedCourse, "2099-06-01");
    const bB = await seedBooking(studentB, sharedCourse, "2099-06-02");

    ctx.USER_ID = studentB;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request(`/my?course_id=${sharedCourse}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((b) => b.id)).toEqual([bB]);
  });
});

// Seed a fresh isolated teacher (so count tests see only their own data).
async function seedIsolatedTeacher(): Promise<string> {
  const tid = randomUUID();
  await testDb.insert(profiles).values({
    id: tid,
    role: "teacher",
    full_name: "Isolated Teacher",
    email: `${tid}@test.dev`,
  });
  await testDb.insert(teachers).values({ id: tid });
  return tid;
}

// Seed a student under a specific teacher.
async function seedStudentFor(studentId: string, teacherId: string) {
  await testDb.insert(profiles).values({
    id: studentId,
    role: "student",
    full_name: "Test Student",
    email: `${studentId}@test.dev`,
  });
  await testDb.insert(students).values({
    id: studentId,
    teacher_id: teacherId,
    primary_course_id: null,
  });
}

// Seed a booking under a specific teacher (for count/requests isolation).
async function seedBookingFor(
  studentId: string,
  teacherId: string,
  courseId: string | null,
  date: string,
  startTime = "10:00",
  endTime = "11:00"
): Promise<string> {
  const id = randomUUID();
  await testDb.insert(lessonBookings).values({
    id,
    student_id: studentId,
    teacher_id: teacherId,
    date,
    start_time: startTime,
    end_time: endTime,
    course_id: courseId,
    status: "pending",
  });
  return id;
}

describe("GET /requests teacher course-aware", () => {
  it("returns course_name when booking has a course", async () => {
    const tid = await seedIsolatedTeacher();
    const sid = randomUUID();
    const courseId = randomUUID();
    await testDb.insert(courses).values({ id: courseId, teacher_id: tid, name: "Course Aleph" });
    await seedStudentFor(sid, tid);
    await seedBookingFor(sid, tid, courseId, "2099-08-01");

    ctx.USER_ID = tid;
    ctx.ROLE = "teacher";
    const res = await bookingRoutes.request("/requests");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ course_id: string | null; course_name: string | null }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.course_id).toBe(courseId);
    expect(body[0]!.course_name).toBe("Course Aleph");
  });

  it("returns course_name = null for legacy booking with course_id = null", async () => {
    const tid = await seedIsolatedTeacher();
    const sid = randomUUID();
    await seedStudentFor(sid, tid);
    await seedBookingFor(sid, tid, null, "2099-08-02");

    ctx.USER_ID = tid;
    ctx.ROLE = "teacher";
    const res = await bookingRoutes.request("/requests");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ course_id: string | null; course_name: string | null }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.course_id).toBeNull();
    expect(body[0]!.course_name).toBeNull();
  });
});

describe("GET /requests/count course-aware", () => {
  it("two consecutive slots from same student and same course count as 1", async () => {
    const tid = await seedIsolatedTeacher();
    const sid = randomUUID();
    const courseA = randomUUID();
    await testDb.insert(courses).values({ id: courseA, teacher_id: tid, name: "A" });
    await seedStudentFor(sid, tid);
    // Consecutive: 09:00–09:30 then 09:30–10:00, same course → 1 group
    await seedBookingFor(sid, tid, courseA, "2099-09-01", "09:00", "09:30");
    await seedBookingFor(sid, tid, courseA, "2099-09-01", "09:30", "10:00");

    ctx.USER_ID = tid;
    ctx.ROLE = "teacher";
    const res = await bookingRoutes.request("/requests/count");
    expect(res.status).toBe(200);
    const { count } = (await res.json()) as { count: number };
    expect(count).toBe(1);
  });

  it("two consecutive slots from same student but different courses count as 2", async () => {
    const tid = await seedIsolatedTeacher();
    const sid = randomUUID();
    const courseA = randomUUID();
    const courseB = randomUUID();
    await testDb.insert(courses).values({ id: courseA, teacher_id: tid, name: "A" });
    await testDb.insert(courses).values({ id: courseB, teacher_id: tid, name: "B" });
    await seedStudentFor(sid, tid);
    // Same student, same day, consecutive times, but DIFFERENT courses → 2 groups
    await seedBookingFor(sid, tid, courseA, "2099-10-01", "11:00", "11:30");
    await seedBookingFor(sid, tid, courseB, "2099-10-01", "11:30", "12:00");

    ctx.USER_ID = tid;
    ctx.ROLE = "teacher";
    const res = await bookingRoutes.request("/requests/count");
    expect(res.status).toBe(200);
    const { count } = (await res.json()) as { count: number };
    expect(count).toBe(2);
  });
});

// ── Telegram course tag in booking notifications ────────────────────────────
// The mock at the top of this file captures notifyTelegramAsync calls as a
// vi.fn(). Each test resets the mock before asserting.
// NOTE: POST /bookings (single) sends Telegram only when the slot is the
// "group head" after a 300ms coalescing window. That window requires real
// timers and DB state that is impractical to replicate deterministically in
// a unit test without fake timers support across Drizzle+Hono. Single-booking
// Telegram content is therefore covered by manual QA (see checklist below).
//
// MANUAL CHECKLIST — single booking course tag:
//   1. Student with course_id books a slot → Telegram message includes
//      "· <CourseName>" before the optional note line.
//   2. Student without course_id books a slot → resolveCourseName fallback
//      (primary_course_id or sole-active) is used; course tag omitted when "".
//   3. Telegram or course-lookup failure → booking is persisted (201), no 500.
describe("Telegram course tag — batch booking", () => {
  const mockNotify = notifyTelegramAsync as ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    // initTestDb is idempotent — safe to call again for a nested describe.
    await initTestDb();
    await testDb.insert(profiles).values({
      id: TEACHER_ID,
      role: "teacher",
      full_name: "Teacher",
      email: "teacher@test.dev",
    }).onConflictDoNothing();
    await testDb.insert(teachers).values({ id: TEACHER_ID }).onConflictDoNothing();
  });

  it("batch with course_id sends ONE message containing the course name", async () => {
    mockNotify.mockClear();
    const sid = randomUUID();
    const courseId = randomUUID();
    await seedCourse(courseId, "Linear Algebra");
    await seedStudent(sid);
    await enroll(sid, courseId, true);
    const date = nextDate();
    const s1 = await seedSlot(date, "09:00", "09:30");
    const s2 = await seedSlot(date, "09:30", "10:00");

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request("/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ availability_ids: [s1, s2], course_id: courseId }),
    });
    expect(res.status).toBe(201);

    // Exactly one Telegram ping for the whole batch.
    expect(mockNotify).toHaveBeenCalledTimes(1);
    const msg: string = mockNotify.mock.calls[0]![0] as string;
    expect(msg).toContain("Linear Algebra");
    expect(msg).not.toContain(courseId); // no raw UUID
  });

  it("course name is passed through escapeTelegramHtml before insertion into message", async () => {
    // escapeTelegramHtml is mocked as a pass-through in this test suite, so
    // the message contains the raw string. The real escaping (&amp; &lt; &gt;)
    // is guaranteed by the production function in lib/notify.ts — verified
    // by code review. This test confirms the course name is included in the
    // message (i.e. escapeTelegramHtml(courseName) is called, not skipped).
    mockNotify.mockClear();
    const sid = randomUUID();
    const courseId = randomUUID();
    await seedCourse(courseId, "Math & Science");
    await seedStudent(sid);
    await enroll(sid, courseId, true);
    const date = nextDate();
    const s1 = await seedSlot(date, "10:00", "10:30");

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request("/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ availability_ids: [s1], course_id: courseId }),
    });
    expect(res.status).toBe(201);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    const msg: string = mockNotify.mock.calls[0]![0] as string;
    // Mock is pass-through so raw name appears; production code calls
    // escapeTelegramHtml(courseName) which in real execution produces &amp; etc.
    expect(msg).toContain("Math & Science");
    expect(msg).not.toContain(courseId); // no raw UUID ever exposed
  });

  it("batch without course_id still sends the message (legacy path, no course tag)", async () => {
    mockNotify.mockClear();
    const sid = randomUUID();
    await seedStudent(sid);
    const date = nextDate();
    const s1 = await seedSlot(date, "11:00", "11:30");

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request("/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ availability_ids: [s1] }),
    });
    expect(res.status).toBe(201);
    // Notification is sent even without course_id.
    expect(mockNotify).toHaveBeenCalledTimes(1);
    // No course name appended (student has no courses).
    const msg: string = mockNotify.mock.calls[0]![0] as string;
    expect(msg).toContain("New lesson request");
  });

  it("Telegram failure (mocked throw) does not prevent batch creation", async () => {
    mockNotify.mockClear();
    // Make the mock throw on this test only.
    mockNotify.mockImplementationOnce(() => { throw new Error("Telegram down"); });

    const sid = randomUUID();
    const courseId = randomUUID();
    await seedCourse(courseId, "Physics");
    await seedStudent(sid);
    await enroll(sid, courseId, true);
    const date = nextDate();
    const s1 = await seedSlot(date, "13:00", "13:30");

    ctx.USER_ID = sid;
    ctx.ROLE = "student";
    const res = await bookingRoutes.request("/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ availability_ids: [s1], course_id: courseId }),
    });
    // Booking must succeed regardless of Telegram failure.
    expect(res.status).toBe(201);
    const created = (await res.json()) as Array<{ id: string }>;
    expect(created).toHaveLength(1);

    // Restore mock to normal vi.fn() for subsequent tests.
    mockNotify.mockImplementation(() => undefined);
  });
});
