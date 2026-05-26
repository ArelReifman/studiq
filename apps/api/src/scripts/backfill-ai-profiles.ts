/**
 * backfill-ai-profiles.ts
 *
 * One-off backfill that rebuilds `student_ai_profiles` from the full
 * historical record (lessons, homework, todos, difficulty reports, teacher
 * decisions/notes, student reflections, insights). Each student gets ONE
 * Claude call summarizing the entire history — unlike the per-lesson
 * `updateStudentProfile` flow which only sees the latest lesson.
 *
 * The script is idempotent: counts come from aggregations (not increments),
 * so re-running converges to the same state (modulo Claude wording drift).
 * Manual teacher fields (`student_insights`, `students.background_note`,
 * `teachers.teaching_style_summary`) are read-only here.
 *
 * Usage:
 *   # Dry-run (safe, never writes):
 *   npx tsx src/scripts/backfill-ai-profiles.ts --dry-run
 *   npx tsx src/scripts/backfill-ai-profiles.ts --student-id=<uuid> --dry-run
 *   npx tsx src/scripts/backfill-ai-profiles.ts --limit=5 --dry-run
 *
 *   # Real write — REQUIRES --confirm-write (after you've reviewed a dry-run):
 *   npx tsx src/scripts/backfill-ai-profiles.ts --student-id=<uuid> --confirm-write
 *   npx tsx src/scripts/backfill-ai-profiles.ts --limit=5 --confirm-write
 *   npx tsx src/scripts/backfill-ai-profiles.ts --confirm-write
 */

import "dotenv/config";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  difficultyReports,
  homeworkItems,
  lessonSessions,
  profiles,
  studentAiProfiles,
  studentInsights,
  students,
  todoItems,
} from "../db/schema.js";
import { callClaude } from "../services/ai/claude.js";
import { generateNextSessionBriefing } from "../services/ai/generate-briefing.js";

// ─── CLI parsing ──────────────────────────────────────────────────────────────

interface CliArgs {
  dryRun: boolean;
  confirmWrite: boolean;
  studentId: string | null;
  limit: number | null;
}

function parseArgs(argv: string[]): CliArgs {
  let dryRun = false;
  let confirmWrite = false;
  let studentId: string | null = null;
  let limit: number | null = null;

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--confirm-write") {
      confirmWrite = true;
    } else if (arg.startsWith("--student-id=")) {
      studentId = arg.slice("--student-id=".length).trim() || null;
    } else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --limit value: ${arg}`);
      }
      limit = Math.floor(n);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return { dryRun, confirmWrite, studentId, limit };
}

function log(msg: string) {
  console.log(`[backfill] ${msg}`);
}

// ─── Claude response schema ───────────────────────────────────────────────────

const BackfillUpdateSchema = z.object({
  ai_summary: z.string(),
  strong_topics: z.array(z.string()),
  weak_topics: z.array(z.string()),
  learning_style: z.enum([
    "visual",
    "step_by_step",
    "example_first",
    "theory_first",
    "unknown",
  ]),
  teacher_feedback_summary: z.string(),
});
type BackfillUpdate = z.infer<typeof BackfillUpdateSchema>;

// ─── Prompt builder ───────────────────────────────────────────────────────────

const DECISION_LABEL: Record<string, string> = {
  repeat: "חזרה על אותה רמה",
  next_level: "מעבר לרמה הבאה",
  next_topic: "מעבר לנושא הבא",
};

interface PromptInput {
  studentName: string;
  backgroundNote: string | null;
  currentAiSummary: string | null;
  currentStrongTopics: string[];
  currentWeakTopics: string[];
  currentLearningStyle: string;
  currentTeacherFeedbackSummary: string | null;
  totalLessons: number;
  totalHomework: number;
  totalFailures: number;
  avgCompletionRate: number;
  recentLessons: Array<{
    title: string;
    teacher_decision: string | null;
    teacher_review_note: string | null;
    student_reflection: string | null;
  }>;
  difficultyTagFrequency: Array<{ tag: string; count: number }>;
  difficultyNotes: Array<{ note: string; topics: string[] }>;
  insights: string[];
}

function buildBackfillPrompt(p: PromptInput): string {
  const lessonsBlock =
    p.recentLessons.length > 0
      ? p.recentLessons
          .map((l) => {
            const decision = l.teacher_decision
              ? ` → ${DECISION_LABEL[l.teacher_decision] ?? l.teacher_decision}`
              : "";
            const note = l.teacher_review_note?.trim()
              ? `\n    הערת מורה: "${l.teacher_review_note.trim()}"`
              : "";
            const reflection = l.student_reflection?.trim()
              ? `\n    התלמיד כתב: "${l.student_reflection.trim()}"`
              : "";
            return `  • "${l.title}"${decision}${note}${reflection}`;
          })
          .join("\n")
      : "  (אין שיעורים)";

  const tagsBlock =
    p.difficultyTagFrequency.length > 0
      ? p.difficultyTagFrequency.map((t) => `  • ${t.tag} (×${t.count})`).join("\n")
      : "  (אין דיווחי קושי)";

  const notesBlock =
    p.difficultyNotes.length > 0
      ? p.difficultyNotes
          .map(
            (d) =>
              `  • ${d.topics.join(", ") || "ללא תיוג"}: "${d.note}"`
          )
          .join("\n")
      : "  (אין הערות מורה על קושי)";

  const insightsBlock =
    p.insights.length > 0
      ? p.insights.map((i) => `  • ${i}`).join("\n")
      : "  (אין תובנות מורה)";

  return `אתה בונה פרופיל למידה מקיף לתלמיד על סמך כל ההיסטוריה במערכת.
