import { describe, it, expect, beforeAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

// One fixed teacher; the auth mock impersonates them.
const ctx = vi.hoisted(() => ({
  TEACHER_ID: "dddddddd-dddd-dddd-dddd-dddddddddddd",
}));

// Route + service db → in-memory pglite. `../db/client.js` and the service's
// `../../db/client.js` resolve to the same module, so one mock covers both.
vi.mock("../db/client.js", async () => {
  const mod = await import("../test/pglite-db.js");
  return { db: mod.testDb };
});

// Impersonate the fixed teacher; requireRole is a pass-through.
vi.mock("../middleware/auth.js", () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set("userId", ctx.TEACHER_ID);
    c.set("userRole", "teacher");
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

// Deterministic Claude — no network. Returns a fixed generated lesson.
vi.mock("../services/ai/claude.js", () => ({
  callClaude: vi.fn(async (_prompt: string, parse: (t: string) => unknown) =>
    parse(
      JSON.stringify({
        title: "Retry Lesson",
        description: "A fresh pass on the same topic.",
        homework_items: [
          { title: "alt homework", description: "different angle", order_index: 0 },
        ],
        todo_items: [{ title: "alt todo", order_index: 0 }],
      })
    )
  ),
}));

// Neutralize the review route's fire-and-forget AI calls.
vi.mock("../services/ai/update-profile.js", () => ({
  updateStudentProfile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/ai/update-teacher-style.js", () => ({
  updateTeacherStyleIfDue: vi.fn().mockResolvedValue(undefined),
}));

import { initTestDb, testDb } from "../test/pglite-db.js";
import { lessonRoutes } from "./lessons.js";
import { generateLesson } from "../services/ai/generate-lesson.js";
import { callClaude } from "../services/ai/claude.js";
import {
  profiles,
  teachers,
  students,
  courses,
  courseTopics,
  studentCourses,
  studentAiProfiles,
  lessonSessions,
  homeworkItems,
  todoItems,
} from "../db/schema.js";

// ── Seed helpers ────────────────────────────────────────────────────────────
async function seedStudent(studentId: string, primaryCourseId: string | null) {
  await testDb.insert(profiles).values({
    id: studentId,
    role: "student",
    full_name: "Test Student",
    email: `${studentId}@test.dev`,
  });
  await testDb.insert(students).values({
    id: studentId,
    teacher_id: ctx.TEACHER_ID,
    primary_course_id: primaryCourseId,
  });
  await testDb.insert(studentAiProfiles).values({ student_id: studentId });
}

async function seedCourse(studentId: string, courseId: string, active = true) {
  await testDb
    .insert(courses)
    .values({ id: courseId, teacher_id: ctx.TEACHER_ID, name: "Course" });
  await testDb
    .insert(studentCourses)
    .values({ student_id: studentId, course_id: courseId, is_active: active });
}

async function seedTopic(courseId: string, topicId: string) {
  await testDb
    .insert(courseTopics)
    .values({ id: topicId, course_id: courseId, name: "Topic" });
}

/**
 * A predecessor (failed) lesson: an active lesson anchored to course/topic,
 * with a teacher review note and a couple of failed tasks.
 */
async function seedPredecessor(
  studentId: string,
  courseId: string,
  topicId: string | null,
  extra: {
    decision?: "repeat" | "next_level" | "next_topic" | null | undefined;
    level?: "base" | "medium" | "exam" | null | undefined;
  } = {}
) {
  const [lesson] = await testDb
    .insert(lessonSessions)
    .values({
      student_id: studentId,
      teacher_id: ctx.TEACHER_ID,
      title: "Original Lesson",
      status: "active",
      course_id: courseId,
      topic_id: topicId,
      teacher_review_note: "Confused fractions with decimals",
      teacher_decision: extra.decision === undefined ? "repeat" : extra.decision,
      lesson_level: extra.level ?? null,
    })
    .returning();
  await testDb.insert(homeworkItems).values({
    lesson_id: lesson!.id,
    student_id: studentId,
    title: "Add fractions",
    status: "failed",
    order_index: 0,
  });
  await testDb.insert(todoItems).values({
    lesson_id: lesson!.id,
    student_id: studentId,
    title: "Simplify 4/8",
    status: "failed",
    order_index: 0,
  });
  return lesson!;
}

async function fullScenario(
  opts: {
    topic?: boolean;
    activeCourse?: boolean;
    decision?: "repeat" | "next_level" | "next_topic" | null;
    level?: "base" | "medium" | "exam" | null;
  } = {}
) {
  const sid = randomUUID();
  const cid = randomUUID();
  const tid = opts.topic === false ? null : randomUUID();
  await seedStudent(sid, cid);
  await seedCourse(sid, cid, opts.activeCourse ?? true);
  if (tid) await seedTopic(cid, tid);
  const pred = await seedPredecessor(sid, cid, tid, {
    decision: opts.decision,
    level: opts.level,
  });
  return { sid, cid, tid, pred };
}

/** Review a lesson with a decision (used to make a retry lesson eligible). */
async function review(
  lessonId: string,
  decision: "repeat" | "next_level" | "next_topic"
) {
  const res = await lessonRoutes.request(`/${lessonId}/review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teacher_decision: decision }),
  });
  expect(res.status).toBe(200);
}

function postRetry(studentId: string, retryOfLessonId: string) {
  return lessonRoutes.request("/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      student_id: studentId,
      retry_of_lesson_id: retryOfLessonId,
    }),
  });
}

async function activeLessons(sid: string, cid: string, tid: string | null) {
  const rows = await testDb
    .select()
    .from(lessonSessions)
    .where(
      and(
        eq(lessonSessions.student_id, sid),
        eq(lessonSessions.course_id, cid),
        eq(lessonSessions.status, "active")
      )
    );
  return tid ? rows.filter((r) => r.topic_id === tid) : rows;
}

async function lessonStatus(id: string) {
  const [row] = await testDb
    .select({ status: lessonSessions.status })
    .from(lessonSessions)
    .where(eq(lessonSessions.id, id));
  return row?.status ?? null;
}

describe("POST /lessons/generate — retry lesson (Phase AI-0.5)", () => {
  beforeAll(async () => {
    await initTestDb();
    await testDb.insert(profiles).values({
      id: ctx.TEACHER_ID,
      role: "teacher",
      full_name: "Test Teacher",
      email: "teacher-retry@test.dev",
    });
    await testDb.insert(teachers).values({ id: ctx.TEACHER_ID });
  });

  it("1. review `repeat` alone does NOT archive the predecessor", async () => {
    const { pred } = await fullScenario();
    const res = await lessonRoutes.request(`/${pred.id}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teacher_decision: "repeat" }),
    });
    expect(res.status).toBe(200);
    // Still active — no status flip, no archive on `repeat`.
    expect(await lessonStatus(pred.id)).toBe("active");
  });

  it("2. clicking generate retry archives the predecessor and creates one active retry", async () => {
    const { sid, cid, tid, pred } = await fullScenario();

    const res = await postRetry(sid, pred.id);
    expect(res.status).toBe(201);
    const retry = (await res.json()) as {
      id: string;
      status: string;
      course_id: string;
      topic_id: string | null;
      ai_generated: boolean;
      ai_generation_context: Record<string, unknown> | null;
    };

    // Predecessor archived; retry is the single active lesson on (s, c, t).
    expect(await lessonStatus(pred.id)).toBe("archived");
    expect(retry.status).toBe("active");
    expect(retry.id).not.toBe(pred.id);
    expect(retry.course_id).toBe(cid);
    expect(retry.topic_id).toBe(tid);
    expect(retry.ai_generated).toBe(true);
    expect(retry.ai_generation_context).toMatchObject({
      mode: "retry",
      retry_of_lesson_id: pred.id,
    });

    const active = await activeLessons(sid, cid, tid);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(retry.id);
  });

  it("3. idempotency — a second retry on the same predecessor returns the same lesson, never a duplicate", async () => {
    const { sid, cid, tid, pred } = await fullScenario();

    const first = await postRetry(sid, pred.id);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { id: string };

    // Predecessor is now archived; a repeat request (double-click / retry /
    // second tab) must return the already-created retry, not insert a second.
    const second = await postRetry(sid, pred.id);
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { id: string };

    expect(secondBody.id).toBe(firstBody.id);
    const active = await activeLessons(sid, cid, tid);
    expect(active).toHaveLength(1);
  });

  it("4. retry-on-retry — generating a retry from a retry chains correctly, one active throughout", async () => {
    const { sid, cid, tid, pred } = await fullScenario();

    const r1 = (await (await postRetry(sid, pred.id)).json()) as { id: string };
    expect(await lessonStatus(pred.id)).toBe("archived");

    // The teacher reviews R1 and again decides `repeat` — this is what makes
    // R1 itself eligible to be retried (mirrors the real product flow).
    await review(r1.id, "repeat");

    const res2 = await postRetry(sid, r1.id);
    expect(res2.status).toBe(201);
    const r2 = (await res2.json()) as {
      id: string;
      ai_generation_context: Record<string, unknown> | null;
    };

    expect(r2.id).not.toBe(r1.id);
    expect(await lessonStatus(r1.id)).toBe("archived");
    expect(r2.ai_generation_context).toMatchObject({ retry_of_lesson_id: r1.id });

    const active = await activeLessons(sid, cid, tid);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(r2.id);
  });

  it("5. inactive anchor course — returns a clear error and creates no lesson", async () => {
    const { sid, cid, tid, pred } = await fullScenario({ activeCourse: false });

    const res = await postRetry(sid, pred.id);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no longer active/i);

    // Predecessor untouched, nothing new created.
    expect(await lessonStatus(pred.id)).toBe("active");
    const all = await testDb
      .select()
      .from(lessonSessions)
      .where(and(eq(lessonSessions.student_id, sid), eq(lessonSessions.course_id, cid)));
    expect(all).toHaveLength(1);
  });

  it("6. predecessor without a topic_id — falls back to a course-level retry, no crash", async () => {
    const { sid, cid, pred } = await fullScenario({ topic: false });

    const res = await postRetry(sid, pred.id);
    expect(res.status).toBe(201);
    const retry = (await res.json()) as { topic_id: string | null; status: string };
    expect(retry.topic_id).toBeNull();
    expect(retry.status).toBe("active");
    expect(await lessonStatus(pred.id)).toBe("archived");
  });

  it("7. ownership — a predecessor owned by another teacher's student returns 404", async () => {
    const { pred } = await fullScenario();
    // Different student that does not own the predecessor.
    const otherSid = randomUUID();
    const otherCid = randomUUID();
    await seedStudent(otherSid, otherCid);
    await seedCourse(otherSid, otherCid);

    const res = await postRetry(otherSid, pred.id);
    expect(res.status).toBe(404);
    // Predecessor untouched.
    expect(await lessonStatus(pred.id)).toBe("active");
  });

  it("8. eligibility — retry is rejected (409) when the predecessor was not marked `repeat`", async () => {
    for (const decision of ["next_level", "next_topic", null] as const) {
      const { sid, pred } = await fullScenario({ decision });
      const res = await postRetry(sid, pred.id);
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/repeat/i);
      // Predecessor untouched — no archive, no new lesson.
      expect(await lessonStatus(pred.id)).toBe("active");
    }
  });

  it("9. same-topic — a mismatching explicit topic_id is rejected (400), predecessor untouched", async () => {
    const { sid, cid, tid, pred } = await fullScenario();
    // A different (real) topic in the same course.
    const otherTopic = randomUUID();
    await seedTopic(cid, otherTopic);

    const res = await lessonRoutes.request("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_id: sid,
        retry_of_lesson_id: pred.id,
        topic_id: otherTopic,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/predecessor's topic/i);
    expect(await lessonStatus(pred.id)).toBe("active");
    expect(await activeLessons(sid, cid, tid)).toHaveLength(1);
  });

  it("10. same-topic — a matching explicit topic_id is accepted and the retry stays on that topic", async () => {
    const { sid, cid, tid, pred } = await fullScenario();
    const res = await lessonRoutes.request("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_id: sid,
        retry_of_lesson_id: pred.id,
        topic_id: tid, // same as predecessor
      }),
    });
    expect(res.status).toBe(201);
    const retry = (await res.json()) as { topic_id: string | null };
    expect(retry.topic_id).toBe(tid);
  });

  it("11. same-level — the predecessor's lesson_level is preserved on the retry", async () => {
    const { sid, pred } = await fullScenario({ level: "medium" });
    const res = await postRetry(sid, pred.id);
    expect(res.status).toBe(201);
    const retry = (await res.json()) as { lesson_level: string | null };
    expect(retry.lesson_level).toBe("medium");
  });

  it("12. Claude failure leaves the predecessor active (archive never happens)", async () => {
    const { sid, cid, tid, pred } = await fullScenario();
    vi.mocked(callClaude).mockRejectedValueOnce(new Error("claude down"));

    const res = await postRetry(sid, pred.id);
    expect(res.status).toBe(500);

    // Claude fails before the transaction — predecessor stays active, nothing created.
    expect(await lessonStatus(pred.id)).toBe("active");
    expect(await activeLessons(sid, cid, tid)).toHaveLength(1);
  });

  it("13. a DB insert failure inside the transaction rolls the predecessor archive back", async () => {
    const { sid, cid, tid, pred } = await fullScenario();
    // Drive generateLesson directly with a non-existent teacher_id: the
    // lesson_sessions insert violates the teacher_id FK and throws AFTER the
    // archive update, so the whole transaction (including the archive) rolls back.
    const BOGUS_TEACHER = randomUUID();
    await expect(
      generateLesson(sid, BOGUS_TEACHER, {
        courseId: cid,
        topicId: tid,
        retryOfLessonId: pred.id,
      })
    ).rejects.toThrow();

    // Archive rolled back — predecessor is still active and still the only one.
    expect(await lessonStatus(pred.id)).toBe("active");
    expect(await activeLessons(sid, cid, tid)).toHaveLength(1);
  });
});
