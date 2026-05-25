import { Hono } from "hono";
import { eq, and, inArray, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  students,
  studentCourses,
  courses,
  courseTopics,
  lessonSessions,
  homeworkItems,
  todoItems,
  studentCourseExamDates,
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

    // Resolve which course the map shows. Only ACTIVE course assignments
    // count. Old lesson_sessions still reference archived courses, so we must
    // NOT infer the course from them — otherwise hiding a student's last
    // course would keep surfacing its archived map.
    const activeCourses = await db
      .select({ course_id: studentCourses.course_id })
      .from(studentCourses)
      .where(
        and(
          eq(studentCourses.student_id, studentId),
          eq(studentCourses.is_active, true)
        )
      )
      .orderBy(studentCourses.added_at);
    const activeCourseIds = new Set(activeCourses.map((r) => r.course_id));

    if (courseId) {
      // A provided course_id must be one of the student's active courses;
      // otherwise fall through to the empty/error response below.
      if (!activeCourseIds.has(courseId))
        return c.json({ error: "No course found for student" }, 404);
    } else {
      // No course_id: prefer the student's primary course when it is still
      // active, else the oldest active course. Never infer from old lessons.
      const [student] = await db
        .select({ primary_course_id: students.primary_course_id })
        .from(students)
        .where(eq(students.id, studentId))
        .limit(1);
      if (
        student?.primary_course_id &&
        activeCourseIds.has(student.primary_course_id)
      ) {
        courseId = student.primary_course_id;
      } else if (activeCourses.length > 0) {
        courseId = activeCourses[0]!.course_id;
      } else {
        return c.json({ error: "No course found for student" }, 404);
      }
    }

    // 1. Fetch course
    const [course] = await db
      .select({
        id: courses.id,
        name: courses.name,
        exam_date: courses.exam_date,
      })
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);
    if (!course) return c.json({ error: "Course not found" }, 404);

    // Per-student override (migration 020). When present, it wins over the
    // course-level default — different students may take the same course at
    // different universities or on different mo'eds.
    const [override] = await db
      .select({ exam_date: studentCourseExamDates.exam_date })
      .from(studentCourseExamDates)
      .where(
        and(
          eq(studentCourseExamDates.student_id, studentId),
          eq(studentCourseExamDates.course_id, courseId)
        )
      )
      .limit(1);

    const effectiveExamDate = override?.exam_date ?? course.exam_date;
    const examDateIso = effectiveExamDate
      ? effectiveExamDate.toISOString()
      : null;

    // 2. Fetch all topics for this course (both levels)
    const topics = await db
      .select()
      .from(courseTopics)
      .where(eq(courseTopics.course_id, courseId));

    if (topics.length === 0) {
      return c.json({
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
      )
      // Newest first so the first lesson we see per topic is the latest —
      // used to populate latest_lesson_id for the "open lesson" action.
      .orderBy(desc(lessonSessions.generated_at));

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
    // topic_id -> latest lesson id. `lessons` is ordered newest-first, so the
    // first lesson encountered for a topic is its most recent one.
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
      s.pct = s.tasks_total > 0
        ? Math.round((s.tasks_completed / s.tasks_total) * 100)
        : s.lessons_total > 0
        ? Math.round((s.lessons_completed / s.lessons_total) * 100)
        : 0;
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
      // Locking rules: the teacher's manual switch (is_locked) takes priority,
      // and any unmet explicit prerequisite also locks — either source is
      // enough. Sequential auto-locking was removed in favour of the manual
      // toggle so the teacher decides exactly when each topic opens.
      const explicitLocked = t.prerequisite_topic_ids.some(
        (pid) => topicIdToStats(pid).status !== "mastered"
      );
      const locked = t.is_locked || explicitLocked;
      // Effective deadline: topic-specific date wins, falling back to the
      // course exam date so a topic without its own date still drives
      // urgency on the student's UI. Course exam_date is a timestamptz —
      // strip to YYYY-MM-DD so the frontend gets a uniform date string.
      const effective_deadline =
        t.target_date ?? (effectiveExamDate
          ? effectiveExamDate.toISOString().slice(0, 10)
          : null);
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

    // Sort by order_index
    const sortTree = (arr: LearningMapTopic[]) => {
      arr.sort((a, b) => a.order_index - b.order_index);
      for (const c of arr) sortTree(c.children);
    };
    sortTree(roots);

    // Option B — per-student first-topic unlock:
    // If this student has zero lesson activity in this course (brand-new assignment),
    // force the first root topic (and its first child, if any) to appear unlocked
    // in the response. This does NOT change is_locked in the DB — it's purely
    // a per-student, per-request computation.
    //
    // NOTE: we also check `lessons.length > 0` directly, not just topic-level stats.
    // Stats are aggregated only for lessons that have a topic_id (step 5 above skips
    // lessons where topic_id is null). A student whose lesson_sessions exist but all
    // lack a topic_id would therefore show stats.lessons_total === 0 for every topic,
    // making the stats-only check incorrectly treat them as brand-new — and Option B
    // would fire and unlock the first topic. Checking the raw lessons array first
    // short-circuits that case correctly.
    const hasAnyActivity =
      lessons.length > 0 ||
      allMapTopics.some((t) => t.stats.lessons_total > 0 || t.stats.tasks_total > 0);
    if (!hasAnyActivity && roots.length > 0) {
      // Step 1 — lock every topic in the response unconditionally.
      // Without this, topics whose course_topics.is_locked is false in the DB
      // would be returned as unlocked even though this student has no activity
      // here yet. We override the DB state in-memory; no DB write happens.
      for (const t of allMapTopics) {
        t.locked = true;
      }
      // Step 2 — selectively open exactly the first entry point.
      const firstRoot = roots[0]!;
      firstRoot.locked = false;
      // If the first root is a parent (has children), also unlock its first child
      // so the student has at least one actionable sub-topic visible.
      if (firstRoot.children.length > 0) {
        firstRoot.children[0]!.locked = false;
      }
    }

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
      exam_date: examDateIso,
      student_id: studentId,
      topics: roots,
      overall,
    };

    return c.json(map);
  });
