import { eq, and, inArray, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  courses,
  courseTopics,
  lessonSessions,
  homeworkItems,
  todoItems,
  studentCourseExamDates,
  studentTopicLocks,
} from "../db/schema.js";
import type { LearningMap, LearningMapTopic, TopicStats, TopicStatus } from "@studiq/types";

export function computeStatus(s: {
  lessons_total: number;
  lessons_completed: number;
  tasks_total: number;
  tasks_completed: number;
  tasks_failed: number;
}): TopicStatus {
  // When there are tasks, status is driven by task completion.
  if (s.tasks_total > 0) {
    if (s.tasks_failed > 0 && s.tasks_completed < s.tasks_total / 2)
      return "struggling";
    if (s.tasks_completed === s.tasks_total && s.tasks_failed === 0)
      return "mastered";
    return "in_progress";
  }
  // No tasks — fall back to lesson completion.
  if (s.lessons_total === 0) return "not_started";
  if (s.lessons_completed === s.lessons_total) return "mastered";
  if (s.lessons_completed > 0) return "in_progress";
  return "not_started";
}

/**
 * Builds the full learning-map tree for a given (courseId, studentId) —
 * everything the GET /learning-map route does once courseId is already
 * resolved. Extracted so callers other than the route (e.g. report
 * generation) can reuse the same mastery computation instead of
 * re-implementing it. Returns null when the course or its topics don't
 * exist, mirroring the route's 404 cases.
 */
