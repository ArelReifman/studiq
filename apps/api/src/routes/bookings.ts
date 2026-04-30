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
import { getIsraelToday, isSlotInPastIsrael } from "../lib/time.js";

const bookSchema = z.object({
  availability_id: z.string().uuid(),
  note: z.string().max(500).optional(),
});

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

    // Per-student cap: at most 3 active future bookings (pending / approved /
    // cancel_requested). Past lessons and finalized statuses don't count.
    const today = getIsraelToday();
    const activeBookings = await db
      .select({ id: lessonBookings.id })
      .from(lessonBookings)
      .where(
        and(
          eq(lessonBookings.student_id, studentId),
          gte(lessonBookings.date, today),
          inArray(lessonBookings.status, [
            "pending",
            "approved",
            "cancel_requested",
          ])
        )
      );

    if (activeBookings.length >= 3) {
      return c.json(
        {
          error: "Booking limit reached (max 3 active hours)",
          code: "LIMIT_REACHED",
        },
        409
      );
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

    // Telegram: notify the teacher of the new booking request
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
      await notifyTelegram(
        `📅 <b>New lesson request</b>\n${escapeTelegramHtml(studentName)} · ${slot.date} · ${slot.start_time}–${slot.end_time}${noteLine}`
      );
    })();

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
    zValidator("json", respondSchema),
    async (c) => {
      const teacherId = c.get("userId");
      const bookingId = c.req.param("id")!;
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

  // ── Student: cancel a booking
  // Pending  → cancelled outright (it was never approved, no harm)
  // Approved → cancel_requested (teacher must confirm before the slot frees)
  // cancel_requested → no-op (already pending teacher review)
  .delete("/:id", requireRole("student"), async (c) => {
    const studentId = c.get("userId");
    const bookingId = c.req.param("id")!;

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
