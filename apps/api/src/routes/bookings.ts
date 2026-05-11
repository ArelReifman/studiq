import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc, gte, lte, isNotNull, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  lessonBookings,
  teacherAvailability,
  students,
  profiles,
  teachers,
} from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { notifyTelegram, escapeTelegramHtml } from "../lib/notify.js";
import { ensureDefaultSlots } from "../services/scheduling/ensure-default-slots.js";
import {
  findConsecutiveGroup,
  formatDurationLabel,
} from "../services/scheduling/booking-groups.js";
import { createCalendarEvent, deleteCalendarEvent } from "../services/google-calendar.js";
import { getIsraelToday, isSlotInPastIsrael } from "../lib/time.js";
import { uuidParamSchema } from "../lib/validators.js";

const bookSchema = z
  .object({
    availability_id: z.string().uuid().optional(),
    availability_ids: z.array(z.string().uuid()).optional(),
    note: z.string().max(500).optional(),
  })
  .refine(
    (body) =>
      Boolean(body.availability_id) ||
      (body.availability_ids && body.availability_ids.length > 0),
    {
      message: "availability_id or availability_ids is required",
      path: ["availability_ids"],
    }
  );

const respondSchema = z.object({
  status: z.enum(["approved", "rejected", "cancelled"]),
  note: z.string().max(500).optional(),
});

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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

    const availabilityIds = body.availability_ids?.length
      ? Array.from(new Set(body.availability_ids))
      : body.availability_id
        ? [body.availability_id]
        : [];

    if (availabilityIds.length === 0) {
      return c.json({ error: "availability_id or availability_ids is required" }, 400);
    }

    const slots = await db
      .select()
      .from(teacherAvailability)
      .where(
        and(
          inArray(teacherAvailability.id, availabilityIds),
          eq(teacherAvailability.teacher_id, student.teacher_id),
          eq(teacherAvailability.is_active, true),
          isNotNull(teacherAvailability.date)
        )
      )
      .orderBy(teacherAvailability.date, teacherAvailability.start_time);

    if (slots.length !== availabilityIds.length) {
      return c.json({ error: "One or more slots not found" }, 404);
    }

    const bookingDate = slots[0]?.date;
    if (!bookingDate || slots.some((slot) => slot.date !== bookingDate)) {
      return c.json({ error: "All selected slots must be on the same date" }, 400);
    }

    for (let i = 1; i < slots.length; i++) {
      if (slots[i]!.start_time !== slots[i - 1]!.end_time) {
        return c.json({ error: "Selected slots must be consecutive" }, 400);
      }
    }

    if (slots.some((slot) => isSlotInPastIsrael(slot.date!, slot.start_time))) {
      return c.json({ error: "One or more selected slots are in the past" }, 400);
    }

    const takenRows = await db
      .select({ availability_id: lessonBookings.availability_id })
      .from(lessonBookings)
      .where(
        and(
          inArray(lessonBookings.availability_id, slots.map((slot) => slot.id)),
          inArray(lessonBookings.status, [
            "pending",
            "approved",
            "cancel_requested",
          ])
        )
      );

    if (takenRows.length > 0) {
      return c.json({ error: "One or more selected slots are already taken" }, 409);
    }

    const insertedBookings = await db
      .insert(lessonBookings)
      .values(
        slots.map((slot) => ({
          student_id: studentId,
          teacher_id: student.teacher_id,
          availability_id: slot.id,
          date: slot.date!,
          start_time: slot.start_time,
          end_time: slot.end_time,
          student_note: body.note,
        }))
      )
      .returning();

    const booking = insertedBookings[0];
    if (!booking) {
      return c.json({ error: "Booking creation failed" }, 500);
    }

    const group = await findConsecutiveGroup({
      bookingId: booking.id,
      studentId,
      date: booking.date,
      statuses: ["pending"],
      timeColumn: "created_at",
    });

    if (group?.isHead) {
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
        const durationLabel = ` · ${formatDurationLabel(group.start_time, group.end_time)}`;
        await notifyTelegram(
          `📅 <b>New lesson request</b>\n${escapeTelegramHtml(studentName)} · ${booking.date} · ${group.start_time}–${group.end_time}${durationLabel}${noteLine}`
        );
      })();
    }

    return c.json(insertedBookings, 201);
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
  // Includes both new booking requests AND cancellation requests.
  .get("/requests/count", requireRole("teacher"), async (c) => {
    const teacherId = c.get("userId");
    const rows = await db
      .select({ id: lessonBookings.id })
      .from(lessonBookings)
      .where(
        and(
          eq(lessonBookings.teacher_id, teacherId),
          inArray(lessonBookings.status, ["pending", "cancel_requested"])
        )
      );
    return c.json({ count: rows.length });
  })

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

      // Approve: create ONE Google Calendar event spanning the whole group
      // (e.g. 14:00–16:30 for a 2.5h lesson made of 5 × 30-min slots), and
      // share its event ID across every sibling booking. The frontend approves
      // a group via Promise.all of N PATCHes; we coalesce by head-of-group.
      if (body.status === "approved") {
        const group = await findConsecutiveGroup({
          bookingId: updated.id,
          studentId: updated.student_id,
          date: updated.date,
          statuses: ["approved"],
          timeColumn: "updated_at",
        });

        if (group?.isHead) {
          void (async () => {
            const eventId = await createCalendarEvent({
              date: updated.date,
              start_time: group.start_time,
              end_time: group.end_time,
              student_id: updated.student_id,
              teacher_id: teacherId,
            });
            if (eventId) {
              await db
                .update(lessonBookings)
                .set({ gcal_event_id: eventId })
                .where(inArray(lessonBookings.id, group.ids));
            }
          })();
        }
      }

      // Cancel: delete the shared calendar event once. If siblings reference
      // the same gcal_event_id, the first cancellation wipes it for all —
      // subsequent ones see a null and skip (and the 404 path in
      // deleteCalendarEvent is forgiving anyway).
      if (body.status === "cancelled" && updated.gcal_event_id) {
        const sharedEventId = updated.gcal_event_id;
        void (async () => {
          await deleteCalendarEvent(teacherId, sharedEventId);
          await db
            .update(lessonBookings)
            .set({ gcal_event_id: null })
            .where(eq(lessonBookings.gcal_event_id, sharedEventId));
        })();
      }

      // Telegram log when the teacher cancels — coalesce per consecutive group.
      if (body.status === "cancelled") {
        const group = await findConsecutiveGroup({
          bookingId: updated.id,
          studentId: updated.student_id,
          date: updated.date,
          statuses: ["cancelled"],
          timeColumn: "updated_at",
        });
        if (group?.isHead) {
          void (async () => {
            const [studentRow] = await db
              .select({ name: profiles.full_name })
              .from(profiles)
              .where(eq(profiles.id, updated.student_id))
              .limit(1);
            const studentName = studentRow?.name ?? "Student";
            const durationLabel = ` · ${formatDurationLabel(group.start_time, group.end_time)}`;
            await notifyTelegram(
              `🚫 <b>Lesson cancelled by you</b>\n${escapeTelegramHtml(
                studentName
              )} · ${updated.date} · ${group.start_time}–${group.end_time}${durationLabel}`
            );
          })();
        }
      }

      return c.json(updated);
    }
  )

  // ── Student: cancel a booking
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

      // Coalesce per consecutive group — students cancelling 5 × 30-min slots
      // should send ONE "Booking cancelled" ping, not five.
      const group = await findConsecutiveGroup({
        bookingId: updated!.id,
        studentId,
        date: updated!.date,
        statuses: ["cancelled"],
        timeColumn: "updated_at",
      });

      if (group?.isHead) {
        void (async () => {
          const [studentRow] = await db
            .select({ name: profiles.full_name })
            .from(profiles)
            .where(eq(profiles.id, studentId))
            .limit(1);
          const studentName = studentRow?.name ?? "Student";
          const durationLabel = ` · ${formatDurationLabel(group.start_time, group.end_time)}`;
          await notifyTelegram(
            `❌ <b>Booking cancelled</b>\n${escapeTelegramHtml(studentName)} · ${updated!.date} · ${group.start_time}–${group.end_time}${durationLabel}`
          );
        })();
      }

      return c.json({ message: "Booking cancelled", status: "cancelled" });
    }

    if (current.status === "approved") {
      const [updated] = await db
        .update(lessonBookings)
        .set({ status: "cancel_requested", updated_at: new Date() })
        .where(eq(lessonBookings.id, bookingId))
        .returning();

      // Coalesce per consecutive group — one merged "Cancellation requested".
      const group = await findConsecutiveGroup({
        bookingId: updated!.id,
        studentId,
        date: updated!.date,
        statuses: ["cancel_requested"],
        timeColumn: "updated_at",
      });

      if (group?.isHead) {
        void (async () => {
          const [studentRow] = await db
            .select({ name: profiles.full_name })
            .from(profiles)
            .where(eq(profiles.id, studentId))
            .limit(1);
          const studentName = studentRow?.name ?? "Student";
          const durationLabel = ` · ${formatDurationLabel(group.start_time, group.end_time)}`;
          await notifyTelegram(
            `⚠️ <b>Cancellation requested</b>\n${escapeTelegramHtml(studentName)} wants to cancel ${updated!.date} · ${group.start_time}–${group.end_time}${durationLabel}`
          );
        })();
      }

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
