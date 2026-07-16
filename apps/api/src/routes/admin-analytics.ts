import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { students, profiles, activityEvents } from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

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

    const [loginsByDate, engagementCounts] = await Promise.all([
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
            sql`${activityEvents.student_id} = any(${studentIds})`
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
            sql`${activityEvents.event_type} in ('lesson.opened', 'learning_map.opened')`,
            sql`${activityEvents.student_id} = any(${studentIds})`
          )
        )
        .groupBy(activityEvents.student_id, activityEvents.event_type),
    ]);

    const overview = myStudents.map((student) => {
      const logins = loginsByDate.filter((r) => r.student_id === student.id);
      const engagement = engagementCounts.filter(
        (r) => r.student_id === student.id
      );

      return {
        student_id: student.id,
        full_name: student.full_name,
        login_count: logins.reduce((sum, r) => sum + r.count, 0),
        login_dates: logins.map((r) => ({ date: r.date, count: r.count })),
        lesson_opened_count:
          engagement.find((r) => r.event_type === "lesson.opened")?.count ?? 0,
        learning_map_opened_count:
          engagement.find((r) => r.event_type === "learning_map.opened")
            ?.count ?? 0,
      };
    });

    return c.json(overview);
  });
