import { describe, it, expect, beforeAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const ctx = vi.hoisted(() => ({
  TEACHER_A: "11111111-1111-1111-1111-111111111111",
  TEACHER_B: "22222222-2222-2222-2222-222222222222",
  STUDENT_A: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  STUDENT_B: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  currentUser: "" as string,
  currentRole: "teacher" as "teacher" | "student",
}));

vi.mock("../db/client.js", async () => {
  const mod = await import("../test/pglite-db.js");
  return { db: mod.testDb };
});

// Dynamic impersonation: tests set ctx.currentUser/currentRole before each call.
vi.mock("../middleware/auth.js", () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set("userId", ctx.currentUser);
    c.set("userRole", ctx.currentRole);
    await next();
  },
  requireRole: (role: "teacher" | "student") => async (c: any, next: any) => {
    if (c.get("userRole") !== role) return c.json({ error: "Forbidden" }, 403);
    await next();
  },
}));

// In-memory fake Storage so upload/delete behave without a real Supabase bucket.
const fakeStorage = vi.hoisted(() => {
  const files = new Map<string, { contentType: string; bytes: Uint8Array }>();
  return {
    files,
    upload: vi.fn(
      async (
        path: string,
        body: ArrayBuffer,
        opts: { contentType: string; upsert?: boolean }
      ) => {
        if (!opts.upsert && files.has(path))
          return { error: { message: "already exists" } };
        files.set(path, {
          contentType: opts.contentType,
          bytes: new Uint8Array(body),
        });
        return { error: null };
      }
    ),
    getPublicUrl: vi.fn((path: string) => ({
      data: { publicUrl: `https://fake.local/uploads/${path}` },
    })),
    remove: vi.fn(async (paths: string[]) => {
      for (const p of paths) files.delete(p);
      return { error: null };
    }),
  };
});

vi.mock("../lib/supabase.js", () => ({
  createAdminSupabase: () => ({
    storage: {
      from: (_bucket: string) => fakeStorage,
    },
  }),
}));

import { initTestDb, testDb } from "../test/pglite-db.js";
import { learningResourcesRoutes } from "./learning-resources.js";
import {
  profiles,
  teachers,
  students,
  courses,
  courseTopics,
  learningResources,
} from "../db/schema.js";

async function seedTeacher(id: string, email: string) {
  await testDb
    .insert(profiles)
    .values({ id, role: "teacher", full_name: "T", email });
  await testDb.insert(teachers).values({ id });
}

async function seedStudent(id: string, teacherId: string, email: string) {
  await testDb
    .insert(profiles)
    .values({ id, role: "student", full_name: "S", email });
  await testDb.insert(students).values({ id, teacher_id: teacherId });
}

async function seedCourse(teacherId: string) {
  const id = randomUUID();
  await testDb.insert(courses).values({ id, teacher_id: teacherId, name: "C" });
  return id;
}

async function seedTopic(courseId: string) {
  const id = randomUUID();
  await testDb
    .insert(courseTopics)
    .values({ id, course_id: courseId, name: "T" });
  return id;
}

function makeFile(name: string, type: string, size = 64) {
  return new File([new Uint8Array(size)], name, { type });
}

async function uploadResource(opts: {
  asTeacher: string;
  course_id: string;
  topic_id?: string;
  title?: string;
  visibility?: "teacher_only" | "student_visible";
  file?: File;
}) {
  ctx.currentUser = opts.asTeacher;
  ctx.currentRole = "teacher";
  const fd = new FormData();
  fd.set("file", opts.file ?? makeFile("hw.pdf", "application/pdf"));
  fd.set("course_id", opts.course_id);
  if (opts.topic_id) fd.set("topic_id", opts.topic_id);
  fd.set("title", opts.title ?? "Resource");
  if (opts.visibility) fd.set("visibility", opts.visibility);
  return learningResourcesRoutes.request("/", {
    method: "POST",
    body: fd,
    headers: { "x-requested-with": "XMLHttpRequest" },
  });
}

