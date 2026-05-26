import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, or, isNull, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  learningResources,
  students,
  courses,
  courseTopics,
} from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { createAdminSupabase } from "../lib/supabase.js";
import { uuidParamSchema } from "../lib/validators.js";

// Mirrors apps/api/src/routes/upload.ts limits so the new endpoint can't
// sneak in larger/looser uploads than the rest of the system.
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

const listQuerySchema = z.object({
  course_id: z.string().uuid(),
  topic_id: z.string().uuid().optional(),
});

const patchSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).nullable().optional(),
    visibility: z.enum(["teacher_only", "student_visible"]).optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.description !== undefined ||
      v.visibility !== undefined,
    { message: "At least one field is required" }
  );

function safeExt(fileName: string): string {
  const raw = fileName.split(".").pop()?.toLowerCase() ?? "bin";
  return /^[a-z0-9]{1,8}$/.test(raw) ? raw : "bin";
}

export const learningResourcesRoutes = new Hono()
  .use(authMiddleware)

  // ── Teacher: upload a new resource ────────────────────────────────────────
  .post("/", requireRole("teacher"), async (c) => {
    const teacherId = c.get("userId");

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: "Invalid multipart body" }, 400);
    }

    const file = formData.get("file");
    const courseId = formData.get("course_id");
    const topicIdRaw = formData.get("topic_id");
    const title = formData.get("title");
    const description = formData.get("description");
    const visibility = formData.get("visibility");

    if (!file || !(file instanceof File))
      return c.json({ error: "No file provided" }, 400);
    if (typeof courseId !== "string" || !courseId)
      return c.json({ error: "course_id required" }, 400);
    if (typeof title !== "string" || !title.trim())
      return c.json({ error: "title required" }, 400);

    if (file.size > MAX_FILE_SIZE)
      return c.json({ error: "File too large (max 50 MB)" }, 400);
    if (!ALLOWED_TYPES.includes(file.type))
      return c.json(
        { error: "Invalid file type. Allowed: PDF, JPEG, PNG, WebP" },
        400
      );

    const vis =
      visibility === "student_visible" ? "student_visible" : "teacher_only";

    // Ownership: course must belong to this teacher.
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.teacher_id, teacherId)))
      .limit(1);
    if (!course) return c.json({ error: "Course not found" }, 404);

    // Optional topic — must belong to the same course.
    let topicId: string | null = null;
    if (typeof topicIdRaw === "string" && topicIdRaw) {
      const [t] = await db
        .select({ id: courseTopics.id })
        .from(courseTopics)
        .where(
          and(
            eq(courseTopics.id, topicIdRaw),
            eq(courseTopics.course_id, courseId)
          )
        )
        .limit(1);
      if (!t) return c.json({ error: "Topic not found in course" }, 404);
      topicId = t.id;
    }

    // Allocate an id up front so the storage path is unique even before
    // the row is inserted.
    const id = crypto.randomUUID();
    const ext = safeExt(file.name);
    const storagePath = `resources/${teacherId}/${courseId}/${id}.${ext}`;

    const buffer = await file.arrayBuffer();
    const supabase = createAdminSupabase();

    const { error: uploadError } = await supabase.storage
      .from("uploads")
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });
    if (uploadError) {
      console.error("[learning-resources] upload error:", uploadError);
      return c.json({ error: "Failed to upload file" }, 500);
    }

    const { data: urlData } = supabase.storage
      .from("uploads")
      .getPublicUrl(storagePath);
    const fileUrl = urlData.publicUrl;

    try {
      const [row] = await db
        .insert(learningResources)
        .values({
          id,
          teacher_id: teacherId,
          course_id: courseId,
          topic_id: topicId,
          title: title.trim(),
          description:
            typeof description === "string" && description.trim()
              ? description.trim()
              : null,
          file_name: file.name,
          file_url: fileUrl,
          storage_path: storagePath,
          file_type: file.type,
          file_size_bytes: file.size,
          visibility: vis,
        })
        .returning();

      return c.json(row, 201);
    } catch (err) {
      // Rollback the orphan object so a failed insert doesn't leave a
      // dangling file in the bucket (matches upload.ts cleanup pattern).
      await supabase.storage.from("uploads").remove([storagePath]);
      console.error("[learning-resources] insert error:", err);
      return c.json({ error: "Failed to save resource" }, 500);
    }
  })

  // ── Teacher: list own resources by course (optionally filtered by topic) ──
  .get(
    "/",
    requireRole("teacher"),
    zValidator("query", listQuerySchema),
    async (c) => {
      const teacherId = c.get("userId");
      const { course_id, topic_id } = c.req.valid("query");

      const conditions = [
        eq(learningResources.teacher_id, teacherId),
        eq(learningResources.course_id, course_id),
      ];
      if (topic_id) {
        // Course-level (topic_id IS NULL) shows up for any topic query.
        conditions.push(
          or(
            eq(learningResources.topic_id, topic_id),
            isNull(learningResources.topic_id)
          )!
        );
      }

      const rows = await db
        .select()
        .from(learningResources)
        .where(and(...conditions))
        .orderBy(desc(learningResources.created_at));
      return c.json(rows);
    }
  )

  // ── Student: list resources visible to them in a course/topic ─────────────
  .get(
    "/student",
    requireRole("student"),
    zValidator("query", listQuerySchema),
    async (c) => {
      const studentId = c.get("userId");
      const { course_id, topic_id } = c.req.valid("query");

      // Resolve this student's teacher; resources are scoped to teacher+course.
      const [student] = await db
        .select({ teacher_id: students.teacher_id })
        .from(students)
        .where(eq(students.id, studentId))
        .limit(1);
      if (!student) return c.json({ error: "Student not found" }, 404);

      const conditions = [
        eq(learningResources.teacher_id, student.teacher_id),
        eq(learningResources.course_id, course_id),
        eq(learningResources.visibility, "student_visible"),
      ];
      if (topic_id) {
        conditions.push(
          or(
            eq(learningResources.topic_id, topic_id),
            isNull(learningResources.topic_id)
          )!
        );
      }

      const rows = await db
        .select()
        .from(learningResources)
        .where(and(...conditions))
        .orderBy(desc(learningResources.created_at));
      return c.json(rows);
    }
  )

  // ── Teacher: update metadata on an owned resource ─────────────────────────
  .patch(
    "/:id",
    requireRole("teacher"),
    zValidator("param", uuidParamSchema),
    zValidator("json", patchSchema),
    async (c) => {
      const teacherId = c.get("userId");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");

      const patch: Record<string, unknown> = { updated_at: new Date() };
      if (body.title !== undefined) patch["title"] = body.title.trim();
      if (body.description !== undefined)
        patch["description"] =
          body.description === null || body.description.trim() === ""
            ? null
            : body.description.trim();
      if (body.visibility !== undefined) patch["visibility"] = body.visibility;

      const [row] = await db
        .update(learningResources)
        .set(patch)
        .where(
          and(
            eq(learningResources.id, id),
            eq(learningResources.teacher_id, teacherId)
          )
        )
        .returning();

      if (!row) return c.json({ error: "Resource not found" }, 404);
      return c.json(row);
    }
  )

  // ── Teacher: delete an owned resource (record + storage object) ───────────
  .delete(
    "/:id",
    requireRole("teacher"),
    zValidator("param", uuidParamSchema),
    async (c) => {
      const teacherId = c.get("userId");
      const { id } = c.req.valid("param");

      const [row] = await db
        .select()
        .from(learningResources)
        .where(
          and(
            eq(learningResources.id, id),
            eq(learningResources.teacher_id, teacherId)
          )
        )
        .limit(1);
      if (!row) return c.json({ error: "Resource not found" }, 404);

      const supabase = createAdminSupabase();
      await supabase.storage.from("uploads").remove([row.storage_path]);

      await db
        .delete(learningResources)
        .where(eq(learningResources.id, id));

      return c.json({ message: "Resource deleted" });
    }
  );
