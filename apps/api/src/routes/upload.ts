import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { homeworkItems, lessonSessions } from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { createAdminSupabase } from "../lib/supabase.js";
import { uuidParamSchema } from "../lib/validators.js";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB (client-side limit; Supabase bucket is the actual gate)
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

const signSchema = z.object({
  file_name: z.string().min(1).max(255),
  content_type: z.string().min(1),
  size: z.number().int().positive().max(MAX_FILE_SIZE),
});

const confirmSchema = z.object({
  file_name: z.string().min(1).max(255),
  path: z.string().min(1).max(500),
});

function sanitizeExt(fileName: string): string {
  const raw = fileName.split(".").pop()?.toLowerCase() ?? "bin";
  // Only allow alphanumeric extension
  return /^[a-z0-9]{1,8}$/.test(raw) ? raw : "bin";
}

export const uploadRoutes = new Hono()
  .use(authMiddleware)

  // ── Student: upload a file to a homework item ──
  .post(
    "/homework/:id",
    requireRole("student"),
    zValidator("param", uuidParamSchema),
    async (c) => {
      const studentId = c.get("userId");
      const itemId = c.req.valid("param").id;

      // Verify ownership
      const [item] = await db
        .select()
        .from(homeworkItems)
        .where(
          and(
            eq(homeworkItems.id, itemId),
            eq(homeworkItems.student_id, studentId)
          )
        )
        .limit(1);

      if (!item) return c.json({ error: "Homework item not found" }, 404);

      // Parse multipart form
      const formData = await c.req.formData();
      const file = formData.get("file");

      if (!file || !(file instanceof File)) {
        return c.json({ error: "No file provided" }, 400);
      }

      if (file.size > MAX_FILE_SIZE) {
        return c.json({ error: "File too large (max 10 MB)" }, 400);
      }

      if (!ALLOWED_TYPES.includes(file.type)) {
        return c.json(
          { error: "Invalid file type. Allowed: PDF, JPEG, PNG, WebP" },
          400
        );
      }

      // Upload to Supabase Storage
      const supabase = createAdminSupabase();
      const ext = file.name.split(".").pop() || "bin";
      const storagePath = `homework/${studentId}/${itemId}.${ext}`;

      const buffer = await file.arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(storagePath, buffer, {
          contentType: file.type,
          upsert: true,
        });

      if (uploadError) {
        console.error("[upload] Supabase storage error:", uploadError);
        return c.json({ error: "Failed to upload file" }, 500);
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("uploads")
        .getPublicUrl(storagePath);

      const fileUrl = urlData.publicUrl;

      // Update homework item with file reference
      const [updated] = await db
        .update(homeworkItems)
        .set({
          file_url: fileUrl,
          file_name: file.name,
        })
        .where(eq(homeworkItems.id, itemId))
        .returning();

      if (!updated) return c.json({ error: "Failed to update homework item" }, 500);

      return c.json({
        file_url: updated.file_url,
        file_name: updated.file_name,
      });
    }
  )

  // ── Teacher: upload material PDF to a lesson ──
  .post(
    "/lesson/:id",
    requireRole("teacher"),
    zValidator("param", uuidParamSchema),
    async (c) => {
      const teacherId = c.get("userId");
      const lessonId = c.req.valid("param").id;

      // Verify ownership
      const [lesson] = await db
        .select()
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.id, lessonId),
            eq(lessonSessions.teacher_id, teacherId)
          )
        )
        .limit(1);

      if (!lesson) return c.json({ error: "Lesson not found" }, 404);

      const formData = await c.req.formData();
      const file = formData.get("file");

      if (!file || !(file instanceof File)) {
        return c.json({ error: "No file provided" }, 400);
      }

      if (file.size > MAX_FILE_SIZE) {
        return c.json({ error: "File too large (max 10 MB)" }, 400);
      }

      if (!ALLOWED_TYPES.includes(file.type)) {
        return c.json(
          { error: "Invalid file type. Allowed: PDF, JPEG, PNG, WebP" },
          400
        );
      }

      const supabase = createAdminSupabase();
      const ext = file.name.split(".").pop() || "bin";
      const storagePath = `lessons/${teacherId}/${lessonId}.${ext}`;

      const buffer = await file.arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(storagePath, buffer, {
          contentType: file.type,
          upsert: true,
        });

      if (uploadError) {
        console.error("[upload] Supabase storage error:", uploadError);
        return c.json({ error: "Failed to upload file" }, 500);
      }

      const { data: urlData } = supabase.storage
        .from("uploads")
        .getPublicUrl(storagePath);

      const [updated] = await db
        .update(lessonSessions)
        .set({
          material_url: urlData.publicUrl,
          material_name: file.name,
        })
        .where(eq(lessonSessions.id, lessonId))
        .returning();

      if (!updated) return c.json({ error: "Failed to update lesson" }, 500);

      return c.json({
        material_url: updated.material_url,
        material_name: updated.material_name,
      });
    }
  )

  // ── Teacher: remove lesson material ──
  .delete(
    "/lesson/:id",
    requireRole("teacher"),
    zValidator("param", uuidParamSchema),
    async (c) => {
      const teacherId = c.get("userId");
      const lessonId = c.req.valid("param").id;

      const [lesson] = await db
        .select()
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.id, lessonId),
            eq(lessonSessions.teacher_id, teacherId)
          )
        )
        .limit(1);

      if (!lesson) return c.json({ error: "Lesson not found" }, 404);
      if (!lesson.material_url) return c.json({ error: "No file to remove" }, 400);

      const supabase = createAdminSupabase();
      const ext = (lesson.material_name || "").split(".").pop() || "bin";
      const storagePath = `lessons/${teacherId}/${lessonId}.${ext}`;

      await supabase.storage.from("uploads").remove([storagePath]);

      await db
        .update(lessonSessions)
        .set({ material_url: null, material_name: null })
        .where(eq(lessonSessions.id, lessonId));

      return c.json({ message: "File removed" });
    }
  )

  // ── Teacher: sign an upload URL for lesson material (bypasses Vercel body limit) ──
  .post(
    "/lesson/:id/sign",
    requireRole("teacher"),
    zValidator("param", uuidParamSchema),
    zValidator("json", signSchema),
    async (c) => {
      const teacherId = c.get("userId");
      const lessonId = c.req.valid("param").id;
      const { content_type } = c.req.valid("json");

      if (!ALLOWED_TYPES.includes(content_type)) {
        return c.json({ error: "Invalid file type. Allowed: PDF, JPEG, PNG, WebP" }, 400);
      }

      const [lesson] = await db
        .select({ id: lessonSessions.id })
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.id, lessonId),
            eq(lessonSessions.teacher_id, teacherId)
          )
        )
        .limit(1);

      if (!lesson) return c.json({ error: "Lesson not found" }, 404);

      const supabase = createAdminSupabase();
      const ext = sanitizeExt(c.req.valid("json").file_name);
      const storagePath = `lessons/${teacherId}/${lessonId}.${ext}`;

      const { data, error } = await supabase.storage
        .from("uploads")
        .createSignedUploadUrl(storagePath, { upsert: true });

      if (error || !data) {
        console.error("[upload] signed URL error:", error);
        const msg = error?.message?.includes("not exist")
          ? "Storage bucket 'uploads' is missing. Run migration 006_storage_bucket.sql."
          : `Failed to create upload URL: ${error?.message ?? "unknown"}`;
        return c.json({ error: msg }, 500);
      }

      return c.json({ signedUrl: data.signedUrl, token: data.token, path: data.path });
    }
  )

  // ── Teacher: confirm lesson material upload ──
  .post(
    "/lesson/:id/confirm",
    requireRole("teacher"),
    zValidator("param", uuidParamSchema),
    zValidator("json", confirmSchema),
    async (c) => {
      const teacherId = c.get("userId");
      const lessonId = c.req.valid("param").id;
      const { file_name, path } = c.req.valid("json");

      const [lesson] = await db
        .select({ id: lessonSessions.id })
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.id, lessonId),
            eq(lessonSessions.teacher_id, teacherId)
          )
        )
        .limit(1);

      if (!lesson) return c.json({ error: "Lesson not found" }, 404);

      // Defend against path tampering: must belong to this teacher+lesson
      const expectedPrefix = `lessons/${teacherId}/${lessonId}.`;
      if (!path.startsWith(expectedPrefix)) {
        return c.json({ error: "Invalid storage path" }, 400);
      }

      const supabase = createAdminSupabase();
      const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(path);

      const [updated] = await db
        .update(lessonSessions)
        .set({
          material_url: urlData.publicUrl,
          material_name: file_name,
        })
        .where(eq(lessonSessions.id, lessonId))
        .returning();

      if (!updated) return c.json({ error: "Failed to update lesson" }, 500);

      return c.json({
        material_url: updated.material_url,
        material_name: updated.material_name,
      });
    }
  )

  // ── Student: sign an upload URL for homework attachment ──
  .post(
    "/homework/:id/sign",
    requireRole("student"),
    zValidator("param", uuidParamSchema),
    zValidator("json", signSchema),
    async (c) => {
      const studentId = c.get("userId");
      const itemId = c.req.valid("param").id;
      const { content_type } = c.req.valid("json");

      if (!ALLOWED_TYPES.includes(content_type)) {
        return c.json({ error: "Invalid file type. Allowed: PDF, JPEG, PNG, WebP" }, 400);
      }

      const [item] = await db
        .select({ id: homeworkItems.id })
        .from(homeworkItems)
        .where(
          and(
            eq(homeworkItems.id, itemId),
            eq(homeworkItems.student_id, studentId)
          )
        )
        .limit(1);

      if (!item) return c.json({ error: "Homework item not found" }, 404);

      const supabase = createAdminSupabase();
      const ext = sanitizeExt(c.req.valid("json").file_name);
      const storagePath = `homework/${studentId}/${itemId}.${ext}`;

      const { data, error } = await supabase.storage
        .from("uploads")
        .createSignedUploadUrl(storagePath, { upsert: true });

      if (error || !data) {
        console.error("[upload] signed URL error:", error);
        const msg = error?.message?.includes("not exist")
          ? "Storage bucket 'uploads' is missing. Run migration 006_storage_bucket.sql."
          : `Failed to create upload URL: ${error?.message ?? "unknown"}`;
        return c.json({ error: msg }, 500);
      }

      return c.json({ signedUrl: data.signedUrl, token: data.token, path: data.path });
    }
  )

  // ── Student: confirm homework upload ──
  .post(
    "/homework/:id/confirm",
    requireRole("student"),
    zValidator("param", uuidParamSchema),
    zValidator("json", confirmSchema),
    async (c) => {
      const studentId = c.get("userId");
      const itemId = c.req.valid("param").id;
      const { file_name, path } = c.req.valid("json");

      const [item] = await db
        .select({ id: homeworkItems.id })
        .from(homeworkItems)
        .where(
          and(
            eq(homeworkItems.id, itemId),
            eq(homeworkItems.student_id, studentId)
          )
        )
        .limit(1);

      if (!item) return c.json({ error: "Homework item not found" }, 404);

      const expectedPrefix = `homework/${studentId}/${itemId}.`;
      if (!path.startsWith(expectedPrefix)) {
        return c.json({ error: "Invalid storage path" }, 400);
      }

      const supabase = createAdminSupabase();
      const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(path);

      const [updated] = await db
        .update(homeworkItems)
        .set({
          file_url: urlData.publicUrl,
          file_name,
        })
        .where(eq(homeworkItems.id, itemId))
        .returning();

      if (!updated) return c.json({ error: "Failed to update homework item" }, 500);

      return c.json({
        file_url: updated.file_url,
        file_name: updated.file_name,
      });
    }
  )

  // ── Student: remove uploaded file ──
  .delete(
    "/homework/:id",
    requireRole("student"),
    zValidator("param", uuidParamSchema),
    async (c) => {
      const studentId = c.get("userId");
      const itemId = c.req.valid("param").id;

      const [item] = await db
        .select()
        .from(homeworkItems)
        .where(
          and(
            eq(homeworkItems.id, itemId),
            eq(homeworkItems.student_id, studentId)
          )
        )
        .limit(1);

      if (!item) return c.json({ error: "Homework item not found" }, 404);
      if (!item.file_url) return c.json({ error: "No file to remove" }, 400);

      // Remove from Supabase Storage
      const supabase = createAdminSupabase();
      const ext = (item.file_name || "").split(".").pop() || "bin";
      const storagePath = `homework/${studentId}/${itemId}.${ext}`;

      await supabase.storage.from("uploads").remove([storagePath]);

      // Clear file reference
      const [updated] = await db
        .update(homeworkItems)
        .set({ file_url: null, file_name: null })
        .where(eq(homeworkItems.id, itemId))
        .returning();

      return c.json({ message: "File removed" });
    }
  )

  // ── Student: sign an upload URL for their lesson solution ──
  // Mirrors the teacher's /lesson/:id/sign flow but writes to a
  // student-scoped storage path and only the student themselves can use
  // it.
  .post(
    "/lesson/:id/solution/sign",
    requireRole("student"),
    zValidator("param", uuidParamSchema),
    zValidator("json", signSchema),
    async (c) => {
      const studentId = c.get("userId");
      const lessonId = c.req.valid("param").id;
      const { content_type } = c.req.valid("json");

      if (!ALLOWED_TYPES.includes(content_type)) {
        return c.json(
          { error: "Invalid file type. Allowed: PDF, JPEG, PNG, WebP" },
          400
        );
      }

      const [lesson] = await db
        .select({ id: lessonSessions.id })
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.id, lessonId),
            eq(lessonSessions.student_id, studentId)
          )
        )
        .limit(1);

      if (!lesson) return c.json({ error: "Lesson not found" }, 404);

      const supabase = createAdminSupabase();
      const ext = sanitizeExt(c.req.valid("json").file_name);
      const storagePath = `solutions/${studentId}/${lessonId}.${ext}`;

      const { data, error } = await supabase.storage
        .from("uploads")
        .createSignedUploadUrl(storagePath, { upsert: true });

      if (error || !data) {
        console.error("[upload] solution signed URL error:", error);
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
      });
    }
  )

  // ── Student: confirm solution upload ──
  .post(
    "/lesson/:id/solution/confirm",
    requireRole("student"),
    zValidator("param", uuidParamSchema),
    zValidator("json", confirmSchema),
    async (c) => {
      const studentId = c.get("userId");
      const lessonId = c.req.valid("param").id;
      const { file_name, path } = c.req.valid("json");

      const [lesson] = await db
        .select({ id: lessonSessions.id })
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.id, lessonId),
            eq(lessonSessions.student_id, studentId)
          )
        )
        .limit(1);

      if (!lesson) return c.json({ error: "Lesson not found" }, 404);

      // Path tampering guard: must belong to this student + lesson.
      const expectedPrefix = `solutions/${studentId}/${lessonId}.`;
      if (!path.startsWith(expectedPrefix)) {
        return c.json({ error: "Invalid storage path" }, 400);
      }

      const supabase = createAdminSupabase();
      const { data: urlData } = supabase.storage
        .from("uploads")
        .getPublicUrl(path);

      const [updated] = await db
        .update(lessonSessions)
        .set({
          student_solution_url: urlData.publicUrl,
          student_solution_name: file_name,
        })
        .where(eq(lessonSessions.id, lessonId))
        .returning();

      if (!updated) return c.json({ error: "Failed to update lesson" }, 500);

      return c.json({
        student_solution_url: updated.student_solution_url,
        student_solution_name: updated.student_solution_name,
      });
    }
  )

  // ── Student: remove their solution ──
  .delete(
    "/lesson/:id/solution",
    requireRole("student"),
    zValidator("param", uuidParamSchema),
    async (c) => {
      const studentId = c.get("userId");
      const lessonId = c.req.valid("param").id;

      const [lesson] = await db
        .select()
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.id, lessonId),
            eq(lessonSessions.student_id, studentId)
          )
        )
        .limit(1);

      if (!lesson) return c.json({ error: "Lesson not found" }, 404);
      if (!lesson.student_solution_url) {
        return c.json({ error: "No solution to remove" }, 400);
      }

      const supabase = createAdminSupabase();
      const ext = (lesson.student_solution_name || "").split(".").pop() || "bin";
      const storagePath = `solutions/${studentId}/${lessonId}.${ext}`;

      // Best-effort: delete storage object, then clear DB references.
      await supabase.storage.from("uploads").remove([storagePath]);

      await db
        .update(lessonSessions)
        .set({ student_solution_url: null, student_solution_name: null })
        .where(eq(lessonSessions.id, lessonId));

      return c.json({ message: "Solution removed" });
    }
  );