describe("learning resources — phase 1 backend", () => {
  beforeAll(async () => {
    await initTestDb();
    await seedTeacher(ctx.TEACHER_A, "ta@test.dev");
    await seedTeacher(ctx.TEACHER_B, "tb@test.dev");
    await seedStudent(ctx.STUDENT_A, ctx.TEACHER_A, "sa@test.dev");
    await seedStudent(ctx.STUDENT_B, ctx.TEACHER_B, "sb@test.dev");
  });

  it("1. teacher uploads a resource and gets a row back", async () => {
    const courseId = await seedCourse(ctx.TEACHER_A);
    const res = await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseId,
      title: "Formulas",
      visibility: "student_visible",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.teacher_id).toBe(ctx.TEACHER_A);
    expect(body.course_id).toBe(courseId);
    expect(body.topic_id).toBeNull();
    expect(body.title).toBe("Formulas");
    expect(body.visibility).toBe("student_visible");
    expect(body.storage_path).toMatch(
      new RegExp(`^resources/${ctx.TEACHER_A}/${courseId}/[0-9a-f-]+\\.pdf$`)
    );
    // Storage actually received the upload.
    expect(fakeStorage.files.has(body.storage_path)).toBe(true);
  });

  it("2. teacher lists own resources by course (cross-tenant isolation)", async () => {
    const courseA = await seedCourse(ctx.TEACHER_A);
    const courseB = await seedCourse(ctx.TEACHER_B);
    await uploadResource({ asTeacher: ctx.TEACHER_A, course_id: courseA });
    await uploadResource({ asTeacher: ctx.TEACHER_B, course_id: courseB });

    ctx.currentUser = ctx.TEACHER_A;
    ctx.currentRole = "teacher";
    const res = await learningResourcesRoutes.request(
      `/?course_id=${courseA}`
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].course_id).toBe(courseA);
    expect(rows[0].teacher_id).toBe(ctx.TEACHER_A);
  });

  it("3. teacher attaches a resource to a topic/subtopic", async () => {
    const courseId = await seedCourse(ctx.TEACHER_A);
    const topicId = await seedTopic(courseId);
    const res = await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseId,
      topic_id: topicId,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.topic_id).toBe(topicId);
  });

  it("4. course-level resource appears for topic-scoped queries", async () => {
    const courseId = await seedCourse(ctx.TEACHER_A);
    const topicId = await seedTopic(courseId);

    // Course-level (no topic_id).
    await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseId,
      title: "Course book",
    });
    // Topic-level.
    await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseId,
      topic_id: topicId,
      title: "Topic notes",
    });

    ctx.currentUser = ctx.TEACHER_A;
    ctx.currentRole = "teacher";
    const res = await learningResourcesRoutes.request(
      `/?course_id=${courseId}&topic_id=${topicId}`
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as any[];
    const titles = rows.map((r) => r.title).sort();
    expect(titles).toEqual(["Course book", "Topic notes"]);
  });

  it("5. student sees only student_visible resources", async () => {
    const courseId = await seedCourse(ctx.TEACHER_A);
    await testDb
      .insert(await import("../db/schema.js").then((m) => m.studentCourses))
      .values({
        student_id: ctx.STUDENT_A,
        course_id: courseId,
        is_active: true,
      });
    await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseId,
      title: "Public",
      visibility: "student_visible",
    });
    await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseId,
      title: "Private",
      visibility: "teacher_only",
    });

    ctx.currentUser = ctx.STUDENT_A;
    ctx.currentRole = "student";
    const res = await learningResourcesRoutes.request(
      `/student?course_id=${courseId}`
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("Public");
  });

  it("6. teacher_only is never returned to the student endpoint", async () => {
    const courseId = await seedCourse(ctx.TEACHER_A);
    await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseId,
      title: "Hidden",
      visibility: "teacher_only",
    });

    ctx.currentUser = ctx.STUDENT_A;
    ctx.currentRole = "student";
    const res = await learningResourcesRoutes.request(
      `/student?course_id=${courseId}`
    );
    const rows = (await res.json()) as any[];
    expect(rows.find((r) => r.title === "Hidden")).toBeUndefined();
  });

  it("7. unrelated student (other teacher) cannot see resources", async () => {
    const courseA = await seedCourse(ctx.TEACHER_A);
    await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseA,
      title: "Only for A's students",
      visibility: "student_visible",
    });

    // STUDENT_B belongs to TEACHER_B — must not see TEACHER_A's resource.
    ctx.currentUser = ctx.STUDENT_B;
    ctx.currentRole = "student";
    const res = await learningResourcesRoutes.request(
      `/student?course_id=${courseA}`
    );
    const rows = (await res.json()) as any[];
    expect(rows.length).toBe(0);
  });

  it("8. unrelated teacher cannot PATCH or DELETE another teacher's resource", async () => {
    const courseA = await seedCourse(ctx.TEACHER_A);
    const create = await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseA,
    });
    const { id } = (await create.json()) as any;

    ctx.currentUser = ctx.TEACHER_B;
    ctx.currentRole = "teacher";

    const patch = await learningResourcesRoutes.request(`/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-requested-with": "XMLHttpRequest",
      },
      body: JSON.stringify({ title: "hijacked" }),
    });
    expect(patch.status).toBe(404);

    const del = await learningResourcesRoutes.request(`/${id}`, {
      method: "DELETE",
      headers: { "x-requested-with": "XMLHttpRequest" },
    });
    expect(del.status).toBe(404);

    // The row is intact under TEACHER_A's ownership.
    const [stillThere] = await testDb
      .select()
      .from(learningResources)
      .where(eq(learningResources.id, id));
    expect(stillThere?.teacher_id).toBe(ctx.TEACHER_A);
  });

  it("9. teacher deletes own resource (record + storage object both gone)", async () => {
    const courseId = await seedCourse(ctx.TEACHER_A);
    const create = await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseId,
    });
    const { id, storage_path } = (await create.json()) as any;
    expect(fakeStorage.files.has(storage_path)).toBe(true);

    ctx.currentUser = ctx.TEACHER_A;
    ctx.currentRole = "teacher";
    const del = await learningResourcesRoutes.request(`/${id}`, {
      method: "DELETE",
      headers: { "x-requested-with": "XMLHttpRequest" },
    });
    expect(del.status).toBe(200);

    const rows = await testDb
      .select()
      .from(learningResources)
      .where(eq(learningResources.id, id));
    expect(rows.length).toBe(0);
    expect(fakeStorage.files.has(storage_path)).toBe(false);
  });

  it("10. invalid file type is rejected", async () => {
    const courseId = await seedCourse(ctx.TEACHER_A);
    const res = await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseId,
      file: makeFile("notes.txt", "text/plain"),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/file type/i);
  });
});
