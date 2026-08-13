import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { students, studentCourses } from "../db/schema.js";
import { authMiddleware } from "../middleware/auth.js";
import { zValidator } from "@hono/zod-validator";
import { learningMapQuerySchema } from "../lib/validators.js";
import { logActivity } from "../lib/activity-log.js";
import { getLearningMap } from "../services/learning-map.js";

export const learningMapRoutes = new Hono()
  .use(authMiddleware)

  // GET /learning-map?course_id=X&student_id=Y
  // - student: student_id ignored, uses own id
  // - teacher: requires student_id; must own student
  .get("/", zValidator("query", learningMapQuerySchema), async (c) => {
    const userId = c.get("userId");
    const role = c.get("userRole");
    const q = c.req.valid("query");
    let courseId = q.course_id;
    const studentIdParam = q.student_id;

    let studentId: string;
    if (role === "student") {
      studentId = userId;
    } else {
      if (!studentIdParam)
        return c.json({ error: "student_id required" }, 400);
      // Verify teacher owns this student
      const [owner] = await db
        .select({ id: students.id })
        .from(students)
        .where(
          and(
            eq(students.id, studentIdParam),
            eq(students.teacher_id, userId)
          )
        )
        .limit(1);
      if (!owner) return c.json({ error: "Student not found" }, 404);
      studentId = studentIdParam;
    }

    if (role === "student") {
      logActivity(c, {
        event_type: "learning_map.opened",
        student_id: studentId,
        actor_id: userId,
      });
    }

    // ── Wave 1 ── independent lookups that only need studentId.
    // Resolve which course the map shows. Only ACTIVE course assignments
    // count. Old lesson_sessions still reference archived courses, so we must
    // NOT infer the course from them — otherwise hiding a student's last
    // course would keep surfacing its archived map.
    //
    // The primary-course lookup is fetched unconditionally so it can run in
    // parallel with the active-course list. Its value is only consumed in the
    // no-course_id branch below, so reading it eagerly is behaviour-neutral —
    // it just lets the two reads share a single round-trip.
    const [activeCourses, primaryRows] = await Promise.all([
      db
        .select({ course_id: studentCourses.course_id })
        .from(studentCourses)
        .where(
          and(
            eq(studentCourses.student_id, studentId),
            eq(studentCourses.is_active, true)
          )
        )
        .orderBy(studentCourses.added_at),
      db
        .select({ primary_course_id: students.primary_course_id })
        .from(students)
        .where(eq(students.id, studentId))
        .limit(1),
    ]);
    const activeCourseIds = new Set(activeCourses.map((r) => r.course_id));

    if (courseId) {
      // A provided course_id must be one of the student's active courses;
      // otherwise fall through to the empty/error response below.
      if (!activeCourseIds.has(courseId))
        return c.json({ error: "No course found for student" }, 404);
    } else {
      // No course_id: prefer the student's primary course when it is still
      // active, else the oldest active course. Never infer from old lessons.
      const primaryCourseId = primaryRows[0]?.primary_course_id;
      if (primaryCourseId && activeCourseIds.has(primaryCourseId)) {
        courseId = primaryCourseId;
      } else if (activeCourses.length > 0) {
        courseId = activeCourses[0]!.course_id;
      } else {
        return c.json({ error: "No course found for student" }, 404);
      }
    }

    const map = await getLearningMap(courseId, studentId);
    if (!map) return c.json({ error: "Course not found" }, 404);

    return c.json(map);
  });
