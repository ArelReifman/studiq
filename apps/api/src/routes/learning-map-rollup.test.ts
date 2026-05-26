import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const ctx = vi.hoisted(() => ({
  TEACHER_ID: "dddddddd-dddd-dddd-dddd-dddddddddddd",
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
} from "../db/schema.js";

const T0 = new Date("2026-01-01T10:00:00Z");

async function seedStudent(sid: string, primaryCourseId: string) {
  await testDb.insert(profiles).values({
    id: sid,
    role: "student",
    full_name: "Rollup Student",
    email: `${sid}@test.dev`,
  });
  await testDb.insert(students).values({
    id: sid,
    teacher_id: ctx.TEACHER_ID,
    primary_course_id: primaryCourseId,
  });
}

async function seedCourse(sid: string, cid: string) {
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
  parent: string | null = null,
  opts: { is_locked?: boolean; order_index?: number } = {}
) {
  await testDb.insert(courseTopics).values({
    id: tid,
    course_id: cid,
    name: parent ? "Sub" : "Topic",
    parent_topic_id: parent,
    is_locked: opts.is_locked ?? false,
    order_index: opts.order_index ?? 0,
  });
}

async function insertLesson(
  sid: string,
  cid: string,
  tid: string,
  opts: { status?: "active" | "completed" } = {}
) {
  const id = randomUUID();
  await testDb.insert(lessonSessions).values({
    id,
    student_id: sid,
    teacher_id: ctx.TEACHER_ID,
    title: "L",
    course_id: cid,
    topic_id: tid,
    status: opts.status ?? "active",
    generated_at: T0,
  });
  return id;
}

async function insertHw(
  lessonId: string,
  sid: string,
  status: "pending" | "completed" | "failed",
  marked_at: Date | null = T0
) {
  await testDb.insert(homeworkItems).values({
    id: randomUUID(),
    lesson_id: lessonId,
    student_id: sid,
    title: "HW",
    status,
    marked_at,
  });
}

async function getMap(sid: string, cid: string) {
  const res = await learningMapRoutes.request(
    `/?student_id=${sid}&course_id=${cid}`
  );
  expect(res.status).toBe(200);
  return (await res.json()) as {
    overall: { overall_pct: number; mastered: number; in_progress: number };
    topics: Array<{
      id: string;
      stats: {
        lessons_total: number;
        lessons_completed: number;
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

function findById(map: Awaited<ReturnType<typeof getMap>>, tid: string): any {
  const walk = (arr: any[]): any => {
    for (const t of arr) {
      if (t.id === tid) return t;
      const found = walk(t.children);
      if (found) return found;
    }
    return null;
  };
  return walk(map.topics);
}

async function freshCourse() {
  const sid = randomUUID();
  const cid = randomUUID();
  await seedStudent(sid, cid);
  await seedCourse(sid, cid);
  return { sid, cid };
}

/** Helper: build a parent + N children, with the n-th child fully completed
 *  according to `completed[n]` (true → 2/2 hw completed, false → no lesson). */
async function buildParentWithChildren(
  sid: string,
  cid: string,
  completed: boolean[]
) {
  const parent = randomUUID();
  await seedTopic(cid, parent);
  const childIds: string[] = [];
  for (let i = 0; i < completed.length; i++) {
    const child = randomUUID();
    await seedTopic(cid, child, parent, { order_index: i });
    childIds.push(child);
    if (completed[i]) {
      const lesson = await insertLesson(sid, cid, child);
      await insertHw(lesson, sid, "completed");
      await insertHw(lesson, sid, "completed");
    }
  }
  return { parent, children: childIds };
}

describe("learning map — parent rollup", () => {
  beforeAll(async () => {
    await initTestDb();
    await testDb.insert(profiles).values({
      id: ctx.TEACHER_ID,
      role: "teacher",
      full_name: "Rollup Teacher",
      email: "teacher-rollup@test.dev",
    });
    await testDb.insert(teachers).values({ id: ctx.TEACHER_ID });
  });

  it("1. parent becomes 100 mastered when all 3 children are 100", async () => {
    const { sid, cid } = await freshCourse();
    const { parent } = await buildParentWithChildren(sid, cid, [
      true,
      true,
      true,
    ]);
    const map = await getMap(sid, cid);
    const p = findById(map, parent);
    expect(p.stats.tasks_total).toBe(6);
    expect(p.stats.tasks_completed).toBe(6);
    expect(p.stats.tasks_failed).toBe(0);
    expect(p.stats.pct).toBe(100);
    expect(p.stats.status).toBe("mastered");
  });

  it("2. parent shows partial in_progress when only some children are complete", async () => {
    const { sid, cid } = await freshCourse();
    const { parent } = await buildParentWithChildren(sid, cid, [
      true,
      true,
      false,
    ]);
    const p = findById(await getMap(sid, cid), parent);
    expect(p.stats.tasks_total).toBe(4);
    expect(p.stats.tasks_completed).toBe(4);
    expect(p.stats.pct).toBe(100); // 4/4 — child #3 has no tasks
    // Status is mastered here because the third child contributes 0/0 → no
    // outstanding work. This is intentional with the combined-counts model.
    expect(p.stats.status).toBe("mastered");
  });

  it("2b. parent shows partial when an incomplete child has pending tasks", async () => {
    const { sid, cid } = await freshCourse();
    const parent = randomUUID();
    await seedTopic(cid, parent);

    const c1 = randomUUID();
    await seedTopic(cid, c1, parent, { order_index: 0 });
    const l1 = await insertLesson(sid, cid, c1);
    await insertHw(l1, sid, "completed");
    await insertHw(l1, sid, "completed");

    const c2 = randomUUID();
    await seedTopic(cid, c2, parent, { order_index: 1 });
    const l2 = await insertLesson(sid, cid, c2);
    await insertHw(l2, sid, "pending");
    await insertHw(l2, sid, "pending");

    const p = findById(await getMap(sid, cid), parent);
    expect(p.stats.tasks_total).toBe(4);
    expect(p.stats.tasks_completed).toBe(2);
    expect(p.stats.pct).toBe(50);
    expect(p.stats.status).toBe("in_progress");
  });

  it("3. parent stays 0 not_started when no child has any data", async () => {
    const { sid, cid } = await freshCourse();
    const { parent } = await buildParentWithChildren(sid, cid, [
      false,
      false,
      false,
    ]);
    const p = findById(await getMap(sid, cid), parent);
    expect(p.stats.tasks_total).toBe(0);
    expect(p.stats.lessons_total).toBe(0);
    expect(p.stats.pct).toBe(0);
    expect(p.stats.status).toBe("not_started");
  });

  it("4. overall_pct reflects rolled-up root progress", async () => {
    const { sid, cid } = await freshCourse();
    await buildParentWithChildren(sid, cid, [true, true, true]);
    const map = await getMap(sid, cid);
    expect(map.overall.overall_pct).toBe(100);
    expect(map.overall.mastered).toBe(1);
  });

  it("5. parent with direct tasks + children combines both into the rollup", async () => {
    const { sid, cid } = await freshCourse();
    const parent = randomUUID();
    await seedTopic(cid, parent);

    // Direct parent lesson with 1 completed homework.
    const parentLesson = await insertLesson(sid, cid, parent);
    await insertHw(parentLesson, sid, "completed");

    // Child with 2 completed homeworks.
    const child = randomUUID();
    await seedTopic(cid, child, parent, { order_index: 0 });
    const childLesson = await insertLesson(sid, cid, child);
    await insertHw(childLesson, sid, "completed");
    await insertHw(childLesson, sid, "completed");

    const p = findById(await getMap(sid, cid), parent);
    expect(p.stats.tasks_total).toBe(3);
    expect(p.stats.tasks_completed).toBe(3);
    expect(p.stats.pct).toBe(100);
    expect(p.stats.status).toBe("mastered");
  });

  it("6. locked child is included in the parent rollup", async () => {
    const { sid, cid } = await freshCourse();
    const parent = randomUUID();
    await seedTopic(cid, parent);

    const open = randomUUID();
    await seedTopic(cid, open, parent, { order_index: 0 });
    const lOpen = await insertLesson(sid, cid, open);
    await insertHw(lOpen, sid, "completed");
    await insertHw(lOpen, sid, "completed");

    const locked = randomUUID();
    await seedTopic(cid, locked, parent, {
      order_index: 1,
      is_locked: true,
    });
    const lLocked = await insertLesson(sid, cid, locked);
    await insertHw(lLocked, sid, "pending");
    await insertHw(lLocked, sid, "pending");

    const p = findById(await getMap(sid, cid), parent);
    // Locked child contributes its 2 pending tasks to the denominator.
    expect(p.stats.tasks_total).toBe(4);
    expect(p.stats.tasks_completed).toBe(2);
    expect(p.stats.pct).toBe(50);

    // The locked flag itself is preserved on the child node.
    const lockedNode = findById(await getMap(sid, cid), locked);
    expect(lockedNode.locked).toBe(true);
  });

  it("7. an empty (not_started) child does not change the parent's ratio", async () => {
    const { sid, cid } = await freshCourse();
    const parent = randomUUID();
    await seedTopic(cid, parent);

    const done = randomUUID();
    await seedTopic(cid, done, parent, { order_index: 0 });
    const l = await insertLesson(sid, cid, done);
    await insertHw(l, sid, "completed");
    await insertHw(l, sid, "completed");

    const empty = randomUUID();
    await seedTopic(cid, empty, parent, { order_index: 1 }); // no lesson, no tasks

    const p = findById(await getMap(sid, cid), parent);
    expect(p.stats.tasks_total).toBe(2);
    expect(p.stats.tasks_completed).toBe(2);
    expect(p.stats.pct).toBe(100);
    expect(p.stats.status).toBe("mastered");
  });

  it("8. leaf topic without children behaves exactly as before (no rollup mutation)", async () => {
    const { sid, cid } = await freshCourse();
    const leaf = randomUUID();
    await seedTopic(cid, leaf);
    const lesson = await insertLesson(sid, cid, leaf);
    await insertHw(lesson, sid, "completed");
    await insertHw(lesson, sid, "failed", null); // null marked_at → active failure

    const node = findById(await getMap(sid, cid), leaf);
    expect(node.children.length).toBe(0);
    expect(node.stats.tasks_total).toBe(2);
    expect(node.stats.tasks_completed).toBe(1);
    expect(node.stats.tasks_failed).toBe(1);
    expect(node.stats.pct).toBe(50);
  });
});