זהו backfill — אתה רואה את כל המידע במכה אחת, לא שיעור אחר שיעור.

## תלמיד: ${p.studentName}
${p.backgroundNote ? `רקע (נכתב ידנית ע״י המורה): ${p.backgroundNote}` : ""}

## הפרופיל הקיים (שמור תובנות מועילות שכבר נצברו)
- סיכום AI נוכחי: ${p.currentAiSummary ?? "(ריק)"}
- נושאים חזקים נוכחיים: ${p.currentStrongTopics.join(", ") || "(ריק)"}
- נושאים חלשים נוכחיים: ${p.currentWeakTopics.join(", ") || "(ריק)"}
- סגנון למידה נוכחי: ${p.currentLearningStyle}
- סיכום משוב מורה נוכחי: ${p.currentTeacherFeedbackSummary ?? "(ריק)"}

## מדדים מצטברים (מחושב מהדאטה)
- סה״כ שיעורים: ${p.totalLessons}
- סה״כ משימות (שיעורי בית + todo): ${p.totalHomework}
- סה״כ כשלונות: ${p.totalFailures}
- אחוז השלמה ממוצע: ${(p.avgCompletionRate * 100).toFixed(0)}%

## שיעורים אחרונים + החלטות מורה (חזק ביותר — הסטנדרט של המורה)
${lessonsBlock}

## תדירות תגי נושאי-קושי (כל ההיסטוריה)
${tagsBlock}

## הערות מורה לדיווחי קושי
${notesBlock}

## תובנות מורה ידניות על התלמיד (חדשות ראשונות)
${insightsBlock}

## הנחיות
- כתוב ai_summary של 3–5 משפטים בעברית: מה התלמיד יודע, איפה הוא מתקשה, איך הוא לומד הכי טוב.
- אל תזרוק תובנות שהיו בפרופיל הקודם אם הן עדיין נתמכות בדאטה — שלב אותן.
- strong_topics ו-weak_topics: רשימות מ-0 עד 8 פריטים. weak קודם לפי תדירות בדיווחי הקושי וב-decisions של "חזרה".
- learning_style: בחר על סמך reflections + הערות מורה + insights. אם אין מספיק עדויות — "unknown".
- teacher_feedback_summary: 2–4 משפטים שמתמצתים מה המורה תיקן/הדגיש לתלמיד הספציפי הזה לאורך זמן.
- אם אין מספיק נתונים בכלל (פחות מ-2 שיעורים, אין דיווחי קושי, אין insights) — החזר את הפרופיל הקיים כמעט ללא שינוי.

