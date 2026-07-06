import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";

const ctx = vi.hoisted(() => ({
  TEACHER_ID: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  // A second teacher, used only by the negative-authorization tests below to
  // own a student/course that the impersonated teacher (ctx.TEACHER_ID) must
  // not be able to touch.
  OTHER_TEACHER_ID: "ffffffff-ffff-ffff-ffff-ffffffffffff",
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
import { studentRoutes } from "./students.js";
import {
  profiles,
  teachers,
  students,
  courses,
  courseTopics,
  studentCourses,
  lessonSessions,
  studentTopicLocks,
} from "../db/schema.js";

async function seedStudent(
  sid: string,
  cid: string,
  teacherId: string = ctx.TEACHER_ID
) {
  await testDb.insert(profiles).values({
    id: sid,
    role: "student",
    full_name: "Lock Student",
    email: `${sid}@test.dev`,
  });
  await testDb.insert(students).values({
    id: sid,
    teacher_id: teacherId,
    primary_course_id: cid,
  });
}

async function seedCourse(cid: string, teacherId: string = ctx.TEACHER_ID) {
  await testDb
    .insert(courses)
    .values({ id: cid, teacher_id: teacherId, name: "Course" });
}

async function putTopicLock(
  sid: string,
  body: { topic_id: string; is_locked: boolean | null }
) {
  return studentRoutes.request(`/${sid}/topic-lock`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getTopicLockRow(sid: string, tid: string) {
  const [row] = await testDb
    .select()
    .from(studentTopicLocks)
    .where(
      and(
        eq(studentTopicLocks.student_id, sid),
        eq(studentTopicLocks.topic_id, tid)
      )
    );
  return row ?? null;
}

async function enroll(sid: string, cid: string) {
  await testDb
    .insert(studentCourses)
    .values({ student_id: sid, course_id: cid, is_active: true });
}

async function seedTopic(
  cid: string,
  tid: string,
  opts: {
    is_locked?: boolean;
    prerequisite_topic_ids?: string[];
    order_index?: number;
  } = {}
) {
  await testDb.insert(courseTopics).values({
    id: tid,
    course_id: cid,
    name: "Topic",
    is_locked: opts.is_locked ?? false,
    prerequisite_topic_ids: opts.prerequisite_topic_ids ?? [],
    order_index: opts.order_index ?? 0,
  });
}

/** Gives the student any activity in the course so the "Option B"
 *  brand-new-student auto-unlock never fires and doesn't confound the
 *  lock-override assertions below. */
async function markActive(sid: string, cid: string, tid: string) {
  await testDb.insert(lessonSessions).values({
    id: randomUUID(),
    student_id: sid,
    teacher_id: ctx.TEACHER_ID,
    title: "L",
    course_id: cid,
    topic_id: tid,
    status: "active",
  });
}

async function getMap(sid: string, cid: string) {
  const res = await learningMapRoutes.request(
    `/?student_id=${sid}&course_id=${cid}`
  );
  expect(res.status).toBe(200);
  return (await res.json()) as {
    topics: Array<{ id: string; locked: boolean; children: any[] }>;
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

describe("learning map — per-student topic lock override", () => {
  beforeAll(async () => {
    await initTestDb();
    await testDb.insert(profiles).values({
      id: ctx.TEACHER_ID,
      role: "teacher",
      full_name: "Lock Teacher",
      email: "teacher-lock@test.dev",
    });
    await testDb.insert(teachers).values({ id: ctx.TEACHER_ID });
  });

  it("unlocks a globally-locked topic for one student without affecting another", async () => {
    const cid = randomUUID();
    const studentA = randomUUID();
    const studentB = randomUUID();
    const topic = randomUUID();

    await seedCourse(cid);
    await seedStudent(studentA, cid);
    await seedStudent(studentB, cid);
    await enroll(studentA, cid);
    await enroll(studentB, cid);
    await seedTopic(cid, topic, { is_locked: true });
    await markActive(studentA, cid, topic);
    await markActive(studentB, cid, topic);

    // Sanity: both locked by default before any override exists.
    expect(findById(await getMap(studentA, cid), topic).locked).toBe(true);
    expect(findById(await getMap(studentB, cid), topic).locked).toBe(true);

    // Override unlocks the topic for student A only.
    await testDb.insert(studentTopicLocks).values({
      student_id: studentA,
      topic_id: topic,
      is_locked: false,
    });

    expect(findById(await getMap(studentA, cid), topic).locked).toBe(false);
    expect(findById(await getMap(studentB, cid), topic).locked).toBe(true);

    // course_topics.is_locked itself is untouched by the override.
    const [row] = await testDb
      .select({ is_locked: courseTopics.is_locked })
      .from(courseTopics)
      .where(eq(courseTopics.id, topic));
    expect(row!.is_locked).toBe(true);
  });

  it("falls back to the course default once the override row is deleted", async () => {
    const cid = randomUUID();
    const sid = randomUUID();
    const topic = randomUUID();

    await seedCourse(cid);
    await seedStudent(sid, cid);
    await enroll(sid, cid);
    await seedTopic(cid, topic, { is_locked: true });
    await markActive(sid, cid, topic);

    await testDb
      .insert(studentTopicLocks)
      .values({ student_id: sid, topic_id: topic, is_locked: false });
    expect(findById(await getMap(sid, cid), topic).locked).toBe(false);

    // Simulates PUT /students/:id/topic-lock with is_locked: null.
    await testDb
      .delete(studentTopicLocks)
      .where(
        and(
          eq(studentTopicLocks.student_id, sid),
          eq(studentTopicLocks.topic_id, topic)
        )
      );

    expect(findById(await getMap(sid, cid), topic).locked).toBe(true);
  });

  it("an unlock override does not bypass an unmet prerequisite", async () => {
    const cid = randomUUID();
    const sid = randomUUID();
    const prereq = randomUUID();
    const topic = randomUUID();

    await seedCourse(cid);
    await seedStudent(sid, cid);
    await enroll(sid, cid);
    // prereq has no lessons → status "not_started", never "mastered".
    await seedTopic(cid, prereq, { order_index: 0 });
    await seedTopic(cid, topic, {
      is_locked: false,
      prerequisite_topic_ids: [prereq],
      order_index: 1,
    });
    await markActive(sid, cid, topic);

    await testDb
      .insert(studentTopicLocks)
      .values({ student_id: sid, topic_id: topic, is_locked: false });

    // Override says "unlocked", but the unmet prerequisite still locks it.
    expect(findById(await getMap(sid, cid), topic).locked).toBe(true);
  });

  it("brand-new student with no activity still gets Option B auto-unlock", async () => {
    const cid = randomUUID();
    const sid = randomUUID();
    const topic = randomUUID();

    await seedCourse(cid);
    await seedStudent(sid, cid);
    await enroll(sid, cid);
    await seedTopic(cid, topic, { is_locked: true, order_index: 0 });
    // No lessons inserted — student has zero activity, no override exists.

    expect(findById(await getMap(sid, cid), topic).locked).toBe(false);
  });
});

describe("PUT /students/:id/topic-lock — authorization", () => {
  beforeAll(async () => {
    // initTestDb() already ran in the describe block above (shared DB
    // instance across this file); just seed the second teacher used by the
    // negative-authorization cases below.
    await testDb.insert(profiles).values({
      id: ctx.OTHER_TEACHER_ID,
      role: "teacher",
      full_name: "Other Teacher",
      email: "teacher-other-lock@test.dev",
    });
    await testDb.insert(teachers).values({ id: ctx.OTHER_TEACHER_ID });
  });

  it("upserts an override when the teacher owns both the student and the topic's course", async () => {
    const cid = randomUUID();
    const sid = randomUUID();
    const topic = randomUUID();
    await seedCourse(cid);
    await seedStudent(sid, cid);
    await seedTopic(cid, topic, { is_locked: true });

    const res = await putTopicLock(sid, { topic_id: topic, is_locked: false });
    expect(res.status).toBe(200);
    expect((await getTopicLockRow(sid, topic))?.is_locked).toBe(false);
  });

  it("rejects setting a lock override for a student the teacher does not own", async () => {
    const cid = randomUUID();
    const otherStudent = randomUUID();
    const topic = randomUUID();
    // Both the student and the course/topic belong to the OTHER teacher —
    // the impersonated ctx.TEACHER_ID must not be able to write here.
    await seedCourse(cid, ctx.OTHER_TEACHER_ID);
    await seedStudent(otherStudent, cid, ctx.OTHER_TEACHER_ID);
    await seedTopic(cid, topic, { is_locked: true });

    const res = await putTopicLock(otherStudent, {
      topic_id: topic,
      is_locked: false,
    });

    expect(res.status).toBe(404);
    expect(await getTopicLockRow(otherStudent, topic)).toBeNull();
  });

  it("rejects setting a lock override for a topic in a course the teacher does not own", async () => {
    // The student belongs to ctx.TEACHER_ID, but the topic's course belongs
    // to the OTHER teacher — ownership of the student alone must not be
    // enough to write a lock override for someone else's topic.
    const ownCid = randomUUID();
    const sid = randomUUID();
    await seedCourse(ownCid);
    await seedStudent(sid, ownCid);

    const otherCid = randomUUID();
    const otherTopic = randomUUID();
    await seedCourse(otherCid, ctx.OTHER_TEACHER_ID);
    await seedTopic(otherCid, otherTopic, { is_locked: true });

    const res = await putTopicLock(sid, {
      topic_id: otherTopic,
      is_locked: false,
    });

    expect(res.status).toBe(404);
    expect(await getTopicLockRow(sid, otherTopic)).toBeNull();
  });
});
