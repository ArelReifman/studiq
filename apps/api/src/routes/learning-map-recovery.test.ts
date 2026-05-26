import { describe, it, expect, beforeAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const ctx = vi.hoisted(() => ({
  TEACHER_ID: "cccccccc-cccc-cccc-cccc-cccccccccccc",
}));

vi.mock("../db/client.js", async () => {
  const mod = await import("../test/pglite-db.js");
  return { db: mod.testDb };
});

vi.mock("../middleware/auth.js", () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set("userId", ctx.TEACHER_ID);
    c.set("userRole", "teacher");
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

import { initTestDb, testDb } from "../test/pglite-db.js";
import { learningMapRoutes } from "./learning-map.js";
import {
  profiles,
  teachers,
  students,
  courses,
  courseTopics,
  studentCourses,
  lessonSessions,
  homeworkItems,
  todoItems,
} from "../db/schema.js";

const T0 = new Date("2026-01-01T10:00:00Z");
const T1 = new Date("2026-01-02T10:00:00Z");
const T2 = new Date("2026-01-03T10:00:00Z");
const T3 = new Date("2026-01-04T10:00:00Z");

async function seedStudent(studentId: string, primaryCourseId: string) {
  await testDb.insert(profiles).values({
    id: studentId,
    role: "student",
    full_name: "Recovery Student",
    email: `${studentId}@test.dev`,
  });
  await testDb.insert(students).values({
    id: studentId,
    teacher_id: ctx.TEACHER_ID,
    primary_course_id: primaryCourseId,
  });
}

async function seedCourseWithStudent(sid: string, cid: string) {
  await testDb
    .insert(courses)
    .values({ id: cid, teacher_id: ctx.TEACHER_ID, name: "Course" });
  await testDb
    .insert(studentCourses)
    .values({ student_id: sid, course_id: cid, is_active: true });
}

async function seedTopic(
  cid: string,
  tid: string,
  parent: string | null = null
) {
  await testDb.insert(courseTopics).values({
    id: tid,
    course_id: cid,
    name: parent ? "Sub" : "Topic",
    parent_topic_id: parent,
  });
}

async function insertLesson(
  sid: string,
  cid: string,
  tid: string,
  opts: {
    status?: "active" | "completed" | "archived";
    completed_at?: Date | null;
    teacher_decision?: "repeat" | "next_level" | "next_topic" | null;
    teacher_reviewed_at?: Date | null;
    generated_at?: Date;
  } = {}
) {
  const id = randomUUID();
  await testDb.insert(lessonSessions).values({
    id,
    student_id: sid,
    teacher_id: ctx.TEACHER_ID,
    title: "Lesson",
    course_id: cid,
    topic_id: tid,
    status: opts.status ?? "active",
    completed_at: opts.completed_at ?? null,
    teacher_decision: opts.teacher_decision ?? null,
    teacher_reviewed_at: opts.teacher_reviewed_at ?? null,
    generated_at: opts.generated_at ?? T0,
  });
  return id;
}

async function insertHomework(
  lessonId: string,
  sid: string,
  status: "pending" | "completed" | "failed",
  marked_at: Date | null
) {
  const id = randomUUID();
  await testDb.insert(homeworkItems).values({
    id,
    lesson_id: lessonId,
    student_id: sid,
    title: "HW",
    status,
    marked_at,
  });
  return id;
}

async function insertTodo(
  lessonId: string,
  sid: string,
  status: "pending" | "completed" | "failed",
  marked_at: Date | null
) {
  const id = randomUUID();
  await testDb.insert(todoItems).values({
    id,
    lesson_id: lessonId,
    student_id: sid,
    title: "Todo",
    status,
    marked_at,
  });
  return id;
}

async function getMap(sid: string, cid: string) {
  const res = await learningMapRoutes.request(
    `/?student_id=${sid}&course_id=${cid}`
  );
  expect(res.status).toBe(200);
  return (await res.json()) as {
    topics: Array<{
      id: string;
      stats: {
        tasks_total: number;
        tasks_completed: number;
        tasks_failed: number;
        pct: number;
        status: string;
      };
      children: any[];
    }>;
  };
}

function findTopic(map: Awaited<ReturnType<typeof getMap>>, tid: string) {
  for (const t of map.topics) {
    if (t.id === tid) return t;
    for (const c of t.children) if (c.id === tid) return c;
  }
  return undefined;
}

async function freshScenario() {
  const sid = randomUUID();
  const cid = randomUUID();
  const tid = randomUUID();
  await seedStudent(sid, cid);
  await seedCourseWithStudent(sid, cid);
  await seedTopic(cid, tid);
  return { sid, cid, tid };
}

describe("learning map — active failure recovery", () => {
  beforeAll(async () => {
    await initTestDb();
    await testDb.insert(profiles).values({
      id: ctx.TEACHER_ID,
      role: "teacher",
      full_name: "Recovery Teacher",
      email: "teacher-recovery@test.dev",
    });
    await testDb.insert(teachers).values({ id: ctx.TEACHER_ID });
  });

  it("1. failed task creates an active failure", async () => {
    const { sid, cid, tid } = await freshScenario();
    const lesson = await insertLesson(sid, cid, tid);
    await insertHomework(lesson, sid, "failed", T1);

    const map = await getMap(sid, cid);
    const stats = findTopic(map, tid)!.stats;
    expect(stats.tasks_failed).toBe(1);
    expect(stats.status).toBe("struggling");
  });

  it("2. later completed task in same topic clears active failure", async () => {
    const { sid, cid, tid } = await freshScenario();
    const lesson = await insertLesson(sid, cid, tid);
    await insertHomework(lesson, sid, "failed", T1);
    await insertHomework(lesson, sid, "completed", T2);

    const stats = findTopic(await getMap(sid, cid), tid)!.stats;
    expect(stats.tasks_failed).toBe(0);
    expect(stats.tasks_completed).toBe(1);
    expect(stats.status).not.toBe("struggling");
  });

  it("3. failed subtopic + later success in same subtopic clears active failure", async () => {
    const sid = randomUUID();
    const cid = randomUUID();
    const parent = randomUUID();
    const child = randomUUID();
    await seedStudent(sid, cid);
    await seedCourseWithStudent(sid, cid);
    await seedTopic(cid, parent);
    await seedTopic(cid, child, parent);

    const lesson = await insertLesson(sid, cid, child);
    await insertTodo(lesson, sid, "failed", T1);
    await insertTodo(lesson, sid, "completed", T2);

    const stats = findTopic(await getMap(sid, cid), child)!.stats;
    expect(stats.tasks_failed).toBe(0);
    expect(stats.tasks_completed).toBe(1);
  });

  it("4. success in sibling subtopic does not clear failure", async () => {
    const sid = randomUUID();
    const cid = randomUUID();
    const parent = randomUUID();
    const s1 = randomUUID();
    const s2 = randomUUID();
    await seedStudent(sid, cid);
    await seedCourseWithStudent(sid, cid);
    await seedTopic(cid, parent);
    await seedTopic(cid, s1, parent);
    await seedTopic(cid, s2, parent);

    const lessonS1 = await insertLesson(sid, cid, s1);
    await insertHomework(lessonS1, sid, "failed", T1);

    const lessonS2 = await insertLesson(sid, cid, s2);
    await insertHomework(lessonS2, sid, "completed", T2);

    const map = await getMap(sid, cid);
    const s1Stats = findTopic(map, s1)!.stats;
    const s2Stats = findTopic(map, s2)!.stats;
    expect(s1Stats.tasks_failed).toBe(1);
    expect(s2Stats.tasks_failed).toBe(0);
    expect(s2Stats.tasks_completed).toBe(1);
  });

  it("5. completed lesson in same topic clears a previous failed task", async () => {
    const { sid, cid, tid } = await freshScenario();
    const failedLesson = await insertLesson(sid, cid, tid, { generated_at: T0 });
    await insertHomework(failedLesson, sid, "failed", T1);

    // A second, later lesson for the same topic is completed at T2.
    await insertLesson(sid, cid, tid, {
      status: "completed",
      completed_at: T2,
      generated_at: T2,
    });

    const stats = findTopic(await getMap(sid, cid), tid)!.stats;
    expect(stats.tasks_failed).toBe(0);
  });

  it("6. teacher_decision = next_level clears a previous failed task", async () => {
    const { sid, cid, tid } = await freshScenario();
    const failedLesson = await insertLesson(sid, cid, tid, { generated_at: T0 });
    await insertHomework(failedLesson, sid, "failed", T1);

    await insertLesson(sid, cid, tid, {
      status: "active",
      teacher_decision: "next_level",
      teacher_reviewed_at: T2,
      generated_at: T2,
    });

    const stats = findTopic(await getMap(sid, cid), tid)!.stats;
    expect(stats.tasks_failed).toBe(0);
  });

  it("7. failed row still exists in DB after being resolved in the map", async () => {
    const { sid, cid, tid } = await freshScenario();
    const lesson = await insertLesson(sid, cid, tid);
    const failedId = await insertHomework(lesson, sid, "failed", T1);
    await insertHomework(lesson, sid, "completed", T2);

    const stats = findTopic(await getMap(sid, cid), tid)!.stats;
    expect(stats.tasks_failed).toBe(0);

    // History is preserved — the original failed row is still in the DB.
    const [row] = await testDb
      .select({ id: homeworkItems.id, status: homeworkItems.status })
      .from(homeworkItems)
      .where(eq(homeworkItems.id, failedId));
    expect(row?.status).toBe("failed");
  });

  it("8. success before failure does not clear the later failure", async () => {
    const { sid, cid, tid } = await freshScenario();
    const lesson = await insertLesson(sid, cid, tid);
    await insertHomework(lesson, sid, "completed", T1);
    await insertHomework(lesson, sid, "failed", T2);

    const stats = findTopic(await getMap(sid, cid), tid)!.stats;
    expect(stats.tasks_failed).toBe(1);
  });

  it("9. failed task with null marked_at stays active (fail-safe)", async () => {
    const { sid, cid, tid } = await freshScenario();
    const lesson = await insertLesson(sid, cid, tid);
    await insertHomework(lesson, sid, "completed", T3); // recent success
    await insertHomework(lesson, sid, "failed", null); // null timestamp

    const stats = findTopic(await getMap(sid, cid), tid)!.stats;
    expect(stats.tasks_failed).toBe(1);
  });
});
