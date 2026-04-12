import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { teacherAvailability } from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const slotSchema = z.object({
  day_of_week: z.enum([
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ]),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:mm format"),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:mm format"),
});

export const availabilityRoutes = new Hono()
  .use(authMiddleware)
  .use(requireRole("teacher"))

  // Get all availability slots for the teacher
  .get("/", async (c) => {
    const teacherId = c.get("userId");
    const slots = await db
      .select()
      .from(teacherAvailability)
      .where(
        and(
          eq(teacherAvailability.teacher_id, teacherId),
          eq(teacherAvailability.is_active, true)
        )
      )
      .orderBy(teacherAvailability.day_of_week, teacherAvailability.start_time);

    return c.json(slots);
  })

  // Add a new availability slot
  .post("/", zValidator("json", slotSchema), async (c) => {
    const teacherId = c.get("userId");
    const body = c.req.valid("json");

    if (body.start_time >= body.end_time) {
      return c.json({ error: "End time must be after start time" }, 400);
    }

    const [slot] = await db
      .insert(teacherAvailability)
      .values({
        teacher_id: teacherId,
        day_of_week: body.day_of_week,
        start_time: body.start_time,
        end_time: body.end_time,
      })
      .returning();

    return c.json(slot, 201);
  })

  // Delete (deactivate) a slot
  .delete("/:id", async (c) => {
    const teacherId = c.get("userId");
    const slotId = c.req.param("id");

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
