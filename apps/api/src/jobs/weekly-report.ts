import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { students } from "../db/schema.js";
import { generateReport } from "../services/ai/generate-report.js";

export async function runWeeklyReports(): Promise<void> {
  console.log("[weekly-report] Starting weekly report generation...");

  const allStudents = await db
    .select({ id: students.id, teacher_id: students.teacher_id })
    .from(students)
    .where(
      // Only onboarded students
      // @ts-expect-error – using IS NOT NULL check
      `onboarded_at IS NOT NULL`
    );

  let success = 0;
  let failed = 0;

  for (const student of allStudents) {
    try {
      await generateReport(student.id, student.teacher_id);
      success++;
    } catch (err) {
      console.error(`[weekly-report] Failed for student ${student.id}:`, err);
      failed++;
    }
  }

  console.log(
    `[weekly-report] Done. Success: ${success}, Failed: ${failed}`
  );
}
