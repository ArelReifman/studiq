/**
 * DB Health Check — validates that all required tables exist.
 * Run: pnpm --filter @studiq/api db:check
 * Also called on API startup to catch issues early.
 */
import "../load-env.js";
import postgres from "postgres";

const REQUIRED_TABLES = [
  "profiles",
  "teachers",
  "students",
  "student_invites",
  "student_topics",
  "lesson_sessions",
  "homework_items",
  "todo_items",
  "difficulty_reports",
  "student_ai_profiles",
  "ai_context_vectors",
  "teacher_ai_feedback",
  "student_reports",
  "teacher_availability",
  "lesson_bookings",
];

export async function checkDatabase(connectionString?: string): Promise<{
  ok: boolean;
  missing: string[];
  errors: string[];
}> {
  const url =
    connectionString ?? process.env["DATABASE_URL"];

  if (!url) {
    return { ok: false, missing: [], errors: ["DATABASE_URL not set"] };
  }

  const sql = postgres(url, { max: 1, connect_timeout: 10 });
  const errors: string[] = [];

  try {
    const rows = await sql`
      SELECT table_name::text
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `;

    const existing = new Set(rows.map((r) => r.table_name));
    const missing = REQUIRED_TABLES.filter((t) => !existing.has(t));

    return { ok: missing.length === 0, missing, errors };
  } catch (err: any) {
    return { ok: false, missing: [], errors: [err.message] };
  } finally {
    await sql.end();
  }
}

// Run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  checkDatabase().then((result) => {
    if (result.ok) {
      console.log("✅ All required tables exist.");
    } else {
      if (result.errors.length) {
        console.error("❌ Database errors:", result.errors);
      }
      if (result.missing.length) {
        console.error("❌ Missing tables:", result.missing);
        console.log('\nRun: pnpm --filter @studiq/api db:push');
      }
      process.exit(1);
    }
  });
}
