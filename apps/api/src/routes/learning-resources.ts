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

/**
 * Verify the (student, teacher) pair: a teacher may only attach resources to
 * a student they own. Returns the student id when ok, null otherwise.
 */
async function verifyStudentOwnership(
  teacherId: string,
  studentId: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.id, studentId), eq(students.teacher_id, teacherId)))
    .limit(1);
  return row?.id ?? null;
}
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
  // Teacher-only refinement: when working inside a specific student's Learning
  // Map, the teacher passes student_id so the list contains shared course
  // resources (student_id IS NULL) AND that student's private resources only.
  student_id: z.string().uuid().optional(),
});

// Sign+Confirm flow — bypasses Vercel's 4.5 MB body limit by uploading
// the file straight from the browser to Supabase via a signed URL.
const signSchema = z.object({
  file_name: z.string().min(1).max(255),
  content_type: z.string().min(1),
  size: z.number().int().positive().max(MAX_FILE_SIZE),
  course_id: z.string().uuid(),
  topic_id: z.string().uuid().nullable().optional(),
  // When uploading from a specific student's Learning Map, the teacher passes
  // student_id so the resource is scoped to that student only. Null/omitted
  // makes the resource a shared course-level resource.
  student_id: z.string().uuid().nullable().optional(),
});

const confirmSchema = z.object({
  resource_id: z.string().uuid(),
  path: z.string().min(1).max(500),
  file_name: z.string().min(1).max(255),
  file_type: z.string().min(1),
  file_size_bytes: z.number().int().positive().max(MAX_FILE_SIZE).optional(),
  course_id: z.string().uuid(),
  topic_id: z.string().uuid().nullable().optional(),
  student_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  visibility: z.enum(["teacher_only", "student_visible"]).optional(),
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
    const studentIdRaw = formData.get("student_id");
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

    let studentId: string | null = null;
    if (typeof studentIdRaw === "string" && studentIdRaw) {
      const owned = await verifyStudentOwnership(teacherId, studentIdRaw);
      if (!owned)
        return c.json({ error: "Student not found for this teacher" }, 404);
      studentId = owned;
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
          student_id: studentId,
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

  // ── Teacher: sign a direct-to-Storage upload URL ──────────────────────────
  .post(
    "/sign",
    requireRole("teacher"),
    zValidator("json", signSchema),
    async (c) => {
      const teacherId = c.get("userId");
      const { file_name, content_type, course_id, topic_id, student_id } =
        c.req.valid("json");

      if (!ALLOWED_TYPES.includes(content_type))
        return c.json(
          { error: "Invalid file type. Allowed: PDF, JPEG, PNG, WebP" },
          400
        );

      // Ownership + relationship checks before allocating storage.
      const [course] = await db
        .select({ id: courses.id })
        .from(courses)
        .where(
          and(eq(courses.id, course_id), eq(courses.teacher_id, teacherId))
        )
        .limit(1);
      if (!course) return c.json({ error: "Course not found" }, 404);

      if (topic_id) {
        const [t] = await db
          .select({ id: courseTopics.id })
          .from(courseTopics)
          .where(
            and(
              eq(courseTopics.id, topic_id),
              eq(courseTopics.course_id, course_id)
            )
          )
          .limit(1);
        if (!t) return c.json({ error: "Topic not found in course" }, 404);
      }

      if (student_id) {
        const owned = await verifyStudentOwnership(teacherId, student_id);
        if (!owned)
          return c.json({ error: "Student not found for this teacher" }, 404);
      }

      const resourceId = crypto.randomUUID();
      const ext = safeExt(file_name);
      const storagePath = `resources/${teacherId}/${course_id}/${resourceId}.${ext}`;

      const supabase = createAdminSupabase();
      const { data, error } = await supabase.storage
        .from("uploads")
        .createSignedUploadUrl(storagePath);

      if (error || !data) {
        console.error("[learning-resources] signed URL error:", error);
        return c.json(
          {
            error: `Failed to create upload URL: ${
              error?.message ?? "unknown"
            }`,
          },
          500
        );
      }

      return c.json({
        signedUrl: data.signedUrl,
        token: data.token,
        path: data.path,
        resource_id: resourceId,
      });
    }
  )

  // ── Teacher: confirm upload and create the resource record ────────────────
  .post(
    "/confirm",
    requireRole("teacher"),
    zValidator("json", confirmSchema),
    async (c) => {
      const teacherId = c.get("userId");
      const body = c.req.valid("json");

      // Defend against path tampering — the path must encode this teacher,
      // course, and the same resource id we are about to insert.
      const expectedPrefix = `resources/${teacherId}/${body.course_id}/${body.resource_id}.`;
      if (!body.path.startsWith(expectedPrefix))
        return c.json({ error: "Invalid storage path" }, 400);

      // Re-verify course ownership in case it was changed between sign+confirm.
      const [course] = await db
        .select({ id: courses.id })
        .from(courses)
        .where(
          and(
            eq(courses.id, body.course_id),
            eq(courses.teacher_id, teacherId)
          )
        )
        .limit(1);
      if (!course) return c.json({ error: "Course not found" }, 404);

      let topicId: string | null = null;
      if (body.topic_id) {
        const [t] = await db
          .select({ id: courseTopics.id })
          .from(courseTopics)
          .where(
            and(
              eq(courseTopics.id, body.topic_id),
              eq(courseTopics.course_id, body.course_id)
            )
          )
          .limit(1);
        if (!t) return c.json({ error: "Topic not found in course" }, 404);
        topicId = t.id;
      }

      let studentId: string | null = null;
      if (body.student_id) {
        const owned = await verifyStudentOwnership(teacherId, body.student_id);
        if (!owned)
          return c.json({ error: "Student not found for this teacher" }, 404);
        studentId = owned;
      }

      const supabase = createAdminSupabase();
      const { data: urlData } = supabase.storage
        .from("uploads")
        .getPublicUrl(body.path);

      try {
        const [row] = await db
          .insert(learningResources)
          .values({
            id: body.resource_id,
            teacher_id: teacherId,
            course_id: body.course_id,
            topic_id: topicId,
            student_id: studentId,
            title: body.title.trim(),
            description:
              body.description && body.description.trim()
                ? body.description.trim()
                : null,
            file_name: body.file_name,
            file_url: urlData.publicUrl,
            storage_path: body.path,
            file_type: body.file_type,
            file_size_bytes: body.file_size_bytes ?? null,
            visibility: body.visibility ?? "teacher_only",
          })
          .returning();
        return c.json(row, 201);
      } catch (err) {
        // Best-effort cleanup of the orphan storage object.
        await supabase.storage.from("uploads").remove([body.path]);
        console.error("[learning-resources] confirm insert error:", err);
        return c.json({ error: "Failed to save resource" }, 500);
      }
    }
  )

  // ── Teacher: list own resources by course (optionally filtered by topic) ──
  .get(
    "/",
    requireRole("teacher"),
    zValidator("query", listQuerySchema),
    async (c) => {
      const teacherId = c.get("userId");
      const { course_id, topic_id, student_id } = c.req.valid("query");

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
      // Student scoping:
      // - If student_id is passed (teacher working inside a student's map):
      //   return shared resources (student_id IS NULL) OR resources for
      //   that specific student.
      // - If omitted (course-tab view): return only shared/course-level
      //   resources, so per-student materials don't leak into the course tab.
      if (student_id) {
        conditions.push(
          or(
            isNull(learningResources.student_id),
            eq(learningResources.student_id, student_id)
          )!
        );
      } else {
        conditions.push(isNull(learningResources.student_id));
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
        // Student-specific scoping: shared course resources
        // (student_id IS NULL) OR resources targeted at this student only.
        // Other students in the same course must not see one another's
        // personal materials.
        or(
          isNull(learningResources.student_id),
          eq(learningResources.student_id, studentId)
        )!,
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
