import { Hono } from "hono";
import { eq, and, inArray, desc, isNotNull } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  students,
  courses,
  courseTopics,
  lessonSessions,
  homeworkItems,
  todoItems,
} from "../db/schema.js";
import { authMiddleware } from "../middleware/auth.js";
import { zValidator } from "@hono/zod-validator";
import { learningMapQuerySchema } from "../lib/validators.js";
import type {
  LearningMap,
  LearningMapTopic,
  TopicStats,
  TopicStatus,
} from "@studiq/types";

function computeStatus(s: {
  tasks_total: number;
  tasks_completed: number;
  tasks_failed: number;
}): TopicStatus {
  if (s.tasks_total === 0) return "not_started";
  if (s.tasks_failed > 0 && s.tasks_completed < s.tasks_total / 2)
    return "struggling";
  if (s.tasks_completed === s.tasks_total && s.tasks_failed === 0)
    return "mastered";
  return "in_progress";
}

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

    // If no course_id provided, infer from most-recent lesson
    if (!courseId) {
      const [latest] = await db
        .select({ course_id: lessonSessions.course_id })
        .from(lessonSessions)
        .where(
          and(
            eq(lessonSessions.student_id, studentId),
            isNotNull(lessonSessions.course_id)
          )
        )
        .orderBy(desc(lessonSessions.generated_at))
        .limit(1);
      if (!latest?.course_id)
        return c.json({ error: "No course found for student" }, 404);
      courseId = latest.course_id;
    }

    // 1. Fetch course
    const [course] = await db
      .select({ id: courses.id, name: courses.name })
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);
    if (!course) return c.json({ error: "Course not found" }, 404);

    // 2. Fetch all topics for this course (both levels)
    const topics = await db
      .select()
      .from(courseTopics)
      .where(eq(courseTopics.course_id, courseId));

    if (topics.length === 0) {
      return c.json({
        course_id: course.id,
        course_name: course.name,
        student_id: studentId,
        topics: [],
        overall: {
          total_topics: 0,
          mastered: 0,
          in_progress: 0,
          struggling: 0,
          overall_pct: 0,
        },
      } satisfies LearningMap);
    }

    // 3. Fetch this student's lessons for this course
    const lessons = await db
      .select({
        id: lessonSessions.id,
        topic_id: lessonSessions.topic_id,
        status: lessonSessions.status,
      })
      .from(lessonSessions)
      .where(
        and(
          eq(lessonSessions.student_id, studentId),
          eq(lessonSessions.course_id, courseId)
        )
      );

    const lessonIds = lessons.map((l) => l.id);

    // 4. Fetch homework + todos for those lessons
    const [hw, td] = await Promise.all([
      lessonIds.length
        ? db
            .select({
              lesson_id: homeworkItems.lesson_id,
              status: homeworkItems.status,
            })
            .from(homeworkItems)
            .where(inArray(homeworkItems.lesson_id, lessonIds))
        : Promise.resolve([]),
      lessonIds.length
        ? db
            .select({
              lesson_id: todoItems.lesson_id,
              status: todoItems.status,
            })
            .from(todoItems)
            .where(inArray(todoItems.lesson_id, lessonIds))
        : Promise.resolve([]),
    ]);

    // 5. Aggregate stats per topic_id
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

    // Map lesson_id -> topic_id for task aggregation
    const lessonTopicMap = new Map<string, string | null>();
    for (const l of lessons) {
      lessonTopicMap.set(l.id, l.topic_id);
      if (!l.topic_id) continue;
      const s = ensureStats(l.topic_id);
      s.lessons_total++;
      if (l.status === "completed") s.lessons_completed++;
    }

    const aggregateTask = (lesson_id: string, status: string) => {
      const tid = lessonTopicMap.get(lesson_id);
      if (!tid) return;
      const s = ensureStats(tid);
      s.tasks_total++;
      if (status === "completed") s.tasks_completed++;
      else if (status === "failed") s.tasks_failed++;
    };

    for (const h of hw) aggregateTask(h.lesson_id, h.status);
    for (const t of td) aggregateTask(t.lesson_id, t.status);

    // 6. Compute pct + status per topic
    for (const s of statsByTopic.values()) {
      s.pct = s.tasks_total === 0
        ? 0
        : Math.round((s.tasks_completed / s.tasks_total) * 100);
      s.status = computeStatus(s);
    }

    // 7. Determine locked state (prereqs not mastered)
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

    const topicById = new Map(topics.map((t) => [t.id, t]));

    // 8. Build tree
    const asMapTopic = (t: typeof topics[number]): LearningMapTopic => {
      const stats = topicIdToStats(t.id);
      const locked = t.prerequisite_topic_ids.some(
        (pid) => topicIdToStats(pid).status !== "mastered"
      );
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        order_index: t.order_index,
        parent_topic_id: t.parent_topic_id,
        is_shared: t.is_shared,
        prerequisite_topic_ids: t.prerequisite_topic_ids,
        locked,
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

    // Sort by order_index
    const sortTree = (arr: LearningMapTopic[]) => {
      arr.sort((a, b) => a.order_index - b.order_index);
      for (const c of arr) sortTree(c.children);
    };
    sortTree(roots);

    // 9. Overall stats (top-level only)
    const overall = {
      total_topics: roots.length,
      mastered: roots.filter((r) => r.stats.status === "mastered").length,
      in_progress: roots.filter((r) => r.stats.status === "in_progress")
        .length,
      struggling: roots.filter((r) => r.stats.status === "struggling").length,
      overall_pct:
        roots.length === 0
          ? 0
          : Math.round(
              roots.reduce((acc, r) => acc + r.stats.pct, 0) / roots.length
            ),
    };

    // Silence unused warning from topicById import
    void topicById;

    const map: LearningMap = {
      course_id: course.id,
      course_name: course.name,
      student_id: studentId,
      topics: roots,
      overall,
    };

    return c.json(map);
  });
