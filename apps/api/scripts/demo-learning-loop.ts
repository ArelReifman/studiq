/**
 * Demo: closed AI learning loop.
 *
 * Picks the first student with an AI profile, creates an in-memory lesson with
 * mixed completed/failed tasks, runs updateStudentProfile, and prints a before
 * / after diff so you can see Claude actually changed the profile.
 *
 * Run: pnpm --filter @studiq/api exec tsx scripts/demo-learning-loop.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Force-override: shell may have stale empty values for some keys.
const here = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(here, "../.env"), override: true });
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import {
  studentAiProfiles,
  profiles,
  students,
  lessonSessions,
  homeworkItems,
  todoItems,
  difficultyReports,
} from "../src/db/schema.js";
import { updateStudentProfile } from "../src/services/ai/update-profile.js";

function snapshot(p: any) {
  return {
    ai_summary: p?.ai_summary,
    strong_topics: p?.strong_topics,
    weak_topics: p?.weak_topics,
    learning_style: p?.learning_style,
    avg_completion_rate: p?.avg_completion_rate,
    total_lessons: p?.total_lessons,
  };
}

async function main() {
  // 1. Pick first student that has an AI profile.
  const [target] = await db
    .select({
      student_id: students.id,
      full_name: profiles.full_name,
      teacher_id: students.teacher_id,
    })
    .from(students)
    .innerJoin(profiles, eq(profiles.id, students.id))
    .innerJoin(studentAiProfiles, eq(studentAiProfiles.student_id, students.id))
    .limit(1);

  if (!target) {
    console.error("No student with AI profile found. Seed one first.");
    process.exit(1);
  }

  console.log(`\n▶ Demo student: ${target.full_name} (${target.student_id})\n`);

  // 2. BEFORE snapshot.
  const [before] = await db
    .select()
    .from(studentAiProfiles)
    .where(eq(studentAiProfiles.student_id, target.student_id));

  console.log("── BEFORE ───────────────────────────────");
  console.log(JSON.stringify(snapshot(before), null, 2));

  // 3. Insert a synthetic lesson with mixed outcomes (the kind of data the
  //    real flow would produce: 3 completed, 1 failed on "fractions").
  const [lesson] = await db
    .insert(lessonSessions)
    .values({
      student_id: target.student_id,
      teacher_id: target.teacher_id,
      title: "Demo: שברים ופעולות חיבור",
      description: "תרגול שברים עם מכנים שונים — דמו ללמידה",
      status: "completed",
      ai_generated: true,
      generated_at: new Date(),
      completed_at: new Date(),
    })
    .returning();

  await db.insert(homeworkItems).values([
    {
      lesson_id: lesson.id,
      student_id: target.student_id,
      title: "פתור: 1/2 + 1/4",
      description: "חיבור שברים עם מכנים שונים",
      status: "completed",
      order_index: 0,
    },
    {
      lesson_id: lesson.id,
      student_id: target.student_id,
      title: "פתור: 2/3 + 1/6",
      description: "חיבור שברים, מצא מכנה משותף",
      status: "completed",
      order_index: 1,
    },
  ]);

  const [failedItem] = await db
    .insert(todoItems)
    .values([
      {
        lesson_id: lesson.id,
        student_id: target.student_id,
        title: "פתור: 3/8 + 5/12",
        status: "failed",
        order_index: 0,
      },
      {
        lesson_id: lesson.id,
        student_id: target.student_id,
        title: "המר 0.75 לשבר",
        status: "completed",
        order_index: 1,
      },
    ])
    .returning();

  // Add a difficulty_report so failed_topics in the prompt isn't empty.
  await db.insert(difficultyReports).values({
    student_id: target.student_id,
    teacher_id: target.teacher_id,
    source_type: "todo",
    source_id: failedItem.id,
    description: failedItem.title,
    topic_tags: ["שברים", "מכנה משותף"],
    reviewed: false,
  });

  console.log("\n→ Calling updateStudentProfile (Claude)...\n");
  await updateStudentProfile(target.student_id, lesson.id, lesson.title);

  // 4. AFTER snapshot.
  const [after] = await db
    .select()
    .from(studentAiProfiles)
    .where(eq(studentAiProfiles.student_id, target.student_id));

  console.log("── AFTER ────────────────────────────────");
  console.log(JSON.stringify(snapshot(after), null, 2));

  // 5. Show what changed.
  console.log("\n── DIFF ─────────────────────────────────");
  for (const k of Object.keys(snapshot(after))) {
    const a = JSON.stringify((before as any)[k]);
    const b = JSON.stringify((after as any)[k]);
    if (a !== b) console.log(`${k}:\n  - ${a}\n  + ${b}`);
  }

  // 6. Cleanup so demo is repeatable (delete the synthetic lesson + cascade).
  await db.delete(lessonSessions).where(eq(lessonSessions.id, lesson.id));
  console.log("\n✓ Cleanup done. Demo lesson removed.\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
