import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  lessonBookings,
  teacherAvailability,
  students,
  profiles,
} from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const bookSchema = z.object({
  availability_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  note: z.string().max(500).optional(),
});

const respondSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().max(500).optional(),
});

export const bookingRoutes = new Hono()
  .use(authMiddleware)

  // ── Student: get teacher's available slots ──
  .get("/available-slots", requireRole("student"), async (c) => {
    const studentId = c.get("userId");

    // Get the student's teacher
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
          eq(teacherAvailability.teacher_id, student.teacher_id),
          eq(teacherAvailability.is_active, true)
        )
      )
      .orderBy(teacherAvailability.day_of_week, teacherAvailability.start_time);

    return c.json(slots);
  })

  // ── Student: book a lesson ──
  .post("/", requireRole("student"), zValidator("json", bookSchema), async (c) => {
    const studentId = c.get("userId");
    const body = c.req.valid("json");

    // Get student's teacher
    const [student] = await db
      .select({ teacher_id: students.teacher_id })
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1);

    if (!student) return c.json({ error: "Student not found" }, 404);

    // Verify the slot exists and belongs to the teacher
    const [slot] = await db
      .select()
      .from(teacherAvailability)
      .where(
        and(
          eq(teacherAvailability.id, body.availability_id),
          eq(teacherAvailability.teacher_id, student.teacher_id),
          eq(teacherAvailability.is_active, true)
        )
      )
      .limit(1);

    if (!slot) return c.json({ error: "Slot not found" }, 404);

    // Check the date is not in the past
    const bookingDate = new Date(body.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (bookingDate < today) {
      return c.json({ error: "Cannot book in the past" }, 400);
    }

    // Verify the date matches the day_of_week of the slot
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const requestedDay = dayNames[bookingDate.getDay()];
    if (requestedDay !== slot.day_of_week) {
      return c.json({ error: "Date does not match the slot's day of week" }, 400);
    }

    // Check no existing booking for same date+time+student
    const [existing] = await db
      .select()
      .from(lessonBookings)
      .where(
        and(
          eq(lessonBookings.date, body.date),
          eq(lessonBookings.start_time, slot.start_time),
          eq(lessonBookings.student_id, studentId)
        )
      )
      .limit(1);

    if (existing && existing.status !== "rejected" && existing.status !== "cancelled") {
      return c.json({ error: "You already have a booking for this slot" }, 409);
    }

    const [booking] = await db
      .insert(lessonBookings)
      .values({
        student_id: studentId,
        teacher_id: student.teacher_id,
        availability_id: body.availability_id,
        date: body.date,
        start_time: slot.start_time,
        end_time: slot.end_time,
        student_note: body.note,
      })
      .returning();

    return c.json(booking, 201);
  })

  // ── Student: my bookings ──
  .get("/my", requireRole("student"), async (c) => {
    const studentId = c.get("userId");

    const bookings = await db
      .select()
      .from(lessonBookings)
      .where(eq(lessonBookings.student_id, studentId))
      .orderBy(desc(lessonBookings.date));

    return c.json(bookings);
  })

  // ── Teacher: all booking requests ──
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

  // ── Teacher: approve or reject a booking ──
  .patch(
    "/:id",
    requireRole("teacher"),
    zValidator("json", respondSchema),
    async (c) => {
      const teacherId = c.get("userId");
      const bookingId = c.req.param("id")!;
      const body = c.req.valid("json");

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
            eq(lessonBookings.status, "pending")
          )
        )
        .returning();

      if (!updated) return c.json({ error: "Booking not found or already handled" }, 404);
      return c.json(updated);
    }
  )

  // ── Student: cancel a booking ──
  .delete("/:id", requireRole("student"), async (c) => {
    const studentId = c.get("userId");
    const bookingId = c.req.param("id")!;

    const [updated] = await db
      .update(lessonBookings)
      .set({ status: "cancelled", updated_at: new Date() })
      .where(
        and(
          eq(lessonBookings.id, bookingId),
          eq(lessonBookings.student_id, studentId),
          eq(lessonBookings.status, "pending")
        )
      )
      .returning();

    if (!updated) return c.json({ error: "Booking not found or cannot be cancelled" }, 404);
    return c.json({ message: "Booking cancelled" });
  });