export async function getLearningMap(
  courseId: string,
  studentId: string
): Promise<LearningMap | null> {
  const [courseRows, overrideRows, topics, lessons, lockOverrideRows] =
    await Promise.all([
      db
        .select({
          id: courses.id,
          name: courses.name,
          exam_date: courses.exam_date,
        })
        .from(courses)
        .where(eq(courses.id, courseId))
        .limit(1),
      db
        .select({ exam_date: studentCourseExamDates.exam_date })
        .from(studentCourseExamDates)
        .where(
          and(
            eq(studentCourseExamDates.student_id, studentId),
            eq(studentCourseExamDates.course_id, courseId)
          )
        )
        .limit(1),
      db.select().from(courseTopics).where(eq(courseTopics.course_id, courseId)),
      db
        .select({
          id: lessonSessions.id,
          topic_id: lessonSessions.topic_id,
          status: lessonSessions.status,
          completed_at: lessonSessions.completed_at,
          teacher_decision: lessonSessions.teacher_decision,
          teacher_reviewed_at: lessonSessions.teacher_reviewed_at,
        })
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.student_id, studentId),
            eq(lessonSessions.course_id, courseId)
          )
        )
        .orderBy(desc(lessonSessions.generated_at)),
      db
        .select({
          topic_id: studentTopicLocks.topic_id,
          is_locked: studentTopicLocks.is_locked,
        })
        .from(studentTopicLocks)
        .where(eq(studentTopicLocks.student_id, studentId)),
    ]);

  const [course] = courseRows;
  if (!course) return null;
  const [override] = overrideRows;

  const effectiveExamDate = override?.exam_date ?? course.exam_date;
  const examDateIso = effectiveExamDate ? effectiveExamDate.toISOString() : null;

  if (topics.length === 0) {
    return {
      course_id: course.id,
      course_name: course.name,
      exam_date: examDateIso,
      student_id: studentId,
      topics: [],
      overall: {
        total_topics: 0,
        mastered: 0,
        in_progress: 0,
        struggling: 0,
        overall_pct: 0,
      },
    } satisfies LearningMap;
  }

  const lessonIds = lessons.map((l) => l.id);

  const [hw, td] = await Promise.all([
    lessonIds.length
      ? db
          .select({
            lesson_id: homeworkItems.lesson_id,
            status: homeworkItems.status,
            marked_at: homeworkItems.marked_at,
          })
          .from(homeworkItems)
          .where(inArray(homeworkItems.lesson_id, lessonIds))
      : Promise.resolve([]),
    lessonIds.length
      ? db
          .select({
            lesson_id: todoItems.lesson_id,
            status: todoItems.status,
            marked_at: todoItems.marked_at,
          })
          .from(todoItems)
          .where(inArray(todoItems.lesson_id, lessonIds))
      : Promise.resolve([]),
  ]);

  const statsByTopic = new Map<string, TopicStats>();

  const ensureStats = (id: string): TopicStats => {
    let s = statsByTopic.get(id);
    if (!s) {
      s = {
        lessons_total: 0,
        lessons_completed: 0,
        tasks_total: 0,
        tasks_completed: 0,
        tasks_failed: 0,
        pct: 0,
        status: "not_started",
      };
      statsByTopic.set(id, s);
    }
    return s;
  };

  const lessonTopicMap = new Map<string, string | null>();
  const latestLessonByTopic = new Map<string, string>();
  for (const l of lessons) {
    lessonTopicMap.set(l.id, l.topic_id);
    if (!l.topic_id) continue;
    if (!latestLessonByTopic.has(l.topic_id))
      latestLessonByTopic.set(l.topic_id, l.id);
    const s = ensureStats(l.topic_id);
    s.lessons_total++;
    if (l.status === "completed") s.lessons_completed++;
  }

  const latestSuccessByTopic = new Map<string, number>();
  const noteSuccess = (tid: string | null | undefined, at: Date | null) => {
    if (!tid || !at) return;
    const ts = at.getTime();
    const prev = latestSuccessByTopic.get(tid);
    if (prev === undefined || ts > prev) latestSuccessByTopic.set(tid, ts);
  };
  for (const l of lessons) {
    if (!l.topic_id) continue;
    if (l.status === "completed") noteSuccess(l.topic_id, l.completed_at);
    if (l.teacher_decision === "next_level" || l.teacher_decision === "next_topic")
      noteSuccess(l.topic_id, l.teacher_reviewed_at);
  }
  for (const h of hw) {
    if (h.status === "completed")
      noteSuccess(lessonTopicMap.get(h.lesson_id), h.marked_at);
  }
  for (const t of td) {
    if (t.status === "completed")
      noteSuccess(lessonTopicMap.get(t.lesson_id), t.marked_at);
  }

  const isResolvedFailure = (tid: string, marked_at: Date | null) => {
    if (!marked_at) return false;
    const latest = latestSuccessByTopic.get(tid);
    if (latest === undefined) return false;
    return marked_at.getTime() <= latest;
  };

  const aggregateTask = (lesson_id: string, status: string, marked_at: Date | null) => {
    const tid = lessonTopicMap.get(lesson_id);
    if (!tid) return;
    const s = ensureStats(tid);
    s.tasks_total++;
    if (status === "completed") s.tasks_completed++;
    else if (status === "failed") {
      if (isResolvedFailure(tid, marked_at)) s.tasks_completed++;
      else s.tasks_failed++;
    }
  };

  for (const h of hw) aggregateTask(h.lesson_id, h.status, h.marked_at);
  for (const t of td) aggregateTask(t.lesson_id, t.status, t.marked_at);

  for (const s of statsByTopic.values()) {
    s.pct =
      s.tasks_total > 0
        ? Math.round((s.tasks_completed / s.tasks_total) * 100)
        : s.lessons_total > 0
          ? Math.round((s.lessons_completed / s.lessons_total) * 100)
          : 0;
    s.status = computeStatus(s);
  }

  const topicIdToStats = (id: string): TopicStats =>
    statsByTopic.get(id) ?? {
      lessons_total: 0,
      lessons_completed: 0,
      tasks_total: 0,
      tasks_completed: 0,
      tasks_failed: 0,
      pct: 0,
      status: "not_started",
    };

  const lockOverrides = new Map(lockOverrideRows.map((r) => [r.topic_id, r.is_locked]));

  const asMapTopic = (t: (typeof topics)[number]): LearningMapTopic => {
    const stats = topicIdToStats(t.id);
    const override = lockOverrides.get(t.id);
    const baseLocked = override ?? t.is_locked;
    const explicitLocked = t.prerequisite_topic_ids.some(
      (pid) => topicIdToStats(pid).status !== "mastered"
    );
    const locked = baseLocked || explicitLocked;
    const effective_deadline =
      t.target_date ??
      (effectiveExamDate ? effectiveExamDate.toISOString().slice(0, 10) : null);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      order_index: t.order_index,
      parent_topic_id: t.parent_topic_id,
      is_shared: t.is_shared,
      prerequisite_topic_ids: t.prerequisite_topic_ids,
      locked,
      effective_deadline,
      latest_lesson_id: latestLessonByTopic.get(t.id) ?? null,
      stats,
      children: [],
    };
  };

  const allMapTopics = topics.map(asMapTopic);
  const byId = new Map(allMapTopics.map((t) => [t.id, t]));

  const roots: LearningMapTopic[] = [];
  for (const t of allMapTopics) {
    if (t.parent_topic_id && byId.has(t.parent_topic_id)) {
      byId.get(t.parent_topic_id)!.children.push(t);
    } else {
      roots.push(t);
    }
  }

  const sortTree = (arr: LearningMapTopic[]) => {
    arr.sort((a, b) => a.order_index - b.order_index);
    for (const c of arr) sortTree(c.children);
  };
  sortTree(roots);

  const hasAnyActivity =
    lessons.length > 0 ||
    allMapTopics.some((t) => t.stats.lessons_total > 0 || t.stats.tasks_total > 0);
  if (!hasAnyActivity && roots.length > 0) {
    for (const t of allMapTopics) {
      t.locked = true;
    }
    const firstRoot = roots[0]!;
    firstRoot.locked = false;
    if (firstRoot.children.length > 0) {
      firstRoot.children[0]!.locked = false;
    }
  }

  const rollupStats = (node: LearningMapTopic) => {
    if (node.children.length === 0) return;
    for (const child of node.children) rollupStats(child);
    for (const child of node.children) {
      node.stats.lessons_total += child.stats.lessons_total;
      node.stats.lessons_completed += child.stats.lessons_completed;
      node.stats.tasks_total += child.stats.tasks_total;
      node.stats.tasks_completed += child.stats.tasks_completed;
      node.stats.tasks_failed += child.stats.tasks_failed;
    }
    node.stats.pct =
      node.stats.tasks_total > 0
        ? Math.round((node.stats.tasks_completed / node.stats.tasks_total) * 100)
        : node.stats.lessons_total > 0
          ? Math.round((node.stats.lessons_completed / node.stats.lessons_total) * 100)
          : 0;
    node.stats.status = computeStatus(node.stats);
  };
  for (const r of roots) rollupStats(r);

  const overall = {
    total_topics: roots.length,
    mastered: roots.filter((r) => r.stats.status === "mastered").length,
    in_progress: roots.filter((r) => r.stats.status === "in_progress").length,
    struggling: roots.filter((r) => r.stats.status === "struggling").length,
    overall_pct:
      roots.length === 0
        ? 0
        : Math.round(roots.reduce((acc, r) => acc + r.stats.pct, 0) / roots.length),
  };

  return {
    course_id: course.id,
    course_name: course.name,
    exam_date: examDateIso,
    student_id: studentId,
    topics: roots,
    overall,
  } satisfies LearningMap;
}

/** Flattens a learning-map tree (roots + all descendants) into a flat list. */
export function flattenLearningMapTopics(topics: LearningMapTopic[]): LearningMapTopic[] {
  const out: LearningMapTopic[] = [];
  const walk = (nodes: LearningMapTopic[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children.length > 0) walk(n.children);
    }
  };
  walk(topics);
  return out;
}
