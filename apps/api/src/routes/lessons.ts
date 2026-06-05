import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc, inArray, or } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  lessonSessions,
  homeworkItems,
  todoItems,
  students,
  studentCourses,
  difficultyReports,
  teacherAiFeedback,
} from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { generateLesson } from "../services/ai/generate-lesson.js";
import { resolveTopic } from "../services/ai/resolve-topic.js";
import { updateStudentProfile } from "../services/ai/update-profile.js";
import { updateTeacherStyleIfDue } from "../services/ai/update-teacher-style.js";
import { createAdminSupabase } from "../lib/supabase.js";
import { studentIdQuerySchema, uuidParamSchema } from "../lib/validators.js";

export const lessonRoutes = new Hono()
  .use(authMiddleware)

  // GET /lessons — student: own; teacher: filter by student_id
  .get("/", zValidator("query", studentIdQuerySchema), async (c) => {
    const userId = c.get("userId");
    const role = c.get("userRole");
    const studentIdParam = c.req.valid("query").student_id;

    let rows;
    if (role === "student") {
      rows = await db
        .select()
        .from(lessonSessions)
        .where(eq(lessonSessions.student_id, userId))
        .orderBy(desc(lessonSessions.generated_at));
    } else {
      const whereClause = studentIdParam
        ? and(
            eq(lessonSessions.teacher_id, userId),
            eq(lessonSessions.student_id, studentIdParam)
          )
        : eq(lessonSessions.teacher_id, userId);

      rows = await db
        .select()
        .from(lessonSessions)
        .where(whereClause)
        .orderBy(desc(lessonSessions.generated_at));
    }

    return c.json(rows);
  })

  // GET /lessons/:id — lesson detail with homework + todos
  .get("/:id", zValidator("param", uuidParamSchema), async (c) => {
    const userId = c.get("userId");
    const role = c.get("userRole");
    const lessonId = c.req.valid("param").id;

    const [lesson] = await db
      .select()
      .from(lessonSessions)
      .where(eq(lessonSessions.id, lessonId))
      .limit(1);

    if (!lesson) return c.json({ error: "Lesson not found" }, 404);

    // Access control
    if (role === "student" && lesson.student_id !== userId) {
      return c.json({ error: "Forbidden" }, 403);
    }
    if (role === "teacher" && lesson.teacher_id !== userId) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const [hw, todos] = await Promise.all([
      db
        .select()
        .from(homeworkItems)
        .where(eq(homeworkItems.lesson_id, lessonId))
        .orderBy(homeworkItems.order_index),
      db
        .select()
        .from(todoItems)
        .where(eq(todoItems.lesson_id, lessonId))
        .orderBy(todoItems.order_index),
    ]);

    return c.json({ ...lesson, homework_items: hw, todo_items: todos });
  })

  // POST /lessons/create — teacher manually creates a lesson with homework + todo items
  .post(
    "/create",
    requireRole("teacher"),
    zValidator(
      "json",
      z.object({
        student_id: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        homework: z
          .array(
            z.object({
              title: z.string().min(1).max(200),
              description: z.string().max(1000).optional(),
            })
          )
          .default([]),
        todos: z
          .array(
            z.object({
              title: z.string().min(1).max(200),
              description: z.string().max(1000).optional(),
            })
          )
          .default([]),
        course_id: z.string().uuid().nullable().optional(),
        topic_id: z.string().uuid().nullable().optional(),
      })
    ),
    async (c) => {
      const teacherId = c.get("userId");
      const {
        student_id,
        title,
        description,
        homework,
        todos,
        course_id,
        topic_id,
      } = c.req.valid("json");

      // Verify student belongs to teacher
      const [student] = await db
        .select({ id: students.id })
        .from(students)
        .where(
          and(eq(students.id, student_id), eq(students.teacher_id, teacherId))
        )
        .limit(1);

      if (!student) return c.json({ error: "Student not found" }, 404);

      // Idempotency guard: one ACTIVE lesson per (student, course, topic).
      // When the topic is specified and an active lesson already exists for it,
      // return that lesson instead of inserting a duplicate. Completed/archived
      // lessons do NOT block — a fresh pass can start once the previous is done.
      if (course_id && topic_id) {
        const [existing] = await db
          .select()
          .from(lessonSessions)
          .where(
            and(
              eq(lessonSessions.student_id, student_id),
              eq(lessonSessions.course_id, course_id),
              eq(lessonSessions.topic_id, topic_id),
              eq(lessonSessions.status, "active")
            )
          )
          .limit(1);
        if (existing) {
          const [hw, tds] = await Promise.all([
            db
              .select()
              .from(homeworkItems)
              .where(eq(homeworkItems.lesson_id, existing.id))
              .orderBy(homeworkItems.order_index),
            db
              .select()
              .from(todoItems)
              .where(eq(todoItems.lesson_id, existing.id))
              .orderBy(todoItems.order_index),
          ]);
          return c.json(
            { ...existing, homework_items: hw, todo_items: tds },
            200
          );
        }
      }

      // Create lesson
      const [lesson] = await db
        .insert(lessonSessions)
        .values({
          student_id,
          teacher_id: teacherId,
          title,
          description: description ?? null,
          ai_generated: false,
          status: "active",
          course_id: course_id ?? null,
          topic_id: topic_id ?? null,
        })
        .returning();

      if (!lesson) return c.json({ error: "Failed to create lesson" }, 500);

      // Insert homework items
      if (homework.length > 0) {
        await db.insert(homeworkItems).values(
          homework.map((hw, i) => ({
            lesson_id: lesson.id,
            student_id,
            title: hw.title,
            description: hw.description ?? null,
            order_index: i,
          }))
        );
      }

      // Insert todo items
      if (todos.length > 0) {
        await db.insert(todoItems).values(
          todos.map((td, i) => ({
            lesson_id: lesson.id,
            student_id,
            title: td.title,
            description: td.description ?? null,
            order_index: i,
          }))
        );
      }

      // Fetch full lesson with items
      const [hw, tds] = await Promise.all([
        db
          .select()
          .from(homeworkItems)
          .where(eq(homeworkItems.lesson_id, lesson.id))
          .orderBy(homeworkItems.order_index),
        db
          .select()
          .from(todoItems)
          .where(eq(todoItems.lesson_id, lesson.id))
          .orderBy(todoItems.order_index),
      ]);

      return c.json(
        { ...lesson, homework_items: hw, todo_items: tds },
        201
      );
    }
  )

  // POST /lessons/generate — teacher triggers AI generation for a student.
  // Optional topic_id anchors the lesson to a Learning Map node; when omitted,
  // resolveTopic picks a sensible default (see its docstring).
  .post(
    "/generate",
    requireRole("teacher"),
    zValidator(
      "json",
      z.object({
        student_id: z.string().uuid(),
        topic_id: z.string().uuid().optional(),
        // Phase AI-0.5 — when present, generate a *retry* lesson for the same
        // student/course/topic as the given (failed) lesson and archive it.
        retry_of_lesson_id: z.string().uuid().optional(),
      })
    ),
    async (c) => {
      const teacherId = c.get("userId");
      const { student_id, topic_id, retry_of_lesson_id } =
        c.req.valid("json");

      // Verify student belongs to teacher
      const [student] = await db
        .select({ id: students.id })
        .from(students)
        .where(
          and(eq(students.id, student_id), eq(students.teacher_id, teacherId))
        )
        .limit(1);

      if (!student) return c.json({ error: "Student not found" }, 404);

      // ── Retry branch (Phase AI-0.5) ─────────────────────────────────────
      // Anchors the retry to the *predecessor's* course/topic (not the
      // student's current primary), validates ownership + that the anchor
      // course is still active, then delegates archive + duplicate-active
      // guard to generateLesson (atomic with the insert). The legacy branch
      // below is left byte-for-byte unchanged when this param is absent.
      if (retry_of_lesson_id) {
        const [pred] = await db
          .select({
            id: lessonSessions.id,
            teacher_id: lessonSessions.teacher_id,
            student_id: lessonSessions.student_id,
            course_id: lessonSessions.course_id,
            topic_id: lessonSessions.topic_id,
            teacher_decision: lessonSessions.teacher_decision,
          })
          .from(lessonSessions)
          .where(eq(lessonSessions.id, retry_of_lesson_id))
          .limit(1);

        // Ownership: the predecessor must belong to this teacher AND the
        // named student. Mismatch is treated as "not found" (no leakage).
        if (
          !pred ||
          pred.teacher_id !== teacherId ||
          pred.student_id !== student_id
        ) {
          return c.json({ error: "Previous lesson not found" }, 404);
        }

        // Eligibility: a retry exists only to act on a `repeat` verdict. If the
        // predecessor was sent forward (next_level / next_topic) or never
        // reviewed, retry creation is a state conflict — reject it at the API,
        // never trusting the frontend CTA to be the only gate. (Idempotency is
        // preserved: a successful retry archives the predecessor but leaves its
        // teacher_decision = "repeat", so a late duplicate still passes here.)
        if (pred.teacher_decision !== "repeat") {
          return c.json(
            { error: "Previous lesson was not marked for repeat" },
            409
          );
        }

        // A retry must be anchored to a course, else it would be invisible on
        // the map (the map filters on course_id).
        if (!pred.course_id) {
          return c.json(
            { error: "Previous lesson is not anchored to a course" },
            400
          );
        }

        // The anchor course must still be active for the student — otherwise
        // the retry would be created but never render on the map. Fail loudly
        // instead of producing a map-invisible lesson.
        const [activeCourse] = await db
          .select({ course_id: studentCourses.course_id })
          .from(studentCourses)
          .where(
            and(
              eq(studentCourses.student_id, student_id),
              eq(studentCourses.course_id, pred.course_id),
              eq(studentCourses.is_active, true)
            )
          )
          .limit(1);
        if (!activeCourse) {
          return c.json(
            { error: "Previous lesson's course is no longer active" },
            400
          );
        }

        // Topic anchor: in retry mode the predecessor's topic is AUTHORITATIVE —
        // a retry must stay on the same topic (and course). An explicit topic_id
        // is accepted only when it matches the predecessor's; a different one is
        // rejected rather than silently switching topics. The predecessor's
        // topic_id is already consistent with its course_id by construction
        // (validated at creation; the FK nulls it if the topic is deleted), so
        // no re-validation against course_topics is needed.
        if (topic_id && topic_id !== pred.topic_id) {
          return c.json(
            { error: "Retry must stay on the predecessor's topic" },
            400
          );
        }
        const anchorTopicId = pred.topic_id;

        const lesson = await generateLesson(student_id, teacherId, {
          courseId: pred.course_id,
          topicId: anchorTopicId,
          retryOfLessonId: pred.id,
        });
        return c.json(lesson, 201);
      }

      // Resolve the Learning Map anchor. A topic_id that doesn't belong to the
      // student's course is a client error; "no course" falls back to legacy
      // (unanchored) generation so first-lesson flows keep working.
      const resolved = await resolveTopic(student_id, {
        explicitTopicId: topic_id ?? null,
      });
      if (!resolved.ok && resolved.reason === "topic_mismatch") {
        return c.json({ error: "Topic does not belong to student's course" }, 400);
      }

      const lesson = await generateLesson(
        student_id,
        teacherId,
        resolved.ok
          ? { courseId: resolved.courseId, topicId: resolved.topicId }
          : undefined
      );
      return c.json(lesson, 201);
    }
  )

  // DELETE /lessons/:id — teacher deletes a lesson (cascades to homework/todos)
  .delete("/:id", requireRole("teacher"), zValidator("param", uuidParamSchema), async (c) => {
    const teacherId = c.get("userId");
    const lessonId = c.req.valid("param").id;

    // Verify ownership and read material path before delete
    const [lesson] = await db
      .select({
        id: lessonSessions.id,
        material_name: lessonSessions.material_name,
      })
      .from(lessonSessions)
      .where(
        and(
          eq(lessonSessions.id, lessonId),
          eq(lessonSessions.teacher_id, teacherId)
        )
      )
      .limit(1);

    if (!lesson) return c.json({ error: "Lesson not found" }, 404);

    // Remove storage object if any (best-effort, doesn't block deletion)
    if (lesson.material_name) {
      try {
        const supabase = createAdminSupabase();
        const ext = (lesson.material_name.split(".").pop() || "bin").toLowerCase();
        await supabase.storage
          .from("uploads")
          .remove([`lessons/${teacherId}/${lessonId}.${ext}`]);
      } catch (err) {
        console.warn("[lessons] failed to remove storage object:", err);
      }
    }

    // difficulty_reports.source_id is a polymorphic reference to either a
    // homework_item or todo_item — there's no FK so the FK cascade can't
    // touch them. Wipe them explicitly before the cascade removes the
    // items they were pointing at, otherwise the teacher keeps seeing
    // stale "recent struggles" entries for a lesson that no longer exists.
    const [hwOfLesson, tdOfLesson] = await Promise.all([
      db
        .select({ id: homeworkItems.id })
        .from(homeworkItems)
        .where(eq(homeworkItems.lesson_id, lessonId)),
      db
        .select({ id: todoItems.id })
        .from(todoItems)
        .where(eq(todoItems.lesson_id, lessonId)),
    ]);
    const sourceIds = [
      ...hwOfLesson.map((h) => h.id),
      ...tdOfLesson.map((t) => t.id),
    ];
    if (sourceIds.length > 0) {
      await db
        .delete(difficultyReports)
        .where(inArray(difficultyReports.source_id, sourceIds));
    }

    // teacher_ai_feedback.source_lesson_id references this lesson with a FK
    // that has no ON DELETE rule (defaults to NO ACTION / RESTRICT), so a
    // straight delete would be blocked whenever AI feedback points here.
    // Null the reference instead of deleting — preserves the teacher's
    // feedback history (which still trains the AI) while unblocking deletion.
    await db
      .update(teacherAiFeedback)
      .set({ source_lesson_id: null })
      .where(eq(teacherAiFeedback.source_lesson_id, lessonId));

    // DB cascade will clean up homework_items and todo_items via FK ON DELETE CASCADE
    await db
      .delete(lessonSessions)
      .where(eq(lessonSessions.id, lessonId));

    return c.json({ message: "Lesson deleted" });
  })

  // PATCH /lessons/:id/reflection — student writes how the lesson went for them
  .patch(
    "/:id/reflection",
    requireRole("student"),
    zValidator("param", uuidParamSchema),
    zValidator(
      "json",
      z.object({ reflection: z.string().max(2000) })
    ),
    async (c) => {
      const studentId = c.get("userId");
      const lessonId = c.req.valid("param").id;
      const { reflection } = c.req.valid("json");

      const trimmed = reflection.trim();

      const [updated] = await db
        .update(lessonSessions)
        .set({ student_reflection: trimmed === "" ? null : trimmed })
        .where(
          and(
            eq(lessonSessions.id, lessonId),
            eq(lessonSessions.student_id, studentId)
          )
        )
        .returning({
          id: lessonSessions.id,
          student_reflection: lessonSessions.student_reflection,
        });

      if (!updated) return c.json({ error: "Lesson not found" }, 404);
      return c.json(updated);
    }
  )

  // PATCH /lessons/:id/review — teacher records verdict after checking submission
  // teacher_review_note: what the teacher observed in the student's solution
  // teacher_decision:    repeat | next_level | next_topic
  // This feeds the AI so it learns the teacher's grading standards over time.
  .patch(
    "/:id/review",
    requireRole("teacher"),
    zValidator("param", uuidParamSchema),
    zValidator(
      "json",
      z.object({
        teacher_review_note: z.string().max(2000).optional(),
        teacher_decision: z.enum(["repeat", "next_level", "next_topic"]),
      })
    ),
    async (c) => {
      const teacherId = c.get("userId");
      const lessonId = c.req.valid("param").id;
      const { teacher_review_note, teacher_decision } = c.req.valid("json");

      const [updated] = await db
        .update(lessonSessions)
        .set({
          teacher_review_note: teacher_review_note?.trim() ?? null,
          teacher_decision,
          teacher_reviewed_at: new Date(),
        })
        .where(
          and(
            eq(lessonSessions.id, lessonId),
            eq(lessonSessions.teacher_id, teacherId)
          )
        )
        .returning();

      if (!updated) return c.json({ error: "Lesson not found" }, 404);

      // When the teacher signs off on the student moving forward
      // (next_level / next_topic), the conversation between teacher and
      // student already resolved any failed tasks — the teacher
      // explained, the student got it. Three updates flow from that
      // verdict:
      //   1. Flip every "failed" homework / todo on this lesson to
      //      "completed" so the lesson reads 100% in stats and the
      //      student's profile reflects the post-explanation state.
      //   2. Wipe the marked_at field on those flipped items so the
      //      timeline doesn't claim the student "failed at 14:32 then
      //      completed at 14:32" — the recovery happened offline.
      //   3. Mark every difficulty_report tied to this lesson's items
      //      as reviewed so the "X not reviewed" chip clears.
      // "repeat" intentionally does none of this — the work isn't done
      // yet, the student needs another pass.
      if (teacher_decision === "next_level" || teacher_decision === "next_topic") {
        const [hwOfLesson, tdOfLesson] = await Promise.all([
          db
            .select({ id: homeworkItems.id })
            .from(homeworkItems)
            .where(eq(homeworkItems.lesson_id, lessonId)),
          db
            .select({ id: todoItems.id })
            .from(todoItems)
            .where(eq(todoItems.lesson_id, lessonId)),
        ]);
        const sourceIds = [
          ...hwOfLesson.map((h) => h.id),
          ...tdOfLesson.map((t) => t.id),
        ];

        // Promote failed → completed for tasks tied to this lesson.
        await Promise.all([
          db
            .update(homeworkItems)
            .set({ status: "completed" })
            .where(
              and(
                eq(homeworkItems.lesson_id, lessonId),
                eq(homeworkItems.status, "failed")
              )
            ),
          db
            .update(todoItems)
            .set({ status: "completed" })
            .where(
              and(
                eq(todoItems.lesson_id, lessonId),
                eq(todoItems.status, "failed")
              )
            ),
        ]);

        if (sourceIds.length > 0) {
          await db
            .update(difficultyReports)
            .set({ reviewed: true })
            .where(inArray(difficultyReports.source_id, sourceIds));
        }

        // Mark the lesson itself as completed so learning-map progress
        // can count it when tasks_total === 0 (lesson-only progress).
        await db
          .update(lessonSessions)
          .set({ status: "completed", completed_at: new Date() })
          .where(eq(lessonSessions.id, lessonId));
      }

      // Fire-and-forget: refresh student AI profile so the teacher's verdict
      // is immediately incorporated before the next lesson is planned.
      updateStudentProfile(updated.student_id, updated.id, updated.title).catch(
        (err) => console.error("[student-profile] review update failed:", err)
      );

      // Also feed this decision into the teacher's style profile — without
      // this, no teacher style updates would happen now that the freeform
      // feedback form is gone. Throttled internally to every Nth signal.
      updateTeacherStyleIfDue(teacherId).catch((err) =>
        console.error("[teacher-style] review update failed:", err)
      );

      return c.json(updated);
    }
  )

  // PATCH /lessons/:id/status
  .patch(
    "/:id/status",
    requireRole("teacher"),
    zValidator("param", uuidParamSchema),
    zValidator(
      "json",
      z.object({ status: z.enum(["completed", "archived"]) })
    ),
    async (c) => {
      const teacherId = c.get("userId");
      const lessonId = c.req.valid("param").id;
      const { status } = c.req.valid("json");

      const [updated] = await db
        .update(lessonSessions)
        .set({
          status,
          completed_at: status === "completed" ? new Date() : null,
        })
        .where(
          and(
            eq(lessonSessions.id, lessonId),
            eq(lessonSessions.teacher_id, teacherId)
          )
        )
        .returning();

      if (!updated) return c.json({ error: "Lesson not found" }, 404);

      // Fire-and-forget: when a lesson is completed, ask Claude to refresh the
      // student's AI profile (strong/weak topics, learning style, ai_summary)
      // so the next lesson generation reflects what just happened.
      if (status === "completed") {
        updateStudentProfile(updated.student_id, updated.id, updated.title).catch(
          (err) => console.error("[student-profile] update failed:", err)
        );
      }

      return c.json(updated);
    }
  );
