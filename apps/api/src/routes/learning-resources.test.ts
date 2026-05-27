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
    createSignedUploadUrl: vi.fn(async (path: string) => ({
      data: {
        signedUrl: `https://fake.local/signed/${path}`,
        token: "fake-token",
        path,
      },
      error: null,
    })),
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
  student_id?: string;
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
  if (opts.student_id) fd.set("student_id", opts.student_id);
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

  it("11. sign+confirm flow creates a resource with the expected path", async () => {
    const courseId = await seedCourse(ctx.TEACHER_A);
    ctx.currentUser = ctx.TEACHER_A;
    ctx.currentRole = "teacher";

    const signRes = await learningResourcesRoutes.request("/sign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-requested-with": "XMLHttpRequest",
      },
      body: JSON.stringify({
        file_name: "formulas.pdf",
        content_type: "application/pdf",
        size: 1024,
        course_id: courseId,
      }),
    });
    expect(signRes.status).toBe(200);
    const sign = (await signRes.json()) as {
      signedUrl: string;
      token: string;
      path: string;
      resource_id: string;
    };
    expect(sign.path).toMatch(
      new RegExp(`^resources/${ctx.TEACHER_A}/${courseId}/[0-9a-f-]+\\.pdf$`)
    );

    const confirmRes = await learningResourcesRoutes.request("/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-requested-with": "XMLHttpRequest",
      },
      body: JSON.stringify({
        resource_id: sign.resource_id,
        path: sign.path,
        file_name: "formulas.pdf",
        file_type: "application/pdf",
        file_size_bytes: 1024,
        course_id: courseId,
        title: "Big formula sheet",
        visibility: "student_visible",
      }),
    });
    expect(confirmRes.status).toBe(201);
    const row = (await confirmRes.json()) as any;
    expect(row.id).toBe(sign.resource_id);
    expect(row.storage_path).toBe(sign.path);
    expect(row.visibility).toBe("student_visible");
  });

  it("12. confirm rejects a tampered storage path", async () => {
    const courseId = await seedCourse(ctx.TEACHER_A);
    ctx.currentUser = ctx.TEACHER_A;
    ctx.currentRole = "teacher";

    const signRes = await learningResourcesRoutes.request("/sign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-requested-with": "XMLHttpRequest",
      },
      body: JSON.stringify({
        file_name: "f.pdf",
        content_type: "application/pdf",
        size: 100,
        course_id: courseId,
      }),
    });
    const sign = (await signRes.json()) as { resource_id: string };

    // Path encodes a different teacher — must be rejected.
    const evilPath = `resources/${ctx.TEACHER_B}/${courseId}/${sign.resource_id}.pdf`;
    const confirmRes = await learningResourcesRoutes.request("/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-requested-with": "XMLHttpRequest",
      },
      body: JSON.stringify({
        resource_id: sign.resource_id,
        path: evilPath,
        file_name: "f.pdf",
        file_type: "application/pdf",
        course_id: courseId,
        title: "x",
      }),
    });
    expect(confirmRes.status).toBe(400);
  });

  it("14. student-specific upload: other student in same course does not see it", async () => {
    // Two students of TEACHER_A in the same course.
    const courseId = await seedCourse(ctx.TEACHER_A);
    const studentY = randomUUID();
    const studentZ = randomUUID();
    await seedStudent(studentY, ctx.TEACHER_A, `${studentY}@test.dev`);
    await seedStudent(studentZ, ctx.TEACHER_A, `${studentZ}@test.dev`);
    const { studentCourses } = await import("../db/schema.js");
    await testDb.insert(studentCourses).values([
      { student_id: studentY, course_id: courseId, is_active: true },
      { student_id: studentZ, course_id: courseId, is_active: true },
    ]);

    // Teacher uploads from inside studentY's Learning Map → student-specific.
    await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseId,
      student_id: studentY,
      title: "Private notes for Y",
      visibility: "student_visible",
    });

    // studentY sees it.
    ctx.currentUser = studentY;
    ctx.currentRole = "student";
    const resY = await learningResourcesRoutes.request(
      `/student?course_id=${courseId}`
    );
    const rowsY = (await resY.json()) as any[];
    expect(rowsY.length).toBe(1);
    expect(rowsY[0].title).toBe("Private notes for Y");

    // studentZ MUST NOT see it.
    ctx.currentUser = studentZ;
    ctx.currentRole = "student";
    const resZ = await learningResourcesRoutes.request(
      `/student?course_id=${courseId}`
    );
    const rowsZ = (await resZ.json()) as any[];
    expect(rowsZ.length).toBe(0);
  });

  it("15. shared course-level resource (student_id NULL) is visible to all students", async () => {
    const courseId = await seedCourse(ctx.TEACHER_A);
    const studentY = randomUUID();
    const studentZ = randomUUID();
    await seedStudent(studentY, ctx.TEACHER_A, `${studentY}@test.dev`);
    await seedStudent(studentZ, ctx.TEACHER_A, `${studentZ}@test.dev`);
    const { studentCourses } = await import("../db/schema.js");
    await testDb.insert(studentCourses).values([
      { student_id: studentY, course_id: courseId, is_active: true },
      { student_id: studentZ, course_id: courseId, is_active: true },
    ]);

    // Upload from the course page (no student_id) → shared course resource.
    await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseId,
      title: "Course-wide PDF",
      visibility: "student_visible",
    });

    for (const sid of [studentY, studentZ]) {
      ctx.currentUser = sid;
      ctx.currentRole = "student";
      const res = await learningResourcesRoutes.request(
        `/student?course_id=${courseId}`
      );
      const rows = (await res.json()) as any[];
      expect(rows.find((r) => r.title === "Course-wide PDF")).toBeTruthy();
    }
  });

  it("16. topic+student scoped resource appears only for that student on that topic", async () => {
    const courseId = await seedCourse(ctx.TEACHER_A);
    const topicId = await seedTopic(courseId);
    const otherTopic = await seedTopic(courseId);
    const studentY = randomUUID();
    const studentZ = randomUUID();
    await seedStudent(studentY, ctx.TEACHER_A, `${studentY}@test.dev`);
    await seedStudent(studentZ, ctx.TEACHER_A, `${studentZ}@test.dev`);
    const { studentCourses } = await import("../db/schema.js");
    await testDb.insert(studentCourses).values([
      { student_id: studentY, course_id: courseId, is_active: true },
      { student_id: studentZ, course_id: courseId, is_active: true },
    ]);

    await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseId,
      topic_id: topicId,
      student_id: studentY,
      title: "Y notes for topic",
      visibility: "student_visible",
    });

    // studentY on the right topic → sees it.
    ctx.currentUser = studentY;
    ctx.currentRole = "student";
    const resYTopic = await learningResourcesRoutes.request(
      `/student?course_id=${courseId}&topic_id=${topicId}`
    );
    expect(((await resYTopic.json()) as any[]).length).toBe(1);

    // studentY on a different topic → does NOT see it.
    const resYOther = await learningResourcesRoutes.request(
      `/student?course_id=${courseId}&topic_id=${otherTopic}`
    );
    expect(((await resYOther.json()) as any[]).length).toBe(0);

    // studentZ on the same topic → does NOT see it.
    ctx.currentUser = studentZ;
    ctx.currentRole = "student";
    const resZTopic = await learningResourcesRoutes.request(
      `/student?course_id=${courseId}&topic_id=${topicId}`
    );
    expect(((await resZTopic.json()) as any[]).length).toBe(0);
  });

  it("17. teacher_only resource stays hidden from students even when student_id matches", async () => {
    const courseId = await seedCourse(ctx.TEACHER_A);
    const studentY = randomUUID();
    await seedStudent(studentY, ctx.TEACHER_A, `${studentY}@test.dev`);

    await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseId,
      student_id: studentY,
      title: "Internal draft",
      visibility: "teacher_only",
    });

    ctx.currentUser = studentY;
    ctx.currentRole = "student";
    const res = await learningResourcesRoutes.request(
      `/student?course_id=${courseId}`
    );
    const rows = (await res.json()) as any[];
    expect(rows.find((r) => r.title === "Internal draft")).toBeUndefined();
  });

  it("18. teacher GET without student_id returns only shared resources", async () => {
    const courseId = await seedCourse(ctx.TEACHER_A);
    const studentY = randomUUID();
    await seedStudent(studentY, ctx.TEACHER_A, `${studentY}@test.dev`);

    await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseId,
      title: "Shared",
    });
    await uploadResource({
      asTeacher: ctx.TEACHER_A,
      course_id: courseId,
      student_id: studentY,
      title: "Per-student",
    });

    ctx.currentUser = ctx.TEACHER_A;
    ctx.currentRole = "teacher";
    const res = await learningResourcesRoutes.request(
      `/?course_id=${courseId}`
    );
    const titles = ((await res.json()) as any[]).map((r) => r.title).sort();
    expect(titles).toEqual(["Shared"]);

    // With student_id → returns both shared + private for that student.
    const res2 = await learningResourcesRoutes.request(
      `/?course_id=${courseId}&student_id=${studentY}`
    );
    const titles2 = ((await res2.json()) as any[]).map((r) => r.title).sort();
    expect(titles2).toEqual(["Per-student", "Shared"]);
  });

  it("13. sign rejects an invalid file type", async () => {
    const courseId = await seedCourse(ctx.TEACHER_A);
    ctx.currentUser = ctx.TEACHER_A;
    ctx.currentRole = "teacher";

    const res = await learningResourcesRoutes.request("/sign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-requested-with": "XMLHttpRequest",
      },
      body: JSON.stringify({
        file_name: "notes.exe",
        content_type: "application/x-msdownload",
        size: 1024,
        course_id: courseId,
      }),
    });
    expect(res.status).toBe(400);
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
