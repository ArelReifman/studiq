import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { homeworkItems, students } from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { createAdminSupabase } from "../lib/supabase.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

export const uploadRoutes = new Hono()
  .use(authMiddleware)

  // ── Student: upload a file to a homework item ──
  .post(
    "/homework/:id",
    requireRole("student"),
    async (c) => {
      const studentId = c.get("userId");
      const itemId = c.req.param("id")!;

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

  // ── Student: remove uploaded file ──
  .delete(
    "/homework/:id",
    requireRole("student"),
    async (c) => {
      const studentId = c.get("userId");
      const itemId = c.req.param("id")!;

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
  );
