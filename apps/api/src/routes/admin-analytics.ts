import { Hono } from "hono";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  students,
  profiles,
  activityEvents,
  studentCourses,
  courses,
  lessonSessions,
} from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { createAdminSupabase } from "../lib/supabase.js";
import { uuidParamSchema } from "../lib/validators.js";
import { zValidator } from "@hono/zod-validator";

// Read-only usage-analytics overview for a teacher's own students: login
// dates/counts and lesson-vs-learning-map open counts. Purely additive —
// only ever SELECTs from activity_events; never mutates any data.
export const adminAnalyticsRoutes = new Hono()
  .use(authMiddleware)
  .use(requireRole("teacher"))

  // GET /admin-analytics/overview — one summary table for all of this
  // teacher's students.
  .get("/overview", async (c) => {
    const teacherId = c.get("userId");

    const myStudents = await db
      .select({ id: students.id, full_name: profiles.full_name })
      .from(students)
      .innerJoin(profiles, eq(profiles.id, students.id))
      .where(eq(students.teacher_id, teacherId));

    if (myStudents.length === 0) return c.json([]);

    const studentIds = myStudents.map((s) => s.id);

    // Supabase Auth's own last-sign-in timestamp, tracked automatically since
    // each account's creation — predates our activity_events tracking, so it
    // can surface a real "last login" even for logins that happened before
    // this feature existed. Best-effort per student: a lookup failure just
    // means that one student's value is missing, never a 500 for the route.
    const supabaseAdmin = createAdminSupabase();
    const authLastSignIns = await Promise.all(
      studentIds.map(async (id) => {
        try {
          const { data, error } = await supabaseAdmin.auth.admin.getUserById(
            id
          );
          if (error || !data.user) return { id, last_sign_in_at: null };
          return { id, last_sign_in_at: data.user.last_sign_in_at ?? null };
        } catch {
          return { id, last_sign_in_at: null };
        }
      })
    );

    const [loginsByDate, engagementCounts, lastActivity, activeCourses] =
      await Promise.all([
      db
        .select({
          student_id: activityEvents.student_id,
          date: sql<string>`date_trunc('day', ${activityEvents.created_at})`,
          count: sql<number>`count(*)::int`,
        })
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.event_type, "auth.login_succeeded"),
            inArray(activityEvents.student_id, studentIds)
          )
        )
        .groupBy(
          activityEvents.student_id,
          sql`date_trunc('day', ${activityEvents.created_at})`
        )
        .orderBy(sql`date_trunc('day', ${activityEvents.created_at}) desc`),
      db
        .select({
          student_id: activityEvents.student_id,
          event_type: activityEvents.event_type,
          count: sql<number>`count(*)::int`,
        })
        .from(activityEvents)
        .where(
          and(
            inArray(activityEvents.event_type, [
              "lesson.opened",
              "learning_map.opened",
              "lesson.reflection_saved",
              "lesson.solution_uploaded",
            ]),
            inArray(activityEvents.student_id, studentIds)
          )
        )
        .groupBy(activityEvents.student_id, activityEvents.event_type),
      // Most recent timestamp per event type, per student — answers
      // "when did they last log in" / "when did they last open a lesson".
      db
        .select({
          student_id: activityEvents.student_id,
          event_type: activityEvents.event_type,
          last_at: sql<string>`max(${activityEvents.created_at})`,
        })
        .from(activityEvents)
        .where(inArray(activityEvents.student_id, studentIds))
        .groupBy(activityEvents.student_id, activityEvents.event_type),
      // Active course names per student, for filtering the overview by subject.
      db
        .select({
          student_id: studentCourses.student_id,
          course_name: courses.name,
        })
        .from(studentCourses)
        .innerJoin(courses, eq(courses.id, studentCourses.course_id))
        .where(
          and(
            inArray(studentCourses.student_id, studentIds),
            eq(studentCourses.is_active, true)
          )
        ),
    ]);

    const overview = myStudents.map((student) => {
      const logins = loginsByDate.filter((r) => r.student_id === student.id);
      const engagement = engagementCounts.filter(
        (r) => r.student_id === student.id
      );
      const last = lastActivity.filter((r) => r.student_id === student.id);
      const supabaseLastSignIn =
        authLastSignIns.find((r) => r.id === student.id)?.last_sign_in_at ??
        null;
      const courseNames = activeCourses
        .filter((r) => r.student_id === student.id)
        .map((r) => r.course_name);

      return {
        student_id: student.id,
        full_name: student.full_name,
        courses: courseNames,
        login_count: logins.reduce((sum, r) => sum + r.count, 0),
        login_dates: logins.map((r) => ({ date: r.date, count: r.count })),
        last_login_at:
          last.find((r) => r.event_type === "auth.login_succeeded")
            ?.last_at ?? null,
        // Supabase Auth's own record, independent of activity_events — may
        // predate this feature's launch.
        supabase_last_sign_in_at: supabaseLastSignIn,
        lesson_opened_count:
          engagement.find((r) => r.event_type === "lesson.opened")?.count ?? 0,
        last_lesson_opened_at:
          last.find((r) => r.event_type === "lesson.opened")?.last_at ?? null,
        learning_map_opened_count:
          engagement.find((r) => r.event_type === "learning_map.opened")
            ?.count ?? 0,
        last_learning_map_opened_at:
          last.find((r) => r.event_type === "learning_map.opened")?.last_at ??
          null,
        reflection_saved_count:
          engagement.find((r) => r.event_type === "lesson.reflection_saved")
            ?.count ?? 0,
        last_reflection_saved_at:
          last.find((r) => r.event_type === "lesson.reflection_saved")
            ?.last_at ?? null,
        solution_uploaded_count:
          engagement.find((r) => r.event_type === "lesson.solution_uploaded")
            ?.count ?? 0,
        last_solution_uploaded_at:
          last.find((r) => r.event_type === "lesson.solution_uploaded")
            ?.last_at ?? null,
      };
    });

    return c.json(overview);
  })

  // GET /admin-analytics/students/:id/lesson-events — per-lesson timeline
  // (opened / reflection saved / solution uploaded) for one student, so a
  // teacher can expand a row in the overview table instead of only seeing
  // a count.
  .get(
    "/students/:id/lesson-events",
    zValidator("param", uuidParamSchema),
    async (c) => {
      const teacherId = c.get("userId");
      const studentId = c.req.valid("param").id;

      const [owned] = await db
        .select({ id: students.id })
        .from(students)
        .where(
          and(eq(students.id, studentId), eq(students.teacher_id, teacherId))
        )
        .limit(1);
      if (!owned) return c.json({ error: "Student not found" }, 404);

      const rows = await db
        .select({
          event_type: activityEvents.event_type,
          lesson_id: sql<string>`${activityEvents.detail}->>'lesson_id'`,
          occurred_at: activityEvents.created_at,
          lesson_title: lessonSessions.title,
        })
        .from(activityEvents)
        .leftJoin(
          lessonSessions,
          eq(
            lessonSessions.id,
            sql<string>`(${activityEvents.detail}->>'lesson_id')::uuid`
          )
        )
        .where(
          and(
            inArray(activityEvents.event_type, [
              "lesson.opened",
              "lesson.reflection_saved",
              "lesson.solution_uploaded",
            ]),
            eq(activityEvents.student_id, studentId)
          )
        )
        .orderBy(sql`${activityEvents.created_at} desc`);

      return c.json(rows);
    }
  );
