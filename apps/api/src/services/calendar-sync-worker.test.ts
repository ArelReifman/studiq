/**
 * calendar-sync-worker tests
 *
 * Verifies that syncBookingsByIds:
 *   1. Calls resolveCourseName with the booking's course_id and student_id.
 *   2. Passes course_name to createCalendarEvent when the resolver returns a
 *      non-empty string.
 *   3. Omits course_name from the createCalendarEvent payload when the resolver
 *      returns "" (multi-course ambiguity / no course determinable).
 *   4. Does NOT call createCalendarEvent when a gcal_event_id already exists
 *      (idempotency guard).
 *   5. Creates a single GCal event spanning both consecutive slots and
 *      propagates the event ID to every row in the group (batch correctness).
 *
 * DB compatibility note:
 *   The worker uses raw SQL via tx.execute(sql`...`) which in production
 *   (postgres-js) returns a flat Row[]. pglite returns { rows: Row[], fields }
 *   instead. We work around this by wrapping db.transaction so the tx proxy
 *   strips pglite's envelope and returns the flat rows array — exactly what
 *   the worker expects. This wrapper is local to this test file and does not
 *   affect any other test suite.
 *
 * The GCal service and the course resolver are both mocked — no real API
 * calls and no nested-connection deadlock (resolver uses `db` inside `tx`).
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

// ── Mocks must be hoisted before any import that transitively uses them ──────

// vi.hoisted ensures these variables exist inside vi.mock factories, which are
// hoisted to the top of the file before any imports run.
const { mockCreateCalendarEvent, mockResolveCourseName } = vi.hoisted(() => ({
  mockCreateCalendarEvent: vi.fn(),
  mockResolveCourseName: vi.fn(),
}));

// Route db → a pglite-backed wrapper that makes tx.execute() behave like
// postgres-js (flat array of rows, not { rows, fields } envelope).
vi.mock("../db/client.js", async () => {
  const mod = await import("../test/pglite-db.js");
  const base = mod.testDb;

  // Intercept db.transaction so every tx.execute() call unwraps the pglite
  // ResultSet envelope before returning to the worker code.
  const wrappedDb = new Proxy(base, {
    get(target, prop) {
      if (prop === "transaction") {
        return (callback: (tx: unknown) => Promise<unknown>, config?: unknown) =>
          (target as any).transaction((tx: any) => {
            const wrappedTx = new Proxy(tx, {
              get(txTarget, txProp) {
                if (txProp === "execute") {
                  return async (query: unknown) => {
                    const result = await txTarget.execute(query);
                    // pglite: { rows: [...], fields: [...] }
                    // postgres-js: rows directly as an array
                    return (result as any)?.rows ?? result;
                  };
                }
                return (txTarget as any)[txProp];
              },
            });
            return callback(wrappedTx);
          }, config);
      }
      return (target as any)[prop];
    },
  });

  return { db: wrappedDb };
});

// GCal service: replace entirely — no OAuth, no network.
vi.mock("./google-calendar.js", () => ({
  createCalendarEvent: mockCreateCalendarEvent,
}));

// Course resolver: mock to avoid using `db` inside a `tx` in pglite.
// pglite runs on a single in-process connection; a nested db.select inside
// db.transaction deadlocks. The resolver's own logic is covered separately.
vi.mock("../lib/course-resolver.js", () => ({
  resolveCourseName: mockResolveCourseName,
}));

// ── Deferred imports (after mocks) ──────────────────────────────────────────
import { initTestDb, testDb } from "../test/pglite-db.js";
import { syncBookingsByIds } from "./calendar-sync-worker.js";
import {
  profiles,
  teachers,
  students,
  courses,
  lessonBookings,
} from "../db/schema.js";
import { eq } from "drizzle-orm";

// ── Shared fixture IDs ───────────────────────────────────────────────────────

const TEACHER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

// ── One-time setup ───────────────────────────────────────────────────────────

beforeAll(async () => {
  await initTestDb();

  await testDb.insert(profiles).values({
    id: TEACHER_ID,
    role: "teacher",
    full_name: "Sync Test Teacher",
    email: "sync-teacher@test.dev",
  });
  await testDb.insert(teachers).values({ id: TEACHER_ID });
});

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults: GCal succeeds; resolver returns no course (graceful degradation).
  mockCreateCalendarEvent.mockResolvedValue("mock-gcal-id");
  mockResolveCourseName.mockResolvedValue("");
});

// ── Seed helpers ─────────────────────────────────────────────────────────────

async function seedStudent(studentId: string) {
  await testDb.insert(profiles).values({
    id: studentId,
    role: "student",
    full_name: "Sync Test Student",
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

async function seedBooking(opts: {
  id: string;
  studentId: string;
  date: string;
  startTime: string;
  endTime: string;
  courseId?: string | null;
  gcalEventId?: string | null;
}) {
  const hasExisting = Boolean(opts.gcalEventId);
  await testDb.insert(lessonBookings).values({
    id: opts.id,
    student_id: opts.studentId,
    teacher_id: TEACHER_ID,
    date: opts.date,
    start_time: opts.startTime,
    end_time: opts.endTime,
    status: "approved",
    course_id: opts.courseId ?? null,
    gcal_event_id: opts.gcalEventId ?? null,
    calendar_sync_status: hasExisting ? "synced" : "pending",
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("syncBookingsByIds — course name resolution", () => {
  it("calls resolveCourseName with the booking's course_id and student_id", async () => {
    const studentId = randomUUID();
    const courseId = randomUUID();
    const bookingId = randomUUID();

    await seedCourse(courseId, "מתמטיקה");
    await seedStudent(studentId);
    await seedBooking({
      id: bookingId,
      studentId,
      date: "2099-04-01",
      startTime: "09:00",
      endTime: "10:00",
      courseId,
    });

    await syncBookingsByIds([bookingId]);

    expect(mockResolveCourseName).toHaveBeenCalledWith(courseId, studentId);
  });

  it("passes course_name to createCalendarEvent when resolver returns a non-empty name", async () => {
    mockResolveCourseName.mockResolvedValue("פיזיקה");

    const studentId = randomUUID();
    const bookingId = randomUUID();

    await seedStudent(studentId);
    await seedBooking({
      id: bookingId,
      studentId,
      date: "2099-04-02",
      startTime: "10:00",
      endTime: "11:00",
    });

    await syncBookingsByIds([bookingId]);

    expect(mockCreateCalendarEvent).toHaveBeenCalledOnce();
    expect(mockCreateCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ course_name: "פיזיקה" })
    );
  });

  it("omits course_name from createCalendarEvent when resolver returns empty string", async () => {
    mockResolveCourseName.mockResolvedValue(""); // default, but made explicit

    const studentId = randomUUID();
    const bookingId = randomUUID();

    await seedStudent(studentId);
    await seedBooking({
      id: bookingId,
      studentId,
      date: "2099-04-03",
      startTime: "11:00",
      endTime: "12:00",
    });

    await syncBookingsByIds([bookingId]);

    expect(mockCreateCalendarEvent).toHaveBeenCalledOnce();
    // `...(courseName ? { course_name: ... } : {})` → key must not be present.
    const callArg = mockCreateCalendarEvent.mock.calls[0]![0];
    expect(callArg).not.toHaveProperty("course_name");
  });
});

describe("syncBookingsByIds — idempotency", () => {
  it("does not call createCalendarEvent when gcal_event_id already exists", async () => {
    const studentId = randomUUID();
    const bookingId = randomUUID();

    await seedStudent(studentId);
    await seedBooking({
      id: bookingId,
      studentId,
      date: "2099-04-04",
      startTime: "09:00",
      endTime: "10:00",
      gcalEventId: "already-synced-event-id",
    });

    const result = await syncBookingsByIds([bookingId]);

    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
    // Existing event ID → idempotency branch returns "synced".
    expect(result.succeeded).toBeGreaterThan(0);
  });
});

describe("syncBookingsByIds — consecutive batch", () => {
  it("creates a single GCal event for consecutive slots and propagates the ID to both rows", async () => {
    const studentId = randomUUID();
    const booking1Id = randomUUID();
    const booking2Id = randomUUID();
    const date = "2099-04-05";

    await seedStudent(studentId);
    // Two back-to-back slots: 09:00–10:00 then 10:00–11:00.
    await seedBooking({
      id: booking1Id,
      studentId,
      date,
      startTime: "09:00",
      endTime: "10:00",
    });
    await seedBooking({
      id: booking2Id,
      studentId,
      date,
      startTime: "10:00",
      endTime: "11:00",
    });

    await syncBookingsByIds([booking1Id]);

    // One GCal create spanning the full span 09:00–11:00.
    expect(mockCreateCalendarEvent).toHaveBeenCalledOnce();
    expect(mockCreateCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ start_time: "09:00", end_time: "11:00" })
    );

    // The event ID must be written to both rows.
    const [row2] = await testDb
      .select({
        gcal_event_id: lessonBookings.gcal_event_id,
        calendar_sync_status: lessonBookings.calendar_sync_status,
      })
      .from(lessonBookings)
      .where(eq(lessonBookings.id, booking2Id));

    expect(row2?.gcal_event_id).toBe("mock-gcal-id");
    expect(row2?.calendar_sync_status).toBe("synced");
  });
});
