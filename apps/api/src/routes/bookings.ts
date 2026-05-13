import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc, gte, lte, lt, gt, isNotNull, inArray, notInArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  lessonBookings,
  teacherAvailability,
  students,
  profiles,
  teachers,
  courses,
} from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { notifyTelegram, escapeTelegramHtml } from "../lib/notify.js";
import { ensureDefaultSlots } from "../services/scheduling/ensure-default-slots.js";
import { createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from "../services/google-calendar.js";
import { getIsraelToday, isSlotInPastIsrael } from "../lib/time.js";
import { uuidParamSchema } from "../lib/validators.js";

// ── Time helpers ─────────────────────────────────────────────────────────────

function timeToMin(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function formatDurationMin(min: number): string {
  if (min < 60) return `${min}m`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${Math.floor(min / 60)}.5h`;
}

/** Adds `min` minutes to an HH:MM string and returns the result as HH:MM. */
function addMinutes(hhmm: string, min: number): string {
  const total = timeToMin(hhmm) + min;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ── Validation schemas ────────────────────────────────────────────────────────

const bookSchema = z.object({
  availability_id: z.string().uuid(),
  note: z.string().max(500).optional(),
});

/** Atomic batch booking: one or more consecutive slots = one lesson. */
const batchBookSchema = z.object({
  availability_ids: z.array(z.string().uuid()).min(1).max(6),
  note: z.string().max(500).optional(),
});

const respondSchema = z.object({
  status: z.enum(["approved", "rejected", "cancelled"]),
  note: z.string().max(500).optional(),
});

/** Batch status update: approve / reject / cancel a whole consecutive lesson group. */
const batchStatusSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  status: z.enum(["approved", "rejected", "cancelled"]),
  note: z.string().max(500).optional(),
});

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Allowed lesson durations (multiples of one 30-min slot). */
const ALLOWED_DURATIONS = [60, 90, 120, 150, 180] as const;
type LessonDuration = (typeof ALLOWED_DURATIONS)[number];
const durationSchema = z.union([
  z.literal(60), z.literal(90), z.literal(120), z.literal(150), z.literal(180),
]);

/** Teacher creates an approved lesson directly for one of their students. */
const teacherLessonCreateSchema = z.object({
  student_id:        z.string().uuid(),
  date:              z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time:        z.string().regex(/^\d{2}:\d{2}$/),
  duration_minutes:  durationSchema,
  note:              z.string().max(500).optional(),
});

/** Teacher edits the date / time / duration of an existing lesson group. */
const teacherLessonEditSchema = z.object({
  booking_ids:       z.array(z.string().uuid()).min(1).max(6),
  date:              z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time:        z.string().regex(/^\d{2}:\d{2}$/),
  duration_minutes:  durationSchema,
  note:              z.string().max(500).optional(),
});

export const bookingRoutes = new Hono()
  .use(authMiddleware)

  // ── Student: get teacher's available slots (per-date, future only, not yet taken)
  .get(
    "/available-slots",
    requireRole("student"),
    zValidator("query", rangeSchema),
    async (c) => {
      const studentId = c.get("userId");
      const { from, to } = c.req.valid("query");

      const [student] = await db
        .select({ teacher_id: students.teacher_id })
        .from(students)
        .where(eq(students.id, studentId))
        .limit(1);

      if (!student) return c.json({ error: "Student not found" }, 404);

      // Lazily backfill the teacher's default slots so the student always has
      // a populated calendar even if the teacher hasn't visited the schedule
      // page recently.
      await ensureDefaultSlots(student.teacher_id);

      const today = getIsraelToday();
      const conds = [
        eq(teacherAvailability.teacher_id, student.teacher_id),
        eq(teacherAvailability.is_active, true),
        isNotNull(teacherAvailability.date),
        gte(teacherAvailability.date, from && from > today ? from : today),
      ];
      if (to) conds.push(lte(teacherAvailability.date, to));

      const slots = await db
        .select()
        .from(teacherAvailability)
        .where(and(...conds))
        .orderBy(teacherAvailability.date, teacherAvailability.start_time);

      if (slots.length === 0) return c.json([]);

      // Hide slots already taken (approved, pending, or pending-cancellation)
      const slotIds = slots.map((s) => s.id);
      const takenRows = await db
        .select({ availability_id: lessonBookings.availability_id })
        .from(lessonBookings)
        .where(
          and(
            inArray(lessonBookings.availability_id, slotIds),
            inArray(lessonBookings.status, [
              "approved",
              "pending",
              "cancel_requested",
            ])
          )
        );
      const taken = new Set(takenRows.map((r) => r.availability_id));

      // Also hide today's slots whose start_time has already passed in Israel
      // time — otherwise a student loading the page at 14:00 still sees an
      // 11:30 slot they can't actually take.
      const visible = slots.filter(
        (s) =>
          !taken.has(s.id) &&
          s.date != null &&
          !isSlotInPastIsrael(s.date, s.start_time)
      );
      return c.json(visible);
    }
  )

  // ── Student: book a lesson on a specific availability slot
  .post("/", requireRole("student"), zValidator("json", bookSchema), async (c) => {
    const studentId = c.get("userId");
    const body = c.req.valid("json");

    const [student] = await db
      .select({ teacher_id: students.teacher_id })
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1);

    if (!student) return c.json({ error: "Student not found" }, 404);

    const [slot] = await db
      .select()
      .from(teacherAvailability)
      .where(
        and(
          eq(teacherAvailability.id, body.availability_id),
          eq(teacherAvailability.teacher_id, student.teacher_id),
          eq(teacherAvailability.is_active, true),
          isNotNull(teacherAvailability.date)
        )
      )
      .limit(1);

    if (!slot || !slot.date) {
      return c.json({ error: "Slot not found" }, 404);
    }

    // Block past — in Israel time. Includes today's already-passed slots.
    if (isSlotInPastIsrael(slot.date, slot.start_time)) {
      return c.json({ error: "This time has already passed" }, 400);
    }

    // Block double-booking on the same slot (any non-final status)
    const [existing] = await db
      .select()
      .from(lessonBookings)
      .where(
        and(
          eq(lessonBookings.availability_id, slot.id),
          inArray(lessonBookings.status, [
            "pending",
            "approved",
            "cancel_requested",
          ])
        )
      )
      .limit(1);

    if (existing) {
      return c.json({ error: "This slot is already taken" }, 409);
    }

    const [booking] = await db
      .insert(lessonBookings)
      .values({
        student_id: studentId,
        teacher_id: student.teacher_id,
        availability_id: slot.id,
        date: slot.date,
        start_time: slot.start_time,
        end_time: slot.end_time,
        student_note: body.note,
      })
      .returning();

    // Telegram: notify the teacher of the new booking request.
    // The frontend fires N parallel POSTs for N consecutive hours. We coalesce
    // them into ONE merged ping like "14:00–17:00 · 3h" by:
    //   1. Wait 700ms inside the request so parallel siblings all commit.
    //   2. Read all pending bookings by this student on this date created in
    //      the last 10s, sort by start_time, find the consecutive group that
    //      contains this booking.
    //   3. Only the head of the group (earliest start_time) sends the ping.
    //
    // This must run BEFORE c.json() — Vercel freezes the function immediately
    // after the response is sent, so deferred async work gets killed.
    await new Promise((r) => setTimeout(r, 700));

    const recentCutoff = new Date(Date.now() - 10_000);
    const recent = await db
      .select({
        id: lessonBookings.id,
        start_time: lessonBookings.start_time,
        end_time: lessonBookings.end_time,
      })
      .from(lessonBookings)
      .where(
        and(
          eq(lessonBookings.student_id, studentId),
          eq(lessonBookings.date, slot.date),
          eq(lessonBookings.status, "pending"),
          gte(lessonBookings.created_at, recentCutoff)
        )
      )
      .orderBy(lessonBookings.start_time);

    const idx = recent.findIndex((r) => r.id === booking!.id);
    if (idx !== -1) {
      let lo = idx;
      let hi = idx;
      while (lo > 0 && recent[lo - 1]!.end_time === recent[lo]!.start_time) lo--;
      while (
        hi < recent.length - 1 &&
        recent[hi]!.end_time === recent[hi + 1]!.start_time
      )
        hi++;

      // Head-of-group rule guarantees exactly one notification per group.
      if (recent[lo]!.id === booking!.id) {
        const groupStart = recent[lo]!.start_time;
        const groupEnd = recent[hi]!.end_time;
        const hours = hi - lo + 1;

        void (async () => {
          const [studentRow] = await db
            .select({ name: profiles.full_name })
            .from(profiles)
            .where(eq(profiles.id, studentId))
            .limit(1);
          const studentName = studentRow?.name ?? "Student";
          const noteLine = body.note
            ? `\n📝 ${escapeTelegramHtml(body.note)}`
            : "";
          const durationLabel = hours > 1 ? ` · ${hours}h` : "";
          await notifyTelegram(
            `📅 <b>New lesson request</b>\n${escapeTelegramHtml(studentName)} · ${slot.date} · ${groupStart}–${groupEnd}${durationLabel}${noteLine}`
          );
        })();
      }
    }

    return c.json(booking, 201);
  })

  // ── Student: my bookings
  .get("/my", requireRole("student"), async (c) => {
    const studentId = c.get("userId");
    const bookings = await db
      .select()
      .from(lessonBookings)
      .where(eq(lessonBookings.student_id, studentId))
      .orderBy(desc(lessonBookings.date));
    return c.json(bookings);
  })

  // ── Teacher: all booking requests
  .get("/requests", requireRole("teacher"), async (c) => {
    const teacherId = c.get("userId");
    const bookings = await db
      .select({
        id: lessonBookings.id,
        date: lessonBookings.date,
        start_time: lessonBookings.start_time,
        end_time: lessonBookings.end_time,
        status: lessonBookings.status,
        student_note: lessonBookings.student_note,
        teacher_note: lessonBookings.teacher_note,
        attendance: lessonBookings.attendance,
        created_at: lessonBookings.created_at,
        student_name: profiles.full_name,
        student_id: lessonBookings.student_id,
      })
      .from(lessonBookings)
      .innerJoin(profiles, eq(profiles.id, lessonBookings.student_id))
      .where(eq(lessonBookings.teacher_id, teacherId))
      .orderBy(desc(lessonBookings.created_at));
    return c.json(bookings);
  })

  // ── Teacher: mark whether a lesson actually took place
  // Pass attendance: null to unset.
  .patch(
    "/:id/attendance",
    requireRole("teacher"),
    zValidator("param", uuidParamSchema),
    zValidator(
      "json",
      z.object({
        attendance: z.enum(["attended", "no_show"]).nullable(),
      })
    ),
    async (c) => {
      const teacherId = c.get("userId");
      const bookingId = c.req.valid("param").id;
      const { attendance } = c.req.valid("json");

      const [updated] = await db
        .update(lessonBookings)
        .set({ attendance, updated_at: new Date() })
        .where(
          and(
            eq(lessonBookings.id, bookingId),
            eq(lessonBookings.teacher_id, teacherId),
            // Only approved (or cancel_requested, since the lesson did happen
            // before the cancel request was raised) lessons can be marked.
            inArray(lessonBookings.status, ["approved", "cancel_requested"])
          )
        )
        .returning();

      if (!updated) {
        return c.json({ error: "Booking not found or not markable" }, 404);
      }
      return c.json(updated);
    }
  )

  // ── Teacher: count of items needing teacher action (badge)
  // Counts lesson GROUPS, not individual 30-min slots.
  // A row is a "group head" when no sibling has end_time === this row's
  // start_time (same student, date, status) — i.e. nothing feeds into it.
  .get("/requests/count", requireRole("teacher"), async (c) => {
    const teacherId = c.get("userId");
    const rows = await db
      .select({
        student_id: lessonBookings.student_id,
        date: lessonBookings.date,
        start_time: lessonBookings.start_time,
        end_time: lessonBookings.end_time,
        status: lessonBookings.status,
      })
      .from(lessonBookings)
      .where(
        and(
          eq(lessonBookings.teacher_id, teacherId),
          inArray(lessonBookings.status, ["pending", "cancel_requested"])
        )
      );

    const prevEnds = new Set(
      rows.map((r) => `${r.student_id}|${r.date}|${r.status}|${r.end_time}`)
    );
    const groupCount = rows.filter(
      (r) =>
        !prevEnds.has(`${r.student_id}|${r.date}|${r.status}|${r.start_time}`)
    ).length;

    return c.json({ count: groupCount });
  })

  // ── Student: book multiple consecutive slots as one atomic lesson ─────────
  // Validates: all slots found, same date, consecutive (no gaps), all free.
  // Creates all booking rows and sends ONE Telegram notification.
  .post("/batch", requireRole("student"), zValidator("json", batchBookSchema), async (c) => {
    const studentId = c.get("userId");
    const { availability_ids, note } = c.req.valid("json");

    const [student] = await db
      .select({ teacher_id: students.teacher_id })
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1);

    if (!student) return c.json({ error: "Student not found" }, 404);

    const slots = await db
      .select()
      .from(teacherAvailability)
      .where(
        and(
          inArray(teacherAvailability.id, availability_ids),
          eq(teacherAvailability.teacher_id, student.teacher_id),
          eq(teacherAvailability.is_active, true),
          isNotNull(teacherAvailability.date)
        )
      );

    if (slots.length !== availability_ids.length) {
      return c.json({ error: "One or more slots not found" }, 404);
    }

    const sorted = [...slots].sort((a, b) =>
      a.start_time.localeCompare(b.start_time)
    );
    const date = sorted[0]!.date!;

    if (!sorted.every((s) => s.date === date)) {
      return c.json({ error: "All slots must be on the same date" }, 400);
    }

    if (isSlotInPastIsrael(date, sorted[0]!.start_time)) {
      return c.json({ error: "This time has already passed" }, 400);
    }

    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i]!.end_time !== sorted[i + 1]!.start_time) {
        return c.json({ error: "Slots must be consecutive with no gaps" }, 400);
      }
    }

    const slotIds = sorted.map((s) => s.id);
    const takenRows = await db
      .select({ availability_id: lessonBookings.availability_id })
      .from(lessonBookings)
      .where(
        and(
          inArray(lessonBookings.availability_id, slotIds),
          inArray(lessonBookings.status, ["approved", "pending", "cancel_requested"])
        )
      );

    if (takenRows.length > 0) {
      return c.json({ error: "One or more slots are already taken" }, 409);
    }

    const created = await db
      .insert(lessonBookings)
      .values(
        sorted.map((slot) => ({
          student_id: studentId,
          teacher_id: student.teacher_id,
          availability_id: slot.id,
          date: slot.date!,
          start_time: slot.start_time,
          end_time: slot.end_time,
          student_note: note ?? null,
        }))
      )
      .returning();

    // ONE Telegram notification for the whole lesson
    const groupStart = sorted[0]!.start_time;
    const groupEnd = sorted[sorted.length - 1]!.end_time;
    const totalMin = timeToMin(groupEnd) - timeToMin(groupStart);

    void (async () => {
      const [studentRow] = await db
        .select({ name: profiles.full_name })
        .from(profiles)
        .where(eq(profiles.id, studentId))
        .limit(1);
      const studentName = studentRow?.name ?? "Student";
      const noteLine = note ? `\n📝 ${escapeTelegramHtml(note)}` : "";
      await notifyTelegram(
        `📅 <b>New lesson request</b>\n${escapeTelegramHtml(studentName)} · ${date} · ${groupStart}–${groupEnd} · ${formatDurationMin(totalMin)}${noteLine}`
      );
    })();

    return c.json(created, 201);
  })

  // ── Teacher: batch approve / reject / cancel for a whole consecutive lesson ─
  // Acts on every booking row in the group atomically.
  // On approval: creates ONE Google Calendar event spanning the full lesson.
  // On cancellation: deletes the shared gcal event and sends ONE Telegram ping.
  // Must be defined BEFORE /:id to avoid wildcard matching on "batch-status".
  .patch(
    "/batch-status",
    requireRole("teacher"),
    zValidator("json", batchStatusSchema),
    async (c) => {
      const teacherId = c.get("userId");
      const { ids, status, note } = c.req.valid("json");

      const bookings = await db
        .select()
        .from(lessonBookings)
        .where(
          and(
            inArray(lessonBookings.id, ids),
            eq(lessonBookings.teacher_id, teacherId)
          )
        );

      if (bookings.length !== ids.length) {
        return c.json({ error: "One or more bookings not found" }, 404);
      }

      const allowedFromStatuses: ("pending" | "approved" | "cancel_requested")[] =
        status === "cancelled"
          ? ["pending", "approved", "cancel_requested"]
          : status === "approved"
            ? ["pending", "cancel_requested"]
            : ["pending"];

      const allTransitionable = bookings.every((b) =>
        (allowedFromStatuses as string[]).includes(b.status)
      );
      if (!allTransitionable) {
        return c.json(
          { error: "One or more bookings are not in a transitionable state" },
          409
        );
      }

      const updated = await db
        .update(lessonBookings)
        .set({ status, teacher_note: note ?? null, updated_at: new Date() })
        .where(inArray(lessonBookings.id, ids))
        .returning();

      const sorted = [...updated].sort((a, b) =>
        a.start_time.localeCompare(b.start_time)
      );

      if (status === "approved") {
        // Create ONE gcal event spanning the full lesson.
        // Wrapped in try/catch: a gcal failure must never roll back the approval.
        try {
          const lessonStart = sorted[0]!.start_time;
          const lessonEnd = sorted[sorted.length - 1]!.end_time;
          const studentId = sorted[0]!.student_id;

          // Look up course name (students.primary_course_id → courses.name)
          // and teacher name for the event title/description.
          const [courseRow] = await db
            .select({ course_name: courses.name })
            .from(students)
            .leftJoin(courses, eq(students.primary_course_id, courses.id))
            .where(eq(students.id, studentId))
            .limit(1);

          const [teacherRow] = await db
            .select({ teacher_name: profiles.full_name })
            .from(profiles)
            .where(eq(profiles.id, teacherId))
            .limit(1);

          const eventId = await createCalendarEvent({
            date: sorted[0]!.date ?? "",
            start_time: lessonStart,
            end_time: lessonEnd,
            student_id: studentId,
            teacher_id: teacherId,
            ...(courseRow?.course_name ? { course_name: courseRow.course_name } : {}),
            ...(teacherRow?.teacher_name ? { teacher_name: teacherRow.teacher_name } : {}),
          });
          if (eventId) {
            await db
              .update(lessonBookings)
              .set({ gcal_event_id: eventId })
              .where(inArray(lessonBookings.id, ids));
          }
        } catch (err) {
          console.error("[batch-status] gcal event creation failed (booking approved):", err);
        }
      }

      if (status === "cancelled") {
        const gcalId = updated.find((b) => b.gcal_event_id)?.gcal_event_id;
        if (gcalId) {
          void deleteCalendarEvent(teacherId, gcalId);
        }

        void (async () => {
          const [studentRow] = await db
            .select({ name: profiles.full_name })
            .from(profiles)
            .where(eq(profiles.id, sorted[0]!.student_id))
            .limit(1);
          const studentName = studentRow?.name ?? "Student";
          const totalMin =
            timeToMin(sorted[sorted.length - 1]!.end_time) -
            timeToMin(sorted[0]!.start_time);
          await notifyTelegram(
            `🚫 <b>Lesson cancelled by you</b>\n${escapeTelegramHtml(studentName)} · ${sorted[0]!.date} · ${sorted[0]!.start_time}–${sorted[sorted.length - 1]!.end_time} · ${formatDurationMin(totalMin)}`
          );
        })();
      }

      return c.json(updated);
    }
  )

  // ── Teacher: create an approved lesson for a student ────────────────────────
  // Teacher-initiated lessons bypass the availability slot system (availability_id=null)
  // and are inserted directly as "approved" — no pending → approval step needed.
  // ONE Google Calendar event is created immediately and its ID is stored on every slot.
  // Must be defined BEFORE /:id to prevent the UUID-param wildcard from matching first.
  .post(
    "/teacher-lesson",
    requireRole("teacher"),
    zValidator("json", teacherLessonCreateSchema),
    async (c) => {
      const teacherId = c.get("userId");
      const { student_id, date, start_time, duration_minutes, note } = c.req.valid("json");

      // start_time must land on an exact half-hour boundary (HH:00 or HH:30)
      if (timeToMin(start_time) % 30 !== 0) {
        return c.json(
          { error: "start_time must be on the hour or half-hour (HH:00 or HH:30)" },
          400
        );
      }

      // Student must belong to this teacher
      const [student] = await db
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.id, student_id), eq(students.teacher_id, teacherId)))
        .limit(1);
      if (!student) {
        return c.json({ error: "Student not found or does not belong to you" }, 404);
      }

      // Build slot list: one 30-min slot per increment
      const slotCount = duration_minutes / 30;
      const slotTimes: { start_time: string; end_time: string }[] = [];
      for (let i = 0; i < slotCount; i++) {
        slotTimes.push({
          start_time: addMinutes(start_time, i * 30),
          end_time:   addMinutes(start_time, (i + 1) * 30),
        });
      }
      const lessonEnd = slotTimes[slotTimes.length - 1]!.end_time;

      // No overlapping active booking for the teacher
      const [teacherConflict] = await db
        .select({ id: lessonBookings.id })
        .from(lessonBookings)
        .where(
          and(
            eq(lessonBookings.teacher_id, teacherId),
            eq(lessonBookings.date, date),
            inArray(lessonBookings.status, ["approved", "pending", "cancel_requested"]),
            lt(lessonBookings.start_time, lessonEnd),
            gt(lessonBookings.end_time, start_time)
          )
        )
        .limit(1);
      if (teacherConflict) {
        return c.json({ error: "Teacher has a conflicting booking at this time" }, 409);
      }

      // No overlapping active booking for the student
      const [studentConflict] = await db
        .select({ id: lessonBookings.id })
        .from(lessonBookings)
        .where(
          and(
            eq(lessonBookings.student_id, student_id),
            eq(lessonBookings.date, date),
            inArray(lessonBookings.status, ["approved", "pending", "cancel_requested"]),
            lt(lessonBookings.start_time, lessonEnd),
            gt(lessonBookings.end_time, start_time)
          )
        )
        .limit(1);
      if (studentConflict) {
        return c.json({ error: "Student has a conflicting booking at this time" }, 409);
      }

      // Insert all slots as approved
      const created = await db
        .insert(lessonBookings)
        .values(
          slotTimes.map((s) => ({
            student_id,
            teacher_id:       teacherId,
            availability_id:  null,
            date,
            start_time:       s.start_time,
            end_time:         s.end_time,
            status:           "approved" as const,
            teacher_note:     note ?? null,
          }))
        )
        .returning();

      const createdIds = created.map((b) => b.id);

      // Create ONE GCal event for the full span.
      // A gcal failure must never roll back the already-committed booking.
      try {
        const [courseRow] = await db
          .select({ course_name: courses.name })
          .from(students)
          .leftJoin(courses, eq(students.primary_course_id, courses.id))
          .where(eq(students.id, student_id))
          .limit(1);

        const [teacherRow] = await db
          .select({ teacher_name: profiles.full_name })
          .from(profiles)
          .where(eq(profiles.id, teacherId))
          .limit(1);

        const eventId = await createCalendarEvent({
          date,
          start_time,
          end_time:    lessonEnd,
          student_id,
          teacher_id:  teacherId,
          ...(courseRow?.course_name    ? { course_name:   courseRow.course_name    } : {}),
          ...(teacherRow?.teacher_name  ? { teacher_name:  teacherRow.teacher_name  } : {}),
        });

        if (eventId) {
          await db
            .update(lessonBookings)
            .set({ gcal_event_id: eventId, updated_at: new Date() })
            .where(inArray(lessonBookings.id, createdIds));
          created.forEach((b) => { b.gcal_event_id = eventId; });
        }
      } catch (err) {
        console.error("[teacher-lesson POST] GCal event creation failed:", err);
      }

      return c.json(created, 201);
    }
  )

  // ── Teacher: edit an existing lesson (date, time, or duration) ────────────
  // Identifies the lesson by the array of booking IDs that make up the group.
  //
  // Slot-count unchanged  → update rows in-place (preserves attendance marks).
  // Slot-count changed    → delete old rows, insert new ones.
  //   gcal_event_id is carried forward to the new rows so no duplicate event
  //   is ever created.
  //
  // GCal sync:
  //   existing gcal_event_id → PATCH the event (updateCalendarEvent) — no new event.
  //   no gcal_event_id       → createCalendarEvent and save ID on all slots.
  .patch(
    "/teacher-lesson",
    requireRole("teacher"),
    zValidator("json", teacherLessonEditSchema),
    async (c) => {
      const teacherId = c.get("userId");
      const { booking_ids, date, start_time, duration_minutes, note } = c.req.valid("json");

      if (timeToMin(start_time) % 30 !== 0) {
        return c.json(
          { error: "start_time must be on the hour or half-hour (HH:00 or HH:30)" },
          400
        );
      }

      // Fetch + ownership check
      const existing = await db
        .select()
        .from(lessonBookings)
        .where(
          and(
            inArray(lessonBookings.id, booking_ids),
            eq(lessonBookings.teacher_id, teacherId)
          )
        );

      if (existing.length !== booking_ids.length) {
        return c.json({ error: "One or more bookings not found" }, 404);
      }

      // Block edit when student has raised a cancellation request
      if (existing.some((b) => b.status === "cancel_requested")) {
        return c.json(
          { error: "Cannot edit a lesson with a pending cancellation request" },
          409
        );
      }

      const studentId     = existing[0]!.student_id;
      const existingGcalId = existing.find((b) => b.gcal_event_id)?.gcal_event_id ?? null;

      // Build new slot list
      const slotCount = duration_minutes / 30;
      const newSlotTimes: { start_time: string; end_time: string }[] = [];
      for (let i = 0; i < slotCount; i++) {
        newSlotTimes.push({
          start_time: addMinutes(start_time, i * 30),
          end_time:   addMinutes(start_time, (i + 1) * 30),
        });
      }
      const lessonEnd = newSlotTimes[newSlotTimes.length - 1]!.end_time;

      // Conflict checks — exclude the slots being replaced
      const [teacherConflict] = await db
        .select({ id: lessonBookings.id })
        .from(lessonBookings)
        .where(
          and(
            eq(lessonBookings.teacher_id, teacherId),
            eq(lessonBookings.date, date),
            inArray(lessonBookings.status, ["approved", "pending", "cancel_requested"]),
            notInArray(lessonBookings.id, booking_ids),
            lt(lessonBookings.start_time, lessonEnd),
            gt(lessonBookings.end_time, start_time)
          )
        )
        .limit(1);
      if (teacherConflict) {
        return c.json({ error: "Teacher has a conflicting booking at this time" }, 409);
      }

      const [studentConflict] = await db
        .select({ id: lessonBookings.id })
        .from(lessonBookings)
        .where(
          and(
            eq(lessonBookings.student_id, studentId),
            eq(lessonBookings.date, date),
            inArray(lessonBookings.status, ["approved", "pending", "cancel_requested"]),
            notInArray(lessonBookings.id, booking_ids),
            lt(lessonBookings.start_time, lessonEnd),
            gt(lessonBookings.end_time, start_time)
          )
        )
        .limit(1);
      if (studentConflict) {
        return c.json({ error: "Student has a conflicting booking at this time" }, 409);
      }

      // ── DB update ─────────────────────────────────────────────────────────
      let finalIds: string[];

      const sortedExisting = [...existing].sort((a, b) =>
        a.start_time.localeCompare(b.start_time)
      );

      if (sortedExisting.length === slotCount) {
        // Same count: update each slot in-place (preserves attendance / IDs)
        for (let i = 0; i < sortedExisting.length; i++) {
          await db
            .update(lessonBookings)
            .set({
              date,
              start_time:   newSlotTimes[i]!.start_time,
              end_time:     newSlotTimes[i]!.end_time,
              teacher_note: note ?? null,
              updated_at:   new Date(),
            })
            .where(eq(lessonBookings.id, sortedExisting[i]!.id));
        }
        finalIds = sortedExisting.map((b) => b.id);
      } else {
        // Different count: delete old rows, insert new ones.
        // gcal_event_id is carried forward — no duplicate event will be created.
        await db.delete(lessonBookings).where(inArray(lessonBookings.id, booking_ids));

        const inserted = await db
          .insert(lessonBookings)
          .values(
            newSlotTimes.map((s) => ({
              student_id:      studentId,
              teacher_id:      teacherId,
              availability_id: null,
              date,
              start_time:      s.start_time,
              end_time:        s.end_time,
              status:          "approved" as const,
              teacher_note:    note ?? null,
              gcal_event_id:   existingGcalId,
            }))
          )
          .returning();

        finalIds = inserted.map((b) => b.id);
      }

      // ── GCal sync ──────────────────────────────────────────────────────────
      try {
        const [courseRow] = await db
          .select({ course_name: courses.name })
          .from(students)
          .leftJoin(courses, eq(students.primary_course_id, courses.id))
          .where(eq(students.id, studentId))
          .limit(1);

        const [teacherRow] = await db
          .select({ teacher_name: profiles.full_name })
          .from(profiles)
          .where(eq(profiles.id, teacherId))
          .limit(1);

        if (existingGcalId) {
          // Existing event → patch span + title. Never create a duplicate.
          const courseName  = courseRow?.course_name ?? "";
          const teacherName = (teacherRow?.teacher_name ?? "").replace(/\s+/g, " ").trim();
          const teacherFirst = teacherName.split(" ")[0] ?? teacherName;

          const [studentProfile] = await db
            .select({ full_name: profiles.full_name })
            .from(profiles)
            .where(eq(profiles.id, studentId))
            .limit(1);
          const studentName = (studentProfile?.full_name ?? "").replace(/\s+/g, " ").trim();

          let summary = "שיעור פרטי";
          if (courseName && studentName) summary = `שיעור פרטי - ${courseName} - ${studentName}`;
          else if (courseName)           summary = `שיעור פרטי - ${courseName}`;
          else if (studentName)          summary = `שיעור פרטי - ${studentName}`;

          const descLines: string[] = [];
          if (studentName)  descLines.push(`סטודנט: ${studentName}`);
          descLines.push(`מורה: ${teacherFirst}`);
          if (courseName)   descLines.push(`קורס: ${courseName}`);
          descLines.push(`זמן שיעור: ${start_time}–${lessonEnd}`);

          await updateCalendarEvent(teacherId, existingGcalId, {
            summary,
            description: descLines.join("\n"),
            date,
            start_time,
            end_time: lessonEnd,
          });
        } else {
          // No event yet → create one and persist on all final slots
          const eventId = await createCalendarEvent({
            date,
            start_time,
            end_time:   lessonEnd,
            student_id: studentId,
            teacher_id: teacherId,
            ...(courseRow?.course_name   ? { course_name:  courseRow.course_name   } : {}),
            ...(teacherRow?.teacher_name ? { teacher_name: teacherRow.teacher_name } : {}),
          });
          if (eventId) {
            await db
              .update(lessonBookings)
              .set({ gcal_event_id: eventId, updated_at: new Date() })
              .where(inArray(lessonBookings.id, finalIds));
          }
        }
      } catch (err) {
        console.error("[teacher-lesson PATCH] GCal sync failed:", err);
      }

      // Return final state of all slots
      const result = await db
        .select()
        .from(lessonBookings)
        .where(inArray(lessonBookings.id, finalIds));

      return c.json(result);
    }
  )

  // ── Teacher: approve / reject (from pending) or cancel (from pending|approved)
  .patch(
    "/:id",
    requireRole("teacher"),
    zValidator("param", uuidParamSchema),
    zValidator("json", respondSchema),
    async (c) => {
      const teacherId = c.get("userId");
      const bookingId = c.req.valid("param").id;
      const body = c.req.valid("json");

      // Status transition matrix:
      //   approved   ← pending | cancel_requested  (original-approve OR cancel-denial)
      //   rejected   ← pending                     (deny original request)
      //   cancelled  ← pending | approved | cancel_requested  (teacher cancels OR confirms cancel)
      const allowedFromStatuses: (
        | "pending"
        | "approved"
        | "cancel_requested"
      )[] =
        body.status === "cancelled"
          ? ["pending", "approved", "cancel_requested"]
          : body.status === "approved"
            ? ["pending", "cancel_requested"]
            : ["pending"];

      const [updated] = await db
        .update(lessonBookings)
        .set({
          status: body.status,
          teacher_note: body.note,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(lessonBookings.id, bookingId),
            eq(lessonBookings.teacher_id, teacherId),
            inArray(lessonBookings.status, allowedFromStatuses)
          )
        )
        .returning();

      if (!updated) {
        return c.json({ error: "Booking not found or already handled" }, 404);
      }

      // When booking is approved, create a Google Calendar event and store its ID.
      // Silently skipped if the teacher hasn't connected Google Calendar.
      if (body.status === "approved") {
        void (async () => {
          // Look up course name and teacher name for the event title/description.
          const [courseRow] = await db
            .select({ course_name: courses.name })
            .from(students)
            .leftJoin(courses, eq(students.primary_course_id, courses.id))
            .where(eq(students.id, updated.student_id))
            .limit(1);

          const [teacherRow] = await db
            .select({ teacher_name: profiles.full_name })
            .from(profiles)
            .where(eq(profiles.id, teacherId))
            .limit(1);

          const eventId = await createCalendarEvent({
            date: updated.date,
            start_time: updated.start_time,
            end_time: updated.end_time,
            student_id: updated.student_id,
            teacher_id: teacherId,
            ...(courseRow?.course_name ? { course_name: courseRow.course_name } : {}),
            ...(teacherRow?.teacher_name ? { teacher_name: teacherRow.teacher_name } : {}),
          });
          if (eventId) {
            await db
              .update(lessonBookings)
              .set({ gcal_event_id: eventId })
              .where(eq(lessonBookings.id, updated.id));
          }
        })();
      }

      // When booking is cancelled, delete the Google Calendar event if one exists.
      if (body.status === "cancelled" && updated.gcal_event_id) {
        void deleteCalendarEvent(teacherId, updated.gcal_event_id);
      }

      // Telegram log when the teacher cancels — confirms the action was
      // applied. (No SMS to the student; if needed, we can add a separate
      // notify hook later.)
      if (body.status === "cancelled") {
        void (async () => {
          const [studentRow] = await db
            .select({ name: profiles.full_name })
            .from(profiles)
            .where(eq(profiles.id, updated.student_id))
            .limit(1);
          const studentName = studentRow?.name ?? "Student";
          await notifyTelegram(
            `🚫 <b>Lesson cancelled by you</b>\n${escapeTelegramHtml(
              studentName
            )} · ${updated.date} · ${updated.start_time}–${updated.end_time}`
          );
        })();
      }

      return c.json(updated);
    }
  )

  // ── Student: batch cancel a whole consecutive lesson group
  // Sends ONE Telegram notification for the full lesson span, never per-slot.
  // Pending  → cancelled outright   (safe to free the slot immediately)
  // Approved → cancel_requested     (teacher must confirm before slot frees)
  // Already-cancel_requested slots are silently skipped (idempotent).
  // Must be defined BEFORE /:id to avoid wildcard matching on "batch-cancel".
  .post(
    "/batch-cancel",
    requireRole("student"),
    zValidator("json", z.object({ ids: z.array(z.string().uuid()).min(1) })),
    async (c) => {
      const studentId = c.get("userId");
      const { ids } = c.req.valid("json");

      const rows = await db
        .select()
        .from(lessonBookings)
        .where(
          and(
            inArray(lessonBookings.id, ids),
            eq(lessonBookings.student_id, studentId)
          )
        );

      if (rows.length !== ids.length) {
        return c.json({ error: "One or more bookings not found" }, 404);
      }

      // Sort for consistent span display in notifications.
      const sorted = [...rows].sort((a, b) =>
        a.start_time.localeCompare(b.start_time)
      );
      const lessonStart = sorted[0]!.start_time;
      const lessonEnd = sorted[sorted.length - 1]!.end_time;
      const date = sorted[0]!.date ?? "";

      const pendingIds = rows
        .filter((b) => b.status === "pending")
        .map((b) => b.id);
      const approvedIds = rows
        .filter((b) => b.status === "approved")
        .map((b) => b.id);

      if (pendingIds.length === 0 && approvedIds.length === 0) {
        return c.json({ message: "Nothing to cancel" });
      }

      const [studentRow] = await db
        .select({ name: profiles.full_name })
        .from(profiles)
        .where(eq(profiles.id, studentId))
        .limit(1);
      const studentName = studentRow?.name ?? "Student";

      if (pendingIds.length > 0) {
        await db
          .update(lessonBookings)
          .set({ status: "cancelled", updated_at: new Date() })
          .where(inArray(lessonBookings.id, pendingIds));

        void notifyTelegram(
          `❌ <b>Booking cancelled</b>\n${escapeTelegramHtml(studentName)} · ${date} · ${lessonStart}–${lessonEnd}`
        );
      }

      if (approvedIds.length > 0) {
        await db
          .update(lessonBookings)
          .set({ status: "cancel_requested", updated_at: new Date() })
          .where(inArray(lessonBookings.id, approvedIds));

        void notifyTelegram(
          `⚠️ <b>Cancellation requested</b>\n${escapeTelegramHtml(studentName)} wants to cancel ${date} · ${lessonStart}–${lessonEnd}`
        );
      }

      return c.json({ message: "Cancellation processed" });
    }
  )

  // ── Student: cancel a single booking slot (kept for backwards compatibility)
  // Pending  → cancelled outright (it was never approved, no harm)
  // Approved → cancel_requested (teacher must confirm before the slot frees)
  // cancel_requested → no-op (already pending teacher review)
  .delete("/:id", requireRole("student"), zValidator("param", uuidParamSchema), async (c) => {
    const studentId = c.get("userId");
    const bookingId = c.req.valid("param").id;

    // Read current status so we can pick the right next state.
    const [current] = await db
      .select({
        id: lessonBookings.id,
        status: lessonBookings.status,
        date: lessonBookings.date,
        start_time: lessonBookings.start_time,
        end_time: lessonBookings.end_time,
      })
      .from(lessonBookings)
      .where(
        and(
          eq(lessonBookings.id, bookingId),
          eq(lessonBookings.student_id, studentId)
        )
      )
      .limit(1);

    if (!current) {
      return c.json({ error: "Booking not found" }, 404);
    }

    if (current.status === "pending") {
      const [updated] = await db
        .update(lessonBookings)
        .set({ status: "cancelled", updated_at: new Date() })
        .where(eq(lessonBookings.id, bookingId))
        .returning();

      void (async () => {
        const [studentRow] = await db
          .select({ name: profiles.full_name })
          .from(profiles)
          .where(eq(profiles.id, studentId))
          .limit(1);
        const studentName = studentRow?.name ?? "Student";
        await notifyTelegram(
          `❌ <b>Booking cancelled</b>\n${escapeTelegramHtml(studentName)} · ${updated!.date} · ${updated!.start_time}–${updated!.end_time}`
        );
      })();

      return c.json({ message: "Booking cancelled", status: "cancelled" });
    }

    if (current.status === "approved") {
      const [updated] = await db
        .update(lessonBookings)
        .set({ status: "cancel_requested", updated_at: new Date() })
        .where(eq(lessonBookings.id, bookingId))
        .returning();

      // Telegram: tell the teacher this needs their attention.
      void (async () => {
        const [studentRow] = await db
          .select({ name: profiles.full_name })
          .from(profiles)
          .where(eq(profiles.id, studentId))
          .limit(1);
        const studentName = studentRow?.name ?? "Student";
        await notifyTelegram(
          `⚠️ <b>Cancellation requested</b>\n${escapeTelegramHtml(studentName)} wants to cancel ${updated!.date} · ${updated!.start_time}–${updated!.end_time}`
        );
      })();

      return c.json({
        message: "Cancellation requested — pending your teacher's approval",
        status: "cancel_requested",
      });
    }

    return c.json(
      { error: "Booking is not in a cancellable state" },
      409
    );
  });
