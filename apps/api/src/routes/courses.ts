import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { courses, courseTopics, lessonSessions } from "../db/schema.js";
import { sql } from "drizzle-orm";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { uuidParamSchema, courseTopicParamSchema } from "../lib/validators.js";

const courseSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});

const topicSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  is_shared: z.boolean().default(false),
  prerequisite_topic_ids: z.array(z.string().uuid()).default([]),
  order_index: z.number().int().min(0).default(0),
  parent_topic_id: z.string().uuid().nullable().optional(),
  // Manual gate the teacher can toggle from the learning map. Defaults
  // to locked so new topics stay hidden until the teacher unlocks them.
  is_locked: z.boolean().default(true),
});

const topicUpdateSchema = topicSchema.partial();

/** Build a 2-level tree from a flat list of topics */
function buildTree(flat: typeof courseTopics.$inferSelect[]) {
  const parents = flat
    .filter((t) => t.parent_topic_id === null)
    .sort((a, b) => a.order_index - b.order_index);
  return parents.map((p) => ({
    ...p,
    children: flat
      .filter((t) => t.parent_topic_id === p.id)
      .sort((a, b) => a.order_index - b.order_index),
  }));
}

export const coursesRoutes = new Hono()
  .use(authMiddleware)
  .use(requireRole("teacher"))

  // ─── List courses for the teacher ──────────────────────────────────────────
  .get("/", async (c) => {
    const teacherId = c.get("userId")!;
    const rows = await db
      .select()
      .from(courses)
      .where(eq(courses.teacher_id, teacherId))
      .orderBy(asc(courses.created_at));
    return c.json(rows);
  })

  // ─── Create a course ──────────────────────────────────────────────────────
  .post("/", zValidator("json", courseSchema), async (c) => {
    const teacherId = c.get("userId")!;
    const body = c.req.valid("json");
    const [row] = await db
      .insert(courses)
      .values({
        teacher_id: teacherId,
        name: body.name.trim(),
        description: body.description?.trim() || null,
      })
      .returning();
    return c.json(row, 201);
  })

  // ─── Get one course + flat topics ────────────────────────────────────────
  .get("/:id", zValidator("param", uuidParamSchema), async (c) => {
    const teacherId = c.get("userId")!;
    const courseId = c.req.valid("param").id;
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.teacher_id, teacherId)))
      .limit(1);
    if (!course) return c.json({ error: "Course not found" }, 404);

    const topics = await db
      .select()
      .from(courseTopics)
      .where(eq(courseTopics.course_id, courseId))
      .orderBy(asc(courseTopics.order_index), asc(courseTopics.created_at));

    return c.json({ ...course, topics });
  })

  // ─── Get one course as a 2-level tree ─────────────────────────────────────
  .get("/:id/tree", zValidator("param", uuidParamSchema), async (c) => {
    const teacherId = c.get("userId")!;
    const courseId = c.req.valid("param").id;
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.teacher_id, teacherId)))
      .limit(1);
    if (!course) return c.json({ error: "Course not found" }, 404);

    const allTopics = await db
      .select()
      .from(courseTopics)
      .where(eq(courseTopics.course_id, courseId))
      .orderBy(asc(courseTopics.order_index), asc(courseTopics.created_at));

    return c.json({ ...course, topics: buildTree(allTopics) });
  })

  // ─── Update a course ──────────────────────────────────────────────────────
  .patch("/:id", zValidator("param", uuidParamSchema), zValidator("json", courseSchema.partial()), async (c) => {
    const teacherId = c.get("userId")!;
    const courseId = c.req.valid("param").id;
    const body = c.req.valid("json");
    const [updated] = await db
      .update(courses)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined
          ? { description: body.description?.trim() || null }
          : {}),
        updated_at: new Date(),
      })
      .where(and(eq(courses.id, courseId), eq(courses.teacher_id, teacherId)))
      .returning();
    if (!updated) return c.json({ error: "Course not found" }, 404);
    return c.json(updated);
  })

  // ─── Delete a course ──────────────────────────────────────────────────────
  .delete("/:id", zValidator("param", uuidParamSchema), async (c) => {
    const teacherId = c.get("userId")!;
    const courseId = c.req.valid("param").id;
    const [deleted] = await db
      .delete(courses)
      .where(and(eq(courses.id, courseId), eq(courses.teacher_id, teacherId)))
      .returning();
    if (!deleted) return c.json({ error: "Course not found" }, 404);
    return c.json({ message: "Course deleted" });
  })

  // ─── Topics ────────────────────────────────────────────────────────────────
  .post(
    "/:id/topics",
    zValidator("param", uuidParamSchema),
    zValidator("json", topicSchema),
    async (c) => {
      const teacherId = c.get("userId")!;
      const courseId = c.req.valid("param").id;
      // Verify ownership
      const [course] = await db
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.id, courseId), eq(courses.teacher_id, teacherId)))
        .limit(1);
      if (!course) return c.json({ error: "Course not found" }, 404);

      const body = c.req.valid("json");
      const [topic] = await db
        .insert(courseTopics)
        .values({
          course_id: courseId,
          name: body.name.trim(),
          description: body.description?.trim() || null,
          is_shared: body.is_shared,
          prerequisite_topic_ids: body.prerequisite_topic_ids,
          order_index: body.order_index,
          parent_topic_id: body.parent_topic_id ?? null,
        })
        .returning();
      return c.json(topic, 201);
    }
  )

  .patch(
    "/:courseId/topics/:topicId",
    zValidator("param", courseTopicParamSchema),
    zValidator("json", topicUpdateSchema),
    async (c) => {
      const teacherId = c.get("userId")!;
      const { courseId, topicId } = c.req.valid("param");
      // Verify ownership
      const [course] = await db
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.id, courseId), eq(courses.teacher_id, teacherId)))
        .limit(1);
      if (!course) return c.json({ error: "Course not found" }, 404);

      const body = c.req.valid("json");
      const newName = body.name?.trim();

      // Capture the previous topic name before the update so we can
      // rewrite auto-generated lesson titles that started with it. The
      // create-lesson form sets titles as "TopicName — YYYY-MM-DD" by
      // default, so renaming a topic should propagate to every lesson
      // that still uses that prefix.
      const [previous] = newName
        ? await db
            .select({ name: courseTopics.name })
            .from(courseTopics)
            .where(eq(courseTopics.id, topicId))
            .limit(1)
        : [undefined];

      const [updated] = await db
        .update(courseTopics)
        .set({
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.description !== undefined
            ? { description: body.description?.trim() || null }
            : {}),
          ...(body.is_shared !== undefined ? { is_shared: body.is_shared } : {}),
          ...(body.prerequisite_topic_ids !== undefined
            ? { prerequisite_topic_ids: body.prerequisite_topic_ids }
            : {}),
          ...(body.order_index !== undefined
            ? { order_index: body.order_index }
            : {}),
          ...(body.is_locked !== undefined
            ? { is_locked: body.is_locked }
            : {}),
        })
        .where(
          and(
            eq(courseTopics.id, topicId),
            eq(courseTopics.course_id, courseId)
          )
        )
        .returning();
      if (!updated) return c.json({ error: "Topic not found" }, 404);

      // If the name actually changed, rewrite the prefix of any lesson
      // title still using "<oldName> — ". Custom titles the teacher
      // typed by hand are left untouched because they don't match the
      // exact prefix.
      if (newName && previous && previous.name !== newName) {
        const oldPrefix = `${previous.name} — `;
        const newPrefix = `${newName} — `;
        await db
          .update(lessonSessions)
          .set({
            title: sql`${newPrefix} || substring(${lessonSessions.title} from ${oldPrefix.length + 1})`,
          })
          .where(
            and(
              eq(lessonSessions.topic_id, topicId),
              sql`${lessonSessions.title} LIKE ${oldPrefix + "%"}`
            )
          );
      }

      return c.json(updated);
    }
  )

  .delete("/:courseId/topics/:topicId", zValidator("param", courseTopicParamSchema), async (c) => {
    const teacherId = c.get("userId")!;
    const { courseId, topicId } = c.req.valid("param");
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.teacher_id, teacherId)))
      .limit(1);
    if (!course) return c.json({ error: "Course not found" }, 404);

    const [deleted] = await db
      .delete(courseTopics)
      .where(
        and(
          eq(courseTopics.id, topicId),
          eq(courseTopics.course_id, courseId)
        )
      )
      .returning();
    if (!deleted) return c.json({ error: "Topic not found" }, 404);
    return c.json({ message: "Topic deleted" });
  });
