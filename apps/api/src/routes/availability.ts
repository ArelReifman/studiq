import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, gte, lte, isNotNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { teacherAvailability, lessonBookings } from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { ensureDefaultSlots } from "../services/scheduling/ensure-default-slots.js";
import { getIsraelToday } from "../lib/time.js";
import { uuidParamSchema } from "../lib/validators.js";

const slotSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:mm"),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:mm"),
});

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const availabilityRoutes = new Hono()
  .use(authMiddleware)
  .use(requireRole("teacher"))

  // List per-date slots, optionally filtered by ?from=YYYY-MM-DD&to=YYYY-MM-DD
  .get("/", zValidator("query", rangeSchema), async (c) => {
    const teacherId = c.get("userId");
    const { from, to } = c.req.valid("query");

    // Lazily backfill default Sun–Thu slots for the next 4 weeks.
    await ensureDefaultSlots(teacherId);

    const conds = [
      eq(teacherAvailability.teacher_id, teacherId),
      eq(teacherAvailability.is_active, true),
      isNotNull(teacherAvailability.date),
    ];
    if (from) conds.push(gte(teacherAvailability.date, from));
    if (to) conds.push(lte(teacherAvailability.date, to));

    const slots = await db
      .select()
      .from(teacherAvailability)
      .where(and(...conds))
      .orderBy(teacherAvailability.date, teacherAvailability.start_time);

    return c.json(slots);
  })

  // Add a per-date slot
  .post("/", zValidator("json", slotSchema), async (c) => {
    const teacherId = c.get("userId");
    const body = c.req.valid("json");

    if (body.start_time >= body.end_time) {
      return c.json({ error: "End time must be after start time" }, 400);
    }

    // Block past dates (Israel timezone)
    if (body.date < getIsraelToday()) {
      return c.json({ error: "Cannot create slots in the past" }, 400);
    }

    // Prevent overlapping slot on same date
    const existing = await db
      .select()
      .from(teacherAvailability)
      .where(
        and(
          eq(teacherAvailability.teacher_id, teacherId),
          eq(teacherAvailability.is_active, true),
          eq(teacherAvailability.date, body.date)
        )
      );

    const overlaps = existing.some(
      (s) => s.start_time < body.end_time && s.end_time > body.start_time
    );
    if (overlaps) {
      return c.json({ error: "Slot overlaps an existing one" }, 409);
    }

    const [slot] = await db
      .insert(teacherAvailability)
      .values({
        teacher_id: teacherId,
        date: body.date,
        start_time: body.start_time,
        end_time: body.end_time,
      })
      .returning();

    return c.json(slot, 201);
  })

  // Delete (deactivate) a slot — refuses if slot has an approved booking.
  .delete("/:id", zValidator("param", uuidParamSchema), async (c) => {
    const teacherId = c.get("userId");
    const slotId = c.req.valid("param").id;

    // Block delete if there's an approved booking on this slot
    const [approved] = await db
      .select({ id: lessonBookings.id })
      .from(lessonBookings)
      .where(
        and(
          eq(lessonBookings.availability_id, slotId),
          eq(lessonBookings.status, "approved")
        )
      )
      .limit(1);

    if (approved) {
      return c.json(
        { error: "Cannot delete a slot with an approved booking" },
        409
      );
    }

    // Cancel any pending booking on this slot
    await db
      .update(lessonBookings)
      .set({ status: "cancelled", updated_at: new Date() })
      .where(
        and(
          eq(lessonBookings.availability_id, slotId),
          eq(lessonBookings.status, "pending")
        )
      );

    const [updated] = await db
      .update(teacherAvailability)
      .set({ is_active: false })
      .where(
        and(
          eq(teacherAvailability.id, slotId),
          eq(teacherAvailability.teacher_id, teacherId)
        )
      )
      .returning();

    if (!updated) return c.json({ error: "Slot not found" }, 404);
    return c.json({ message: "Slot removed" });
  });
