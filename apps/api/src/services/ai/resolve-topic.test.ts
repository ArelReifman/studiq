import { describe, it, expect, beforeAll, vi } from "vitest";

// Point the service's db at the in-memory pglite instance.
vi.mock("../../db/client.js", async () => {
  const mod = await import("../../test/pglite-db.js");
  return { db: mod.testDb };
});

import { initTestDb, testDb } from "../../test/pglite-db.js";
import { resolveTopic } from "./resolve-topic.js";
import {
  profiles,
  teachers,
  students,
  courses,
  studentCourses,
  courseTopics,
  lessonSessions,
} from "../../db/schema.js";

const ids = {
  TEACHER: "22222222-2222-2222-2222-222222222222",
  STUDENT: "11111111-1111-1111-1111-111111111111",
  COURSE: "33333333-3333-3333-3333-333333333333",
  TOPIC_A: "44444444-4444-4444-4444-444444444444", // unlocked, order 0
  TOPIC_B: "55555555-5555-5555-5555-555555555555", // unlocked, order 1
  TOPIC_LOCKED: "66666666-6666-6666-6666-666666666666", // locked, order 2
  OTHER_COURSE_TOPIC: "77777777-7777-7777-7777-777777777777",
  OTHER_COURSE: "88888888-8888-8888-8888-888888888888",
};

describe("resolveTopic", () => {
  beforeAll(async () => {
    await initTestDb();

    await testDb.insert(profiles).values([
      { id: ids.TEACHER, role: "teacher", full_name: "T", email: "t@x.dev" },
      { id: ids.STUDENT, role: "student", full_name: "S", email: "s@x.dev" },
    ]);
    await testDb.insert(teachers).values({ id: ids.TEACHER });
    await testDb
      .insert(students)
      .values({
        id: ids.STUDENT,
        teacher_id: ids.TEACHER,
        primary_course_id: ids.COURSE,
      });
    await testDb.insert(courses).values([
      { id: ids.COURSE, teacher_id: ids.TEACHER, name: "Math" },
      { id: ids.OTHER_COURSE, teacher_id: ids.TEACHER, name: "Physics" },
    ]);
    await testDb.insert(studentCourses).values({
      student_id: ids.STUDENT,
      course_id: ids.COURSE,
      is_active: true,
    });
    await testDb.insert(courseTopics).values([
      { id: ids.TOPIC_A, course_id: ids.COURSE, name: "A", is_locked: false, order_index: 0 },
      { id: ids.TOPIC_B, course_id: ids.COURSE, name: "B", is_locked: false, order_index: 1 },
      { id: ids.TOPIC_LOCKED, course_id: ids.COURSE, name: "L", is_locked: true, order_index: 2 },
      { id: ids.OTHER_COURSE_TOPIC, course_id: ids.OTHER_COURSE, name: "O", is_locked: false, order_index: 0 },
    ]);
  });

  it("picks the first unlocked topic with no completed lesson", async () => {
    const r = await resolveTopic(ids.STUDENT);
    expect(r).toEqual({ ok: true, courseId: ids.COURSE, topicId: ids.TOPIC_A });
  });

  it("honors an explicit topic_id that belongs to the course", async () => {
    const r = await resolveTopic(ids.STUDENT, { explicitTopicId: ids.TOPIC_B });
    expect(r).toEqual({ ok: true, courseId: ids.COURSE, topicId: ids.TOPIC_B });
  });

  it("rejects an explicit topic_id from another course", async () => {
    const r = await resolveTopic(ids.STUDENT, {
      explicitTopicId: ids.OTHER_COURSE_TOPIC,
    });
    expect(r).toEqual({ ok: false, reason: "topic_mismatch" });
  });

  it("skips a topic once it has a completed lesson", async () => {
    await testDb.insert(lessonSessions).values({
      student_id: ids.STUDENT,
      teacher_id: ids.TEACHER,
      title: "done",
      course_id: ids.COURSE,
      topic_id: ids.TOPIC_A,
      status: "completed",
    });
    const r = await resolveTopic(ids.STUDENT);
    expect(r).toEqual({ ok: true, courseId: ids.COURSE, topicId: ids.TOPIC_B });
  });

  it("returns no_course when the student has no active course", async () => {
    const r = await resolveTopic("99999999-9999-9999-9999-999999999999");
    expect(r).toEqual({ ok: false, reason: "no_course" });
  });
});