Respond ONLY with valid JSON:
{
  "ai_summary": "string",
  "strong_topics": ["string"],
  "weak_topics": ["string"],
  "learning_style": "visual" | "step_by_step" | "example_first" | "theory_first" | "unknown",
  "teacher_feedback_summary": "string"
}`;
}

// ─── Per-student backfill ─────────────────────────────────────────────────────

interface StudentBackfillResult {
  studentId: string;
  status: "updated" | "would-update" | "skipped-no-profile" | "skipped-no-history" | "error";
  reason?: string;
}

async function backfillStudent(
  studentId: string,
  opts: { dryRun: boolean }
): Promise<StudentBackfillResult> {
  // 1. Load existing profile + student info
  const [profile, studentRow] = await Promise.all([
    db
      .select()
      .from(studentAiProfiles)
      .where(eq(studentAiProfiles.student_id, studentId))
      .limit(1)
      .then((r) => r[0]),
    db
      .select({
        full_name: profiles.full_name,
        background_note: students.background_note,
      })
      .from(students)
      .innerJoin(profiles, eq(profiles.id, students.id))
      .where(eq(students.id, studentId))
      .limit(1)
      .then((r) => r[0]),
  ]);

  if (!profile) {
    log(`  ⚠ ${studentId}: no student_ai_profiles row — skipping (profile is created on signup/approval).`);
    return { studentId, status: "skipped-no-profile" };
  }
  if (!studentRow) {
    log(`  ⚠ ${studentId}: no student row — skipping.`);
    return { studentId, status: "skipped-no-profile" };
  }

  // 2. Load all historical data
  const [lessons, hw, todos, diffs, insights] = await Promise.all([
    db
      .select({
        id: lessonSessions.id,
        title: lessonSessions.title,
        status: lessonSessions.status,
        teacher_decision: lessonSessions.teacher_decision,
        teacher_review_note: lessonSessions.teacher_review_note,
        student_reflection: lessonSessions.student_reflection,
        generated_at: lessonSessions.generated_at,
      })
      .from(lessonSessions)
      .where(eq(lessonSessions.student_id, studentId))
      .orderBy(desc(lessonSessions.generated_at)),
    db
      .select({
        id: homeworkItems.id,
        status: homeworkItems.status,
        lesson_id: homeworkItems.lesson_id,
      })
      .from(homeworkItems)
      .where(eq(homeworkItems.student_id, studentId)),
    db
      .select({
        id: todoItems.id,
        status: todoItems.status,
        lesson_id: todoItems.lesson_id,
      })
      .from(todoItems)
      .where(eq(todoItems.student_id, studentId)),
    db
      .select({
        topic_tags: difficultyReports.topic_tags,
        teacher_note: difficultyReports.teacher_note,
        source_id: difficultyReports.source_id,
        created_at: difficultyReports.created_at,
      })
      .from(difficultyReports)
      .where(eq(difficultyReports.student_id, studentId))
      .orderBy(desc(difficultyReports.created_at)),
    db
      .select({ content: studentInsights.content })
      .from(studentInsights)
      .where(eq(studentInsights.student_id, studentId))
      .orderBy(desc(studentInsights.created_at))
      .limit(10),
  ]);

  // 3. Aggregate locally
  const totalLessons = lessons.filter(
    (l) => l.status === "completed" || l.teacher_decision != null
  ).length;
  const allTasks = [...hw, ...todos];
  const totalHomework = allTasks.length;
  const totalFailures = allTasks.filter((t) => t.status === "failed").length;

  // Per-lesson completion rate, then averaged across lessons that had any tasks
  const tasksByLesson = new Map<string, { completed: number; total: number }>();
  for (const t of allTasks) {
    const cur = tasksByLesson.get(t.lesson_id) ?? { completed: 0, total: 0 };
    cur.total += 1;
    if (t.status === "completed") cur.completed += 1;
    tasksByLesson.set(t.lesson_id, cur);
  }
  let avgCompletionRate = 0;
  if (tasksByLesson.size > 0) {
    const rates = [...tasksByLesson.values()].map((v) =>
      v.total > 0 ? v.completed / v.total : 0
    );
    avgCompletionRate = rates.reduce((a, b) => a + b, 0) / rates.length;
  }

  // Difficulty tag frequency
  const tagCounts = new Map<string, number>();
  for (const d of diffs) {
    for (const tag of d.topic_tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const difficultyTagFrequency = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const difficultyNotes = diffs
    .filter((d) => d.teacher_note?.trim())
    .slice(0, 15)
    .map((d) => ({ note: d.teacher_note!.trim(), topics: d.topic_tags }));

  const recentLessons = lessons.slice(0, 15).map((l) => ({
    title: l.title,
    teacher_decision: l.teacher_decision,
    teacher_review_note: l.teacher_review_note,
    student_reflection: l.student_reflection,
  }));

  // Skip students with truly no history — preserves whatever's in the profile.
  if (
    lessons.length === 0 &&
    diffs.length === 0 &&
    insights.length === 0 &&
    allTasks.length === 0
  ) {
    log(`  · ${studentId} (${studentRow.full_name}): no history — skipping.`);
    return { studentId, status: "skipped-no-history" };
  }

  // 4. Build prompt + call Claude
  const prompt = buildBackfillPrompt({
    studentName: studentRow.full_name,
    backgroundNote: studentRow.background_note,
    currentAiSummary: profile.ai_summary,
    currentStrongTopics: profile.strong_topics,
    currentWeakTopics: profile.weak_topics,
    currentLearningStyle: profile.learning_style,
    currentTeacherFeedbackSummary: profile.teacher_feedback_summary,
    totalLessons,
    totalHomework,
    totalFailures,
    avgCompletionRate,
    recentLessons,
    difficultyTagFrequency,
    difficultyNotes,
    insights: insights.map((i) => i.content),
  });

  let updated: BackfillUpdate;
  try {
    updated = await callClaude(prompt, (text) => {
      const parsed = JSON.parse(text);
      return BackfillUpdateSchema.parse(parsed);
    });
  } catch (err) {
    log(`  ✗ ${studentId} (${studentRow.full_name}): Claude call failed — ${(err as Error).message}`);
    return { studentId, status: "error", reason: (err as Error).message };
  }

  // 5. Safety: preserve existing ai_summary if Claude returned a too-short one
  const finalAiSummary =
    updated.ai_summary.trim().length < 20
      ? profile.ai_summary ?? updated.ai_summary
      : updated.ai_summary;
  const finalTeacherFeedbackSummary =
    updated.teacher_feedback_summary.trim().length < 10
      ? profile.teacher_feedback_summary ?? updated.teacher_feedback_summary
      : updated.teacher_feedback_summary;

  // 6. Print diff
  const before = {
    ai_summary: profile.ai_summary,
    strong_topics: profile.strong_topics,
    weak_topics: profile.weak_topics,
    learning_style: profile.learning_style,
    teacher_feedback_summary: profile.teacher_feedback_summary,
    total_lessons: profile.total_lessons,
    total_homework: profile.total_homework,
    total_failures: profile.total_failures,
    avg_completion_rate: Number(profile.avg_completion_rate),
  };
  const after = {
    ai_summary: finalAiSummary,
    strong_topics: updated.strong_topics,
    weak_topics: updated.weak_topics,
    learning_style: updated.learning_style,
    teacher_feedback_summary: finalTeacherFeedbackSummary,
    total_lessons: totalLessons,
    total_homework: totalHomework,
    total_failures: totalFailures,
    avg_completion_rate: Number(avgCompletionRate.toFixed(2)),
  };

  log(`  ▸ ${studentId} (${studentRow.full_name})`);
  log(`      BEFORE: ${JSON.stringify(before)}`);
  log(`      AFTER : ${JSON.stringify(after)}`);

  if (opts.dryRun) {
    return { studentId, status: "would-update" };
  }

  // 7. Write
  await db
    .update(studentAiProfiles)
    .set({
      ai_summary: finalAiSummary,
      strong_topics: updated.strong_topics,
      weak_topics: updated.weak_topics,
      learning_style: updated.learning_style,
      teacher_feedback_summary: finalTeacherFeedbackSummary,
      total_lessons: totalLessons,
      total_homework: totalHomework,
      total_failures: totalFailures,
      avg_completion_rate: avgCompletionRate.toFixed(2),
      updated_at: new Date(),
    })
    .where(eq(studentAiProfiles.student_id, studentId));

  // Refresh the pre-session briefing using the same function the live flow uses.
  try {
    await generateNextSessionBriefing(studentId);
  } catch (err) {
    log(`      briefing refresh failed: ${(err as Error).message}`);
  }

  return { studentId, status: "updated" };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Safety guard: any non-dry-run execution must explicitly pass --confirm-write.
  // This blocks accidental writes (especially against a production DB) before
  // Claude is called, before any select runs, and before any DB write.
  if (!args.dryRun && !args.confirmWrite) {
    console.error(
      "[backfill] Refusing to write without --confirm-write. Run with --dry-run first."
    );
    process.exit(1);
  }

  log(
    `mode: ${args.dryRun ? "DRY-RUN" : "WRITE"}` +
      (args.studentId ? `, student_id=${args.studentId}` : "") +
      (args.limit ? `, limit=${args.limit}` : "")
  );

  // Select approved students only
  const baseRows = await db
    .select({ id: students.id })
    .from(students)
    .innerJoin(profiles, eq(profiles.id, students.id))
    .where(
      args.studentId
        ? and(eq(students.id, args.studentId), eq(profiles.status, "approved"))
        : eq(profiles.status, "approved")
    );

  let targetIds = baseRows.map((r) => r.id);
  if (args.limit !== null) targetIds = targetIds.slice(0, args.limit);

  log(`scanned: ${targetIds.length} approved students`);

  const results: StudentBackfillResult[] = [];
  for (const id of targetIds) {
    try {
      const r = await backfillStudent(id, { dryRun: args.dryRun });
      results.push(r);
    } catch (err) {
      log(`  ✗ ${id}: unexpected error — ${(err as Error).message}`);
      results.push({ studentId: id, status: "error", reason: (err as Error).message });
    }
  }

  const tally = {
    updated: results.filter((r) => r.status === "updated").length,
    wouldUpdate: results.filter((r) => r.status === "would-update").length,
    skippedNoProfile: results.filter((r) => r.status === "skipped-no-profile").length,
    skippedNoHistory: results.filter((r) => r.status === "skipped-no-history").length,
    errors: results.filter((r) => r.status === "error").length,
  };

  log("─────────────────────────────────────────");
  log(`scanned          : ${results.length}`);
  log(`  updated        : ${tally.updated}`);
  log(`  would-update   : ${tally.wouldUpdate}`);
  log(`  skipped (no profile) : ${tally.skippedNoProfile}`);
  log(`  skipped (no history) : ${tally.skippedNoHistory}`);
  log(`  errors         : ${tally.errors}`);
  if (args.dryRun) log("DRY-RUN — no writes performed.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill] fatal:", err);
    process.exit(1);
  });
