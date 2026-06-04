/**
 * Picks the course + topic an AI-generated lesson should be anchored to.
 *
 * NOT a progress calculator. The authoritative mastery / locking logic lives
 * in learning-map.ts and is the single source of truth per
 * docs/LEARNING_MAP_CONTRACT.md. This is a deliberately simple
 * "starting-point picker" used only as a FALLBACK when the caller does not
 * pass an explicit topic_id. An explicit topic_id always wins.
 *
 * The fallback relies on the teacher's `is_locked` gate (the primary gate —
 * see migration 017, which locks every topic by default) plus "no completed
 * lesson yet". It does NOT evaluate `prerequisite_topic_ids` mastery — that is
 * the map's job. This is acceptable because the fallback is temporary: once
 * the UI sends an explicit topic_id, this branch is never reached. If the
 * fallback proves too coarse, Phase AI-1.5 will extract a shared
 * computeLearningMap() and call it here.
 */
import { eq, and, asc } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  students,
  studentCourses,
  courseTopics,
  lessonSessions,
} from "../../db/schema.js";

export type ResolveTopicResult =
  | { ok: true; courseId: string; topicId: string | null }
  | { ok: false; reason: "no_course" | "topic_mismatch" };

export async function resolveTopic(
  studentId: string,
  opts: { explicitTopicId?: string | null } = {}
): Promise<ResolveTopicResult> {
  // 1. Resolve course — same rule as learning-map.ts: the primary course when
  //    it is still active, else the oldest active course. Never infer from old
  //    lessons (they may point at archived courses).
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
      .orderBy(asc(studentCourses.added_at)),
    db
      .select({ primary_course_id: students.primary_course_id })
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1),
  ]);

  const activeIds = new Set(activeCourses.map((r) => r.course_id));
  const primary = primaryRows[0]?.primary_course_id ?? null;

  let courseId: string | null = null;
  if (primary && activeIds.has(primary)) courseId = primary;
  else if (activeCourses.length > 0) courseId = activeCourses[0]!.course_id;

  if (!courseId) return { ok: false, reason: "no_course" };

  // 2. Explicit topic_id wins — but it must belong to the resolved course.
  //    A mismatch is a caller error (400), not a silent fallback.
  if (opts.explicitTopicId) {
    const [t] = await db
      .select({ id: courseTopics.id })
      .from(courseTopics)
      .where(
        and(
          eq(courseTopics.id, opts.explicitTopicId),
          eq(courseTopics.course_id, courseId)
        )
      )
      .limit(1);
    if (!t) return { ok: false, reason: "topic_mismatch" };
    return { ok: true, courseId, topicId: t.id };
  }

  // 3. Fallback: first unlocked topic (by order_index) that has no completed
  //    lesson yet. If every unlocked topic is done, pick the last one (the
  //    student is at/near the end — keep reinforcing). If there are no unlocked
  //    topics at all, anchor to the course only (topicId = null is valid per
  //    the contract — the lesson still counts toward the course).
  const topics = await db
    .select({ id: courseTopics.id })
    .from(courseTopics)
    .where(
      and(
        eq(courseTopics.course_id, courseId),
        eq(courseTopics.is_locked, false)
      )
    )
    .orderBy(asc(courseTopics.order_index));

  if (topics.length === 0) return { ok: true, courseId, topicId: null };

  const completed = await db
    .select({ topic_id: lessonSessions.topic_id })
    .from(lessonSessions)
    .where(
      and(
        eq(lessonSessions.student_id, studentId),
        eq(lessonSessions.course_id, courseId),
        eq(lessonSessions.status, "completed")
      )
    );
  const completedTopicIds = new Set(
    completed.map((r) => r.topic_id).filter((id): id is string => !!id)
  );

  const firstUnfinished = topics.find((t) => !completedTopicIds.has(t.id));
  const chosen = firstUnfinished ?? topics[topics.length - 1]!;
  return { ok: true, courseId, topicId: chosen.id };
}
