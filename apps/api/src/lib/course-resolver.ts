/**
 * Resolves a human-readable course name for a booking.
 *
 * Used by both the booking route (Telegram notifications, GCal via PATCH /:id)
 * and the calendar-sync worker (GCal event title for batch approvals and
 * teacher-created lessons). Extracted here to avoid a circular import between
 * bookings.ts (which imports calendar-sync-worker) and calendar-sync-worker
 * (which would otherwise need to import from bookings.ts).
 *
 * Resolution order:
 *   1. courseId parameter — explicit course set at lesson creation (Phase 2.2+)
 *   2. student.primary_course_id — legacy single-course default
 *   3. sole active entry in student_courses — no primary set, exactly one
 *      active course (archived courses excluded)
 *
 * Returns "" when the course cannot be determined (e.g. a multi-course student
 * without an explicit booking course_id). Callers treat "" as "omit course from
 * title/message". Never throws — a missing name degrades gracefully.
 */

import { db } from "../db/client.js";
import { courses, students, studentCourses } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

export async function resolveCourseName(
  courseId: string | null | undefined,
  studentId: string
): Promise<string> {
  // Path 1: explicit course_id on this booking
  if (courseId) {
    const [row] = await db
      .select({ name: courses.name })
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);
    return row?.name ?? "";
  }

  // Path 2: student's primary_course_id (backward-compat for older lessons)
  const [student] = await db
    .select({ primary_course_id: students.primary_course_id })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);

  if (student?.primary_course_id) {
    const [row] = await db
      .select({ name: courses.name })
      .from(courses)
      .where(eq(courses.id, student.primary_course_id))
      .limit(1);
    return row?.name ?? "";
  }

  // Path 3: sole active entry in student_courses (no primary set, exactly one
  // active course). Archived courses (is_active = false) are excluded so they
  // don't inflate the count and suppress name resolution for live courses.
  const sc = await db
    .select({ course_id: studentCourses.course_id })
    .from(studentCourses)
    .where(
      and(
        eq(studentCourses.student_id, studentId),
        eq(studentCourses.is_active, true)
      )
    );

  if (sc.length === 1) {
    const [row] = await db
      .select({ name: courses.name })
      .from(courses)
      .where(eq(courses.id, sc[0]!.course_id))
      .limit(1);
    return row?.name ?? "";
  }

  return "";
}
